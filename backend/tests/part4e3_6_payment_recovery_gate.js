// =============================================================================
// tests/part4e3_6_payment_recovery_gate.js
// MilJor Part 4E.3.6: Captured Sandbox Payment Recovery & Reconciliation Gate
//
// Validates:
// 1. Safepay Adapter fetchTracker capability:
//    - Validates tracker token presence (400 for empty token)
//    - Real provider fetch of Order 66 tracker returns authentic state TRACKER_ENDED
// 2. Reconciliation Contract & Security Validations:
//    - Non-existent order returns 404 ORDER_NOT_FOUND
//    - Tenant isolation: Cross-buyer reconciliation denied (403 FORBIDDEN)
//    - Missing attempt rejected (422 NO_ACTIVE_PAYMENT_ATTEMPT)
//    - Uncaptured provider state (TRACKER_STARTED) returns reconciled: false without mutation
//    - Currency mismatch fails closed (422 CURRENCY_MISMATCH)
//    - Amount mismatch fails closed (422 AMOUNT_MISMATCH)
//    - Forged transaction signature rejected (422 INVALID_TRANSACTION_SIGNATURE)
// 3. Authoritative Order 66 Captured Payment State:
//    - Order 66 is authoritatively PAID in miljor_test_db
//    - Payment Attempt 14 is authoritatively COMPLETED
//    - Exact payment record in payments table (HELD_IN_ESCROW, 24330.00 PKR)
//    - Webhook event persisted in payment_webhook_events (PROCESSED)
//    - Outbox event ORDER_PAID emitted in reservation_business_events
//    - Idempotent replay acknowledged without duplicate payment rows
// 4. Read Model Integrity:
//    - GET /api/v1/orders/66/payment-status reports VERIFIED_PAYMENT_COMPLETED
// 5. Database Isolation:
//    - miljor_db is 100% PRISTINE (0 orders, 0 payments, 0 attempts)
// =============================================================================

process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
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
const competitorBuyerToken = generateToken(7, 'BUYER', 'VERIFIED');

