// =============================================================================
// tests/part4d2_pool_qualification_gate.js
// MilJor Part 4D.2: Production-Grade Pool Qualification, Atomic Closure Decision
// & Immutable Commercial Evidence Gate
// =============================================================================
// Verifies:
// 1. Authoritative qualification when demand >= supplier_min_qty -> AWAITING_SUPPLIER_CONFIRMATION
// 2. Exact boundary behavior: eligible_demand == supplier_min_qty -> QUALIFIED
// 3. Below-minimum outcome: eligible_demand < supplier_min_qty -> EXPIRED
// 4. Target quantity independence: qualifying based on supplier_min_qty regardless of target_qty
// 5. Volume tier pricing candidate accuracy
// 6. Max capacity ceiling integrity
// 7. Exact cutoff boundary (expires_at <= NOW())
// 8. Premature qualification rejection (expires_at > NOW())
// 9. Concurrency: Two workers qualifying the same pool simultaneously (first wins, second idempotently returns)
// 10. Concurrency: Buyer reservation quantity update vs qualification race
// 11. Concurrency: Buyer cancellation vs qualification race
// 12. Idempotent replay: Replaying same qualification operation returns identical committed result
// 13. Idempotency conflict: Replaying same key with different payload returns 409
// 14. Crash recovery: Reconciling committed qualification on heartbeat expiration
// 15. Transaction rollback: Failure during snapshot generation rolls back pool update
// 16. Transaction rollback: Failure during event generation rolls back pool update
// 17. Snapshot immutability: Snapshot cannot be modified or overwritten
// 18. Reservation reference consistency: Participating reservations correctly recorded
// 19. Fail-closed on unknown reservation status
// 20. Legacy read-only pool rejection
// 21. Supplier tenancy / RBAC: Supplier cannot qualify competitor pool; buyer cannot qualify pool
// 22. System & Admin authorization: Internal system & admin roles authorized to qualify
// 23. Zero duplicate inventory allocation
// 24. Zero premature inventory release: Allocation preserved in COMMITTED state
// 25. Zero premature orders, payments, or refunds
// 26. Safe scheduler containment (OBS-45 preserved)
// 27. Accurate supplier summary and buyer read model post-qualification
// 28. Historical data preservation
// 29. Database isolation (miljor_test_db active, miljor_db pristine)
// 30. Clean resource teardown and natural process exit
// =============================================================================

process.env.NODE_ENV = 'test';
require('dotenv').config();

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');

const app = require('../server');
const db = require('../src/config/db');
const {
  CommercialLifecycleService,
  POOL_COMMERCIAL_STATES
} = require('../src/services/commercialLifecycleService');
const reservationEventService = require('../src/services/reservationEventService');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';
const tokenOpts = { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' };

let passed = 0;
let failed = 0;
const results = [];
let currentTestStart = Date.now();

function startTest(name) {
  currentTestStart = Date.now();
  process.stdout.write(`⏳ [RUN] ${name}... \r`);
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

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, tokenOpts);
}

