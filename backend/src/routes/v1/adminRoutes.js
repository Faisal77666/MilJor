// =============================================================================
// src/routes/v1/adminRoutes.js
// MilJor Administrative & Verification Routes
// Enforces:
//   - Authentication required across all endpoints
//   - Least privilege role authorization
// =============================================================================
const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/adminController');
const {
  protect,
  authorizeVerification,
  authorizeOperations,
  authorize
} = require('../../middlewares/authGuard');

// All admin routes require authentication
router.use(protect);

// ---------------------------------------------------------------------------
// Verification Admin Routes
// ---------------------------------------------------------------------------
// List pending supplier applications
router.get(
  '/suppliers/pending',
  authorizeVerification,
  (req, res) => adminController.getPendingSuppliers(req, res)
);

// Approve or reject supplier verification
router.put(
  '/suppliers/:id/verify',
  authorizeVerification,
  (req, res) => adminController.verifySupplier(req, res)
);

// ---------------------------------------------------------------------------
// Operations Admin Routes
// ---------------------------------------------------------------------------
// Suspend a user account (fraud or policy violation)
router.put(
  '/users/:id/suspend',
  authorizeOperations,
  (req, res) => adminController.suspendUser(req, res)
);

// ---------------------------------------------------------------------------
// Super Admin Only Routes
// ---------------------------------------------------------------------------
// Reactivate a suspended account
router.put(
  '/users/:id/reactivate',
  authorize('SUPER_ADMIN'),
  (req, res) => adminController.reactivateUser(req, res)
);

module.exports = router;
