// =============================================================================
// src/routes/v1/paymentRoutes.js
// FIXES:
//   BUG-07: idempotencyGuard now applied to POST /initiate and POST /verify
//   BUG-13: Inline verifyToken removed — uses shared protect middleware
// =============================================================================
const express = require('express');
const router = express.Router();
const paymentController = require('../../controllers/paymentController');
const { protect, authorize, authorizeAdmin, authorizeFinance } = require('../../middlewares/authGuard');
const idempotencyGuard = require('../../middlewares/idempotencyGuard');

// ---------------------------------------------------------------------------
// Public / Provider Webhooks (Cryptographically verified - no JWT required)
// ---------------------------------------------------------------------------
router.post(
  '/webhook/safepay',
  (req, res) => paymentController.handleSafepayWebhook(req, res)
);

// All subsequent payment routes require authentication
router.use(protect);

// ---------------------------------------------------------------------------
// Buyer Routes
// ---------------------------------------------------------------------------

// Initiate payment (BUG-07 FIX: idempotency guard applied)
router.post(
  '/initiate',
  authorize('BUYER'),
  idempotencyGuard,
  (req, res) => paymentController.initiatePayment(req, res)
);

// Server-side verify payment (BUG-07 FIX: idempotency guard applied)
router.post(
  '/verify',
  authorize('BUYER'),
  idempotencyGuard,
  (req, res) => paymentController.verifyPayment(req, res)
);

// View buyer's own payment history
router.get(
  '/my',
  authorize('BUYER'),
  (req, res) => paymentController.getMyPayments(req, res)
);

// ---------------------------------------------------------------------------
// Admin Routes
// ---------------------------------------------------------------------------

// Initiate refund (FINANCE_ADMIN, SUPER_ADMIN only)
router.post(
  '/:id/refund',
  authorizeFinance,
  (req, res) => paymentController.initiateRefund(req, res)
);

// ---------------------------------------------------------------------------
// Shared (buyer owns it OR admin)
// ---------------------------------------------------------------------------

// Get payment status
router.get(
  '/:id',
  (req, res) => paymentController.getPaymentStatus(req, res)
);

module.exports = router;