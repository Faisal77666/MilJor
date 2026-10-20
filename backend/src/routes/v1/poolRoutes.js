// =============================================================================
// src/routes/v1/poolRoutes.js
// MilJor Regular Pool Routes
// Supports public discovery, supplier draft creation, draft updates, publishing,
// and lifecycle transitions with strict idempotency and authorization guards.
// =============================================================================
const express = require('express');
const router = express.Router();
const poolController = require('../../controllers/poolController');
const { protect, authorize, authorizeStrict, requireVerifiedSupplier } = require('../../middlewares/authGuard');
const idempotencyGuard = require('../../middlewares/idempotencyGuard');

// ---------------------------------------------------------------------------
// Public Routes
// ---------------------------------------------------------------------------
router.get('/', poolController.getActivePools);
router.get('/:id', poolController.getPoolById);

// ---------------------------------------------------------------------------
// Supplier Routes
// ---------------------------------------------------------------------------
// View own pools
router.get(
  '/supplier/my',
  protect,
  authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'),
  poolController.getMyPools
);

// Supplier views reservation summary for their pool (Part 4C.2B)
router.get(
  '/:id/supplier/summary',
  protect,
  authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'),
  poolController.getSupplierReservationSummary
);

// Alias for supplier reservation summary
router.get(
  '/:id/reservations/summary',
  protect,
  authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'),
  poolController.getSupplierReservationSummary
);

// Create pool draft (verified suppliers + admin only)
router.post(
  '/',
  protect,
  authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'),
  requireVerifiedSupplier,
  idempotencyGuard.required,
  poolController.createPool
);

// Update DRAFT pool (verified suppliers + admin only)
router.put(
  '/:id',
  protect,
  authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'),
  requireVerifiedSupplier,
  idempotencyGuard,
  poolController.updateDraftPool
);

// Publish DRAFT pool to ACTIVE (locks commercial terms and allocates inventory)
router.post(
  '/:id/publish',
  protect,
  authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'),
  requireVerifiedSupplier,
  idempotencyGuard.required,
  poolController.publishPool
);

// Confirm a TARGET_REACHED pool → CONFIRMED
router.put(
  '/:id/confirm',
  protect,
  authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'),
  poolController.confirmPool
);

// Cancel a DRAFT/ACTIVE pool
router.put(
  '/:id/cancel',
  protect,
  authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'),
  poolController.cancelPool
);

// Authoritative Commercial Pool Qualification (Part 4D.2 / OBS-62 Required Idempotency)
// Allowed for owning SUPPLIER, ADMIN, or SUPER_ADMIN
router.post(
  '/:id/qualify',
  protect,
  authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'),
  idempotencyGuard.required,
  poolController.qualifyPool
);

// Authoritative Supplier Commercial Decision (Part 4D.3)
// Strictly restricted to SUPPLIER role (Admin cannot impersonate commercial consent)
// Enforces mandatory X-Idempotency-Key
router.post(
  '/:id/supplier-decision',
  protect,
  authorizeStrict('SUPPLIER'),
  requireVerifiedSupplier,
  idempotencyGuard.required,
  poolController.recordSupplierDecision
);

// Read-model for commercial decision status and qualification summary (Part 4D.3)
// Authorized for SUPPLIER, ADMIN, SUPER_ADMIN, and participating BUYERs
router.get(
  '/:id/supplier-decision',
  protect,
  poolController.getSupplierDecisionStatus
);

// Read-model for post-qualification committed demand accounting (Part 4D.4)
// Authorized for SUPPLIER, ADMIN, SUPER_ADMIN, and participating BUYERs
router.get(
  '/:id/committed-demand-summary',
  protect,
  poolController.getCommittedDemandSummary
);

module.exports = router;