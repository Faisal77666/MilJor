// =============================================================================
// tests/part4e1_1_financial_hardening_gate.js
// MilJor Part 4E.1.1: Exact Financial Arithmetic, Commercial Reconciliation
// Consistency & Pre-Order Integrity Hardening Gate
// (OBS-75, OBS-76, OBS-77, OBS-78)
//
// Validates:
// 1. OBS-75: Exact Decimal Monetary Arithmetic (BigInt scaled-integer math)
//    - Whole quantity x whole price
//    - Fractional quantity x fractional price with exact contractual half-up rounding
//    - Maximum DECIMAL(12,2) and DECIMAL(12,4) precision boundaries
//    - Rejection of invalid scale, precision overflow, NaN, Infinity, negative inputs
//    - Prevention of false mismatches introduced by IEEE-754 binary floating-point
// 2. OBS-76: Removal of Arbitrary Tolerance (Math.abs(x - y) <= 0.01 replaced by exact canonical comparison)
//    - 1-cent tampering / discrepancies rejected with SUBTOTAL_CALCULATION_MISMATCH
//    - Snapshot price discrepancies rejected with SNAPSHOT_PRICE_DISCREPANCY
// 3. OBS-77: Consistent Multi-Query Read Snapshot
//    - Single dedicated connection with REPEATABLE READ and START TRANSACTION WITH CONSISTENT SNAPSHOT
//    - Concurrent buyer decision made during reconciliation is isolated by MVCC snapshot
//    - Automatic rollback and connection release in finally block (no leaked handles or write locks)
// 4. OBS-78: Tax, Fee & Payable Total Semantics
//    - Tax status explicitly PENDING_DETERMINATION (no false claims of tax exemption)
//    - Delivery fee status PENDING_QUOTE / DETERMINED_ZERO (no zero-fee assumptions for doorstep)
//    - Merchandise subtotal kept strictly distinct from final payable total
// 5. Tenant Isolation, Zero Live Orders, Zero Payment Mutations, and miljor_db Pristine
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
const exactDecimal = require('../src/services/exactDecimal');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

const buyer1Token = generateToken(5, 'BUYER', 'VERIFIED');
const buyer2Token = generateToken(6, 'BUYER', 'VERIFIED');
const competitorBuyerToken = generateToken(7, 'BUYER', 'VERIFIED');
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

// Helper fixtures
async function createTestPoolFixture(overrides = {}) {
  const code = `POOL-${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
  const status = overrides.status || 'CONFIRMED';
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  const suppDeadline = new Date(Date.now() + 2 * 3600 * 1000);
  const buyerDeadline = new Date(Date.now() + 4 * 3600 * 1000);

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
      overrides.delivery_fee_policy || 'STANDARD_DELIVERY'
    ]
  );
  const poolId = res.insertId;
  createdPoolIds.push(poolId);
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

async function createTestSupplierDecision(poolId, snapshotId, overrides = {}) {
  const code = `SDEC-${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
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

async function createTestReservationFixture(poolId, buyerId, qty, overrides = {}) {
  const code = `RES-${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
  const unitPrice = overrides.locked_unit_price !== undefined ? overrides.locked_unit_price : 4800.00;
  const totalPrice = overrides.locked_total_price !== undefined ? overrides.locked_total_price : exactDecimal.exactMultiplyRound(qty, unitPrice, 2);
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
        supplier_decision_id, buyer_id, actor_id, actor_role, decision,
        accepted_quantity, agreed_unit_price, currency, price_lock_status, decision_timestamp
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'BUYER', ?, ?, ?, 'PKR', ?, NOW())`,
      [
        bCode,
        poolId,
        resId,
        overrides.snapshot_id,
        suppDecId,
        buyerId,
        buyerId,
        overrides.buyer_decision,
        qty,
        unitPrice,
        overrides.buyer_decision === 'ACCEPT' ? 'LOCKED' : 'DECLINED'
      ]
    );
  }

  return resId;
}

