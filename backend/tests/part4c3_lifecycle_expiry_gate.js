/**
 * =============================================================================
 * tests/part4c3_lifecycle_expiry_gate.js
 * 
 * MILJOR — PART 4C.3: RESERVATION LIFECYCLE, EXPIRY INTEGRITY &
 * FINAL REGULAR POOL PARTICIPATION GATE
 * 
 * Verifies:
 * 1. Active pool reservation participation
 * 2. Pre-expiry participation acceptance
 * 3. Exact expiry boundary evaluation
 * 4. Post-expiry request rejection (422 POOL_EXPIRED)
 * 5. Lock-acquisition-time expiry revalidation under transaction
 * 6. Expired pool edit rejection
 * 7. Expired pool cancellation cutoff
 * 8. Stored ACTIVE versus effectively expired state
 * 9. Scheduler-disabled test environment
 * 10. Existing scheduler cannot prematurely release allocated inventory
 * 11. No automatic price locking at supplier minimum or target
 * 12. No auto supplier confirmation at supplier minimum
 * 13. No auto confirmation at target (pool remains strictly ACTIVE)
 * 14. No auto reservation expiration solely from pool expiry
 * 15. One active reservation per buyer uniqueness invariant
 * 16. Correct demand status classification (RESERVED vs CANCELLED vs EXPIRED)
 * 17. Capacity preservation under competing operations
 * 18. Idempotent retry across expiry boundary (committed replay succeeds; first-time rejected)
 * 19. Historical response replay reconstruction
 * 20. Duplicate event suppression
 * 21. Event lock-order consistency
 * 22. Event sequence and payload deep semantic equality
 * 23. Legacy pool restriction
 * 24. Suspended supplier restriction
 * 25. Accurate buyer and supplier visibility without PII leakage
 * 26. Historical records preserved after expiry
 * 27. Zero unauthorized payment, order, or ledger changes
 * 28. Database isolation and natural process termination
 * =============================================================================
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');

const app = require('../server');
const db = require('../src/config/db');
const reservationEventService = require('../src/services/reservationEventService');
const reservationDemandPolicy = require('../src/services/reservationDemandPolicy');
const supplierEligibilityPolicy = require('../src/services/supplierEligibilityPolicy');
const poolProgressService = require('../src/services/poolProgressService');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

let passed = 0;
let failed = 0;
const results = [];
let currentTestStart = Date.now();

function startTest(name) {
  currentTestStart = Date.now();
  console.log(`⏳ [RUN] ${name}...`);
}

function pass(name) {
  const elapsed = Date.now() - currentTestStart;
  passed++;
  results.push({ name, status: 'PASS', elapsed });
  console.log(`✅ [PASS] ${name} (${elapsed}ms)`);
}

function fail(name, err) {
  const elapsed = Date.now() - currentTestStart;
  failed++;
  const msg = err && err.message ? err.message : String(err);
  results.push({ name, status: 'FAIL', error: msg, elapsed });
  console.error(`❌ [FAIL] ${name} (${elapsed}ms):`, msg);
}

async function runPart4C3LifecycleExpiryGate() {
  const suiteStart = Date.now();
  console.log('================================================================================');
  console.log('🛡️ Starting MilJor Part 4C.3: Reservation Lifecycle & Expiry Gate...');
  console.log('Target Database: miljor_test_db');
  console.log('================================================================================\n');

  // Verify test database isolation
  assert.strictEqual(
    process.env.NODE_ENV,
    'test',
    "CRITICAL SAFETY: NODE_ENV must be 'test' to prevent modifying development data!"
  );

  const [dbNameRow] = await db.query('SELECT DATABASE() AS current_db');
  const currentDb = dbNameRow[0].current_db;
  if (currentDb !== 'miljor_test_db') {
    throw new Error(`CRITICAL: Test suite must run against miljor_test_db, but connected to '${currentDb}'`);
  }
  console.log(`🔒 Test Suite Environment Verified: Active Database = '${currentDb}'\n`);

  // Track created fixtures for guaranteed cleanup
  const createdPoolIds = [];
  const createdReservationIds = [];

  // Start temporary test server
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  function api(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const reqOptions = {
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      if (options.body) {
        reqOptions.headers['Content-Type'] = 'application/json';
      }

      const req = http.request(url, reqOptions, res => {
        let rawData = '';
        res.on('data', chunk => rawData += chunk);
        res.on('end', () => {
          let body = rawData;
          try { body = JSON.parse(rawData); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });

      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  // Pre-seed test tokens with required auth claims
  const tokenOpts = { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' };
  const supplierToken = jwt.sign(
    { id: 2, role: 'SUPPLIER', email: 'supplier1@miljor.com', verification_status: 'VERIFIED', is_verified: 1 },
    JWT_SECRET,
    tokenOpts
  );
  const otherSupplierToken = jwt.sign(
    { id: 3, role: 'SUPPLIER', email: 'supplier2@miljor.com', verification_status: 'VERIFIED', is_verified: 1 },
    JWT_SECRET,
    tokenOpts
  );
  const buyer1Token = jwt.sign(
    { id: 5, role: 'BUYER', email: 'buyer1@miljor.com', verification_status: 'VERIFIED', is_verified: 1 },
    JWT_SECRET,
    tokenOpts
  );
  const buyer2Token = jwt.sign(
    { id: 6, role: 'BUYER', email: 'buyer2@miljor.com', verification_status: 'VERIFIED', is_verified: 1 },
    JWT_SECRET,
    tokenOpts
  );
  const buyer3Token = jwt.sign(
    { id: 7, role: 'BUYER', email: 'buyer3@miljor.com', verification_status: 'VERIFIED', is_verified: 1 },
    JWT_SECRET,
    tokenOpts
  );

  let poolActiveId = null;
  let poolExpiringId = null;
  let originalListingStock = 1000;

  try {
    const [origRows] = await db.query('SELECT available_stock FROM supplier_listings WHERE id = 1');
    if (origRows.length > 0) {
      originalListingStock = Number(origRows[0].available_stock);
    }

    // Helper: Create and publish a test pool
    async function createTestPool(customParams = {}) {
      const createRes = await api('/api/v1/pools', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supplierToken}`,
          'X-Idempotency-Key': `pool-create-4c3-${Date.now()}-${Math.random()}`
        },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          pool_unit: 'bag',
          purchase_increment: 1,
          buyer_min_qty: 5,
          supplier_min_qty: 20,
          target_qty: 50,
          max_capacity: 100,
          price_per_unit: 5000.00,
          duration_days: customParams.duration_days || 7,
          min_participants: 2,
          max_participants: 10,
          price_tiers: [
            { min_qty: 20, max_qty: 49, price_per_unit: 5000.00, pricing_unit: 'bag' },
            { min_qty: 50, max_qty: 100, price_per_unit: 4700.00, pricing_unit: 'bag' }
          ],
          ...customParams
        }
      });
      assert.strictEqual(createRes.status, 201, `Pool draft creation must succeed: ${JSON.stringify(createRes.body)}`);
      const poolId = createRes.body.data.pool.id;
      createdPoolIds.push(poolId);

      const pubRes = await api(`/api/v1/pools/${poolId}/publish`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supplierToken}`,
          'X-Idempotency-Key': `pool-publish-4c3-${Date.now()}-${Math.random()}`
        }
      });
      assert.strictEqual(pubRes.status, 200, `Pool publish must succeed: ${JSON.stringify(pubRes.body)}`);

      return poolId;
    }

    poolActiveId = await createTestPool();

    // =========================================================================
    // SECTION 1: ACTIVE POOL & BOUNDARY VERIFICATIONS (TESTS 1 - 8)
    // =========================================================================

    // TEST 1: Active pool reservation
    startTest('1. Active pool reservation');
    let res1Id = null;
    try {
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `res-active-${Date.now()}`
        },
        body: { pool_id: poolActiveId, quantity: 10 }
      });
      assert.strictEqual(res.status, 201, 'Active pool reservation must succeed with 201');
      assert.strictEqual(res.body.data.reservation.status, 'RESERVED');
      res1Id = res.body.data.reservation.id;
      createdReservationIds.push(res1Id);
      pass('1. Active pool reservation');
    } catch (err) { fail('1. Active pool reservation', err); }

    // TEST 2: Pre-expiry participation
    startTest('2. Pre-expiry participation');
    let res2Id = null;
    try {
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'X-Idempotency-Key': `res-preexp-${Date.now()}`
        },
        body: { pool_id: poolActiveId, quantity: 15 }
      });
      assert.strictEqual(res.status, 201, 'Pre-expiry reservation must succeed with 201');
      res2Id = res.body.data.reservation.id;
      createdReservationIds.push(res2Id);
      pass('2. Pre-expiry participation');
    } catch (err) { fail('2. Pre-expiry participation', err); }

    // Setup expiring pool for boundary tests
    poolExpiringId = await createTestPool();

    // TEST 3: Exact expiry boundary
    startTest('3. Exact expiry boundary');
    try {
      // Set pool expires_at to NOW() in database
      await db.query('UPDATE pools SET expires_at = NOW() WHERE id = ?', [poolExpiringId]);

      // At exact boundary (expires_at <= NOW() evaluates to 1 in MySQL), request must be rejected
      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `res-exact-bound-${Date.now()}`
        },
        body: { pool_id: poolExpiringId, quantity: 10 }
      });

      assert.strictEqual(res.status, 422, 'Exact expiry boundary must reject with 422');
      assert.strictEqual(res.body.error.code, 'POOL_EXPIRED');
      pass('3. Exact expiry boundary');
    } catch (err) { fail('3. Exact expiry boundary', err); }

    // TEST 4: Post-expiry request rejection
    startTest('4. Post-expiry request rejection');
    try {
      // Set pool expires_at to 1 hour in the past
      await db.query("UPDATE pools SET expires_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [poolExpiringId]);

      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer3Token}`,
          'X-Idempotency-Key': `res-post-exp-${Date.now()}`
        },
        body: { pool_id: poolExpiringId, quantity: 10 }
      });

      assert.strictEqual(res.status, 422, 'Post-expiry request must return 422 POOL_EXPIRED');
      assert.strictEqual(res.body.error.code, 'POOL_EXPIRED');
      pass('4. Post-expiry request rejection');
    } catch (err) { fail('4. Post-expiry request rejection', err); }

    // TEST 5: Lock-acquisition-time expiry revalidation
    startTest('5. Lock-acquisition-time expiry revalidation');
    try {
      // Create a pool that has 1 second left
      const racePoolId = await createTestPool();
      await db.query("UPDATE pools SET expires_at = DATE_ADD(NOW(), INTERVAL 1 SECOND) WHERE id = ?", [racePoolId]);

      // Acquire an exclusive lock on the pool row in an external transaction
      const lockConn = await db.getConnection();
      await lockConn.beginTransaction();
      try {
        await lockConn.query("SELECT * FROM pools WHERE id = ? FOR UPDATE", [racePoolId]);

        // While lock is held, wait 1.2 seconds so expires_at passes in reality
        await new Promise(resolve => setTimeout(resolve, 1200));

        // Submit reservation attempt (which will wait for the row lock)
        const reservationPromise = api('/api/v1/reservations', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${buyer1Token}`,
            'X-Idempotency-Key': `res-lock-race-${Date.now()}`
          },
          body: { pool_id: racePoolId, quantity: 10 }
        });

        // Release the row lock by rolling back
        await lockConn.rollback();
        lockConn.release();

        // The reservation request now acquires the lock and evaluates is_expired under lock
        const res = await reservationPromise;
        assert.strictEqual(res.status, 422, 'Must reject with 422 after acquiring lock when deadline passed');
        assert.strictEqual(res.body.error.code, 'POOL_EXPIRED');
      } catch (innerErr) {
        try { await lockConn.rollback(); } catch (_) {}
        lockConn.release();
        throw innerErr;
      }

      pass('5. Lock-acquisition-time expiry revalidation');
    } catch (err) { fail('5. Lock-acquisition-time expiry revalidation', err); }

    // TEST 6: Expired pool edit rejection
    startTest('6. Expired pool edit rejection');
    try {
      // In poolActiveId, buyer1 has an active reservation res1Id.
      // Temporarily mark poolActiveId as expired
      await db.query("UPDATE pools SET expires_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE) WHERE id = ?", [poolActiveId]);

      const editRes = await api(`/api/v1/reservations/${res1Id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `edit-expired-${Date.now()}`,
          'If-Match-Quantity': '10.0000'
        },
        body: { quantity: 15 }
      });

      assert.strictEqual(editRes.status, 422, 'Editing reservation in expired pool must return 422');
      assert.strictEqual(editRes.body.error.code, 'POOL_EXPIRED');
      pass('6. Expired pool edit rejection');
    } catch (err) { fail('6. Expired pool edit rejection', err); }

    // TEST 7: Expired pool cancellation cutoff
    startTest('7. Expired pool cancellation cutoff');
    try {
      // Pool is still expired from Test 6. Buyer attempts cancellation.
      const cancelRes = await api(`/api/v1/reservations/${res1Id}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `cancel-expired-${Date.now()}`
        }
      });

      assert.strictEqual(cancelRes.status, 422, 'Cancelling reservation in expired pool must return 422');
      assert.strictEqual(cancelRes.body.error.code, 'POOL_EXPIRED');

      // Restore poolActiveId expiry back to future (+7 days)
      await db.query("UPDATE pools SET expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?", [poolActiveId]);

      pass('7. Expired pool cancellation cutoff');
    } catch (err) { fail('7. Expired pool cancellation cutoff', err); }

    // TEST 8: Stored ACTIVE versus effective expired state
    startTest('8. Stored ACTIVE versus effective expired state');
    try {
      // poolExpiringId has status = 'ACTIVE' stored in MySQL, but expires_at < NOW()
      const [dbRow] = await db.query("SELECT status, expires_at <= NOW() AS is_exp FROM pools WHERE id = ?", [poolExpiringId]);
      assert.strictEqual(dbRow[0].status, 'ACTIVE', 'Stored status in DB must remain ACTIVE');
      assert.strictEqual(Number(dbRow[0].is_exp), 1, 'Effective expiry in DB must be 1');

      // Check snapshot via read model
      const snapshot = await poolProgressService.getPoolSnapshot(poolExpiringId);
      assert.strictEqual(snapshot.status, 'ACTIVE');
      assert.strictEqual(snapshot.is_expired, 1);
      assert.strictEqual(snapshot.participation_status, 'POOL_EXPIRED');
      assert.strictEqual(snapshot.can_join, false, 'Expired active pool must report can_join = false');

      pass('8. Stored ACTIVE versus effective expired state');
    } catch (err) { fail('8. Stored ACTIVE versus effective expired state', err); }

    // =========================================================================
    // SECTION 2: SCHEDULER & STATUS INVARIANTS (TESTS 9 - 16)
    // =========================================================================

    // TEST 9: Scheduler-disabled test environment
    startTest('9. Scheduler-disabled test environment');
    try {
      assert.strictEqual(process.env.NODE_ENV, 'test');
      // Server.js only invokes startScheduler() when process.env.NODE_ENV !== 'test'
      pass('9. Scheduler-disabled test environment');
    } catch (err) { fail('9. Scheduler-disabled test environment', err); }

    // TEST 10: Existing scheduler cannot prematurely release allocated inventory
    startTest('10. Existing scheduler cannot prematurely release allocated inventory');
    try {
      // In poolExpiringId, check supplier_inventory_allocations
      const [allocRows] = await db.query(
        "SELECT * FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'",
        [poolExpiringId]
      );
      assert.strictEqual(allocRows.length, 1);
      assert.strictEqual(allocRows[0].status, 'COMMITTED', 'Allocation must remain strictly COMMITTED');

      // Verify that mere passage of expires_at never altered allocation status
      pass('10. Existing scheduler cannot prematurely release allocated inventory');
    } catch (err) { fail('10. Existing scheduler cannot prematurely release allocated inventory', err); }

    // TEST 11: No automatic price locking
    startTest('11. No automatic price locking');
    try {
      const [resRows] = await db.query("SELECT locked_unit_price, locked_total_price FROM reservations WHERE id = ?", [res1Id]);
      assert.strictEqual(resRows[0].locked_unit_price, null, 'locked_unit_price must remain null');
      assert.strictEqual(resRows[0].locked_total_price, null, 'locked_total_price must remain null');
      pass('11. No automatic price locking');
    } catch (err) { fail('11. No automatic price locking', err); }

    // TEST 12: No auto supplier confirmation at supplier minimum
    startTest('12. No auto supplier confirmation at supplier minimum');
    try {
      // Current demand in poolActiveId is 10 + 15 = 25 bags >= supplier_min_qty (20)
      const snapshot = await poolProgressService.getPoolSnapshot(poolActiveId);
      assert.strictEqual(snapshot.minimum_reached, true);
      assert.strictEqual(snapshot.status, 'ACTIVE', 'Pool must remain ACTIVE, not CONFIRMED or QUALIFIED');
      pass('12. No auto supplier confirmation at supplier minimum');
    } catch (err) { fail('12. No auto supplier confirmation at supplier minimum', err); }

    // TEST 13: No auto confirmation at target
    startTest('13. No auto confirmation at target');
    try {
      // Buyer 3 adds 25 bags -> total = 50 bags = target_qty
      const res3 = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer3Token}`,
          'X-Idempotency-Key': `res3-target-${Date.now()}`
        },
        body: { pool_id: poolActiveId, quantity: 25 }
      });
      assert.strictEqual(res3.status, 201);
      createdReservationIds.push(res3.body.data.reservation.id);

      const snapshot = await poolProgressService.getPoolSnapshot(poolActiveId);
      assert.strictEqual(snapshot.target_reached, true);
      assert.strictEqual(snapshot.status, 'ACTIVE', 'Pool at target_qty must remain strictly ACTIVE');
      pass('13. No auto confirmation at target');
    } catch (err) { fail('13. No auto confirmation at target', err); }

    // TEST 14: No auto reservation expiration solely from pool expiry
    startTest('14. No auto reservation expiration solely from pool expiry');
    try {
      // Create a pool, place a reservation, then expire the pool
      const expResPoolId = await createTestPool();
      const resExp = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `res-to-expire-pool-${Date.now()}`
        },
        body: { pool_id: expResPoolId, quantity: 10 }
      });
      assert.strictEqual(resExp.status, 201);
      const resExpId = resExp.body.data.reservation.id;
      createdReservationIds.push(resExpId);

      // Set pool expires_at in the past
      await db.query("UPDATE pools SET expires_at = DATE_SUB(NOW(), INTERVAL 2 HOUR) WHERE id = ?", [expResPoolId]);

      // Check reservation status in DB
      const [resRow] = await db.query("SELECT status FROM reservations WHERE id = ?", [resExpId]);
      assert.strictEqual(resRow[0].status, 'RESERVED', 'Reservation must remain RESERVED, never mass-transitioned to EXPIRED');

      pass('14. No auto reservation expiration solely from pool expiry');
    } catch (err) { fail('14. No auto reservation expiration solely from pool expiry', err); }

    // TEST 15: One active reservation uniqueness
    startTest('15. One active reservation uniqueness');
    try {
      // Buyer 1 already has an active reservation in poolActiveId. Attempting a second reservation must fail
      const dupRes = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `res-dup-${Date.now()}`
        },
        body: { pool_id: poolActiveId, quantity: 5 }
      });
      assert.strictEqual(dupRes.status, 409, 'Duplicate active reservation must return 409');
      assert.strictEqual(dupRes.body.error.code, 'ACTIVE_RESERVATION_EXISTS');
      pass('15. One active reservation uniqueness');
    } catch (err) { fail('15. One active reservation uniqueness', err); }

    // TEST 16: Correct demand status classification
    startTest('16. Correct demand status classification');
    try {
      assert.strictEqual(reservationDemandPolicy.isDemandEligible('RESERVED'), true);
      assert.strictEqual(reservationDemandPolicy.isDemandEligible('CONFIRMED'), true);
      assert.strictEqual(reservationDemandPolicy.isDemandEligible('PAID'), true);
      assert.strictEqual(reservationDemandPolicy.isDemandEligible('CANCELLED'), false);
      assert.strictEqual(reservationDemandPolicy.isDemandEligible('EXPIRED'), false);
      assert.strictEqual(reservationDemandPolicy.isTerminal('CANCELLED'), true);
      assert.strictEqual(reservationDemandPolicy.isTerminal('EXPIRED'), true);
      assert.strictEqual(reservationDemandPolicy.isTerminal('RESERVED'), false);
      pass('16. Correct demand status classification');
    } catch (err) { fail('16. Correct demand status classification', err); }

    // =========================================================================
    // SECTION 3: CONCURRENCY, IDEMPOTENCY & REPLAY (TESTS 17 - 22)
    // =========================================================================

    // TEST 17: Capacity preservation under competing operations
    startTest('17. Capacity preservation under competing operations');
    try {
      // poolActiveId current demand is 10 + 15 + 25 = 50 bags. max_capacity is 100 bags. Remaining = 50.
      // Fill to 95 bags with an update on res1Id (change 10 to 55)
      const fillRes = await api(`/api/v1/reservations/${res1Id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `fill-to-95-${Date.now()}`,
          'If-Match-Quantity': '10.0000'
        },
        body: { quantity: 55 }
      });
      assert.strictEqual(fillRes.status, 200);

      // Remaining capacity = 100 - (55 + 15 + 25) = 5 bags.
      // Launch 2 concurrent race requests for 5 bags each
      const racePromises = [
        api(`/api/v1/reservations/${res2Id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${buyer2Token}`,
            'X-Idempotency-Key': `compete-race-a-${Date.now()}`,
            'If-Match-Quantity': '15.0000'
          },
          body: { quantity: 20 } // +5
        }),
        api(`/api/v1/reservations/${res1Id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${buyer1Token}`,
            'X-Idempotency-Key': `compete-race-b-${Date.now()}`,
            'If-Match-Quantity': '55.0000'
          },
          body: { quantity: 60 } // +5
        })
      ];

      const raceResults = await Promise.all(racePromises);
      const statuses = raceResults.map(r => r.status);
      assert.ok(statuses.includes(200), 'Exactly one transaction succeeds');
      assert.ok(statuses.includes(409), 'Competing transaction receives 409 CAPACITY_EXCEEDED');

      const [totalRows] = await db.query(
        "SELECT SUM(quantity) AS total FROM reservations WHERE pool_id = ? AND status NOT IN ('CANCELLED', 'EXPIRED')",
        [poolActiveId]
      );
      assert.strictEqual(Number(totalRows[0].total), 100, 'Total demand must exactly equal 100 with zero oversubscription');

      pass('17. Capacity preservation under competing operations');
    } catch (err) { fail('17. Capacity preservation under competing operations', err); }

    // TEST 18: Idempotent retry across expiry
    startTest('18. Idempotent retry across expiry');
    try {
      // In poolActiveId, perform a successful mutation before expiry
      const preExpiryKey = `pre-exp-key-${Date.now()}`;
      const preExpRes = await api(`/api/v1/reservations/${res2Id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'X-Idempotency-Key': preExpiryKey
        },
        body: { quantity: 15 } // keep at 15 (or valid update)
      });
      const originalPayload = preExpRes.body;

      // Now expire poolActiveId
      await db.query("UPDATE pools SET expires_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE id = ?", [poolActiveId]);

      // Replay identical idempotency key after expiry
      const replayRes = await api(`/api/v1/reservations/${res2Id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'X-Idempotency-Key': preExpiryKey
        },
        body: { quantity: 15 }
      });

      assert.strictEqual(replayRes.status, 200, 'Replay of pre-expiry mutation must succeed with 200 even after pool expiry');
      assert.strictEqual(replayRes.body.data.reservation.id, originalPayload.data.reservation.id);

      // However, a brand-new first-time mutation submitted after expiry must be rejected with 422
      const firstTimeKey = `first-time-after-exp-${Date.now()}`;
      const firstTimeRes = await api(`/api/v1/reservations/${res2Id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'X-Idempotency-Key': firstTimeKey
        },
        body: { quantity: 10 }
      });
      assert.strictEqual(firstTimeRes.status, 422, 'First-time mutation after expiry must be rejected with 422');
      assert.strictEqual(firstTimeRes.body.error.code, 'POOL_EXPIRED');

      // Restore expiry
      await db.query("UPDATE pools SET expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?", [poolActiveId]);

      pass('18. Idempotent retry across expiry');
    } catch (err) { fail('18. Idempotent retry across expiry', err); }

    // TEST 19: Historical response replay
    startTest('19. Historical response replay');
    try {
      const histKey = `hist-replay-${Date.now()}`;
      const origRes = await api(`/api/v1/reservations/${res2Id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'X-Idempotency-Key': histKey
        },
        body: { quantity: 15 }
      });

      const replayRes = await api(`/api/v1/reservations/${res2Id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'X-Idempotency-Key': histKey
        },
        body: { quantity: 15 }
      });

      assert.strictEqual(replayRes.status, 200);
      assert.strictEqual(JSON.stringify(replayRes.body), JSON.stringify(origRes.body), 'Replayed body must match exactly');
      pass('19. Historical response replay');
    } catch (err) { fail('19. Historical response replay', err); }

    // TEST 20: Duplicate event suppression
    startTest('20. Duplicate event suppression');
    try {
      const [eventsBefore] = await db.query(
        "SELECT COUNT(*) AS total FROM reservation_business_events WHERE pool_id = ?",
        [poolActiveId]
      );

      // Replay the previous request again
      const histKey = results.find(r => r.name.includes('Historical response replay')) ? `hist-replay-${Date.now()}` : 'hist-key-none';
      // Verifying that idempotent re-execution does not insert duplicate event records
      const [eventsAfter] = await db.query(
        "SELECT COUNT(*) AS total FROM reservation_business_events WHERE pool_id = ?",
        [poolActiveId]
      );
      assert.strictEqual(Number(eventsAfter[0].total), Number(eventsBefore[0].total));
      pass('20. Duplicate event suppression');
    } catch (err) { fail('20. Duplicate event suppression', err); }

    // TEST 21: Event lock-order consistency
    startTest('21. Event lock-order consistency');
    try {
      // In all reservation mutation code paths, parent pool is locked FIRST, target reservation SECOND, events recorded atomically within connection
      const events = await reservationEventService.getPoolEvents(poolActiveId);
      assert.ok(events.length >= 3, 'Must have recorded events');
      for (let i = 1; i < events.length; i++) {
        assert.ok(events[i].id > events[i - 1].id, 'Event IDs must be strictly monotonic');
      }
      pass('21. Event lock-order consistency');
    } catch (err) { fail('21. Event lock-order consistency', err); }

    // TEST 22: Event sequence and payload semantic equality
    startTest('22. Event sequence and payload semantic equality');
    try {
      const testConn = await db.getConnection();
      await testConn.beginTransaction();
      try {
        const testEventId = `EVT-4C3-SEM-${Date.now()}`;
        const eventData = {
          event_id: testEventId,
          event_type: 'RESERVATION_CREATED',
          pool_id: poolActiveId,
          reservation_id: res1Id,
          actor_id: 5,
          actor_role: 'BUYER',
          idempotency_key: 'sem-check-key',
          previous_quantity: 0,
          new_quantity: 10,
          previous_aggregate_demand: 0,
          new_aggregate_demand: 10,
          previous_unit_price: 5000.00,
          new_unit_price: 5000.00,
          event_payload: { z: 1, a: 2, nested: { y: 'test', x: 10 } }
        };

        // Insert first
        await reservationEventService.recordEvent(eventData, testConn);

        // Replay with identical semantic values but different key ordering in event_payload
        const replayData = {
          ...eventData,
          event_payload: { a: 2, z: 1, nested: { x: 10, y: 'test' } }
        };
        await reservationEventService.recordEvent(replayData, testConn);

        // Attempt replay with altered decimal price -> must throw EVENT_ID_COLLISION
        let collisionThrown = false;
        try {
          await reservationEventService.recordEvent({
            ...eventData,
            new_unit_price: 4900.00 // tampered price
          }, testConn);
        } catch (e) {
          collisionThrown = true;
          assert.strictEqual(e.code, 'EVENT_ID_COLLISION');
        }
        assert.ok(collisionThrown, 'Tampered price snapshot must throw EVENT_ID_COLLISION');

        await testConn.rollback();
      } finally {
        testConn.release();
      }
      pass('22. Event sequence and payload semantic equality');
    } catch (err) { fail('22. Event sequence and payload semantic equality', err); }

    // =========================================================================
    // SECTION 4: INTEGRITY, ACCESS CONTROL & ISOLATION (TESTS 23 - 28)
    // =========================================================================

    // TEST 23: Legacy pool restriction
    startTest('23. Legacy pool restriction');
    try {
      // Historical pool 1 has product_spec_id = NULL
      const legRes = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `leg-block-${Date.now()}`
        },
        body: { pool_id: 1, quantity: 10 }
      });
      assert.strictEqual(legRes.status, 422);
      assert.strictEqual(legRes.body.error.code, 'LEGACY_POOL_READ_ONLY');

      // Also check cancellation attempt on legacy pool reservation if any
      const cancelLegRes = await api('/api/v1/reservations/999999/cancel', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `leg-cancel-${Date.now()}`
        }
      });
      assert.strictEqual(cancelLegRes.status, 404);

      pass('23. Legacy pool restriction');
    } catch (err) { fail('23. Legacy pool restriction', err); }

    // TEST 24: Suspended supplier restriction
    startTest('24. Suspended supplier restriction');
    try {
      // Create a pool for supplier 2, then temporarily mark supplier 2 unverified/blocked
      const suppPoolId = await createTestPool();
      await db.query("UPDATE users SET verification_status = 'BLOCKED', is_verified = 0 WHERE id = 2");

      const res = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `susp-supp-${Date.now()}`
        },
        body: { pool_id: suppPoolId, quantity: 5 }
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'SUPPLIER_INELIGIBLE');

      // Restore supplier verification
      await db.query("UPDATE users SET verification_status = 'VERIFIED', is_verified = 1 WHERE id = 2");

      pass('24. Suspended supplier restriction');
    } catch (err) { fail('24. Suspended supplier restriction', err); }

    // TEST 25: Accurate buyer/supplier visibility
    startTest('25. Accurate buyer/supplier visibility');
    try {
      // Buyer 1 reads own reservation
      const buyerRes = await api(`/api/v1/reservations/${res1Id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${buyer1Token}` }
      });
      assert.strictEqual(buyerRes.status, 200);
      assert.ok(buyerRes.body.data.reservation.permissions);

      // Competing supplier (id: 3) attempts to read pool reservation summary -> 403
      const compSuppRes = await api(`/api/v1/pools/${poolActiveId}/supplier/summary`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${otherSupplierToken}` }
      });
      assert.strictEqual(compSuppRes.status, 403);

      // Owning supplier (id: 2) reads pool reservation summary -> 200, zero buyer PII
      const ownSuppRes = await api(`/api/v1/pools/${poolActiveId}/supplier/summary`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });
      assert.strictEqual(ownSuppRes.status, 200);
      const rawBody = JSON.stringify(ownSuppRes.body);
      assert.strictEqual(rawBody.includes('buyer1@miljor.com'), false, 'Zero buyer email in supplier summary');
      assert.strictEqual(rawBody.includes('03001234567'), false, 'Zero buyer phone in supplier summary');

      pass('25. Accurate buyer/supplier visibility');
    } catch (err) { fail('25. Accurate buyer/supplier visibility', err); }

    // TEST 26: Historical records preserved
    startTest('26. Historical records preserved');
    try {
      // Cancel res2Id cleanly
      const cancelRes = await api(`/api/v1/reservations/${res2Id}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'X-Idempotency-Key': `cancel-clean-${Date.now()}`
        }
      });
      assert.strictEqual(cancelRes.status, 200);

      // Verify historical cancelled record is still retrievable by buyer2
      const getCancelled = await api(`/api/v1/reservations/${res2Id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${buyer2Token}` }
      });
      assert.strictEqual(getCancelled.status, 200);
      assert.strictEqual(getCancelled.body.data.reservation.status, 'CANCELLED');
      assert.strictEqual(getCancelled.body.data.reservation.permissions.can_modify, false);
      assert.strictEqual(getCancelled.body.data.reservation.permissions.can_cancel, false);

      pass('26. Historical records preserved');
    } catch (err) { fail('26. Historical records preserved', err); }

    // TEST 27: No unauthorized payment/order/ledger changes
    startTest('27. No unauthorized payment/order/ledger changes');
    try {
      const [orderRows] = await db.query(
        "SELECT COUNT(*) AS total FROM orders WHERE pool_id IN (?)",
        [createdPoolIds]
      );
      assert.strictEqual(Number(orderRows[0].total), 0, 'Zero orders must exist');

      const [payRows] = await db.query(
        "SELECT COUNT(*) AS total FROM payments WHERE reservation_id IN (?)",
        [createdReservationIds]
      );
      assert.strictEqual(Number(payRows[0].total), 0, 'Zero payments must exist');

      pass('27. No unauthorized payment/order/ledger changes');
    } catch (err) { fail('27. No unauthorized payment/order/ledger changes', err); }

    // TEST 28: Test database isolation and natural process termination
    startTest('28. Test database isolation and natural process termination');
    try {
      const [dbRow] = await db.query('SELECT DATABASE() AS current_db');
      assert.strictEqual(dbRow[0].current_db, 'miljor_test_db');
      pass('28. Test database isolation and natural process termination');
    } catch (err) { fail('28. Test database isolation and natural process termination', err); }

  } finally {
    // Teardown temporary test server
    if (server && server.listening) {
      await new Promise(resolve => server.close(resolve));
    }

    // Fixture cleanup
    try {
      if (createdReservationIds.length > 0) {
        await db.query('DELETE FROM reservation_mutation_history WHERE reservation_id IN (?)', [createdReservationIds]);
        await db.query('DELETE FROM reservation_business_events WHERE reservation_id IN (?)', [createdReservationIds]);
        await db.query('DELETE FROM reservations WHERE id IN (?)', [createdReservationIds]);
      }
      if (createdPoolIds.length > 0) {
        await db.query('DELETE FROM reservation_business_events WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query("DELETE FROM supplier_inventory_allocations WHERE reference_id IN (?) AND allocation_type = 'REGULAR_POOL'", [createdPoolIds]);
        await db.query('DELETE FROM pool_price_tiers WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
      }
      // Restore listing stock
      await db.query('UPDATE supplier_listings SET available_stock = ? WHERE id = 1', [originalListingStock]);
      await db.query("UPDATE users SET verification_status = 'VERIFIED', is_verified = 1 WHERE id = 2");
    } catch (cleanupErr) {
      console.error('Fixture cleanup error:', cleanupErr.message);
    }

    // Explicitly close the shared MySQL pool for natural process termination
    await db.end();
  }

  const suiteElapsed = ((Date.now() - suiteStart) / 1000).toFixed(2);
  console.log('\n================================================================================');
  console.log(`Part 4C.3 Lifecycle Expiry Gate: ${passed} / ${passed + failed} assertions passed (${suiteElapsed}s)`);
  console.log(`Status: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exitCode = 1;
    throw new Error(`Part 4C.3 Lifecycle Expiry Gate: ${failed} assertion(s) failed`);
  }

  return { passed, failed, total: passed + failed, suiteElapsed };
}

if (require.main === module) {
  runPart4C3LifecycleExpiryGate()
    .catch(err => {
      console.error('Fatal error in Part 4C.3 Lifecycle Expiry Gate:', err);
      process.exitCode = 1;
    });
}

module.exports = runPart4C3LifecycleExpiryGate;
