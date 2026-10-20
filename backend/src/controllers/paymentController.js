// =============================================================================
// src/controllers/paymentController.js
// MAJOR REWRITE — Fixes:
//   BUG-01: Uses 'payments' table ONLY (escrow_payments eliminated)
//   BUG-11: Validates reservation ownership, status, and amount match
//   BUG-07: Idempotency applied at route level
//   BUG-13: No hardcoded JWT fallback
// Full flow: CREATED → PENDING → PAID → Ledger entry
// =============================================================================
const paymentRepo = require('../repositories/paymentRepo');
const ledgerRepo = require('../repositories/ledgerRepo');
const feeService = require('../services/feeService');
const paymentProviderService = require('../services/paymentProviderService');
const safepayCheckoutService = require('../services/safepayCheckoutService');
const db = require('../config/db');

class PaymentController {

  // ---------------------------------------------------------------------------
  // POST /api/v1/payments/initiate
  // Step 1: Buyer initiates payment for a CONFIRMED reservation
  // BUG-11 FIX: Validates ownership + reservation status + amount
  // BUG-01 FIX: Writes to 'payments' table only
  // ---------------------------------------------------------------------------
  async initiatePayment(req, res) {
    try {
      const buyer_id = req.user.id;
      const { reservation_id, payment_method = 'MOCK_GATEWAY' } = req.body;

      if (!reservation_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'reservation_id is required' }
        });
      }

      // 1. Fetch reservation and validate ownership
      const [reservations] = await db.query(
        'SELECT * FROM reservations WHERE id = ?',
        [reservation_id]
      );

      if (!reservations[0]) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Reservation not found' }
        });
      }

      const reservation = reservations[0];

      // BUG-11 FIX: Ownership check
      if (reservation.buyer_id !== buyer_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only pay for your own reservations' }
        });
      }

      // BUG-11 FIX: Status check — must be CONFIRMED (price is locked)
      if (reservation.status !== 'CONFIRMED') {
        return res.status(422).json({
          success: false,
          error: {
            code: 'INVALID_RESERVATION_STATUS',
            message: `Reservation must be CONFIRMED before payment. Current status: ${reservation.status}`
          }
        });
      }

      // Check for existing PAID payment (duplicate prevention)
      const existingPayment = await paymentRepo.findByReservationId(reservation_id);
      if (existingPayment && ['PAID', 'PENDING', 'PROCESSING'].includes(existingPayment.status)) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'PAYMENT_EXISTS',
            message: `A ${existingPayment.status} payment already exists for this reservation`,
            data: { payment_id: existingPayment.id, payment_code: existingPayment.payment_code }
          }
        });
      }

      // 2. Use locked price (never trust any amount from client)
      const lockedAmount = parseFloat(reservation.locked_total_price);

      // 3. Calculate buyer marketplace fee using feeService
      const feeResult = await feeService.calculateBuyerFee(lockedAmount);
      const buyerFee = parseFloat(feeResult.buyer_fee);
      const totalWithFee = (lockedAmount + buyerFee).toFixed(2);

      // 4. Initiate with payment provider
      const providerResult = await paymentProviderService.initiatePayment({
        provider: payment_method,
        amount: totalWithFee,
        orderId: `RES-${reservation_id}`,
        buyerId: buyer_id,
        description: `MilJor Pool Reservation #${reservation.reservation_code}`
      });

      if (!providerResult.success) {
        return res.status(503).json({
          success: false,
          error: {
            code: providerResult.status,
            message: providerResult.message
          }
        });
      }

      // 5. Create payment record in 'payments' table (BUG-01 FIX)
      const payment_code = 'MJ-PAY-' + Math.floor(100000 + Math.random() * 900000);

      const paymentId = await paymentRepo.createPayment({
        payment_code,
        reservation_id,
        buyer_id,
        amount: totalWithFee,
        buyer_fee: buyerFee.toFixed(2),
        payment_method,
        transaction_ref: providerResult.transaction_ref
      });

      // 6. Update reservation status to PAID (pending verify step)
      await db.query(
        "UPDATE payments SET status = 'PENDING' WHERE id = ?",
        [paymentId]
      );

      // 7. Audit
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'BUYER', 'PAYMENT_INITIATED', 'payments', ?, ?)`,
        [buyer_id, paymentId, JSON.stringify({ payment_code, reservation_id, amount: totalWithFee, payment_method })]
      );

      return res.status(200).json({
        success: true,
        message: 'Payment initiated. Call /verify to confirm payment with the transaction reference.',
        data: {
          payment_id: paymentId,
          payment_code,
          reservation_id,
          status: 'PENDING',
          payment_method,
          base_amount: lockedAmount.toFixed(2),
          buyer_fee: buyerFee.toFixed(2),
          total_amount: totalWithFee,
          transaction_ref: providerResult.transaction_ref,
          provider_message: providerResult.message
        }
      });

    } catch (error) {
      console.error('Payment Initiate Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'PAYMENT_INITIATION_FAILED', message: 'Payment initiation failed. Please try again.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/payments/verify
  // Step 2: Server-side payment verification — NEVER trust frontend success
  // Marks payment PAID and creates ledger entry
  // ---------------------------------------------------------------------------
  async verifyPayment(req, res) {
    try {
      const buyer_id = req.user.id;
      const { payment_id, transaction_ref } = req.body;

      if (!payment_id || !transaction_ref) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'payment_id and transaction_ref are required' }
        });
      }

      // Fetch payment record
      const payment = await paymentRepo.findById(payment_id);
      if (!payment) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payment record not found' }
        });
      }

      // Ownership check
      if (payment.buyer_id !== buyer_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied' }
        });
      }

      // Already verified?
      if (payment.status === 'PAID') {
        return res.status(200).json({
          success: true,
          message: 'Payment already verified and confirmed',
          data: { payment_id, status: 'PAID', payment_code: payment.payment_code }
        });
      }

      if (!['PENDING', 'PROCESSING'].includes(payment.status)) {
        return res.status(422).json({
          success: false,
          error: { code: 'INVALID_PAYMENT_STATUS', message: `Cannot verify a payment in status: ${payment.status}` }
        });
      }

      // Verify with provider (server-side — never trust frontend)
      const verifyResult = await paymentProviderService.verifyPayment({
        provider: payment.payment_method,
        transaction_ref,
        expected_amount: payment.amount
      });

      if (!verifyResult.verified) {
        // Mark as FAILED
        await paymentRepo.updateStatus(payment_id, 'FAILED', {
          provider_response: verifyResult
        });
        return res.status(402).json({
          success: false,
          error: { code: 'PAYMENT_VERIFICATION_FAILED', message: 'Payment could not be verified with the provider.' }
        });
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        // Mark payment as PAID
        await connection.query(
          `UPDATE payments
           SET status = 'PAID', escrow_status = 'HELD_IN_ESCROW',
               transaction_ref = ?, provider_response = ?, paid_at = NOW(), updated_at = NOW()
           WHERE id = ?`,
          [transaction_ref, JSON.stringify(verifyResult.raw), payment_id]
        );

        // Mark reservation as PAID
        if (payment.reservation_id) {
          await connection.query(
            "UPDATE reservations SET status = 'PAID', updated_at = NOW() WHERE id = ?",
            [payment.reservation_id]
          );
        }

        // Create ledger entry (supplier net after supplier fee)
        const [supplierRows] = await connection.query(
          `SELECT sp.transaction_fee_percent, r.pool_id, p.supplier_id
           FROM reservations r
           JOIN pools p ON r.pool_id = p.id
           LEFT JOIN supplier_profiles sp ON sp.supplier_id = p.supplier_id
           WHERE r.id = ?`,
          [payment.reservation_id]
        );

        const feePercent = supplierRows[0]?.transaction_fee_percent || 2.5;
        const grossAmount = parseFloat(payment.amount) - parseFloat(payment.buyer_fee || 0);

        const ledgerCode = 'MJ-LDG-' + Math.floor(100000 + Math.random() * 900000);
        const platformFee = (grossAmount * (feePercent / 100)).toFixed(2);
        const supplierNet = (grossAmount - parseFloat(platformFee)).toFixed(2);

        await connection.query(
          `INSERT INTO platform_ledger (ledger_code, payment_id, gross_amount, platform_fee_amount, supplier_net_amount, payout_status)
           VALUES (?, ?, ?, ?, ?, 'HELD_IN_ESCROW')`,
          [ledgerCode, payment_id, grossAmount.toFixed(2), platformFee, supplierNet]
        );

        // Audit
        await connection.query(
          `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
           VALUES (?, 'BUYER', 'PAYMENT_VERIFIED', 'payments', ?, ?)`,
          [buyer_id, payment_id, JSON.stringify({ transaction_ref, amount: payment.amount, ledger_code: ledgerCode })]
        );

        await connection.commit();
        connection.release();

      } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
      }

      return res.status(200).json({
        success: true,
        message: 'Payment verified and confirmed. Funds held in escrow.',
        data: {
          payment_id,
          payment_code: payment.payment_code,
          status: 'PAID',
          amount: payment.amount,
          escrow_status: 'HELD_IN_ESCROW'
        }
      });

    } catch (error) {
      console.error('Payment Verify Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'VERIFICATION_FAILED', message: 'Payment verification failed. Please try again.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/payments/:id  — Get payment status (buyer owns it or admin)
  // BUG-01 FIX: Queries 'payments' table
  // ---------------------------------------------------------------------------
  async getPaymentStatus(req, res) {
    try {
      const payment = await paymentRepo.findById(req.params.id);

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payment not found' }
        });
      }

      const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN'].includes(req.user.role);
      if (!isAdmin && payment.buyer_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied' }
        });
      }

      // Strip provider_response from non-admin users
      if (!isAdmin) {
        delete payment.provider_response;
      }

      return res.status(200).json({ success: true, data: { payment } });

    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/payments/my  — Buyer's payment history
  // ---------------------------------------------------------------------------
  async getMyPayments(req, res) {
    try {
      const payments = await paymentRepo.findByBuyerId(req.user.id);
      return res.status(200).json({ success: true, count: payments.length, data: { payments } });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/payments/:id/refund  — Admin initiates refund
  // ---------------------------------------------------------------------------
  async initiateRefund(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const payment = await paymentRepo.findById(id);
      if (!payment) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Payment not found' } });
      }

      if (!['PAID', 'DISPUTED'].includes(payment.status)) {
        return res.status(422).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: `Cannot refund payment in status: ${payment.status}` }
        });
      }

      // Initiate refund with provider
      const refundResult = await paymentProviderService.initiateRefund({
        provider: payment.payment_method,
        transaction_ref: payment.transaction_ref,
        amount: payment.amount,
        reason: reason || 'Admin-initiated refund'
      });

      if (!refundResult.success) {
        return res.status(503).json({
          success: false,
          error: { code: refundResult.status, message: refundResult.message }
        });
      }

      await paymentRepo.updateStatus(id, 'REFUNDED', { escrow_status: 'REFUNDED' });

      await db.query(
        `UPDATE platform_ledger SET payout_status = 'REFUNDED_TO_BUYER', updated_at = NOW()
         WHERE payment_id = ?`,
        [id]
      );

      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, ?, 'PAYMENT_REFUNDED', 'payments', ?, ?)`,
        [req.user.id, req.user.role, id, JSON.stringify({ reason, refund_ref: refundResult.refund_ref })]
      );

      return res.status(200).json({
        success: true,
        message: 'Refund initiated successfully',
        data: { payment_id: parseInt(id), status: 'REFUNDED', refund_ref: refundResult.refund_ref }
      });

    } catch (error) {
      console.error('Refund Error:', error);
      return res.status(500).json({ success: false, error: { code: 'REFUND_FAILED', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/payments/webhook/safepay
  // Unauthenticated provider webhook endpoint verified via cryptographic signature
  // ---------------------------------------------------------------------------
  async handleSafepayWebhook(req, res) {
    try {
      const rawBody = req.rawBody !== undefined
        ? req.rawBody
        : (Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}), 'utf8'));

      const signature = req.headers['x-sfpy-signature'] || req.headers['x-safepay-signature'];
      const timestamp = req.headers['x-sfpy-timestamp'] || req.headers['x-safepay-timestamp'];
      const eventId = req.headers['x-sfpy-event-id'] || req.headers['x-safepay-event-id'];
      const eventType = req.headers['x-sfpy-event-type'] || req.headers['x-safepay-event-type'];

      const result = await safepayCheckoutService.processWebhookEvent({
        rawBody,
        signature,
        timestamp,
        eventId,
        eventType
      });

      return res.status(200).json({
        success: true,
        message: result.message || 'Webhook processed successfully',
        data: result
      });
    } catch (err) {
      const statusCode = err.statusCode || (
        err.code === 'INVALID_WEBHOOK_SIGNATURE' ? 401 :
        err.code === 'INVALID_PAYLOAD' ? 400 :
        err.code === 'CURRENCY_MISMATCH' || err.code === 'AMOUNT_MISMATCH' || err.code === 'MISSING_TRACKER_TOKEN' ? 422 :
        500
      );

      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'WEBHOOK_PROCESSING_FAILED',
          message: err.message
        }
      });
    }
  }
}

module.exports = new PaymentController();