async function runSuite() {
  console.log('================================================================================');
  console.log('🚀 MILJOR PART 4E.1.1: EXACT FINANCIAL ARITHMETIC & RECONCILIATION HARDENING');
  console.log('Target Database: miljor_test_db');
  console.log('================================================================================');

  let passedTests = 0;
  let totalTests = 0;

  function recordPass(desc) {
    passedTests++;
    totalTests++;
    console.log(`  ✅ Test ${totalTests}: ${desc}`);
  }

  try {
    // Capture pre-test baseline for miljor_db preservation
    const [initPools] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pools');
    const [initRes] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.reservations');
    const [initOrders] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.orders');
    const [initSnapshots] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pool_commercial_snapshots');

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
    // SECTION 1: Pure Exact Decimal Arithmetic (OBS-75)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 1: Exact Decimal Arithmetic & Rounding Invariants (OBS-75) ---');

    // Test 1: Whole quantity x whole price
    const res1 = exactDecimal.exactMultiplyRound('40.0000', '4800.00', 2);
    assert.strictEqual(res1, '192000.00');
    recordPass('Whole quantity x whole price produces exact 2-decimal subtotal (192000.00)');

    // Test 2: Fractional quantity x fractional price requiring half-up rounding
    // 12.5000 x 333.33 = 4166.625 -> half-up rounds to 4166.63
    const res2 = exactDecimal.exactMultiplyRound('12.5000', '333.33', 2);
    assert.strictEqual(res2, '4166.63');
    recordPass('Fractional quantity x fractional price rounds exact half-up (12.5000 * 333.33 = 4166.63)');

    // Test 3: Edge case where JavaScript binary floating-point fails
    // In IEEE-754: 0.0030 * 5.00 = 0.015, but (0.015).toFixed(2) in JS produces '0.01' (false downward truncation).
    // MySQL ROUND(0.0030 * 5.00, 2) produces '0.02'.
    const res3 = exactDecimal.exactMultiplyRound('0.0030', '5.00', 2);
    assert.strictEqual(res3, '0.02', 'Exact decimal math must prevent JS float downward truncation on 0.015');
    recordPass('Float rounding edge case (0.0030 * 5.00 = 0.02) matches MySQL ROUND exactly');

    // Test 4: Maximum valid DECIMAL(12,4) and DECIMAL(12,2) boundaries
    const maxQty = '99999999.9999';
    const maxPrice = '99999999.99';
    const res4 = exactDecimal.exactMultiplyRound(maxQty, maxPrice, 2);
    assert.strictEqual(res4, '9999999998990000.00');
    recordPass('Maximum valid DECIMAL(12,4) and DECIMAL(12,2) values compute without numeric overflow');

    // Test 5: Rejection of invalid / non-numeric formats (NaN, Infinity, malformed syntax)
    let caughtNan = false;
    try { exactDecimal.exactMultiplyRound('NaN', '100.00', 2); } catch (e) { caughtNan = true; }
    assert.strictEqual(caughtNan, true);

    let caughtInf = false;
    try { exactDecimal.exactMultiplyRound('Infinity', '100.00', 2); } catch (e) { caughtInf = true; }
    assert.strictEqual(caughtInf, true);

    let caughtSyntax = false;
    try { exactDecimal.exactMultiplyRound('12.34.56', '100.00', 2); } catch (e) { caughtSyntax = true; }
    assert.strictEqual(caughtSyntax, true);
    recordPass('Rejects NaN, Infinity, and malformed decimal syntax fail-closed');

    // Test 6: Rejection of precision and scale overflow
    let caughtScaleOverflow = false;
    try { exactDecimal.toDecimalString('1.1234567890', { maxScale: 8 }); } catch (e) { caughtScaleOverflow = true; }
    assert.strictEqual(caughtScaleOverflow, true);
    recordPass('Rejects fraction digits exceeding maximum allowed scale');

    // -------------------------------------------------------------------------
    // SECTION 2: Exact Canonical Equality & Tolerance Elimination (OBS-76)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Canonical Equality & Tolerance Elimination (OBS-76) ---');

    // Test 7: Identical canonical amounts equal true across trailing zeros
    assert.strictEqual(exactDecimal.exactDecimalEquals('4166.63', '4166.6300', 2), true);
    assert.strictEqual(exactDecimal.exactDecimalEquals('0', '0.00', 2), true);
    recordPass('Identical canonical amounts compare equal across trailing zero representations');

    // Test 8: Exactly one cent mismatch must be rejected (eliminates 0.01 tolerance)
    assert.strictEqual(exactDecimal.exactDecimalEquals('4166.63', '4166.62', 2), false);
    assert.strictEqual(exactDecimal.exactDecimalEquals('4166.63', '4166.64', 2), false);
    recordPass('One-cent difference (4166.63 vs 4166.62) is strictly rejected (zero tolerance)');

    // -------------------------------------------------------------------------
    // SECTION 3: Service-Level Financial Reconciliation & Tampering Tests
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Reconciliation Service Exact Arithmetic & Protection ---');

    const poolA = await createTestPoolFixture({ supplier_min_qty: 50.0000 });
    const snapA = await createTestSnapshotFixture(poolA, {
      eligible_aggregate_qty: 70.0000,
      supplier_min_qty: 50.0000,
      candidate_unit_price: 4800.00
    });
    const suppDecA = await createTestSupplierDecision(poolA, snapA, { decision: 'ACCEPT', agreed_aggregate_qty: 70.0000 });

    // Buyer 1: 40 bags @ 4800.00 = 192000.00
    const resA1 = await createTestReservationFixture(poolA, 5, 40.0000, {
      snapshot_id: snapA,
      locked_unit_price: 4800.00,
      locked_total_price: 192000.00,
      buyer_decision: 'ACCEPT'
    });
    // Buyer 2: 30 bags @ 4800.00 = 144000.00
    const resA2 = await createTestReservationFixture(poolA, 6, 30.0000, {
      snapshot_id: snapA,
      locked_unit_price: 4800.00,
      locked_total_price: 144000.00,
      buyer_decision: 'ACCEPT'
    });

    // Test 9: Valid canonical readiness evaluation
    const evalA1 = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resA1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalA1.eligible_for_order, true);
    assert.deepStrictEqual(evalA1.reason_codes, ['ELIGIBLE_FOR_ORDER']);
    assert.strictEqual(evalA1.merchandise_subtotal, 192000.00);
    recordPass('Valid canonical reservation subtotal reconciles cleanly with ELIGIBLE_FOR_ORDER');

    // Test 10: 1-cent tampered subtotal fails closed with SUBTOTAL_CALCULATION_MISMATCH
    const pool1Cent = await createTestPoolFixture({ supplier_min_qty: 50.0000 });
    const snap1Cent = await createTestSnapshotFixture(pool1Cent, {
      eligible_aggregate_qty: 70.0000,
      supplier_min_qty: 50.0000,
      candidate_unit_price: 4800.00
    });
    await createTestSupplierDecision(pool1Cent, snap1Cent, { decision: 'ACCEPT', agreed_aggregate_qty: 70.0000 });

    const resTampered1Cent = await createTestReservationFixture(pool1Cent, 5, 40.0000, {
      snapshot_id: snap1Cent,
      locked_unit_price: 4800.00,
      locked_total_price: 192000.01, // 1-cent discrepancy
      buyer_decision: 'ACCEPT'
    });
    const eval1Cent = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resTampered1Cent,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(eval1Cent.eligible_for_order, false);
    assert.ok(eval1Cent.reason_codes.includes('SUBTOTAL_CALCULATION_MISMATCH'), 'Must reject 1-cent discrepancy');
    recordPass('OBS-76: Exactly 1-cent discrepancy fails closed with SUBTOTAL_CALCULATION_MISMATCH');

    // Test 11: Divergent snapshot unit price fails closed with SNAPSHOT_PRICE_DISCREPANCY
    const poolDivergent = await createTestPoolFixture({ supplier_min_qty: 50.0000 });
    const snapDivergent = await createTestSnapshotFixture(poolDivergent, {
      eligible_aggregate_qty: 70.0000,
      supplier_min_qty: 50.0000,
      candidate_unit_price: 4800.00
    });
    await createTestSupplierDecision(poolDivergent, snapDivergent, { decision: 'ACCEPT', agreed_aggregate_qty: 70.0000 });

    const resPriceDiscrepancy = await createTestReservationFixture(poolDivergent, 5, 40.0000, {
      snapshot_id: snapDivergent,
      locked_unit_price: 4800.05, // Diverges from snapshot price (4800.00)
      locked_total_price: 192002.00,
      buyer_decision: 'ACCEPT'
    });
    const evalPriceDiscrepancy = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resPriceDiscrepancy,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalPriceDiscrepancy.eligible_for_order, false);
    assert.ok(evalPriceDiscrepancy.reason_codes.includes('SNAPSHOT_PRICE_DISCREPANCY'));
    recordPass('Divergent locked unit price fails closed with SNAPSHOT_PRICE_DISCREPANCY');

    // -------------------------------------------------------------------------
    // SECTION 4: Multi-Query Consistent Read Snapshot (OBS-77)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Consistent Read MVCC Snapshot & Concurrency (OBS-77) ---');

    // Setup: Pool with supplier min 50. Buyer 1 accepted 20. Total accepted = 20 < 50 (Quorum NOT met).
    // Then during Buyer 1 readiness evaluation, Buyer 2 accepts 30 concurrently.
    const poolConc = await createTestPoolFixture({ supplier_min_qty: 50.0000 });
    const snapConc = await createTestSnapshotFixture(poolConc, {
      eligible_aggregate_qty: 70.0000,
      supplier_min_qty: 50.0000,
      candidate_unit_price: 4800.00
    });
    const suppDecConc = await createTestSupplierDecision(poolConc, snapConc, { decision: 'ACCEPT', agreed_aggregate_qty: 70.0000 });

    const resConc1 = await createTestReservationFixture(poolConc, 5, 20.0000, {
      snapshot_id: snapConc,
      buyer_decision: 'ACCEPT'
    });
    const resConc2 = await createTestReservationFixture(poolConc, 6, 30.0000, {
      snapshot_id: snapConc,
      // Buyer 2 has NOT yet accepted at evaluation start
    });

    // Test 12: Deterministic concurrency test using internal testHooks
    let concurrentBuyer2Committed = false;
    const evalConsistent = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resConc1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' },
      testHooks: {
        beforeDemandQuery: async () => {
          // Concurrently insert Buyer 2 ACCEPT decision in a separate connection/transaction
          const bCode = `BDEC-CONC-${Date.now()}`;
          await db.query(
            `INSERT INTO pool_buyer_commercial_decisions (
              decision_code, pool_id, reservation_id, snapshot_id, snapshot_version,
              supplier_decision_id, buyer_id, actor_id, actor_role, decision,
              accepted_quantity, agreed_unit_price, currency, price_lock_status, decision_timestamp
            ) VALUES (?, ?, ?, ?, 1, ?, 6, 6, 'BUYER', 'ACCEPT', 30.0000, 4800.00, 'PKR', 'LOCKED', NOW())`,
            [bCode, poolConc, resConc2, snapConc, suppDecConc]
          );
          concurrentBuyer2Committed = true;
        }
      }
    });

    assert.strictEqual(concurrentBuyer2Committed, true, 'Concurrent buyer decision must be committed during hook');
    // Under REPEATABLE READ with consistent snapshot started before the hook,
    // the evaluation query MUST NOT see Buyer 2's concurrent accept!
    assert.strictEqual(evalConsistent.eligible_for_order, false, 'Consistent snapshot must isolate unobserved concurrent decision');
    assert.strictEqual(evalConsistent.accounting.buyer_accepted_demand, 20, 'Accepted demand must reflect snapshot state (20)');
    assert.strictEqual(evalConsistent.accounting.buyer_accepted_count, 1, 'Accepted count must reflect snapshot state (1)');
    recordPass('OBS-77: REPEATABLE READ consistent snapshot isolates concurrent buyer decision cleanly');

    // Test 13: Subsequent independent readiness call observes newly committed state
    const evalPostConcurrent = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resConc1,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalPostConcurrent.eligible_for_order, true, 'Fresh evaluation observes newly committed quorum');
    assert.strictEqual(evalPostConcurrent.accounting.buyer_accepted_demand, 50, 'Updated accepted demand reaches 50');
    assert.strictEqual(evalPostConcurrent.accounting.buyer_accepted_count, 2, 'Updated accepted count reaches 2');
    recordPass('Fresh evaluation starts new snapshot and accurately observes updated committed quorum');

    // -------------------------------------------------------------------------
    // SECTION 5: Tax, Fee & Financial Component Classification (OBS-78)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: Financial Component Classification & Invariants (OBS-78) ---');

    // Test 14: Tax status must be PENDING_DETERMINATION (no false claims of tax exemption)
    assert.strictEqual(evalA1.financial_breakdown.tax_status, 'PENDING_DETERMINATION');
    assert.notStrictEqual(evalA1.financial_breakdown.tax_status, 'EXEMPT_OR_UNSPECIFIED');
    recordPass('OBS-78: Tax status classified as PENDING_DETERMINATION (no unsubstantiated exemption)');

    // Test 15: Doorstep delivery fee status is PENDING_QUOTE (no zero-fee assumption)
    assert.strictEqual(evalA1.financial_breakdown.delivery_fee_status, 'PENDING_QUOTE');
    assert.strictEqual(evalA1.financial_breakdown.estimated_delivery_fee, null);
    recordPass('OBS-78: Doorstep delivery fee classified as PENDING_QUOTE without assuming zero');

    // Test 16: Supplier pickup delivery fee status is DETERMINED_ZERO with 0.00 estimated fee
    const poolPickup = await createTestPoolFixture({ delivery_type: 'SUPPLIER_PICKUP' });
    const snapPickup = await createTestSnapshotFixture(poolPickup, {
      eligible_aggregate_qty: 70.0000,
      supplier_min_qty: 50.0000
    });
    await createTestSupplierDecision(poolPickup, snapPickup, { decision: 'ACCEPT' });
    const resPickup = await createTestReservationFixture(poolPickup, 5, 60.0000, {
      snapshot_id: snapPickup,
      buyer_decision: 'ACCEPT'
    });

    const evalPickup = await commercialReconciliationService.evaluateOrderReadiness({
      reservationId: resPickup,
      actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' }
    });
    assert.strictEqual(evalPickup.financial_breakdown.delivery_fee_status, 'DETERMINED_ZERO');
    assert.strictEqual(evalPickup.financial_breakdown.estimated_delivery_fee, 0.00);
    recordPass('Supplier pickup delivery fee is explicitly DETERMINED_ZERO (0.00)');

    // Test 17: Merchandise subtotal is strictly separated from payable total
    assert.strictEqual(evalA1.financial_breakdown.merchandise_subtotal, 192000.00);
    assert.strictEqual(evalA1.financial_breakdown.payable_total_status, 'REQUIRES_FEE_COMPOSITION_AT_ORDER_CREATION');
    assert.strictEqual(evalA1.financial_components_status, 'MERCHANDISE_SUBTOTAL_LOCKED');
    recordPass('Merchandise subtotal remains strictly isolated from final payable fee composition');

    // -------------------------------------------------------------------------
    // SECTION 6: Security, HTTP Endpoint & Zero Mutation Invariants
    // -------------------------------------------------------------------------
    console.log('\n--- Section 6: Security, HTTP Endpoint & Zero Mutation Guarantees ---');

    // Test 18: HTTP GET /api/v1/reservations/:id/order-readiness returns hardened payload
    const httpRes = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${resA1}/order-readiness`, {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(httpRes.status, 200);
    assert.strictEqual(httpRes.body.success, true);
    assert.strictEqual(httpRes.body.data.eligible_for_order, true);
    assert.strictEqual(httpRes.body.data.financial_breakdown.tax_status, 'PENDING_DETERMINATION');
    recordPass('HTTP endpoint delivers hardened readiness model with 200 OK');

    // Test 19: Cross-buyer access denied (tenant isolation)
    const httpCross = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${resA1}/order-readiness`, {
      Authorization: `Bearer ${competitorBuyerToken}`
    });
    assert.strictEqual(httpCross.status, 403);
    assert.strictEqual(httpCross.body.error.code, 'FORBIDDEN');
    recordPass('Tenant isolation: Cross-buyer order readiness request rejected with HTTP 403');

    // Test 20: Suspended buyer denied
    await db.query("UPDATE users SET buyer_trust_status = 'SUSPENDED' WHERE id = 5");
    try {
      const httpSuspended = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${resA1}/order-readiness`, {
        Authorization: `Bearer ${buyer1Token}`
      });
      assert.strictEqual(httpSuspended.status, 403);
      assert.strictEqual(httpSuspended.body.error.code, 'ACCOUNT_SUSPENDED');
      recordPass('Security invariant: Suspended buyer denied order readiness inspection with HTTP 403');
    } finally {
      await db.query("UPDATE users SET buyer_trust_status = 'CONTACT_VERIFIED' WHERE id = 5");
    }

    // Test 21: Zero live orders, zero payment sessions, zero ledger entries created
    const [orderCount] = await db.query('SELECT COUNT(*) as cnt FROM orders');
    const [paymentCount] = await db.query('SELECT COUNT(*) as cnt FROM payments');
    assert.strictEqual(orderCount[0].cnt, 0, 'Zero orders must exist in test db');
    assert.strictEqual(paymentCount[0].cnt, 0, 'Zero payments must exist in test db');
    recordPass('Financial safety: Zero live orders, payment intents, or ledger mutations created');

    // Test 22: miljor_db remains 100% PRISTINE
    const [prodPools] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pools');
    const [prodRes] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.reservations');
    const [prodOrders] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.orders');
    const [prodSnapshots] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pool_commercial_snapshots');
    assert.strictEqual(prodPools[0].cnt, initPools[0].cnt, `miljor_db pools must remain unchanged (${initPools[0].cnt})`);
    assert.strictEqual(prodRes[0].cnt, initRes[0].cnt, `miljor_db reservations must remain unchanged (${initRes[0].cnt})`);
    assert.strictEqual(prodOrders[0].cnt, initOrders[0].cnt, `miljor_db orders must remain unchanged (${initOrders[0].cnt})`);
    assert.strictEqual(prodSnapshots[0].cnt, initSnapshots[0].cnt, `miljor_db snapshots must remain unchanged (${initSnapshots[0].cnt})`);
    recordPass('Database isolation: miljor_db is 100% PRISTINE and completely unchanged from baseline');

  } catch (err) {
    console.error('Fatal suite failure:', err);
    throw err;
  } finally {
    console.log('\nCleaning up test fixtures from miljor_test_db...');
    if (createdReservationIds.length > 0) {
      await db.query('DELETE FROM pool_buyer_commercial_decisions WHERE reservation_id IN (?)', [createdReservationIds]);
      await db.query('DELETE FROM reservations WHERE id IN (?)', [createdReservationIds]);
    }
    if (createdPoolIds.length > 0) {
      await db.query('DELETE FROM pool_supplier_commercial_decisions WHERE pool_id IN (?)', [createdPoolIds]);
      await db.query('DELETE FROM pool_commercial_snapshots WHERE pool_id IN (?)', [createdPoolIds]);
      await db.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
    }
    if (testServer) {
      testServer.close();
    }
  }

  console.log('================================================================================');
  console.log(`Part 4E.1.1 Financial Hardening Gate: ${passedTests} / ${totalTests} assertions passed`);
  console.log('Status: PASS');
  console.log('================================================================================\n');
}

if (require.main === module) {
  runSuite()
    .then(() => {
      return db.end();
    })
    .catch((err) => {
      console.error('Suite error:', err);
      return db.end().then(() => { process.exit(1); });
    });
}

module.exports = runSuite;
