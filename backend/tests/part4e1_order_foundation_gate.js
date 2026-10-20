// =============================================================================
// tests/part4e1_order_foundation_gate.js
// MilJor Part 4E.1: Order Architecture, Commercial Reconciliation
// & Financial Safety Foundation Gate (OBS-71, 72, 73, 74)
//
// Validates:
// 1. Authoritative buyer-specific order readiness read model (GET /api/v1/reservations/:id/order-readiness)
// 2. OBS-71: Reservation demand, commitment accounting & converted order separation
// 3. OBS-72: Contractual price guarantee verification & fail-closed shortfall policy
// 4. OBS-73: Exact merchandise subtotal vs final payable fee composition contract
// 5. OBS-74: Final-demand quorum verification (above, exact, below, pending)
// 6. Migration 018: Orders decimal precision & DB-level exactly-once constraint (uq_orders_buyer_decision)
// 7. Security: Tenant isolation, suspended account rejection, anti-impersonation
// 8. Financial Safety: Zero live orders, zero payment intents, zero ledger mutations
// 9. Platform Invariant: Natural termination & miljor_db 100% pristine
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const commercialReconciliationService = require('../src/services/commercialReconciliationService');
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
const competitorSupplierToken = generateToken(3, 'SUPPLIER', 'VERIFIED');
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
const createdOrderIds = [];

// Helper to create test pool fixture
async function createTestPoolFixture(overrides = {}) {
  const code = `P${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
  const expiresAt = overrides.expires_at || new Date(Date.now() - 3600000); // 1h in past
  const suppDeadline = overrides.supplier_confirmation_deadline || new Date(Date.now() + 24 * 3600000);
  const buyerDeadline = overrides.buyer_commitment_deadline || new Date(Date.now() + 48 * 3600000);
  const status = overrides.status || 'CONFIRMED';

  const [res] = await db.query(
    `INSERT INTO pools (
      pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id,
      pool_unit, target_qty, supplier_min_qty, buyer_min_qty, max_capacity,
      purchase_increment, current_qty, current_price_per_unit, status, expires_at,
      supplier_confirmation_deadline, buyer_commitment_deadline, delivery_type, delivery_fee_policy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      overrides.supplier_id || 2,
      1, // Wheat Flour
      1, // Exact spec
      1, // Listing
      overrides.pool_unit || 'bag',
      overrides.target_qty || 100,
      overrides.supplier_min_qty || 50,
      overrides.buyer_min_qty || 5,
      overrides.max_capacity || 200,
      5, // increment
      overrides.current_qty || 70,
      overrides.current_price_per_unit || 4800.00,
      status,
      expiresAt,
      suppDeadline,
      buyerDeadline,
      overrides.delivery_type || 'DOORSTEP',
      overrides.delivery_fee_policy || 'FLAT_TRIP_FEE_1500'
    ]
  );

  const poolId = res.insertId;
  createdPoolIds.push(poolId);

  // Price tier
  await db.query(
    `INSERT INTO pool_price_tiers (pool_id, min_qty, max_qty, price_per_unit, pricing_unit)
     VALUES (?, 50, 100, 4800.00, 'bag'), (?, 101, 200, 4600.00, 'bag')`,
    [poolId, poolId]
  );

  return poolId;
}

