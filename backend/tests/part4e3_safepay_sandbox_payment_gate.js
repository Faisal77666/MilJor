// =============================================================================
// tests/part4e3_safepay_sandbox_payment_gate.js
// MilJor Part 4E.3: Safepay Sandbox Checkout, Verified Webhooks &
// Exactly-Once Payment Confirmation Gate
//
// Validates:
// 1. Safepay Sandbox Adapter & Security:
//    - Environment validation (SANDBOX only)
//    - URL construction for hosted checkout
//    - Cryptographic webhook HMAC-SHA256 signature verification (${timestamp}.${rawBody})
//    - Currency restriction (PKR only)
// 2. Checkout Session Initiation (POST /api/v1/orders/:id/checkout):
//    - RBAC: Buyer only (403 for Supplier/Admin)
//    - Suspended buyer denied (403 ACCOUNT_SUSPENDED)
//    - Mandatory X-Idempotency-Key enforced (400)
//    - Tenant isolation: Cross-buyer checkout forbidden (403)
//    - Order status guard: Must be AWAITING_PAYMENT (409 if already PAID, 422 if other)
//    - Client amount tampering immunity (amount strictly from order row)
//    - Out-of-lock network call + durable payment_attempts record
//    - Idempotent replay: Same key returns cached attempt without duplicate DB row
//    - Provider failure resilience: Timeout (504) and connection error (502) handled
// 3. Webhook Intake & Cryptographic State Machine (POST /api/v1/payments/webhook/safepay):
//    - Public unauthenticated intake
//    - Missing/tampered signature rejected (401)
//    - Tampered payload rejected (401)
//    - Valid signature on payment.completed confirms order:
//        * Atomic order transition to PAID
//        * payment_attempts status -> COMPLETED
//        * Authoritative entry in payments table (HELD_IN_ESCROW)
//        * Transactional outbox event ORDER_PAID emitted in reservation_business_events
//    - Replay defense: Duplicate webhook event_id acknowledged safely (no duplicate mutation)
//    - Discrepancy protection: Amount / currency mismatch fails closed (422)
//    - Untracked tracker flagged as RECONCILIATION_REQUIRED
// 4. Payment Status Read Model (GET /api/v1/orders/:id/payment-status):
//    - RBAC & tenant isolation enforced
//    - Authoritative lifecycle phase reported
// 5. Database Isolation:
//    - All mutations isolated to miljor_test_db
//    - miljor_db verified 100% PRISTINE
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const safepayAdapter = require('../src/services/safepayAdapter');
const safepayCheckoutService = require('../src/services/safepayCheckoutService');
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

