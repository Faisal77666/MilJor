// =============================================================================
// src/controllers/poolController.js
// MilJor Regular Pool Controller
// Implements DRAFT creation, editing, commercial terms validation,
// atomic publishing with inventory allocation, and supplier lifecycle actions.
// =============================================================================
const poolRepo = require('../repositories/poolRepo');
const productRepo = require('../repositories/productRepo');
const productSpecificationRepo = require('../repositories/productSpecificationRepo');
const supplierListingRepo = require('../repositories/supplierListingRepo');
const unitConversionService = require('../services/unitConversionService');
const tierPricingService = require('../services/tierPricingService');
const poolProgressService = require('../services/poolProgressService');
const db = require('../config/db');

class PoolController {

  // ---------------------------------------------------------------------------
  // POST /api/v1/pools  — Supplier creates a pool in DRAFT status (Part 4B.2/4B.3)
  // ---------------------------------------------------------------------------
  async createPool(req, res) {
    let connection = null;
    try {
      const supplier_id = req.user.id;
      const {
        product_id,
        product_spec_id,
        supplier_listing_id,
        target_qty,
        supplier_min_qty,
        buyer_min_qty,
        max_capacity,
        pool_unit,
        purchase_increment,
        duration_days,
        expires_at: customExpiresAt,
        delivery_type,
        delivery_zones,
        delivery_fee_policy,
        fulfilment_lead_time_days,
        cancellation_cutoff_hours,
        price_tiers,
        quality_spec_grade,
        early_close_allowed,
        supplier_confirmation_window_hours,
        buyer_commitment_window_hours
      } = req.body;

      // 1. Mandatory Identity Validations
      if (!product_id || !product_spec_id || !supplier_listing_id) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'product_id, product_spec_id, and supplier_listing_id are mandatory for all new Regular Pools'
          }
        });
      }

      // 2. Validate Product Identity Relationship
      const product = await productRepo.findById(product_id);
      if (!product) {
        return res.status(404).json({
          success: false,
          error: { code: 'PRODUCT_NOT_FOUND', message: 'Master product not found in catalog' }
        });
      }

      const spec = await productSpecificationRepo.findById(product_spec_id);
      if (!spec || !spec.is_active) {
        return res.status(404).json({
          success: false,
          error: { code: 'SPECIFICATION_NOT_FOUND', message: 'Active product specification not found' }
        });
      }

      if (Number(spec.product_id) !== Number(product_id)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'SPECIFICATION_MISMATCH',
            message: `Specification ID ${product_spec_id} does not belong to product ID ${product_id}`
          }
        });
      }

      // 3. Validate Supplier Listing Relationship & Ownership
      const listing = await supplierListingRepo.findById(supplier_listing_id);
      if (!listing) {
        return res.status(404).json({
          success: false,
          error: { code: 'LISTING_NOT_FOUND', message: 'Supplier listing not found' }
        });
      }

      if (Number(listing.supplier_id) !== Number(supplier_id)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You cannot create a pool referencing another supplier\'s listing'
          }
        });
      }

      if (Number(listing.product_spec_id) !== Number(product_spec_id)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'LISTING_SPEC_MISMATCH',
            message: `Listing ID ${supplier_listing_id} is for specification ${listing.product_spec_id}, not ${product_spec_id}`
          }
        });
      }

      if (listing.status !== 'ACTIVE') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INACTIVE_LISTING',
            message: `Supplier listing is not active (status: ${listing.status}). Cannot create pool from inactive listing.`
          }
        });
      }

      // 4. Commercial Quantity Validations
      const parsedTarget = Number(target_qty);
      const parsedSuppMin = Number(supplier_min_qty);
      const parsedBuyerMin = Number(buyer_min_qty);
      const parsedMaxCap = max_capacity !== undefined && max_capacity !== null ? Number(max_capacity) : null;
      const parsedIncrement = purchase_increment !== undefined && purchase_increment !== null ? Number(purchase_increment) : 1.0;

      if (isNaN(parsedTarget) || parsedTarget <= 0 ||
          isNaN(parsedSuppMin) || parsedSuppMin <= 0 ||
          isNaN(parsedBuyerMin) || parsedBuyerMin <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'target_qty, supplier_min_qty, and buyer_min_qty must be strictly positive numbers' }
        });
      }

      if (isNaN(parsedIncrement) || parsedIncrement <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INCREMENT', message: 'purchase_increment must be a positive number' }
        });
      }

      // Capacity & Target Relations
      if (parsedMaxCap !== null) {
        if (isNaN(parsedMaxCap) || parsedMaxCap <= 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CAPACITY', message: 'max_capacity must be a positive number' }
          });
        }
        if (parsedMaxCap < parsedSuppMin) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CAPACITY', message: 'max_capacity cannot be less than supplier_min_qty' }
          });
        }
        if (parsedTarget > parsedMaxCap) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_TARGET', message: 'target_qty cannot exceed max_capacity' }
          });
        }
        if (parsedBuyerMin > parsedMaxCap) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_BUYER_MIN', message: 'buyer_min_qty cannot exceed max_capacity' }
          });
        }
      } else {
        if (parsedSuppMin > parsedTarget) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_QUANTITY', message: 'supplier_min_qty cannot exceed target_qty' }
          });
        }
      }

      // Indivisible Pack Check
      const effectiveUnit = pool_unit ? unitConversionService.normalizeUnit(pool_unit) : (spec.purchasing_unit || 'pack');
      if (unitConversionService.isDiscreteUnit(effectiveUnit)) {
        if (!Number.isInteger(parsedTarget) || !Number.isInteger(parsedSuppMin) || !Number.isInteger(parsedBuyerMin)) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'FRACTIONAL_PACK_REJECTED',
              message: `Packaging unit '${effectiveUnit}' is indivisible and does not allow fractional quantities`
            }
          });
        }
        if (parsedMaxCap !== null && !Number.isInteger(parsedMaxCap)) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'FRACTIONAL_PACK_REJECTED',
              message: `max_capacity for indivisible pack unit '${effectiveUnit}' must be an integer`
            }
          });
        }
      }

      // 5. Expiry & Deadlines Validation
      let expiresAtDate;
      if (customExpiresAt) {
        expiresAtDate = new Date(customExpiresAt);
      } else if (duration_days) {
        const days = Number(duration_days);
        if (isNaN(days) || days <= 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_DURATION', message: 'duration_days must be a positive number' }
          });
        }
        expiresAtDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      } else {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Either duration_days or expires_at is required' }
        });
      }

      if (isNaN(expiresAtDate.getTime()) || expiresAtDate <= new Date()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_EXPIRY', message: 'Pool expiration timestamp must be in the future' }
        });
      }

      const suppWindow = supplier_confirmation_window_hours ? Number(supplier_confirmation_window_hours) : 24;
      const buyerWindow = buyer_commitment_window_hours ? Number(buyer_commitment_window_hours) : 24;
      const suppDeadline = new Date(expiresAtDate.getTime() + suppWindow * 60 * 60 * 1000);
      const buyerDeadline = new Date(suppDeadline.getTime() + buyerWindow * 60 * 60 * 1000);

      // 6. Unit Conversion & Inventory Feasibility Check
      const requiredCapacityUnits = parsedMaxCap !== null ? parsedMaxCap : parsedTarget;
      let requiredListingStockUnits = requiredCapacityUnits;

      const listingPricingUnit = unitConversionService.normalizeUnit(listing.pricing_unit);
      if (effectiveUnit !== listingPricingUnit) {
        try {
          requiredListingStockUnits = unitConversionService.convertQuantity(
            requiredCapacityUnits,
            effectiveUnit,
            listingPricingUnit,
            spec
          );
        } catch (conversionErr) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'UNIT_CONVERSION_ERROR',
              message: conversionErr.message
            }
          });
        }
      }

      // Check current allocations against listing
      const [existingAllocRows] = await db.query(
        `SELECT COALESCE(SUM(allocated_qty), 0) AS total_allocated
         FROM supplier_inventory_allocations
         WHERE supplier_listing_id = ? AND status IN ('PENDING', 'COMMITTED')`,
        [supplier_listing_id]
      );
      const activeAllocations = Number(existingAllocRows[0].total_allocated);
      const availableToPromise = Number(listing.available_stock) - activeAllocations;

      if (requiredListingStockUnits > availableToPromise) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_INVENTORY',
            message: `Supplier listing inventory is insufficient. Required allocation: ${requiredListingStockUnits} ${listingPricingUnit}, Available-to-promise: ${availableToPromise} ${listingPricingUnit}`
          }
        });
      }

      // 7. Validate Price Tiers (if provided in DRAFT)
      let initial_price = Number(listing.base_unit_price);
      let next_tier_price = null;
      let sortedTiers = [];

      if (price_tiers && Array.isArray(price_tiers) && price_tiers.length > 0) {
        const tierValidation = tierPricingService.validateTiers(price_tiers, {
          supplier_min_qty: parsedSuppMin,
          target_qty: parsedTarget,
          max_capacity: parsedMaxCap,
          pool_unit: effectiveUnit,
          purchase_increment: parsedIncrement
        });

        if (!tierValidation.valid) {
          return res.status(400).json({
            success: false,
            error: tierValidation.error
          });
        }
        sortedTiers = tierValidation.normalizedTiers;
        initial_price = sortedTiers[0].price_per_unit;
        next_tier_price = sortedTiers.length > 1 ? sortedTiers[1].price_per_unit : null;
      }

      // 8. Delivery Terms Validation
      const validDeliveryTypes = ['DOORSTEP', 'GROUPED_CLUSTER', 'SUPPLIER_PICKUP'];
      const effectiveDelType = delivery_type ? String(delivery_type).toUpperCase() : 'DOORSTEP';
      if (!validDeliveryTypes.includes(effectiveDelType)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DELIVERY_TYPE',
            message: `delivery_type must be one of: ${validDeliveryTypes.join(', ')}`
          }
        });
      }

      const leadDays = fulfilment_lead_time_days !== undefined && fulfilment_lead_time_days !== null
        ? Number(fulfilment_lead_time_days)
        : 2;
      if (isNaN(leadDays) || leadDays < 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_LEAD_TIME', message: 'fulfilment_lead_time_days must be a non-negative integer' }
        });
      }

      const cutoffHours = cancellation_cutoff_hours !== undefined && cancellation_cutoff_hours !== null
        ? Number(cancellation_cutoff_hours)
        : 0;
      if (isNaN(cutoffHours) || cutoffHours < 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CUTOFF_HOURS', message: 'cancellation_cutoff_hours must be a non-negative integer' }
        });
      }

      // 9. Atomic Database Transaction: Create DRAFT Pool
      connection = await db.getConnection();
      await connection.beginTransaction();

      const pool_code = 'MJ-POOL-' + Math.floor(100000 + Math.random() * 900000);

      const poolId = await poolRepo.createPool({
        pool_code,
        supplier_id,
        product_id: parseInt(product_id),
        product_spec_id: parseInt(product_spec_id),
        supplier_listing_id: parseInt(supplier_listing_id),
        target_qty: parsedTarget,
        supplier_min_qty: parsedSuppMin,
        buyer_min_qty: parsedBuyerMin,
        max_capacity: parsedMaxCap,
        pool_unit: effectiveUnit,
        purchase_increment: parsedIncrement,
        early_close_allowed: early_close_allowed !== undefined ? (early_close_allowed ? 1 : 0) : 1,
        delivery_type: effectiveDelType,
        delivery_zones: delivery_zones || null,
        delivery_fee_policy: delivery_fee_policy || 'INCLUDED_IN_PRICE',
        fulfilment_lead_time_days: leadDays,
        cancellation_cutoff_hours: cutoffHours,
        current_price_per_unit: initial_price,
        next_tier_price,
        quality_spec_grade: quality_spec_grade || spec.quality_grade || 'Grade-A Standard',
        status: 'DRAFT',
        expires_at: expiresAtDate,
        supplier_confirmation_deadline: suppDeadline,
        buyer_commitment_deadline: buyerDeadline
      }, connection);

      // Insert Price Tiers atomically within transaction
      for (const tier of sortedTiers) {
        await poolRepo.createPriceTier({
          pool_id: poolId,
          min_qty: tier.min_qty,
          max_qty: tier.max_qty,
          price_per_unit: tier.price_per_unit,
          pricing_unit: tier.pricing_unit || effectiveUnit
        }, connection);
      }

      // System Audit Log within transaction
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'SUPPLIER', 'REGULAR_POOL_DRAFT_CREATED', 'pools', ?, ?)`,
        [supplier_id, poolId, JSON.stringify({
          pool_code,
          product_spec_id,
          target_qty: parsedTarget,
          max_capacity: parsedMaxCap,
          status: 'DRAFT',
          idempotency_key: req.idempotency ? req.idempotency.key : null
        })]
      );

      // Atomically link idempotency record to created pool entity within the transaction
      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('pools', poolId, connection);
      }

      await connection.commit();
      connection.release();
      connection = null;

      const createdPool = await poolRepo.findById(poolId);

      return res.status(201).json({
        success: true,
        message: 'Regular Pool draft created successfully',
        data: {
          pool: createdPool
        }
      });

    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {}
        connection.release();
      }
      console.error('Create Regular Pool Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to create regular pool draft due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/pools/:id  — Supplier updates an existing DRAFT pool
  // ---------------------------------------------------------------------------
  async updateDraftPool(req, res) {
    let connection = null;
    try {
      const { id } = req.params;
      const supplier_id = req.user.id;

      // 1. Fetch pool and verify ownership & status
      const existingPool = await poolRepo.findById(id);
      if (!existingPool) {
        return res.status(404).json({
          success: false,
          error: { code: 'POOL_NOT_FOUND', message: 'Regular pool not found' }
        });
      }

      // Check ownership (Admin can override)
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
      if (!isAdmin && Number(existingPool.supplier_id) !== Number(supplier_id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only update your own regular pools' }
        });
      }

      // Only DRAFT pools can have their commercial configuration edited
      if (existingPool.status !== 'DRAFT') {
        return res.status(422).json({
          success: false,
          error: {
            code: 'INVALID_POOL_STATE',
            message: `Cannot edit commercial terms of pool with status '${existingPool.status}'. Only DRAFT pools may be updated.`
          }
        });
      }

      const {
        target_qty,
        supplier_min_qty,
        buyer_min_qty,
        max_capacity,
        pool_unit,
        purchase_increment,
        duration_days,
        expires_at: customExpiresAt,
        delivery_type,
        delivery_zones,
        delivery_fee_policy,
        fulfilment_lead_time_days,
        cancellation_cutoff_hours,
        price_tiers,
        quality_spec_grade,
        early_close_allowed,
        supplier_confirmation_window_hours,
        buyer_commitment_window_hours
      } = req.body;

      const parsedTarget = target_qty !== undefined ? Number(target_qty) : Number(existingPool.target_qty);
      const parsedSuppMin = supplier_min_qty !== undefined ? Number(supplier_min_qty) : Number(existingPool.supplier_min_qty);
      const parsedBuyerMin = buyer_min_qty !== undefined ? Number(buyer_min_qty) : Number(existingPool.buyer_min_qty);
      const parsedMaxCap = max_capacity !== undefined
        ? (max_capacity !== null ? Number(max_capacity) : null)
        : (existingPool.max_capacity !== null ? Number(existingPool.max_capacity) : null);
      const effectiveUnit = pool_unit
        ? unitConversionService.normalizeUnit(pool_unit)
        : existingPool.pool_unit;
      const parsedIncrement = purchase_increment !== undefined
        ? Number(purchase_increment)
        : Number(existingPool.purchase_increment);

      // Validate quantities
      if (isNaN(parsedTarget) || parsedTarget <= 0 ||
          isNaN(parsedSuppMin) || parsedSuppMin <= 0 ||
          isNaN(parsedBuyerMin) || parsedBuyerMin <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'target_qty, supplier_min_qty, and buyer_min_qty must be positive numbers' }
        });
      }

      if (parsedMaxCap !== null) {
        if (isNaN(parsedMaxCap) || parsedMaxCap <= 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CAPACITY', message: 'max_capacity must be a positive number' }
          });
        }
        if (parsedMaxCap < parsedSuppMin) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CAPACITY', message: 'max_capacity cannot be less than supplier_min_qty' }
          });
        }
        if (parsedTarget > parsedMaxCap) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_TARGET', message: 'target_qty cannot exceed max_capacity' }
          });
        }
      } else if (parsedSuppMin > parsedTarget) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'supplier_min_qty cannot exceed target_qty' }
        });
      }

      // Expiry validation
      let expiresAtDate = existingPool.expires_at ? new Date(existingPool.expires_at) : null;
      if (customExpiresAt) {
        expiresAtDate = new Date(customExpiresAt);
      } else if (duration_days) {
        const days = Number(duration_days);
        if (isNaN(days) || days <= 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_DURATION', message: 'duration_days must be a positive number' }
          });
        }
        expiresAtDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }

      if (expiresAtDate && (isNaN(expiresAtDate.getTime()) || expiresAtDate <= new Date())) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_EXPIRY', message: 'Pool expiration timestamp must be in the future' }
        });
      }

      // Price Tiers Validation
      let updatedTiers = null;
      let initialPrice = Number(existingPool.current_price_per_unit);
      let nextTierPrice = existingPool.next_tier_price !== null ? Number(existingPool.next_tier_price) : null;

      if (price_tiers && Array.isArray(price_tiers)) {
        const tierValidation = tierPricingService.validateTiers(price_tiers, {
          supplier_min_qty: parsedSuppMin,
          target_qty: parsedTarget,
          max_capacity: parsedMaxCap,
          pool_unit: effectiveUnit,
          purchase_increment: parsedIncrement
        });

        if (!tierValidation.valid) {
          return res.status(400).json({
            success: false,
            error: tierValidation.error
          });
        }

        updatedTiers = tierValidation.normalizedTiers;
        initialPrice = updatedTiers[0].price_per_unit;
        nextTierPrice = updatedTiers.length > 1 ? updatedTiers[1].price_per_unit : null;
      }

      // Delivery fields
      const updatePayload = {
        target_qty: parsedTarget,
        supplier_min_qty: parsedSuppMin,
        buyer_min_qty: parsedBuyerMin,
        max_capacity: parsedMaxCap,
        pool_unit: effectiveUnit,
        purchase_increment: parsedIncrement,
        current_price_per_unit: initialPrice,
        next_tier_price: nextTierPrice
      };

      if (expiresAtDate) updatePayload.expires_at = expiresAtDate;
      if (early_close_allowed !== undefined) updatePayload.early_close_allowed = early_close_allowed ? 1 : 0;
      if (quality_spec_grade !== undefined) updatePayload.quality_spec_grade = quality_spec_grade;
      if (delivery_type !== undefined) updatePayload.delivery_type = String(delivery_type).toUpperCase();
      if (delivery_zones !== undefined) updatePayload.delivery_zones = delivery_zones;
      if (delivery_fee_policy !== undefined) updatePayload.delivery_fee_policy = delivery_fee_policy;
      if (fulfilment_lead_time_days !== undefined) updatePayload.fulfilment_lead_time_days = Number(fulfilment_lead_time_days);
      if (cancellation_cutoff_hours !== undefined) updatePayload.cancellation_cutoff_hours = Number(cancellation_cutoff_hours);

      // Perform update atomically
      connection = await db.getConnection();
      await connection.beginTransaction();

      await poolRepo.updatePool(id, updatePayload, connection);

      if (updatedTiers) {
        await poolRepo.replacePriceTiers(id, updatedTiers, connection);
      }

      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, 'SUPPLIER', 'REGULAR_POOL_DRAFT_UPDATED', 'pools', ?, ?, ?)`,
        [supplier_id, id, JSON.stringify(existingPool), JSON.stringify(updatePayload)]
      );

      await connection.commit();
      connection.release();
      connection = null;

      const updatedPool = await poolRepo.findById(id);

      return res.status(200).json({
        success: true,
        message: 'Regular pool draft updated successfully',
        data: { pool: updatedPool }
      });

    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {}
        connection.release();
      }
      console.error('Update Draft Pool Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to update regular pool draft due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/pools/:id/publish  — Supplier publishes DRAFT pool to ACTIVE
  // Atomic inventory allocation committed; commercial terms locked.
  // ---------------------------------------------------------------------------
  async publishPool(req, res) {
    let connection = null;
    try {
      const { id } = req.params;
      const supplier_id = req.user.id;

      connection = await db.getConnection();
      await connection.beginTransaction();

      // 1. Lock and inspect the pool
      const [poolRows] = await connection.query(
        'SELECT * FROM pools WHERE id = ? FOR UPDATE',
        [id]
      );

      if (!poolRows[0]) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          error: { code: 'POOL_NOT_FOUND', message: 'Regular pool not found' }
        });
      }

      const pool = poolRows[0];

      // Check ownership (Admin can override)
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
      if (!isAdmin && Number(pool.supplier_id) !== Number(supplier_id)) {
        await connection.rollback();
        connection.release();
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only publish your own regular pools' }
        });
      }

      // Check state: Only DRAFT pools can be published
      if (pool.status !== 'DRAFT') {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'INVALID_POOL_STATE',
            message: `Cannot publish pool with status '${pool.status}'. Only DRAFT pools can be published.`
          }
        });
      }

      // Check expiry: Must be in the future
      if (new Date(pool.expires_at) <= new Date()) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'POOL_EXPIRED',
            message: 'Pool expiration timestamp is in the past. Update pool expiry before publishing.'
          }
        });
      }

      // 2. Validate Price Tiers completeness for publishing
      const [tiers] = await connection.query(
        'SELECT min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
        [id]
      );

      const tierValidation = tierPricingService.validateTiers(tiers, {
        supplier_min_qty: pool.supplier_min_qty,
        target_qty: pool.target_qty,
        max_capacity: pool.max_capacity,
        pool_unit: pool.pool_unit,
        purchase_increment: pool.purchase_increment
      });

      if (!tierValidation.valid) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'INCOMPLETE_TIER_CONFIGURATION',
            message: `Pool cannot be published: ${tierValidation.error.message}`
          }
        });
      }

      // 3. Lock Supplier Listing and Verify Stock Availability
      const [listingRows] = await connection.query(
        'SELECT * FROM supplier_listings WHERE id = ? FOR UPDATE',
        [pool.supplier_listing_id]
      );

      if (!listingRows[0]) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          error: { code: 'LISTING_NOT_FOUND', message: 'Associated supplier listing not found' }
        });
      }

      const listing = listingRows[0];
      if (listing.status !== 'ACTIVE') {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'INACTIVE_LISTING',
            message: `Supplier listing status is '${listing.status}'. Cannot publish pool for inactive listing.`
          }
        });
      }

      // Fetch specification for unit conversion
      const spec = await productSpecificationRepo.findById(pool.product_spec_id);

      // Determine required stock in listing's pricing unit
      const requiredCapacityUnits = pool.max_capacity !== null ? Number(pool.max_capacity) : Number(pool.target_qty);
      let requiredStockInListingUnits = requiredCapacityUnits;

      const poolUnit = unitConversionService.normalizeUnit(pool.pool_unit);
      const listingUnit = unitConversionService.normalizeUnit(listing.pricing_unit);

      if (poolUnit !== listingUnit) {
        try {
          requiredStockInListingUnits = unitConversionService.convertQuantity(
            requiredCapacityUnits,
            poolUnit,
            listingUnit,
            spec
          );
        } catch (convErr) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: { code: 'UNIT_CONVERSION_ERROR', message: convErr.message }
          });
        }
      }

      // Check current active allocations
      const [allocRows] = await connection.query(
        `SELECT COALESCE(SUM(allocated_qty), 0) AS total_allocated
         FROM supplier_inventory_allocations
         WHERE supplier_listing_id = ? AND status IN ('PENDING', 'COMMITTED')`,
        [pool.supplier_listing_id]
      );
      const activeAllocated = Number(allocRows[0].total_allocated);
      const availableToPromise = Number(listing.available_stock) - activeAllocated;

      if (requiredStockInListingUnits > availableToPromise) {
        await connection.rollback();
        connection.release();
        return res.status(409).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_STOCK_FOR_PUBLISHING',
            message: `Cannot publish pool: insufficient available inventory. Required allocation: ${requiredStockInListingUnits} ${listingUnit}, Available: ${availableToPromise} ${listingUnit}`
          }
        });
      }

      // 4. Commit Inventory Allocation in supplier_inventory_allocations
      await connection.query(
        `INSERT INTO supplier_inventory_allocations
          (supplier_listing_id, allocation_type, reference_id, allocated_qty, unit, status)
         VALUES (?, 'REGULAR_POOL', ?, ?, ?, 'COMMITTED')`,
        [pool.supplier_listing_id, id, requiredStockInListingUnits, listingUnit]
      );

      // 5. Update Pool Status to ACTIVE
      await connection.query(
        `UPDATE pools
         SET status = 'ACTIVE', updated_at = NOW()
         WHERE id = ?`,
        [id]
      );

      // 6. Record System Audit Log
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, 'SUPPLIER', 'REGULAR_POOL_PUBLISHED', 'pools', ?, ?, ?)`,
        [
          supplier_id,
          id,
          JSON.stringify({ status: 'DRAFT' }),
          JSON.stringify({
            status: 'ACTIVE',
            allocated_qty: requiredStockInListingUnits,
            allocation_unit: listingUnit,
            idempotency_key: req.idempotency ? req.idempotency.key : null
          })
        ]
      );

      // Atomically link idempotency record to published pool entity within the transaction
      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('pools', id, connection);
      }

      await connection.commit();
      connection.release();
      connection = null;

      const publishedPool = await poolRepo.findById(id);

      return res.status(200).json({
        success: true,
        message: 'Regular pool published successfully. Commercial terms are locked and inventory is allocated.',
        data: {
          pool: publishedPool,
          inventory_allocation: {
            allocated_qty: requiredStockInListingUnits,
            allocation_unit: listingUnit,
            status: 'COMMITTED'
          }
        }
      });

    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {}
        connection.release();
      }
      console.error('Publish Pool Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to publish regular pool due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools  — Public: All active pools (DRAFT strictly excluded)
  // ---------------------------------------------------------------------------
  async getActivePools(req, res) {
    try {
      const { category, min_price, max_price } = req.query;
      const rawPools = await poolRepo.findAllActive({ category, min_price, max_price });
      const pools = await poolProgressService.enrichPoolsList(rawPools);
      return res.status(200).json({
        success: true,
        count: pools.length,
        data: { pools }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools/:id  — Public: Single pool details
  // ---------------------------------------------------------------------------
  async getPoolById(req, res) {
    try {
      const poolSnapshot = await poolProgressService.getPoolSnapshot(req.params.id);
      if (!poolSnapshot) {
        const rawPool = await poolRepo.findById(req.params.id);
        if (!rawPool) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pool not found' } });
        }
        return res.status(200).json({ success: true, data: { pool: rawPool } });
      }
      return res.status(200).json({ success: true, data: { pool: poolSnapshot } });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools/supplier/my  — Supplier: View own pools (DRAFT, ACTIVE, etc.)
  // ---------------------------------------------------------------------------
  async getMyPools(req, res) {
    try {
      const pools = await poolRepo.findBySupplier(req.user.id);
      return res.status(200).json({ success: true, count: pools.length, data: { pools } });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // PUT /api/v1/pools/:id/confirm  — OBS-59: Legacy Confirmation Decommissioned
  // The obsolete confirmation bypass is fail-closed. Authoritative supplier confirmation
  // decision workflow is scheduled for Part 4D.3.
  // ---------------------------------------------------------------------------
  async confirmPool(req, res) {
    const { id } = req.params;
    const poolId = parseInt(id, 10);
    if (!poolId || isNaN(poolId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ID', message: 'Valid pool ID is required' }
      });
    }

    return res.status(410).json({
      success: false,
      error: {
        code: 'LEGACY_OPERATION_RETIRED',
        message: 'Direct pool confirmation via legacy endpoint has been retired. The authoritative supplier confirmation workflow with qualification snapshot binding will be available in Part 4D.3.'
      }
    });
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // PUT /api/v1/pools/:id/cancel  — Supplier or Admin cancels pool (OBS-60 Hardened)
  // Path A: Safe pre-publication cancellation for DRAFT pools without allocations.
  // Path B: Published/protected pools with committed inventory or buyer obligations
  //         cannot be destructively cancelled through legacy route (admin cannot bypass).
  // ---------------------------------------------------------------------------
  async cancelPool(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};
      const actor_id = req.user.id;
      const actor_role = req.user.role;

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Lock parent pool row FIRST
        const [pools] = await connection.query('SELECT * FROM pools WHERE id = ? FOR UPDATE', [id]);
        if (!pools[0]) {
          await connection.rollback(); connection.release();
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pool not found' } });
        }

        const pool = pools[0];

        // 2. Ownership & Role check: Admin or owning supplier only
        const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(actor_role);
        if (!isAdmin && Number(pool.supplier_id) !== Number(actor_id)) {
          await connection.rollback(); connection.release();
          return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only cancel your own pools' } });
        }

        // 3. Status validation: ONLY DRAFT or ACTIVE pools may ever be considered for cancellation
        if (!['DRAFT', 'ACTIVE'].includes(pool.status)) {
          await connection.rollback(); connection.release();
          return res.status(422).json({
            success: false,
            error: {
              code: 'PROTECTED_POOL_CANCELLATION_BLOCKED',
              message: `Cannot cancel a pool with commercial status: ${pool.status}. Pools in '${pool.status}' have entered or completed commercial lifecycle and cannot be cancelled through legacy endpoints.`
            }
          });
        }

        // 4. Commercial Protection Check (OBS-65):
        // Verify no commercial snapshots exist for this pool
        const [snapRows] = await connection.query(
          "SELECT id, status, qualification_status FROM pool_commercial_snapshots WHERE pool_id = ?",
          [id]
        );
        if (snapRows.length > 0) {
          await connection.rollback(); connection.release();
          return res.status(422).json({
            success: false,
            error: {
              code: 'PROTECTED_POOL_CANCELLATION_BLOCKED',
              message: `Cannot cancel pool: Authoritative commercial qualification snapshot(s) exist. Formal commercial settlement required.`
            }
          });
        }

        // 5. Check for committed inventory allocations
        const [allocRows] = await connection.query(
          "SELECT * FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL' AND status = 'COMMITTED'",
          [id]
        );
        const hasCommittedAllocation = allocRows.length > 0;

        // 6. Check for existing buyer reservations of any status
        const [resRows] = await connection.query(
          "SELECT COUNT(*) AS total_count, " +
          "SUM(CASE WHEN status IN ('RESERVED', 'CONFIRMED', 'PAID') THEN 1 ELSE 0 END) AS active_count, " +
          "SUM(CASE WHEN status NOT IN ('RESERVED', 'CONFIRMED', 'PAID', 'CANCELLED', 'EXPIRED') THEN 1 ELSE 0 END) AS unknown_count " +
          "FROM reservations WHERE pool_id = ?",
          [id]
        );
        const activeResCount = Number(resRows[0].active_count || 0);
        const totalResCount = Number(resRows[0].total_count || 0);
        const unknownResCount = Number(resRows[0].unknown_count || 0);

        // PATH A: Safe pre-buyer cancellation (Zero buyer reservations of any status and status in DRAFT/ACTIVE)
        // If pool is DRAFT or ACTIVE with 0 reservations and 0 snapshots, cancellation can proceed safely.
        // If an inventory allocation exists, it is transitioned cleanly to RELEASED.
        if (totalResCount === 0 && unknownResCount === 0) {
          if (hasCommittedAllocation) {
            await connection.query(
              "UPDATE supplier_inventory_allocations SET status = 'RELEASED', updated_at = NOW() WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'",
              [id]
            );
          }

          await connection.query(
            "UPDATE pools SET status = 'CANCELLED', closed_at = NOW(), supplier_confirmation_notes = ?, updated_at = NOW() WHERE id = ?",
            [reason || 'Cancelled with zero buyer obligations', id]
          );

          await connection.query(
            `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
             VALUES (?, ?, 'REGULAR_POOL_CANCELLED', 'pools', ?, ?, ?)`,
            [
              actor_id,
              actor_role,
              id,
              JSON.stringify({ status: pool.status }),
              JSON.stringify({
                status: 'CANCELLED',
                released_allocation: hasCommittedAllocation,
                reason: reason || 'Cancelled with zero buyer obligations'
              })
            ]
          );

          await connection.commit();
          connection.release();

          return res.status(200).json({
            success: true,
            message: 'Pool cancelled successfully and any committed inventory released.',
            data: { pool_id: parseInt(id, 10), status: 'CANCELLED' }
          });
        }

        // PATH B: Protected Pool with Buyer Reservations
        // Cancellation is strictly blocked to protect buyer demand and prevent uncoordinated mass-cancellation.
        await connection.rollback();
        connection.release();

        let blockReason = activeResCount > 0 || totalResCount > 0 ? 'RESERVED_POOL_CANCELLATION_BLOCKED' : 'PROTECTED_POOL_CANCELLATION_BLOCKED';
        let blockMessage = 'Cannot cancel published pool through legacy endpoint. ';
        if (activeResCount > 0) {
          blockMessage += `${activeResCount} active buyer reservation(s) exist. `;
        }
        if (hasCommittedAllocation) {
          blockMessage += 'Committed supplier inventory allocation exists. ';
        }
        if (unknownResCount > 0) {
          blockMessage += 'Reservations with unknown commercial obligations exist. ';
        }
        blockMessage += 'Commercial settlement, buyer notification, and formal inventory de-allocation workflow is required.';

        return res.status(422).json({
          success: false,
          error: {
            code: blockReason,
            message: blockMessage,
            details: {
              pool_status: pool.status,
              active_reservations: activeResCount,
              has_committed_allocation: hasCommittedAllocation
            }
          }
        });

      } catch (err) {
        await connection.rollback(); connection.release();
        throw err;
      }
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools/:id/supplier/summary — Supplier views reservation summary
  // Enforces ownership (or Admin) and excludes all buyer PII (Part 4C.2B)
  // ---------------------------------------------------------------------------
  async getSupplierReservationSummary(req, res) {
    try {
      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Valid pool ID is required' } });
      }

      const pool = await poolRepo.findById(poolId);
      if (!pool) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pool not found' } });
      }

      // Authorization guard: Admin or pool owner only
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
      if (!isAdmin && Number(pool.supplier_id) !== Number(req.user.id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied: You do not own this pool' }
        });
      }

      // Fetch unified pool progress snapshot
      const poolSnapshot = await poolProgressService.getPoolSnapshot(poolId);

      // Status breakdown without exposing individual buyers or reservation IDs
      const [breakdownRows] = await db.query(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity
         FROM reservations
         WHERE pool_id = ?
         GROUP BY status`,
        [poolId]
      );

      const statusBreakdown = {
        RESERVED: { count: 0, quantity: 0 },
        CONFIRMED: { count: 0, quantity: 0 },
        PAID: { count: 0, quantity: 0 },
        CANCELLED: { count: 0, quantity: 0 },
        EXPIRED: { count: 0, quantity: 0 }
      };

      for (const row of breakdownRows) {
        statusBreakdown[row.status] = {
          count: Number(row.count),
          quantity: Number(Number(row.quantity).toFixed(4))
        };
      }

      const [distinctBuyers] = await db.query(
        `SELECT COUNT(DISTINCT buyer_id) AS buyer_count
         FROM reservations
         WHERE pool_id = ? AND status IN ('RESERVED', 'CONFIRMED', 'PAID')`,
        [poolId]
      );
      const buyerCount = Number(distinctBuyers[0].buyer_count || 0);

      const summary = {
        pool: {
          id: pool.id,
          pool_code: pool.pool_code,
          status: pool.status,
          pool_unit: pool.pool_unit,
          expires_at: pool.expires_at,
          supplier_min_qty: Number(pool.supplier_min_qty),
          target_qty: Number(pool.target_qty),
          max_capacity: pool.max_capacity !== null ? Number(pool.max_capacity) : Number(pool.target_qty)
        },
        specification: poolSnapshot ? {
          id: poolSnapshot.specification.id,
          product_title: poolSnapshot.specification.product_title,
          category: poolSnapshot.specification.category,
          quality_grade: poolSnapshot.specification.quality_grade,
          canonical_spec_hash: poolSnapshot.specification.canonical_spec_hash
        } : null,
        demand_summary: {
          total_reserved_quantity: poolSnapshot ? poolSnapshot.current_qty : 0,
          active_reservation_count: buyerCount,
          remaining_capacity: poolSnapshot ? poolSnapshot.remaining_capacity : 0,
          supplier_min_met: poolSnapshot ? poolSnapshot.minimum_reached : false,
          target_met: poolSnapshot ? poolSnapshot.target_reached : false,
          progress_toward_supplier_min_pct: poolSnapshot ? poolSnapshot.minimum_progress_percent : 0,
          progress_toward_target_pct: poolSnapshot ? poolSnapshot.target_progress_percent : 0,
          status_breakdown: statusBreakdown
        },
        pricing_summary: {
          current_price_per_unit: poolSnapshot ? poolSnapshot.current_price_per_unit : null,
          current_tier_index: poolSnapshot ? poolSnapshot.current_tier_index : null,
          pricing_mode: poolSnapshot ? poolSnapshot.pricing_mode : 'ESTIMATED_PRE_MINIMUM',
          is_conditional_pricing: poolSnapshot ? poolSnapshot.is_conditional_pricing : true,
          next_tier: poolSnapshot && poolSnapshot.next_tier_quantity ? {
            min_qty: poolSnapshot.next_tier_quantity,
            price_per_unit: poolSnapshot.next_tier_price,
            additional_qty_needed: poolSnapshot.additional_quantity_for_next_tier
          } : null
        }
      };

      return res.status(200).json({
        success: true,
        data: summary
      });
    } catch (error) {
      console.error('getSupplierReservationSummary Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/pools/:id/qualify — Authoritative Commercial Pool Qualification (Part 4D.2)
  // Evaluates pool demand at or after participation deadline.
  // Advances to AWAITING_SUPPLIER_CONFIRMATION if qualified, or EXPIRED if unqualified.
  // ---------------------------------------------------------------------------
  async qualifyPool(req, res) {
    try {
      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric pool ID is required' }
        });
      }

      const idempotencyKey = req.headers['x-idempotency-key'] || null;
      const { CommercialLifecycleService } = require('../services/commercialLifecycleService');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId,
        actor: {
          id: req.user.id,
          role: req.user.role
        },
        idempotencyKey
      });

      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('pools', poolId);
      }

      return res.status(200).json(outcome);

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'QUALIFICATION_ERROR',
            message: error.message,
            details: error.details || undefined
          }
        });
      }
      console.error('qualifyPool Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to qualify pool due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/pools/:id/supplier-decision — Authoritative Supplier Commercial Decision (Part 4D.3)
  // Allows verified owning supplier to ACCEPT or REJECT a qualified pool's offer.
  // Enforces immutable decision evidence, strict idempotency, fresh deadline checking.
  // ---------------------------------------------------------------------------
  async recordSupplierDecision(req, res) {
    try {
      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric pool ID is required' }
        });
      }

      const { decision, qualification_snapshot_id, rejection_reason_code, rejection_reason_notes } = req.body || {};
      const idempotencyKey = req.headers['x-idempotency-key'] || null;

      const { CommercialLifecycleService } = require('../services/commercialLifecycleService');

      const outcome = await CommercialLifecycleService.recordSupplierDecision({
        poolId,
        actor: {
          id: req.user.id,
          role: req.user.role
        },
        decision,
        qualificationSnapshotId: qualification_snapshot_id,
        rejectionReasonCode: rejection_reason_code,
        rejectionReasonNotes: rejection_reason_notes,
        idempotencyKey
      });

      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('pools', poolId);
      }

      return res.status(200).json(outcome);

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'DECISION_ERROR',
            message: error.message,
            details: error.details || undefined
          }
        });
      }
      console.error('recordSupplierDecision Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to record supplier decision due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools/:id/supplier-decision — Authorized Decision Status Read Model (Part 4D.3)
  // Returns sanitized commercial outcome to authorized parties (Admin, Owner Supplier, Participating Buyers).
  // ---------------------------------------------------------------------------
  async getSupplierDecisionStatus(req, res) {
    try {
      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric pool ID is required' }
        });
      }

      const { CommercialLifecycleService } = require('../services/commercialLifecycleService');

      const statusData = await CommercialLifecycleService.getPoolDecisionStatus(poolId, {
        id: req.user.id,
        role: req.user.role
      });

      return res.status(200).json({
        success: true,
        data: statusData
      });

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'READ_ERROR',
            message: error.message
          }
        });
      }
      console.error('getSupplierDecisionStatus Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch supplier decision status' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools/:id/committed-demand-summary — Authoritative Demand Accounting (Part 4D.4)
  // Returns post-qualification buyer acceptance/decline demand accounting and quorum status.
  // ---------------------------------------------------------------------------
  async getCommittedDemandSummary(req, res) {
    try {
      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric pool ID is required' }
        });
      }

      const { CommercialLifecycleService } = require('../services/commercialLifecycleService');
      const summary = await CommercialLifecycleService.getPoolCommittedDemandSummary(poolId);

      return res.status(200).json({
        success: true,
        data: summary
      });

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'SUMMARY_ERROR',
            message: error.message
          }
        });
      }
      console.error('getCommittedDemandSummary Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch committed demand summary' }
      });
    }
  }
}

module.exports = new PoolController();