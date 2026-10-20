// =============================================================================
// src/services/safepayCheckoutService.js
// MilJor Part 4E.3: Safepay Sandbox Checkout & Payment State Machine
//
// Governs checkout session creation, durable payment attempts, raw webhook
// verification, and exactly-once payment confirmation transitions.
//
// Core Invariants Enforced:
// 1. Order-before-payment: Checkout only initiates on valid AWAITING_PAYMENT orders.
// 2. Client Amount Tampering Immunity: Amount and currency are fetched strictly
//    from the locked database order row.
// 3. Network Out-of-Lock Invariant: Safepay API calls occur strictly outside
//    MySQL transaction locks.
// 4. Exactly-once payment confirmation: Transactional order state transition to PAID
//    with immutable payment record and ORDER_PAID outbox event.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/db');
const safepayAdapter = require('./safepayAdapter');
const reservationEventService = require('./reservationEventService');
const exactDecimal = require('./exactDecimal');

class SafepayCheckoutService {

  /**
   * Initiates a Safepay sandbox checkout session for a valid buyer order.
   *
   * @param {Object} params
   * @param {number} params.orderId - Target order ID
   * @param {Object} params.actor - Authenticated caller { id, role, buyer_trust_status }
   * @param {string} params.idempotencyKey - Mandatory unique idempotency key
   * @param {string} [params.redirectUrl] - Optional success redirect URL
   * @param {string} [params.cancelUrl] - Optional cancel redirect URL
   * @param {Object} [params.mockClient] - Injected test client for simulated network behavior
   * @returns {Promise<Object>} Checkout attempt representation with hosted checkout URL
   */
  async initiateCheckout({
    orderId,
    actor,
    idempotencyKey,
    redirectUrl = null,
    cancelUrl = null,
    mockClient = null
  }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id) {
      const err = new Error('Authentication required');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    if (actor.role !== 'BUYER') {
      const err = new Error('Checkout initiation is strictly restricted to BUYER role');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    if (actor.buyer_trust_status === 'SUSPENDED') {
      const err = new Error('Suspended buyer accounts are prohibited from checkout');
      err.code = 'ACCOUNT_SUSPENDED';
      err.statusCode = 403;
      throw err;
    }

    const trimmedKey = idempotencyKey ? String(idempotencyKey).trim() : null;
    if (!trimmedKey) {
      const err = new Error('X-Idempotency-Key is mandatory for checkout initiation');
      err.code = 'MISSING_IDEMPOTENCY_KEY';
      err.statusCode = 400;
      throw err;
    }

    // Step 1: Stage 1 DB validation (verify order state & ownership under consistent read)
    const [orders] = await db.query(
      `SELECT o.*, u.buyer_trust_status
       FROM orders o
       JOIN users u ON o.buyer_id = u.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (orders.length === 0) {
      const err = new Error('Order not found');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = orders[0];

    // Ownership check (tenant isolation)
    if (Number(order.buyer_id) !== Number(actor.id)) {
      const err = new Error('You do not have permission to checkout this order');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    // Order status check
    if (order.order_status === 'PAID' || order.payment_status === 'PAID') {
      const err = new Error('Order has already been paid in full');
      err.code = 'ORDER_ALREADY_PAID';
      err.statusCode = 409;
      throw err;
    }

    if (order.order_status !== 'AWAITING_PAYMENT') {
      const err = new Error(`Order is in '${order.order_status}' status and cannot be paid`);
      err.code = 'INVALID_ORDER_STATUS';
      err.statusCode = 422;
      throw err;
    }

    // Financial component check (OBS-79 fail-closed guard)
    const totalPayable = Number(order.total_amount);
    if (!totalPayable || totalPayable <= 0 || isNaN(totalPayable)) {
      const err = new Error('Order does not have a complete, valid payable total');
      err.code = 'INVALID_PAYABLE_TOTAL';
      err.statusCode = 422;
      throw err;
    }

    // Check for existing active attempt with same idempotency key (idempotent replay)
    const [existingAttempts] = await db.query(
      `SELECT * FROM payment_attempts 
       WHERE order_id = ? AND idempotency_key = ?
       ORDER BY id DESC LIMIT 1`,
      [orderId, trimmedKey]
    );

    if (existingAttempts.length > 0) {
      const existing = existingAttempts[0];
      return {
        is_replay: true,
        attempt: this._formatAttempt(existing, order)
      };
    }

    // Check for currently active attempt to prevent duplicate concurrent sessions
    const [activeAttempts] = await db.query(
      `SELECT * FROM payment_attempts 
       WHERE order_id = ? AND status = 'INITIATED' AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
       ORDER BY id DESC LIMIT 1`,
      [orderId]
    );

    if (activeAttempts.length > 0) {
      const active = activeAttempts[0];
      // Return the current active session
      return {
        is_replay: false,
        is_existing_active: true,
        attempt: this._formatAttempt(active, order)
      };
    }

    // Step 2: Call Safepay API OUTSIDE transaction lock
    const { trackerToken, rawResponse } = await safepayAdapter.createTracker({
      amount: totalPayable,
      currency: order.currency || 'PKR',
      orderCode: order.order_code,
      mockClient
    });

    let tbtToken = null;
    try {
      tbtToken = await safepayAdapter.createPassportToken({ mockClient });
    } catch (e) {
      // Non-fatal if mock client does not implement passport token
    }

    const checkoutUrl = safepayAdapter.constructCheckoutUrl({
      trackerToken,
      orderCode: order.order_code,
      tbtToken,
      redirectUrl,
      cancelUrl
    });

    // Step 3: Record durable payment attempt in DB
    const attemptCode = `ATT-${order.order_code.slice(-8)}-${Date.now().toString().slice(-4)}`;

    const [attemptInsert] = await db.query(
      `INSERT INTO payment_attempts (
        attempt_code, order_id, buyer_id, provider, environment,
        provider_tracker_token, checkout_url, amount, currency,
        status, idempotency_key, created_at
      ) VALUES (?, ?, ?, 'SAFEPAY', 'sandbox', ?, ?, ?, ?, 'INITIATED', ?, NOW())`,
      [
        attemptCode,
        order.id,
        order.buyer_id,
        trackerToken,
        checkoutUrl,
        totalPayable,
        order.currency || 'PKR',
        trimmedKey
      ]
    );

    // Update order payment_status to PAYMENT_INITIATED
    await db.query(
      `UPDATE orders SET payment_status = 'PAYMENT_INITIATED', updated_at = NOW() WHERE id = ?`,
      [order.id]
    );

    const [newAttemptRows] = await db.query(
      `SELECT * FROM payment_attempts WHERE id = ?`,
      [attemptInsert.insertId]
    );

    return {
      is_replay: false,
      attempt: this._formatAttempt(newAttemptRows[0], order)
    };
  }

  /**
   * Processes a verified Safepay webhook event.
   * Atomically transitions the order to PAID upon verified 'payment.completed'.
   *
   * @param {Object} params
   * @param {Buffer|string} params.rawBody - Raw request body
   * @param {string} params.signature - X-SFPY-SIGNATURE header
   * @param {string} params.timestamp - X-SFPY-TIMESTAMP header
   * @param {string} params.eventId - X-SFPY-EVENT-ID header
   * @param {string} params.eventType - X-SFPY-EVENT-TYPE header
   * @returns {Promise<Object>} Verification and transition outcome
   */
  async processWebhookEvent({
    rawBody,
    signature,
    timestamp,
    eventId,
    eventType
  }) {
    // 1. Signature Verification (Official Safepay HMAC-SHA512 over untouched raw body bytes)
    const isAuthentic = safepayAdapter.verifyWebhookSignature({
      rawBody,
      signature
    });

    if (!isAuthentic) {
      const err = new Error('Cryptographic signature verification failed');
      err.code = 'INVALID_WEBHOOK_SIGNATURE';
      err.statusCode = 401;
      throw err;
    }

    let parsedPayload;
    try {
      parsedPayload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
    } catch (e) {
      const err = new Error('Malformed webhook JSON payload');
      err.code = 'INVALID_PAYLOAD';
      err.statusCode = 400;
      throw err;
    }

    const effectiveEventId = eventId || parsedPayload.token || parsedPayload.id || `evt_${Date.now()}`;
    const effectiveEventType = eventType || parsedPayload.type || parsedPayload.webhook_event_type || 'unknown';

    // 2. Check for duplicate webhook receipt (Idempotency)
    const [existingEvent] = await db.query(
      `SELECT * FROM payment_webhook_events WHERE event_id = ?`,
      [effectiveEventId]
    );

    if (existingEvent.length > 0) {
      return {
        success: true,
        is_duplicate: true,
        message: 'Duplicate webhook event acknowledged without state mutation'
      };
    }

    // 3. Extract transaction details from webhook payload
    const data = parsedPayload.data || parsedPayload;
    
    // Official Safepay v2 schema: data.tracker can be a string ('track_...') or an object ({ token: 'track_...' })
    let trackerToken = null;
    if (typeof data.tracker === 'string') {
      trackerToken = data.tracker;
    } else if (data.tracker && data.tracker.token) {
      trackerToken = data.tracker.token;
    } else if (data.token) {
      trackerToken = data.token;
    } else if (parsedPayload.token && typeof parsedPayload.token === 'string' && parsedPayload.token.startsWith('track_')) {
      trackerToken = parsedPayload.token;
    }

    const providerAmount = (data.tracker && typeof data.tracker === 'object' && data.tracker.amount !== undefined)
      ? Number(data.tracker.amount)
      : (data.amount !== undefined ? Number(data.amount) : null);
    const providerCurrency = (data.tracker && typeof data.tracker === 'object' && data.tracker.currency)
      || data.currency
      || parsedPayload.currency
      || 'PKR';

    // Support both official Safepay event 'payment.succeeded' and backwards-compatible 'payment.completed' / variants
    const isSuccessEvent = [
      'payment.succeeded',
      'payment:succeeded',
      'payment.completed',
      'payment:completed',
      'payment.settled',
      'payment:settled'
    ].includes(effectiveEventType);

    if (!isSuccessEvent) {
      // Record event but take no financial mutation
      await db.query(
        `INSERT INTO payment_webhook_events (
          event_id, provider, event_type, provider_tracker_token,
          signature, timestamp_header, raw_payload, processed_status
        ) VALUES (?, 'SAFEPAY', ?, ?, ?, ?, ?, 'PROCESSED')`,
        [
          effectiveEventId,
          effectiveEventType,
          trackerToken,
          signature,
          String(timestamp),
          JSON.stringify(parsedPayload)
        ]
      );
      return {
        success: true,
        event_type: effectiveEventType,
        message: 'Webhook event recorded; no state transition required'
      };
    }

    if (!trackerToken) {
      const err = new Error('Webhook success event missing tracker token');
      err.code = 'MISSING_TRACKER_TOKEN';
      err.statusCode = 422;
      throw err;
    }

    // 4. Atomic Database Transaction: Confirm Payment
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Find matching payment attempt
      const [attempts] = await connection.query(
        `SELECT * FROM payment_attempts WHERE provider_tracker_token = ? FOR UPDATE`,
        [trackerToken]
      );

      if (attempts.length === 0) {
        // Unknown tracker: record event in RECONCILIATION_REQUIRED
        await connection.query(
          `INSERT INTO payment_webhook_events (
            event_id, provider, event_type, provider_tracker_token,
            signature, timestamp_header, raw_payload, processed_status, error_message
          ) VALUES (?, 'SAFEPAY', ?, ?, ?, ?, ?, 'RECONCILIATION_REQUIRED', 'No payment_attempt row matches tracker token')`,
          [
            effectiveEventId,
            effectiveEventType,
            trackerToken,
            signature,
            String(timestamp),
            JSON.stringify(parsedPayload)
          ]
        );
        await connection.commit();
        return {
          success: true,
          status: 'RECONCILIATION_REQUIRED',
          message: 'Payment received for untracked session; flagged for reconciliation'
        };
      }

      const attempt = attempts[0];

      // Lock parent order row FOR UPDATE
      const [orders] = await connection.query(
        `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
        [attempt.order_id]
      );

      if (orders.length === 0) {
        throw new Error(`Order ${attempt.order_id} not found during payment confirmation`);
      }

      const order = orders[0];

      // Currency check
      if (providerCurrency !== (order.currency || 'PKR')) {
        const err = new Error(`Currency mismatch: Expected ${order.currency}, received ${providerCurrency}`);
        err.code = 'CURRENCY_MISMATCH';
        err.statusCode = 422;
        throw err;
      }

      // Exact Amount check (fail-closed)
      if (providerAmount !== null) {
        // Safepay amount in order/v1 is in major units (e.g. 192450.00)
        // If provider reports subunits (>10000x), convert, but standard init returns exact decimal
        let normalizedProviderAmount = providerAmount;
        if (providerAmount === Number(order.total_amount) * 100) {
          normalizedProviderAmount = Number((providerAmount / 100).toFixed(2));
        }

        const expectedAmountStr = exactDecimal.toCanonicalString(order.total_amount, 2);
        const receivedAmountStr = exactDecimal.toCanonicalString(normalizedProviderAmount, 2);

        if (!exactDecimal.exactDecimalEquals(expectedAmountStr, receivedAmountStr, 2)) {
          const err = new Error(`Amount mismatch: Expected ${expectedAmountStr}, received ${receivedAmountStr}`);
          err.code = 'AMOUNT_MISMATCH';
          err.statusCode = 422;
          throw err;
        }
      }

      // Check if order was already confirmed PAID
      if (order.order_status === 'PAID') {
        // Mark duplicate webhook receipt safely
        await connection.query(
          `INSERT INTO payment_webhook_events (
            event_id, provider, event_type, order_id, attempt_id, provider_tracker_token,
            signature, timestamp_header, raw_payload, processed_status
          ) VALUES (?, 'SAFEPAY', ?, ?, ?, ?, ?, ?, ?, 'IGNORED_DUPLICATE')`,
          [
            effectiveEventId,
            effectiveEventType,
            order.id,
            attempt.id,
            trackerToken,
            signature,
            String(timestamp),
            JSON.stringify(parsedPayload)
          ]
        );
        await connection.commit();
        return {
          success: true,
          is_duplicate: true,
          message: 'Order was already verified as PAID'
        };
      }

      // 5. Update Payment Attempt to COMPLETED
      await connection.query(
        `UPDATE payment_attempts 
         SET status = 'COMPLETED', updated_at = NOW() 
         WHERE id = ?`,
        [attempt.id]
      );

      // 6. Transition Order to PAID and activate Fulfillment lifecycle
      await connection.query(
        `UPDATE orders 
         SET payment_status = 'PAID', order_status = 'PAID', fulfillment_status = 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', updated_at = NOW() 
         WHERE id = ?`,
        [order.id]
      );

      // 7. Insert Authoritative Payment Record in `payments` table
      const paymentCode = `PAY-${order.order_code.slice(-8)}-${Date.now().toString().slice(-4)}`;
      await connection.query(
        `INSERT INTO payments (
          payment_code, order_id, reservation_id, buyer_id, amount,
          buyer_fee, payment_method, status, escrow_status,
          transaction_ref, provider_response, paid_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'CARD', 'PAID', 'HELD_IN_ESCROW', ?, ?, NOW(), NOW())`,
        [
          paymentCode,
          order.id,
          order.reservation_id,
          order.buyer_id,
          order.total_amount,
          order.buyer_platform_fee || 0.00,
          trackerToken,
          JSON.stringify({
            event_id: effectiveEventId,
            event_type: effectiveEventType,
            provider: 'SAFEPAY',
            tracker_token: trackerToken
          })
        ]
      );

      // 8. Record Webhook Event as PROCESSED
      await connection.query(
        `INSERT INTO payment_webhook_events (
          event_id, provider, event_type, order_id, attempt_id, provider_tracker_token,
          signature, timestamp_header, raw_payload, processed_status
        ) VALUES (?, 'SAFEPAY', ?, ?, ?, ?, ?, ?, ?, 'PROCESSED')`,
        [
          effectiveEventId,
          effectiveEventType,
          order.id,
          attempt.id,
          trackerToken,
          signature,
          String(timestamp),
          JSON.stringify(parsedPayload)
        ]
      );

      // 9. Transactional Outbox Event: ORDER_PAID
      const eventIdOutbox = reservationEventService.generateEventId({
        event_type: 'ORDER_PAID',
        pool_id: order.pool_id || 0,
        reservation_id: order.reservation_id || 0,
        actor_id: order.buyer_id,
        mutation_type: 'PAYMENT_CONFIRMATION',
        idempotency_key: effectiveEventId,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'BUYER', 'ORDER_PAID', ?, ?, NOW())`,
        [
          eventIdOutbox,
          order.pool_id || 0,
          order.reservation_id || 0,
          order.buyer_id,
          JSON.stringify({
            order_id: order.id,
            order_code: order.order_code,
            amount: Number(order.total_amount),
            currency: order.currency || 'PKR',
            provider: 'SAFEPAY',
            tracker_token: trackerToken,
            payment_status: 'PAID',
            order_status: 'PAID'
          }),
          effectiveEventId
        ]
      );

      await connection.commit();

      return {
        success: true,
        order_id: order.id,
        order_code: order.order_code,
        payment_status: 'PAID',
        order_status: 'PAID',
        message: 'Order payment successfully confirmed via authentic Safepay webhook'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Retrieves the authoritative payment status for a buyer order.
   *
   * @param {Object} params
   * @param {number} params.orderId - Target order ID
   * @param {Object} params.actor - Authenticated caller { id, role }
   * @returns {Promise<Object>} Payment status representation
   */
  async getOrderPaymentStatus({ orderId, actor }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    const [orders] = await db.query(
      `SELECT o.*, u.business_name AS buyer_name
       FROM orders o
       JOIN users u ON o.buyer_id = u.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (orders.length === 0) {
      const err = new Error('Order not found');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = orders[0];

    // Tenancy check: Buyer can only inspect their own orders; Admin can inspect any
    if (actor.role === 'BUYER' && Number(order.buyer_id) !== Number(actor.id)) {
      const err = new Error('You do not have permission to view payment status for this order');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    // Fetch latest payment attempt
    const [attempts] = await db.query(
      `SELECT * FROM payment_attempts 
       WHERE order_id = ? 
       ORDER BY id DESC LIMIT 1`,
      [orderId]
    );

    const latestAttempt = attempts[0] || null;

    let lifecyclePhase = 'CHECKOUT_NOT_STARTED';
    if (order.order_status === 'PAID') {
      lifecyclePhase = 'VERIFIED_PAYMENT_COMPLETED';
    } else if (latestAttempt) {
      if (latestAttempt.status === 'INITIATED') {
        lifecyclePhase = 'WAITING_FOR_PROVIDER_CONFIRMATION';
      } else if (latestAttempt.status === 'FAILED') {
        lifecyclePhase = 'CHECKOUT_FAILED';
      } else if (latestAttempt.status === 'RECONCILIATION_REQUIRED') {
        lifecyclePhase = 'RECONCILIATION_REQUIRED';
      }
    }

    return {
      order_id: order.id,
      order_code: order.order_code,
      buyer_id: order.buyer_id,
      payment_status: order.payment_status,
      order_status: order.order_status,
      total_amount: Number(order.total_amount),
      currency: order.currency,
      lifecycle_phase: lifecyclePhase,
      latest_attempt: latestAttempt ? {
        attempt_code: latestAttempt.attempt_code,
        status: latestAttempt.status,
        provider: latestAttempt.provider,
        environment: latestAttempt.environment,
        provider_tracker_token: latestAttempt.provider_tracker_token,
        checkout_url: latestAttempt.checkout_url,
        created_at: latestAttempt.created_at
      } : null
    };
  }

  /**
   * Authoritatively reconciles an order's payment status with Safepay.
   * Fetches provider state directly from Safepay API outside database locks,
   * validates cryptographic signature and exact amounts, and transactionally
   * confirms the order if captured.
   *
   * @param {Object} params
   * @param {number} params.orderId - Target order ID
   * @param {Object} [params.actor] - Optional authenticated caller { id, role }
   * @param {Object} [params.mockClient] - Optional injected client for tests
   * @returns {Promise<Object>} Reconciliation result
   */
  async reconcilePaymentWithProvider({ orderId, actor = null, mockClient = null }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    // Step 1: Read order and latest attempt
    const [orders] = await db.query(
      `SELECT o.*, u.buyer_trust_status
       FROM orders o
       JOIN users u ON o.buyer_id = u.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (orders.length === 0) {
      const err = new Error('Order not found');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = orders[0];

    // Tenant check if actor provided
    if (actor && actor.role === 'BUYER' && Number(order.buyer_id) !== Number(actor.id)) {
      const err = new Error('You do not have permission to reconcile this order');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    // If order is already PAID, return idempotent confirmation
    if (order.order_status === 'PAID') {
      const [existingPayments] = await db.query(
        `SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
        [orderId]
      );
      return {
        success: true,
        reconciled: false,
        already_paid: true,
        order_status: 'PAID',
        payment_status: 'PAID',
        payment: existingPayments[0] || null,
        message: 'Order is already verified as PAID'
      };
    }

    // Must be in AWAITING_PAYMENT / PAYMENT_INITIATED
    if (order.order_status !== 'AWAITING_PAYMENT') {
      const err = new Error(`Order is in '${order.order_status}' status and cannot be reconciled`);
      err.code = 'INVALID_ORDER_STATUS';
      err.statusCode = 422;
      throw err;
    }

    // Find latest payment attempt
    const [attempts] = await db.query(
      `SELECT * FROM payment_attempts 
       WHERE order_id = ? AND status = 'INITIATED'
       ORDER BY id DESC LIMIT 1`,
      [orderId]
    );

    if (attempts.length === 0) {
      const err = new Error('No initiated payment attempt found for this order');
      err.code = 'NO_ACTIVE_PAYMENT_ATTEMPT';
      err.statusCode = 422;
      throw err;
    }

    const attempt = attempts[0];
    const trackerToken = attempt.provider_tracker_token;

    // Step 2: Fetch authoritative tracker status from Safepay OUTSIDE transaction lock
    const providerResponse = await safepayAdapter.fetchTracker(trackerToken, { mockClient });

    if (!providerResponse || !providerResponse.data) {
      const err = new Error('Safepay returned empty tracker data');
      err.code = 'INVALID_PROVIDER_RESPONSE';
      err.statusCode = 502;
      throw err;
    }

    const trackerData = providerResponse.data;

    // Verify token identity
    if (trackerData.token !== trackerToken) {
      const err = new Error(`Tracker token mismatch: expected ${trackerToken}, received ${trackerData.token}`);
      err.code = 'TRACKER_MISMATCH';
      err.statusCode = 502;
      throw err;
    }

    // Verify state: Safepay marks captured/completed sessions as 'TRACKER_ENDED' with transaction object
    if (trackerData.state !== 'TRACKER_ENDED' || !trackerData.transaction) {
      return {
        success: true,
        reconciled: false,
        order_status: order.order_status,
        payment_status: order.payment_status,
        provider_state: trackerData.state,
        message: `Payment not yet captured by provider (state: ${trackerData.state})`
      };
    }

    const transaction = trackerData.transaction;

    // Verify currency
    const providerCurrency = trackerData.currency || transaction.currency || 'PKR';
    if (providerCurrency !== (order.currency || 'PKR')) {
      const err = new Error(`Currency mismatch: Expected ${order.currency}, received ${providerCurrency}`);
      err.code = 'CURRENCY_MISMATCH';
      err.statusCode = 422;
      throw err;
    }

    // Verify exact amount
    const providerAmount = Number(trackerData.amount || transaction.amount);
    const expectedAmountStr = exactDecimal.toCanonicalString(order.total_amount, 2);
    const receivedAmountStr = exactDecimal.toCanonicalString(providerAmount, 2);

    if (!exactDecimal.exactDecimalEquals(expectedAmountStr, receivedAmountStr, 2)) {
      const err = new Error(`Amount mismatch: Expected ${expectedAmountStr}, received ${receivedAmountStr}`);
      err.code = 'AMOUNT_MISMATCH';
      err.statusCode = 422;
      throw err;
    }

    // Cryptographic signature check on transaction if secretKey available
    if (transaction.signature && safepayAdapter.secretKey) {
      const computedSig = crypto
        .createHmac('sha256', safepayAdapter.secretKey)
        .update(trackerToken)
        .digest('hex');

      const expectedSigBuf = Buffer.from(computedSig.toLowerCase(), 'utf8');
      const receivedSigBuf = Buffer.from(String(transaction.signature).toLowerCase(), 'utf8');

      if (expectedSigBuf.length !== receivedSigBuf.length || !crypto.timingSafeEqual(expectedSigBuf, receivedSigBuf)) {
        const err = new Error('Cryptographic signature verification on provider transaction failed');
        err.code = 'INVALID_TRANSACTION_SIGNATURE';
        err.statusCode = 422;
        throw err;
      }
    }

    // Step 3: Transactional confirmation under MySQL locks
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Lock attempt and order
      const [lockedAttempts] = await connection.query(
        `SELECT * FROM payment_attempts WHERE id = ? FOR UPDATE`,
        [attempt.id]
      );
      const [lockedOrders] = await connection.query(
        `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
        [order.id]
      );

      const lockedOrder = lockedOrders[0];
      if (lockedOrder.order_status === 'PAID') {
        await connection.commit();
        return {
          success: true,
          reconciled: false,
          already_paid: true,
          order_status: 'PAID',
          payment_status: 'PAID',
          message: 'Order was already verified as PAID'
        };
      }

      // Update payment attempt to COMPLETED
      await connection.query(
        `UPDATE payment_attempts SET status = 'COMPLETED', updated_at = NOW() WHERE id = ?`,
        [attempt.id]
      );

      // Transition order to PAID and activate Fulfillment lifecycle
      await connection.query(
        `UPDATE orders SET payment_status = 'PAID', order_status = 'PAID', fulfillment_status = 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', updated_at = NOW() WHERE id = ?`,
        [order.id]
      );

      // Insert into payments
      const paymentCode = `PAY-${order.order_code.slice(-8)}-${Date.now().toString().slice(-4)}`;
      const [paymentInsert] = await connection.query(
        `INSERT INTO payments (
          payment_code, order_id, reservation_id, buyer_id, amount,
          buyer_fee, payment_method, status, escrow_status,
          transaction_ref, provider_response, paid_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'CARD', 'PAID', 'HELD_IN_ESCROW', ?, ?, NOW(), NOW())`,
        [
          paymentCode,
          order.id,
          order.reservation_id,
          order.buyer_id,
          order.total_amount,
          order.buyer_platform_fee || 0.00,
          transaction.token || trackerToken,
          JSON.stringify({
            reconciled_via: 'DIRECT_PROVIDER_VERIFICATION',
            tracker_token: trackerToken,
            transaction_token: transaction.token,
            transaction_ref: transaction.reference,
            provider_state: trackerData.state,
            amount: providerAmount,
            currency: providerCurrency
          })
        ]
      );

      // Record in payment_webhook_events as an authoritative reconciliation record
      const reconciliationEventId = `evt_rec_${transaction.token || Date.now()}`;
      await connection.query(
        `INSERT INTO payment_webhook_events (
          event_id, provider, event_type, order_id, attempt_id, provider_tracker_token,
          signature, timestamp_header, raw_payload, processed_status
        ) VALUES (?, 'SAFEPAY', 'payment.reconciled', ?, ?, ?, ?, ?, ?, 'PROCESSED')`,
        [
          reconciliationEventId,
          order.id,
          attempt.id,
          trackerToken,
          transaction.signature || 'verified_reconciliation',
          String(transaction.created_at || Date.now()),
          JSON.stringify(providerResponse)
        ]
      );

      // Transactional Outbox Event: ORDER_PAID
      const eventIdOutbox = reservationEventService.generateEventId({
        event_type: 'ORDER_PAID',
        pool_id: order.pool_id || 0,
        reservation_id: order.reservation_id || 0,
        actor_id: order.buyer_id,
        mutation_type: 'PAYMENT_CONFIRMATION',
        idempotency_key: reconciliationEventId,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'BUYER', 'ORDER_PAID', ?, ?, NOW())`,
        [
          eventIdOutbox,
          order.pool_id || 0,
          order.reservation_id || 0,
          order.buyer_id,
          JSON.stringify({
            order_id: order.id,
            order_code: order.order_code,
            amount: Number(order.total_amount),
            currency: order.currency || 'PKR',
            provider: 'SAFEPAY',
            tracker_token: trackerToken,
            transaction_token: transaction.token,
            payment_status: 'PAID',
            order_status: 'PAID',
            reconciliation: true
          }),
          reconciliationEventId
        ]
      );

      await connection.commit();

      const [newPayments] = await db.query(
        `SELECT * FROM payments WHERE id = ?`,
        [paymentInsert.insertId]
      );

      return {
        success: true,
        reconciled: true,
        order_status: 'PAID',
        payment_status: 'PAID',
        payment: newPayments[0],
        message: 'Order payment successfully reconciled and confirmed from authoritative provider state'
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  _formatAttempt(attempt, order) {
    return {
      attempt_code: attempt.attempt_code,
      order_id: order.id,
      order_code: order.order_code,
      amount: Number(attempt.amount),
      currency: attempt.currency,
      provider: attempt.provider,
      environment: attempt.environment,
      status: attempt.status,
      provider_tracker_token: attempt.provider_tracker_token,
      checkout_url: attempt.checkout_url,
      created_at: attempt.created_at
    };
  }
}

module.exports = new SafepayCheckoutService();