// Helper to create test snapshot
async function createTestSnapshotFixture(poolId, overrides = {}) {
  const code = `SNP-${poolId}-${Date.now().toString().slice(-6)}`;
  const [res] = await db.query(
    `INSERT INTO pool_commercial_snapshots (
      snapshot_code, pool_id, snapshot_version, qualification_status,
      participation_cutoff, supplier_id, product_id, product_spec_id,
      canonical_spec_hash, pool_unit, eligible_aggregate_qty, supplier_min_qty,
      target_qty, max_capacity, applicable_tier_index, candidate_unit_price,
      participating_reservations_count, participating_reservations_summary,
      delivery_type, supplier_confirmation_deadline, buyer_commitment_deadline,
      status
    ) VALUES (?, ?, 1, ?, NOW(), 2, 1, 1, 'mock-hash-4e1', 'bag', ?, ?, ?, ?, 0, ?, ?, ?, 'DOORSTEP', ?, ?, ?)`,
    [
      code,
      poolId,
      overrides.qualification_status || 'QUALIFIED',
      overrides.eligible_aggregate_qty || 70.0000,
      overrides.supplier_min_qty || 50.0000,
      overrides.target_qty || 100.0000,
      overrides.max_capacity || 200.0000,
      overrides.candidate_unit_price || 4800.00,
      overrides.participating_reservations_count || 2,
      JSON.stringify(overrides.summary || [{ res_id: 1, buyer_id: 5, qty: 40 }, { res_id: 2, buyer_id: 6, qty: 30 }]),
      overrides.supplier_confirmation_deadline || new Date(Date.now() + 24 * 3600000),
      overrides.buyer_commitment_deadline || new Date(Date.now() + 48 * 3600000),
      overrides.status || 'ACCEPTED'
    ]
  );

  return res.insertId;
}

// Helper to create test supplier decision
async function createTestSupplierDecision(poolId, snapshotId, overrides = {}) {
  const code = `DEC-${poolId}-${Date.now().toString().slice(-6)}`;
  const [res] = await db.query(
    `INSERT INTO pool_supplier_commercial_decisions (
      decision_code, pool_id, snapshot_id, snapshot_version, supplier_id,
      actor_id, actor_role, decision, rejection_reason_code,
      agreed_aggregate_qty, agreed_unit_price
    ) VALUES (?, ?, ?, 1, 2, 2, 'SUPPLIER', ?, ?, ?, ?)`,
    [
      code,
      poolId,
      snapshotId,
      overrides.decision || 'ACCEPT',
      overrides.rejection_reason_code || null,
      overrides.agreed_aggregate_qty || 70.0000,
      overrides.agreed_unit_price || 4800.00
    ]
  );
  return res.insertId;
}

