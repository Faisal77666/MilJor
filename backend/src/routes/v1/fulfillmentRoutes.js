// =============================================================================
// src/routes/v1/fulfillmentRoutes.js
// MilJor Part 4E.4: Post-Payment Fulfillment & Supplier-Managed Delivery Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const fulfillmentController = require('../../controllers/fulfillmentController');
const { protect, authorizeStrict, authorizeAdmin } = require('../../middlewares/authGuard');
const idempotencyGuard = require('../../middlewares/idempotencyGuard');

// =============================================================================
// SUPPLIER FULFILLMENT ENDPOINTS
// Strictly restricted to authenticated SUPPLIER role
// =============================================================================

// List assigned paid orders awaiting fulfillment (paginated)
router.get(
  '/supplier/orders',
  protect,
  authorizeStrict('SUPPLIER'),
  (req, res) => fulfillmentController.listSupplierOrders(req, res)
);

// View fulfillment details and tracking timeline for an assigned order
router.get(
  '/supplier/orders/:id',
  protect,
  authorizeStrict('SUPPLIER'),
  (req, res) => fulfillmentController.getSupplierOrderById(req, res)
);

// Supplier advances order fulfillment milestone (Mandatory X-Idempotency-Key)
router.post(
  '/supplier/orders/:id/transition',
  protect,
  authorizeStrict('SUPPLIER'),
  idempotencyGuard.required,
  (req, res) => fulfillmentController.transitionSupplierOrder(req, res)
);

// Supplier records an operational exception (Mandatory X-Idempotency-Key)
router.post(
  '/supplier/orders/:id/exception',
  protect,
  authorizeStrict('SUPPLIER'),
  idempotencyGuard.required,
  (req, res) => fulfillmentController.recordSupplierException(req, res)
);

// =============================================================================
// BUYER FULFILLMENT ENDPOINTS
// Strictly restricted to authenticated BUYER role
// =============================================================================

// List paid fulfillment orders for buyer (paginated)
router.get(
  '/buyer/orders',
  protect,
  authorizeStrict('BUYER'),
  (req, res) => fulfillmentController.listBuyerOrders(req, res)
);

// View fulfillment status and tracking timeline for buyer's order
router.get(
  '/buyer/orders/:id',
  protect,
  authorizeStrict('BUYER'),
  (req, res) => fulfillmentController.getBuyerOrderById(req, res)
);

// Buyer confirms receipt of goods (Mandatory X-Idempotency-Key)
router.post(
  '/buyer/orders/:id/confirm-receipt',
  protect,
  authorizeStrict('BUYER'),
  idempotencyGuard.required,
  (req, res) => fulfillmentController.confirmBuyerReceipt(req, res)
);

// Buyer reports delivery discrepancy (Mandatory X-Idempotency-Key)
router.post(
  '/buyer/orders/:id/report-discrepancy',
  protect,
  authorizeStrict('BUYER'),
  idempotencyGuard.required,
  (req, res) => fulfillmentController.reportBuyerDiscrepancy(req, res)
);

// =============================================================================
// ADMIN AUDIT ENDPOINTS
// Read-only operational visibility for administrative roles
// =============================================================================

router.get(
  '/admin/orders/:id',
  protect,
  authorizeAdmin,
  (req, res) => fulfillmentController.getAdminOrderById(req, res)
);

module.exports = router;