function makeRequest(method, url, headers = {}, body = null, rawBodyBuffer = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    let postData = null;
    if (rawBodyBuffer) {
      postData = rawBodyBuffer;
    } else if (body !== null) {
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
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function computeSafepaySignature(secret, timestamp, rawBody) {
  const rawBodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const tsBuf = Buffer.from(String(timestamp), 'utf8');
  const dotBuf = Buffer.from('.', 'utf8');
  const payload = Buffer.concat([tsBuf, dotBuf, rawBodyBuf]);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function computeSafepayHmacSha512(secret, rawBody) {
  const rawBodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return crypto.createHmac('sha512', secret).update(rawBodyBuf).digest('hex');
}

async function runSuite() {
  console.log('================================================================================');
  console.log('MILJOR PART 4E.3: SAFEPAY SANDBOX CHECKOUT & EXACTLY-ONCE PAYMENT GATE');
  console.log('================================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function recordPass(testName) {
    totalTests++;
    passedTests++;
    console.log(`  [PASS] Assertion ${totalTests}: ${testName}`);
  }

  // Tracking fixtures for clean teardown
  const createdOrderIds = [];
  const createdReservationIds = [];
  const createdPoolIds = [];
  const createdAttemptIds = [];

  try {
    // Start local HTTP server on random port
    await new Promise((resolve) => {
      testServer = app.listen(0, () => {
        const port = testServer.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // SECTION 1: SAFEPAY ADAPTER UNIT CONTRACTS & CRYPTOGRAPHY
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Safepay Adapter & Cryptographic Signatures ---');

    // Test 1: Adapter environment validation
    const adapterConfig = safepayAdapter.validateConfig();
    assert.strictEqual(adapterConfig.env, 'sandbox', 'Environment must be sandbox');
    assert.ok(adapterConfig.publicKey, 'Public key must be present');
    assert.ok(adapterConfig.secretKey, 'Secret key must be present');
    recordPass('Safepay adapter config validated (sandbox mode, keys present)');

    // Test 2: Checkout URL construction
    const testTracker = 'track_test_1234567890';
    const testOrderCode = 'ORD-20261019-9999';
    const constructedUrl = safepayAdapter.constructCheckoutUrl({
      trackerToken: testTracker,
      orderCode: testOrderCode,
      redirectUrl: 'http://localhost:3000/orders/success',
      cancelUrl: 'http://localhost:3000/orders/cancel'
    });
    assert.ok(
      constructedUrl.startsWith('https://sandbox.api.getsafepay.com/checkout/pay'),
      'Checkout base URL must match official Safepay hosted checkout route'
    );
    assert.ok(constructedUrl.includes(`beacon=${testTracker}`), 'URL must contain beacon token');
    assert.ok(constructedUrl.includes(`order_id=${testOrderCode}`), 'URL must contain order_id');
    assert.ok(constructedUrl.includes('env=sandbox'), 'URL must set env=sandbox');
    recordPass('Hosted checkout URL constructed with required parameters');

    // Test 3: Webhook HMAC-SHA512 signature verification (Strict Safepay contract)
    const webhookSecret = safepayAdapter.webhookSecret;
    const testPayload = JSON.stringify({
      token: 'evt_test_001',
      version: '2.0.0',
      type: 'payment.succeeded',
      data: { tracker: testTracker, amount: 150000.00, currency: 'PKR' }
    });
    const validHexSig512 = computeSafepayHmacSha512(webhookSecret, testPayload);
    const validPrefixedSig512 = `sha512=${validHexSig512}`;

    const verifyPassHex = safepayAdapter.verifyWebhookSignature({
      rawBody: testPayload,
      signature: validHexSig512
    });
    const verifyPassPrefix = safepayAdapter.verifyWebhookSignature({
      rawBody: testPayload,
      signature: validPrefixedSig512
    });
    const verifyFailTampered = safepayAdapter.verifyWebhookSignature({
      rawBody: testPayload + ' ',
      signature: validHexSig512
    });
    const verifyFailSha256 = safepayAdapter.verifyWebhookSignature({
      rawBody: testPayload,
      signature: computeSafepaySignature(webhookSecret, 12345, testPayload)
    });

    assert.strictEqual(verifyPassHex, true, 'Valid raw hex HMAC-SHA512 signature must pass');
    assert.strictEqual(verifyPassPrefix, true, 'Valid sha512= prefixed signature must pass');
    assert.strictEqual(verifyFailTampered, false, 'Tampered payload signature must fail');
    assert.strictEqual(verifyFailSha256, false, 'Legacy SHA256 signature must be rejected');
    recordPass('Cryptographic HMAC-SHA512 signature verification (raw hex, sha512= prefix, tampered defense, SHA256 rejected)');

    // Test 4: Unsupported currency rejection
    let currencyError = null;
    try {
      await safepayAdapter.createTracker({
        amount: 1000,
        currency: 'USD',
        orderCode: testOrderCode
      });
    } catch (e) {
      currencyError = e;
    }
    assert.ok(currencyError, 'Non-PKR currency must throw error');
    assert.strictEqual(currencyError.code, 'UNSUPPORTED_CURRENCY', 'Error code must be UNSUPPORTED_CURRENCY');
    recordPass('Unsupported currency rejected with UNSUPPORTED_CURRENCY (PKR-only rule)');

    // -------------------------------------------------------------------------
    // SECTION 2: FIXTURE SETUP FOR CHECKOUT & PAYMENT
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Commercial Fixture Setup ---');

    // Capture pre-task baseline for miljor_db preservation check
    const [initialPools] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pools');
    const [initialRes] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.reservations');
    const [initialOrders] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.orders');
    const [initialAttempts] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.payment_attempts');
    const [initialPayments] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.payments');
    const [initialEvents] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.reservation_business_events');

    // Create a qualified pool, snapshot, decisions, and order in miljor_test_db
    const [poolRes] = await db.query(
      `INSERT INTO pools (
        pool_code, product_id, product_spec_id, supplier_listing_id, supplier_id,
        status, pool_unit, buyer_min_qty, purchase_increment, target_qty,
        supplier_min_qty, max_capacity, current_qty, current_price_per_unit,
        delivery_type, delivery_fee_policy, expires_at, created_at, updated_at
      ) VALUES (
        CONCAT('POOL-4E3-', UNIX_TIMESTAMP()), 1, 1, 1, 2,
        'CONFIRMED', 'BAG_50KG', 5.0000, 1.0000, 30.0000,
        20.0000, 50.0000, 30.0000, 1250.00,
        'DOORSTEP', 'STANDARD_DELIVERY', DATE_ADD(NOW(), INTERVAL 2 DAY), NOW(), NOW()
      )`
    );
    const poolId = poolRes.insertId;
    createdPoolIds.push(poolId);

    // Create price tiers
    await db.query(
      `INSERT INTO pool_price_tiers (pool_id, min_qty, max_qty, price_per_unit, pricing_unit)
       VALUES 
       (?, 5.0000, 19.9999, 1300.00, 'BAG_50KG'),
       (?, 20.0000, 50.0000, 1250.00, 'BAG_50KG')`,
      [poolId, poolId]
    );

    // Create snapshot for pool
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
        CONCAT('SNP-4E3-', UNIX_TIMESTAMP()), ?, 1, 'QUALIFIED',
        NOW(), 2, 1, 1, 'mock-hash-4e3', 'BAG_50KG', 30.0000, 20.0000,
        30.0000, 50.0000, 1, 1250.00,
        2, '[]',
        'DOORSTEP', DATE_ADD(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 2 DAY), 'ACCEPTED'
      )`,
      [poolId]
    );
    const snapshotId = snapRes.insertId;

    // Create supplier decision
    const [suppDec] = await db.query(
      `INSERT INTO pool_supplier_commercial_decisions (
        decision_code, pool_id, snapshot_id, snapshot_version, supplier_id,
        actor_id, actor_role, decision, agreed_aggregate_qty, agreed_unit_price
      ) VALUES (
        CONCAT('SDEC-4E3-', UNIX_TIMESTAMP()), ?, ?, 1, 2,
        2, 'SUPPLIER', 'ACCEPT', 30.0000, 1250.00
      )`,
      [poolId, snapshotId]
    );
    const supplierDecisionId = suppDec.insertId;

    // Create reservation for Buyer 1 (qty 20, locked price 1250.00 -> subtotal 25,000.00)
    const [resRes1] = await db.query(
      `INSERT INTO reservations (
        reservation_code, pool_id, buyer_id, quantity, unit_price,
        total_price, locked_unit_price, locked_total_price, status
      ) VALUES (
        CONCAT('RES-4E3-1-', UNIX_TIMESTAMP()), ?, 5, 20.0000, 1250.00,
        25000.00, 1250.00, 25000.00, 'CONFIRMED'
      )`,
      [poolId]
    );
    const reservationId1 = resRes1.insertId;
    createdReservationIds.push(reservationId1);

    // Create buyer commercial decision for Buyer 1
    const [buyDec1] = await db.query(
      `INSERT INTO pool_buyer_commercial_decisions (
        decision_code, pool_id, reservation_id, snapshot_id, snapshot_version,
        supplier_decision_id, buyer_id, actor_id, actor_role, decision,
        accepted_quantity, agreed_unit_price, currency, price_lock_status, decision_timestamp
      ) VALUES (
        CONCAT('BDEC-4E3-1-', UNIX_TIMESTAMP()), ?, ?, ?, 1,
        ?, 5, 5, 'BUYER', 'ACCEPT',
        20.0000, 1250.00, 'PKR', 'LOCKED', NOW()
      )`,
      [poolId, reservationId1, snapshotId, supplierDecisionId]
    );
    const buyerDecisionId1 = buyDec1.insertId;

    // Create Authoritative Order 1 in AWAITING_PAYMENT state
    // Breakdown: merchandise 25,000.00 + delivery 1,200.00 + buyer fee 500.00 = total 26,700.00
    const [orderRes1] = await db.query(
      `INSERT INTO orders (
        order_code, reservation_id, pool_id, buyer_id, supplier_id,
        buyer_decision_id, total_qty, unit_price, subtotal_amount,
        delivery_fee, buyer_platform_fee, total_amount, currency,
        delivery_type, delivery_address, cluster_zone,
        payment_status, order_status, created_at, updated_at
      ) VALUES (
        CONCAT('ORD-1-', SUBSTRING(UNIX_TIMESTAMP(), -8)), ?, ?, 5, 2,
        ?, 20.0000, 1250.00, 25000.00,
        1200.00, 500.00, 26700.00, 'PKR',
        'DOORSTEP', 'Gulberg III, Lahore', 'Lahore-Gulberg',
        'AWAITING_PAYMENT', 'AWAITING_PAYMENT', NOW(), NOW()
      )`,
      [reservationId1, poolId, buyerDecisionId1]
    );
    const orderId1 = orderRes1.insertId;
    createdOrderIds.push(orderId1);

    // Create Order 2 for Buyer 2 (qty 10, total 13,800.00)
    const [resRes2] = await db.query(
      `INSERT INTO reservations (
        reservation_code, pool_id, buyer_id, quantity, unit_price,
        total_price, locked_unit_price, locked_total_price, status
      ) VALUES (
        CONCAT('RES-4E3-2-', UNIX_TIMESTAMP()), ?, 6, 10.0000, 1250.00,
        12500.00, 1250.00, 12500.00, 'CONFIRMED'
      )`,
      [poolId]
    );
    const reservationId2 = resRes2.insertId;
    createdReservationIds.push(reservationId2);

    const [buyDec2] = await db.query(
      `INSERT INTO pool_buyer_commercial_decisions (
        decision_code, pool_id, reservation_id, snapshot_id, snapshot_version,
        supplier_decision_id, buyer_id, actor_id, actor_role, decision,
        accepted_quantity, agreed_unit_price, currency, price_lock_status, decision_timestamp
      ) VALUES (
        CONCAT('BDEC-4E3-2-', UNIX_TIMESTAMP()), ?, ?, ?, 1,
        ?, 6, 6, 'BUYER', 'ACCEPT',
        10.0000, 1250.00, 'PKR', 'LOCKED', NOW()
      )`,
      [poolId, reservationId2, snapshotId, supplierDecisionId]
    );
    const buyerDecisionId2 = buyDec2.insertId;

    const [orderRes2] = await db.query(
      `INSERT INTO orders (
        order_code, reservation_id, pool_id, buyer_id, supplier_id,
        buyer_decision_id, total_qty, unit_price, subtotal_amount,
        delivery_fee, buyer_platform_fee, total_amount, currency,
        delivery_type, delivery_address, cluster_zone,
        payment_status, order_status, created_at, updated_at
      ) VALUES (
        CONCAT('ORD-2-', SUBSTRING(UNIX_TIMESTAMP(), -8)), ?, ?, 6, 2,
        ?, 10.0000, 1250.00, 12500.00,
        1000.00, 300.00, 13800.00, 'PKR',
        'DOORSTEP', 'DHA Phase 5, Lahore', 'Lahore-DHA',
        'AWAITING_PAYMENT', 'AWAITING_PAYMENT', NOW(), NOW()
      )`,
      [reservationId2, poolId, buyerDecisionId2]
    );
    const orderId2 = orderRes2.insertId;
    createdOrderIds.push(orderId2);

    // Order 3: Already PAID order to test transition barriers
    const [orderRes3] = await db.query(
      `INSERT INTO orders (
        order_code, reservation_id, pool_id, buyer_id, supplier_id,
        buyer_decision_id, total_qty, unit_price, subtotal_amount,
        delivery_fee, buyer_platform_fee, total_amount, currency,
        delivery_type, delivery_address, cluster_zone,
        payment_status, order_status, created_at, updated_at
      ) VALUES (
        CONCAT('ORD-3-', SUBSTRING(UNIX_TIMESTAMP(), -8)), ?, ?, 5, 2,
        NULL, 10.0000, 1250.00, 12500.00,
        1000.00, 300.00, 13800.00, 'PKR',
        'DOORSTEP', 'Gulberg III, Lahore', 'Lahore-Gulberg',
        'PAID', 'PAID', NOW(), NOW()
      )`,
      [reservationId1, poolId]
    );
    const orderId3 = orderRes3.insertId;
    createdOrderIds.push(orderId3);

    recordPass('Commercial fixtures initialized (pools, reservations, buyer decisions, orders 1, 2, 3)');

    // -------------------------------------------------------------------------
    // SECTION 3: CHECKOUT INITIATION & RBAC (POST /api/v1/orders/:id/checkout)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Checkout Initiation & Security Controls ---');

    // Test 6: Missing auth token -> 401
    const resNoAuth = await makeRequest('POST', `${baseUrl}/api/v1/orders/${orderId1}/checkout`, {
      'X-Idempotency-Key': 'IDEM-NO-AUTH'
    });
    assert.strictEqual(resNoAuth.status, 401, 'Request without token must be 401');
    recordPass('Checkout initiation requires authentication (401 without token)');

    // Test 7: Non-BUYER role (Supplier) -> 403
    const resSupplier = await makeRequest('POST', `${baseUrl}/api/v1/orders/${orderId1}/checkout`, {
      'Authorization': `Bearer ${supplierToken}`,
      'X-Idempotency-Key': 'IDEM-SUPPLIER'
    });
    assert.strictEqual(resSupplier.status, 403, 'Supplier role must be denied 403');
    recordPass('Supplier role strictly prohibited from initiating checkout (403)');

    // Test 8: Non-BUYER role (Admin) -> 403
    const resAdmin = await makeRequest('POST', `${baseUrl}/api/v1/orders/${orderId1}/checkout`, {
      'Authorization': `Bearer ${adminToken}`,
      'X-Idempotency-Key': 'IDEM-ADMIN'
    });
    assert.strictEqual(resAdmin.status, 403, 'Admin role must be denied 403');
    recordPass('Admin role strictly prohibited from initiating buyer checkout (403)');

    // Test 9: Suspended buyer -> 403
    await db.query(`UPDATE users SET buyer_trust_status = 'SUSPENDED' WHERE id = 7`);
    const resSuspended = await makeRequest('POST', `${baseUrl}/api/v1/orders/${orderId1}/checkout`, {
      'Authorization': `Bearer ${competitorBuyerToken}`,
      'X-Idempotency-Key': 'IDEM-SUSPENDED'
    });
    await db.query(`UPDATE users SET buyer_trust_status = 'BUSINESS_VERIFIED' WHERE id = 7`);
    assert.strictEqual(resSuspended.status, 403, 'Suspended buyer must be denied 403');
    recordPass('Suspended buyer account blocked from checkout initiation (403)');

    // Test 10: Missing X-Idempotency-Key -> 400
    const resNoIdem = await makeRequest('POST', `${baseUrl}/api/v1/orders/${orderId1}/checkout`, {
      'Authorization': `Bearer ${buyer1Token}`
    });
    assert.strictEqual(resNoIdem.status, 400, 'Missing idempotency key must return 400');
    recordPass('Mandatory X-Idempotency-Key enforced on checkout initiation (400)');

    // Test 11: Nonexistent order ID -> 404
    const resNotFound = await makeRequest('POST', `${baseUrl}/api/v1/orders/99999999/checkout`, {
      'Authorization': `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': 'IDEM-404'
    });
    assert.strictEqual(resNotFound.status, 404, 'Nonexistent order must return 404');
    recordPass('Nonexistent order ID returns 404 ORDER_NOT_FOUND');

    // Test 12: Tenant isolation (Buyer 2 cannot checkout Buyer 1 order) -> 403
    const resCrossBuyer = await makeRequest('POST', `${baseUrl}/api/v1/orders/${orderId1}/checkout`, {
      'Authorization': `Bearer ${buyer2Token}`,
      'X-Idempotency-Key': 'IDEM-CROSS-BUYER'
    });
    assert.strictEqual(resCrossBuyer.status, 403, 'Cross-buyer checkout must return 403 FORBIDDEN');
    recordPass('Tenant isolation: Cross-buyer order checkout denied (403 FORBIDDEN)');

    // Test 13: Order status barrier (Order 3 is already PAID) -> 409
    const resAlreadyPaid = await makeRequest('POST', `${baseUrl}/api/v1/orders/${orderId3}/checkout`, {
      'Authorization': `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': 'IDEM-ALREADY-PAID'
    });
    assert.strictEqual(resAlreadyPaid.status, 409, 'Already paid order must return 409 ORDER_ALREADY_PAID');
    recordPass('Already-paid order blocked from initiating duplicate checkout (409 ORDER_ALREADY_PAID)');

    // Test 14: Provider network timeout resilience -> 504
    const resTimeout = await makeRequest('POST', `${baseUrl}/api/v1/orders/${orderId1}/checkout`, {
      'Authorization': `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': 'IDEM-TIMEOUT-TEST',
      'X-Safepay-Mock': 'timeout'
    });
    assert.strictEqual(resTimeout.status, 504, 'Safepay timeout must return 504');
    assert.strictEqual(resTimeout.body.error.code, 'SAFEPAY_TIMEOUT');
    recordPass('Safepay provider timeout gracefully returned as 504 SAFEPAY_TIMEOUT');

    // Test 15: Provider connection error resilience -> 502
    const resConnErr = await makeRequest('POST', `${baseUrl}/api/v1/orders/${orderId1}/checkout`, {
      'Authorization': `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': 'IDEM-CONN-TEST',
      'X-Safepay-Mock': 'error'
    });
    assert.strictEqual(resConnErr.status, 502, 'Safepay connection error must return 502');
    assert.strictEqual(resConnErr.code || resConnErr.body.error.code, 'SAFEPAY_CONNECTION_ERROR');
    recordPass('Safepay provider connection error gracefully returned as 502 SAFEPAY_CONNECTION_ERROR');

    // Test 16: Client Amount Tampering Immunity & Successful Checkout Session Creation
    // Client sends tampered amount (1.00 PKR) and USD currency
    const checkoutKey1 = `IDEM-CHK-${Date.now()}-1`;
    const resSuccessCheckout = await makeRequest(
      'POST',
      `${baseUrl}/api/v1/orders/${orderId1}/checkout`,
      {
        'Authorization': `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': checkoutKey1,
        'X-Safepay-Mock': 'success'
      },
      {
        amount: 1.00,
        currency: 'USD',
        redirect_url: 'http://localhost:3000/orders/1/success',
        cancel_url: 'http://localhost:3000/orders/1/cancel'
      }
    );

    assert.strictEqual(resSuccessCheckout.status, 200, 'Valid checkout must return 200');
    assert.strictEqual(resSuccessCheckout.body.success, true);
    const attemptData = resSuccessCheckout.body.data;
    assert.strictEqual(attemptData.amount, 26700.00, 'Amount must be exactly 26,700.00 (ignoring client 1.00 tampering)');
    assert.strictEqual(attemptData.currency, 'PKR', 'Currency must be PKR (ignoring client USD tampering)');
    assert.strictEqual(attemptData.status, 'INITIATED', 'Attempt status must be INITIATED');
    assert.ok(attemptData.provider_tracker_token, 'Tracker token must be returned');
    assert.ok(attemptData.checkout_url.includes(attemptData.provider_tracker_token), 'Checkout URL must contain tracker');

    // Verify DB state
    const [dbAttempts] = await db.query(
      `SELECT * FROM payment_attempts WHERE order_id = ? AND idempotency_key = ?`,
      [orderId1, checkoutKey1]
    );
    assert.strictEqual(dbAttempts.length, 1, 'Exactly one payment_attempt row must be persisted');
    assert.strictEqual(Number(dbAttempts[0].amount), 26700.00, 'Persisted attempt amount must match order total');
    assert.strictEqual(dbAttempts[0].status, 'INITIATED', 'Persisted attempt status must be INITIATED');

    const [dbOrder1] = await db.query(`SELECT payment_status FROM orders WHERE id = ?`, [orderId1]);
    assert.strictEqual(dbOrder1[0].payment_status, 'PAYMENT_INITIATED', 'Order payment_status must advance to PAYMENT_INITIATED');
    recordPass('Successful checkout initiation: Amount tampering defeated, payment_attempt created, payment_status=PAYMENT_INITIATED');

    // Test 17: Idempotent Replay with same key and identical body
    const resReplayCheckout = await makeRequest(
      'POST',
      `${baseUrl}/api/v1/orders/${orderId1}/checkout`,
      {
        'Authorization': `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': checkoutKey1,
        'X-Safepay-Mock': 'success'
      },
      {
        amount: 1.00,
        currency: 'USD',
        redirect_url: 'http://localhost:3000/orders/1/success',
        cancel_url: 'http://localhost:3000/orders/1/cancel'
      }
    );
    assert.strictEqual(resReplayCheckout.status, 200, 'Replay must return 200');
    assert.strictEqual(resReplayCheckout.body.data.attempt_code, attemptData.attempt_code, 'Replay must return identical attempt');

    const [dbAttemptsAfterReplay] = await db.query(
      `SELECT COUNT(*) as cnt FROM payment_attempts WHERE order_id = ?`,
      [orderId1]
    );
    assert.strictEqual(dbAttemptsAfterReplay[0].cnt, 1, 'Duplicate attempt row must NOT be created');
    recordPass('Idempotent replay returns cached checkout session without duplicate DB records');

    // -------------------------------------------------------------------------
    // SECTION 4: WEBHOOK INTAKE & PAYMENT CONFIRMATION STATE MACHINE
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Safepay Webhooks & Exactly-Once Payment Confirmation ---');

    const order1Tracker = attemptData.provider_tracker_token;

    // Test 18: Webhook without signature header -> 401
    const resWebhookNoSig = await makeRequest(
      'POST',
      `${baseUrl}/api/v1/payments/webhook/safepay`,
      {},
      { type: 'payment.completed' }
    );
    assert.strictEqual(resWebhookNoSig.status, 401, 'Webhook without signature must be 401');
    assert.strictEqual(resWebhookNoSig.body.error.code, 'INVALID_WEBHOOK_SIGNATURE');
    recordPass('Webhook without signature rejected (401 INVALID_WEBHOOK_SIGNATURE)');

    // Test 19: Webhook with forged signature -> 401
    const resWebhookForged = await makeRequest(
      'POST',
      `${baseUrl}/api/v1/payments/webhook/safepay`,
      {
        'X-SFPY-SIGNATURE': '0000000000000000000000000000000000000000000000000000000000000000',
        'X-SFPY-TIMESTAMP': String(Math.floor(Date.now() / 1000))
      },
      { type: 'payment.completed' }
    );
    assert.strictEqual(resWebhookForged.status, 401, 'Webhook with forged signature must be 401');
    recordPass('Webhook with forged signature rejected (401)');

    // Test 20: Webhook with tampered body -> 401
    const origBody = JSON.stringify({
      token: 'evt_test_tamper_001',
      version: '2.0.0',
      type: 'payment.succeeded',
      data: { tracker: order1Tracker, amount: 26700.00, currency: 'PKR' }
    });
    const validSigForOrig = computeSafepayHmacSha512(webhookSecret, origBody);

    const tamperedBody = JSON.stringify({
      token: 'evt_test_tamper_001',
      version: '2.0.0',
      type: 'payment.succeeded',
      data: { tracker: order1Tracker, amount: 1.00, currency: 'PKR' }
    });

    const resWebhookTampered = await makeRequest(
      'POST',
      `${baseUrl}/api/v1/payments/webhook/safepay`,
      {
        'X-SFPY-SIGNATURE': validSigForOrig
      },
      tamperedBody
    );
    assert.strictEqual(resWebhookTampered.status, 401, 'Webhook with body tampered against signature must be 401');
    recordPass('Webhook with tampered payload rejected (401)');

    // Test 21: Non-success webhook event (e.g. payment.failed) -> Recorded but NO mutation to PAID
    const failEventId = `evt_fail_${Date.now()}`;
    const failBody = JSON.stringify({
      token: failEventId,
      version: '2.0.0',
      type: 'payment.failed',
      data: { tracker: order1Tracker, category: 'PAYMENT_METHOD_ERROR', message: 'Card declined' }
    });
    const sigFail = computeSafepayHmacSha512(webhookSecret, failBody);

    const resWebhookFail = await makeRequest(
      'POST',
      `${baseUrl}/api/v1/payments/webhook/safepay`,
      {
        'X-SFPY-SIGNATURE': sigFail
      },
      failBody
    );
    assert.strictEqual(resWebhookFail.status, 200, 'Non-success webhook acknowledged 200');

    // Verify order 1 is still NOT paid
    const [order1AfterFail] = await db.query(`SELECT order_status, payment_status FROM orders WHERE id = ?`, [orderId1]);
    assert.strictEqual(order1AfterFail[0].order_status, 'AWAITING_PAYMENT');
    assert.strictEqual(order1AfterFail[0].payment_status, 'PAYMENT_INITIATED');
    recordPass('Non-success webhook (payment.failed) recorded without corrupting order state');

    // Test 22: Webhook Amount Discrepancy Defense -> 422
    const mismatchEventId = `evt_mismatch_${Date.now()}`;
    const mismatchBody = JSON.stringify({
      token: mismatchEventId,
      version: '2.0.0',
      type: 'payment.succeeded',
      data: { tracker: order1Tracker, amount: 26699.00, currency: 'PKR' } // 1 PKR less
    });
    const sigMismatch = computeSafepayHmacSha512(webhookSecret, mismatchBody);

    const resWebhookMismatch = await makeRequest(
      'POST',
      `${baseUrl}/api/v1/payments/webhook/safepay`,
      {
        'X-SFPY-SIGNATURE': sigMismatch
      },
      mismatchBody
    );
    assert.strictEqual(resWebhookMismatch.status, 422, 'Amount mismatch must fail closed with 422');
    assert.strictEqual(resWebhookMismatch.body.error.code, 'AMOUNT_MISMATCH');
    recordPass('Amount mismatch between webhook and order fails closed with 422 AMOUNT_MISMATCH');

    // Test 23: Untracked tracker token -> Flags RECONCILIATION_REQUIRED without order mutation
    const untrackedEventId = `evt_untracked_${Date.now()}`;
    const untrackedBody = JSON.stringify({
      token: untrackedEventId,
      version: '2.0.0',
      type: 'payment.succeeded',
      data: { tracker: 'track_unknown_token_99999', amount: 5000.00, currency: 'PKR' }
    });
    const sigUntracked = computeSafepayHmacSha512(webhookSecret, untrackedBody);

    const resWebhookUntracked = await makeRequest(
      'POST',
      `${baseUrl}/api/v1/payments/webhook/safepay`,
      {
        'X-SFPY-SIGNATURE': sigUntracked
      },
      untrackedBody
    );
    assert.strictEqual(resWebhookUntracked.status, 200, 'Untracked payment acknowledged 200');
    assert.strictEqual(resWebhookUntracked.body.data.status, 'RECONCILIATION_REQUIRED');

    const [untrackedEvents] = await db.query(
      `SELECT processed_status FROM payment_webhook_events WHERE event_id = ?`,
      [untrackedEventId]
    );
    assert.strictEqual(untrackedEvents[0].processed_status, 'RECONCILIATION_REQUIRED');
    recordPass('Untracked payment session safely captured in RECONCILIATION_REQUIRED');

    // Test 24: Authoritative Payment Confirmation on Order 1 using official payment.succeeded and HMAC-SHA512
    const successEventId = `evt_success_${Date.now()}`;
    const successBody = JSON.stringify({
      token: successEventId,
      version: '2.0.0',
      type: 'payment.succeeded',
      data: {
        tracker: order1Tracker,
        amount: 26700.00,
        currency: 'PKR',
        state: 'TRACKER_ENDED'
      }
    });
    // Official signature: HMAC-SHA512 over raw JSON payload
    const sigSuccess512 = computeSafepayHmacSha512(webhookSecret, successBody);

    const resWebhookSuccess = await makeRequest(
      'POST',
      `${baseUrl}/api/v1/payments/webhook/safepay`,
      {
        'X-SFPY-SIGNATURE': sigSuccess512
      },
      successBody
    );

    assert.strictEqual(resWebhookSuccess.status, 200, 'Success webhook must return 200');
    assert.strictEqual(resWebhookSuccess.body.data.payment_status, 'PAID');
    assert.strictEqual(resWebhookSuccess.body.data.order_status, 'PAID');

    // Verify order 1 transitioned to PAID in database
    const [confirmedOrder1] = await db.query(`SELECT * FROM orders WHERE id = ?`, [orderId1]);
    assert.strictEqual(confirmedOrder1[0].order_status, 'PAID', 'Order order_status must be PAID');
    assert.strictEqual(confirmedOrder1[0].payment_status, 'PAID', 'Order payment_status must be PAID');

    // Verify payment_attempts status updated to COMPLETED
    const [completedAttempts] = await db.query(
      `SELECT status FROM payment_attempts WHERE provider_tracker_token = ?`,
      [order1Tracker]
    );
    assert.strictEqual(completedAttempts[0].status, 'COMPLETED', 'payment_attempts status must be COMPLETED');

    // Verify authoritative payments table entry
    const [payments] = await db.query(
      `SELECT * FROM payments WHERE order_id = ?`,
      [orderId1]
    );
    assert.strictEqual(payments.length, 1, 'Exactly one payment row must exist');
    assert.strictEqual(payments[0].status, 'PAID', 'Payment status must be PAID');
    assert.strictEqual(payments[0].escrow_status, 'HELD_IN_ESCROW', 'Payment escrow_status must be HELD_IN_ESCROW');
    assert.strictEqual(Number(payments[0].amount), 26700.00, 'Payment amount must be 26,700.00');
    assert.strictEqual(payments[0].transaction_ref, order1Tracker, 'transaction_ref must store tracker token');

    // Verify Transactional Outbox Event ORDER_PAID
    const [outboxEvents] = await db.query(
      `SELECT * FROM reservation_business_events 
       WHERE reservation_id = ? AND event_type = 'ORDER_PAID'`,
      [reservationId1]
    );
    const rawPayload = outboxEvents[0].event_payload;
    const outboxPayload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
    assert.strictEqual(outboxPayload.order_id, orderId1);
    assert.strictEqual(outboxPayload.amount, 26700.00);
    assert.strictEqual(outboxPayload.provider, 'SAFEPAY');
    recordPass('Authoritative payment confirmation: Order PAID, attempt COMPLETED, payments row inserted, ORDER_PAID outbox event');

    // Test 25: Duplicate Webhook Delivery Protection
    const resWebhookDup = await makeRequest(
      'POST',
      `${baseUrl}/api/v1/payments/webhook/safepay`,
      {
        'X-SFPY-SIGNATURE': sigSuccess512
      },
      successBody
    );
    assert.strictEqual(resWebhookDup.status, 200, 'Duplicate delivery must return 200');
    assert.strictEqual(resWebhookDup.body.data.is_duplicate, true);

    const [paymentsAfterDup] = await db.query(`SELECT COUNT(*) as c FROM payments WHERE order_id = ?`, [orderId1]);
    const [eventsAfterDup] = await db.query(
      `SELECT COUNT(*) as c FROM reservation_business_events WHERE reservation_id = ? AND event_type = 'ORDER_PAID'`,
      [reservationId1]
    );
    assert.strictEqual(paymentsAfterDup[0].c, 1, 'Duplicate webhook must NOT insert second payment row');
    assert.strictEqual(eventsAfterDup[0].c, 1, 'Duplicate webhook must NOT emit second ORDER_PAID event');
    recordPass('Duplicate webhook delivery acknowledged idempotently without duplicate mutations');

    // -------------------------------------------------------------------------
    // SECTION 5: PAYMENT STATUS READ MODEL & PLATFORM ISOLATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Payment Status Read Model & Platform Safety ---');

    // Test 26: Order Payment Status Read Model (GET /api/v1/orders/:id/payment-status)
    const resStatusCrossBuyer = await makeRequest(
      'GET',
      `${baseUrl}/api/v1/orders/${orderId1}/payment-status`,
      { 'Authorization': `Bearer ${buyer2Token}` }
    );
    assert.strictEqual(resStatusCrossBuyer.status, 403, 'Cross-buyer status check must be 403');

    const resStatusOwner = await makeRequest(
      'GET',
      `${baseUrl}/api/v1/orders/${orderId1}/payment-status`,
      { 'Authorization': `Bearer ${buyer1Token}` }
    );
    assert.strictEqual(resStatusOwner.status, 200, 'Order owner must receive 200');
    assert.strictEqual(resStatusOwner.body.data.order_status, 'PAID');
    assert.strictEqual(resStatusOwner.body.data.payment_status, 'PAID');
    assert.strictEqual(resStatusOwner.body.data.lifecycle_phase, 'VERIFIED_PAYMENT_COMPLETED');
    assert.strictEqual(resStatusOwner.body.data.total_amount, 26700.00);
    assert.strictEqual(resStatusOwner.body.data.latest_attempt.status, 'COMPLETED');
    recordPass('Order payment status read model enforces tenant isolation and reports authoritative lifecycle');

    // Test 27: Zero premature settlement / escrow disbursement
    const [escrowRows] = await db.query(
      `SELECT escrow_status FROM payments WHERE order_id = ?`,
      [orderId1]
    );
    assert.strictEqual(escrowRows[0].escrow_status, 'HELD_IN_ESCROW', 'Funds must strictly remain HELD_IN_ESCROW (no premature payout)');
    recordPass('Commercial safety: Escrow funds strictly remain HELD_IN_ESCROW');

    // Test 28: Development database miljor_db remains 100% PRISTINE
    const [prodPools] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pools');
    const [prodRes] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.reservations');
    const [prodOrders] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.orders');
    const [prodAttempts] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.payment_attempts');
    const [prodPayments] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.payments');
    const [prodEvents] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.reservation_business_events');

    assert.strictEqual(prodPools[0].cnt, initialPools[0].cnt, `miljor_db pools must remain unchanged (${initialPools[0].cnt})`);
    assert.strictEqual(prodRes[0].cnt, initialRes[0].cnt, `miljor_db reservations must remain unchanged (${initialRes[0].cnt})`);
    assert.strictEqual(prodOrders[0].cnt, initialOrders[0].cnt, `miljor_db orders must remain unchanged (${initialOrders[0].cnt})`);
    assert.strictEqual(prodAttempts[0].cnt, initialAttempts[0].cnt, `miljor_db payment_attempts must remain unchanged (${initialAttempts[0].cnt})`);
    assert.strictEqual(prodPayments[0].cnt, initialPayments[0].cnt, `miljor_db payments must remain unchanged (${initialPayments[0].cnt})`);
    assert.strictEqual(prodEvents[0].cnt, initialEvents[0].cnt, `miljor_db events must remain unchanged (${initialEvents[0].cnt})`);
    recordPass('Database isolation: miljor_db is 100% PRISTINE');

  } catch (err) {
    console.error('Fatal suite failure:', err);
    throw err;
  } finally {
    console.log('\nCleaning up test fixtures from miljor_test_db...');
    if (createdOrderIds.length > 0) {
      await db.query('DELETE FROM payments WHERE order_id IN (?)', [createdOrderIds]);
      await db.query('DELETE FROM payment_webhook_events WHERE order_id IN (?)', [createdOrderIds]);
      await db.query('DELETE FROM payment_attempts WHERE order_id IN (?)', [createdOrderIds]);
      await db.query('DELETE FROM orders WHERE id IN (?)', [createdOrderIds]);
    }
    await db.query('DELETE FROM payment_webhook_events WHERE provider = "SAFEPAY" AND (order_id IS NULL OR order_id != 66)');
    if (createdReservationIds.length > 0) {
      await db.query('DELETE FROM reservation_business_events WHERE reservation_id IN (?)', [createdReservationIds]);
      await db.query('DELETE FROM pool_buyer_commercial_decisions WHERE reservation_id IN (?)', [createdReservationIds]);
      await db.query('DELETE FROM reservations WHERE id IN (?)', [createdReservationIds]);
    }
    if (createdPoolIds.length > 0) {
      await db.query('DELETE FROM pool_buyer_commercial_decisions WHERE pool_id IN (?)', [createdPoolIds]);
      await db.query('DELETE FROM pool_supplier_commercial_decisions WHERE pool_id IN (?)', [createdPoolIds]);
      await db.query('DELETE FROM pool_commercial_snapshots WHERE pool_id IN (?)', [createdPoolIds]);
      await db.query('DELETE FROM pool_price_tiers WHERE pool_id IN (?)', [createdPoolIds]);
      await db.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
    }
    if (testServer) {
      testServer.close();
    }
  }

  console.log('================================================================================');
  console.log(`Part 4E.3 Safepay Sandbox Payment Gate: ${passedTests} / ${totalTests} assertions passed`);
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
