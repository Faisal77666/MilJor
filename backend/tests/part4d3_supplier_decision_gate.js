// =============================================================================
// tests/part4d3_supplier_decision_gate.js
// MilJor Part 4D.3: Production-Grade Supplier Confirmation & Rejection Engine Gate
// Validates: Authoritative ACCEPT/REJECT workflows, OBS-65, OBS-66, OBS-67,
// deadline integrity, decision uniqueness, inventory preservation, privacy,
// crash-recovery reconciliation, and zero premature financial mutation.
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const { CommercialLifecycleService } = require('../src/services/commercialLifecycleService');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

// Tokens
const superAdminToken = generateToken(1, 'SUPER_ADMIN', 'VERIFIED');
const supplierToken = generateToken(2, 'SUPPLIER', 'VERIFIED'); // Tariq Mehmood (owning supplier)
const competitorSupplierToken = generateToken(3, 'SUPPLIER', 'VERIFIED'); // Abdul Razzaq (other supplier)
const unverifiedSupplierToken = generateToken(4, 'SUPPLIER', 'UNVERIFIED'); // Unverified supplier
const buyerToken = generateToken(5, 'BUYER', 'UNVERIFIED'); // Asif Khan

let testServer = null;
let baseUrl = '';

function makeRequest(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const postData = body ? JSON.stringify(body) : null;

    const reqHeaders = { ...headers };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method.toUpperCase(),
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch (e) {
          json = { raw: rawData };
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json
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

const createdPoolIds = [];
const createdIdempotencyKeys = [];

// Helper to create test pool fixture
async function createTestPoolFixture(overrides = {}) {
  const code = `P${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
  const expiresAt = overrides.expires_at || new Date(Date.now() - 3600000); // 1h in past
  const suppDeadline = overrides.supplier_confirmation_deadline || new Date(Date.now() + 24 * 3600000); // 24h in future
  const status = overrides.status || 'ACTIVE';

  const [res] = await db.query(
    `INSERT INTO pools (
      pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id,
      pool_unit, target_qty, supplier_min_qty, buyer_min_qty, max_capacity,
      purchase_increment, current_qty, current_price_per_unit, status, expires_at,
      supplier_confirmation_deadline
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      overrides.supplier_id || 2,
      1,
      1,
      1,
      'bag',
      overrides.target_qty || 100.0,
      overrides.supplier_min_qty || 50.0,
      1.0,
      overrides.max_capacity || 200.0,
      1.0,
      overrides.current_qty || 0.0,
      480.00,
      status,
      expiresAt,
      suppDeadline
    ]
  );
  const poolId = res.insertId;
  createdPoolIds.push(poolId);

  // Add tier pricing
  await db.query(
    `INSERT INTO pool_price_tiers (pool_id, min_qty, max_qty, price_per_unit, pricing_unit)
     VALUES (?, 1.0, 49.0, 500.00, 'bag'),
            (?, 50.0, 99.0, 480.00, 'bag'),
            (?, 100.0, 200.0, 460.00, 'bag')`,
    [poolId, poolId, poolId]
  );

  // Add committed inventory allocation if published
  if (status !== 'DRAFT') {
    await db.query(
      `INSERT INTO supplier_inventory_allocations (
        supplier_listing_id, allocation_type, reference_id,
        allocated_qty, unit, status
      ) VALUES (1, 'REGULAR_POOL', ?, ?, 'bag', 'COMMITTED')`,
      [poolId, overrides.max_capacity || 200.0]
    );
  }

  return { poolId, code };
}

async function addReservationFixture(poolId, buyerId, qty, status = 'RESERVED') {
  const code = `RES-${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
  const [res] = await db.query(
    `INSERT INTO reservations (
      reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status
    ) VALUES (?, ?, ?, ?, 480.00, ?, ?)`,
    [code, poolId, buyerId, qty, qty * 480.00, status]
  );
  return res.insertId;
}

// Creates and qualifies a pool fixture so it enters AWAITING_SUPPLIER_CONFIRMATION with a valid snapshot
async function createQualifiedPoolFixture(overrides = {}) {
  const fixture = await createTestPoolFixture({
    supplier_id: overrides.supplier_id || 2,
    supplier_min_qty: 50.0,
    target_qty: 100.0,
    max_capacity: 200.0,
    supplier_confirmation_deadline: overrides.supplier_confirmation_deadline || new Date(Date.now() + 24 * 3600000)
  });

  // Add 60 bags of buyer reservations (qualifies over supplier_min_qty 50.0)
  await addReservationFixture(fixture.poolId, 5, 60.0, 'RESERVED');

  // Qualify pool
  const qualResult = await CommercialLifecycleService.qualifyPoolParticipation({
    poolId: fixture.poolId,
    actor: { id: overrides.supplier_id || 2, role: 'SUPPLIER' },
    idempotencyKey: `QUAL-FIXTURE-${fixture.poolId}-${Date.now()}`
  });

  return {
    poolId: fixture.poolId,
    code: fixture.code,
    snapshotId: qualResult.data.snapshot_id,
    snapshotCode: qualResult.data.snapshot_code
  };
}

let passedTests = 0;
let totalTests = 0;

function startTest(desc) {
  totalTests++;
  process.stdout.write(`⏳ [RUN] ${desc}... `);
}

function pass(desc, durationMs = 0) {
  passedTests++;
  console.log(`✅ [PASS] ${desc} (${durationMs}ms)`);
}

function fail(desc, err) {
  console.log(`❌ [FAIL] ${desc}`);
  console.error(err);
  process.exitCode = 1;
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('🛡️ Starting MilJor Part 4D.3: Supplier Decision & Commercial Evidence Gate...');
  console.log('Target Database: miljor_test_db');
  console.log('='.repeat(80));

  try {
    const [dbInfo] = await db.query('SELECT DATABASE() AS db_name');
    assert.strictEqual(dbInfo[0].db_name, 'miljor_test_db', "Must run on 'miljor_test_db'");
    console.log(`✅ Database connected to ${dbInfo[0].db_name}\n`);

    // Capture pre-test baseline for miljor_db preservation
    const [initPools] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pools');
    const [initRes] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservations');
    const [initEvents] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservation_business_events');
    const [initSnaps] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pool_commercial_snapshots');
    const [initDecisions] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pool_supplier_commercial_decisions');

    testServer = http.createServer(app);
    await new Promise((resolve) => {
      testServer.listen(0, '127.0.0.1', () => {
        const port = testServer.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // =========================================================================
    // SECTION 1: PRE-IMPLEMENTATION OBSERVATIONS GATE (OBS-65, OBS-66, OBS-67)
    // =========================================================================

    startTest('1. OBS-65: Published ACTIVE pool cancellation strictly blocked through legacy endpoint (0 reservations)');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ status: 'ACTIVE' });
      // Active pool with zero buyer reservations, but commercial snapshots exist or status is published
      // Adding a snapshot to test commercial protection
      await db.query(
        `INSERT INTO pool_commercial_snapshots (
          snapshot_code, pool_id, qualification_status, participation_cutoff, supplier_id,
          product_id, pool_unit, eligible_aggregate_qty, supplier_min_qty, target_qty,
          max_capacity, candidate_unit_price, participating_reservations_summary, delivery_type, status
        ) VALUES (?, ?, 'QUALIFIED', NOW(), 2, 1, 'bag', 60.0, 50.0, 100.0, 200.0, 480.00, '[]', 'DOORSTEP', 'PENDING_SUPPLIER_DECISION')`,
        [`TEST-SNAP-${Date.now()}`, fixture.poolId]
      );

      const res = await makeRequest('PUT', `${baseUrl}/api/v1/pools/${fixture.poolId}/cancel`, {
        Authorization: `Bearer ${supplierToken}`
      }, { reason: 'Attempting to cancel commercially protected pool' });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'PROTECTED_POOL_CANCELLATION_BLOCKED');

      // Verify DB status remained ACTIVE
      const [poolRows] = await db.query('SELECT status FROM pools WHERE id = ?', [fixture.poolId]);
      assert.strictEqual(poolRows[0].status, 'ACTIVE');

      pass('1. OBS-65: Published ACTIVE pool cancellation strictly blocked through legacy endpoint (0 reservations)', Date.now() - t0);
    } catch (e) { fail('1. OBS-65: Published ACTIVE pool cancellation strictly blocked', e); }

    startTest('2. OBS-65: AWAITING_SUPPLIER_CONFIRMATION pool cancellation blocked for Admin callers (no bypass permitted)');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();

      const res = await makeRequest('PUT', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/cancel`, {
        Authorization: `Bearer ${superAdminToken}`
      });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'PROTECTED_POOL_CANCELLATION_BLOCKED');

      const [poolRows] = await db.query('SELECT status FROM pools WHERE id = ?', [qualFixture.poolId]);
      assert.strictEqual(poolRows[0].status, 'AWAITING_SUPPLIER_CONFIRMATION');

      pass('2. OBS-65: AWAITING_SUPPLIER_CONFIRMATION pool cancellation blocked for Admin callers (no bypass permitted)', Date.now() - t0);
    } catch (e) { fail('2. OBS-65: Cancellation blocked for Admin callers', e); }

    startTest('3. OBS-66: Migration 015 uq_snapshot_authoritative_outcome protects outcome uniqueness while permitting decisions');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ status: 'AWAITING_SUPPLIER_CONFIRMATION' });

      // Insert first snapshot in PENDING_SUPPLIER_DECISION
      const snapCode1 = `SNAP-66-A-${Date.now()}`;
      await db.query(
        `INSERT INTO pool_commercial_snapshots (
          snapshot_code, pool_id, snapshot_version, qualification_status, participation_cutoff,
          supplier_id, product_id, pool_unit, eligible_aggregate_qty, supplier_min_qty, target_qty,
          max_capacity, candidate_unit_price, participating_reservations_summary, delivery_type, status
        ) VALUES (?, ?, 1, 'QUALIFIED', NOW(), 2, 1, 'bag', 60.0, 50.0, 100.0, 200.0, 480.00, '[]', 'DOORSTEP', 'PENDING_SUPPLIER_DECISION')`,
        [snapCode1, fixture.poolId]
      );

      // Attempting to insert second snapshot in PENDING_SUPPLIER_DECISION must fail ER_DUP_ENTRY on authoritative_outcome_key
      let dupThrown = false;
      try {
        await db.query(
          `INSERT INTO pool_commercial_snapshots (
            snapshot_code, pool_id, snapshot_version, qualification_status, participation_cutoff,
            supplier_id, product_id, pool_unit, eligible_aggregate_qty, supplier_min_qty, target_qty,
            max_capacity, candidate_unit_price, participating_reservations_summary, delivery_type, status
          ) VALUES (?, ?, 2, 'QUALIFIED', NOW(), 2, 1, 'bag', 60.0, 50.0, 100.0, 200.0, 480.00, '[]', 'DOORSTEP', 'PENDING_SUPPLIER_DECISION')`,
          [`SNAP-66-B-${Date.now()}`, fixture.poolId]
        );
      } catch (err) {
        dupThrown = err.code === 'ER_DUP_ENTRY';
      }
      assert.ok(dupThrown, 'Expected ER_DUP_ENTRY duplicate constraint violation on authoritative_outcome_key');

      pass('3. OBS-66: Migration 015 uq_snapshot_authoritative_outcome protects outcome uniqueness while permitting decisions', Date.now() - t0);
    } catch (e) { fail('3. OBS-66: Migration 015 uniqueness check', e); }

    // =========================================================================
    // SECTION 2: AUTHORITATIVE SUPPLIER DECISION ENGINE (ACCEPT & REJECT)
    // =========================================================================

    startTest('4. Supplier Decision ACCEPT: Transitions pool to CONFIRMED and records immutable decision');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();
      const idemKey = `DEC-ACCEPT-${Date.now()}`;

      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idemKey
      }, {
        decision: 'ACCEPT',
        qualification_snapshot_id: qualFixture.snapshotId
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.pool_status, 'CONFIRMED');
      assert.strictEqual(res.body.data.decision, 'ACCEPT');
      assert.strictEqual(res.body.data.agreed_aggregate_qty, 60.0);
      assert.strictEqual(res.body.data.agreed_unit_price, 480.00);

      // Verify DB Pool status
      const [poolRows] = await db.query('SELECT status, confirmed_at FROM pools WHERE id = ?', [qualFixture.poolId]);
      assert.strictEqual(poolRows[0].status, 'CONFIRMED');
      assert.ok(poolRows[0].confirmed_at !== null);

      // Verify DB Snapshot status updated to ACCEPTED
      const [snapRows] = await db.query('SELECT status FROM pool_commercial_snapshots WHERE id = ?', [qualFixture.snapshotId]);
      assert.strictEqual(snapRows[0].status, 'ACCEPTED');

      // Verify immutable decision row in pool_supplier_commercial_decisions
      const [decRows] = await db.query('SELECT * FROM pool_supplier_commercial_decisions WHERE pool_id = ?', [qualFixture.poolId]);
      assert.strictEqual(decRows.length, 1);
      assert.strictEqual(decRows[0].decision, 'ACCEPT');
      assert.strictEqual(Number(decRows[0].agreed_aggregate_qty), 60.0);
      assert.strictEqual(Number(decRows[0].agreed_unit_price), 480.00);

      pass('4. Supplier Decision ACCEPT: Transitions pool to CONFIRMED and records immutable decision', Date.now() - t0);
    } catch (e) { fail('4. Supplier Decision ACCEPT', e); }

    startTest('5. Supplier Decision REJECT: Transitions pool to SUPPLIER_FAILED with reason code');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();
      const idemKey = `DEC-REJECT-${Date.now()}`;

      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idemKey
      }, {
        decision: 'REJECT',
        qualification_snapshot_id: qualFixture.snapshotId,
        rejection_reason_code: 'LOGISTICS_UNAVAILABLE',
        rejection_reason_notes: 'Lahore distribution vehicle broke down'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.pool_status, 'SUPPLIER_FAILED');
      assert.strictEqual(res.body.data.decision, 'REJECT');
      assert.strictEqual(res.body.data.rejection_reason_code, 'LOGISTICS_UNAVAILABLE');

      // Verify DB Pool status
      const [poolRows] = await db.query('SELECT status, closed_at FROM pools WHERE id = ?', [qualFixture.poolId]);
      assert.strictEqual(poolRows[0].status, 'SUPPLIER_FAILED');
      assert.ok(poolRows[0].closed_at !== null);

      // Verify DB Snapshot status updated to REJECTED
      const [snapRows] = await db.query('SELECT status FROM pool_commercial_snapshots WHERE id = ?', [qualFixture.snapshotId]);
      assert.strictEqual(snapRows[0].status, 'REJECTED');

      // Verify decision table
      const [decRows] = await db.query('SELECT * FROM pool_supplier_commercial_decisions WHERE pool_id = ?', [qualFixture.poolId]);
      assert.strictEqual(decRows.length, 1);
      assert.strictEqual(decRows[0].decision, 'REJECT');
      assert.strictEqual(decRows[0].rejection_reason_code, 'LOGISTICS_UNAVAILABLE');

      pass('5. Supplier Decision REJECT: Transitions pool to SUPPLIER_FAILED with reason code', Date.now() - t0);
    } catch (e) { fail('5. Supplier Decision REJECT', e); }

    startTest('6. Validation: REJECT decision without reason code rejected with 400 INVALID_REJECTION_REASON');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();

      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `DEC-MISSING-REASON-${Date.now()}`
      }, {
        decision: 'REJECT',
        qualification_snapshot_id: qualFixture.snapshotId
        // missing rejection_reason_code
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'INVALID_REJECTION_REASON');

      pass('6. Validation: REJECT decision without reason code rejected with 400', Date.now() - t0);
    } catch (e) { fail('6. Validation: REJECT decision without reason code rejected', e); }

    startTest('7. Validation: Unsupported decision verb rejected with 400 INVALID_DECISION');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();

      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `DEC-BAD-VERB-${Date.now()}`
      }, {
        decision: 'COUNTEROFFER', // Unsupported
        qualification_snapshot_id: qualFixture.snapshotId
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'INVALID_DECISION');

      pass('7. Validation: Unsupported decision verb rejected with 400 INVALID_DECISION', Date.now() - t0);
    } catch (e) { fail('7. Validation: Unsupported decision verb rejected', e); }

    startTest('8. Authorization: Ordinary ADMIN cannot submit supplier decision (403 UNAUTHORIZED_ROLE)');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();

      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Idempotency-Key': `DEC-ADMIN-FORGE-${Date.now()}`
      }, {
        decision: 'ACCEPT',
        qualification_snapshot_id: qualFixture.snapshotId
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'UNAUTHORIZED_ROLE');

      pass('8. Authorization: Ordinary ADMIN cannot submit supplier decision (403 UNAUTHORIZED_ROLE)', Date.now() - t0);
    } catch (e) { fail('8. Authorization: Ordinary ADMIN cannot submit supplier decision', e); }

    startTest('9. Authorization: Competitor supplier rejected with 403 FORBIDDEN (Tenancy check)');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture(); // Belongs to supplier 2

      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${competitorSupplierToken}`, // Supplier 3
        'X-Idempotency-Key': `DEC-COMPETITOR-${Date.now()}`
      }, {
        decision: 'ACCEPT',
        qualification_snapshot_id: qualFixture.snapshotId
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');

      pass('9. Authorization: Competitor supplier rejected with 403 FORBIDDEN (Tenancy check)', Date.now() - t0);
    } catch (e) { fail('9. Authorization: Competitor supplier rejected with 403 FORBIDDEN', e); }

    startTest('10. Authorization: Unverified supplier rejected with 403 SUPPLIER_NOT_VERIFIED');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();

      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${unverifiedSupplierToken}`,
        'X-Idempotency-Key': `DEC-UNVERIFIED-${Date.now()}`
      }, {
        decision: 'ACCEPT',
        qualification_snapshot_id: qualFixture.snapshotId
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'SUPPLIER_NOT_VERIFIED');

      pass('10. Authorization: Unverified supplier rejected with 403 SUPPLIER_NOT_VERIFIED', Date.now() - t0);
    } catch (e) { fail('10. Authorization: Unverified supplier rejected', e); }

    startTest('11. Deadline Integrity: Rejects decision when confirmation deadline has expired');
    try {
      const t0 = Date.now();
      // Create pool with confirmation deadline 1 hour in the past
      const qualFixture = await createQualifiedPoolFixture({
        supplier_confirmation_deadline: new Date(Date.now() - 3600000)
      });

      // Update snapshot deadline to past as well
      await db.query(
        'UPDATE pool_commercial_snapshots SET supplier_confirmation_deadline = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?',
        [qualFixture.snapshotId]
      );

      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `DEC-EXPIRED-DEADLINE-${Date.now()}`
      }, {
        decision: 'ACCEPT',
        qualification_snapshot_id: qualFixture.snapshotId
      });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'SUPPLIER_CONFIRMATION_DEADLINE_EXPIRED');

      pass('11. Deadline Integrity: Rejects decision when confirmation deadline has expired', Date.now() - t0);
    } catch (e) { fail('11. Deadline Integrity: Rejects decision when confirmation deadline has expired', e); }

    startTest('12. Idempotency Replay: Exact replay with same key returns cached decision');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();
      const idemKey = `DEC-IDEM-REPLAY-${Date.now()}`;

      // First decision call
      const res1 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idemKey
      }, {
        decision: 'ACCEPT',
        qualification_snapshot_id: qualFixture.snapshotId
      });
      assert.strictEqual(res1.status, 200);

      // Replay with exact same key
      const res2 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idemKey
      }, {
        decision: 'ACCEPT',
        qualification_snapshot_id: qualFixture.snapshotId
      });
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.decision_code, res1.body.data.decision_code);

      // Verify exactly ONE decision row exists
      const [decRows] = await db.query('SELECT COUNT(*) AS c FROM pool_supplier_commercial_decisions WHERE pool_id = ?', [qualFixture.poolId]);
      assert.strictEqual(decRows[0].c, 1);

      pass('12. Idempotency Replay: Exact replay with same key returns cached decision', Date.now() - t0);
    } catch (e) { fail('12. Idempotency Replay: Exact replay with same key returns cached decision', e); }

    startTest('13. Decision Conflict: Second decision with different key throws 409 POOL_DECISION_ALREADY_RECORDED');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();

      // Decision 1: ACCEPT
      await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `DEC-KEY-1-${Date.now()}`
      }, {
        decision: 'ACCEPT',
        qualification_snapshot_id: qualFixture.snapshotId
      });

      // Decision 2: Attempt REJECT with Key 2
      const res2 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `DEC-KEY-2-${Date.now()}`
      }, {
        decision: 'REJECT',
        qualification_snapshot_id: qualFixture.snapshotId,
        rejection_reason_code: 'PRICING_UNVIABLE'
      });

      assert.strictEqual(res2.status, 409);
      assert.strictEqual(res2.body.error.code, 'POOL_DECISION_ALREADY_RECORDED');

      pass('13. Decision Conflict: Second decision with different key throws 409 POOL_DECISION_ALREADY_RECORDED', Date.now() - t0);
    } catch (e) { fail('13. Decision Conflict: Second decision with different key throws 409', e); }

    startTest('14. Concurrency: Double decision race (ACCEPT vs REJECT) produces exactly one committed decision');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();

      // Launch concurrent ACCEPT and REJECT via service
      const [res1, res2] = await Promise.allSettled([
        CommercialLifecycleService.recordSupplierDecision({
          poolId: qualFixture.poolId,
          actor: { id: 2, role: 'SUPPLIER' },
          decision: 'ACCEPT',
          qualificationSnapshotId: qualFixture.snapshotId,
          idempotencyKey: `RACE-ACCEPT-${Date.now()}`
        }),
        CommercialLifecycleService.recordSupplierDecision({
          poolId: qualFixture.poolId,
          actor: { id: 2, role: 'SUPPLIER' },
          decision: 'REJECT',
          qualificationSnapshotId: qualFixture.snapshotId,
          rejectionReasonCode: 'CAPACITY_SHORTAGE',
          idempotencyKey: `RACE-REJECT-${Date.now()}`
        })
      ]);

      // Exactly one must succeed and one must fail with 409
      const fulfilled = [res1, res2].filter(r => r.status === 'fulfilled');
      const rejected = [res1, res2].filter(r => r.status === 'rejected');

      assert.strictEqual(fulfilled.length, 1, 'Expected exactly one decision to be fulfilled');
      assert.strictEqual(rejected.length, 1, 'Expected exactly one decision to be rejected');
      assert.strictEqual(rejected[0].reason.code, 'POOL_DECISION_ALREADY_RECORDED');

      // Verify DB has exactly one decision row
      const [decRows] = await db.query('SELECT COUNT(*) AS c FROM pool_supplier_commercial_decisions WHERE pool_id = ?', [qualFixture.poolId]);
      assert.strictEqual(decRows[0].c, 1);

      pass('14. Concurrency: Double decision race (ACCEPT vs REJECT) produces exactly one committed decision', Date.now() - t0);
    } catch (e) { fail('14. Concurrency: Double decision race produces exactly one committed decision', e); }

    startTest('15. Snapshot Uniqueness: uq_supplier_decisions_snapshot enforces DB-level uniqueness constraint');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();

      // Insert first decision directly in DB
      await db.query(
        `INSERT INTO pool_supplier_commercial_decisions (
          decision_code, pool_id, snapshot_id, snapshot_version, supplier_id,
          actor_id, actor_role, decision, agreed_aggregate_qty, agreed_unit_price
        ) VALUES (?, ?, ?, 1, 2, 2, 'SUPPLIER', 'ACCEPT', 60.0, 480.00)`,
        [`DEC-UQ-1-${Date.now()}`, qualFixture.poolId, qualFixture.snapshotId]
      );

      // Attempt second decision for same snapshot_id
      let dupThrown = false;
      try {
        await db.query(
          `INSERT INTO pool_supplier_commercial_decisions (
            decision_code, pool_id, snapshot_id, snapshot_version, supplier_id,
            actor_id, actor_role, decision, agreed_aggregate_qty, agreed_unit_price
          ) VALUES (?, ?, ?, 1, 2, 2, 'SUPPLIER', 'REJECT', 60.0, 480.00)`,
          [`DEC-UQ-2-${Date.now()}`, qualFixture.poolId, qualFixture.snapshotId]
        );
      } catch (err) {
        dupThrown = err.code === 'ER_DUP_ENTRY';
      }
      assert.ok(dupThrown, 'Expected ER_DUP_ENTRY duplicate constraint violation on uq_supplier_decisions_snapshot');

      pass('15. Snapshot Uniqueness: uq_supplier_decisions_snapshot enforces DB-level uniqueness constraint', Date.now() - t0);
    } catch (e) { fail('15. Snapshot Uniqueness: uq_supplier_decisions_snapshot check', e); }

    startTest('16. Event Outbox: Emits durable SUPPLIER_OFFER_ACCEPTED with transactional consistency');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();
      const idemKey = `DEC-EVENT-TEST-${Date.now()}`;

      await CommercialLifecycleService.recordSupplierDecision({
        poolId: qualFixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' },
        decision: 'ACCEPT',
        qualificationSnapshotId: qualFixture.snapshotId,
        idempotencyKey: idemKey
      });

      // Verify event outbox
      const [eventRows] = await db.query(
        "SELECT * FROM reservation_business_events WHERE pool_id = ? AND event_type = 'SUPPLIER_OFFER_ACCEPTED'",
        [qualFixture.poolId]
      );
      assert.strictEqual(eventRows.length, 1);
      assert.strictEqual(eventRows[0].actor_id, 2);
      assert.strictEqual(eventRows[0].actor_role, 'SUPPLIER');

      const payload = typeof eventRows[0].event_payload === 'string'
        ? JSON.parse(eventRows[0].event_payload)
        : eventRows[0].event_payload;
      assert.strictEqual(payload.decision, 'ACCEPT');
      assert.strictEqual(payload.new_pool_status, 'CONFIRMED');

      pass('16. Event Outbox: Emits durable SUPPLIER_OFFER_ACCEPTED with transactional consistency', Date.now() - t0);
    } catch (e) { fail('16. Event Outbox: Emits durable SUPPLIER_OFFER_ACCEPTED', e); }

    startTest('17. Inventory Safeguard: Committed inventory remains COMMITTED and is NOT released on ACCEPT or REJECT');
    try {
      const t0 = Date.now();
      const qualFixture1 = await createQualifiedPoolFixture();
      const qualFixture2 = await createQualifiedPoolFixture();

      // Case 1: ACCEPT
      await CommercialLifecycleService.recordSupplierDecision({
        poolId: qualFixture1.poolId,
        actor: { id: 2, role: 'SUPPLIER' },
        decision: 'ACCEPT',
        qualificationSnapshotId: qualFixture1.snapshotId,
        idempotencyKey: `INV-ACCEPT-${Date.now()}`
      });

      // Case 2: REJECT
      await CommercialLifecycleService.recordSupplierDecision({
        poolId: qualFixture2.poolId,
        actor: { id: 2, role: 'SUPPLIER' },
        decision: 'REJECT',
        qualificationSnapshotId: qualFixture2.snapshotId,
        rejectionReasonCode: 'FORCE_MAJEURE',
        idempotencyKey: `INV-REJECT-${Date.now()}`
      });

      // Verify allocations in both pools remain COMMITTED (Part 4D.3 does not prematurely release)
      const [alloc1] = await db.query('SELECT status FROM supplier_inventory_allocations WHERE reference_id = ?', [qualFixture1.poolId]);
      const [alloc2] = await db.query('SELECT status FROM supplier_inventory_allocations WHERE reference_id = ?', [qualFixture2.poolId]);

      assert.strictEqual(alloc1[0].status, 'COMMITTED');
      assert.strictEqual(alloc2[0].status, 'COMMITTED');

      pass('17. Inventory Safeguard: Committed inventory remains COMMITTED and is NOT released on ACCEPT or REJECT', Date.now() - t0);
    } catch (e) { fail('17. Inventory Safeguard: Committed inventory remains COMMITTED', e); }

    startTest('18. Financial Safeguards: Zero orders, payments, refunds, or locked buyer prices created');
    try {
      const t0 = Date.now();
      const [orderRows] = await db.query('SELECT COUNT(*) AS c FROM orders');
      const [payRows] = await db.query('SELECT COUNT(*) AS c FROM payments');
      const [lockedResRows] = await db.query('SELECT COUNT(*) AS c FROM reservations WHERE locked_unit_price IS NOT NULL');

      assert.strictEqual(orderRows[0].c, 0, 'Orders count must be strictly 0');
      assert.strictEqual(payRows[0].c, 0, 'Payments count must be strictly 0');
      assert.strictEqual(lockedResRows[0].c, 0, 'Locked prices count must be strictly 0');

      pass('18. Financial Safeguards: Zero orders, payments, refunds, or locked buyer prices created', Date.now() - t0);
    } catch (e) { fail('18. Financial Safeguards check', e); }

    startTest('19. Read Model: GET /api/v1/pools/:id/supplier-decision returns sanitized commercial outcome');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();

      // Record decision
      await CommercialLifecycleService.recordSupplierDecision({
        poolId: qualFixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' },
        decision: 'ACCEPT',
        qualificationSnapshotId: qualFixture.snapshotId,
        idempotencyKey: `READ-MODEL-TEST-${Date.now()}`
      });

      // Query read model as owner supplier
      const res = await makeRequest('GET', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.has_decision, true);
      assert.strictEqual(res.body.data.decision.decision, 'ACCEPT');
      assert.strictEqual(res.body.data.pool_status, 'CONFIRMED');

      // Verify zero buyer PII leaked in response
      assert.strictEqual(res.body.data.buyer_id, undefined);
      assert.strictEqual(res.body.data.participating_reservations_summary, undefined);

      pass('19. Read Model: GET /api/v1/pools/:id/supplier-decision returns sanitized commercial outcome', Date.now() - t0);
    } catch (e) { fail('19. Read Model: GET /api/v1/pools/:id/supplier-decision', e); }

    startTest('20. Read Model Privacy: Competitor supplier rejected with 403 FORBIDDEN');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();

      const res = await makeRequest('GET', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${competitorSupplierToken}`
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');

      pass('20. Read Model Privacy: Competitor supplier rejected with 403 FORBIDDEN', Date.now() - t0);
    } catch (e) { fail('20. Read Model Privacy: Competitor supplier rejected', e); }

    startTest('21. Crash Recovery: Idempotency reconciliation recovers committed decision on lost response');
    try {
      const t0 = Date.now();
      const qualFixture = await createQualifiedPoolFixture();
      const idemKey = `DEC-CRASH-${Date.now()}`;
      createdIdempotencyKeys.push(idemKey);

      // Call decision endpoint
      const res1 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idemKey
      }, {
        decision: 'ACCEPT',
        qualification_snapshot_id: qualFixture.snapshotId
      });
      assert.strictEqual(res1.status, 200);

      // Simulate a crashed/stalled worker by setting status to PENDING, resetting response, and expiring heartbeat (>60s)
      await db.query(
        "UPDATE idempotency_records SET status = 'PENDING', response_status = 0, response_body = '', resource_type = 'pools', resource_id = ?, last_heartbeat_at = DATE_SUB(NOW(), INTERVAL 70 SECOND), created_at = DATE_SUB(NOW(), INTERVAL 70 SECOND) WHERE idempotency_key = ?",
        [qualFixture.poolId, idemKey]
      );

      // Replay request with same key
      const res2 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${qualFixture.poolId}/supplier-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idemKey
      }, {
        decision: 'ACCEPT',
        qualification_snapshot_id: qualFixture.snapshotId
      });

      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.decision, 'ACCEPT');
      assert.strictEqual(res2.body.data.pool_status, 'CONFIRMED');

      pass('21. Crash Recovery: Idempotency reconciliation recovers committed decision on lost response', Date.now() - t0);
    } catch (e) { fail('21. Crash Recovery: Idempotency reconciliation', e); }

    startTest('22. Database Isolation: Development database miljor_db remains 100% PRISTINE');
    try {
      const t0 = Date.now();
      const devConn = await db.getConnection();
      try {
        const [pools] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.pools');
        const [res] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.reservations');
        const [events] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.reservation_business_events');
        const [snaps] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.pool_commercial_snapshots');
        const [decisions] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.pool_supplier_commercial_decisions');

        assert.strictEqual(pools[0].c, initPools[0].c, `miljor_db pools must remain unchanged (${initPools[0].c})`);
        assert.strictEqual(res[0].c, initRes[0].c, `miljor_db reservations must remain unchanged (${initRes[0].c})`);
        assert.strictEqual(events[0].c, initEvents[0].c, `miljor_db events must remain unchanged (${initEvents[0].c})`);
        assert.strictEqual(snaps[0].c, initSnaps[0].c, `miljor_db commercial snapshots must remain unchanged (${initSnaps[0].c})`);
        assert.strictEqual(decisions[0].c, initDecisions[0].c, `miljor_db supplier decisions must remain unchanged (${initDecisions[0].c})`);
      } finally {
        devConn.release();
      }

      pass('22. Database Isolation: Development database miljor_db remains 100% PRISTINE', Date.now() - t0);
    } catch (e) { fail('22. Database Isolation: miljor_db verification failed', e); }

  } finally {
    // Teardown test fixtures
    if (createdIdempotencyKeys.length > 0) {
      try {
        await db.query('DELETE FROM idempotency_records WHERE idempotency_key IN (?)', [createdIdempotencyKeys]);
      } catch (e) {}
    }

    if (createdPoolIds.length > 0) {
      try {
        await db.query('DELETE FROM pool_supplier_commercial_decisions WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pool_commercial_snapshots WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM reservation_business_events WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM supplier_inventory_allocations WHERE reference_id IN (?) AND allocation_type = "REGULAR_POOL"', [createdPoolIds]);
        await db.query('DELETE FROM reservations WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pool_price_tiers WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
      } catch (cleanupErr) {
        console.error('Fixture cleanup warning:', cleanupErr.message);
      }
    }

    if (testServer) {
      await new Promise(r => testServer.close(r));
    }
  }

  console.log('='.repeat(80));
  console.log(`Part 4D.3 Supplier Decision Gate: ${passedTests} / ${totalTests} assertions passed`);
  console.log(`Status: ${passedTests === totalTests ? 'PASS' : 'FAIL'}`);
  console.log('='.repeat(80));

  if (passedTests !== totalTests) {
    throw new Error(`Part 4D.3 Supplier Decision Gate: ${totalTests - passedTests} assertions failed`);
  }
}

if (require.main === module) {
  runSuite()
    .then(async () => {
      await db.end();
      process.exitCode = 0;
    })
    .catch(async (err) => {
      console.error('Fatal suite failure:', err);
      try { await db.end(); } catch (e) {}
      process.exitCode = 1;
    });
}

module.exports = { runSuite };
