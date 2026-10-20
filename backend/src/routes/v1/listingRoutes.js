// =============================================================================
// src/routes/v1/listingRoutes.js
// MilJor Supplier Listing API Routes
// Supplier offers, stock, pricing, and lifecycle
// =============================================================================
const express = require('express');
const router = express.Router();
const listingController = require('../../controllers/supplierListingController');
const { protect, authorize, requireVerifiedSupplier } = require('../../middlewares/authGuard');

// Public Listing Browsing (Buyers & Visitors)
router.get('/', listingController.getAllListings);

// Protected Supplier Routes
// Note: /me must be placed before /:id to prevent route shadowing
router.get(
  '/me',
  protect,
  authorize('SUPPLIER'),
  listingController.getMyListings
);

router.get('/:id', listingController.getListingById);
router.get('/:id/price-history', listingController.getListingPriceHistory);

// Create new listing: Strictly requires verified supplier status
router.post(
  '/',
  protect,
  requireVerifiedSupplier,
  listingController.createListing
);

// Update listing (ownership checked)
router.put(
  '/:id',
  protect,
  authorize('SUPPLIER', 'SUPER_ADMIN'),
  listingController.updateListing
);

// Toggle listing status: ACTIVE, PAUSED, etc. (ownership checked)
router.patch(
  '/:id/status',
  protect,
  authorize('SUPPLIER', 'SUPER_ADMIN'),
  listingController.updateListingStatus
);

module.exports = router;
