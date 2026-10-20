// =============================================================================
// src/controllers/supplierListingController.js
// MilJor Supplier Listing Controller
// Handles decoupled supplier offers, pricing, ownership checks, and status
// =============================================================================
const listingRepo = require('../repositories/supplierListingRepo');
const specRepo = require('../repositories/productSpecificationRepo');
const unitService = require('../services/unitConversionService');

class SupplierListingController {
  // 1. Create Supplier Listing (Verified Suppliers Only)
  async createListing(req, res) {
    try {
      const supplierId = req.user.id;
      const {
        product_spec_id,
        available_stock,
        base_unit_price,
        currency,
        supplier_min_qty,
        buyer_min_qty,
        delivery_zones,
        delivery_fee_policy,
        fulfilment_lead_time_days,
        notes
      } = req.body;

      // 1. Validate spec existence
      if (!product_spec_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Product specification ID (product_spec_id) is required' }
        });
      }

      const spec = await specRepo.findById(product_spec_id);
      if (!spec || !spec.is_active) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Active product specification not found' }
        });
      }

      // 2. Validate price and quantities
      const validation = unitService.validateQuantityAndPrice(
        buyer_min_qty || 1,
        base_unit_price
      );
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: { code: validation.code, message: validation.message }
        });
      }

      const stock = available_stock !== undefined ? Number(available_stock) : 0;
      const suppMin = supplier_min_qty !== undefined ? Number(supplier_min_qty) : 1;
      const buyerMin = buyer_min_qty !== undefined ? Number(buyer_min_qty) : 1;

      if (stock < 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STOCK', message: 'Available stock cannot be negative' }
        });
      }

      if (suppMin <= 0 || buyerMin <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_MIN_QTY', message: 'Supplier and buyer minimum quantities must be greater than zero' }
        });
      }

      // 2. Clear MOQ & Stock Semantics:
      // buyer_min_qty: minimum quantity a single buyer may purchase/request
      // supplier_min_qty: minimum batch threshold the supplier requires for fulfillment/dispatch
      if (stock > 0 && buyerMin > stock) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_BUYER_MIN_QTY', message: 'Buyer minimum quantity cannot exceed available stock' }
        });
      }

      // 3. Check for duplicate active listing for this supplier & spec
      const existing = await listingRepo.findBySupplierAndSpec(supplierId, product_spec_id);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'LISTING_ALREADY_EXISTS',
            message: 'You already have a listing for this exact specification. Please update the existing listing instead.',
            listing_id: existing.id
          }
        });
      }

      // 4. Generate listing code & compute base unit pricing
      const listingCode = `LST-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const packSize = Number(spec.pack_size);
      const pricePerBaseUnit = packSize > 0 ? Number((Number(base_unit_price) / packSize).toFixed(4)) : null;
      const pricingUnit = spec.purchasing_unit || 'pack';

      // 5. Create listing
      const listingId = await listingRepo.create({
        listing_code: listingCode,
        supplier_id: supplierId,
        product_spec_id,
        available_stock: stock,
        base_unit_price: Number(base_unit_price).toFixed(2),
        pricing_unit: pricingUnit,
        price_per_base_unit: pricePerBaseUnit,
        currency: currency || 'PKR',
        supplier_min_qty: suppMin,
        buyer_min_qty: buyerMin,
        delivery_zones: delivery_zones || ['All Lahore'],
        delivery_fee_policy: delivery_fee_policy || 'INCLUDED_IN_PRICE',
        fulfilment_lead_time_days: Number(fulfilment_lead_time_days || 2),
        status: 'ACTIVE',
        notes: notes || null
      });

      const newListing = await listingRepo.findById(listingId);

      res.status(201).json({
        success: true,
        message: 'Supplier listing created successfully',
        data: { listing: newListing }
      });
    } catch (error) {
      console.error('Create Listing Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 2. Get All Public Active Listings (Catalog / Buyer View)
  async getAllListings(req, res) {
    try {
      const { category, product_spec_id, supplier_id, search } = req.query;
      const listings = await listingRepo.findAll({
        category,
        product_spec_id,
        supplier_id,
        search,
        status: 'ACTIVE'
      });

      res.status(200).json({
        success: true,
        count: listings.length,
        data: { listings }
      });
    } catch (error) {
      console.error('Get All Listings Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 3. Get Authenticated Supplier's Own Listings
  async getMyListings(req, res) {
    try {
      const supplierId = req.user.id;
      const listings = await listingRepo.findAll({
        supplier_id: supplierId,
        activeOnly: false
      });

      res.status(200).json({
        success: true,
        count: listings.length,
        data: { listings }
      });
    } catch (error) {
      console.error('Get My Listings Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 4. Get Single Listing Details
  async getListingById(req, res) {
    try {
      const { id } = req.params;
      const listing = await listingRepo.findById(id);

      if (!listing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Supplier listing not found' }
        });
      }

      res.status(200).json({
        success: true,
        data: { listing }
      });
    } catch (error) {
      console.error('Get Listing Detail Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 5. Update Supplier Listing (Ownership Checked)
  async updateListing(req, res) {
    try {
      const { id } = req.params;
      const listing = await listingRepo.findById(id);

      if (!listing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Supplier listing not found' }
        });
      }

      // Strict ownership check
      if (listing.supplier_id !== req.user.id && req.user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not own this listing and cannot modify it' }
        });
      }

      const {
        available_stock,
        base_unit_price,
        supplier_min_qty,
        buyer_min_qty,
        delivery_zones,
        delivery_fee_policy,
        fulfilment_lead_time_days,
        notes,
        status,
        price_change_reason
      } = req.body;

      // Price update check
      if (base_unit_price !== undefined) {
        const newPrice = Number(base_unit_price);
        if (isNaN(newPrice) || newPrice <= 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_PRICE', message: 'Price must be a strictly positive number greater than zero' }
          });
        }

        const packSize = Number(listing.pack_size);
        if (packSize > 0) {
          req.body.price_per_base_unit = Number((newPrice / packSize).toFixed(4));
        }

        const oldPrice = Number(listing.base_unit_price);
        if (newPrice !== oldPrice) {
          await listingRepo.recordPriceChange(
            id,
            oldPrice,
            newPrice,
            req.user.id,
            price_change_reason || 'Supplier price adjustment'
          );
        }
      }

      if (available_stock !== undefined && Number(available_stock) < 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STOCK', message: 'Stock cannot be negative' }
        });
      }

      await listingRepo.update(id, req.body);
      const updatedListing = await listingRepo.findById(id);

      res.status(200).json({
        success: true,
        message: 'Listing updated successfully',
        data: { listing: updatedListing }
      });
    } catch (error) {
      console.error('Update Listing Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 6. Toggle Status (Active / Paused)
  async updateListingStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const validStatuses = ['ACTIVE', 'PAUSED', 'OUT_OF_STOCK', 'ARCHIVED'];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: `Status must be one of: ${validStatuses.join(', ')}` }
        });
      }

      const listing = await listingRepo.findById(id);
      if (!listing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Supplier listing not found' }
        });
      }

      // Ownership check
      if (listing.supplier_id !== req.user.id && req.user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not own this listing' }
        });
      }

      await listingRepo.updateStatus(id, status);

      res.status(200).json({
        success: true,
        message: `Listing status updated to ${status}`,
        data: { id, status }
      });
    } catch (error) {
      console.error('Update Listing Status Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 7. Get Price Change History
  async getListingPriceHistory(req, res) {
    try {
      const { id } = req.params;
      const history = await listingRepo.getPriceHistory(id);

      res.status(200).json({
        success: true,
        data: { listing_id: id, history }
      });
    } catch (error) {
      console.error('Get Price History Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }
}

module.exports = new SupplierListingController();