async function runSuite() {
  console.log('================================================================================');
  console.log('MILJOR PART 4E.3.6: CAPTURED SANDBOX PAYMENT RECOVERY & RECONCILIATION GATE');
  console.log('================================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function recordPass(desc) {
    totalTests++;
    passedTests++;
    console.log(`  [PASS] Assertion ${totalTests}: ${desc}`);
  }

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: Safepay Adapter fetchTracker Validation
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Safepay Adapter fetchTracker Contract ---');

    // Test 1: Empty tracker token rejected
    let emptyTokenErr = null;
    try {
      await safepayAdapter.fetchTracker('');
    } catch (e) {
      emptyTokenErr = e;
    }
    assert.ok(emptyTokenErr, 'Empty tracker token must throw');
    assert.strictEqual(emptyTokenErr.code, 'INVALID_TRACKER_TOKEN');
    recordPass('Empty tracker token rejected with INVALID_TRACKER_TOKEN (400)');

    // Test 2: Authenticated real fetch of Order 66 tracker from Safepay sandbox
    const realTracker = 'track_11f5abcf-a392-4a2d-9c99-396f8c63f1ac';
    const trackerRes = await safepayAdapter.fetchTracker(realTracker);
    assert.ok(trackerRes && trackerRes.data, 'Safepay response must contain data');
    assert.strictEqual(trackerRes.data.token, realTracker, 'Tracker token must match');
    assert.strictEqual(trackerRes.data.state, 'TRACKER_ENDED', 'Provider state must be TRACKER_ENDED');
    assert.strictEqual(Number(trackerRes.data.amount), 24330, 'Amount must be 24,330');
    assert.strictEqual(trackerRes.data.currency, 'PKR', 'Currency must be PKR');
    assert.ok(trackerRes.data.transaction, 'Transaction object must be present');
    assert.strictEqual(trackerRes.data.transaction.token, 'trans_e47b8706-47b3-4bb8-bbc2-58dcda929441');
    recordPass('Authenticated real Safepay API query confirms CAPTURED transaction (TRACKER_ENDED)');

    // Test 3: Transaction HMAC-SHA256 signature verification
    const expectedSig = crypto
      .createHmac('sha256', safepayAdapter.secretKey)
      .update(realTracker)
      .digest('hex');
    assert.strictEqual(trackerRes.data.transaction.signature, expectedSig, 'Transaction signature must match merchant HMAC');
    recordPass('Authoritative transaction signature cryptographically verified against SAFEPAY_SECRET_KEY');

    // -------------------------------------------------------------------------
    // SECTION 2: Reconciliation Security & Contract Defenses
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Reconciliation Security & Fail-Closed Defenses ---');

    // Test 4: Non-existent order returns 404
    let notFoundErr = null;
    try {
      await safepayCheckoutService.reconcilePaymentWithProvider({
        orderId: 999999,
        actor: { id: 5, role: 'BUYER' }
      });
    } catch (e) {
      notFoundErr = e;
    }
    assert.ok(notFoundErr && notFoundErr.code === 'ORDER_NOT_FOUND', 'Non-existent order must return ORDER_NOT_FOUND');
    recordPass('Non-existent order returns 404 ORDER_NOT_FOUND');

    // Test 5: Cross-buyer reconciliation denied (Tenant Isolation)
    let tenantErr = null;
    try {
      await safepayCheckoutService.reconcilePaymentWithProvider({
        orderId: 66,
        actor: { id: 7, role: 'BUYER' } // Competitor buyer
      });
    } catch (e) {
      tenantErr = e;
    }
    assert.ok(tenantErr && tenantErr.code === 'FORBIDDEN', 'Cross-buyer reconciliation must return FORBIDDEN');
    recordPass('Tenant isolation: Cross-buyer reconciliation rejected with 403 FORBIDDEN');

    // Setup temporary order for defense tests
    const [tempOrderInsert] = await db.query(
      `INSERT INTO orders (
        order_code, pool_id, reservation_id, buyer_id, supplier_id, total_qty,
        unit_price, subtotal_amount, total_amount, currency, order_status, payment_status, created_at
      ) VALUES ('ORD-DEFENSE-TEST-999', 650, 672, 5, 2, 10.0000, 2433.00, 24330.00, 24330.00, 'PKR', 'AWAITING_PAYMENT', 'PAYMENT_INITIATED', NOW())`
    );
    const tempOrderId = tempOrderInsert.insertId;

    // Test 6: Missing active attempt rejected
    let noAttemptErr = null;
    try {
      await safepayCheckoutService.reconcilePaymentWithProvider({
        orderId: tempOrderId,
        actor: { id: 5, role: 'BUYER' }
      });
    } catch (e) {
      noAttemptErr = e;
    }
    assert.ok(noAttemptErr && noAttemptErr.code === 'NO_ACTIVE_PAYMENT_ATTEMPT');
    recordPass('Missing payment attempt rejected with 422 NO_ACTIVE_PAYMENT_ATTEMPT');

    // Insert dummy attempt for mock defense tests
    const [tempAttemptInsert] = await db.query(
      `INSERT INTO payment_attempts (
        attempt_code, order_id, buyer_id, provider, environment,
        provider_tracker_token, checkout_url, amount, currency, status, idempotency_key, created_at
      ) VALUES ('ATT-DEFENSE-001', ?, 5, 'SAFEPAY', 'sandbox', 'track_mock_defense_123', 'http://example.com', 24330.00, 'PKR', 'INITIATED', 'IDEM-DEF-1', NOW())`,
      [tempOrderId]
    );
    const tempAttemptId = tempAttemptInsert.insertId;

    // Test 7: Uncaptured provider state (TRACKER_STARTED) does not mutate order
    const mockUncaptured = {
      fetchTracker: async () => ({
        data: {
          token: 'track_mock_defense_123',
          state: 'TRACKER_STARTED',
          amount: 24330,
          currency: 'PKR',
          transaction: null
        }
      })
    };
    const uncapturedRes = await safepayCheckoutService.reconcilePaymentWithProvider({
      orderId: tempOrderId,
      actor: { id: 5, role: 'BUYER' },
      mockClient: mockUncaptured
    });
    assert.strictEqual(uncapturedRes.reconciled, false, 'Uncaptured payment must not reconcile');
    const [tempOrderCheck1] = await db.query('SELECT order_status, payment_status FROM orders WHERE id = ?', [tempOrderId]);
    assert.strictEqual(tempOrderCheck1[0].order_status, 'AWAITING_PAYMENT');
    recordPass('Uncaptured provider state (TRACKER_STARTED) safely acknowledged without order mutation');

    // Test 8: Currency mismatch fails closed
    const mockCurrencyMismatch = {
      fetchTracker: async () => ({
        data: {
          token: 'track_mock_defense_123',
          state: 'TRACKER_ENDED',
          amount: 24330,
          currency: 'USD',
          transaction: { token: 'trans_fake', amount: 24330, currency: 'USD' }
        }
      })
    };
    let currErr = null;
    try {
      await safepayCheckoutService.reconcilePaymentWithProvider({
        orderId: tempOrderId,
        actor: { id: 5, role: 'BUYER' },
        mockClient: mockCurrencyMismatch
      });
    } catch (e) {
      currErr = e;
    }
    assert.ok(currErr && currErr.code === 'CURRENCY_MISMATCH');
    recordPass('Currency mismatch between provider and order fails closed with 422 CURRENCY_MISMATCH');

    // Test 9: Amount mismatch fails closed
    const mockAmountMismatch = {
      fetchTracker: async () => ({
        data: {
          token: 'track_mock_defense_123',
          state: 'TRACKER_ENDED',
          amount: 24329.00, // 1-rupee shortfall tampering
          currency: 'PKR',
          transaction: { token: 'trans_fake', amount: 24329.00, currency: 'PKR' }
        }
      })
    };
    let amtErr = null;
    try {
      await safepayCheckoutService.reconcilePaymentWithProvider({
        orderId: tempOrderId,
        actor: { id: 5, role: 'BUYER' },
        mockClient: mockAmountMismatch
      });
    } catch (e) {
      amtErr = e;
    }
    assert.ok(amtErr && amtErr.code === 'AMOUNT_MISMATCH');
    recordPass('Amount shortfall tampering fails closed with 422 AMOUNT_MISMATCH');

    // Test 10: Forged transaction signature rejected
    const mockForgedSig = {
      fetchTracker: async () => ({
        data: {
          token: 'track_mock_defense_123',
          state: 'TRACKER_ENDED',
          amount: 24330.00,
          currency: 'PKR',
          transaction: {
            token: 'trans_fake',
            amount: 24330.00,
            currency: 'PKR',
            signature: '0000000000000000000000000000000000000000000000000000000000000000'
          }
        }
      })
    };
    let sigErr = null;
    try {
      await safepayCheckoutService.reconcilePaymentWithProvider({
        orderId: tempOrderId,
        actor: { id: 5, role: 'BUYER' },
        mockClient: mockForgedSig
      });
    } catch (e) {
      sigErr = e;
    }
    assert.ok(sigErr && sigErr.code === 'INVALID_TRANSACTION_SIGNATURE');
    recordPass('Forged provider transaction signature rejected with 422 INVALID_TRANSACTION_SIGNATURE');

    // Clean up temporary defense order
    await db.query('DELETE FROM payment_attempts WHERE id = ?', [tempAttemptId]);
    await db.query('DELETE FROM orders WHERE id = ?', [tempOrderId]);

    // -------------------------------------------------------------------------
    // SECTION 3: Authoritative Order 66 Captured Payment State
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Authoritative Order 66 State & Integrity ---');

    // Test 11: Order 66 is authoritatively PAID
    const [order66Rows] = await db.query('SELECT * FROM orders WHERE id = 66');
    assert.strictEqual(order66Rows.length, 1);
    assert.strictEqual(order66Rows[0].order_status, 'PAID', 'Order status must be PAID');
    assert.strictEqual(order66Rows[0].payment_status, 'PAID', 'Payment status must be PAID');
    assert.strictEqual(Number(order66Rows[0].total_amount), 24330.00, 'Total amount must be exactly 24,330.00 PKR');
    recordPass('Order 66 authoritatively transitioned to order_status=PAID and payment_status=PAID');

    // Test 12: Payment attempt 14 is authoritatively COMPLETED
    const [attempt14Rows] = await db.query('SELECT * FROM payment_attempts WHERE id = 14');
    assert.strictEqual(attempt14Rows.length, 1);
    assert.strictEqual(attempt14Rows[0].status, 'COMPLETED', 'Attempt 14 status must be COMPLETED');
    assert.strictEqual(attempt14Rows[0].provider_tracker_token, realTracker);
    recordPass('Payment attempt 14 authoritatively transitioned to status=COMPLETED');

    // Test 13: Authoritative payment record in payments table
    const [payments66] = await db.query('SELECT * FROM payments WHERE order_id = 66');
    assert.strictEqual(payments66.length, 1, 'Exactly one payment record must exist for Order 66');
    assert.strictEqual(payments66[0].status, 'PAID');
    assert.strictEqual(payments66[0].escrow_status, 'HELD_IN_ESCROW', 'Funds must be strictly HELD_IN_ESCROW');
    assert.strictEqual(Number(payments66[0].amount), 24330.00);
    assert.strictEqual(payments66[0].transaction_ref, 'trans_e47b8706-47b3-4bb8-bbc2-58dcda929441');
    recordPass('Authoritative payments row persisted with HELD_IN_ESCROW and genuine transaction ref');

    // Test 14: Payment webhook event recorded
    const [webhookEvents66] = await db.query('SELECT * FROM payment_webhook_events WHERE order_id = 66');
    assert.strictEqual(webhookEvents66.length, 1);
    assert.strictEqual(webhookEvents66[0].processed_status, 'PROCESSED');
    assert.strictEqual(webhookEvents66[0].provider_tracker_token, realTracker);
    recordPass('Reconciliation event durable record logged in payment_webhook_events (PROCESSED)');

    // Test 15: Outbox ORDER_PAID event emitted
    const [outboxEvents66] = await db.query(
      `SELECT * FROM reservation_business_events 
       WHERE event_type = 'ORDER_PAID' AND reservation_id = ?`,
      [order66Rows[0].reservation_id]
    );
    assert.strictEqual(outboxEvents66.length, 1, 'Exactly one ORDER_PAID event in outbox');
    assert.strictEqual(outboxEvents66[0].event_payload.order_status, 'PAID');
    assert.strictEqual(outboxEvents66[0].event_payload.payment_status, 'PAID');
    recordPass('Transactional outbox event ORDER_PAID emitted in reservation_business_events');

    // Test 16: Idempotency guarantee (reconciliation re-execution returns already_paid without duplicate records)
    const idempotentReplay = await safepayCheckoutService.reconcilePaymentWithProvider({
      orderId: 66,
      actor: { id: 5, role: 'BUYER' }
    });
    assert.strictEqual(idempotentReplay.already_paid, true);
    assert.strictEqual(idempotentReplay.reconciled, false);
    const [paymentsCountAfter] = await db.query('SELECT count(*) as count FROM payments WHERE order_id = 66');
    assert.strictEqual(paymentsCountAfter[0].count, 1, 'Duplicate payment rows must never be inserted');
    recordPass('Idempotency verified: re-reconciliation acknowledges without duplicate financial mutations');

    // -------------------------------------------------------------------------
    // SECTION 4: Read Model Verification
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Order Payment Status Read Model ---');

    // Test 17: Read-model lifecycle reporting
    const statusModel = await safepayCheckoutService.getOrderPaymentStatus({
      orderId: 66,
      actor: { id: 5, role: 'BUYER' }
    });
    assert.strictEqual(statusModel.order_id, 66);
    assert.strictEqual(statusModel.order_status, 'PAID');
    assert.strictEqual(statusModel.payment_status, 'PAID');
    assert.strictEqual(statusModel.lifecycle_phase, 'VERIFIED_PAYMENT_COMPLETED');
    assert.strictEqual(statusModel.latest_attempt.status, 'COMPLETED');
    recordPass('Read model GET /api/v1/orders/66/payment-status reports VERIFIED_PAYMENT_COMPLETED');

    // -------------------------------------------------------------------------
    // SECTION 5: Database Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Production Database Isolation ---');

    // Test 18: Production DB miljor_db remains 100% PRISTINE
    const [prodPools] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pools');
    const [prodOrders] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.orders');
    const [prodAttempts] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.payment_attempts');
    const [prodPayments] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.payments');
    const [prodEvents] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.reservation_business_events');

    assert.strictEqual(prodPools[0].cnt, 2, 'miljor_db pools must remain 2');
    assert.strictEqual(prodOrders[0].cnt, 0, 'miljor_db orders must remain 0');
    assert.strictEqual(prodAttempts[0].cnt, 0, 'miljor_db payment_attempts must remain 0');
    assert.strictEqual(prodPayments[0].cnt, 0, 'miljor_db payments must remain 0');
    assert.strictEqual(prodEvents[0].cnt, 0, 'miljor_db reservation_business_events must remain 0');
    recordPass('Database isolation: miljor_db is 100% PRISTINE (0 orders, 0 attempts, 0 payments)');

  } catch (err) {
    console.error('Test suite failed:', err);
    throw err;
  }

  console.log('\n================================================================================');
  console.log(`Part 4E.3.6 Payment Recovery Gate: ${passedTests} / ${totalTests} assertions passed`);
  console.log('Status: PASS');
  console.log('================================================================================\n');
}

if (require.main === module) {
  runSuite()
    .then(() => db.end())
    .catch((err) => {
      console.error('Suite error:', err);
      return db.end().then(() => process.exit(1));
    });
}

module.exports = runSuite;
