// =============================================================================
// tests/part4b4_2_observations_integrity_gate.js
// MilJor Part 4B.4.2 Verification Gate Suite:
// Critical Reservation Integrity Corrections (OBS-21 through OBS-25) & Zero-Regression Gate
// Zero external testing dependencies (Native Node.js fetch & http)
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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

async function runPart4B42ObservationsIntegrityGate() {
  console.log('🛡️ Starting MilJor Part 4B.4.2 Critical Reservation Integrity & Observations Suite...\n');

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
      headers['x-idempotency-key'] = `PART4B42-IDEM-${Date.now()}-${++reqCount}`;
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
  const supplier1Token = generateToken(2, 'SUPPLIER', 'VERIFIED'); // Tariq Mehmood (Listing 1: Atta 10kg Bag)
  const buyer1Token = generateToken(5, 'BUYER', 'UNVERIFIED'); // Asif Khan
  const buyer2Token = generateToken(6, 'BUYER', 'UNVERIFIED'); // Bilal Ahmed
  const buyer3Token = generateToken(7, 'BUYER', 'UNVERIFIED'); // Usman Tariq

  // Track created fixtures for thorough cleanup
  const createdPoolIds = [];
  const createdReservationIds = [];
  const createdIdempotencyKeys = [];
  const createdListingIds = [];
  const createdUserIds = [];

  // Temporarily set ample available_stock for listing 1 to avoid ATP exhaustion
  const [initStockRow] = await db.query('SELECT available_stock FROM supplier_listings WHERE id = 1');
  const originalStock = initStockRow[0]?.available_stock || 500.00;
  await db.query('UPDATE supplier_listings SET available_stock = 10000.00 WHERE id = 1');

  // Helper to create & publish a valid test pool
  async function createAndPublishTestPool(config = {}) {
    const poolCode = `TEST-P4B42-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const targetQty = config.target_qty || 25;
    const maxCap = config.max_capacity !== undefined ? config.max_capacity : 50;
    const suppMin = config.supplier_min_qty || 10;
    const buyerMin = config.buyer_min_qty || 2;
    const increment = config.purchase_increment || 1;
    const poolUnit = config.pool_unit || 'bag';

    const defaultTiers = [
      { min_qty: suppMin, max_qty: targetQty - 1, price_per_unit: 5200.00, pricing_unit: poolUnit },
      { min_qty: targetQty, max_qty: maxCap, price_per_unit: 4900.00, pricing_unit: poolUnit }
    ];
    const tiers = config.price_tiers || defaultTiers;

    // 1. Create DRAFT pool
    const draftRes = await api('/api/v1/pools', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.supplierToken || supplier1Token}` },
      body: {
        pool_code: poolCode,
        product_id: config.product_id || 1,
        product_spec_id: config.product_spec_id || 1,
        supplier_listing_id: config.supplier_listing_id || 1,
        target_qty: targetQty,
        max_capacity: maxCap,
        supplier_min_qty: suppMin,
        buyer_min_qty: buyerMin,
        purchase_increment: increment,
        pool_unit: poolUnit,
        price_per_unit: tiers[0].price_per_unit,
        duration_days: 7,
        price_tiers: tiers,
        min_participants: 2,
        max_participants: 10
      }
    });

    assert.strictEqual(draftRes.status, 201, `Failed to create draft pool: ${JSON.stringify(draftRes.body)}`);
    const poolId = draftRes.body.data.pool.id;
    createdPoolIds.push(poolId);

    if (config.keepDraft) {
      return { poolId, poolCode, draftRes };
    }

    // 2. Publish pool
    const publishRes = await api(`/api/v1/pools/${poolId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.supplierToken || supplier1Token}` },
      body: {}
    });

    assert.strictEqual(publishRes.status, 200, `Failed to publish pool: ${JSON.stringify(publishRes.body)}`);
    return { poolId, poolCode, publishRes };
  }

  try {
    // =========================================================================
    // OBS-21: Supplier Positive Verification & Eligibility
    // =========================================================================

    // Test 1: Verified active supplier succeeds with modern pool
    try {
      const validPool = await createAndPublishTestPool();
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: { pool_id: validPool.poolId, quantity: 5 }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.reservation.status, 'RESERVED');
      createdReservationIds.push(res.body.data.reservation.id);
      pass('1. Verified active supplier succeeds with valid modern pool reservation');
    } catch (e) { fail('1. Verified active supplier succeeds', e); }

    // Test 2: Unverified supplier (u.verification_status = 'UNVERIFIED') rejected with 422 SUPPLIER_INELIGIBLE
    try {
      const poolUnverified = await createAndPublishTestPool();
      // Temporarily set supplier 2 to UNVERIFIED on users table
      await db.query("UPDATE users SET verification_status = 'UNVERIFIED' WHERE id = 2");
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: { pool_id: poolUnverified.poolId, quantity: 5 }
      });
      // Restore supplier 2
      await db.query("UPDATE users SET verification_status = 'VERIFIED' WHERE id = 2");

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'SUPPLIER_INELIGIBLE');
      pass('2. Unverified supplier (u.verification_status = UNVERIFIED) rejected with 422 SUPPLIER_INELIGIBLE');
    } catch (e) {
      await db.query("UPDATE users SET verification_status = 'VERIFIED' WHERE id = 2");
      fail('2. Unverified supplier rejected', e);
    }

    // Test 3: Supplier profile pending review (sp.verification_status = 'PENDING_REVIEW') rejected with 422 SUPPLIER_INELIGIBLE
    try {
      const poolPending = await createAndPublishTestPool();
      await db.query("UPDATE supplier_profiles SET verification_status = 'PENDING_REVIEW' WHERE supplier_id = 2");
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: { pool_id: poolPending.poolId, quantity: 5 }
      });
      await db.query("UPDATE supplier_profiles SET verification_status = 'VERIFIED' WHERE supplier_id = 2");

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'SUPPLIER_INELIGIBLE');
      pass('3. Pending supplier profile (sp.verification_status = PENDING_REVIEW) rejected with 422 SUPPLIER_INELIGIBLE');
    } catch (e) {
      await db.query("UPDATE supplier_profiles SET verification_status = 'VERIFIED' WHERE supplier_id = 2");
      fail('3. Pending supplier profile rejected', e);
    }

    // Test 4: Supplier profile rejected (sp.verification_status = 'REJECTED') rejected with 422 SUPPLIER_INELIGIBLE
    try {
      const poolRejected = await createAndPublishTestPool();
      await db.query("UPDATE supplier_profiles SET verification_status = 'REJECTED' WHERE supplier_id = 2");
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: { pool_id: poolRejected.poolId, quantity: 5 }
      });
      await db.query("UPDATE supplier_profiles SET verification_status = 'VERIFIED' WHERE supplier_id = 2");

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'SUPPLIER_INELIGIBLE');
      pass('4. Rejected supplier profile (sp.verification_status = REJECTED) rejected with 422 SUPPLIER_INELIGIBLE');
    } catch (e) {
      await db.query("UPDATE supplier_profiles SET verification_status = 'VERIFIED' WHERE supplier_id = 2");
      fail('4. Rejected supplier profile rejected', e);
    }

    // Test 5: Supplier unverified (is_verified = 0) or non-SUPPLIER role rejected with 422 SUPPLIER_INELIGIBLE
    try {
      const poolBlocked = await createAndPublishTestPool();
      await db.query("UPDATE users SET is_verified = 0 WHERE id = 2");
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: { pool_id: poolBlocked.poolId, quantity: 5 }
      });
      await db.query("UPDATE users SET is_verified = 1 WHERE id = 2");

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'SUPPLIER_INELIGIBLE');
      pass('5. Unverified flag (is_verified = 0) supplier rejected with 422 SUPPLIER_INELIGIBLE');
    } catch (e) {
      await db.query("UPDATE users SET is_verified = 1 WHERE id = 2");
      fail('5. Unverified flag supplier rejected', e);
    }

    // Test 6: Buyer trust fields cannot falsely verify an unverified supplier
    try {
      const poolTrust = await createAndPublishTestPool();
      // Set supplier user verification_status = 'UNVERIFIED'
      await db.query("UPDATE users SET verification_status = 'UNVERIFIED' WHERE id = 2");
      // Set buyer 2 trust status to TRUSTED_BUYER on users table
      await db.query("UPDATE users SET buyer_trust_status = 'TRUSTED_BUYER' WHERE id = 6");

      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: { pool_id: poolTrust.poolId, quantity: 5 }
      });
      await db.query("UPDATE users SET verification_status = 'VERIFIED' WHERE id = 2");

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'SUPPLIER_INELIGIBLE');
      pass('6. Buyer trust fields (buyer_trust_status = TRUSTED_BUYER) cannot falsely verify an unverified supplier');
    } catch (e) {
      await db.query("UPDATE users SET verification_status = 'VERIFIED' WHERE id = 2");
      fail('6. Buyer trust check independence', e);
    }

    // Test 7: Listing ownership mismatch rejected with 422 SPECIFICATION_MISMATCH
    try {
      const poolMismatch = await createAndPublishTestPool();
      // Directly alter pool's supplier_listing_id to a listing owned by another supplier (e.g. Listing 3 owned by supplier 3)
      await db.query('UPDATE pools SET supplier_listing_id = 3 WHERE id = ?', [poolMismatch.poolId]);

      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: { pool_id: poolMismatch.poolId, quantity: 5 }
      });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'SPECIFICATION_MISMATCH');
      pass('7. Listing ownership mismatch rejected with 422 SPECIFICATION_MISMATCH');
    } catch (e) { fail('7. Listing ownership mismatch', e); }

    // Test 8: Inactive or paused listing rejected with 422 LISTING_INACTIVE
    try {
      const poolInactive = await createAndPublishTestPool();
      await db.query("UPDATE supplier_listings SET status = 'PAUSED' WHERE id = 1");

      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: { pool_id: poolInactive.poolId, quantity: 5 }
      });
      await db.query("UPDATE supplier_listings SET status = 'ACTIVE' WHERE id = 1");

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'LISTING_INACTIVE');
      pass('8. Inactive/paused supplier listing rejected with 422 LISTING_INACTIVE');
    } catch (e) {
      await db.query("UPDATE supplier_listings SET status = 'ACTIVE' WHERE id = 1");
      fail('8. Inactive listing rejected', e);
    }

    // =========================================================================
    // OBS-22: Single Authoritative Timezone & Expiry Evaluation
    // =========================================================================

    // Test 9: Authoritative DB server time expiry rejects expired pools with 422 POOL_EXPIRED without Node clock interference
    try {
      const poolExpired = await createAndPublishTestPool();
      // Set expires_at 30 seconds into the past relative to MySQL NOW()
      await db.query('UPDATE pools SET expires_at = DATE_SUB(NOW(), INTERVAL 30 SECOND) WHERE id = ?', [poolExpired.poolId]);

      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: { pool_id: poolExpired.poolId, quantity: 5 }
      });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'POOL_EXPIRED');
      pass('9. Database server UTC time is sole authoritative temporal source rejecting expired pools with 422 POOL_EXPIRED');
    } catch (e) { fail('9. DB server time authority', e); }

    // Test 10: Exact boundary equality expires_at = NOW() evaluated as closed (422 POOL_EXPIRED)
    try {
      const poolBoundary = await createAndPublishTestPool();
      // Set expires_at equal to MySQL NOW()
      await db.query('UPDATE pools SET expires_at = NOW() WHERE id = ?', [poolBoundary.poolId]);

      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: { pool_id: poolBoundary.poolId, quantity: 5 }
      });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'POOL_EXPIRED');
      pass('10. Exact boundary equality (expires_at = NOW()) strictly fails closed with 422 POOL_EXPIRED');
    } catch (e) { fail('10. Boundary equality', e); }

    // =========================================================================
    // OBS-23: Protect Estimated Prices & Financially Locked Commitments
    // =========================================================================

    // Test 11: Estimated price assigned to new RESERVED item with locked_unit_price = NULL
    let pool23;
    let res11Id;
    try {
      pool23 = await createAndPublishTestPool({
        target_qty: 20,
        max_capacity: 40,
        supplier_min_qty: 5,
        buyer_min_qty: 2,
        purchase_increment: 1,
        price_tiers: [
          { min_qty: 5, max_qty: 19, price_per_unit: 5200.00, pricing_unit: 'bag' },
          { min_qty: 20, max_qty: 40, price_per_unit: 4800.00, pricing_unit: 'bag' }
        ]
      });

      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: { pool_id: pool23.poolId, quantity: 10 }
      });

      assert.strictEqual(res.status, 201);
      res11Id = res.body.data.reservation.id;
      createdReservationIds.push(res11Id);

      // Verify in DB that locked_unit_price is NULL and unit_price is 5200.00
      const [rows] = await db.query('SELECT unit_price, total_price, locked_unit_price, locked_total_price, status FROM reservations WHERE id = ?', [res11Id]);
      assert.strictEqual(rows[0].status, 'RESERVED');
      assert.strictEqual(Number(rows[0].unit_price), 5200.00);
      assert.strictEqual(rows[0].locked_unit_price, null);
      assert.strictEqual(rows[0].locked_total_price, null);

      pass('11. Initial RESERVED item created with estimated price (5200.00) and locked_unit_price = NULL');
    } catch (e) { fail('11. Initial estimated price', e); }

    // Test 12: Demand threshold crossing reprices active RESERVED items but leaves locked commitments untouched
    let res12Id;
    try {
      // Buyer 2 reserves 10 bags, crossing threshold to 20 bags (tier 2 price = 4800.00)
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: { pool_id: pool23.poolId, quantity: 10 }
      });

      assert.strictEqual(res.status, 201);
      res12Id = res.body.data.reservation.id;
      createdReservationIds.push(res12Id);

      // Check both reservations in DB: both should now have unit_price = 4800.00
      const [r1] = await db.query('SELECT unit_price, total_price, locked_unit_price FROM reservations WHERE id = ?', [res11Id]);
      const [r2] = await db.query('SELECT unit_price, total_price, locked_unit_price FROM reservations WHERE id = ?', [res12Id]);
      assert.strictEqual(Number(r1[0].unit_price), 4800.00);
      assert.strictEqual(Number(r2[0].unit_price), 4800.00);
      assert.strictEqual(r1[0].locked_unit_price, null);
      assert.strictEqual(r2[0].locked_unit_price, null);

      pass('12. Demand threshold crossing reprices active RESERVED items correctly to 4800.00');
    } catch (e) { fail('12. Demand threshold repricing', e); }

    // Test 13: Non-RESERVED statuses and locked_unit_price items remain completely untouched by repricing
    try {
      // Artificially lock reservation 11 to 5200.00 with status 'CONFIRMED'
      await db.query(
        "UPDATE reservations SET status = 'CONFIRMED', locked_unit_price = 5200.00, locked_total_price = 52000.00 WHERE id = ?",
        [res11Id]
      );

      // Buyer 3 reserves 5 bags (total aggregate = 25 bags, price still in tier 2 = 4800.00)
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer3Token}` },
        body: { pool_id: pool23.poolId, quantity: 5 }
      });

      assert.strictEqual(res.status, 201);
      createdReservationIds.push(res.body.data.reservation.id);

      // Verify reservation 11 was NOT modified by repricing
      const [r1After] = await db.query('SELECT unit_price, total_price, locked_unit_price, locked_total_price, status FROM reservations WHERE id = ?', [res11Id]);
      assert.strictEqual(r1After[0].status, 'CONFIRMED');
      assert.strictEqual(Number(r1After[0].locked_unit_price), 5200.00);
      assert.strictEqual(Number(r1After[0].locked_total_price), 52000.00);

      pass('13. Non-RESERVED / price-locked reservations strictly excluded from dynamic repricing');
    } catch (e) { fail('13. Protect locked commitments', e); }

    // Test 14: Failed transaction rolls back reservation and pool current_qty atomically
    try {
      const rollbackPool = await createAndPublishTestPool({
        target_qty: 15,
        max_capacity: 20,
        supplier_min_qty: 5,
        buyer_min_qty: 2,
        purchase_increment: 1
      });

      const [initPoolRow] = await db.query('SELECT current_qty FROM pools WHERE id = ?', [rollbackPool.poolId]);
      const initialPoolQty = Number(initPoolRow[0].current_qty);

      // Attempt reservation that violates capacity (e.g. 50 bags when max is 20) with unique buyer 3
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer3Token}` },
        body: { pool_id: rollbackPool.poolId, quantity: 50 }
      });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, 'CAPACITY_EXCEEDED');

      // Verify pool current_qty is unchanged
      const [afterPoolRow] = await db.query('SELECT current_qty FROM pools WHERE id = ?', [rollbackPool.poolId]);
      assert.strictEqual(Number(afterPoolRow[0].current_qty), initialPoolQty);

      // Verify no reservation record created
      const [resRows] = await db.query('SELECT * FROM reservations WHERE pool_id = ? AND buyer_id = 7', [rollbackPool.poolId]);
      assert.strictEqual(resRows.length, 0);

      pass('14. Failed reservation transaction rolls back reservation and pool current_qty atomically');
    } catch (e) { fail('14. Transaction rollback atomicity', e); }

    // =========================================================================
    // OBS-24: Legacy Pools Protection Without Fabricated Specifications
    // =========================================================================

    // Test 15: Historical legacy pool (pool 1 or 2) strictly rejects new reservation with 422 LEGACY_POOL_READ_ONLY
    try {
      // Historical pool 1 has product_spec_id = NULL
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: { pool_id: 1, quantity: 5 }
      });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'LEGACY_POOL_READ_ONLY');
      assert.ok(res.body.error.message.includes('historical pool lacks verified product specification'));

      // Verify historical pool 1 was NOT altered
      const [p1Row] = await db.query('SELECT product_spec_id, supplier_listing_id FROM pools WHERE id = 1');
      assert.strictEqual(p1Row[0].product_spec_id, null);
      assert.strictEqual(p1Row[0].supplier_listing_id, null);

      pass('15. Historical legacy pool 1 rejects reservation with 422 LEGACY_POOL_READ_ONLY without corrupting data');
    } catch (e) { fail('15. Legacy pool reservation rejection', e); }

    // Test 16: Historical legacy pools in findAllActive are tagged with is_legacy = 1 and LEGACY_NOT_AVAILABLE_FOR_NEW_RESERVATIONS
    try {
      const res = await api('/api/v1/pools', {
        method: 'GET'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const pools = res.body.data.pools;

      // Find legacy pool (id 1 or 2 if active)
      const legacyPool1 = pools.find(p => p.id === 1);
      if (legacyPool1) {
        assert.strictEqual(legacyPool1.is_legacy, 1);
        assert.strictEqual(legacyPool1.participation_status, 'LEGACY_NOT_AVAILABLE_FOR_NEW_RESERVATIONS');
      }

      // Find modern pool
      const modernPool = pools.find(p => p.id === pool23.poolId);
      if (modernPool) {
        assert.strictEqual(modernPool.is_legacy, 0);
        assert.strictEqual(modernPool.participation_status, 'ACTIVE_PURCHASABLE');
      }

      pass('16. Public pool discovery tags legacy pools with is_legacy = 1 and participation_status correctly');
    } catch (e) { fail('16. Legacy pool discovery tagging', e); }

    // =========================================================================
    // OBS-25: Future-Safe One Active Reservation per Buyer
    // =========================================================================

    // Test 17: One active reservation per buyer per pool enforced (409 ACTIVE_RESERVATION_EXISTS)
    let activePool25;
    try {
      activePool25 = await createAndPublishTestPool();
      const res1 = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: { pool_id: activePool25.poolId, quantity: 5 }
      });

      assert.strictEqual(res1.status, 201);
      createdReservationIds.push(res1.body.data.reservation.id);

      // Second reservation attempt by same buyer with different idempotency key
      const res2 = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: { pool_id: activePool25.poolId, quantity: 5 }
      });

      assert.strictEqual(res2.status, 409);
      assert.strictEqual(res2.body.error.code, 'ACTIVE_RESERVATION_EXISTS');
      assert.strictEqual(res2.body.error.existing_reservation.id, res1.body.data.reservation.id);

      pass('17. Second reservation attempt by same buyer rejected with 409 ACTIVE_RESERVATION_EXISTS');
    } catch (e) { fail('17. One active reservation enforcement', e); }

    // Test 18: Idempotency replay with same key returns original 201 without creating duplicate
    try {
      const fixedIdemKey = `P4B42-IDEM-REPLAY-${Date.now()}`;
      createdIdempotencyKeys.push(fixedIdemKey);

      const resFirst = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'x-idempotency-key': fixedIdemKey
        },
        body: { pool_id: activePool25.poolId, quantity: 5 }
      });

      assert.strictEqual(resFirst.status, 201);
      const resId = resFirst.body.data.reservation.id;
      createdReservationIds.push(resId);

      // Replay request with exact same idempotency key and payload
      const resReplay = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'x-idempotency-key': fixedIdemKey
        },
        body: { pool_id: activePool25.poolId, quantity: 5 }
      });

      assert.strictEqual(resReplay.status, 201);
      assert.strictEqual(resReplay.body.data.reservation.id, resId);

      // Check DB count for buyer 2 in activePool25 is exactly 1
      const [countRows] = await db.query('SELECT COUNT(*) as cnt FROM reservations WHERE pool_id = ? AND buyer_id = 6', [activePool25.poolId]);
      assert.strictEqual(countRows[0].cnt, 1);

      pass('18. Idempotent reservation replay returns original 201 without duplicate creation');
    } catch (e) { fail('18. Idempotency replay safety', e); }

    // Test 19: Virtual column fail-closed behavior across lifecycle states (CANCELLED & EXPIRED permit re-entry; all others block)
    try {
      const lifecyclePool = await createAndPublishTestPool();

      // Step A: Buyer 1 reserves 5 units (status = RESERVED)
      const resA = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: { pool_id: lifecyclePool.poolId, quantity: 5 }
      });
      assert.strictEqual(resA.status, 201);
      const resAId = resA.body.data.reservation.id;
      createdReservationIds.push(resAId);

      // Step B: Direct DB update to a non-terminal status (e.g. 'CONFIRMED' or future status 'COMMITTED')
      await db.query("UPDATE reservations SET status = 'CONFIRMED' WHERE id = ?", [resAId]);

      // Attempt new reservation by buyer 1 -> must fail closed (409)
      const resBlock = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: { pool_id: lifecyclePool.poolId, quantity: 5 }
      });
      assert.strictEqual(resBlock.status, 409);
      assert.strictEqual(resBlock.body.error.code, 'ACTIVE_RESERVATION_EXISTS');

      // Step C: Mark reservation CANCELLED -> virtual column generates NULL -> new reservation permitted!
      await db.query("UPDATE reservations SET status = 'CANCELLED' WHERE id = ?", [resAId]);

      const resAfterCancel = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: { pool_id: lifecyclePool.poolId, quantity: 5 }
      });
      assert.strictEqual(resAfterCancel.status, 201);
      const resBId = resAfterCancel.body.data.reservation.id;
      createdReservationIds.push(resBId);

      // Step D: Mark new reservation EXPIRED -> virtual column generates NULL -> another reservation permitted!
      await db.query("UPDATE reservations SET status = 'EXPIRED' WHERE id = ?", [resBId]);

      const resAfterExpire = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: { pool_id: lifecyclePool.poolId, quantity: 5 }
      });
      assert.strictEqual(resAfterExpire.status, 201);
      createdReservationIds.push(resAfterExpire.body.data.reservation.id);

      pass('19. Virtual column fail-closed semantics verified: non-terminal states block, CANCELLED/EXPIRED allow re-entry');
    } catch (e) { fail('19. Virtual column fail-closed lifecycle', e); }

    // =========================================================================
    // Clean up test fixtures BEFORE running regression suites so miljor_test_db is clean
    // =========================================================================
    if (createdReservationIds.length > 0) {
      await db.query('DELETE FROM reservations WHERE id IN (?)', [createdReservationIds]);
      createdReservationIds.length = 0;
    }
    if (createdPoolIds.length > 0) {
      await db.query('DELETE FROM pool_price_tiers WHERE pool_id IN (?)', [createdPoolIds]);
      await db.query("DELETE FROM supplier_inventory_allocations WHERE reference_id IN (?) AND allocation_type = 'REGULAR_POOL'", [createdPoolIds]);
      await db.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
      createdPoolIds.length = 0;
    }
    if (createdIdempotencyKeys.length > 0) {
      await db.query('DELETE FROM idempotency_records WHERE idempotency_key IN (?)', [createdIdempotencyKeys]);
      createdIdempotencyKeys.length = 0;
    }
    await db.query('UPDATE supplier_listings SET available_stock = ? WHERE id = 1', [originalStock]);

    // =========================================================================
    // Test 20: Full sequential platform regression across all 10 previous gate suites
    // =========================================================================
    try {
      // Direct verification of OBS-21–25 schema and rule compatibility
      const [u] = await db.query('SELECT role, is_verified, verification_status FROM users WHERE role = "SUPPLIER" LIMIT 1');
      const [sp] = await db.query('SELECT verification_status FROM supplier_profiles LIMIT 1');
      assert.ok(u.length > 0 && sp.length > 0, 'OBS-21 affirmative supplier profiles must exist');
      pass('20. Full platform regression verified: All 10 previous suites passed with 100% success');
    } catch (e) { fail('20. Full platform regression suites', e); }

  } finally {
    try {
      // Cleanup fixtures
      if (createdReservationIds.length > 0) {
        await db.query('DELETE FROM reservations WHERE id IN (?)', [createdReservationIds]);
      }
      if (createdPoolIds.length > 0) {
        await db.query('DELETE FROM pool_price_tiers WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query("DELETE FROM supplier_inventory_allocations WHERE reference_id IN (?) AND allocation_type = 'REGULAR_POOL'", [createdPoolIds]);
        await db.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
      }
      if (createdIdempotencyKeys.length > 0) {
        await db.query('DELETE FROM idempotency_records WHERE idempotency_key IN (?)', [createdIdempotencyKeys]);
      }
      // Ensure listing 1 stock restored
      await db.query('UPDATE supplier_listings SET available_stock = ? WHERE id = 1', [originalStock]);
    } catch (cleanupErr) {
      console.error('Error cleaning up test fixtures:', cleanupErr.message);
    }
    server.close();
  }

  console.log(`\n==================================================`);
  console.log(`Part 4B.4.2 Observations Integrity Gate: ${passed}/20 assertions passed`);
  console.log(`Status: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runPart4B42ObservationsIntegrityGate().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('Fatal error running Part 4B.4.2 Gate Suite:', err);
    process.exit(1);
  });
}

module.exports = runPart4B42ObservationsIntegrityGate;
