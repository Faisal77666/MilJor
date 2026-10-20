// =============================================================================
// src/routes/v1/specificationRoutes.js
// MilJor Product Specification & Exact-Spec Comparison API Routes
// =============================================================================
const express = require('express');
const router = express.Router();
const specController = require('../../controllers/productSpecificationController');
const { protect, authorize, requireVerifiedSupplier } = require('../../middlewares/authGuard');

// Public Routes (Buyers & Visitors)
router.get('/', specController.getAllSpecifications);
router.get('/:id', specController.getSpecificationById);
router.get('/:id/compare', specController.compareSupplierListings);

// Protected Routes (Catalog & Specification Management)
// Admins or Verified Suppliers can propose / create exact specifications
router.post(
  '/',
  protect,
  authorize('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'SUPPLIER'),
  specController.createSpecification
);

module.exports = router;
