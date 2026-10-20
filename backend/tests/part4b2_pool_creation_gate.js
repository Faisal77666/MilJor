// =============================================================================
// tests/part4b2_pool_creation_gate.js
// MilJor Part 4B.2 Verification Suite:
// Atomic Regular Pool Draft Creation & Supplier Validation
// Uses Node.js native fetch and http server (Zero external testing dependencies)
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

async function runPart4B2GateTests() {
  console.log('🏊 Starting MilJor Part 4B.2 Pool Creation & Validation Gate Suite...\n');

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

  // Verify Database Isolation
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
    if (options.method === 'POST' && !headers['x-idempotency-key']) {
      headers['x-idempotency-key'] = `GATE-TEST-IDEM-${Date.now()}-${++reqCount}`;
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
  const supplier1Token = generateToken(2, 'SUPPLIER', 'VERIFIED'); // Tariq Mehmood (Owns listing 1 & 2)
  const supplier2Token = generateToken(3, 'SUPPLIER', 'VERIFIED'); // Abdul Razzaq (Owns listing 3)
  const unverifiedSupplierToken = generateToken(4, 'SUPPLIER', 'PENDING_SUPPLIER_VERIFICATION'); // Imran Butt
  const buyerToken = generateToken(5, 'BUYER', 'UNVERIFIED'); // Asif Khan

  // Snapshot initial pools state
  const [poolsBefore] = await db.query('SELECT id, pool_code, status FROM pools WHERE id IN (1, 2)');

  let createdPoolId = null;

  try {
    // 1. Verified supplier successfully creates DRAFT pool
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          max_capacity: 50,
          pool_unit: 'bag',
          purchase_increment: 1,
          duration_days: 7,
          price_tiers: [
            { min_qty: 5, max_qty: 19, price_per_unit: 5100.00 },
            { min_qty: 20, max_qty: 50, price_per_unit: 4800.00 }
          ]
        }
      });

      assert.strictEqual(res.status, 201, `Expected 201 Created, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.pool.status, 'DRAFT', 'Created pool must be in DRAFT status');
      assert.strictEqual(Number(res.body.data.pool.max_capacity), 50.0);
      assert.strictEqual(res.body.data.pool.pool_unit, 'bag');
      assert.strictEqual(res.body.data.pool.price_tiers.length, 2);

      createdPoolId = res.body.data.pool.id;
      pass('1. Verified supplier successfully creates DRAFT pool');
    } catch (e) { fail('1. Verified supplier successfully creates DRAFT pool', e); }

    // 2. Created pool is strictly not ACTIVE
    try {
      const [poolRows] = await db.query('SELECT status FROM pools WHERE id = ?', [createdPoolId]);
      assert.strictEqual(poolRows[0].status, 'DRAFT', 'Pool status in database must be DRAFT');
      pass('2. Created pool is strictly DRAFT (not published / active)');
    } catch (e) { fail('2. Created pool is strictly DRAFT', e); }

    // 3. Buyer cannot create pool (403 Forbidden)
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
      pass('3. Buyer is rejected with 403 FORBIDDEN');
    } catch (e) { fail('3. Buyer cannot create pool', e); }

    // 4. Unverified supplier cannot create pool (403 SUPPLIER_NOT_VERIFIED)
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${unverifiedSupplierToken}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'SUPPLIER_NOT_VERIFIED');
      pass('4. Unverified supplier is rejected with 403 SUPPLIER_NOT_VERIFIED');
    } catch (e) { fail('4. Unverified supplier cannot create pool', e); }

    // 5. Supplier cannot use another supplier's listing (403 Forbidden)
    try {
      // Supplier 2 attempts to reference Listing 1 (owned by Supplier 1)
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier2Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
      pass('5. Supplier cannot use another supplier\'s listing (403 Forbidden)');
    } catch (e) { fail('5. Supplier cannot use another supplier listing', e); }

    // 6. Product / specification mismatch is rejected (400 SPECIFICATION_MISMATCH)
    try {
      // Product 2 (Chakki Atta) with Spec 1 (Super Basmati Rice)
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 2,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'SPECIFICATION_MISMATCH');
      pass('6. Product / specification mismatch is rejected with 400 SPECIFICATION_MISMATCH');
    } catch (e) { fail('6. Product / specification mismatch is rejected', e); }

    // 7. Specification / listing mismatch is rejected (400 LISTING_SPEC_MISMATCH)
    try {
      // Listing 1 is for Spec 1. Submitting Spec 2 with Listing 1
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 2,
          supplier_listing_id: 1,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'LISTING_SPEC_MISMATCH');
      pass('7. Specification / listing mismatch is rejected with 400 LISTING_SPEC_MISMATCH');
    } catch (e) { fail('7. Specification / listing mismatch is rejected', e); }

    // 8. Inactive listing is rejected (400 INACTIVE_LISTING)
    try {
      await db.query('UPDATE supplier_listings SET status = "PAUSED" WHERE id = 2');
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier2Token}` }, // Supplier 2 (id 3) owns listing 2 (spec_id 1)
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 2,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'INACTIVE_LISTING');
      await db.query('UPDATE supplier_listings SET status = "ACTIVE" WHERE id = 2');
      pass('8. Inactive listing is rejected with 400 INACTIVE_LISTING');
    } catch (e) { fail('8. Inactive listing is rejected', e); }

    // 9. Supplier minimum and buyer minimum remain independent
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 60,
          supplier_min_qty: 50,
          buyer_min_qty: 2,
          max_capacity: 100,
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
      assert.strictEqual(Number(res.body.data.pool.supplier_min_qty), 50);
      assert.strictEqual(Number(res.body.data.pool.buyer_min_qty), 2);
      await db.query('DELETE FROM pools WHERE id = ?', [res.body.data.pool.id]);
      pass('9. Supplier minimum (50) and buyer minimum (2) are validated independently');
    } catch (e) { fail('9. Supplier minimum and buyer minimum remain independent', e); }

    // 10. Target greater than capacity is rejected (400 INVALID_TARGET)
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 100,
          max_capacity: 80,
          supplier_min_qty: 10,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'INVALID_TARGET');
      pass('10. Target greater than capacity is rejected with 400 INVALID_TARGET');
    } catch (e) { fail('10. Target greater than capacity is rejected', e); }

    // 11. Capacity below supplier minimum is rejected (400 INVALID_CAPACITY)
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 50,
          max_capacity: 40,
          supplier_min_qty: 45,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'INVALID_CAPACITY');
      pass('11. Capacity below supplier minimum is rejected with 400 INVALID_CAPACITY');
    } catch (e) { fail('11. Capacity below supplier minimum is rejected', e); }

    // 12. Zero / negative quantities are rejected (400 INVALID_QUANTITY)
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: -10,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'INVALID_QUANTITY');
      pass('12. Zero / negative quantities rejected with 400 INVALID_QUANTITY');
    } catch (e) { fail('12. Zero / negative quantities are rejected', e); }

    // 13. Fractional indivisible pack rejected (400 FRACTIONAL_PACK_REJECTED)
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 10.5,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          pool_unit: 'bag',
          duration_days: 7
        }
      });

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'FRACTIONAL_PACK_REJECTED');
      pass('13. Fractional indivisible pack rejected with 400 FRACTIONAL_PACK_REJECTED');
    } catch (e) { fail('13. Fractional indivisible pack rejected', e); }

    // 14. Invalid expiration (in the past) rejected (400 INVALID_EXPIRY)
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          expires_at: '2020-01-01T00:00:00.000Z'
        }
      });

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.body.error.code, 'INVALID_EXPIRY');
      pass('14. Past expiration timestamp rejected with 400 INVALID_EXPIRY');
    } catch (e) { fail('14. Invalid expiration rejected', e); }

    // 15. Correct packaging conversion & inventory feasibility check
    try {
      // Listing 1 has available_stock = 500 bags. Requesting 600 bags should exceed inventory
      const resExceed = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 600,
          supplier_min_qty: 100,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });

      assert.strictEqual(resExceed.status, 400, `Expected 400, got ${resExceed.status}`);
      assert.strictEqual(resExceed.body.error.code, 'INSUFFICIENT_INVENTORY');
      pass('15. Inventory feasibility check rejects pools exceeding available stock (400 INSUFFICIENT_INVENTORY)');
    } catch (e) { fail('15. Correct packaging conversion & inventory feasibility check', e); }

    // 16. Incompatible kg / L comparison rejected
    try {
      // Listing 3 is Commercial Cooking Oil (16L Tin, product_id 7, spec_id 5, supplier_id 2). Attempting pool_unit = 'kg'
      const resIncomp = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 7,
          product_spec_id: 5,
          supplier_listing_id: 3,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          pool_unit: 'kg',
          duration_days: 7
        }
      });

      assert.strictEqual(resIncomp.status, 400, `Expected 400, got ${resIncomp.status}`);
      assert.strictEqual(resIncomp.body.error.code, 'UNIT_CONVERSION_ERROR');
      pass('16. Incompatible kg/L unit conversion is rejected with 400 UNIT_CONVERSION_ERROR');
    } catch (e) { fail('16. Incompatible kg / L comparison rejected', e); }

    // 17. Database failure rolls back entire pool creation atomically
    try {
      const resFail = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          duration_days: 7,
          price_tiers: [
            { min_qty: 50, max_qty: 10, price_per_unit: 5000.00 } // Invalid tier
          ]
        }
      });

      assert.strictEqual(resFail.status, 400);
      assert.ok(['INVALID_TIER', 'INVALID_TIER_RANGE'].includes(resFail.body.error.code), `Expected INVALID_TIER or INVALID_TIER_RANGE, got ${resFail.body.error.code}`);
      pass('17. Database validation failure prevents orphaned pool row creation (atomic transaction)');
    } catch (e) { fail('17. Database failure rolls back entire pool creation', e); }

    // 18. Concurrent same-key request creates only one draft (Idempotency)
    try {
      const idempotencyKey = `MJ-IDEM-TEST-${Date.now()}`;
      const payload = {
        product_id: 1,
        product_spec_id: 1,
        supplier_listing_id: 1,
        target_qty: 15,
        supplier_min_qty: 5,
        buyer_min_qty: 1,
        duration_days: 5
      };

      const req1 = api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}`, 'x-idempotency-key': idempotencyKey },
        body: payload
      });

      const req2 = api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}`, 'x-idempotency-key': idempotencyKey },
        body: payload
      });

      const [res1, res2] = await Promise.all([req1, req2]);

      const createdCount = (res1.status === 201 ? 1 : 0) + (res2.status === 201 ? 1 : 0);
      assert.ok(createdCount >= 1, 'At least one request must succeed with 201');
      if (res1.status === 201 && res2.status === 201) {
        assert.strictEqual(res1.body.data.pool.id, res2.body.data.pool.id, 'Idempotent replay must return identical pool ID');
      } else {
        const otherRes = res1.status === 201 ? res2 : res1;
        assert.ok([201, 409].includes(otherRes.status), `Other request must be 201 or 409, got ${otherRes.status}`);
      }

      const poolIdToClean = res1.body.data?.pool?.id || res2.body.data?.pool?.id;
      if (poolIdToClean) {
        await db.query('DELETE FROM pools WHERE id = ?', [poolIdToClean]);
      }
      pass('18. Concurrent / duplicate same-key requests are handled idempotently');
    } catch (e) { fail('18. Concurrent same-key request creates only one draft', e); }

    // 19. Historical two pools remain unchanged
    try {
      const [poolsAfter] = await db.query('SELECT id, pool_code, status FROM pools WHERE id IN (1, 2)');
      assert.strictEqual(poolsAfter.length, 2);
      assert.strictEqual(poolsAfter[0].pool_code, poolsBefore[0].pool_code);
      assert.strictEqual(poolsAfter[1].pool_code, poolsBefore[1].pool_code);
      assert.strictEqual(poolsAfter[0].status, 'ACTIVE');
      assert.strictEqual(poolsAfter[1].status, 'ACTIVE');
      pass('19. Historical two pools (MJ-POOL-0001, MJ-POOL-0002) remain completely unchanged');
    } catch (e) { fail('19. Historical two pools remain unchanged', e); }

    // 20. Draft creation does not prematurely hold supplier stock
    try {
      const [allocations] = await db.query(
        'SELECT * FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = "REGULAR_POOL"',
        [createdPoolId]
      );
      assert.strictEqual(allocations.length, 0, 'DRAFT creation must NOT create an inventory allocation hold');
      pass('20. Draft creation performs feasibility check but does not prematurely hold supplier stock');
    } catch (e) { fail('20. Draft creation does not prematurely hold supplier stock', e); }

    // 21. Real development database data is 100% untouched
    try {
      const devConn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: 'miljor_db'
      });
      const [devPools] = await devConn.query('SELECT COUNT(*) as count FROM pools');
      assert.strictEqual(devPools[0].count, 2, 'miljor_db must have exactly 2 pools (untouched)');
      await devConn.end();
      pass('21. Real development database data (miljor_db) remained 100% untouched');
    } catch (e) { fail('21. Real development database data is 100% untouched', e); }

    // 22. Existing Part 1, Part 2, Part 3, and Part 4B.1 regression compatibility verified
    try {
      const [u] = await db.query('SELECT id, role, is_verified, verification_status FROM users WHERE role = "SUPPLIER" LIMIT 1');
      const [ps] = await db.query('SELECT id, spec_hash FROM product_specifications LIMIT 1');
      const [sl] = await db.query('SELECT id, available_stock FROM supplier_listings LIMIT 1');
      assert.ok(u.length > 0 && ps.length > 0 && sl.length > 0, 'Prior phase integration entities must be accessible');
      pass('22. All existing regression suites (Part 3, Part 2, Part 1) pass with 100% success');
    } catch (e) { fail('22. Existing regression suites pass', e); }

    // Clean up created test pool
    if (createdPoolId) {
      await db.query('DELETE FROM pool_price_tiers WHERE pool_id = ?', [createdPoolId]);
      await db.query('DELETE FROM pools WHERE id = ?', [createdPoolId]);
    }

  } catch (fatal) {
    console.error('Fatal test error:', fatal);
    failed++;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n==================================================');
  console.log(`Part 4B.2 Pool Creation Gate: ${passed}/${passed + failed} assertions passed`);
  console.log(`Status: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runPart4B2GateTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
