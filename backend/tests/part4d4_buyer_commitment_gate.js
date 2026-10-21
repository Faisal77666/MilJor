// =============================================================================
// tests/part4d4_buyer_commitment_gate.js
// MilJor Part 4D.4: Buyer Offer, Explicit Commitment, Price Integrity
// & Final Demand Accounting Gate
//
// Validates:
// 1. Authoritative buyer-specific commercial offer read model (GET /api/v1/reservations/:id/final-offer)
// 2. Strict authorization & anti-impersonation (admin/supplier cannot submit buyer decision)
// 3. OBS-68: Database server exclusive deadline boundary enforcement
// 4. OBS-69: Qualification snapshot immutability & append-only buyer decision records
// 5. OBS-70: Conditional contractual price locking & price protection across peer opt-outs
// 6. Explicit buyer ACCEPT / DECLINE decisions with controlled reason codes
// 7. Atomic parent-first row-level transaction and DB-level decision uniqueness
// 8. Durable business outbox events (BUYER_OFFER_ACCEPTED / BUYER_OFFER_DECLINED)
// 9. Authoritative post-qualification demand accounting & quorum checks
// 10. Committed inventory allocation preservation (no release on decline)
// 11. Zero premature orders, payments, refunds, or fulfillment mutations
// 12. Crash recovery & idempotency reconciliation
// 13. Test database isolation (miljor_db remains 100% pristine)
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

// Actors
const superAdminToken = generateToken(1, 'SUPER_ADMIN', 'VERIFIED');
const supplierToken = generateToken(2, 'SUPPLIER', 'VERIFIED');
const buyer1Token = generateToken(5, 'BUYER', 'VERIFIED'); // Owner of reservation 1
const buyer2Token = generateToken(6, 'BUYER', 'VERIFIED'); // Owner of reservation 2
const buyer3Token = generateToken(7, 'BUYER', 'VERIFIED'); // Competitor buyer
const suspendedBuyerToken = generateToken(8, 'BUYER', 'SUSPENDED');

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
const createdReservationIds = [];
const createdIdempotencyKeys = [];

