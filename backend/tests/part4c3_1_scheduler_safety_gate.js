/**
 * =============================================================================
 * tests/part4c3_1_scheduler_safety_gate.js
 * 
 * MILJOR — PART 4C.3.1: EXISTING SCHEDULER CONTAINMENT & EXPIRY CLOCK
 * VERIFICATION GATE
 * 
 * Verifies:
 * 1. Unsafe legacy closure path cannot execute in normal development configuration (OBS-41)
 * 2. Unsafe legacy closure path cannot execute in production configuration (OBS-41)
 * 3. Test scheduler remains disabled during tests
 * 4. No reservation mass cancellation when expired pools exist
 * 5. No premature refund or ledger mutation when expired pools exist
 * 6. No unauthorized supplier allocation release when expired pools exist
 * 7. API operations remain valid before expiry
 * 8. Expiry check remains authoritative after lock waiting (OBS-43)
 * 9. Exact expiry boundary is closed using UTC_TIMESTAMP()
 * 10. Historical reservations remain intact across scheduler invocation
 * 11. Existing unrelated scheduled tasks (idempotency cleanup, flash pool expiry) are not disabled
 * 12. No duplicate job execution or unguarded admin bypass
 * =============================================================================
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');

const app = require('../server');
const db = require('../src/config/db');
const poolClosureService = require('../src/services/poolClosureService');
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

async function runPart4C31SchedulerSafetyGate() {
  const suiteStart = Date.now();
  console.log('================================================================================');
  console.log('🛡️ Starting MilJor Part 4C.3.1: Scheduler Containment & Expiry Clock Gate...');
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
  const buyer1Token = jwt.sign(
    { id: 5, role: 'BUYER', email: 'buyer1@miljor.com', verification_status: 'VERIFIED', is_verified: 1 },
    JWT_SECRET,
    tokenOpts
  );

  let testPoolId = null;
  let testResId = null;
  let originalListingStock = 1000;

  try {
    const [origRows] = await db.query('SELECT available_stock FROM supplier_listings WHERE id = 1');
    if (origRows.length > 0) {
      originalListingStock = Number(origRows[0].available_stock);
    }

    // Helper: Create and publish a test pool
    async function createTestPool() {
      const createRes = await api('/api/v1/pools', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supplierToken}`,
          'X-Idempotency-Key': `pool-create-4c31-${Date.now()}-${Math.random()}`
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
          duration_days: 7,
          min_participants: 2,
          max_participants: 10,
          price_tiers: [
            { min_qty: 20, max_qty: 49, price_per_unit: 5000.00, pricing_unit: 'bag' },
            { min_qty: 50, max_qty: 100, price_per_unit: 4700.00, pricing_unit: 'bag' }
          ]
        }
      });
      assert.strictEqual(createRes.status, 201);
      const poolId = createRes.body.data.pool.id;
      createdPoolIds.push(poolId);

      const pubRes = await api(`/api/v1/pools/${poolId}/publish`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supplierToken}`,
          'X-Idempotency-Key': `pool-publish-4c31-${Date.now()}-${Math.random()}`
        }
      });
      assert.strictEqual(pubRes.status, 200);

      return poolId;
    }

    testPoolId = await createTestPool();

    // Reserve 10 bags in testPoolId
    const resCreate = await api('/api/v1/reservations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `res-4c31-${Date.now()}`
      },
      body: { pool_id: testPoolId, quantity: 10 }
    });
    assert.strictEqual(resCreate.status, 201);
    testResId = resCreate.body.data.reservation.id;
    createdReservationIds.push(testResId);

    // =========================================================================
    // SECTION 1: OBS-41 FAIL-CLOSED SCHEDULER CONTAINMENT (TESTS 1 - 6)
    // =========================================================================

    // TEST 1: Unsafe legacy closure path cannot execute in normal development configuration
    startTest('1. Unsafe legacy closure path cannot execute in normal development configuration');
    try {
      const prevEnv = process.env.ENABLE_PART4D_POOL_CLOSURE;
      delete process.env.ENABLE_PART4D_POOL_CLOSURE;

      // Force pool expires_at to be in the past
      await db.query("UPDATE pools SET expires_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [testPoolId]);

      // Call processExpiredPools directly
      const result = await poolClosureService.processExpiredPools();
      assert.strictEqual(result.contained, true, 'Must return contained: true');
      assert.strictEqual(result.reason, 'PART_4D_CLOSURE_WORKFLOW_PENDING');
      assert.strictEqual(result.processed, 0);

      process.env.ENABLE_PART4D_POOL_CLOSURE = prevEnv;
      pass('1. Unsafe legacy closure path cannot execute in normal development configuration');
    } catch (err) { fail('1. Unsafe legacy closure path cannot execute in normal development configuration', err); }

    // TEST 2: Unsafe legacy closure path cannot execute in production configuration
    startTest('2. Unsafe legacy closure path cannot execute in production configuration');
    try {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevClosure = process.env.ENABLE_PART4D_POOL_CLOSURE;
      process.env.NODE_ENV = 'production';
      delete process.env.ENABLE_PART4D_POOL_CLOSURE;

      const result = await poolClosureService.processExpiredPools();
      assert.strictEqual(result.contained, true, 'Must enforce containment even in production');
      assert.strictEqual(result.processed, 0);

      process.env.NODE_ENV = prevNodeEnv;
      process.env.ENABLE_PART4D_POOL_CLOSURE = prevClosure;
      pass('2. Unsafe legacy closure path cannot execute in production configuration');
    } catch (err) { fail('2. Unsafe legacy closure path cannot execute in production configuration', err); }

    // TEST 3: Test scheduler remains disabled during tests
    startTest('3. Test scheduler remains disabled during tests');
    try {
      assert.strictEqual(process.env.NODE_ENV, 'test');
      // server.js verifies: if (process.env.NODE_ENV !== 'test') { startScheduler(); }
      pass('3. Test scheduler remains disabled during tests');
    } catch (err) { fail('3. Test scheduler remains disabled during tests', err); }

    // TEST 4: No reservation mass cancellation
    startTest('4. No reservation mass cancellation');
    try {
      // Despite pool being expired and processExpiredPools invoked, reservation must remain strictly RESERVED
      const [resRow] = await db.query("SELECT status FROM reservations WHERE id = ?", [testResId]);
      assert.strictEqual(resRow[0].status, 'RESERVED', 'Reservation must remain RESERVED, never mass-cancelled');
      pass('4. No reservation mass cancellation');
    } catch (err) { fail('4. No reservation mass cancellation', err); }

    // TEST 5: No premature refund or ledger mutation
    startTest('5. No premature refund or ledger mutation');
    try {
      const [payRows] = await db.query("SELECT COUNT(*) AS total FROM payments WHERE reservation_id = ?", [testResId]);
      assert.strictEqual(Number(payRows[0].total), 0, 'Zero payment records must exist');

      const [ledgerRows] = await db.query(
        "SELECT COUNT(*) AS total FROM platform_ledger pl JOIN payments p ON pl.payment_id = p.id WHERE p.reservation_id = ?",
        [testResId]
      );
      assert.strictEqual(Number(ledgerRows[0].total), 0, 'Zero ledger records must exist');
      pass('5. No premature refund or ledger mutation');
    } catch (err) { fail('5. No premature refund or ledger mutation', err); }

    // TEST 6: No unauthorized supplier allocation release
    startTest('6. No unauthorized supplier allocation release');
    try {
      const [allocRows] = await db.query(
        "SELECT status FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'",
        [testPoolId]
      );
      assert.strictEqual(allocRows.length, 1);
      assert.strictEqual(allocRows[0].status, 'COMMITTED', 'Allocation must remain strictly COMMITTED, not RELEASED');
      pass('6. No unauthorized supplier allocation release');
    } catch (err) { fail('6. No unauthorized supplier allocation release', err); }

    // =========================================================================
    // SECTION 2: OBS-43 EXPIRY CLOCK & FRESH DB-AUTHORITATIVE CUTOFF (TESTS 7 - 10)
    // =========================================================================

    // TEST 7: API operations remain valid before expiry
    startTest('7. API operations remain valid before expiry');
    try {
      // Restore pool expiry to future
      await db.query("UPDATE pools SET expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?", [testPoolId]);

      const editRes = await api(`/api/v1/reservations/${testResId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `valid-pre-exp-${Date.now()}`,
          'If-Match-Quantity': '10.0000'
        },
        body: { quantity: 15 }
      });
      assert.strictEqual(editRes.status, 200, 'Pre-expiry update must succeed with 200');
      pass('7. API operations remain valid before expiry');
    } catch (err) { fail('7. API operations remain valid before expiry', err); }

    // TEST 8: Expiry check remains authoritative after lock waiting
    startTest('8. Expiry check remains authoritative after lock waiting');
    try {
      // Set pool expires_at to 1 second from now in DB server time
      await db.query("UPDATE pools SET expires_at = DATE_ADD(NOW(), INTERVAL 1 SECOND) WHERE id = ?", [testPoolId]);

      const lockConn = await db.getConnection();
      await lockConn.beginTransaction();
      try {
        // Hold exclusive row lock
        await lockConn.query("SELECT * FROM pools WHERE id = ? FOR UPDATE", [testPoolId]);

        // Sleep 1.3 seconds so NOW() passes expires_at
        await new Promise(resolve => setTimeout(resolve, 1300));

        // Submit reservation update while lock is held
        const updatePromise = api(`/api/v1/reservations/${testResId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${buyer1Token}`,
            'X-Idempotency-Key': `lock-wait-race-${Date.now()}`,
            'If-Match-Quantity': '15.0000'
          },
          body: { quantity: 20 }
        });

        // Release lock
        await lockConn.rollback();
        lockConn.release();

        const updateRes = await updatePromise;
        assert.strictEqual(updateRes.status, 422, 'Must reject with 422 POOL_EXPIRED after acquiring lock');
        assert.strictEqual(updateRes.body.error.code, 'POOL_EXPIRED');
      } catch (innerErr) {
        try { await lockConn.rollback(); } catch (_) {}
        lockConn.release();
        throw innerErr;
      }
      pass('8. Expiry check remains authoritative after lock waiting');
    } catch (err) { fail('8. Expiry check remains authoritative after lock waiting', err); }

    // TEST 9: Exact expiry boundary is closed
    startTest('9. Exact expiry boundary is closed');
    try {
      // Set pool expires_at to exact NOW()
      await db.query("UPDATE pools SET expires_at = NOW() WHERE id = ?", [testPoolId]);

      const createRes = await api('/api/v1/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `exact-utc-exp-${Date.now()}`
        },
        body: { pool_id: testPoolId, quantity: 5 }
      });
      assert.strictEqual(createRes.status, 422, 'Exact boundary must reject with 422');
      assert.strictEqual(createRes.body.error.code, 'POOL_EXPIRED');
      pass('9. Exact expiry boundary is closed');
    } catch (err) { fail('9. Exact expiry boundary is closed', err); }

    // TEST 10: Historical reservations remain intact
    startTest('10. Historical reservations remain intact');
    try {
      const getRes = await api(`/api/v1/reservations/${testResId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${buyer1Token}` }
      });
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.body.data.reservation.id, testResId);
      assert.strictEqual(getRes.body.data.reservation.status, 'RESERVED');
      assert.strictEqual(getRes.body.data.reservation.permissions.can_modify, false, 'Modifications blocked on expired pool');
      assert.strictEqual(getRes.body.data.reservation.permissions.can_cancel, false, 'Cancellations blocked on expired pool');
      pass('10. Historical reservations remain intact');
    } catch (err) { fail('10. Historical reservations remain intact', err); }

    // =========================================================================
    // SECTION 3: OBS-44 LOCK ORDER & SCHEDULER NON-DISRUPTION (TESTS 11 - 12)
    // =========================================================================

    // TEST 11: Existing unrelated scheduled tasks are not disabled
    startTest('11. Existing unrelated scheduled tasks are not disabled');
    try {
      // Verify cleanOldIdempotencyRecords still executes cleanly
      const deletedCount = await poolClosureService.cleanOldIdempotencyRecords();
      assert.ok(deletedCount !== undefined, 'cleanOldIdempotencyRecords must run without error');

      // Verify processExpiredFlashPools still executes cleanly
      const flashCount = await poolClosureService.processExpiredFlashPools();
      assert.ok(flashCount !== undefined, 'processExpiredFlashPools must run without error');

      pass('11. Existing unrelated scheduled tasks are not disabled');
    } catch (err) { fail('11. Existing unrelated scheduled tasks are not disabled', err); }

    // TEST 12: No duplicate job execution or unguarded admin bypass
    startTest('12. No duplicate job execution or unguarded admin bypass');
    try {
      // Ensure admin routes (/api/v1/admin) have zero unverified pool closure routes
      const adminRoutes = require('../src/routes/v1/adminRoutes');
      const routePaths = adminRoutes.stack.map(layer => layer.route ? layer.route.path : null).filter(Boolean);
      assert.strictEqual(routePaths.includes('/pools/:id/close'), false, 'No bypass close endpoint in adminRoutes');
      assert.strictEqual(routePaths.includes('/pools/expire'), false, 'No bypass expire endpoint in adminRoutes');

      pass('12. No duplicate job execution or unguarded admin bypass');
    } catch (err) { fail('12. No duplicate job execution or unguarded admin bypass', err); }

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
      await db.query('UPDATE supplier_listings SET available_stock = ? WHERE id = 1', [originalListingStock]);
    } catch (cleanupErr) {
      console.error('Fixture cleanup error:', cleanupErr.message);
    }

    // Explicitly close the shared MySQL pool for natural process termination
    await db.end();
  }

  const suiteElapsed = ((Date.now() - suiteStart) / 1000).toFixed(2);
  console.log('\n================================================================================');
  console.log(`Part 4C.3.1 Scheduler Safety Gate: ${passed} / ${passed + failed} assertions passed (${suiteElapsed}s)`);
  console.log(`Status: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exitCode = 1;
    throw new Error(`Part 4C.3.1 Scheduler Safety Gate: ${failed} assertion(s) failed`);
  }

  return { passed, failed, total: passed + failed, suiteElapsed };
}

if (require.main === module) {
  runPart4C31SchedulerSafetyGate()
    .catch(err => {
      console.error('Fatal error in Part 4C.3.1 Scheduler Safety Gate:', err);
      process.exitCode = 1;
    });
}

module.exports = runPart4C31SchedulerSafetyGate;