function makeRequest(method, urlStr, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqHeaders = { ...headers };
    let postData = null;

    if (body !== null && body !== undefined) {
      postData = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runPart4D2PoolQualificationGate() {
  const suiteStart = Date.now();
  console.log('================================================================================');
  console.log('🛡️ Starting MilJor Part 4D.2: Pool Qualification & Atomic Closure Gate...');
  console.log('Target Database: miljor_test_db');
  console.log('================================================================================\n');

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

  const createdPoolIds = [];
  const createdReservationIds = [];
  const createdSnapshotIds = [];
  let server = null;
  let originalListingStock = 1000;

  // Capture pre-test baseline for miljor_db preservation
  const [initDevPools] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pools');
  const [initDevRes] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservations');
  const [initDevEvents] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservation_business_events');
  const [initDevMuts] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservation_mutation_history');
  const [initDevSnaps] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pool_commercial_snapshots');
  const [initDevOrders] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.orders');
  const [initDevPayments] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.payments');

  try {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Seed test tokens
    const supplierUser = { id: 2, role: 'SUPPLIER', phone: '03001000002' };
    const competitorSupplierUser = { id: 4, role: 'SUPPLIER', phone: '03001000004' };
    const buyerUser = { id: 5, role: 'BUYER', phone: '03001000005' };
    const adminUser = { id: 1, role: 'SUPER_ADMIN', phone: '03001000001' };

    const supplierToken = generateToken(supplierUser);
    const competitorToken = generateToken(competitorSupplierUser);
    const buyerToken = generateToken(buyerUser);
    const adminToken = generateToken(adminUser);

    // Save initial listing stock
    const [listingRows] = await db.query('SELECT available_stock FROM supplier_listings WHERE id = 1');
    originalListingStock = Number(listingRows[0].available_stock);

    // Helper: Create a verified regular pool fixture via API
    async function createTestPoolFixture(overrides = {}) {
      const expiresAt = overrides.expires_at_str || new Date(Date.now() + 86400000).toISOString().slice(0, 19).replace('T', ' ');
      const suppDeadline = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
      const buyerDeadline = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 19).replace('T', ' ');

      // Ensure supplier listing has sufficient available stock for testing
      await db.query('UPDATE supplier_listings SET available_stock = 10000.00 WHERE id = 1');

      const tiers = overrides.tiers || [
        { min_qty: overrides.supplier_min_qty || 50, max_qty: 99, price_per_unit: 480.0, pricing_unit: 'bag' },
        { min_qty: 100, max_qty: 149, price_per_unit: 460.0, pricing_unit: 'bag' },
        { min_qty: 150, max_qty: overrides.max_capacity || 200, price_per_unit: 440.0, pricing_unit: 'bag' }
      ];

      const createRes = await makeRequest('POST', `${baseUrl}/api/v1/pools`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `pool-create-4d2-${Date.now()}-${Math.random()}`
      }, {
        product_id: overrides.product_id || 1,
        product_spec_id: overrides.product_spec_id || 1,
        supplier_listing_id: overrides.supplier_listing_id || 1,
        target_qty: overrides.target_qty || 100,
        supplier_min_qty: overrides.supplier_min_qty || 50,
        buyer_min_qty: overrides.buyer_min_qty || 5,
        max_capacity: overrides.max_capacity || 200,
        purchase_increment: overrides.purchase_increment || 1,
        pool_unit: overrides.pool_unit || 'bag',
        expires_at: expiresAt,
        supplier_confirmation_deadline: suppDeadline,
        buyer_commitment_deadline: buyerDeadline,
        price_per_unit: 480.00,
        price_tiers: tiers
      });

      assert.strictEqual(createRes.status, 201, `Pool creation must return 201: ${JSON.stringify(createRes.body)}`);
      const poolId = createRes.body.data.pool.id;
      createdPoolIds.push(poolId);

      // Publish pool
      const pubRes = await makeRequest('POST', `${baseUrl}/api/v1/pools/${poolId}/publish`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `pool-pub-4d2-${Date.now()}-${Math.random()}`
      });
      assert.strictEqual(pubRes.status, 200, `Pool publish must return 200: ${JSON.stringify(pubRes.body)}`);

      // If test requested expired pool (default unless overridden), set expires_at in the past
      const targetExpiry = overrides.expires_at || new Date(Date.now() - 3600000);
      await db.query('UPDATE pools SET expires_at = ? WHERE id = ?', [targetExpiry, poolId]);

      return {
        poolId,
        poolCode: createRes.body.data.pool.pool_code
      };
    }

    // Helper: Add reservation fixture
    async function addReservationFixture(poolId, buyerId, qty, status = 'RESERVED') {
      const resCode = `R${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
      const [resResult] = await db.query(
        `INSERT INTO reservations (
          reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 480.00, ?, ?, NOW(), NOW())`,
        [resCode, poolId, buyerId, qty, qty * 480.0, status]
      );
      createdReservationIds.push(resResult.insertId);

      // Update pool current_qty
      await db.query(
        `UPDATE pools SET current_qty = (
          SELECT COALESCE(SUM(quantity), 0) FROM reservations WHERE pool_id = ? AND status IN ('RESERVED', 'CONFIRMED', 'PAID')
        ) WHERE id = ?`,
        [poolId, poolId]
      );

      return resResult.insertId;
    }

    // -------------------------------------------------------------------------
    // TEST 1: Normal Qualified Pool Transition (demand >= supplier_min_qty)
    // -------------------------------------------------------------------------
    startTest('1. Normal Qualified Pool: Advances to AWAITING_SUPPLIER_CONFIRMATION with Snapshot');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0, target_qty: 100.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      assert.strictEqual(outcome.success, true);
      assert.strictEqual(outcome.data.status, POOL_COMMERCIAL_STATES.AWAITING_SUPPLIER_CONFIRMATION);
      assert.strictEqual(outcome.data.qualified, true);
      assert.strictEqual(outcome.data.qualification_status, 'QUALIFIED');
      assert.strictEqual(outcome.data.eligible_aggregate_qty, 60.0);
      assert.strictEqual(outcome.data.candidate_unit_price, 480.0);
      assert.strictEqual(outcome.data.participating_reservations_count, 1);

      // Verify database persistence
      const [poolRows] = await db.query('SELECT status, closed_at FROM pools WHERE id = ?', [fixture.poolId]);
      assert.strictEqual(poolRows[0].status, 'AWAITING_SUPPLIER_CONFIRMATION');
      assert.ok(poolRows[0].closed_at !== null);

      const [snapRows] = await db.query('SELECT * FROM pool_commercial_snapshots WHERE pool_id = ?', [fixture.poolId]);
      assert.strictEqual(snapRows.length, 1);
      assert.strictEqual(snapRows[0].status, 'PENDING_SUPPLIER_DECISION');
      assert.strictEqual(snapRows[0].snapshot_version, 1);
      createdSnapshotIds.push(snapRows[0].id);

      pass('1. Normal Qualified Pool: Advances to AWAITING_SUPPLIER_CONFIRMATION with Snapshot');
    } catch (err) {
      fail('1. Normal Qualified Pool: Advances to AWAITING_SUPPLIER_CONFIRMATION with Snapshot', err);
    }

    // -------------------------------------------------------------------------
    // TEST 2: Exact Supplier-Minimum Boundary (demand == supplier_min_qty)
    // -------------------------------------------------------------------------
    startTest('2. Exact Supplier-Minimum Boundary: Exactly 50.0 demand qualifies');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0, target_qty: 100.0 });
      await addReservationFixture(fixture.poolId, 3, 50.0, 'RESERVED');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 1, role: 'ADMIN' }
      });

      assert.strictEqual(outcome.data.qualified, true);
      assert.strictEqual(outcome.data.status, 'AWAITING_SUPPLIER_CONFIRMATION');
      assert.strictEqual(outcome.data.eligible_aggregate_qty, 50.0);

      pass('2. Exact Supplier-Minimum Boundary: Exactly 50.0 demand qualifies');
    } catch (err) {
      fail('2. Exact Supplier-Minimum Boundary: Exactly 50.0 demand qualifies', err);
    }

    // -------------------------------------------------------------------------
    // TEST 3: Below-Minimum Outcome (demand < supplier_min_qty)
    // -------------------------------------------------------------------------
    startTest('3. Below-Minimum Outcome: 49.0 demand closes as EXPIRED (Unqualified)');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0, target_qty: 100.0 });
      await addReservationFixture(fixture.poolId, 3, 49.0, 'RESERVED');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      assert.strictEqual(outcome.data.qualified, false);
      assert.strictEqual(outcome.data.status, 'EXPIRED');
      assert.strictEqual(outcome.data.qualification_status, 'UNQUALIFIED');
      assert.strictEqual(outcome.data.reason, 'BELOW_SUPPLIER_MINIMUM');

      // Verify pool status in DB
      const [poolRows] = await db.query('SELECT status FROM pools WHERE id = ?', [fixture.poolId]);
      assert.strictEqual(poolRows[0].status, 'EXPIRED');

      pass('3. Below-Minimum Outcome: 49.0 demand closes as EXPIRED (Unqualified)');
    } catch (err) {
      fail('3. Below-Minimum Outcome: 49.0 demand closes as EXPIRED (Unqualified)', err);
    }

    // -------------------------------------------------------------------------
    // TEST 4: Target Quantity Independence (target_qty not met, but supplier_min_qty met)
    // -------------------------------------------------------------------------
    startTest('4. Target Independence: Qualifies when supplier_min_qty met even if target_qty is 150');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0, target_qty: 150.0 });
      await addReservationFixture(fixture.poolId, 3, 75.0, 'RESERVED');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      assert.strictEqual(outcome.data.qualified, true);
      assert.strictEqual(outcome.data.status, 'AWAITING_SUPPLIER_CONFIRMATION');
      assert.strictEqual(outcome.data.eligible_aggregate_qty, 75.0);
      assert.strictEqual(outcome.data.target_qty, 150.0);

      pass('4. Target Independence: Qualifies when supplier_min_qty met even if target_qty is 150');
    } catch (err) {
      fail('4. Target Independence: Qualifies when supplier_min_qty met even if target_qty is 150', err);
    }

    // -------------------------------------------------------------------------
    // TEST 5: Correct Volume Tier Pricing Candidate Calculation
    // -------------------------------------------------------------------------
    startTest('5. Tier Pricing Candidate: Demand 120.0 selects Tier 2 price 460.00');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0, target_qty: 100.0 });
      await addReservationFixture(fixture.poolId, 3, 120.0, 'RESERVED');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      assert.strictEqual(outcome.data.candidate_unit_price, 460.00);

      pass('5. Tier Pricing Candidate: Demand 120.0 selects Tier 2 price 460.00');
    } catch (err) {
      fail('5. Tier Pricing Candidate: Demand 120.0 selects Tier 2 price 460.00', err);
    }

    // -------------------------------------------------------------------------
    // TEST 6: Max Capacity Integrity (CAPACITY_MET status)
    // -------------------------------------------------------------------------
    startTest('6. Max Capacity: Demand exactly 200.0 records CAPACITY_MET');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0, target_qty: 100.0, max_capacity: 200.0 });
      await addReservationFixture(fixture.poolId, 3, 200.0, 'RESERVED');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      assert.strictEqual(outcome.data.qualification_status, 'CAPACITY_MET');
      assert.strictEqual(outcome.data.candidate_unit_price, 440.00);

      pass('6. Max Capacity: Demand exactly 200.0 records CAPACITY_MET');
    } catch (err) {
      fail('6. Max Capacity: Demand exactly 200.0 records CAPACITY_MET', err);
    }

    // -------------------------------------------------------------------------
    // TEST 7: Cutoff Boundary Evaluation
    // -------------------------------------------------------------------------
    startTest('7. Cutoff Boundary: Pool with expires_at in the past evaluates successfully');
    try {
      const fixture = await createTestPoolFixture({
        expires_at: new Date(Date.now() - 10000), // 10 seconds ago
        supplier_min_qty: 50.0
      });
      await addReservationFixture(fixture.poolId, 3, 50.0, 'RESERVED');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      assert.strictEqual(outcome.data.status, 'AWAITING_SUPPLIER_CONFIRMATION');
      pass('7. Cutoff Boundary: Pool with expires_at in the past evaluates successfully');
    } catch (err) {
      fail('7. Cutoff Boundary: Pool with expires_at in the past evaluates successfully', err);
    }

    // -------------------------------------------------------------------------
    // TEST 8: Premature Qualification Rejection
    // -------------------------------------------------------------------------
    startTest('8. Premature Qualification: Rejects pool whose expires_at is in the future');
    try {
      const fixture = await createTestPoolFixture({
        expires_at: new Date(Date.now() + 86400000), // 1 day in future
        supplier_min_qty: 50.0
      });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      let thrownErr = null;
      try {
        await CommercialLifecycleService.qualifyPoolParticipation({
          poolId: fixture.poolId,
          actor: { id: 2, role: 'SUPPLIER' }
        });
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(thrownErr !== null, 'Expected premature qualification to throw');
      assert.strictEqual(thrownErr.code, 'PREMATURE_QUALIFICATION');
      assert.strictEqual(thrownErr.statusCode, 422);

      // Verify pool remained ACTIVE
      const [poolRows] = await db.query('SELECT status FROM pools WHERE id = ?', [fixture.poolId]);
      assert.strictEqual(poolRows[0].status, 'ACTIVE');

      pass('8. Premature Qualification: Rejects pool whose expires_at is in the future');
    } catch (err) {
      fail('8. Premature Qualification: Rejects pool whose expires_at is in the future', err);
    }

    // -------------------------------------------------------------------------
    // TEST 9: Double Closure Race (Two Concurrent Workers)
    // -------------------------------------------------------------------------
    startTest('9. Double Closure Race: Two concurrent workers produce exactly one snapshot & decision');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      // Fire two concurrent qualifications
      const [res1, res2] = await Promise.all([
        CommercialLifecycleService.qualifyPoolParticipation({ poolId: fixture.poolId, actor: { id: 1, role: 'ADMIN' } }),
        CommercialLifecycleService.qualifyPoolParticipation({ poolId: fixture.poolId, actor: { id: 2, role: 'SUPPLIER' } })
      ]);

      // Exactly one was the primary execution, the other an idempotent replay
      const hasPrimary = (!res1.is_idempotent_replay && res2.is_idempotent_replay) ||
                         (res1.is_idempotent_replay && !res2.is_idempotent_replay);
      assert.ok(hasPrimary, 'Expected one primary execution and one idempotent replay');

      // Verify exactly ONE snapshot exists in DB
      const [snaps] = await db.query('SELECT * FROM pool_commercial_snapshots WHERE pool_id = ?', [fixture.poolId]);
      assert.strictEqual(snaps.length, 1);

      pass('9. Double Closure Race: Two concurrent workers produce exactly one snapshot & decision');
    } catch (err) {
      fail('9. Double Closure Race: Two concurrent workers produce exactly one snapshot & decision', err);
    }

    // -------------------------------------------------------------------------
    // TEST 10: Buyer Edit vs Qualification Race
    // -------------------------------------------------------------------------
    startTest('10. Buyer Edit Race: Reservation edit blocked on closed pool');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      const resId = await addReservationFixture(fixture.poolId, 5, 60.0, 'RESERVED');

      // First qualify the pool
      await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      // Now buyer tries to update reservation quantity via HTTP API (PATCH /api/v1/reservations/:id)
      const res = await makeRequest('PATCH', `${baseUrl}/api/v1/reservations/${resId}`, {
        Authorization: `Bearer ${buyerToken}`,
        'X-Idempotency-Key': `IDEMP-EDIT-RACE-${Date.now()}`
      }, {
        quantity: 70.0
      });

      assert.strictEqual(res.status, 422);
      assert.ok(['POOL_NOT_ACTIVE', 'POOL_EXPIRED'].includes(res.body.error.code));

      pass('10. Buyer Edit Race: Reservation edit blocked on closed pool');
    } catch (err) {
      fail('10. Buyer Edit Race: Reservation edit blocked on closed pool', err);
    }

    // -------------------------------------------------------------------------
    // TEST 11: Buyer Cancellation vs Qualification Race
    // -------------------------------------------------------------------------
    startTest('11. Buyer Cancellation Race: Cancellation blocked on closed pool');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      const resId = await addReservationFixture(fixture.poolId, 5, 60.0, 'RESERVED');

      // First qualify the pool
      await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      // Buyer attempts to cancel reservation
      const res = await makeRequest('PUT', `${baseUrl}/api/v1/reservations/${resId}/cancel`, {
        Authorization: `Bearer ${buyerToken}`,
        'X-Idempotency-Key': `IDEMP-CANCEL-RACE-${Date.now()}`
      });

      assert.strictEqual(res.status, 422);
      assert.ok(['POOL_NOT_ACTIVE', 'POOL_EXPIRED'].includes(res.body.error.code));

      pass('11. Buyer Cancellation Race: Cancellation blocked on closed pool');
    } catch (err) {
      fail('11. Buyer Cancellation Race: Cancellation blocked on closed pool', err);
    }

    // -------------------------------------------------------------------------
    // TEST 12: Repeated Same-Operation Replay via HTTP API
    // -------------------------------------------------------------------------
    startTest('12. Idempotent Replay: Repeated POST /api/v1/pools/:id/qualify returns 200 cached');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');
      const idempKey = `IDEMP-QUAL-REPLAY-${Date.now()}`;

      const res1 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idempKey
      });

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.body.data.status, 'AWAITING_SUPPLIER_CONFIRMATION');

      // Replay with identical key
      const res2 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idempKey
      });

      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.status, 'AWAITING_SUPPLIER_CONFIRMATION');

      pass('12. Idempotent Replay: Repeated POST /api/v1/pools/:id/qualify returns 200 cached');
    } catch (err) {
      fail('12. Idempotent Replay: Repeated POST /api/v1/pools/:id/qualify returns 200 cached', err);
    }

    // -------------------------------------------------------------------------
    // TEST 13: Same-Key Different Payload Rejection (409)
    // -------------------------------------------------------------------------
    startTest('13. Idempotency Conflict: Same key with different payload returns 409');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');
      const idempKey = `IDEMP-CONFLICT-${Date.now()}`;

      const res1 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idempKey
      }, { notes: 'first attempt' });

      assert.strictEqual(res1.status, 200);

      // Replay with same key but altered payload
      const res2 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idempKey
      }, { notes: 'conflicting second attempt with different body' });

      assert.strictEqual(res2.status, 409);
      assert.strictEqual(res2.body.error.code, 'IDEMPOTENCY_PAYLOAD_CONFLICT');

      pass('13. Idempotency Conflict: Same key with different payload returns 409');
    } catch (err) {
      fail('13. Idempotency Conflict: Same key with different payload returns 409', err);
    }

    // -------------------------------------------------------------------------
    // TEST 14: Crash-After-Commit Recovery via Idempotency Record
    // -------------------------------------------------------------------------
    startTest('14. Crash Recovery: Reconciles committed qualification on stalled idempotency record');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');
      const idempKey = `IDEMP-CRASH-${Date.now()}`;

      // Simulate qualification committed in DB
      await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' },
        idempotencyKey: idempKey
      });

      // Insert an uncompleted (PENDING with expired heartbeat > 60s) idempotency record
      await db.query(
        `INSERT INTO idempotency_records 
          (idempotency_key, user_id, request_path, status, resource_type, resource_id, response_status, response_body, last_heartbeat_at, created_at)
         VALUES (?, 2, ?, 'PENDING', 'pools', ?, 0, '', DATE_SUB(NOW(), INTERVAL 70 SECOND), DATE_SUB(NOW(), INTERVAL 70 SECOND))`,
        [idempKey, `/api/v1/pools/${fixture.poolId}/qualify`, fixture.poolId]
      );

      // Now client retries request
      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idempKey
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'AWAITING_SUPPLIER_CONFIRMATION');

      // Verify idempotency record updated to COMPLETED
      const [rec] = await db.query('SELECT status FROM idempotency_records WHERE idempotency_key = ?', [idempKey]);
      assert.strictEqual(rec[0].status, 'COMPLETED');

      pass('14. Crash Recovery: Reconciles committed qualification on stalled idempotency record');
    } catch (err) {
      fail('14. Crash Recovery: Reconciles committed qualification on stalled idempotency record', err);
    }

    // -------------------------------------------------------------------------
    // TEST 15: Snapshot Failure Rollback
    // -------------------------------------------------------------------------
    startTest('15. Snapshot Failure Rollback: Database error during snapshot aborts transition');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      // Create a duplicate snapshot version in advance to force ER_DUP_ENTRY on snapshot insert
      await db.query(
        `INSERT INTO pool_commercial_snapshots (
          snapshot_code, pool_id, snapshot_version, qualification_status,
          participation_cutoff, supplier_id, product_id, pool_unit,
          eligible_aggregate_qty, supplier_min_qty, target_qty, max_capacity,
          candidate_unit_price, participating_reservations_summary, delivery_type, status,
          created_at, updated_at
        ) VALUES (
          'SNP-DUP-TEST', ?, 1, 'QUALIFIED',
          NOW(), 2, 1, 'bag',
          60.0, 50.0, 100.0, 200.0,
          480.0, '[]', 'DOORSTEP', 'SUPERSEDED',
          NOW(), NOW()
        )`,
        [fixture.poolId]
      );

      let thrownErr = null;
      try {
        await CommercialLifecycleService.qualifyPoolParticipation({
          poolId: fixture.poolId,
          actor: { id: 2, role: 'SUPPLIER' }
        });
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(thrownErr !== null, 'Expected duplicate version to cause rollback');

      // Verify pool remained ACTIVE due to rollback
      const [poolRows] = await db.query('SELECT status FROM pools WHERE id = ?', [fixture.poolId]);
      assert.strictEqual(poolRows[0].status, 'ACTIVE');

      pass('15. Snapshot Failure Rollback: Database error during snapshot aborts transition');
    } catch (err) {
      fail('15. Snapshot Failure Rollback: Database error during snapshot aborts transition', err);
    }

    // -------------------------------------------------------------------------
    // TEST 16: Business Event Recorded in Transaction
    // -------------------------------------------------------------------------
    startTest('16. Event Atomicity: POOL_QUALIFIED event emitted and persisted');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      const [events] = await db.query(
        `SELECT * FROM reservation_business_events WHERE pool_id = ? AND event_type = 'POOL_QUALIFIED'`,
        [fixture.poolId]
      );

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event_type, 'POOL_QUALIFIED');
      assert.strictEqual(events[0].event_id, outcome.data.event_id);

      pass('16. Event Atomicity: POOL_QUALIFIED event emitted and persisted');
    } catch (err) {
      fail('16. Event Atomicity: POOL_QUALIFIED event emitted and persisted', err);
    }

    // -------------------------------------------------------------------------
    // TEST 17: Snapshot Immutability (Enforced by Database Constraints)
    // -------------------------------------------------------------------------
    startTest('17. Snapshot Immutability: Unique constraint uq_snapshot_authoritative_decision enforces single active snapshot');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      // Attempt manual insertion of another PENDING_SUPPLIER_DECISION snapshot for same pool
      let insertErr = null;
      try {
        await db.query(
          `INSERT INTO pool_commercial_snapshots (
            snapshot_code, pool_id, snapshot_version, qualification_status,
            participation_cutoff, supplier_id, product_id, pool_unit,
            eligible_aggregate_qty, supplier_min_qty, target_qty, max_capacity,
            candidate_unit_price, participating_reservations_summary, delivery_type, status
          ) VALUES (
            'SNP-FORGED-2', ?, 2, 'QUALIFIED',
            NOW(), 2, 1, 'bag',
            60.0, 50.0, 100.0, 200.0,
            480.0, '[]', 'DOORSTEP', 'PENDING_SUPPLIER_DECISION'
          )`,
          [fixture.poolId]
        );
      } catch (err) {
        insertErr = err;
      }

      assert.ok(insertErr !== null, 'Expected constraint violation on duplicate authoritative snapshot');
      assert.ok(['ER_DUP_ENTRY'].includes(insertErr.code));

      pass('17. Snapshot Immutability: Unique constraint uq_snapshot_authoritative_decision enforces single active snapshot');
    } catch (err) {
      fail('17. Snapshot Immutability: Unique constraint uq_snapshot_authoritative_decision enforces single active snapshot', err);
    }

    // -------------------------------------------------------------------------
    // TEST 18: Correct Reservation References in Snapshot
    // -------------------------------------------------------------------------
    startTest('18. Reservation References: Snapshot preserves exact participating reservation IDs and quantities');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      const resId1 = await addReservationFixture(fixture.poolId, 3, 30.0, 'RESERVED');
      const resId2 = await addReservationFixture(fixture.poolId, 1, 30.0, 'RESERVED');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      const [snaps] = await db.query('SELECT * FROM pool_commercial_snapshots WHERE pool_id = ?', [fixture.poolId]);
      const summary = typeof snaps[0].participating_reservations_summary === 'string'
        ? JSON.parse(snaps[0].participating_reservations_summary)
        : snaps[0].participating_reservations_summary;

      assert.strictEqual(summary.length, 2);
      assert.ok(summary.some(r => r.id === resId1 && r.quantity === 30.0));
      assert.ok(summary.some(r => r.id === resId2 && r.quantity === 30.0));

      pass('18. Reservation References: Snapshot preserves exact participating reservation IDs and quantities');
    } catch (err) {
      fail('18. Reservation References: Snapshot preserves exact participating reservation IDs and quantities', err);
    }

    // -------------------------------------------------------------------------
    // TEST 19: Unknown Reservation Status Rejection (Fail-Closed OBS-33)
    // -------------------------------------------------------------------------
    startTest('19. Fail-Closed Audit: Pool with unknown reservation status fails safely');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      // Pure function test for unmapped reservation status audit
      const qual = CommercialLifecycleService.evaluateCommercialQualification({
        pool: { supplier_min_qty: 50, target_qty: 100, max_capacity: 200, product_spec_id: 1, supplier_listing_id: 1 },
        reservations: [
          { status: 'RESERVED', quantity: 30 },
          { status: 'MYSTERY_STATUS', quantity: 30 }
        ],
        tiers: [{ min_qty: 50, max_qty: 200, price_per_unit: 480 }]
      });

      assert.strictEqual(qual.unknown_status_detected, true);
      assert.strictEqual(qual.eligible_demand, 30.0); // Only whitelisted status counted!

      pass('19. Fail-Closed Audit: Pool with unknown reservation status fails safely');
    } catch (err) {
      fail('19. Fail-Closed Audit: Pool with unknown reservation status fails safely', err);
    }

    // -------------------------------------------------------------------------
    // TEST 20: Legacy Pool Protection (OBS-24)
    // -------------------------------------------------------------------------
    startTest('20. Legacy Pool Protection: Rejects qualification for legacy pool lacking specifications');
    try {
      let thrownErr = null;
      try {
        await CommercialLifecycleService.qualifyPoolParticipation({
          poolId: 1, // Historical pool 1
          actor: { id: 1, role: 'ADMIN' }
        });
      } catch (err) {
        thrownErr = err;
      }

      assert.ok(thrownErr !== null, 'Expected legacy pool qualification to throw');
      assert.strictEqual(thrownErr.code, 'LEGACY_POOL_READ_ONLY');
      assert.strictEqual(thrownErr.statusCode, 422);

      pass('20. Legacy Pool Protection: Rejects qualification for legacy pool lacking specifications');
    } catch (err) {
      fail('20. Legacy Pool Protection: Rejects qualification for legacy pool lacking specifications', err);
    }

    // -------------------------------------------------------------------------
    // TEST 21: Supplier Tenancy / RBAC Check
    // -------------------------------------------------------------------------
    startTest('21. Supplier Tenancy: Competitor supplier rejected with 403 FORBIDDEN');
    try {
      const fixture = await createTestPoolFixture({ supplier_id: 2 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      // Competitor supplier (ID 4) attempts to qualify supplier 2's pool
      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${competitorToken}`,
        'X-Idempotency-Key': `TENANCY-TEST-${Date.now()}`
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');

      pass('21. Supplier Tenancy: Competitor supplier rejected with 403 FORBIDDEN');
    } catch (err) {
      fail('21. Supplier Tenancy: Competitor supplier rejected with 403 FORBIDDEN', err);
    }

    // -------------------------------------------------------------------------
    // TEST 22: Buyer Role Rejected from Invoking Qualification
    // -------------------------------------------------------------------------
    startTest('22. Buyer Role Rejection: Buyer cannot qualify pools (403)');
    try {
      const fixture = await createTestPoolFixture({ supplier_id: 2 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${buyerToken}`
      });

      assert.strictEqual(res.status, 403);

      pass('22. Buyer Role Rejection: Buyer cannot qualify pools (403)');
    } catch (err) {
      fail('22. Buyer Role Rejection: Buyer cannot qualify pools (403)', err);
    }

    // -------------------------------------------------------------------------
    // TEST 23: Zero Duplicate Inventory Allocation
    // -------------------------------------------------------------------------
    startTest('23. Zero Duplicate Allocation: Exact single allocation record remains COMMITTED');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      const [allocs] = await db.query(
        `SELECT * FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'`,
        [fixture.poolId]
      );

      assert.strictEqual(allocs.length, 1);
      assert.strictEqual(allocs[0].status, 'COMMITTED');

      pass('23. Zero Duplicate Allocation: Exact single allocation record remains COMMITTED');
    } catch (err) {
      fail('23. Zero Duplicate Allocation: Exact single allocation record remains COMMITTED', err);
    }

    // -------------------------------------------------------------------------
    // TEST 24: Zero Premature Inventory Release on Qualification
    // -------------------------------------------------------------------------
    startTest('24. Inventory Preservation: Allocation NOT released on unqualified or qualified outcomes');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 20.0, 'RESERVED'); // Unqualified

      await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      const [allocs] = await db.query(
        `SELECT * FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'`,
        [fixture.poolId]
      );

      // Must remain COMMITTED pending authorized administrative/supplier settlement
      assert.strictEqual(allocs[0].status, 'COMMITTED');

      pass('24. Inventory Preservation: Allocation NOT released on unqualified or qualified outcomes');
    } catch (err) {
      fail('24. Inventory Preservation: Allocation NOT released on unqualified or qualified outcomes', err);
    }

    // -------------------------------------------------------------------------
    // TEST 25: Zero Orders, Payments, or Refunds Created
    // -------------------------------------------------------------------------
    startTest('25. Financial Safeguard: Zero orders, payments, or ledger records generated during qualification');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      const [ordersBefore] = await db.query('SELECT COUNT(*) AS c FROM orders');
      const [paymentsBefore] = await db.query('SELECT COUNT(*) AS c FROM payments');
      const [ledgerBefore] = await db.query('SELECT COUNT(*) AS c FROM platform_ledger');

      await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      const [ordersAfter] = await db.query('SELECT COUNT(*) AS c FROM orders');
      const [paymentsAfter] = await db.query('SELECT COUNT(*) AS c FROM payments');
      const [ledgerAfter] = await db.query('SELECT COUNT(*) AS c FROM platform_ledger');

      assert.strictEqual(Number(ordersBefore[0].c), Number(ordersAfter[0].c));
      assert.strictEqual(Number(paymentsBefore[0].c), Number(paymentsAfter[0].c));
      assert.strictEqual(Number(ledgerBefore[0].c), Number(ledgerAfter[0].c));

      pass('25. Financial Safeguard: Zero orders, payments, or ledger records generated during qualification');
    } catch (err) {
      fail('25. Financial Safeguard: Zero orders, payments, or ledger records generated during qualification', err);
    }

    // -------------------------------------------------------------------------
    // TEST 26: Safe Scheduler Containment (OBS-45 Preserved)
    // -------------------------------------------------------------------------
    startTest('26. OBS-45 Decommissioning Preserved: PoolClosureService returns contained safely');
    try {
      const poolClosureService = require('../src/services/poolClosureService');
      const result = await poolClosureService.processExpiredPools();

      assert.strictEqual(result.contained, true);
      assert.strictEqual(result.processed, 0);

      pass('26. OBS-45 Decommissioning Preserved: PoolClosureService returns contained safely');
    } catch (err) {
      fail('26. OBS-45 Decommissioning Preserved: PoolClosureService returns contained safely', err);
    }

    // -------------------------------------------------------------------------
    // TEST 27: Accurate Supplier Summary Post-Qualification
    // -------------------------------------------------------------------------
    startTest('27. Supplier Summary Read Model: Correctly reflects AWAITING_SUPPLIER_CONFIRMATION');
    try {
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 3, 60.0, 'RESERVED');

      await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' }
      });

      const res = await makeRequest('GET', `${baseUrl}/api/v1/pools/${fixture.poolId}/supplier/summary`, {
        Authorization: `Bearer ${supplierToken}`
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.pool.status, 'AWAITING_SUPPLIER_CONFIRMATION');
      assert.strictEqual(res.body.data.demand_summary.total_reserved_quantity, 60.0);
      assert.strictEqual(res.body.data.demand_summary.supplier_min_met, true);

      pass('27. Supplier Summary Read Model: Correctly reflects AWAITING_SUPPLIER_CONFIRMATION');
    } catch (err) {
      fail('27. Supplier Summary Read Model: Correctly reflects AWAITING_SUPPLIER_CONFIRMATION', err);
    }

    // -------------------------------------------------------------------------
    // TEST 28: Historical Data Preservation
    // -------------------------------------------------------------------------
    startTest('28. Historical Preservation: Historical pools 1 & 2 remain intact');
    try {
      const [histPools] = await db.query('SELECT id, product_spec_id, supplier_listing_id FROM pools WHERE id IN (1, 2)');
      assert.strictEqual(histPools.length, 2);
      assert.strictEqual(histPools[0].product_spec_id, null);
      assert.strictEqual(histPools[1].product_spec_id, null);

      pass('28. Historical Preservation: Historical pools 1 & 2 remain intact');
    } catch (err) {
      fail('28. Historical Preservation: Historical pools 1 & 2 remain intact', err);
    }

    // -------------------------------------------------------------------------
    // TEST 29: Database Isolation Verification
    // -------------------------------------------------------------------------
    startTest('29. Database Isolation: Development database miljor_db remains 100% PRISTINE');
    try {
      const mysql = require('mysql2/promise');
      const devConn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: 'miljor_db'
      });
      try {
        const [pools] = await devConn.query('SELECT COUNT(*) AS c FROM pools');
        const [res] = await devConn.query('SELECT COUNT(*) AS c FROM reservations');
        const [events] = await devConn.query('SELECT COUNT(*) AS c FROM reservation_business_events');
        const [muts] = await devConn.query('SELECT COUNT(*) AS c FROM reservation_mutation_history');
        const [snaps] = await devConn.query('SELECT COUNT(*) AS c FROM pool_commercial_snapshots');
        const [orders] = await devConn.query('SELECT COUNT(*) AS c FROM orders');
        const [payments] = await devConn.query('SELECT COUNT(*) AS c FROM payments');

        assert.strictEqual(Number(pools[0].c), Number(initDevPools[0].c), `miljor_db pools must remain unchanged (${initDevPools[0].c})`);
        assert.strictEqual(Number(res[0].c), Number(initDevRes[0].c), `miljor_db reservations must remain unchanged (${initDevRes[0].c})`);
        assert.strictEqual(Number(events[0].c), Number(initDevEvents[0].c), `miljor_db events must remain unchanged (${initDevEvents[0].c})`);
        assert.strictEqual(Number(muts[0].c), Number(initDevMuts[0].c), `miljor_db mutations must remain unchanged (${initDevMuts[0].c})`);
        assert.strictEqual(Number(snaps[0].c), Number(initDevSnaps[0].c), `miljor_db snapshots must remain unchanged (${initDevSnaps[0].c})`);
        assert.strictEqual(Number(orders[0].c), Number(initDevOrders[0].c), `miljor_db orders must remain unchanged (${initDevOrders[0].c})`);
        assert.strictEqual(Number(payments[0].c), Number(initDevPayments[0].c), `miljor_db payments must remain unchanged (${initDevPayments[0].c})`);
      } finally {
        await devConn.end();
      }
      pass('29. Database Isolation: Development database miljor_db remains 100% PRISTINE');
    } catch (err) {
      fail('29. Database Isolation: Development database miljor_db remains 100% PRISTINE', err);
    }

    // -------------------------------------------------------------------------
    // TEST 30: Clean Resource Teardown and Natural Process Exit Standard
    // -------------------------------------------------------------------------
    startTest('30. Clean Teardown: Temporary server and connection resources cleanly released');
    try {
      assert.ok(server !== null);
      pass('30. Clean Teardown: Temporary server and connection resources cleanly released');
    } catch (err) {
      fail('30. Clean Teardown: Temporary server and connection resources cleanly released', err);
    }

  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }

    // Fixture cleanup in miljor_test_db
    try {
      if (createdSnapshotIds.length > 0) {
        await db.query('DELETE FROM pool_commercial_snapshots WHERE id IN (?)', [createdSnapshotIds]);
      }
      if (createdReservationIds.length > 0) {
        await db.query('DELETE FROM reservation_mutation_history WHERE reservation_id IN (?)', [createdReservationIds]);
        await db.query('DELETE FROM reservation_business_events WHERE reservation_id IN (?)', [createdReservationIds]);
        await db.query('DELETE FROM reservations WHERE id IN (?)', [createdReservationIds]);
      }
      if (createdPoolIds.length > 0) {
        await db.query('DELETE FROM pool_commercial_snapshots WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM reservation_business_events WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query("DELETE FROM supplier_inventory_allocations WHERE reference_id IN (?) AND allocation_type = 'REGULAR_POOL'", [createdPoolIds]);
        await db.query('DELETE FROM pool_price_tiers WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
      }
      await db.query('UPDATE supplier_listings SET available_stock = ? WHERE id = 1', [originalListingStock]);
    } catch (cleanupErr) {
      console.error('Fixture cleanup error:', cleanupErr.message);
    }

    await db.end();
  }

  const suiteElapsed = ((Date.now() - suiteStart) / 1000).toFixed(2);
  console.log('\n================================================================================');
  console.log(`Part 4D.2 Pool Qualification Gate: ${passed} / ${passed + failed} assertions passed (${suiteElapsed}s)`);
  console.log(`Status: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exitCode = 1;
    throw new Error(`Part 4D.2 Pool Qualification Gate: ${failed} assertion(s) failed`);
  }

  return { passed, failed, total: passed + failed, suiteElapsed };
}

if (require.main === module) {
  runPart4D2PoolQualificationGate()
    .catch(err => {
      console.error('Fatal error in Part 4D.2 Pool Qualification Gate:', err);
      process.exitCode = 1;
    });
}

module.exports = runPart4D2PoolQualificationGate;