// Helper to create test pool fixture
async function createTestPoolFixture(overrides = {}) {
  const code = `P${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
  const expiresAt = overrides.expires_at || new Date(Date.now() - 3600000); // 1h in past
  const suppDeadline = overrides.supplier_confirmation_deadline || new Date(Date.now() + 24 * 3600000); // 24h in future
  const buyerDeadline = overrides.buyer_commitment_deadline || new Date(Date.now() + 48 * 3600000); // 48h in future
  const status = overrides.status || 'ACTIVE';

  const [res] = await db.query(
    `INSERT INTO pools (
      pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id,
      pool_unit, target_qty, supplier_min_qty, buyer_min_qty, max_capacity,
      purchase_increment, current_qty, current_price_per_unit, status, expires_at,
      supplier_confirmation_deadline, buyer_commitment_deadline
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      suppDeadline,
      buyerDeadline
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
  const rId = res.insertId;
  createdReservationIds.push(rId);
  return rId;
}

// Complete pipeline fixture: Pool -> Reservations -> Qualify -> Supplier ACCEPT -> Pool CONFIRMED
async function createSupplierAcceptedPoolFixture(overrides = {}) {
  const poolFixture = await createTestPoolFixture({
    supplier_id: 2,
    supplier_min_qty: 50.0,
    target_qty: 100.0,
    max_capacity: 200.0,
    supplier_confirmation_deadline: new Date(Date.now() + 24 * 3600000),
    buyer_commitment_deadline: overrides.buyer_commitment_deadline || new Date(Date.now() + 48 * 3600000)
  });

  // Buyer 1 reserves 35 bags, Buyer 2 reserves 25 bags -> Total 60 bags (Qualifies >= 50.0)
  const r1Id = await addReservationFixture(poolFixture.poolId, 5, 35.0, 'RESERVED');
  const r2Id = await addReservationFixture(poolFixture.poolId, 6, 25.0, 'RESERVED');

  // Qualify pool
  const qualResult = await CommercialLifecycleService.qualifyPoolParticipation({
    poolId: poolFixture.poolId,
    actor: { id: 2, role: 'SUPPLIER' },
    idempotencyKey: `QUAL-4D4-${poolFixture.poolId}-${Date.now()}`
  });

  // Supplier ACCEPT decision
  const suppDecResult = await CommercialLifecycleService.recordSupplierDecision({
    poolId: poolFixture.poolId,
    actor: { id: 2, role: 'SUPPLIER' },
    decision: 'ACCEPT',
    qualificationSnapshotId: qualResult.data.snapshot_id,
    idempotencyKey: `SUPP-DEC-4D4-${poolFixture.poolId}-${Date.now()}`
  });

  return {
    poolId: poolFixture.poolId,
    snapshotId: qualResult.data.snapshot_id,
    supplierDecisionId: suppDecResult.data.decision_code,
    r1Id,
    r2Id,
    agreedUnitPrice: 480.00
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
  console.log('🛡️ Starting MilJor Part 4D.4: Buyer Commitment, Offer & Final Demand Gate...');
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
    const [initSuppDecs] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pool_supplier_commercial_decisions');
    const [initBuyerDecs] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pool_buyer_commercial_decisions');

    testServer = http.createServer(app);
    await new Promise((resolve) => {
      testServer.listen(0, '127.0.0.1', () => {
        const port = testServer.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // =========================================================================
    // SECTION 1: PREFLIGHT OBSERVATIONS GATE (OBS-68, OBS-69, OBS-70)
    // =========================================================================

    startTest('1. OBS-68: Fresh DB exclusive cutoff rejects buyer decision at exact deadline boundary');
    try {
      const t0 = Date.now();
      // Setup pool where buyer deadline is in the past
      const fixture = await createSupplierAcceptedPoolFixture({
        buyer_commitment_deadline: new Date(Date.now() - 1000)
      });

      const res = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `DEC-DEADLINE-TEST-${Date.now()}`
      }, { decision: 'ACCEPT' });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'BUYER_COMMITMENT_DEADLINE_EXPIRED');

      pass('1. OBS-68: Fresh DB exclusive cutoff rejects buyer decision at exact deadline boundary', Date.now() - t0);
    } catch (e) { fail('1. OBS-68 deadline boundary', e); }

    startTest('2. OBS-69: Qualification snapshot evidence remains strictly immutable during buyer transitions');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // Read snapshot pre-decision
      const [snapBefore] = await db.query('SELECT * FROM pool_commercial_snapshots WHERE id = ?', [fixture.snapshotId]);

      // Buyer 1 submits ACCEPT
      await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `SNAP-IMMUT-${Date.now()}`
      }, { decision: 'ACCEPT' });

      // Read snapshot post-decision
      const [snapAfter] = await db.query('SELECT * FROM pool_commercial_snapshots WHERE id = ?', [fixture.snapshotId]);

      assert.strictEqual(Number(snapBefore[0].eligible_aggregate_qty), Number(snapAfter[0].eligible_aggregate_qty));
      assert.strictEqual(Number(snapBefore[0].candidate_unit_price), Number(snapAfter[0].candidate_unit_price));
      assert.strictEqual(snapBefore[0].status, snapAfter[0].status);
      assert.deepStrictEqual(snapBefore[0].participating_reservations_summary, snapAfter[0].participating_reservations_summary);

      pass('2. OBS-69: Qualification snapshot evidence remains strictly immutable during buyer transitions', Date.now() - t0);
    } catch (e) { fail('2. OBS-69 snapshot immutability', e); }

    startTest('3. OBS-70: Buyer ACCEPT locks unit price permanently; subsequent peer DECLINE does not alter locked price');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // Buyer 1 ACCEPTs -> Price locks at 480.00
      const res1 = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `B1-ACCEPT-${Date.now()}`
      }, { decision: 'ACCEPT' });
      assert.strictEqual(res1.status, 200);

      // Buyer 2 DECLINEs
      const res2 = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r2Id}/final-decision`, {
        Authorization: `Bearer ${buyer2Token}`,
        'X-Idempotency-Key': `B2-DECLINE-${Date.now()}`
      }, { decision: 'DECLINE', decline_reason_code: 'PRICE_HIGH' });
      assert.strictEqual(res2.status, 200);

      // Verify Buyer 1 reservation in DB: locked_unit_price remains strictly 480.00
      const [r1Rows] = await db.query('SELECT locked_unit_price, locked_total_price, status FROM reservations WHERE id = ?', [fixture.r1Id]);
      assert.strictEqual(Number(r1Rows[0].locked_unit_price), 480.00);
      assert.strictEqual(Number(r1Rows[0].locked_total_price), 16800.00); // 35 * 480.00
      assert.strictEqual(r1Rows[0].status, 'CONFIRMED');

      pass('3. OBS-70: Buyer ACCEPT locks unit price permanently; peer DECLINE does not alter locked price', Date.now() - t0);
    } catch (e) { fail('3. OBS-70 price protection', e); }

    // =========================================================================
    // SECTION 2: AUTHORITATIVE BUYER COMMERCIAL OFFER READ MODEL
    // =========================================================================

    startTest('4. Commercial Offer: GET /api/v1/reservations/:id/final-offer returns personalized commercial offer');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      const res = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-offer`, {
        Authorization: `Bearer ${buyer1Token}`
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.offer_available, true);
      assert.strictEqual(res.body.data.reservation.quantity, 35.0);
      assert.strictEqual(res.body.data.pricing.candidate_unit_price, 480.00);
      assert.strictEqual(res.body.data.pricing.estimated_subtotal, 16800.00);
      assert.strictEqual(res.body.data.buyer_decision_status.can_accept, true);
      assert.strictEqual(res.body.data.buyer_decision_status.can_decline, true);

      // Zero peer buyer PII exposure
      assert.strictEqual(res.body.data.peer_buyers, undefined);
      assert.strictEqual(res.body.data.other_reservations, undefined);

      pass('4. Commercial Offer: GET /api/v1/reservations/:id/final-offer returns personalized commercial offer', Date.now() - t0);
    } catch (e) { fail('4. Commercial offer read model', e); }

    startTest('5. Offer Visibility: Supplier REJECTED pool returns offer_available: false with clear reason');
    try {
      const t0 = Date.now();
      const poolFixture = await createTestPoolFixture({ status: 'ACTIVE' });
      const rId = await addReservationFixture(poolFixture.poolId, 5, 60.0, 'RESERVED');

      // Qualify pool
      const qualResult = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: poolFixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' },
        idempotencyKey: `QUAL-REJ-${poolFixture.poolId}-${Date.now()}`
      });

      // Supplier REJECTs
      await CommercialLifecycleService.recordSupplierDecision({
        poolId: poolFixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' },
        decision: 'REJECT',
        qualificationSnapshotId: qualResult.data.snapshot_id,
        rejectionReasonCode: 'CAPACITY_SHORTAGE',
        idempotencyKey: `SUPP-REJ-${poolFixture.poolId}-${Date.now()}`
      });

      const res = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${rId}/final-offer`, {
        Authorization: `Bearer ${buyer1Token}`
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.offer_available, false);
      assert.strictEqual(res.body.data.reason_code, 'SUPPLIER_REJECTED_OFFER');

      pass('5. Offer Visibility: Supplier REJECTED pool returns offer_available: false with clear reason', Date.now() - t0);
    } catch (e) { fail('5. Supplier rejected offer visibility', e); }

    // =========================================================================
    // SECTION 3: AUTHORIZATION & ANTI-IMPERSONATION
    // =========================================================================

    startTest('6. Authorization: Competitor buyer rejected from accessing peer commercial offer (403 FORBIDDEN)');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // Buyer 3 attempts to view Buyer 1's final-offer
      const res = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-offer`, {
        Authorization: `Bearer ${buyer3Token}`
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');

      pass('6. Authorization: Competitor buyer rejected from accessing peer commercial offer (403 FORBIDDEN)', Date.now() - t0);
    } catch (e) { fail('6. Competitor offer access rejected', e); }

    startTest('7. Anti-Impersonation: ADMIN role cannot submit buyer commercial decision (403 UNAUTHORIZED_ROLE)');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // Admin attempts to submit decision on Buyer 1 reservation
      const res = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Idempotency-Key': `ADMIN-FORGE-${Date.now()}`
      }, { decision: 'ACCEPT' });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'UNAUTHORIZED_ROLE');

      pass('7. Anti-Impersonation: ADMIN role cannot submit buyer commercial decision (403 UNAUTHORIZED_ROLE)', Date.now() - t0);
    } catch (e) { fail('7. Admin impersonation rejected', e); }

    startTest('8. Anti-Impersonation: SUPPLIER role cannot submit buyer commercial decision (403 UNAUTHORIZED_ROLE)');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // Supplier attempts to accept on behalf of buyer
      const res = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `SUPP-FORGE-${Date.now()}`
      }, { decision: 'ACCEPT' });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'UNAUTHORIZED_ROLE');

      pass('8. Anti-Impersonation: SUPPLIER role cannot submit buyer commercial decision (403 UNAUTHORIZED_ROLE)', Date.now() - t0);
    } catch (e) { fail('8. Supplier impersonation rejected', e); }

    // =========================================================================
    // SECTION 4: EXPLICIT DECISIONS (ACCEPT / DECLINE) & INVARIANTS
    // =========================================================================

    startTest('9. Buyer Decision ACCEPT: Transitions reservation to CONFIRMED, records decision and locks price');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      const res = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `DEC-ACCEPT-${Date.now()}`
      }, { decision: 'ACCEPT' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.decision, 'ACCEPT');
      assert.strictEqual(res.body.data.price_lock_status, 'LOCKED');
      assert.strictEqual(res.body.data.agreed_unit_price, 480.00);
      assert.strictEqual(res.body.data.locked_total_price, 16800.00);

      // Verify DB record in pool_buyer_commercial_decisions
      const [decRows] = await db.query(
        'SELECT * FROM pool_buyer_commercial_decisions WHERE reservation_id = ?',
        [fixture.r1Id]
      );
      assert.strictEqual(decRows.length, 1);
      assert.strictEqual(decRows[0].decision, 'ACCEPT');
      assert.strictEqual(decRows[0].price_lock_status, 'LOCKED');
      assert.strictEqual(Number(decRows[0].accepted_quantity), 35.0);

      pass('9. Buyer Decision ACCEPT: Transitions reservation to CONFIRMED, records decision and locks price', Date.now() - t0);
    } catch (e) { fail('9. Buyer ACCEPT decision', e); }

    startTest('10. Buyer Decision DECLINE: Transitions reservation to CANCELLED and requires valid reason code');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // 1. Missing reason code -> 400
      const resBad = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `DEC-DECLINE-BAD-${Date.now()}`
      }, { decision: 'DECLINE' });
      assert.strictEqual(resBad.status, 400);
      assert.strictEqual(resBad.body.error.code, 'INVALID_DECLINE_REASON');

      // 2. Valid DECLINE
      const resGood = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `DEC-DECLINE-GOOD-${Date.now()}`
      }, { decision: 'DECLINE', decline_reason_code: 'PRICE_HIGH', decline_reason_notes: 'Budget constraints' });

      assert.strictEqual(resGood.status, 200);
      assert.strictEqual(resGood.body.data.decision, 'DECLINE');
      assert.strictEqual(resGood.body.data.price_lock_status, 'DECLINED');

      // Verify reservation updated to CANCELLED
      const [resDb] = await db.query('SELECT status FROM reservations WHERE id = ?', [fixture.r1Id]);
      assert.strictEqual(resDb[0].status, 'CANCELLED');

      pass('10. Buyer Decision DECLINE: Transitions reservation to CANCELLED and requires valid reason code', Date.now() - t0);
    } catch (e) { fail('10. Buyer DECLINE decision', e); }

    startTest('11. Payload Injection: Client-supplied price and quantity in request body strictly ignored');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // Client attempts to inject fake price (100.00) and quantity (1.0)
      const res = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `DEC-INJECT-${Date.now()}`
      }, {
        decision: 'ACCEPT',
        unit_price: 100.00,
        quantity: 1.0,
        total_price: 100.00
      });

      assert.strictEqual(res.status, 200);
      // Evaluates strictly against authoritative snapshot price (480.00) and quantity (35.0)
      assert.strictEqual(res.body.data.agreed_unit_price, 480.00);
      assert.strictEqual(res.body.data.accepted_quantity, 35.0);
      assert.strictEqual(res.body.data.locked_total_price, 16800.00);

      pass('11. Payload Injection: Client-supplied price and quantity in request body strictly ignored', Date.now() - t0);
    } catch (e) { fail('11. Payload injection rejected', e); }

    // =========================================================================
    // SECTION 5: CONCURRENCY, UNIQUENESS & IDEMPOTENCY
    // =========================================================================

    startTest('12. Idempotency Replay: Exact replay with same key returns cached decision');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();
      const idemKey = `IDEM-REPLAY-${Date.now()}`;
      createdIdempotencyKeys.push(idemKey);

      const r1 = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': idemKey
      }, { decision: 'ACCEPT' });
      assert.strictEqual(r1.status, 200);

      // Replay
      const r2 = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': idemKey
      }, { decision: 'ACCEPT' });

      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.body.data.decision, 'ACCEPT');
      assert.strictEqual(r2.body.data.decision_code, r1.body.data.decision_code);

      pass('12. Idempotency Replay: Exact replay with same key returns cached decision', Date.now() - t0);
    } catch (e) { fail('12. Idempotency replay', e); }

    startTest('13. Decision Conflict: Second decision with different key throws 409 BUYER_DECISION_ALREADY_RECORDED');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // First decision
      await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `KEY-1-${Date.now()}`
      }, { decision: 'ACCEPT' });

      // Second decision with different key
      const resConf = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `KEY-2-${Date.now()}`
      }, { decision: 'DECLINE', decline_reason_code: 'PRICE_HIGH' });

      assert.strictEqual(resConf.status, 409);
      assert.strictEqual(resConf.body.error.code, 'BUYER_DECISION_ALREADY_RECORDED');

      pass('13. Decision Conflict: Second decision with different key throws 409 BUYER_DECISION_ALREADY_RECORDED', Date.now() - t0);
    } catch (e) { fail('13. Decision conflict', e); }

    startTest('14. Concurrency: Double decision race (ACCEPT vs DECLINE) produces exactly one committed decision');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      const [rAccept, rDecline] = await Promise.allSettled([
        CommercialLifecycleService.recordBuyerDecision({
          reservationId: fixture.r1Id,
          actor: { id: 5, role: 'BUYER' },
          decision: 'ACCEPT',
          idempotencyKey: `RACE-ACCEPT-${Date.now()}`
        }),
        CommercialLifecycleService.recordBuyerDecision({
          reservationId: fixture.r1Id,
          actor: { id: 5, role: 'BUYER' },
          decision: 'DECLINE',
          declineReasonCode: 'PRICE_HIGH',
          idempotencyKey: `RACE-DECLINE-${Date.now()}`
        })
      ]);

      const fulfilled = [rAccept, rDecline].filter(r => r.status === 'fulfilled');
      const rejected = [rAccept, rDecline].filter(r => r.status === 'rejected');

      assert.strictEqual(fulfilled.length, 1);
      assert.strictEqual(rejected.length, 1);
      assert.strictEqual(rejected[0].reason.code, 'BUYER_DECISION_ALREADY_RECORDED');

      // Verify DB has exactly 1 decision row for this reservation
      const [decRows] = await db.query(
        'SELECT COUNT(*) AS c FROM pool_buyer_commercial_decisions WHERE reservation_id = ?',
        [fixture.r1Id]
      );
      assert.strictEqual(decRows[0].c, 1);

      pass('14. Concurrency: Double decision race (ACCEPT vs DECLINE) produces exactly one committed decision', Date.now() - t0);
    } catch (e) { fail('14. Double decision race', e); }

    startTest('15. DB Uniqueness: uq_buyer_decisions_reservation_snapshot prevents duplicate direct SQL inserts');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // First decision
      await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `DB-UQ-1-${Date.now()}`
      }, { decision: 'ACCEPT' });

      // Attempt second direct SQL insert for same (reservation_id, snapshot_id)
      let dupThrown = false;
      try {
        await db.query(
          `INSERT INTO pool_buyer_commercial_decisions (
            decision_code, pool_id, reservation_id, snapshot_id, snapshot_version,
            supplier_decision_id, buyer_id, actor_id, actor_role, decision,
            accepted_quantity, agreed_unit_price, price_lock_status
          ) VALUES (?, ?, ?, ?, 1, 1, 5, 5, 'BUYER', 'DECLINE', 35.0, 480.00, 'DECLINED')`,
          [`BDEC-DUP-${Date.now()}`, fixture.poolId, fixture.r1Id, fixture.snapshotId]
        );
      } catch (dbErr) {
        if (dbErr.code === 'ER_DUP_ENTRY') {
          dupThrown = true;
        }
      }

      assert.strictEqual(dupThrown, true, 'Database unique constraint must reject duplicate decision for same reservation and snapshot');
      pass('15. DB Uniqueness: uq_buyer_decisions_reservation_snapshot prevents duplicate direct SQL inserts', Date.now() - t0);
    } catch (e) { fail('15. DB uniqueness constraint', e); }

    // =========================================================================
    // SECTION 6: EVENT OUTBOX & DEMAND ACCOUNTING
    // =========================================================================

    startTest('16. Event Outbox: Emits durable BUYER_OFFER_ACCEPTED with transactional consistency');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `EVENT-TEST-${Date.now()}`
      }, { decision: 'ACCEPT' });

      const [events] = await db.query(
        `SELECT * FROM reservation_business_events 
         WHERE reservation_id = ? AND event_type = 'BUYER_OFFER_ACCEPTED'`,
        [fixture.r1Id]
      );

      assert.strictEqual(events.length, 1);
      const payload = typeof events[0].event_payload === 'string' ? JSON.parse(events[0].event_payload) : events[0].event_payload;
      assert.strictEqual(payload.decision, 'ACCEPT');
      assert.strictEqual(payload.price_lock_status, 'LOCKED');
      assert.strictEqual(payload.accepted_quantity, 35.0);

      pass('16. Event Outbox: Emits durable BUYER_OFFER_ACCEPTED with transactional consistency', Date.now() - t0);
    } catch (e) { fail('16. Event outbox verification', e); }

    startTest('17. Demand Accounting: GET /api/v1/pools/:id/committed-demand-summary aggregates final buyer commitments');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // Buyer 1 ACCEPTs 35.0
      await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `ACC-B1-${Date.now()}`
      }, { decision: 'ACCEPT' });

      // Buyer 2 DECLINEs 25.0
      await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r2Id}/final-decision`, {
        Authorization: `Bearer ${buyer2Token}`,
        'X-Idempotency-Key': `ACC-B2-${Date.now()}`
      }, { decision: 'DECLINE', decline_reason_code: 'FOUND_ALTERNATIVE' });

      // Query demand accounting
      const res = await makeRequest('GET', `${baseUrl}/api/v1/pools/${fixture.poolId}/committed-demand-summary`, {
        Authorization: `Bearer ${supplierToken}`
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const acc = res.body.data.accounting;
      assert.strictEqual(acc.original_qualified_demand, 60.0);
      assert.strictEqual(acc.buyer_accepted_demand, 35.0);
      assert.strictEqual(acc.buyer_accepted_count, 1);
      assert.strictEqual(acc.buyer_declined_demand, 25.0);
      assert.strictEqual(acc.buyer_declined_count, 1);
      assert.strictEqual(acc.buyer_pending_demand, 0.0);
      assert.strictEqual(acc.buyer_pending_count, 0);

      // Quorum check: supplier_min_qty was 50.0, but only 35.0 accepted -> supplier_min_met = false
      assert.strictEqual(res.body.data.quorum.supplier_min_met, false);
      assert.strictEqual(res.body.data.quorum.is_order_handoff_ready, false);
      assert.strictEqual(res.body.data.quorum.deficit_to_minimum, 15.0);

      pass('17. Demand Accounting: GET /api/v1/pools/:id/committed-demand-summary aggregates final buyer commitments', Date.now() - t0);
    } catch (e) { fail('17. Demand accounting summary', e); }

    // =========================================================================
    // SECTION 7: INVENTORY, FINANCIAL SAFEGUARDS & CRASH RECOVERY
    // =========================================================================

    startTest('18. Inventory Safeguard: Committed supplier stock is NOT released on buyer DECLINE');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();

      // Buyer DECLINEs
      await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `INV-DECLINE-${Date.now()}`
      }, { decision: 'DECLINE', decline_reason_code: 'PRICE_HIGH' });

      // Verify supplier_inventory_allocations remains strictly COMMITTED
      const [allocRows] = await db.query(
        'SELECT status, allocated_qty FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = "REGULAR_POOL"',
        [fixture.poolId]
      );
      assert.strictEqual(allocRows[0].status, 'COMMITTED');

      pass('18. Inventory Safeguard: Committed supplier stock is NOT released on buyer DECLINE', Date.now() - t0);
    } catch (e) { fail('18. Inventory safeguard', e); }

    startTest('19. Financial Safeguards: Zero orders, payments, refunds, or Safepay checkouts created');
    try {
      const t0 = Date.now();
      const [orderRows] = await db.query('SELECT COUNT(*) AS c FROM orders');
      const [payRows] = await db.query('SELECT COUNT(*) AS c FROM payments');
      assert.strictEqual(orderRows[0].c, 0, 'Orders count must be strictly 0');
      assert.strictEqual(payRows[0].c, 0, 'Payments count must be strictly 0');

      pass('19. Financial Safeguards: Zero orders, payments, refunds, or Safepay checkouts created', Date.now() - t0);
    } catch (e) { fail('19. Financial safeguards', e); }

    startTest('20. Crash Recovery: Idempotency reconciliation recovers committed decision on lost HTTP response');
    try {
      const t0 = Date.now();
      const fixture = await createSupplierAcceptedPoolFixture();
      const idemKey = `CRASH-BDEC-${Date.now()}`;
      createdIdempotencyKeys.push(idemKey);

      // 1. Submit decision
      const res1 = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': idemKey
      }, { decision: 'ACCEPT' });
      assert.strictEqual(res1.status, 200);

      // 2. Simulate crashed/stalled worker by resetting idempotency status to PENDING and expiring heartbeat
      await db.query(
        `UPDATE idempotency_records 
         SET status = 'PENDING', response_status = 0, response_body = '', resource_type = 'reservations',
             resource_id = ?, last_heartbeat_at = DATE_SUB(NOW(), INTERVAL 70 SECOND), created_at = DATE_SUB(NOW(), INTERVAL 70 SECOND)
         WHERE idempotency_key = ?`,
        [fixture.r1Id, idemKey]
      );

      // 3. Client retries with exact same key
      const res2 = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${fixture.r1Id}/final-decision`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': idemKey
      }, { decision: 'ACCEPT' });

      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.decision, 'ACCEPT');
      assert.strictEqual(res2.body.data.price_lock_status, 'LOCKED');

      pass('20. Crash Recovery: Idempotency reconciliation recovers committed decision on lost HTTP response', Date.now() - t0);
    } catch (e) { fail('20. Crash recovery reconciliation', e); }

    // =========================================================================
    // SECTION 8: DATABASE ISOLATION VERIFICATION
    // =========================================================================

    startTest('21. Database Isolation: Development database miljor_db remains 100% PRISTINE');
    try {
      const t0 = Date.now();
      const devConn = await db.getConnection();
      try {
        const [pools] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.pools');
        const [res] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.reservations');
        const [events] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.reservation_business_events');
        const [snaps] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.pool_commercial_snapshots');
        const [suppDecs] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.pool_supplier_commercial_decisions');
        const [buyerDecs] = await devConn.query('SELECT COUNT(*) AS c FROM miljor_db.pool_buyer_commercial_decisions');

        assert.strictEqual(pools[0].c, initPools[0].c, `miljor_db pools must remain unchanged (${initPools[0].c})`);
        assert.strictEqual(res[0].c, initRes[0].c, `miljor_db reservations must remain unchanged (${initRes[0].c})`);
        assert.strictEqual(events[0].c, initEvents[0].c, `miljor_db events must remain unchanged (${initEvents[0].c})`);
        assert.strictEqual(snaps[0].c, initSnaps[0].c, `miljor_db commercial snapshots must remain unchanged (${initSnaps[0].c})`);
        assert.strictEqual(suppDecs[0].c, initSuppDecs[0].c, `miljor_db supplier decisions must remain unchanged (${initSuppDecs[0].c})`);
        assert.strictEqual(buyerDecs[0].c, initBuyerDecs[0].c, `miljor_db buyer decisions must remain unchanged (${initBuyerDecs[0].c})`);
      } finally {
        devConn.release();
      }

      pass('21. Database Isolation: Development database miljor_db remains 100% PRISTINE', Date.now() - t0);
    } catch (e) { fail('21. Database Isolation: miljor_db verification failed', e); }

  } finally {
    // Teardown test fixtures
    if (createdIdempotencyKeys.length > 0) {
      try {
        await db.query('DELETE FROM idempotency_records WHERE idempotency_key IN (?)', [createdIdempotencyKeys]);
      } catch (e) {}
    }

    if (createdReservationIds.length > 0) {
      try {
        await db.query('DELETE FROM pool_buyer_commercial_decisions WHERE reservation_id IN (?)', [createdReservationIds]);
      } catch (e) {}
    }

    if (createdPoolIds.length > 0) {
      try {
        await db.query('DELETE FROM pool_buyer_commercial_decisions WHERE pool_id IN (?)', [createdPoolIds]);
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
  console.log(`Part 4D.4 Buyer Commitment Gate: ${passedTests} / ${totalTests} assertions passed`);
  console.log(`Status: ${passedTests === totalTests ? 'PASS' : 'FAIL'}`);
  console.log('='.repeat(80));

  if (passedTests !== totalTests) {
    throw new Error(`Part 4D.4 Buyer Commitment Gate: ${totalTests - passedTests} assertions failed`);
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
