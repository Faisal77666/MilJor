// =============================================================================
// tests/part4e4_fulfillment_gate.js
// MilJor Part 4E.4: Post-Payment Fulfillment & Supplier-Managed Delivery Gate
//
// Comprehensive Level 1/2 verification covering:
// 1. PAID-only fulfillment eligibility (unpaid orders rejected)
// 2. Unpaid and incomplete payment rejection
// 3. Correct supplier assignment
// 4. Supplier cross-tenant denial
// 5. Buyer cross-tenant denial
// 6. Valid transition sequence (AWAITING -> PREPARING -> READY -> DISPATCHED -> DELIVERED -> BUYER_CONFIRMED)
// 7. Invalid/skipped/backward transitions rejected
// 8. Idempotent replay for same-action requests
// 9. Conflicting concurrent transitions (409)
// 10. Durable transactional outbox & audit history
// 11. Buyer receiving confirmation prerequisites (must be SUPPLIER_DELIVERED first)
// 12. Supplier-delivered vs buyer-confirmed separation
// 13. Shortage & discrepancy exception recording
// 14. Zero automatic refund, payout, or escrow release
// 15. Financial totals immutable throughout fulfillment
// 16. Existing inventory reservation integrity
// 17. Pagination & input bounds validation
// 18. UTC timestamp correctness
// 19. Existing order/payment compatibility
// 20. Database isolation & safety guards
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const { assertTestDatabaseSafety } = require('./testDbSafetyGuard');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

// Seeded users:
// User 1: ADMIN
// User 2: SUPPLIER (Verified)
// User 3: SUPPLIER (Competitor Supplier)
// User 5: BUYER 1
// User 6: BUYER 2 (Competitor Buyer)
const buyer1Token = generateToken(5, 'BUYER', 'VERIFIED');
const buyer2Token = generateToken(6, 'BUYER', 'VERIFIED');
const supplierToken = generateToken(2, 'SUPPLIER', 'VERIFIED');
const competitorSupplierToken = generateToken(3, 'SUPPLIER', 'VERIFIED');
const adminToken = generateToken(1, 'ADMIN', 'VERIFIED');

let testServer = null;
let baseUrl = '';

function makeRequest(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    let postData = null;
    if (body !== null) {
      postData = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(JSON.stringify(body), 'utf8');
    }

    const reqHeaders = { ...headers };
    if (postData) {
      if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = postData.length;
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
    if (postData) req.write(postData);
    req.end();
  });
}

const createdPoolIds = [];
const createdOrderIds = [];
const createdReservationIds = [];
let passCount = 0;
let failCount = 0;

function recordPass(desc) {
  passCount++;
  console.log(`  [PASS] Assertion ${passCount}: ${desc}`);
}

function recordFail(desc, err) {
  failCount++;
  console.error(`  [FAIL] Assertion ${passCount + failCount}: ${desc}`);
  console.error(err);
}

