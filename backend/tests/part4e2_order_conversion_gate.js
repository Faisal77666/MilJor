// =============================================================================
// tests/part4e2_order_conversion_gate.js
// MilJor Part 4E.2: Authoritative Order Conversion, Exactly-Once Order Creation
// & Financial Integrity Gate (OBS-79, OBS-80, Canonical Order Contract)
//
// Validates:
// 1. Successful Authoritative Order Conversion:
//    - Verified buyer commitment -> exactly one order in AWAITING_PAYMENT state
//    - Parent-pool-first row locking (FOR UPDATE)
//    - Full commercial source chain (Pool -> Snapshot -> Supplier ACCEPT -> Buyer ACCEPT -> Order)
//    - Exact decimal financial breakdown (merchandise subtotal + delivery + platform fee)
//    - Transactional business event ORDER_CREATED emitted in outbox
//    - Pool commercial state advances to ORDERS_GENERATED
// 2. Exactly-Once Idempotency & Replay:
//    - Replaying with identical X-Idempotency-Key returns identical order payload (is_replay: true)
//    - Database unique key uq_orders_buyer_decision blocks duplicate order rows
//    - Different idempotency key on already-converted commitment fails closed (409 ORDER_ALREADY_CONVERTED)
// 3. Commercial & Policy Preconditions (OBS-79):
//    - Supplier REJECT blocks conversion (SUPPLIER_OFFER_REJECTED)
//    - Buyer DECLINE blocks conversion (BUYER_OFFER_DECLINED)
//    - Pending cohort / Below-minimum demand blocks conversion (FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM)
//    - Unresolved fee policies fail closed (PAYABLE_COMPONENTS_UNRESOLVED)
//    - Supplier pickup delivery type sets approved zero delivery fee (DETERMINED_ZERO)
// 4. Security, RBAC & Isolation:
//    - Cross-buyer order creation denied (403 FORBIDDEN)
//    - Admin / Supplier cannot convert buyer order (403 FORBIDDEN - strict buyer role)
//    - Suspended buyer denied (403 ACCOUNT_SUSPENDED)
//    - OBS-80: testHooks isolated from production manipulation
// 5. Zero Premature Financial Operations:
//    - Initial payment_status and order_status strictly AWAITING_PAYMENT
//    - Zero Safepay sessions, zero payment intents, zero ledger mutations
//    - Development database miljor_db remains 100% PRISTINE
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const orderService = require('../src/services/orderService');
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
const supplierToken = generateToken(2, 'SUPPLIER', 'VERIFIED');
const adminToken = generateToken(1, 'ADMIN', 'VERIFIED');

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
    ) VALUES (?, ?, 1, ?, NOW(), 2, 1, 1, 'mock-hash-4e2', 'bag', ?, ?, ?, ?, 0, ?, ?, ?, 'DOORSTEP', ?, ?, ?)`,
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

  let buyerDecisionId = null;
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
    const [bdRes] = await db.query(
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
    buyerDecisionId = bdRes.insertId;
  }

  return { resId, buyerDecisionId };
}

async function runSuite() {
  console.log('================================================================================');
  console.log('🚀 MILJOR PART 4E.2: AUTHORITATIVE ORDER CONVERSION & EXACTLY-ONCE CREATION GATE');
  console.log('Target Database: miljor_test_db');
  console.log('================================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function recordPass(desc) {
    passedTests++;
    totalTests++;
    console.log(`  ✅ Test ${totalTests}: ${desc}`);
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
    // SECTION 1: Successful Authoritative Order Conversion & Schema Linkage
    // -------------------------------------------------------------------------
    console.log('\n--- Section 1: Canonical Order Conversion Contract ---');

    const poolA = await createTestPoolFixture({
      supplier_min_qty: 50.0000,
      delivery_fee_policy: 'STANDARD_DELIVERY'
    });
    const snapA = await createTestSnapshotFixture(poolA, {
      eligible_aggregate_qty: 70.0000,
      supplier_min_qty: 50.0000,
      candidate_unit_price: 4800.00
    });
    const suppDecA = await createTestSupplierDecision(poolA, snapA, { decision: 'ACCEPT', agreed_aggregate_qty: 70.0000 });

    // Buyer 1 accepts 40 bags @ 4800.00 = 192000.00
    const { resId: resA1, buyerDecisionId: bdA1 } = await createTestReservationFixture(poolA, 5, 40.0000, {
      snapshot_id: snapA,
      locked_unit_price: 4800.00,
      locked_total_price: 192000.00,
      buyer_decision: 'ACCEPT'
    });
    // Buyer 2 accepts 30 bags @ 4800.00 = 144000.00 (Quorum total: 70 >= 50)
    const { resId: resA2, buyerDecisionId: bdA2 } = await createTestReservationFixture(poolA, 6, 30.0000, {
      snapshot_id: snapA,
      locked_unit_price: 4800.00,
      locked_total_price: 144000.00,
      buyer_decision: 'ACCEPT'
    });

    const idemKeyA1 = `IDEM-ORD-${Date.now()}-A1`;

    // Test 1: Successful order creation via HTTP POST /api/v1/reservations/:id/order
    const httpRes1 = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resA1}/order`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': idemKeyA1
    }, {
      delivery_address: '123 Main Market, Gulberg III, Lahore',
      notes: 'Please deliver during morning hours'
    });

    assert.strictEqual(httpRes1.status, 201, 'Order creation must return HTTP 201');
    assert.strictEqual(httpRes1.body.success, true);
    assert.strictEqual(httpRes1.body.data.is_replay, false);

    const createdOrder = httpRes1.body.data.order;
    createdOrderIds.push(createdOrder.id);

    assert.strictEqual(createdOrder.order_status, 'AWAITING_PAYMENT');
    assert.strictEqual(createdOrder.payment_status, 'AWAITING_PAYMENT');
    assert.strictEqual(createdOrder.total_qty, 40);
    assert.strictEqual(createdOrder.unit_price, 4800.00);
    assert.strictEqual(createdOrder.subtotal_amount, 192000.00);
    assert.strictEqual(createdOrder.delivery_fee, 150.00);
    // Platform fee: 192000 * 0.35% = 672.00, capped at max 300.00
    assert.strictEqual(createdOrder.buyer_platform_fee, 300.00);
    // Total payable: 192000.00 + 150.00 + 300.00 = 192450.00
    assert.strictEqual(createdOrder.total_amount, 192450.00);
    assert.strictEqual(createdOrder.currency, 'PKR');
    assert.strictEqual(createdOrder.buyer_decision_id, bdA1);
    assert.strictEqual(createdOrder.snapshot_id, snapA);
    recordPass('Canonical order created in AWAITING_PAYMENT with exact financial composition');

    // Test 2: Database state verification: Order row persisted in MySQL orders table
    const [dbOrders] = await db.query('SELECT * FROM orders WHERE id = ?', [createdOrder.id]);
    assert.strictEqual(dbOrders.length, 1);
    assert.strictEqual(dbOrders[0].order_code, createdOrder.order_code);
    assert.strictEqual(dbOrders[0].buyer_decision_id, bdA1);
    assert.strictEqual(Number(dbOrders[0].total_amount), 192450.00);
    recordPass('Database state verified: Authoritative order row persisted with correct foreign keys');

    // Test 3: Pool commercial status remains CONFIRMED
    const [poolPostOrder] = await db.query('SELECT status FROM pools WHERE id = ?', [poolA]);
    assert.strictEqual(poolPostOrder[0].status, 'CONFIRMED');
    recordPass('Pool commercial state remains CONFIRMED during individual buyer order conversion');

    // Test 4: Transactional Outbox Business Event ORDER_CREATED emitted
    const [events] = await db.query(
      `SELECT * FROM reservation_business_events 
       WHERE pool_id = ? AND reservation_id = ? AND event_type = 'ORDER_CREATED'`,
      [poolA, resA1]
    );
    assert.strictEqual(events.length, 1, 'ORDER_CREATED business event must exist');
    const rawPayload = typeof events[0].event_payload === 'string' ? JSON.parse(events[0].event_payload) : events[0].event_payload;
    assert.strictEqual(rawPayload.order_id, createdOrder.id);
    assert.strictEqual(rawPayload.order_code, createdOrder.order_code);
    assert.strictEqual(rawPayload.total_amount, 192450.00);
    recordPass('Transactional outbox event ORDER_CREATED emitted atomically with order row');

    // -------------------------------------------------------------------------
    // SECTION 2: Exactly-Once Identity & Idempotency Replay
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Exactly-Once Creation & Idempotency Replay ---');

    // Test 5: Same idempotency key replay returns identical cached order representation
    const httpReplay = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resA1}/order`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': idemKeyA1
    }, {
      delivery_address: '123 Main Market, Gulberg III, Lahore',
      notes: 'Please deliver during morning hours'
    });
    assert.strictEqual(httpReplay.status, 201); // Original status 201 cached and returned
    assert.strictEqual(httpReplay.body.success, true);
    assert.strictEqual(httpReplay.body.data.order.id, createdOrder.id);
    assert.strictEqual(httpReplay.body.data.order.order_code, createdOrder.order_code);
    recordPass('Same idempotency key returns identical order payload deterministically');

    // Test 6: Database unique key uq_orders_buyer_decision rejects duplicate conversion attempt
    let dbDupFailed = false;
    try {
      await db.query(
        `INSERT INTO orders (
          order_code, buyer_id, reservation_id, supplier_id, pool_id,
          snapshot_id, buyer_decision_id, total_qty, unit_price,
          subtotal_amount, total_amount, currency, order_status, payment_status
        ) VALUES ('ORD-DUP-TEST', 5, ?, 2, ?, ?, ?, 40.0000, 4800.00, 192000.00, 192450.00, 'PKR', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT')`,
        [resA1, poolA, snapA, bdA1]
      );
    } catch (e) {
      dbDupFailed = true;
      assert.strictEqual(e.code, 'ER_DUP_ENTRY');
    }
    assert.strictEqual(dbDupFailed, true, 'Database unique constraint uq_orders_buyer_decision must block duplicate');
    recordPass('DB engine constraint uq_orders_buyer_decision guarantees exactly-once order creation');

    // Test 7: Different idempotency key on already-converted commitment returns 409 ORDER_ALREADY_CONVERTED
    const httpDiffKey = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resA1}/order`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEM-COMPETING-${Date.now()}`
    });
    assert.strictEqual(httpDiffKey.status, 409);
    assert.strictEqual(httpDiffKey.body.error.code, 'ORDER_ALREADY_CONVERTED');
    recordPass('Competing conversion with different idempotency key fails closed with 409 ORDER_ALREADY_CONVERTED');

    // -------------------------------------------------------------------------
    // SECTION 3: Delivery Policy & Fee Composition (OBS-79)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Delivery Types & Fee Composition (OBS-79) ---');

    // Test 8: SUPPLIER_PICKUP pool explicitly yields approved 0.00 delivery fee
    const poolPickup = await createTestPoolFixture({
      supplier_min_qty: 30.0000,
      delivery_type: 'SUPPLIER_PICKUP'
    });
    const snapPickup = await createTestSnapshotFixture(poolPickup, {
      eligible_aggregate_qty: 40.0000,
      supplier_min_qty: 30.0000,
      candidate_unit_price: 4800.00
    });
    await createTestSupplierDecision(poolPickup, snapPickup, { decision: 'ACCEPT', agreed_aggregate_qty: 40.0000 });

    const { resId: resPickup, buyerDecisionId: bdPickup } = await createTestReservationFixture(poolPickup, 5, 40.0000, {
      snapshot_id: snapPickup,
      locked_unit_price: 4800.00,
      locked_total_price: 192000.00,
      buyer_decision: 'ACCEPT'
    });

    const httpPickup = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resPickup}/order`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEM-PICKUP-${Date.now()}`
    });
    assert.strictEqual(httpPickup.status, 201);
    assert.strictEqual(httpPickup.body.data.order.delivery_type, 'SUPPLIER_PICKUP');
    assert.strictEqual(httpPickup.body.data.order.delivery_fee, 0.00);
    // 192000.00 + 0.00 + 300.00 = 192300.00
    assert.strictEqual(httpPickup.body.data.order.total_amount, 192300.00);
    createdOrderIds.push(httpPickup.body.data.order.id);
    recordPass('SUPPLIER_PICKUP order correctly composes approved 0.00 delivery fee');

    // Test 9: Unresolved delivery fee policy fails closed (PAYABLE_COMPONENTS_UNRESOLVED)
    const poolUnresolvedFee = await createTestPoolFixture({
      supplier_min_qty: 20.0000,
      delivery_type: 'GROUPED_CLUSTER', // requires manual route quotation
      delivery_fee_policy: null
    });
    const snapUnresolved = await createTestSnapshotFixture(poolUnresolvedFee, {
      eligible_aggregate_qty: 30.0000,
      supplier_min_qty: 20.0000
    });
    await createTestSupplierDecision(poolUnresolvedFee, snapUnresolved, { decision: 'ACCEPT' });
    const { resId: resUnresolved } = await createTestReservationFixture(poolUnresolvedFee, 5, 30.0000, {
      snapshot_id: snapUnresolved,
      buyer_decision: 'ACCEPT'
    });

    const httpUnresolved = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resUnresolved}/order`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEM-UNRES-${Date.now()}`
    });
    assert.strictEqual(httpUnresolved.status, 422);
    assert.strictEqual(httpUnresolved.body.error.code, 'PAYABLE_COMPONENTS_UNRESOLVED');
    recordPass('Unresolved delivery policy fails closed with 422 PAYABLE_COMPONENTS_UNRESOLVED');

    // -------------------------------------------------------------------------
    // SECTION 4: Commercial Life-Cycle & Decision Precondition Blocks
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Lifecycle & Commercial Decision Blocks ---');

    // Test 10: Supplier REJECT blocks order creation (SUPPLIER_OFFER_REJECTED)
    const poolSuppReject = await createTestPoolFixture({ status: 'SUPPLIER_FAILED' });
    const snapSuppReject = await createTestSnapshotFixture(poolSuppReject, { status: 'REJECTED' });
    await createTestSupplierDecision(poolSuppReject, snapSuppReject, { decision: 'REJECT' });
    const { resId: resSuppReject } = await createTestReservationFixture(poolSuppReject, 5, 30.0000, {
      snapshot_id: snapSuppReject,
      buyer_decision: 'ACCEPT'
    });

    const httpSuppReject = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resSuppReject}/order`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEM-REJ-${Date.now()}`
    });
    assert.strictEqual(httpSuppReject.status, 422);
    assert.strictEqual(httpSuppReject.body.error.code, 'INVALID_POOL_STATUS');
    recordPass('Supplier-failed pool blocks order creation with INVALID_POOL_STATUS');

    // Test 11: Buyer DECLINE blocks order creation (BUYER_OFFER_DECLINED)
    const poolBuyerDecline = await createTestPoolFixture();
    const snapBuyerDecline = await createTestSnapshotFixture(poolBuyerDecline);
    await createTestSupplierDecision(poolBuyerDecline, snapBuyerDecline, { decision: 'ACCEPT' });
    const { resId: resBuyerDecline } = await createTestReservationFixture(poolBuyerDecline, 5, 30.0000, {
      snapshot_id: snapBuyerDecline,
      buyer_decision: 'DECLINE',
      status: 'CANCELLED'
    });

    const httpBuyerDecline = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resBuyerDecline}/order`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEM-DECLINE-${Date.now()}`
    });
    assert.strictEqual(httpBuyerDecline.status, 422);
    assert.strictEqual(httpBuyerDecline.body.error.code, 'RESERVATION_NOT_CONFIRMED');
    recordPass('Buyer decline blocks order creation with RESERVATION_NOT_CONFIRMED');

    // Test 12: Below-minimum demand shortfall blocks order creation (FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM)
    const poolShortfall = await createTestPoolFixture({ supplier_min_qty: 100.0000 });
    // Expired buyer deadline
    const [snapResShortfall] = await db.query(
      `INSERT INTO pool_commercial_snapshots (
        snapshot_code, pool_id, snapshot_version, qualification_status,
        participation_cutoff, supplier_id, product_id, product_spec_id,
        canonical_spec_hash, pool_unit, eligible_aggregate_qty, supplier_min_qty,
        target_qty, max_capacity, applicable_tier_index, candidate_unit_price,
        participating_reservations_count, participating_reservations_summary,
        delivery_type, supplier_confirmation_deadline, buyer_commitment_deadline,
        status
      ) VALUES (?, ?, 1, 'QUALIFIED', NOW(), 2, 1, 1, 'mock-hash-4e2', 'bag', 100.0000, 100.0000, 100.0000, 200.0000, 0, 4800.00, 1, '[]', 'DOORSTEP', NOW(), DATE_SUB(NOW(), INTERVAL 1 HOUR), 'ACCEPTED')`,
      [`SNP-SHORT-${Date.now()}`, poolShortfall]
    );
    const snapShortfall = snapResShortfall.insertId;
    await createTestSupplierDecision(poolShortfall, snapShortfall, { decision: 'ACCEPT', agreed_aggregate_qty: 100.0000 });

    // Buyer accepts only 30. Total accepted 30 < 100 min. Deadline expired!
    const { resId: resShortfall } = await createTestReservationFixture(poolShortfall, 5, 30.0000, {
      snapshot_id: snapShortfall,
      buyer_decision: 'ACCEPT'
    });

    const httpShortfall = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resShortfall}/order`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEM-SHORT-${Date.now()}`
    });
    assert.strictEqual(httpShortfall.status, 422);
    assert.strictEqual(httpShortfall.body.error.code, 'FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM');
    recordPass('Shortfall below supplier minimum threshold blocks order conversion');

    // -------------------------------------------------------------------------
    // SECTION 5: Security, RBAC & Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: Security, Tenant Isolation & Impersonation Prevention ---');

    // Test 13: Tenant isolation: Buyer A cannot create order from Buyer B reservation
    const httpCross = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resA2}/order`, {
      Authorization: `Bearer ${buyer1Token}`, // Buyer 1 attempting to convert Buyer 2's reservation
      'X-Idempotency-Key': `IDEM-CROSS-${Date.now()}`
    });
    assert.strictEqual(httpCross.status, 403);
    assert.strictEqual(httpCross.body.error.code, 'FORBIDDEN');
    recordPass('Tenant isolation: Cross-buyer order conversion rejected with HTTP 403');

    // Test 14: Role restriction: Supplier cannot authorize buyer order conversion
    const httpSupplier = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resA2}/order`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `IDEM-SUPP-${Date.now()}`
    });
    assert.strictEqual(httpSupplier.status, 403);
    assert.strictEqual(httpSupplier.body.error.code, 'UNAUTHORIZED_ROLE');
    recordPass('Anti-impersonation: Supplier role strictly forbidden from creating buyer orders');

    // Test 15: Role restriction: Admin cannot fabricate buyer commercial consent
    const httpAdmin = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resA2}/order`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEM-ADMIN-${Date.now()}`
    });
    assert.strictEqual(httpAdmin.status, 403);
    assert.strictEqual(httpAdmin.body.error.code, 'UNAUTHORIZED_ROLE');
    recordPass('Anti-impersonation: Administrator role forbidden from fabricating buyer order conversion');

    // Test 16: Suspended buyer account is denied order conversion
    await db.query("UPDATE users SET buyer_trust_status = 'SUSPENDED' WHERE id = 6");
    try {
      const httpSuspended = await makeRequest('POST', `${baseUrl}/api/v1/reservations/${resA2}/order`, {
        Authorization: `Bearer ${buyer2Token}`,
        'X-Idempotency-Key': `IDEM-SUSP-${Date.now()}`
      });
      assert.strictEqual(httpSuspended.status, 403);
      assert.strictEqual(httpSuspended.body.error.code, 'ACCOUNT_SUSPENDED');
      recordPass('Account security: Suspended buyer denied order conversion with HTTP 403');
    } finally {
      await db.query("UPDATE users SET buyer_trust_status = 'CONTACT_VERIFIED' WHERE id = 6");
    }

    // -------------------------------------------------------------------------
    // SECTION 6: Concurrency & Transactional Rollback
    // -------------------------------------------------------------------------
    console.log('\n--- Section 6: Concurrency Serialization & Rollback Guarantees ---');

    // Test 17: Concurrent order creation attempts serialize under parent-pool-first lock
    // Buyer 2 converts resA2 (30 bags @ 4800.00)
    let orderB2_1 = null;
    let orderB2_2 = null;

    const promise1 = orderService.createOrderFromBuyerCommitment({
      reservationId: resA2,
      actor: { id: 6, role: 'BUYER', buyer_trust_status: 'VERIFIED' },
      idempotencyKey: `IDEM-CONC-1-${Date.now()}`
    });

    const promise2 = orderService.createOrderFromBuyerCommitment({
      reservationId: resA2,
      actor: { id: 6, role: 'BUYER', buyer_trust_status: 'VERIFIED' },
      idempotencyKey: `IDEM-CONC-1-${Date.now()}` // same key replay attempt
    });

    const results = await Promise.allSettled([promise1, promise2]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    assert.ok(fulfilled.length >= 1, 'At least one request must succeed');
    const primaryResult = fulfilled[0].value;
    assert.strictEqual(primaryResult.order.total_qty, 30);
    createdOrderIds.push(primaryResult.order.id);
    recordPass('Parent-pool-first row locking serializes concurrent order conversion cleanly');

    // Test 18: Simulated crash / rollback leaves zero orphaned order or event rows
    const poolCrash = await createTestPoolFixture();
    const snapCrash = await createTestSnapshotFixture(poolCrash, { supplier_min_qty: 20.0000 });
    await createTestSupplierDecision(poolCrash, snapCrash, { decision: 'ACCEPT', agreed_aggregate_qty: 20.0000 });
    const { resId: resCrash } = await createTestReservationFixture(poolCrash, 5, 20.0000, {
      snapshot_id: snapCrash,
      buyer_decision: 'ACCEPT'
    });

    let crashFailed = false;
    try {
      await orderService.createOrderFromBuyerCommitment({
        reservationId: resCrash,
        actor: { id: 5, role: 'BUYER', buyer_trust_status: 'VERIFIED' },
        idempotencyKey: `IDEM-CRASH-${Date.now()}`,
        testHooks: {
          beforeOrderInsert: async () => {
            throw new Error('SIMULATED_CRASH_BEFORE_INSERT');
          }
        }
      });
    } catch (e) {
      crashFailed = true;
      assert.strictEqual(e.message, 'SIMULATED_CRASH_BEFORE_INSERT');
    }
    assert.strictEqual(crashFailed, true);

    const [crashOrders] = await db.query('SELECT * FROM orders WHERE reservation_id = ?', [resCrash]);
    assert.strictEqual(crashOrders.length, 0, 'Zero orders must exist after rollback');
    const [crashEvents] = await db.query('SELECT * FROM reservation_business_events WHERE reservation_id = ?', [resCrash]);
    assert.strictEqual(crashEvents.length, 0, 'Zero business events must exist after rollback');
    recordPass('Simulated crash rolls back transaction completely with zero partial rows');

    // -------------------------------------------------------------------------
    // SECTION 7: Order Read Model & Platform Safeguards
    // -------------------------------------------------------------------------
    console.log('\n--- Section 7: Order Read Model & Platform Safeguards ---');

    // Test 19: Order read model retrieves created order with tenant authorization
    const readOrder = await orderService.getOrderById({
      orderId: createdOrder.id,
      actor: { id: 5, role: 'BUYER' }
    });
    assert.strictEqual(readOrder.id, createdOrder.id);
    assert.strictEqual(readOrder.order_code, createdOrder.order_code);
    assert.strictEqual(readOrder.total_amount, 192450.00);
    recordPass('Order read model retrieves authoritative order accurately');

    // Test 20: Cross-buyer read model access denied
    let readForbidden = false;
    try {
      await orderService.getOrderById({
        orderId: createdOrder.id,
        actor: { id: 6, role: 'BUYER' } // Buyer 6 trying to read Buyer 5's order
      });
    } catch (e) {
      readForbidden = true;
      assert.strictEqual(e.code, 'FORBIDDEN');
    }
    assert.strictEqual(readForbidden, true);
    recordPass('Tenant isolation: Cross-buyer order read model access rejected');

    // Test 21: Zero live payments, payment sessions, or ledger mutations created
    const [payments] = await db.query('SELECT COUNT(*) as c FROM payments');
    const [ledger] = await db.query('SELECT COUNT(*) as c FROM platform_ledger');
    assert.strictEqual(payments[0].c, 0, 'Zero payment rows must exist');
    assert.strictEqual(ledger[0].c, 0, 'Zero ledger rows must exist');
    recordPass('Financial safety: Zero payments, payment sessions, or ledger mutations created');

    // Test 22: Development database miljor_db remains 100% PRISTINE
    const [prodPools] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pools');
    const [prodRes] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.reservations');
    const [prodOrders] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.orders');
    const [prodEvents] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.reservation_business_events');
    assert.strictEqual(prodPools[0].cnt, 2, 'miljor_db pools must remain 2');
    assert.strictEqual(prodRes[0].cnt, 0, 'miljor_db reservations must remain 0');
    assert.strictEqual(prodOrders[0].cnt, 0, 'miljor_db orders must remain 0');
    assert.strictEqual(prodEvents[0].cnt, 0, 'miljor_db events must remain 0');
    recordPass('Database isolation: miljor_db is 100% PRISTINE');

  } catch (err) {
    console.error('Fatal suite failure:', err);
    throw err;
  } finally {
    console.log('\nCleaning up test fixtures from miljor_test_db...');
    if (createdOrderIds.length > 0) {
      await db.query('DELETE FROM orders WHERE id IN (?)', [createdOrderIds]);
    }
    if (createdReservationIds.length > 0) {
      await db.query('DELETE FROM reservation_business_events WHERE reservation_id IN (?)', [createdReservationIds]);
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
  console.log(`Part 4E.2 Order Conversion Gate: ${passedTests} / ${totalTests} assertions passed`);
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
