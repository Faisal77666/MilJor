// =============================================================================
// src/routes/v1/disputeRoutes.js
// MilJor Dispute Arbitration Routes
// Least Privilege Role Enforcement:
//   - File / View Own: BUYER
//   - Browse All Disputes: SUPPORT_ADMIN, OPERATIONS_ADMIN, SUPER_ADMIN
//   - Arbitration & Evidence Requests: OPERATIONS_ADMIN, SUPER_ADMIN
// =============================================================================
const express = require('express');
const router = express.Router();
const disputeController = require('../../controllers/disputeController');
const {
  protect,
  authorize,
  authorizeOperations,
  authorizeSupport
} = require('../../middlewares/authGuard');

// ---------------------------------------------------------------------------
// Buyer Routes
// ---------------------------------------------------------------------------
// Create a dispute for a reservation/order
router.post(
  '/',
  protect,
  authorize('BUYER'),
  (req, res) => disputeController.createDispute(req, res)
);

// View my own disputes
router.get(
  '/my',
  protect,
  authorize('BUYER'),
  (req, res) => disputeController.getMyDisputes(req, res)
);

// Get a specific dispute (buyer must own it or admin)
router.get(
  '/:id',
  protect,
  (req, res) => disputeController.getDisputeById(req, res)
);

// ---------------------------------------------------------------------------
// Admin Arbitration Routes
// ---------------------------------------------------------------------------
// List all disputes (Support / Operations / Super Admin)
router.get(
  '/',
  protect,
  authorizeSupport,
  (req, res) => disputeController.getAllDisputes(req, res)
);

// Resolve a dispute (Operations Admin, Super Admin only)
router.put(
  '/:id/resolve',
  protect,
  authorizeOperations,
  (req, res) => disputeController.resolveDispute(req, res)
);

// Request evidence from buyer (Operations Admin, Super Admin only)
router.put(
  '/:id/request-evidence',
  protect,
  authorizeOperations,
  (req, res) => disputeController.requestEvidence(req, res)
);

module.exports = router;