// Helper to create test buyer reservation & decision
async function createTestReservationFixture(poolId, buyerId, qty, overrides = {}) {
  const code = `RES-${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
  const unitPrice = overrides.locked_unit_price !== undefined ? overrides.locked_unit_price : 4800.00;
  const totalPrice = overrides.locked_total_price !== undefined ? overrides.locked_total_price : Number((qty * unitPrice).toFixed(2));
  const status = overrides.status || 'CONFIRMED';

  const [res] = await db.query(
    `INSERT INTO reservations (
      reservation_code, pool_id, buyer_id, quantity, unit_price,
      total_price, locked_unit_price, locked_total_price, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      poolId,
      buyerId,
      qty,
      unitPrice,
      totalPrice,
      unitPrice,
      totalPrice,
      status
    ]
  );

  const resId = res.insertId;
  createdReservationIds.push(resId);

  // If buyer decision requested
  if (overrides.buyer_decision) {
    let suppDecId = overrides.supplier_decision_id;
    if (!suppDecId && overrides.snapshot_id) {
      const [sdRows] = await db.query(
        'SELECT id FROM pool_supplier_commercial_decisions WHERE pool_id = ? AND snapshot_id = ? ORDER BY id DESC LIMIT 1',
        [poolId, overrides.snapshot_id]
      );
      if (sdRows[0]) suppDecId = sdRows[0].id;
    }

    const bCode = `BDEC-${resId}-${Date.now().toString().slice(-6)}`;
    await db.query(
      `INSERT INTO pool_buyer_commercial_decisions (
        decision_code, pool_id, reservation_id, snapshot_id, snapshot_version,
        supplier_decision_id, buyer_id, actor_id, actor_role, decision, decline_reason_code,
        accepted_quantity, agreed_unit_price, price_lock_status
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'BUYER', ?, ?, ?, ?, ?)`,
      [
        bCode,
        poolId,
        resId,
        overrides.snapshot_id,
        suppDecId,
        buyerId,
        buyerId,
        overrides.buyer_decision,
        overrides.decline_reason_code || null,
        qty,
        unitPrice,
        overrides.buyer_decision === 'ACCEPT' ? 'LOCKED' : 'DECLINED'
      ]
    );
  }

  return resId;
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('🚀 MILJOR PART 4E.1: ORDER ARCHITECTURE & COMMERCIAL RECONCILIATION GATE');
  console.log('Target Database: miljor_test_db');
  console.log('='.repeat(80));

  let totalTests = 0;
  let passedTests = 0;

  function recordPass(desc) {
    totalTests++;
    passedTests++;
    console.log(`  ✅ Test ${totalTests}: ${desc}`);
  }

  function recordFail(desc, err) {
    totalTests++;
    console.error(`  ❌ Test ${totalTests} FAILED: ${desc}`);
    console.error(`     Reason: ${err.message}`);
    throw err;
  }

  try {
    // Start HTTP server on dynamic port
    await new Promise((resolve) => {
      testServer = app.listen(0, () => {
        const port = testServer.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        console.log(`📡 Test server listening at ${baseUrl}\n`);
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // TEST SCENARIO A: Fully Qualified, Supplier-Accepted Pool with Quorum Met
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario A: Fully Qualified Pool with Met Quorum (OBS-71, 72, 73, 74) ---');
    const poolA = await createTestPoolFixture({ supplier_min_qty: 50.0000 });
    const snapA = await createTestSnapshotFixture(poolA, { eligible_aggregate_qty: 70.0000, supplier_min_qty: 50.0000 });
    const suppDecA = await createTestSupplierDecision(poolA, snapA, { decision: 'ACCEPT', agreed_aggregate_qty: 70.0000 });

    // Buyer 1 accepts 40 bags; Buyer 2 accepts 30 bags (Total 70 >= 50 min)
    const resA1 = await createTestReservationFixture(poolA, 5, 40.0000, {
      snapshot_id: snapA,
      buyer_decision: 'ACCEPT'
    });
    const resA2 = await createTestReservationFixture(poolA, 6, 30.0000, {
      snapshot_id: snapA,
      buyer_decision: 'ACCEPT'
    });

    // Test 1: Service evaluation returns ELIGIBLE_FOR_ORDER when quorum met
    const evalA1 = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resA1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalA1.eligible_for_order, true, 'Buyer 1 must be eligible for order');
    assert.deepStrictEqual(evalA1.reason_codes, ['ELIGIBLE_FOR_ORDER']);
    assert.strictEqual(evalA1.pricing_guarantee_status, 'QUORUM_VERIFIED');
    assert.strictEqual(evalA1.financial_components_status, 'MERCHANDISE_SUBTOTAL_LOCKED');
    assert.strictEqual(evalA1.currency, 'PKR');
    recordPass('Service evaluation returns ELIGIBLE_FOR_ORDER when quorum is met');

    // Test 2: Financial breakdown accurately isolates merchandise subtotal from delivery fee
    assert.strictEqual(evalA1.financial_breakdown.locked_quantity, 40);
    assert.strictEqual(evalA1.financial_breakdown.locked_unit_price, 4800.00);
    assert.strictEqual(evalA1.financial_breakdown.merchandise_subtotal, 192000.00);
    assert.strictEqual(evalA1.financial_breakdown.buyer_platform_fee_status, 'PENDING_ORDER_GENERATION');
    assert.strictEqual(evalA1.financial_breakdown.payable_total_status, 'REQUIRES_FEE_COMPOSITION_AT_ORDER_CREATION');
    recordPass('OBS-73: Exact merchandise subtotal separated from pending order fees');

    // Test 3: HTTP GET /api/v1/reservations/:id/order-readiness returns 200 OK with structured data
    const resHttpA1 = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${resA1}/order-readiness`, {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(resHttpA1.status, 200);
    assert.strictEqual(resHttpA1.body.success, true);
    assert.strictEqual(resHttpA1.body.data.eligible_for_order, true);
    assert.strictEqual(resHttpA1.body.data.reservation_id, resA1);
    recordPass('HTTP GET /order-readiness returns 200 OK with authorized readiness breakdown');

    // -------------------------------------------------------------------------
    // TEST SCENARIO B: Supplier Rejection (OBS-74)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario B: Supplier Rejection ---');
    const poolB = await createTestPoolFixture({ status: 'SUPPLIER_FAILED' });
    const snapB = await createTestSnapshotFixture(poolB, { status: 'REJECTED' });
    await createTestSupplierDecision(poolB, snapB, { decision: 'REJECT', rejection_reason_code: 'CAPACITY_SHORTAGE' });
    const resB1 = await createTestReservationFixture(poolB, 5, 40.0000, { snapshot_id: snapB });

    const evalB = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resB1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalB.eligible_for_order, false);
    assert.ok(evalB.reason_codes.includes('SUPPLIER_OFFER_REJECTED'));
    recordPass('Supplier rejection blocks order readiness with SUPPLIER_OFFER_REJECTED');

    // -------------------------------------------------------------------------
    // TEST SCENARIO C: Buyer DECLINE (OBS-71, 74)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario C: Buyer Declined Offer ---');
    const poolC = await createTestPoolFixture();
    const snapC = await createTestSnapshotFixture(poolC);
    await createTestSupplierDecision(poolC, snapC, { decision: 'ACCEPT' });
    const resC1 = await createTestReservationFixture(poolC, 5, 20.0000, {
      snapshot_id: snapC,
      buyer_decision: 'DECLINE',
      decline_reason_code: 'PRICE_HIGH',
      status: 'CANCELLED'
    });

    const evalC = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resC1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalC.eligible_for_order, false);
    assert.ok(evalC.reason_codes.includes('BUYER_OFFER_DECLINED'));
    recordPass('Buyer decline blocks order readiness with BUYER_OFFER_DECLINED');

    // -------------------------------------------------------------------------
    // TEST SCENARIO D: Final Demand Below Supplier Minimum (OBS-72, 74)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario D: Final Demand Below Minimum & Price Guarantee Contract ---');
    // Supplier min is 100 bags. Buyer 1 accepted 40 bags, Buyer 2 declined 30 bags.
    // Expired deadline: Buyer commitment window is past. Total accepted = 40 < 100.
    const poolD = await createTestPoolFixture({ supplier_min_qty: 100.0000 });
    const pastBuyerDeadline = new Date(Date.now() - 3600000); // 1h in past
    const snapD = await createTestSnapshotFixture(poolD, {
      eligible_aggregate_qty: 70.0000,
      supplier_min_qty: 100.0000,
      buyer_commitment_deadline: pastBuyerDeadline
    });
    await createTestSupplierDecision(poolD, snapD, { decision: 'ACCEPT', agreed_aggregate_qty: 70.0000 });
    const resD1 = await createTestReservationFixture(poolD, 5, 40.0000, {
      snapshot_id: snapD,
      buyer_decision: 'ACCEPT'
    });
    const resD2 = await createTestReservationFixture(poolD, 6, 30.0000, {
      snapshot_id: snapD,
      buyer_decision: 'DECLINE',
      decline_reason_code: 'PRICE_HIGH',
      status: 'CANCELLED'
    });

    const evalD = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resD1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalD.eligible_for_order, false, 'Shortfall must fail closed');
    assert.ok(evalD.reason_codes.includes('FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM'));
    assert.strictEqual(evalD.pricing_guarantee_status, 'UNSUPPORTED_SHORTFALL');
    recordPass('OBS-74: Deficit to supplier minimum blocks readiness (FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM)');

    // Test 5: Buyer price lock remains intact despite order being blocked
    const [resD1Db] = await db.query('SELECT locked_unit_price, status FROM reservations WHERE id = ?', [resD1]);
    assert.strictEqual(Number(resD1Db[0].locked_unit_price), 4800.00);
    assert.strictEqual(resD1Db[0].status, 'CONFIRMED');
    recordPass('OBS-72: Accepted buyer price lock remains intact during shortfall evaluation');

    // -------------------------------------------------------------------------
    // TEST SCENARIO E: Final Demand Exact Minimum & Pending Cohort
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario E: Exact Minimum & Active Pending Cohort ---');
    // Supplier min is 50 bags. Buyer 1 accepts 50 bags. Exact quorum!
    const poolE = await createTestPoolFixture({ supplier_min_qty: 50.0000 });
    const snapE = await createTestSnapshotFixture(poolE, { eligible_aggregate_qty: 50.0000, supplier_min_qty: 50.0000 });
    await createTestSupplierDecision(poolE, snapE, { decision: 'ACCEPT' });
    const resE1 = await createTestReservationFixture(poolE, 5, 50.0000, {
      snapshot_id: snapE,
      buyer_decision: 'ACCEPT'
    });

    const evalE = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resE1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalE.eligible_for_order, true);
    assert.strictEqual(evalE.final_committed_demand, 50);
    assert.strictEqual(evalE.minimum_required_demand, 50);
    recordPass('Final demand exactly equal to supplier minimum satisfies quorum');

    // Scenario E2: Demand is below minimum but buyer commitment deadline is STILL ACTIVE
    const poolE2 = await createTestPoolFixture({ supplier_min_qty: 100.0000 });
    const futureDeadline = new Date(Date.now() + 24 * 3600000); // 24h in future
    const snapE2 = await createTestSnapshotFixture(poolE2, {
      eligible_aggregate_qty: 120.0000,
      supplier_min_qty: 100.0000,
      participating_reservations_count: 2,
      buyer_commitment_deadline: futureDeadline
    });
    await createTestSupplierDecision(poolE2, snapE2, { decision: 'ACCEPT' });
    const resE2_1 = await createTestReservationFixture(poolE2, 5, 40.0000, {
      snapshot_id: snapE2,
      buyer_decision: 'ACCEPT'
    });
    // Buyer 2 has not submitted decision yet!
    const resE2_2 = await createTestReservationFixture(poolE2, 6, 80.0000, {
      snapshot_id: snapE2,
      status: 'RESERVED' // still pending
    });

    const evalE2 = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resE2_1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalE2.eligible_for_order, false);
    assert.ok(evalE2.reason_codes.includes('BUYER_COMMITMENTS_PENDING'));
    assert.strictEqual(evalE2.pricing_guarantee_status, 'PENDING_COHORT_COMPLETION');
    recordPass('Active deadline with pending buyers reports BUYER_COMMITMENTS_PENDING');

    // -------------------------------------------------------------------------
    // TEST SCENARIO F: Accounting Separation & Converted Orders (OBS-71)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario F: Demand Accounting & Converted Order Tracking (OBS-71) ---');
    const demandSummary = await CommercialLifecycleService.getPoolCommittedDemandSummary(poolE2);
    assert.strictEqual(demandSummary.accounting.original_qualified_demand, 120);
    assert.strictEqual(demandSummary.accounting.buyer_accepted_demand, 40);
    assert.strictEqual(demandSummary.accounting.buyer_declined_demand, 0);
    assert.strictEqual(demandSummary.accounting.buyer_pending_demand, 80);
    assert.strictEqual(demandSummary.accounting.converted_order_demand, 0);
    assert.strictEqual(demandSummary.accounting.converted_order_count, 0);
    recordPass('OBS-71: Demand accounting correctly separates qualified, accepted, declined, pending, and converted demand');

    // -------------------------------------------------------------------------
    // TEST SCENARIO G: Migration 018 Schema Verification & DB Exactly-Once Invariant
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario G: Migration 018 & DB Unique Order Linkage ---');
    const [cols] = await db.query('DESCRIBE orders');
    const totalQtyCol = cols.find(c => c.Field === 'total_qty');
    assert.strictEqual(totalQtyCol.Type, 'decimal(12,4)', 'orders.total_qty must be DECIMAL(12,4)');
    const buyerDecCol = cols.find(c => c.Field === 'buyer_decision_id');
    assert.ok(buyerDecCol, 'orders.buyer_decision_id column must exist');
    recordPass('Migration 018 verified: orders.total_qty is DECIMAL(12,4) and buyer_decision_id column exists');

    // Test 10: Fetch buyer decision row for resA1
    const [buyerDecRows] = await db.query(
      'SELECT id FROM pool_buyer_commercial_decisions WHERE reservation_id = ?',
      [resA1]
    );
    const buyerDecId = buyerDecRows[0].id;

    // Simulate an existing converted order using Migration 018 schema
    const orderCode1 = `ORD-${Date.now().toString().slice(-8)}1`;
    const [orderInsert] = await db.query(
      `INSERT INTO orders (
        order_code, reservation_id, buyer_id, supplier_id, pool_id, snapshot_id,
        buyer_decision_id, total_qty, unit_price, subtotal_amount, total_amount, currency
      ) VALUES (?, ?, 5, 2, ?, ?, ?, 40.0000, 4800.00, 192000.00, 192000.00, 'PKR')`,
      [orderCode1, resA1, poolA, snapA, buyerDecId]
    );
    const orderId = orderInsert.insertId;
    createdOrderIds.push(orderId);

    // Test 11: Attempting to insert a duplicate order for the same buyer decision throws ER_DUP_ENTRY
    let dupFailed = false;
    try {
      const orderCode2 = `ORD-${Date.now().toString().slice(-8)}2`;
      await db.query(
        `INSERT INTO orders (
          order_code, reservation_id, buyer_id, supplier_id, pool_id, snapshot_id,
          buyer_decision_id, total_qty, unit_price, subtotal_amount, total_amount, currency
        ) VALUES (?, ?, 5, 2, ?, ?, ?, 40.0000, 4800.00, 192000.00, 192000.00, 'PKR')`,
        [orderCode2, resA1, poolA, snapA, buyerDecId]
      );
    } catch (dupErr) {
      dupFailed = true;
      assert.strictEqual(dupErr.code, 'ER_DUP_ENTRY', 'Must throw ER_DUP_ENTRY on duplicate buyer_decision_id');
    }
    assert.strictEqual(dupFailed, true, 'Duplicate order insertion must be rejected at DB constraint level');
    recordPass('DB Invariant: uq_orders_buyer_decision guarantees exactly-once order creation');

    // Test 12: Readiness evaluation detects already-converted order and blocks re-conversion
    const evalConverted = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resA1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalConverted.eligible_for_order, false);
    assert.ok(evalConverted.reason_codes.includes('ORDER_ALREADY_CONVERTED'));
    assert.strictEqual(evalConverted.existing_order.id, orderId);
    recordPass('Readiness service blocks already-converted order (ORDER_ALREADY_CONVERTED)');

    // -------------------------------------------------------------------------
    // TEST SCENARIO H: Financial & Precision Edge Cases (OBS-73)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario H: Financial Precision & Calculation Integrity (OBS-73) ---');
    // Test 13: Fractional decimal quantity with exact 2-decimal subtotal rounding
    const poolH = await createTestPoolFixture({ pool_unit: 'kg', supplier_min_qty: 10.0000 });
    const snapH = await createTestSnapshotFixture(poolH, {
      eligible_aggregate_qty: 12.5000,
      supplier_min_qty: 10.0000,
      candidate_unit_price: 333.33
    });
    await createTestSupplierDecision(poolH, snapH, { decision: 'ACCEPT', agreed_unit_price: 333.33 });
    // 12.5 kg @ 333.33/kg = 4166.625 -> round(2) = 4166.63
    const resH1 = await createTestReservationFixture(poolH, 5, 12.5000, {
      snapshot_id: snapH,
      locked_unit_price: 333.33,
      locked_total_price: 4166.63,
      buyer_decision: 'ACCEPT'
    });

    const evalH = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resH1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalH.eligible_for_order, true);
    assert.strictEqual(evalH.financial_breakdown.merchandise_subtotal, 4166.63);
    recordPass('DECIMAL(12,4) fractional quantity evaluates exact 2-decimal rounded subtotal');

    // Test 14: Subtotal tampering / calculation mismatch fails closed (using buyer 6)
    const resH_Tampered = await createTestReservationFixture(poolH, 6, 10.0000, {
      snapshot_id: snapH,
      locked_unit_price: 333.33,
      locked_total_price: 9999.99, // tampered total
      buyer_decision: 'ACCEPT'
    });

    const evalTampered = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resH_Tampered,
      actor: { id: 6, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalTampered.eligible_for_order, false);
    assert.ok(evalTampered.reason_codes.includes('SUBTOTAL_CALCULATION_MISMATCH'));
    recordPass('Tampered locked subtotal fails closed with SUBTOTAL_CALCULATION_MISMATCH');

    // Test 15: Discrepancy between reservation price and snapshot price fails closed (using buyer 7)
    const resH_PriceMismatch = await createTestReservationFixture(poolH, 7, 10.0000, {
      snapshot_id: snapH,
      locked_unit_price: 200.00, // diverges from snapshot candidate_unit_price 333.33
      locked_total_price: 2000.00,
      buyer_decision: 'ACCEPT'
    });

    const evalPriceMismatch = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resH_PriceMismatch,
      actor: { id: 7, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalPriceMismatch.eligible_for_order, false);
    assert.ok(evalPriceMismatch.reason_codes.includes('SNAPSHOT_PRICE_DISCREPANCY'));
    recordPass('Divergent unit price fails closed with SNAPSHOT_PRICE_DISCREPANCY');

    // -------------------------------------------------------------------------
    // TEST SCENARIO I: Unknown Reservation State & Legacy Pool Safety
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario I: Unknown Reservation State & Legacy Pool Safety ---');
    // Test 17: Reservation with non-confirmed status (e.g. EXPIRED) fails closed
    const poolI = await createTestPoolFixture();
    const snapI = await createTestSnapshotFixture(poolI);
    await createTestSupplierDecision(poolI, snapI, { decision: 'ACCEPT' });
    const resExpired = await createTestReservationFixture(poolI, 5, 10.0000, {
      snapshot_id: snapI,
      status: 'EXPIRED',
      buyer_decision: 'ACCEPT'
    });
    const evalExpired = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resExpired,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalExpired.eligible_for_order, false);
    assert.ok(evalExpired.reason_codes.includes('RESERVATION_NOT_CONFIRMED'));

    // Test demand policy fail-closed audit on unknown status string
    const { auditReservationStatuses } = require('../src/services/reservationDemandPolicy');
    const policyAudit = auditReservationStatuses([{ status: 'UNKNOWN_EXTERNAL_STATUS', quantity: 15.0 }]);
    assert.strictEqual(policyAudit.hasUnknownStatus, true);
    assert.strictEqual(policyAudit.safeDemandQty, 15.0);
    recordPass('OBS-71: Non-confirmed reservation status and unknown status policy fail closed');

    // Test 17: Legacy pool (ID 1 / 2) rejected fail-closed
    // Create temporary reservation pointing to historical pool 1
    const [legacyResInsert] = await db.query(
      `INSERT INTO reservations (reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status)
       VALUES ('RES-LEGACY-TEST-4E1', 1, 7, 5, 5000, 25000, 'CONFIRMED')`
    );
    const legacyResId = legacyResInsert.insertId;
    createdReservationIds.push(legacyResId);

    const evalLegacy = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: legacyResId,
      actor: { id: 7, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalLegacy.eligible_for_order, false);
    assert.ok(evalLegacy.reason_codes.includes('LEGACY_POOL_READ_ONLY'));
    recordPass('Historical legacy pool 1 is strictly read-only and blocked from order creation');

    // -------------------------------------------------------------------------
    // TEST SCENARIO J: Security, RBAC & Anti-Impersonation
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario J: Security, Tenant Isolation & Impersonation Prevention ---');
    // Test 18: Cross-buyer access denial (Buyer 2 cannot view Buyer 1's readiness)
    const resCrossBuyer = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${resA1}/order-readiness`, {
      Authorization: `Bearer ${buyer2Token}`
    });
    assert.strictEqual(resCrossBuyer.status, 403, 'Cross-buyer readiness access must return 403 FORBIDDEN');
    assert.strictEqual(resCrossBuyer.body.error.code, 'FORBIDDEN');
    recordPass('Tenant isolation: Cross-buyer order readiness access strictly blocked with HTTP 403');

    // Test 19: Competitor supplier access denial
    const resCompetitor = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${resA1}/order-readiness`, {
      Authorization: `Bearer ${competitorSupplierToken}`
    });
    assert.strictEqual(resCompetitor.status, 403, 'Competitor supplier must return 403 FORBIDDEN');
    recordPass('Supplier isolation: Competitor supplier blocked with HTTP 403');

    // Test 20: Suspended buyer access denial
    await db.query("UPDATE users SET buyer_trust_status = 'SUSPENDED' WHERE id = 7");
    try {
      const resSuspended = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${resA1}/order-readiness`, {
        Authorization: `Bearer ${buyer3Token}`
      });
      assert.strictEqual(resSuspended.status, 403, 'Suspended buyer must return 403');
      assert.strictEqual(resSuspended.body.error.code, 'ACCOUNT_SUSPENDED');
      recordPass('Account security: Suspended buyer denied order readiness evaluation with HTTP 403');
    } finally {
      await db.query("UPDATE users SET buyer_trust_status = 'CONTACT_VERIFIED' WHERE id = 7");
    }

    // -------------------------------------------------------------------------
    // TEST SCENARIO K: Platform Safeguards & Database Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario K: Platform Safeguards & Zero Mutation Guarantees ---');
    // Test 21: Zero live buyer orders or payments created during Part 4E.1
    const [liveOrders] = await db.query('SELECT COUNT(*) AS c FROM orders WHERE order_status = "PAID" OR order_status = "PROCESSING"');
    assert.strictEqual(Number(liveOrders[0].c), 0, 'Zero operational orders must exist');
    const [livePayments] = await db.query('SELECT COUNT(*) AS c FROM payments');
    assert.strictEqual(Number(livePayments[0].c), 0, 'Zero payment intents or records must exist');
    recordPass('Financial Safety: Zero operational orders, zero payment intents, zero payment records created');

    // Test 22: Development database (miljor_db) remains 100% PRISTINE
    const [devPools] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pools');
    const [devRes] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservations');
    const [devEvents] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservation_business_events');
    const [devOrders] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.orders');
    const [devBuyerDecs] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pool_buyer_commercial_decisions');
    assert.strictEqual(Number(devPools[0].c), 2, 'miljor_db.pools must have exactly 2 historical pools');
    assert.strictEqual(Number(devRes[0].c), 0, 'miljor_db.reservations must be 0');
    assert.strictEqual(Number(devEvents[0].c), 0, 'miljor_db events must be 0');
    assert.strictEqual(Number(devOrders[0].c), 0, 'miljor_db orders must be 0');
    assert.strictEqual(Number(devBuyerDecs[0].c), 0, 'miljor_db buyer decisions must be 0');
    recordPass('Database Isolation: miljor_db is 100% PRISTINE (2 pools, 0 reservations, 0 orders, 0 events)');

  } finally {
    // Teardown fixtures created in test database
    console.log('\nCleaning up test fixtures from miljor_test_db...');
    if (createdOrderIds.length > 0) {
      try {
        await db.query('DELETE FROM orders WHERE id IN (?)', [createdOrderIds]);
      } catch (e) {}
    }

    if (createdReservationIds.length > 0) {
      try {
        await db.query('DELETE FROM pool_buyer_commercial_decisions WHERE reservation_id IN (?)', [createdReservationIds]);
        await db.query('DELETE FROM reservations WHERE id IN (?)', [createdReservationIds]);
      } catch (e) {}
    }

    if (createdPoolIds.length > 0) {
      try {
        await db.query('DELETE FROM pool_buyer_commercial_decisions WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pool_supplier_commercial_decisions WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pool_commercial_snapshots WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM reservation_business_events WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pool_price_tiers WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
      } catch (e) {}
    }

    if (testServer) {
      await new Promise(r => testServer.close(r));
    }
  }

  console.log('='.repeat(80));
  console.log(`Part 4E.1 Order Foundation Gate: ${passedTests} / ${totalTests} assertions passed`);
  console.log(`Status: ${passedTests === totalTests ? 'PASS' : 'FAIL'}`);
  console.log('='.repeat(80));

  if (passedTests !== totalTests) {
    throw new Error(`Part 4E.1 Order Foundation Gate: ${totalTests - passedTests} assertions failed`);
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