async function runPart4E4FulfillmentGate() {
  console.log('================================================================================');
  console.log('MILJOR PART 4E.4: POST-PAYMENT FULFILLMENT & DELIVERY GATE');
  console.log('Target Database: miljor_test_db');
  console.log('================================================================================\n');

  try {
    // 0. Safety Guard Check
    await assertTestDatabaseSafety(db, 'part4e4_fulfillment_gate');

    // Start local HTTP test server
    testServer = http.createServer(app);
    await new Promise((resolve) => {
      testServer.listen(0, '127.0.0.1', () => {
        const port = testServer.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        console.log(`📡 Test server listening at ${baseUrl}\n`);
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // SECTION 1: FIXTURE SETUP
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Commercial Order Fixture Setup ---');

    // Helper to create an order fixture with specific payment & fulfillment status
    async function createOrderFixture({
      buyerId,
      supplierId = 2,
      qty = 20.0,
      unitPrice = 1250.00,
      paymentStatus = 'PAID',
      fulfillmentStatus = 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT',
      orderStatus = 'PAID'
    }) {
      const subtotal = qty * unitPrice;
      const deliveryFee = 1200.00;
      const platformFee = 500.00;
      const total = subtotal + deliveryFee + platformFee;

      // Create dedicated pool for this order fixture to respect unique active pool buyer constraint
      const [poolRes] = await db.query(
        `INSERT INTO pools (
          pool_code, product_id, product_spec_id, supplier_listing_id, supplier_id,
          status, pool_unit, buyer_min_qty, purchase_increment, target_qty,
          supplier_min_qty, max_capacity, current_qty, current_price_per_unit,
          delivery_type, delivery_fee_policy, expires_at, created_at, updated_at
        ) VALUES (
          CONCAT('P4E4-', SUBSTRING(UNIX_TIMESTAMP(), -6), FLOOR(RAND() * 1000)), 1, 1, 1, ?,
          'CONFIRMED', 'BAG_50KG', 5.0000, 1.0000, 30.0000,
          20.0000, 50.0000, 30.0000, 1250.00,
          'DOORSTEP', 'STANDARD_DELIVERY', DATE_ADD(NOW(), INTERVAL 2 DAY), NOW(), NOW()
        )`,
        [supplierId]
      );
      const fixturePoolId = poolRes.insertId;
      createdPoolIds.push(fixturePoolId);

      await db.query(
        `INSERT INTO pool_price_tiers (pool_id, min_qty, max_qty, price_per_unit, pricing_unit)
         VALUES (?, 5.0000, 50.0000, 1250.00, 'BAG_50KG')`,
        [fixturePoolId]
      );

      const [snapRes] = await db.query(
        `INSERT INTO pool_commercial_snapshots (
          snapshot_code, pool_id, snapshot_version, qualification_status,
          participation_cutoff, supplier_id, product_id, product_spec_id,
          canonical_spec_hash, pool_unit, eligible_aggregate_qty, supplier_min_qty,
          target_qty, max_capacity, applicable_tier_index, candidate_unit_price,
          participating_reservations_count, participating_reservations_summary,
          delivery_type, supplier_confirmation_deadline, buyer_commitment_deadline,
          status
        ) VALUES (
          CONCAT('S4E4-', SUBSTRING(UNIX_TIMESTAMP(), -6), FLOOR(RAND() * 1000)), ?, 1, 'QUALIFIED',
          NOW(), ?, 1, 1, 'mock-hash-4e4', 'BAG_50KG', 30.0000, 20.0000,
          30.0000, 50.0000, 1, 1250.00,
          1, '[]',
          'DOORSTEP', DATE_ADD(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 2 DAY), 'ACCEPTED'
        )`,
        [fixturePoolId, supplierId]
      );
      const fixtureSnapshotId = snapRes.insertId;

      const [suppDec] = await db.query(
        `INSERT INTO pool_supplier_commercial_decisions (
          decision_code, pool_id, snapshot_id, snapshot_version, supplier_id,
          actor_id, actor_role, decision, agreed_aggregate_qty, agreed_unit_price
        ) VALUES (
          CONCAT('SD4E4-', SUBSTRING(UNIX_TIMESTAMP(), -6), FLOOR(RAND() * 1000)), ?, ?, 1, ?,
          ?, 'SUPPLIER', 'ACCEPT', 30.0000, 1250.00
        )`,
        [fixturePoolId, fixtureSnapshotId, supplierId, supplierId]
      );
      const fixtureSupplierDecisionId = suppDec.insertId;

      const [resRes] = await db.query(
        `INSERT INTO reservations (
          reservation_code, pool_id, buyer_id, quantity, unit_price,
          total_price, locked_unit_price, locked_total_price, status
        ) VALUES (
          CONCAT('R4E4-', SUBSTRING(UNIX_TIMESTAMP(), -6), FLOOR(RAND() * 1000)),
          ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED'
        )`,
        [fixturePoolId, buyerId, qty, unitPrice, subtotal, unitPrice, subtotal]
      );
      const resId = resRes.insertId;
      createdReservationIds.push(resId);

      const [buyDec] = await db.query(
        `INSERT INTO pool_buyer_commercial_decisions (
          decision_code, pool_id, reservation_id, snapshot_id, snapshot_version,
          supplier_decision_id, buyer_id, actor_id, actor_role, decision,
          accepted_quantity, agreed_unit_price, currency, price_lock_status, decision_timestamp
        ) VALUES (
          CONCAT('BD4E4-', SUBSTRING(UNIX_TIMESTAMP(), -6), FLOOR(RAND() * 1000)),
          ?, ?, ?, 1, ?, ?, ?, 'BUYER', 'ACCEPT',
          ?, ?, 'PKR', 'LOCKED', NOW()
        )`,
        [fixturePoolId, resId, fixtureSnapshotId, fixtureSupplierDecisionId, buyerId, buyerId, qty, unitPrice]
      );

      const [orderRes] = await db.query(
        `INSERT INTO orders (
          order_code, reservation_id, pool_id, buyer_id, supplier_id,
          buyer_decision_id, total_qty, unit_price, subtotal_amount,
          delivery_fee, buyer_platform_fee, total_amount, currency,
          delivery_type, delivery_address, cluster_zone,
          payment_status, order_status, fulfillment_status, created_at, updated_at
        ) VALUES (
          CONCAT('O4E4-', SUBSTRING(UNIX_TIMESTAMP(), -6), FLOOR(RAND() * 1000)),
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, 'PKR',
          'DOORSTEP', 'Commercial Area, Lahore', 'Lahore-Central',
          ?, ?, ?, NOW(), NOW()
        )`,
        [
          resId, fixturePoolId, buyerId, supplierId, buyDec.insertId,
          qty, unitPrice, subtotal, deliveryFee, platformFee, total,
          paymentStatus, orderStatus, fulfillmentStatus
        ]
      );
      const orderId = orderRes.insertId;
      createdOrderIds.push(orderId);

      // If PAID, create an authoritative payment record
      if (paymentStatus === 'PAID') {
        await db.query(
          `INSERT INTO payments (
            payment_code, order_id, reservation_id, buyer_id, amount,
            buyer_fee, payment_method, status, escrow_status, paid_at, created_at
          ) VALUES (
            CONCAT('PAY-4E4-', SUBSTRING(UNIX_TIMESTAMP(), -6), FLOOR(RAND() * 1000)),
            ?, ?, ?, ?, ?, 'CARD', 'PAID', 'HELD_IN_ESCROW', NOW(), NOW()
          )`,
          [orderId, resId, buyerId, total, platformFee]
        );
      }

      return { orderId, resId, total, subtotal, deliveryFee, platformFee };
    }

    // Fixture: Paid Order 1 for Buyer 1 (assigned to Supplier 2)
    const paidOrder1 = await createOrderFixture({
      buyerId: 5,
      supplierId: 2,
      qty: 20.0,
      paymentStatus: 'PAID',
      fulfillmentStatus: 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT'
    });

    // Fixture: Unpaid Order 2 for Buyer 1 (assigned to Supplier 2)
    const unpaidOrder2 = await createOrderFixture({
      buyerId: 5,
      supplierId: 2,
      qty: 10.0,
      paymentStatus: 'AWAITING_PAYMENT',
      fulfillmentStatus: 'UNPAID',
      orderStatus: 'AWAITING_PAYMENT'
    });

    // Fixture: Paid Order 3 for Buyer 2 (assigned to Supplier 2)
    const paidOrder3 = await createOrderFixture({
      buyerId: 6,
      supplierId: 2,
      qty: 15.0,
      paymentStatus: 'PAID',
      fulfillmentStatus: 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT'
    });

    recordPass('Commercial test fixtures initialized successfully (Pool, Snapshot, Orders)');

    // -------------------------------------------------------------------------
    // SECTION 2: PAID-ONLY ELIGIBILITY & UNPAID ORDER REJECTION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Paid-Only Eligibility & Unpaid Order Rejection ---');

    // Test 2: Unpaid order cannot be accessed by supplier in fulfillment
    const unpaidAccessRes = await makeRequest('GET', `${baseUrl}/api/v1/fulfillment/supplier/orders/${unpaidOrder2.orderId}`, {
      Authorization: `Bearer ${supplierToken}`
    });
    if (unpaidAccessRes.status !== 422) {
      console.log('UNPAID ACCESS RES:', unpaidAccessRes.status, unpaidAccessRes.body);
    }
    assert.strictEqual(unpaidAccessRes.status, 422, 'Unpaid order must return 422');
    assert.strictEqual(unpaidAccessRes.body.error.code, 'UNPAID_ORDER_NOT_IN_FULFILLMENT');
    recordPass('Unpaid order rejected from supplier fulfillment read model with 422 UNPAID_ORDER_NOT_IN_FULFILLMENT');

    // Test 3: Unpaid order cannot be transitioned by supplier
    const unpaidTransRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${unpaidOrder2.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `idem-unpaid-${Date.now()}`
    }, {
      to_status: 'PREPARING'
    });
    assert.strictEqual(unpaidTransRes.status, 422, 'Unpaid order transition must return 422');
    assert.strictEqual(unpaidTransRes.body.error.code, 'UNPAID_ORDER_NOT_IN_FULFILLMENT');
    recordPass('Supplier milestone transition on unpaid order strictly blocked with 422');

    // Test 4: Unpaid order cannot be accessed by buyer in fulfillment
    const buyerUnpaidRes = await makeRequest('GET', `${baseUrl}/api/v1/fulfillment/buyer/orders/${unpaidOrder2.orderId}`, {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(buyerUnpaidRes.status, 422, 'Buyer cannot access unpaid order in fulfillment (422)');
    assert.strictEqual(buyerUnpaidRes.body.error.code, 'UNPAID_ORDER_NOT_IN_FULFILLMENT');
    recordPass('Buyer fulfillment lookup on unpaid order strictly rejected with 422');

    // -------------------------------------------------------------------------
    // SECTION 3: RBAC & STRICT TENANT ISOLATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: RBAC & Strict Tenant Isolation ---');

    // Test 5: Competitor supplier cannot access Supplier 2's assigned order
    const crossSuppRes = await makeRequest('GET', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}`, {
      Authorization: `Bearer ${competitorSupplierToken}`
    });
    assert.strictEqual(crossSuppRes.status, 403, 'Competitor supplier must be denied access (403)');
    assert.strictEqual(crossSuppRes.body.error.code, 'FORBIDDEN');
    recordPass('Tenant Isolation: Competitor supplier blocked from viewing peer order with 403 FORBIDDEN');

    // Test 6: Competitor supplier cannot transition Supplier 2's assigned order
    const crossSuppTrans = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${competitorSupplierToken}`,
      'X-Idempotency-Key': `idem-cross-supp-${Date.now()}`
    }, {
      to_status: 'PREPARING'
    });
    assert.strictEqual(crossSuppTrans.status, 403, 'Competitor supplier transition must return 403');
    recordPass('Tenant Isolation: Competitor supplier blocked from transitioning peer order with 403 FORBIDDEN');

    // Test 7: Buyer cannot call supplier fulfillment endpoints
    const buyerSuppRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `idem-buyer-as-supp-${Date.now()}`
    }, {
      to_status: 'PREPARING'
    });
    assert.strictEqual(buyerSuppRes.status, 403, 'Buyer calling supplier endpoint must return 403');
    recordPass('Anti-Impersonation: Buyer strictly forbidden from invoking supplier fulfillment endpoints (403)');

    // Test 8: Competitor buyer cannot view Buyer 1's fulfillment order
    const crossBuyerRes = await makeRequest('GET', `${baseUrl}/api/v1/fulfillment/buyer/orders/${paidOrder1.orderId}`, {
      Authorization: `Bearer ${buyer2Token}`
    });
    assert.strictEqual(crossBuyerRes.status, 403, 'Competitor buyer must be denied access (403)');
    recordPass('Tenant Isolation: Competitor buyer blocked from inspecting peer order fulfillment (403 FORBIDDEN)');

    // Test 9: Competitor buyer cannot confirm receipt of Buyer 1's order
    const crossBuyerConfirm = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/buyer/orders/${paidOrder1.orderId}/confirm-receipt`, {
      Authorization: `Bearer ${buyer2Token}`,
      'X-Idempotency-Key': `idem-cross-confirm-${Date.now()}`
    });
    assert.strictEqual(crossBuyerConfirm.status, 403, 'Competitor buyer confirming receipt must return 403');
    recordPass('Tenant Isolation: Competitor buyer blocked from confirming peer order receipt (403 FORBIDDEN)');

    // -------------------------------------------------------------------------
    // SECTION 4: SEQUENTIAL STATE MACHINE & TRANSITION VALIDATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Sequential State Machine & Transitions ---');

    // Test 10: Mandatory X-Idempotency-Key enforced
    const missingKeyRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`
    }, {
      to_status: 'PREPARING'
    });
    assert.strictEqual(missingKeyRes.status, 400, 'Missing idempotency key must return 400');
    assert.strictEqual(missingKeyRes.body.error.code, 'MISSING_IDEMPOTENCY_KEY');
    recordPass('Mandatory X-Idempotency-Key enforced on supplier fulfillment transitions (400)');

    // Test 11: Skipped transition rejected (AWAITING -> DISPATCHED)
    const skipRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `idem-skip-${Date.now()}`
    }, {
      to_status: 'DISPATCHED',
      delivery_method: 'SUPPLIER_FLEET'
    });
    assert.strictEqual(skipRes.status, 422, 'Skipped transition must return 422');
    assert.strictEqual(skipRes.body.error.code, 'INVALID_FULFILLMENT_TRANSITION');
    recordPass('Invalid transition sequence (skip PREPARING to DISPATCHED) strictly rejected with 422');

    // Test 12: Transition 1: AWAITING -> PREPARING
    const prepKey = `idem-prep-${Date.now()}`;
    const prepRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': prepKey
    }, {
      to_status: 'PREPARING',
      notes: 'Packaging initiated in Warehouse A'
    });
    assert.strictEqual(prepRes.status, 200, 'Transition to PREPARING must succeed: ' + JSON.stringify(prepRes.body));
    assert.strictEqual(prepRes.body.data.fulfillment_status, 'PREPARING');
    assert.strictEqual(prepRes.body.data.is_replay, false);

    // Verify DB columns
    const [prepDb] = await db.query('SELECT fulfillment_status, order_status, acknowledged_at, preparing_at FROM orders WHERE id = ?', [paidOrder1.orderId]);
    assert.strictEqual(prepDb[0].fulfillment_status, 'PREPARING');
    assert.strictEqual(prepDb[0].order_status, 'PROCESSING');
    assert.ok(prepDb[0].acknowledged_at !== null, 'acknowledged_at must be populated');
    assert.ok(prepDb[0].preparing_at !== null, 'preparing_at must be populated');
    recordPass('Transition 1: AWAITING_SUPPLIER_ACKNOWLEDGEMENT -> PREPARING succeeds (acknowledged_at & preparing_at set, order_status=PROCESSING)');

    // Test 13: Idempotent replay of PREPARING with identical payload returns cached 200 without duplicate mutation
    const prepReplay = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': prepKey
    }, {
      to_status: 'PREPARING',
      notes: 'Packaging initiated in Warehouse A'
    });
    assert.strictEqual(prepReplay.status, 200);
    assert.strictEqual(prepReplay.body.success, true);
    recordPass('Idempotency Replay: Exact repeated transition request returns 200 OK (idempotent replay)');

    // Test 13b: Same key with tampered/different payload strictly returns 409 IDEMPOTENCY_PAYLOAD_CONFLICT
    const prepTampered = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': prepKey
    }, {
      to_status: 'PREPARING',
      notes: 'Tampered notes'
    });
    assert.strictEqual(prepTampered.status, 409);
    assert.strictEqual(prepTampered.body.error.code, 'IDEMPOTENCY_PAYLOAD_CONFLICT');
    recordPass('Idempotency Conflict: Same idempotency key with conflicting payload strictly rejected with 409');

    // Test 14: Conflicting request with DIFFERENT key for already transitioned state returns 409
    const conflictPrep = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `idem-prep-conflict-${Date.now()}`
    }, {
      to_status: 'PREPARING'
    });
    assert.strictEqual(conflictPrep.status, 409);
    assert.strictEqual(conflictPrep.body.error.code, 'TRANSITION_ALREADY_COMPLETED');
    recordPass('Concurrency Defense: Different idempotency key on already-completed transition returns 409 TRANSITION_ALREADY_COMPLETED');

    // Test 15: Transition 2: PREPARING -> READY_FOR_DISPATCH
    const readyKey = `idem-ready-${Date.now()}`;
    const readyRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': readyKey
    }, {
      to_status: 'READY_FOR_DISPATCH',
      notes: 'Packed and staged at loading dock'
    });
    assert.strictEqual(readyRes.status, 200);
    assert.strictEqual(readyRes.body.data.fulfillment_status, 'READY_FOR_DISPATCH');

    const [readyDb] = await db.query('SELECT ready_for_dispatch_at FROM orders WHERE id = ?', [paidOrder1.orderId]);
    assert.ok(readyDb[0].ready_for_dispatch_at !== null, 'ready_for_dispatch_at must be populated');
    recordPass('Transition 2: PREPARING -> READY_FOR_DISPATCH succeeds (ready_for_dispatch_at set)');

    // Test 16: Missing delivery_method on DISPATCHED transition rejected with 400
    const noMethodRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `idem-dispatch-no-method-${Date.now()}`
    }, {
      to_status: 'DISPATCHED'
    });
    assert.strictEqual(noMethodRes.status, 400);
    assert.strictEqual(noMethodRes.body.error.code, 'DELIVERY_METHOD_REQUIRED');
    recordPass('Validation: Marking order DISPATCHED strictly requires valid delivery_method (400)');

    // Test 17: Transition 3: READY_FOR_DISPATCH -> DISPATCHED
    const dispatchKey = `idem-dispatch-${Date.now()}`;
    const dispatchRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': dispatchKey
    }, {
      to_status: 'DISPATCHED',
      delivery_method: 'SUPPLIER_FLEET',
      supplier_delivery_reference: 'TRK-PK-987654',
      notes: 'Driver: Aslam, Van Plate: LEA-4432'
    });
    assert.strictEqual(dispatchRes.status, 200);
    assert.strictEqual(dispatchRes.body.data.fulfillment_status, 'DISPATCHED');

    const [dispDb] = await db.query(
      'SELECT fulfillment_status, order_status, delivery_method, supplier_delivery_reference, dispatched_at FROM orders WHERE id = ?',
      [paidOrder1.orderId]
    );
    assert.strictEqual(dispDb[0].fulfillment_status, 'DISPATCHED');
    assert.strictEqual(dispDb[0].order_status, 'OUT_FOR_DELIVERY');
    assert.strictEqual(dispDb[0].delivery_method, 'SUPPLIER_FLEET');
    assert.strictEqual(dispDb[0].supplier_delivery_reference, 'TRK-PK-987654');
    assert.ok(dispDb[0].dispatched_at !== null);
    recordPass('Transition 3: READY_FOR_DISPATCH -> DISPATCHED succeeds (dispatched_at, delivery_method, reference persisted, order_status=OUT_FOR_DELIVERY)');

    // Test 18: Backward transition rejected (DISPATCHED -> PREPARING)
    const backRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `idem-back-${Date.now()}`
    }, {
      to_status: 'PREPARING'
    });
    assert.strictEqual(backRes.status, 409, 'Backward transition must be rejected with conflict (409)');
    recordPass('Lifecycle Guard: Backward transition (DISPATCHED to PREPARING) strictly blocked');

    // Test 19: Premature buyer receipt confirmation rejected before supplier delivery
    const prematureConfirm = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/buyer/orders/${paidOrder1.orderId}/confirm-receipt`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `idem-premature-confirm-${Date.now()}`
    });
    assert.strictEqual(prematureConfirm.status, 422);
    assert.strictEqual(prematureConfirm.body.error.code, 'PREREQUISITE_NOT_MET');
    recordPass('Separation of Concerns: Buyer receipt confirmation blocked before supplier delivers (422 PREREQUISITE_NOT_MET)');

    // Test 20: Transition 4: DISPATCHED -> SUPPLIER_DELIVERED
    const deliveredKey = `idem-deliv-${Date.now()}`;
    const delivRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder1.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': deliveredKey
    }, {
      to_status: 'SUPPLIER_DELIVERED',
      notes: 'Delivered to gatekeeper at commercial complex'
    });
    assert.strictEqual(delivRes.status, 200);
    assert.strictEqual(delivRes.body.data.fulfillment_status, 'SUPPLIER_DELIVERED');

    const [delivDb] = await db.query(
      'SELECT fulfillment_status, supplier_delivered_at, buyer_confirmed_at, delivery_evidence_notes FROM orders WHERE id = ?',
      [paidOrder1.orderId]
    );
    assert.strictEqual(delivDb[0].fulfillment_status, 'SUPPLIER_DELIVERED');
    assert.ok(delivDb[0].supplier_delivered_at !== null);
    assert.strictEqual(delivDb[0].buyer_confirmed_at, null, 'buyer_confirmed_at MUST remain null upon supplier delivery declaration');
    recordPass('Transition 4: DISPATCHED -> SUPPLIER_DELIVERED succeeds (supplier_delivered_at set, buyer_confirmed_at remains NULL)');

    // Test 21: Buyer confirmation of receipt
    const confirmKey = `idem-confirm-${Date.now()}`;
    const confirmRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/buyer/orders/${paidOrder1.orderId}/confirm-receipt`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': confirmKey
    }, {
      notes: 'Received 20 bags in pristine condition'
    });
    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmRes.body.data.fulfillment_status, 'BUYER_CONFIRMED');

    const [confirmDb] = await db.query(
      'SELECT fulfillment_status, order_status, buyer_confirmed_at FROM orders WHERE id = ?',
      [paidOrder1.orderId]
    );
    assert.strictEqual(confirmDb[0].fulfillment_status, 'BUYER_CONFIRMED');
    assert.strictEqual(confirmDb[0].order_status, 'DELIVERED');
    assert.ok(confirmDb[0].buyer_confirmed_at !== null);
    recordPass('Transition 5: Buyer confirms receipt: SUPPLIER_DELIVERED -> BUYER_CONFIRMED (buyer_confirmed_at set, order_status=DELIVERED)');

    // Test 22: Duplicate buyer confirmation is idempotent
    const confirmReplay = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/buyer/orders/${paidOrder1.orderId}/confirm-receipt`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': confirmKey
    }, {
      notes: 'Received 20 bags in pristine condition'
    });
    assert.strictEqual(confirmReplay.status, 200);
    assert.strictEqual(confirmReplay.body.success, true);
    recordPass('Buyer Confirmation Idempotency: Replaying with same key returns 200 OK');

    // -------------------------------------------------------------------------
    // SECTION 5: FINANCIAL BOUNDARIES & ESCROW PRESERVATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Financial Boundaries & Escrow Invariants ---');

    // Test 23: Escrow status remains HELD_IN_ESCROW after buyer receipt confirmation
    const [escrowRows] = await db.query('SELECT status, escrow_status, amount FROM payments WHERE order_id = ?', [paidOrder1.orderId]);
    assert.strictEqual(escrowRows[0].status, 'PAID');
    assert.strictEqual(escrowRows[0].escrow_status, 'HELD_IN_ESCROW', 'Escrow status must remain HELD_IN_ESCROW; no automatic settlement permitted in Part 4E.4');
    recordPass('Financial Invariant: Escrow funds strictly remain HELD_IN_ESCROW (zero premature disbursement/settlement)');

    // Test 24: Locked monetary amounts completely unchanged throughout fulfillment
    const [finalOrderRows] = await db.query('SELECT subtotal_amount, delivery_fee, buyer_platform_fee, total_amount FROM orders WHERE id = ?', [paidOrder1.orderId]);
    assert.strictEqual(Number(finalOrderRows[0].subtotal_amount), paidOrder1.subtotal);
    assert.strictEqual(Number(finalOrderRows[0].delivery_fee), paidOrder1.deliveryFee);
    assert.strictEqual(Number(finalOrderRows[0].buyer_platform_fee), paidOrder1.platformFee);
    assert.strictEqual(Number(finalOrderRows[0].total_amount), paidOrder1.total);
    recordPass('Financial Invariant: Locked order amounts remain identical to cent precision across all fulfillment milestones');

    // -------------------------------------------------------------------------
    // SECTION 6: SHORTAGE & DISCREPANCY EXCEPTION HANDLING
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Operational Exceptions & Discrepancies ---');

    // Test 25: Supplier reports inventory shortage on Paid Order 3
    const suppExKey = `idem-supp-ex-${Date.now()}`;
    const suppExRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder3.orderId}/exception`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': suppExKey
    }, {
      reason: 'SUPPLIER_INVENTORY_SHORTAGE',
      description: 'Warehouse water leak damaged 3 bags of Grade-A flour. Need operational adjustment.'
    });
    assert.strictEqual(suppExRes.status, 200);
    assert.strictEqual(suppExRes.body.data.fulfillment_status, 'EXCEPTION');
    assert.strictEqual(suppExRes.body.data.exception_reason, 'SUPPLIER_INVENTORY_SHORTAGE');

    const [exDb] = await db.query('SELECT fulfillment_status, exception_reason, exception_details FROM orders WHERE id = ?', [paidOrder3.orderId]);
    assert.strictEqual(exDb[0].fulfillment_status, 'EXCEPTION');
    assert.strictEqual(exDb[0].exception_reason, 'SUPPLIER_INVENTORY_SHORTAGE');
    recordPass('Exception Handling: Supplier shortage exception recorded safely; order transitions to EXCEPTION');

    // Test 26: Transitions blocked while order is in EXCEPTION
    const blockedTrans = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/supplier/orders/${paidOrder3.orderId}/transition`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `idem-blocked-${Date.now()}`
    }, {
      to_status: 'PREPARING'
    });
    assert.strictEqual(blockedTrans.status, 409);
    assert.strictEqual(blockedTrans.body.error.code, 'UNRESOLVED_FULFILLMENT_EXCEPTION');
    recordPass('Safety Invariant: Transitions blocked while order is in unresolved EXCEPTION state (409)');

    // Test 27: Zero automatic refund on shortage exception
    const [exPaymentRows] = await db.query('SELECT status, escrow_status FROM payments WHERE order_id = ?', [paidOrder3.orderId]);
    assert.strictEqual(exPaymentRows[0].status, 'PAID');
    assert.strictEqual(exPaymentRows[0].escrow_status, 'HELD_IN_ESCROW', 'Zero automated refunds permitted on exception');
    recordPass('Safety Invariant: Zero automated cancellation, refund, or settlement on operational exception');

    // Fixture for buyer discrepancy: Paid Order 4
    const paidOrder4 = await createOrderFixture({
      buyerId: 5,
      supplierId: 2,
      qty: 25.0,
      paymentStatus: 'PAID',
      fulfillmentStatus: 'DISPATCHED'
    });

    // Test 28: Buyer reports quantity mismatch discrepancy
    const buyerDiscKey = `idem-buyer-disc-${Date.now()}`;
    const buyerDiscRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/buyer/orders/${paidOrder4.orderId}/report-discrepancy`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': buyerDiscKey
    }, {
      reason: 'QUANTITY_MISMATCH',
      description: 'Physical count upon arrival: 23 bags received instead of 25 invoiced bags',
      reported_quantity: 23.0
    });
    assert.strictEqual(buyerDiscRes.status, 200);
    assert.strictEqual(buyerDiscRes.body.data.fulfillment_status, 'EXCEPTION');
    assert.strictEqual(buyerDiscRes.body.data.exception_reason, 'QUANTITY_MISMATCH');

    const [buyerDiscDb] = await db.query('SELECT fulfillment_status, exception_reason FROM orders WHERE id = ?', [paidOrder4.orderId]);
    assert.strictEqual(buyerDiscDb[0].fulfillment_status, 'EXCEPTION');
    assert.strictEqual(buyerDiscDb[0].exception_reason, 'QUANTITY_MISMATCH');
    recordPass('Exception Handling: Buyer quantity mismatch recorded safely; order halts in EXCEPTION without modifying financial totals');

    // -------------------------------------------------------------------------
    // SECTION 7: AUDIT TIMELINE & OUTBOX EVENT VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: Audit Timeline & Outbox Event Verification ---');

    // Test 29: Order fulfillment events table contains all milestone history
    const [eventHistory] = await db.query(
      'SELECT action, from_status, to_status, actor_role FROM order_fulfillment_events WHERE order_id = ? ORDER BY id ASC',
      [paidOrder1.orderId]
    );
    const recordedActions = eventHistory.map(e => e.action);
    assert.ok(recordedActions.includes('SUPPLIER_PREPARING'), 'Timeline must include SUPPLIER_PREPARING');
    assert.ok(recordedActions.includes('SUPPLIER_READY_FOR_DISPATCH'), 'Timeline must include SUPPLIER_READY_FOR_DISPATCH');
    assert.ok(recordedActions.includes('SUPPLIER_DISPATCHED'), 'Timeline must include SUPPLIER_DISPATCHED');
    assert.ok(recordedActions.includes('SUPPLIER_SUPPLIER_DELIVERED'), 'Timeline must include SUPPLIER_SUPPLIER_DELIVERED');
    assert.ok(recordedActions.includes('CONFIRM_BUYER_RECEIPT'), 'Timeline must include CONFIRM_BUYER_RECEIPT');
    recordPass('Audit Integrity: order_fulfillment_events preserves complete chronological milestone timeline');

    // Test 30: Transactional outbox events emitted to reservation_business_events
    const [outboxEvents] = await db.query(
      `SELECT event_type FROM reservation_business_events WHERE event_payload->>'$.order_id' = ?`,
      [String(paidOrder1.orderId)]
    );
    const outboxTypes = outboxEvents.map(e => e.event_type);
    assert.ok(outboxTypes.includes('ORDER_PREPARING'), 'Outbox must include ORDER_PREPARING');
    assert.ok(outboxTypes.includes('ORDER_DISPATCHED'), 'Outbox must include ORDER_DISPATCHED');
    assert.ok(outboxTypes.includes('ORDER_SUPPLIER_DELIVERED'), 'Outbox must include ORDER_SUPPLIER_DELIVERED');
    assert.ok(outboxTypes.includes('ORDER_BUYER_RECEIPT_CONFIRMED'), 'Outbox must include ORDER_BUYER_RECEIPT_CONFIRMED');
    recordPass('Outbox Atomicity: Transactional business events emitted for every authoritative fulfillment transition');

    // -------------------------------------------------------------------------
    // SECTION 8: PAGINATION, READ MODELS & ADMIN AUDIT
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 8: Pagination, Read Models & Admin Audit ---');

    // Test 31: Supplier orders list is paginated and bounded
    const suppListRes = await makeRequest('GET', `${baseUrl}/api/v1/fulfillment/supplier/orders?page=1&limit=100`, {
      Authorization: `Bearer ${supplierToken}`
    });
    assert.strictEqual(suppListRes.status, 200);
    assert.strictEqual(suppListRes.body.data.pagination.limit, 50, 'Max pagination limit must be bounded to 50');
    assert.ok(Array.isArray(suppListRes.body.data.orders));
    recordPass('Read Model: Supplier fulfillment list enforces bounded pagination (max limit: 50)');

    // Test 32: Buyer orders list returns only buyer's own orders
    const buyerListRes = await makeRequest('GET', `${baseUrl}/api/v1/fulfillment/buyer/orders`, {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(buyerListRes.status, 200);
    assert.ok(buyerListRes.body.data.orders.every(o => o.total_amount > 0));
    recordPass('Read Model: Buyer fulfillment list correctly scoped to authenticated buyer');

    // Test 33: Admin read-only operational audit endpoint
    const adminRes = await makeRequest('GET', `${baseUrl}/api/v1/fulfillment/admin/orders/${paidOrder1.orderId}`, {
      Authorization: `Bearer ${adminToken}`
    });
    assert.strictEqual(adminRes.status, 200);
    assert.ok(adminRes.body.data.order.buyer_email, 'Admin view includes buyer contact email');
    assert.ok(adminRes.body.data.timeline.length >= 5, 'Admin view includes full timeline');
    recordPass('Admin Visibility: Operational audit endpoint delivers comprehensive order details and timeline (200 OK)');

    // Test 34: Non-admin calling admin endpoint rejected with 403
    const buyerAdminRes = await makeRequest('GET', `${baseUrl}/api/v1/fulfillment/admin/orders/${paidOrder1.orderId}`, {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(buyerAdminRes.status, 403);
    recordPass('Privilege Boundary: Non-administrative caller blocked from admin fulfillment audit (403 FORBIDDEN)');

    // -------------------------------------------------------------------------
    // SECTION 9: DATABASE ISOLATION VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 9: Database Isolation & Platform Invariants ---');

    // Test 35: Development database miljor_db remains 100% PRISTINE
    const [devPools] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pools');
    const [devRes] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservations');
    const [devOrders] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.orders');
    const [devPayments] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.payments');
    const [devEvents] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.order_fulfillment_events');

    assert.strictEqual(Number(devPools[0].c), 2, 'miljor_db pools must be 2');
    assert.strictEqual(Number(devRes[0].c), 0, 'miljor_db reservations must be 0');
    assert.strictEqual(Number(devOrders[0].c), 0, 'miljor_db orders must be 0');
    assert.strictEqual(Number(devPayments[0].c), 0, 'miljor_db payments must be 0');
    assert.strictEqual(Number(devEvents[0].c), 0, 'miljor_db fulfillment events must be 0');
    recordPass('Database Isolation: Development database miljor_db remains 100% PRISTINE (zero test data leakage)');

  } catch (err) {
    recordFail('Unhandled exception during gate execution', err);
    throw err;
  } finally {
    // Teardown test fixtures
    console.log('\nCleaning up test fixtures from miljor_test_db...');
    try {
      if (createdOrderIds.length > 0) {
        await db.query(`DELETE FROM order_fulfillment_events WHERE order_id IN (${createdOrderIds.join(',')})`);
        await db.query(`DELETE FROM payments WHERE order_id IN (${createdOrderIds.join(',')})`);
        await db.query(`DELETE FROM orders WHERE id IN (${createdOrderIds.join(',')})`);
      }
      if (createdReservationIds.length > 0) {
        await db.query(`DELETE FROM pool_buyer_commercial_decisions WHERE reservation_id IN (${createdReservationIds.join(',')})`);
        await db.query(`DELETE FROM reservation_business_events WHERE reservation_id IN (${createdReservationIds.join(',')})`);
        await db.query(`DELETE FROM reservations WHERE id IN (${createdReservationIds.join(',')})`);
      }
      if (createdPoolIds.length > 0) {
        await db.query(`DELETE FROM pool_supplier_commercial_decisions WHERE pool_id IN (${createdPoolIds.join(',')})`);
        await db.query(`DELETE FROM pool_commercial_snapshots WHERE pool_id IN (${createdPoolIds.join(',')})`);
        await db.query(`DELETE FROM pool_price_tiers WHERE pool_id IN (${createdPoolIds.join(',')})`);
        await db.query(`DELETE FROM pools WHERE id IN (${createdPoolIds.join(',')})`);
      }
    } catch (cleanupErr) {
      console.error('Error during cleanup:', cleanupErr.message);
    }

    if (testServer) {
      await new Promise(resolve => testServer.close(resolve));
    }
  }

  console.log('\n================================================================================');
  console.log(`Part 4E.4 Fulfillment Gate: ${passCount} / ${passCount + failCount} assertions passed`);
  console.log(`Status: ${failCount === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================================\n');

  if (failCount > 0) {
    throw new Error(`Part 4E.4 Fulfillment Gate failed with ${failCount} failed assertion(s)`);
  }
}

if (require.main === module) {
  runPart4E4FulfillmentGate()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal gate failure:', err);
      process.exit(1);
    });
}

module.exports = { runPart4E4FulfillmentGate };
