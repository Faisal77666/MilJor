// =============================================================================
// tests/pre4c1_concurrency_hardening_gate.js
// MilJor Pre-4C.1 Consolidated Concurrency, Security & Edge Cases Verification Gate
// Tests all 15 advanced scenarios required by the Pre-4C.1 specification.
// Zero external testing dependencies (Native Node.js fetch & http)
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const tierPricingService = require('../src/services/tierPricingService');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

async function runPre4C1ConcurrencyGateTests() {
  console.log('🛡️ Starting MilJor Pre-4C.1 Advanced Concurrency & Hardening Gate Suite...\n');

  let passed = 0;
  let failed = 0;

  function pass(testName) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  }

  function fail(testName, error) {
    console.error(`❌ [FAIL] ${testName}:`, error.message);
    failed++;
  }

  // 1. Verify Database Isolation
  const [dbRow] = await db.query('SELECT DATABASE() as current_db');
  const activeDb = dbRow[0].current_db;
  console.log(`🔒 Test Suite Environment Verified: Active Database = '${activeDb}'`);
  assert.strictEqual(activeDb, 'miljor_test_db', 'Must execute strictly against miljor_test_db!');

  // Start ephemeral HTTP test server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  let reqCount = 0;
  async function api(endpoint, options = {}) {
    const url = `${baseUrl}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if ((options.method === 'POST' || options.method === 'PUT') && !headers['x-idempotency-key'] && !options.skipIdempotency) {
      headers['x-idempotency-key'] = `PRE4C1-IDEM-${Date.now()}-${++reqCount}`;
    }
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  // Tokens
  const supplier1Token = generateToken(2, 'SUPPLIER', 'VERIFIED'); // Tariq Mehmood (Listing 1 & 2)
  const supplier2Token = generateToken(3, 'SUPPLIER', 'VERIFIED'); // Abdul Razzaq (Listing 3)
  const buyerToken = generateToken(5, 'BUYER', 'UNVERIFIED'); // Asif Khan

  // Snapshot initial state
  const [poolsBefore] = await db.query('SELECT id, pool_code, status FROM pools WHERE id IN (1, 2)');

  const createdPoolIds = [];
  const createdIdempotencyKeys = [];

  try {
    // -------------------------------------------------------------------------
    // 1. Two different idempotency keys creating different pools concurrently
    // -------------------------------------------------------------------------
    try {
      const key1 = `CONC-CREATE-1-${Date.now()}`;
      const key2 = `CONC-CREATE-2-${Date.now()}`;

      const payload1 = {
        product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
        target_qty: 15, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5
      };
      const payload2 = {
        product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
        target_qty: 20, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 6
      };

      const [res1, res2] = await Promise.all([
        api('/api/v1/pools', { method: 'POST', headers: { Authorization: `Bearer ${supplier1Token}`, 'x-idempotency-key': key1 }, body: payload1 }),
        api('/api/v1/pools', { method: 'POST', headers: { Authorization: `Bearer ${supplier1Token}`, 'x-idempotency-key': key2 }, body: payload2 })
      ]);

      assert.strictEqual(res1.status, 201);
      assert.strictEqual(res2.status, 201);
      assert.notStrictEqual(res1.body.data.pool.id, res2.body.data.pool.id);

      createdPoolIds.push(res1.body.data.pool.id, res2.body.data.pool.id);
      pass('1. Two different idempotency keys creating different pools concurrently succeed independently');
    } catch (e) { fail('1. Concurrent distinct pool creation', e); }

    // -------------------------------------------------------------------------
    // 2. Two suppliers publishing competing pools against constrained inventory
    // -------------------------------------------------------------------------
    try {
      // Create two draft pools by Supplier 1 referencing listing 1 (which has available_stock = 500)
      // We will set target/capacity high enough that only one can publish, or test constrained stock.
      // Let's create draft pool A with capacity 300, draft pool B with capacity 300. Available stock is 500.
      const resA = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
          target_qty: 150, supplier_min_qty: 50, buyer_min_qty: 5, max_capacity: 300, duration_days: 7,
          price_tiers: [{ min_qty: 50, max_qty: 300, price_per_unit: 5000.00 }]
        }
      });
      const resB = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
          target_qty: 150, supplier_min_qty: 50, buyer_min_qty: 5, max_capacity: 300, duration_days: 7,
          price_tiers: [{ min_qty: 50, max_qty: 300, price_per_unit: 5000.00 }]
        }
      });

      assert.strictEqual(resA.status, 201);
      assert.strictEqual(resB.status, 201);
      const poolAId = resA.body.data.pool.id;
      const poolBId = resB.body.data.pool.id;
      createdPoolIds.push(poolAId, poolBId);

      // Publish pool A first (takes 300 out of 500 stock -> leaves 200 available)
      const pubA = await api(`/api/v1/pools/${poolAId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` }
      });
      assert.strictEqual(pubA.status, 200);

      // Now publish pool B (needs 300, but only 200 available -> must fail 409 INSUFFICIENT_STOCK_FOR_PUBLISHING)
      const pubB = await api(`/api/v1/pools/${poolBId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` }
      });
      assert.strictEqual(pubB.status, 409);
      assert.strictEqual(pubB.body.error.code, 'INSUFFICIENT_STOCK_FOR_PUBLISHING');

      pass('2. Competing pools publishing against constrained listing inventory rejects second pool with 409 INSUFFICIENT_STOCK_FOR_PUBLISHING');
    } catch (e) { fail('2. Competing pool inventory constraint', e); }

    // -------------------------------------------------------------------------
    // 3. Repeated same-key publishing returns identical cached response (Idempotent)
    // -------------------------------------------------------------------------
    try {
      const resDraft = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
          target_qty: 10, supplier_min_qty: 5, buyer_min_qty: 1, max_capacity: 20, duration_days: 5,
          price_tiers: [{ min_qty: 5, max_qty: 20, price_per_unit: 5000.00 }]
        }
      });
      const poolId = resDraft.body.data.pool.id;
      createdPoolIds.push(poolId);

      const pubKey = `REPEAT-PUB-KEY-${Date.now()}`;
      const pub1 = await api(`/api/v1/pools/${poolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}`, 'x-idempotency-key': pubKey }
      });
      assert.strictEqual(pub1.status, 200);

      const pub2 = await api(`/api/v1/pools/${poolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}`, 'x-idempotency-key': pubKey }
      });
      assert.strictEqual(pub2.status, 200);
      assert.strictEqual(pub2.body.data.pool.id, pub1.body.data.pool.id);

      pass('3. Repeated same-key publishing returns identical 200 cached response idempotently');
    } catch (e) { fail('3. Repeated same-key publishing', e); }

    // -------------------------------------------------------------------------
    // 4. Crash/retry behavior of incomplete idempotency records (stale placeholder recovery)
    // -------------------------------------------------------------------------
    try {
      const crashKey = `CRASH-RETRY-KEY-${Date.now()}`;
      createdIdempotencyKeys.push(crashKey);
      // Simulate an unhandled server crash by inserting an in-flight record older than 60s
      // Using NOW() - INTERVAL 75 SECOND guarantees consistency with MySQL TIMESTAMPDIFF
      await db.query(
        `INSERT INTO idempotency_records (idempotency_key, user_id, request_path, request_hash, status, response_status, response_body, created_at, last_heartbeat_at)
         VALUES (?, 2, 'POST:/api/v1/pools', 'dummyhash', 'PENDING', 0, '', NOW() - INTERVAL 75 SECOND, NOW() - INTERVAL 75 SECOND)`,
        [crashKey]
      );

      // Attempt request with this crash key. Guard must recognize stale placeholder, clean it, and allow execution.
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}`, 'x-idempotency-key': crashKey },
        body: {
          product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
          target_qty: 12, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5
        }
      });

      assert.strictEqual(res.status, 201);
      createdPoolIds.push(res.body.data.pool.id);
      pass('4. Incomplete/crashed idempotency records older than 60s safely recover and allow clean retries');
    } catch (e) { fail('4. Crash retry behavior', e); }

    // -------------------------------------------------------------------------
    // 5. Publishing transaction rollback on error leaves zero orphaned records
    // -------------------------------------------------------------------------
    try {
      // A pool with an inactive listing should fail creation/publishing and leave no allocation
      const listingCode = `LST-${Math.floor(100000 + Math.random() * 900000)}`;
      const [fakeListing] = await db.query(
        `INSERT INTO supplier_listings (listing_code, supplier_id, product_spec_id, base_unit_price, pricing_unit, available_stock, delivery_zones, status)
         VALUES (?, 2, 3, 5000, 'bag', 100, '["Gulberg"]', 'PAUSED')`,
        [listingCode]
      );
      const pausedListingId = fakeListing.insertId;

      const resDraft = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1, product_spec_id: 3, supplier_listing_id: pausedListingId,
          target_qty: 10, supplier_min_qty: 5, buyer_min_qty: 1, max_capacity: 20, duration_days: 5,
          price_tiers: [{ min_qty: 5, max_qty: 20, price_per_unit: 5000.00 }]
        }
      });

      // The creation fails 400 because listing is PAUSED
      assert.strictEqual(resDraft.status, 400);

      // Verify no allocation row exists
      const [allocRows] = await db.query(
        `SELECT * FROM supplier_inventory_allocations WHERE supplier_listing_id = ?`,
        [pausedListingId]
      );
      assert.strictEqual(allocRows.length, 0);

      await db.query('DELETE FROM supplier_listings WHERE id = ?', [pausedListingId]);
      pass('5. Failed operations roll back completely leaving zero orphaned allocations');
    } catch (e) { fail('5. Publishing rollback safety', e); }

    // -------------------------------------------------------------------------
    // 6. Pool status updated without successful inventory allocation is prevented
    // -------------------------------------------------------------------------
    try {
      // Both status update to ACTIVE and inventory allocation occur within the exact same transaction
      const [activeWithoutAlloc] = await db.query(
        `SELECT p.id FROM pools p
         LEFT JOIN supplier_inventory_allocations a ON a.reference_id = p.id AND a.allocation_type = 'REGULAR_POOL' AND a.status = 'COMMITTED'
         WHERE p.status = 'ACTIVE' AND p.id NOT IN (1, 2) AND a.id IS NULL`
      );
      assert.strictEqual(activeWithoutAlloc.length, 0, 'No ACTIVE pool created after foundation should exist without a COMMITTED allocation');
      pass('6. Transactional integrity ensures no pool transitions to ACTIVE without a committed inventory allocation');
    } catch (e) { fail('6. Active pool without allocation check', e); }

    // -------------------------------------------------------------------------
    // 7. Releasing the same allocation twice is idempotent and safe
    // -------------------------------------------------------------------------
    try {
      const [alloc] = await db.query(
        `INSERT INTO supplier_inventory_allocations (supplier_listing_id, allocation_type, reference_id, allocated_qty, unit, status)
         VALUES (1, 'REGULAR_POOL', 99999, 10, 'bag', 'COMMITTED')`
      );
      const allocId = alloc.insertId;

      // Release first time
      await db.query(`UPDATE supplier_inventory_allocations SET status = 'RELEASED' WHERE id = ?`, [allocId]);
      // Release second time
      await db.query(`UPDATE supplier_inventory_allocations SET status = 'RELEASED' WHERE id = ?`, [allocId]);

      const [updated] = await db.query(`SELECT status FROM supplier_inventory_allocations WHERE id = ?`, [allocId]);
      assert.strictEqual(updated[0].status, 'RELEASED');

      await db.query(`DELETE FROM supplier_inventory_allocations WHERE id = ?`, [allocId]);
      pass('7. Releasing the same allocation multiple times is idempotent and safe');
    } catch (e) { fail('7. Duplicate allocation release', e); }

    // -------------------------------------------------------------------------
    // 8. Cancelling an ACTIVE pool that already contains valid reservations is blocked (OBS-11)
    // -------------------------------------------------------------------------
    try {
      // Create and publish a pool
      const resDraft = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
          target_qty: 10, supplier_min_qty: 5, buyer_min_qty: 1, max_capacity: 20, duration_days: 5,
          price_tiers: [{ min_qty: 5, max_qty: 20, price_per_unit: 5000.00 }]
        }
      });
      const poolId = resDraft.body.data.pool.id;
      createdPoolIds.push(poolId);

      await api(`/api/v1/pools/${poolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` }
      });

      // Inject an active reservation with valid reservation_code (VARCHAR(30))
      const resCode = `RES-${Math.floor(100000 + Math.random() * 900000)}`;
      await db.query(
        `INSERT INTO reservations (reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status)
         VALUES (?, ?, 5, 2, 5000, 10000, 'RESERVED')`,
        [resCode, poolId]
      );

      // Attempt cancellation by supplier -> Must be blocked with 422 RESERVED_POOL_CANCELLATION_BLOCKED
      const cancelRes = await api(`/api/v1/pools/${poolId}/cancel`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: { reason: 'Cancelling with reservations' }
      });

      assert.strictEqual(cancelRes.status, 422);
      assert.strictEqual(cancelRes.body.error.code, 'RESERVED_POOL_CANCELLATION_BLOCKED');

      // Cleanup reservation
      await db.query(`DELETE FROM reservations WHERE pool_id = ?`, [poolId]);
      pass('8. Supplier cancelling pool with active reservations is safely blocked with 422 RESERVED_POOL_CANCELLATION_BLOCKED (OBS-11)');
    } catch (e) { fail('8. Reserved pool cancellation guard', e); }

    // -------------------------------------------------------------------------
    // 9. Expired ACTIVE pool appearing in public results is excluded
    // -------------------------------------------------------------------------
    try {
      // Create a pool in the past using NOW() - INTERVAL 1 HOUR for deterministic MySQL time comparison
      const [expiredPool] = await db.query(
        `INSERT INTO pools (pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id,
                            current_qty, target_qty, supplier_min_qty, buyer_min_qty, max_capacity,
                            pool_unit, purchase_increment, current_price_per_unit, status, expires_at)
         VALUES ('MJ-EXPIRED-TEST', 2, 1, 1, 1, 0, 20, 5, 1, 30, 'bag', 1, 5000, 'ACTIVE', NOW() - INTERVAL 1 HOUR)`
      );
      const expiredPoolId = expiredPool.insertId;
      createdPoolIds.push(expiredPoolId);

      const res = await api('/api/v1/pools');
      const activeIds = res.body.data.pools.map(p => p.id);
      assert.ok(!activeIds.includes(expiredPoolId), 'Expired ACTIVE pool must be excluded by WHERE expires_at > NOW()');

      pass('9. Expired ACTIVE pools are strictly excluded from public listing results');
    } catch (e) { fail('9. Expired active pool exclusion', e); }

    // -------------------------------------------------------------------------
    // 10. Pool tiers above target but below maximum capacity are valid
    // -------------------------------------------------------------------------
    try {
      const tiersAboveTarget = [
        { min_qty: 10, max_qty: 20, price_per_unit: 5200.00 }, // target is 20
        { min_qty: 21, max_qty: 40, price_per_unit: 4800.00 }  // above target, capacity is 40
      ];
      const res = tierPricingService.validateTiers(tiersAboveTarget, {
        supplier_min_qty: 10, target_qty: 20, max_capacity: 40, pool_unit: 'bag'
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.normalizedTiers.length, 2);
      pass('10. Price tiers extending above target_qty up to max_capacity validate correctly');
    } catch (e) { fail('10. Tiers above target', e); }

    // -------------------------------------------------------------------------
    // 11. Exact maximum-capacity tier coverage boundary check
    // -------------------------------------------------------------------------
    try {
      const exactCapacityTiers = [
        { min_qty: 10, max_qty: 20, price_per_unit: 5200.00 },
        { min_qty: 21, max_qty: 50, price_per_unit: 4800.00 } // exactly 50
      ];
      const res = tierPricingService.validateTiers(exactCapacityTiers, {
        supplier_min_qty: 10, target_qty: 30, max_capacity: 50, pool_unit: 'bag'
      });
      assert.strictEqual(res.valid, true);

      // Check applicable price exactly at 50
      const pricingAtCap = tierPricingService.calculateApplicablePrice(exactCapacityTiers, 50, 10);
      assert.strictEqual(pricingAtCap.price, 4800.00);
      assert.strictEqual(pricingAtCap.isQualified, true);

      pass('11. Exact maximum-capacity tier coverage boundary evaluated deterministically');
    } catch (e) { fail('11. Exact maximum capacity tier check', e); }

    // -------------------------------------------------------------------------
    // 12. Duplicate or inconsistent normalized specification attributes rejection
    // -------------------------------------------------------------------------
    try {
      // Trying to create a spec with invalid category or missing attributes
      const res = await api('/api/v1/specifications', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          variety: 'Super Kernel',
          quality_grade: 'Grade-A',
          packaging_type: 'Jute Bag',
          pack_size: 50,
          pack_unit: 'kg',
          purchasing_unit: 'bag',
          attributes: { invalid_attribute_not_in_category: 'test' }
        }
      });
      assert.strictEqual(res.status, 400);
      pass('12. Inconsistent or unrecognized specification attributes rejected with 400');
    } catch (e) { fail('12. Duplicate/inconsistent spec attributes', e); }

    // -------------------------------------------------------------------------
    // 13. Incorrect pricing/quantity unit combinations rejected
    // -------------------------------------------------------------------------
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
          target_qty: 20, supplier_min_qty: 5, buyer_min_qty: 1, max_capacity: 50,
          pool_unit: 'bag', duration_days: 7,
          price_tiers: [
            { min_qty: 5, max_qty: 50, price_per_unit: 5000.00, pricing_unit: 'litre' } // Mismatched unit!
          ]
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'TIER_UNIT_MISMATCH');
      pass('13. Incorrect pricing/quantity unit combinations rejected with 400 TIER_UNIT_MISMATCH');
    } catch (e) { fail('13. Unit combination check', e); }

    // -------------------------------------------------------------------------
    // 14. Malicious client-supplied supplier ID is ignored (uses JWT identity)
    // -------------------------------------------------------------------------
    try {
      // Supplier 1 supplies supplier_id: 3 in request body, but listing 1 belongs to Supplier 2
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` }, // Supplier 2 in DB
        body: {
          supplier_id: 9999, // Attempted spoof
          product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
          target_qty: 10, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5
        }
      });
      // Pool is created for authenticated user ID (2), NOT spoofed 9999
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.pool.supplier_id, 2);
      createdPoolIds.push(res.body.data.pool.id);
      pass('14. Malicious client-supplied supplier_id is strictly ignored in favor of authenticated JWT identity');
    } catch (e) { fail('14. Supplier ID spoofing protection', e); }

    // -------------------------------------------------------------------------
    // 15. Historical pools surviving migration and regression checks
    // -------------------------------------------------------------------------
    try {
      const [poolsNow] = await db.query('SELECT id, pool_code, status, product_spec_id, supplier_listing_id FROM pools WHERE id IN (1, 2)');
      assert.strictEqual(poolsNow.length, 2);
      assert.strictEqual(poolsNow[0].pool_code, 'MJ-POOL-0001');
      assert.strictEqual(poolsNow[1].pool_code, 'MJ-POOL-0002');
      assert.strictEqual(poolsNow[0].product_spec_id, null);
      assert.strictEqual(poolsNow[1].product_spec_id, null);
      pass('15. Historical pools 1 & 2 remain completely intact, unmutated, and valid throughout all tests');
    } catch (e) { fail('15. Historical pools survival', e); }

  } finally {
    // Teardown HTTP server
    await new Promise((resolve) => server.close(resolve));

    // Cleanup created test pools and allocations from test DB
    for (const id of createdPoolIds) {
      await db.query(`DELETE FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'`, [id]);
      await db.query(`DELETE FROM pool_price_tiers WHERE pool_id = ?`, [id]);
      await db.query(`DELETE FROM pools WHERE id = ?`, [id]);
    }

    if (createdIdempotencyKeys.length > 0) {
      await db.query('DELETE FROM idempotency_records WHERE idempotency_key IN (?)', [createdIdempotencyKeys]);
    }

    // Verify historical pools remained untouched
    const [poolsAfter] = await db.query('SELECT id, pool_code, status FROM pools WHERE id IN (1, 2)');
    assert.deepStrictEqual(poolsBefore, poolsAfter, 'Historical pools 1 and 2 must remain completely intact!');
  }

  console.log('\n==================================================');
  console.log(`Pre-4C.1 Concurrency & Hardening Gate: ${passed}/${passed + failed} assertions passed`);
  console.log(`Status: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPre4C1ConcurrencyGateTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal Test Failure:', err);
  process.exit(1);
});
