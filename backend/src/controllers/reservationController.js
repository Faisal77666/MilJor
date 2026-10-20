// =============================================================================
// src/controllers/reservationController.js
// NEW: confirmReservation, cancelReservation
// Uses reservationRepo which has the full transactional logic
// =============================================================================
const reservationRepo = require('../repositories/reservationRepo');
const db = require('../config/db');
const reservationDemandPolicy = require('../services/reservationDemandPolicy');
const supplierEligibilityPolicy = require('../services/supplierEligibilityPolicy');
const reservationEventService = require('../services/reservationEventService');
const poolProgressService = require('../services/poolProgressService');

class ReservationController {

  // ---------------------------------------------------------------------------
  // POST /api/v1/reservations  — Buyer reserves a quantity in an ACTIVE pool
  // Atomic row locking (FOR UPDATE), capacity control, tier calculation,
  // idempotency linkage, and structured transparency response.
  // ---------------------------------------------------------------------------
  async createReservation(req, res) {
    let connection = null;
    try {
      const buyer_id = req.user.id;
      const { pool_id, quantity } = req.body;

      // 1. Role Authorization Guard: Only buyers can create reservations
      if (req.user.role !== 'BUYER') {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied: Only buyers can create pool reservations' }
        });
      }

      // 2. Basic Input Validation
      if (!pool_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'pool_id is required' }
        });
      }

      const parsedPoolId = parseInt(pool_id);
      const requestedQty = Number(quantity);

      if (isNaN(requestedQty) || requestedQty <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'quantity must be a positive number' }
        });
      }

      // 3. Obtain dedicated connection and begin atomic transaction
      connection = await db.getConnection();
      await connection.beginTransaction();

      // 4. Lock pool row FOR UPDATE (Primary serialization point for all pool reservations)
      const [poolRows] = await connection.query(
        `SELECT p.*, (p.expires_at <= NOW()) AS is_expired,
                pr.title AS product_title, pr.category AS product_category, pr.unit AS product_unit,
                ps.id AS spec_id, ps.quality_grade, ps.spec_hash AS canonical_spec_hash,
                sl.id AS listing_id, sl.status AS listing_status, sl.supplier_id AS listing_supplier_id, sl.product_spec_id AS listing_spec_id,
                u.id AS supp_id, u.role AS supplier_role, u.is_verified AS supplier_is_verified,
                u.verification_status AS supplier_user_verification,
                u.business_name AS supplier_business_name,
                sp.id AS profile_id, sp.verification_status AS supplier_profile_verification,
                sp.verification_level AS supplier_verification_level
         FROM pools p
         JOIN products pr ON p.product_id = pr.id
         LEFT JOIN product_specifications ps ON p.product_spec_id = ps.id
         LEFT JOIN supplier_listings sl ON p.supplier_listing_id = sl.id
         JOIN users u ON p.supplier_id = u.id
         LEFT JOIN supplier_profiles sp ON sp.supplier_id = u.id
         WHERE p.id = ? FOR UPDATE`,
        [parsedPoolId]
      );

      if (!poolRows[0]) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          error: { code: 'POOL_NOT_FOUND', message: 'Pool not found' }
        });
      }

      const pool = poolRows[0];

      // OBS-24: Historical/Legacy Pools Protection
      // Historical pools without exact specifications/listings are strictly read-only for new commercial reservations.
      if (!pool.product_spec_id || !pool.supplier_listing_id) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'LEGACY_POOL_READ_ONLY',
            message: 'This historical pool lacks verified product specification identity and is closed to new buyer reservations.'
          }
        });
      }

      // 4. Validate Pool State and Expiry (OBS-22: Single Authoritative DB Server Time in UTC)
      if (pool.status !== 'ACTIVE') {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'POOL_NOT_ACTIVE',
            message: `Pool is currently '${pool.status}' and is not accepting reservations`
          }
        });
      }

      // Authoritative evaluation evaluated within the locked transaction (OBS-46 fresh post-lock revalidation)
      const [freshExpiryRows] = await connection.query(
        'SELECT (expires_at <= NOW()) AS is_freshly_expired FROM pools WHERE id = ?',
        [parsedPoolId]
      );
      const isPoolExpired = Boolean(pool.is_expired) || Boolean(freshExpiryRows[0] && freshExpiryRows[0].is_freshly_expired);
      if (isPoolExpired) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'POOL_EXPIRED',
            message: 'This pool has passed its expiration deadline and is closed to new reservations'
          }
        });
      }

      // OBS-21: Positive Supplier Verification and Account Eligibility
      // Requires: supplier account exists, has SUPPLIER role, is_verified=1, verification_status='VERIFIED',
      // profile exists with verification_status='VERIFIED'. (buyer_trust_status is strictly ignored for suppliers).
      const isSupplierEligible = (
        pool.supp_id &&
        pool.supplier_role === 'SUPPLIER' &&
        pool.supplier_user_verification !== 'BLOCKED' &&
        Number(pool.supplier_is_verified) === 1 &&
        pool.supplier_user_verification === 'VERIFIED' &&
        pool.profile_id &&
        pool.supplier_profile_verification === 'VERIFIED'
      );

      if (!isSupplierEligible) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'SUPPLIER_INELIGIBLE',
            message: 'Pool supplier account or business verification is inactive or unapproved. Cannot accept new reservations.'
          }
        });
      }

      // Listing and Specification Integrity
      if (!pool.listing_id || pool.listing_status !== 'ACTIVE') {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'LISTING_INACTIVE',
            message: `Associated supplier listing is ${pool.listing_status || 'not found'}. Cannot accept new reservations.`
          }
        });
      }

      if (Number(pool.listing_supplier_id) !== Number(pool.supplier_id) ||
          Number(pool.listing_spec_id) !== Number(pool.product_spec_id)) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'SPECIFICATION_MISMATCH',
            message: 'Pool specification or supplier does not match the underlying supplier listing.'
          }
        });
      }

      // 5. Anti-Self-Dealing Guard: Buyer cannot join their own supplier pool
      if (Number(pool.supplier_id) === Number(buyer_id)) {
        await connection.rollback();
        connection.release();
        return res.status(403).json({
          success: false,
          error: {
            code: 'SELF_PURCHASE_PROHIBITED',
            message: 'Suppliers are strictly prohibited from reserving quantity in their own pools'
          }
        });
      }

      // 6. Indivisible Packaging & Increment Validations
      const unitConversionService = require('../services/unitConversionService');
      const isDiscrete = unitConversionService.isDiscreteUnit(pool.pool_unit);
      if (isDiscrete && !Number.isInteger(requestedQty)) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'FRACTIONAL_PACK_REJECTED',
            message: `Packaging unit '${pool.pool_unit}' is indivisible and does not allow fractional quantities`
          }
        });
      }

      // Buyer Minimum Quantity
      const buyerMinQty = Number(pool.buyer_min_qty);
      if (requestedQty < buyerMinQty) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'BUYER_MIN_QTY_NOT_MET',
            message: `Requested quantity (${requestedQty} ${pool.pool_unit}) is below pool minimum order quantity (${buyerMinQty} ${pool.pool_unit})`
          }
        });
      }

      // Purchase Increment Check
      const purchaseIncrement = Number(pool.purchase_increment) || 1.0;
      const remainder = ((requestedQty - buyerMinQty) % purchaseIncrement);
      if (Math.abs(remainder) > 0.0001 && Math.abs(remainder - purchaseIncrement) > 0.0001) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PURCHASE_INCREMENT',
            message: `Requested quantity must advance in increments of ${purchaseIncrement} ${pool.pool_unit} above minimum (${buyerMinQty})`
          }
        });
      }

      // 7. Step 6: Enforce One Active Reservation Per Buyer Per Pool (OBS-25: Fail-closed non-terminal check)
      const [existingRes] = await connection.query(
        `SELECT id, reservation_code, quantity, status, unit_price FROM reservations 
         WHERE pool_id = ? AND buyer_id = ? AND status NOT IN ('CANCELLED', 'EXPIRED')`,
        [parsedPoolId, buyer_id]
      );
      if (existingRes.length > 0) {
        await connection.rollback();
        connection.release();
        return res.status(409).json({
          success: false,
          error: {
            code: 'ACTIVE_RESERVATION_EXISTS',
            message: 'You already have an active reservation in this pool. Quantity modifications and cancellations will be available in Part 4C.',
            existing_reservation: {
              id: existingRes[0].id,
              reservation_code: existingRes[0].reservation_code,
              quantity: Number(existingRes[0].quantity),
              status: existingRes[0].status
            }
          }
        });
      }

      // 8. Authoritative Aggregate Demand and Capacity Check (OBS-33)
      // Primary serialization is already enforced by the parent pool row lock (FOR UPDATE).
      const [aggRows] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS aggregate_qty
         FROM reservations
         WHERE pool_id = ? AND status IN ('RESERVED', 'CONFIRMED', 'PAID')`,
        [parsedPoolId]
      );
      const [unknownRows] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS unknown_qty
         FROM reservations
         WHERE pool_id = ? AND status NOT IN ('RESERVED', 'CONFIRMED', 'PAID', 'CANCELLED', 'EXPIRED')`,
        [parsedPoolId]
      );
      const unknownDemand = Number(unknownRows[0].unknown_qty || 0);
      const currentAggregateQty = Number((Number(aggRows[0].aggregate_qty) + unknownDemand).toFixed(4));
      const maxCap = pool.max_capacity !== null ? Number(pool.max_capacity) : null;
      const targetQty = Number(pool.target_qty);
      const suppMinQty = Number(pool.supplier_min_qty);
      const effectiveCap = maxCap !== null ? maxCap : targetQty;
      const remainingCap = Number((effectiveCap - currentAggregateQty).toFixed(4));

      if (requestedQty > remainingCap) {
        await connection.rollback();
        connection.release();
        return res.status(409).json({
          success: false,
          error: {
            code: 'CAPACITY_EXCEEDED',
            message: `Requested quantity (${requestedQty} ${pool.pool_unit}) exceeds remaining pool capacity (${remainingCap} ${pool.pool_unit}).`
          }
        });
      }

      // 9. New Aggregate Demand & Price Tier Evaluation
      const newAggregateQty = Number((currentAggregateQty + requestedQty).toFixed(4));

      const [tiers] = await connection.query(
        'SELECT id, min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
        [parsedPoolId]
      );

      const tierPricingService = require('../services/tierPricingService');
      const pricingEval = tierPricingService.calculateApplicablePrice(tiers, newAggregateQty, suppMinQty);
      const estimatedUnitPrice = pricingEval.price;
      const estimatedSubtotal = Number((requestedQty * estimatedUnitPrice).toFixed(2));

      // 10. Insert Reservation
      const reservation_code = 'MJ-RES-' + Math.floor(100000 + Math.random() * 900000);
      const [resResult] = await connection.query(
        `INSERT INTO reservations 
          (reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'RESERVED', NOW(), NOW())`,
        [reservation_code, parsedPoolId, buyer_id, requestedQty, estimatedUnitPrice, estimatedSubtotal]
      );
      const reservationId = resResult.insertId;

      // 11. Update Pool Current Aggregate Quantity & Prices
      const nextTierPrice = pricingEval.nextTier ? Number(pricingEval.nextTier.price_per_unit) : null;
      await connection.query(
        `UPDATE pools
         SET current_qty = ?, current_price_per_unit = ?, next_tier_price = ?, updated_at = NOW()
         WHERE id = ?`,
        [newAggregateQty, estimatedUnitPrice, nextTierPrice, parsedPoolId]
      );

      // 12. Retroactive repricing for other active RESERVED reservations in the pool
      // OBS-18: ONLY reprice reservations in 'RESERVED' status with locked_unit_price IS NULL.
      // Never overwrite locked_unit_price, locked_total_price, CONFIRMED, or PAID reservations!
      if (estimatedUnitPrice < Number(pool.current_price_per_unit)) {
        await connection.query(
          `UPDATE reservations
           SET unit_price = ?, total_price = ROUND(quantity * ?, 2), updated_at = NOW()
           WHERE pool_id = ? AND status = 'RESERVED' AND locked_unit_price IS NULL AND id != ?`,
          [estimatedUnitPrice, estimatedUnitPrice, parsedPoolId, reservationId]
        );
      }

      // 13. System Audit Log within transaction
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'BUYER', 'RESERVATION_CREATED', 'reservations', ?, ?)`,
        [
          buyer_id,
          reservationId,
          JSON.stringify({
            pool_id: parsedPoolId,
            pool_code: pool.pool_code,
            quantity: requestedQty,
            unit_price: estimatedUnitPrice,
            total_price: estimatedSubtotal,
            idempotency_key: req.idempotency ? req.idempotency.key : null
          })
        ]
      );

      // 14. Transactionally link idempotency record to created reservation
      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('reservations', reservationId, connection);
      }

      // 14b. Record durable business events (Part 4C.2B)
      const prevTierEval = tierPricingService.calculateApplicablePrice(tiers, currentAggregateQty, suppMinQty);
      await reservationEventService.recordReservationMutationEvents({
        connection,
        poolId: parsedPoolId,
        reservationId,
        buyerId: buyer_id,
        mutationType: 'CREATE',
        previousQty: 0,
        newQty: requestedQty,
        previousUnitPrice: Number(pool.current_price_per_unit || 0),
        newUnitPrice: estimatedUnitPrice,
        previousAggregateQty: currentAggregateQty,
        newAggregateQty,
        supplierMinQty: suppMinQty,
        targetQty,
        previousTierIndex: currentAggregateQty > 0 ? prevTierEval.tierIndex : null,
        newTierIndex: pricingEval.tierIndex,
        idempotencyKey: req.idempotency ? req.idempotency.key : null,
        metadata: {
          pool_code: pool.pool_code,
          reservation_code
        }
      });

      await connection.commit();
      connection.release();
      connection = null;

      // 15. Formulate Transparent B2B Response
      const remainingCapacityAfter = Math.max(0, Number((effectiveCap - newAggregateQty).toFixed(4)));

      return res.status(201).json({
        success: true,
        message: 'Quantity reserved successfully in pool',
        data: {
          reservation: {
            id: reservationId,
            reservation_code,
            pool_id: parsedPoolId,
            pool_code: pool.pool_code,
            buyer_id,
            quantity: requestedQty,
            unit_price: estimatedUnitPrice,
            total_price: estimatedSubtotal,
            status: 'RESERVED',
            created_at: new Date()
          },
          pool: {
            id: parsedPoolId,
            pool_code: pool.pool_code,
            status: pool.status,
            pool_unit: pool.pool_unit,
            expires_at: pool.expires_at,
            cancellation_terms: 'Buyer cancellation permitted while pool is open (RESERVED state). Once pool qualifies and supplier confirms, commitment and price lock apply.'
          },
          specification: {
            id: pool.spec_id,
            product_title: pool.product_title,
            category: pool.product_category,
            quality_grade: pool.quality_grade,
            canonical_spec_hash: pool.canonical_spec_hash
          },
          supplier: {
            id: pool.supp_id,
            business_name: pool.supplier_business_name,
            verification_status: pool.supplier_verification_status
          },
          aggregate_progress: {
            current_aggregate_qty: newAggregateQty,
            remaining_pool_capacity: remainingCapacityAfter,
            supplier_min_qty: suppMinQty,
            target_qty: targetQty,
            max_capacity: maxCap,
            progress_toward_supplier_min_pct: Number(Math.min(100, (newAggregateQty / suppMinQty) * 100).toFixed(1)),
            progress_toward_target_pct: Number(Math.min(100, (newAggregateQty / targetQty) * 100).toFixed(1)),
            supplier_min_met: newAggregateQty >= suppMinQty,
            target_met: newAggregateQty >= targetQty
          },
          pricing: {
            estimated_unit_price: estimatedUnitPrice,
            estimated_subtotal: estimatedSubtotal,
            pricing_mode: newAggregateQty >= suppMinQty ? 'ESTIMATED_TIER_CONFIRMABLE' : 'ESTIMATED_PRE_MINIMUM',
            current_tier_index: pricingEval.tierIndex,
            next_tier: pricingEval.nextTier ? {
              min_qty: Number(pricingEval.nextTier.min_qty),
              max_qty: Number(pricingEval.nextTier.max_qty),
              price_per_unit: Number(pricingEval.nextTier.price_per_unit),
              additional_qty_needed: Number(Math.max(0, Number(pricingEval.nextTier.min_qty) - newAggregateQty).toFixed(4))
            } : null
          }
        }
      });

    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {}
        connection.release();
      }

      if (error.code === 'ER_DUP_ENTRY' && (error.sqlMessage || '').includes('idx_unique_active_pool_buyer')) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'ACTIVE_RESERVATION_EXISTS',
            message: 'You already have an active reservation in this pool. Quantity modifications and cancellations will be available in Part 4C.'
          }
        });
      }

      console.error('Create Reservation Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to create reservation due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // PATCH /api/v1/reservations/:id — Buyer updates reservation quantity
  // ---------------------------------------------------------------------------
  async updateReservationQuantity(req, res) {
    let connection;
    try {
      const buyer_id = req.user.id;
      const reservationId = parseInt(req.params.id, 10);
      const { quantity } = req.body;

      if (!reservationId || isNaN(reservationId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Valid numeric reservation ID is required in URL parameter' }
        });
      }

      // 1. Validate requested quantity format
      const requestedQty = parseFloat(quantity);
      if (isNaN(requestedQty) || requestedQty <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'Quantity must be a positive number' }
        });
      }

      // Check for illegal client-supplied overrides
      const forbiddenOverrides = [
        'buyer_id', 'supplier_id', 'pool_id', 'price', 'unit_price', 'total_price',
        'discount_tier', 'status', 'locked_unit_price', 'locked_total_price',
        'inventory_allocation', 'financial_totals'
      ];
      for (const field of forbiddenOverrides) {
        if (req.body[field] !== undefined) {
          return res.status(400).json({
            success: false,
            error: { code: 'ILLEGAL_PARAMETER', message: `Client-supplied parameter '${field}' is strictly prohibited` }
          });
        }
      }

      // 2. Pre-check reservation existence and ownership before starting transaction
      const [preRows] = await db.query(
        'SELECT pool_id, buyer_id, status FROM reservations WHERE id = ?',
        [reservationId]
      );
      if (!preRows || preRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'RESERVATION_NOT_FOUND', message: 'Reservation not found' }
        });
      }

      const preRes = preRows[0];
      if (Number(preRes.buyer_id) !== Number(buyer_id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not own this reservation' }
        });
      }

      const poolId = preRes.pool_id;

      // 3. Begin dedicated MySQL transaction
      connection = await db.getConnection();
      await connection.beginTransaction();

      // Lock parent pool row FIRST (Strict lock hierarchy to prevent deadlocks)
      const [poolRows] = await connection.query(
        `SELECT p.*, 
                (p.expires_at <= NOW()) AS is_expired,
                u.id AS supplier_user_id,
                u.role AS supplier_role,
                u.is_verified AS supplier_is_verified,
                u.verification_status AS supplier_user_verification,
                sp.verification_status AS supplier_profile_verification,
                sl.id AS listing_id,
                sl.supplier_id AS listing_supplier_id,
                sl.product_spec_id AS listing_spec_id,
                sl.status AS listing_status
         FROM pools p
         JOIN users u ON p.supplier_id = u.id
         LEFT JOIN supplier_profiles sp ON sp.supplier_id = u.id
         LEFT JOIN supplier_listings sl ON p.supplier_listing_id = sl.id
         WHERE p.id = ? FOR UPDATE`,
        [poolId]
      );

      if (!poolRows || poolRows.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          error: { code: 'POOL_NOT_FOUND', message: 'Associated pool not found' }
        });
      }

      const pool = poolRows[0];

      // Lock target reservation row SECOND
      const [lockedResRows] = await connection.query(
        `SELECT r.*,
                pr.title AS product_title, pr.category AS product_category,
                ps.id AS spec_id, ps.quality_grade, ps.spec_hash AS canonical_spec_hash,
                u.business_name AS supplier_business_name, u.verification_status AS supplier_verification_status
         FROM reservations r
         JOIN pools p ON r.pool_id = p.id
         JOIN products pr ON p.product_id = pr.id
         LEFT JOIN product_specifications ps ON p.product_spec_id = ps.id
         JOIN users u ON p.supplier_id = u.id
         WHERE r.id = ? FOR UPDATE`,
        [reservationId]
      );

      if (!lockedResRows || lockedResRows.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          error: { code: 'RESERVATION_NOT_FOUND', message: 'Reservation not found' }
        });
      }

      const targetReservation = lockedResRows[0];

      // Revalidate ownership under lock
      if (Number(targetReservation.buyer_id) !== Number(buyer_id)) {
        await connection.rollback();
        connection.release();
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not own this reservation' }
        });
      }

      // Check legacy pool read-only policy (OBS-24)
      if (!pool.product_spec_id || !pool.supplier_listing_id) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'LEGACY_POOL_READ_ONLY',
            message: 'Historical legacy pool lacks verified product specification identity and is read-only.'
          }
        });
      }

      // Pool active & temporal boundary validation (OBS-22: DB UTC Server Time)
      if (pool.status !== 'ACTIVE') {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'POOL_NOT_ACTIVE',
            message: `Pool is currently '${pool.status}' and cannot accept quantity updates`
          }
        });
      }

      // Authoritative evaluation evaluated within the locked transaction (OBS-46 fresh post-lock revalidation)
      const [freshExpiryRows] = await connection.query(
        'SELECT (expires_at <= NOW()) AS is_freshly_expired FROM pools WHERE id = ?',
        [poolId]
      );
      const isPoolExpired = Boolean(pool.is_expired) || Boolean(freshExpiryRows[0] && freshExpiryRows[0].is_freshly_expired);
      if (isPoolExpired) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'POOL_EXPIRED',
            message: 'Pool participation deadline has expired according to authoritative server time'
          }
        });
      }

      // Supplier and listing eligibility validation (OBS-21)
      if (pool.supplier_role !== 'SUPPLIER' ||
          Number(pool.supplier_is_verified) !== 1 ||
          pool.supplier_user_verification !== 'VERIFIED' ||
          pool.supplier_profile_verification !== 'VERIFIED') {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'SUPPLIER_INELIGIBLE',
            message: 'The supplier hosting this pool is not in an active, verified status.'
          }
        });
      }

      if (!pool.listing_id || pool.listing_status !== 'ACTIVE') {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'LISTING_INACTIVE',
            message: `Associated supplier listing is ${pool.listing_status || 'not found'}. Cannot update reservation.`
          }
        });
      }

      if (Number(pool.listing_supplier_id) !== Number(pool.supplier_id) ||
          Number(pool.listing_spec_id) !== Number(pool.product_spec_id)) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'SPECIFICATION_MISMATCH',
            message: 'Pool specification or supplier does not match the underlying supplier listing.'
          }
        });
      }

      // Status guard: Reservation must be strictly in RESERVED state and have no locked price (OBS-23)
      if (targetReservation.status !== 'RESERVED') {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'RESERVATION_NOT_EDITABLE',
            message: `Cannot update a reservation in '${targetReservation.status}' status. Only active RESERVED reservations may be modified.`
          }
        });
      }

      if (targetReservation.locked_unit_price !== null || targetReservation.locked_total_price !== null) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'PRICE_ALREADY_LOCKED',
            message: 'This reservation has already locked commercial pricing and cannot be modified.'
          }
        });
      }

      // Concurrency Precondition Guard (Stale Edit Protection - OBS-27 & OBS-32):
      const rawExpectedQty = req.headers['if-match-quantity'] || req.body.expected_quantity;
      if (rawExpectedQty !== undefined && rawExpectedQty !== null && String(rawExpectedQty).trim() !== '') {
        const strExpected = String(rawExpectedQty).trim();
        // Excess precision rejected (> 4 decimal places)
        if (/\.\d{5,}$/.test(strExpected)) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_EXPECTED_QUANTITY',
              message: 'If-Match-Quantity / expected_quantity precision exceeds 4 decimal places.'
            }
          });
        }
        const parsedExpected = Number(strExpected);
        if (isNaN(parsedExpected) || parsedExpected <= 0) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_EXPECTED_QUANTITY',
              message: 'If-Match-Quantity / expected_quantity must be a valid positive number.'
            }
          });
        }
        const currentQtyFixed = Number(Number(targetReservation.quantity).toFixed(4));
        const expectedQtyFixed = Number(Number(parsedExpected).toFixed(4));
        // Reject if difference is >= 0.0001 (e.g. exactly 0.0001 or greater)
        if (Math.abs(currentQtyFixed - expectedQtyFixed) >= 0.00005) {
          await connection.rollback();
          connection.release();
          return res.status(412).json({
            success: false,
            error: {
              code: 'PRECONDITION_FAILED',
              message: `Reservation was modified by another request. Expected quantity was ${parsedExpected}, but current quantity is ${currentQtyFixed}.`,
              current_quantity: currentQtyFixed
            }
          });
        }
      }

      const oldQty = Number(targetReservation.quantity);

      // Packaging & increment validations
      const unitConversionService = require('../services/unitConversionService');
      const isDiscrete = unitConversionService.isDiscreteUnit(pool.pool_unit);
      if (isDiscrete && !Number.isInteger(requestedQty)) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'FRACTIONAL_PACK_REJECTED',
            message: `Packaging unit '${pool.pool_unit}' is indivisible and does not allow fractional quantities`
          }
        });
      }

      const buyerMinQty = Number(pool.buyer_min_qty);
      if (requestedQty < buyerMinQty) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'BUYER_MIN_QTY_NOT_MET',
            message: `Requested quantity (${requestedQty} ${pool.pool_unit}) is below pool minimum order quantity (${buyerMinQty} ${pool.pool_unit})`
          }
        });
      }

      const purchaseIncrement = Number(pool.purchase_increment) || 1.0;
      const remainder = ((requestedQty - buyerMinQty) % purchaseIncrement);
      if (Math.abs(remainder) > 0.0001 && Math.abs(remainder - purchaseIncrement) > 0.0001) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PURCHASE_INCREMENT',
            message: `Requested quantity must advance in increments of ${purchaseIncrement} ${pool.pool_unit} above minimum (${buyerMinQty})`
          }
        });
      }

      // Compute current eligible aggregate demand (OBS-33)
      const [aggRows] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS aggregate_qty
         FROM reservations
         WHERE pool_id = ? AND status IN ('RESERVED', 'CONFIRMED', 'PAID')`,
        [poolId]
      );
      const [unknownRows] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS unknown_qty
         FROM reservations
         WHERE pool_id = ? AND status NOT IN ('RESERVED', 'CONFIRMED', 'PAID', 'CANCELLED', 'EXPIRED')`,
        [poolId]
      );
      const unknownDemand = Number(unknownRows[0].unknown_qty || 0);
      const currentAggregateQty = Number((Number(aggRows[0].aggregate_qty) + unknownDemand).toFixed(4));
      const maxCap = pool.max_capacity !== null ? Number(pool.max_capacity) : null;
      const targetQty = Number(pool.target_qty);
      const suppMinQty = Number(pool.supplier_min_qty);
      const effectiveCap = maxCap !== null ? maxCap : targetQty;

      // Handle No-Op update (requestedQty === oldQty)
      if (Math.abs(requestedQty - oldQty) < 0.0001) {
        await connection.rollback();
        connection.release();

        const [tiers] = await db.query(
          'SELECT id, min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
          [poolId]
        );
        const tierPricingService = require('../services/tierPricingService');
        const pricingEval = tierPricingService.calculateApplicablePrice(tiers, currentAggregateQty, suppMinQty);
        const remainingCapacity = Math.max(0, Number((effectiveCap - currentAggregateQty).toFixed(4)));

        return res.status(200).json({
          success: true,
          message: 'Reservation quantity is already at the requested value (no changes made)',
          data: {
            reservation: {
              id: targetReservation.id,
              reservation_code: targetReservation.reservation_code,
              pool_id: targetReservation.pool_id,
              pool_code: pool.pool_code,
              buyer_id: targetReservation.buyer_id,
              old_quantity: oldQty,
              quantity: oldQty,
              unit_price: Number(targetReservation.unit_price),
              total_price: Number(targetReservation.total_price),
              status: targetReservation.status,
              created_at: targetReservation.created_at,
              updated_at: targetReservation.updated_at
            },
            pool: {
              id: pool.id,
              pool_code: pool.pool_code,
              status: pool.status,
              pool_unit: pool.pool_unit,
              expires_at: pool.expires_at,
              cancellation_terms: 'Buyer modification and cancellation permitted while pool is open (RESERVED state).'
            },
            specification: {
              id: targetReservation.spec_id,
              product_title: targetReservation.product_title,
              category: targetReservation.product_category,
              quality_grade: targetReservation.quality_grade,
              canonical_spec_hash: targetReservation.canonical_spec_hash
            },
            aggregate_progress: {
              current_aggregate_qty: currentAggregateQty,
              remaining_pool_capacity: remainingCapacity,
              supplier_min_qty: suppMinQty,
              target_qty: targetQty,
              max_capacity: maxCap,
              progress_toward_supplier_min_pct: Number(Math.min(100, (currentAggregateQty / suppMinQty) * 100).toFixed(1)),
              progress_toward_target_pct: Number(Math.min(100, (currentAggregateQty / targetQty) * 100).toFixed(1)),
              supplier_min_met: currentAggregateQty >= suppMinQty,
              target_met: currentAggregateQty >= targetQty
            },
            pricing: {
              estimated_unit_price: Number(targetReservation.unit_price),
              estimated_subtotal: Number(targetReservation.total_price),
              pricing_mode: currentAggregateQty >= suppMinQty ? 'ESTIMATED_TIER_CONFIRMABLE' : 'ESTIMATED_PRE_MINIMUM',
              current_tier_index: pricingEval.tierIndex
            }
          }
        });
      }

      // Calculate quantity delta and new aggregate
      const delta = Number((requestedQty - oldQty).toFixed(4));
      const newAggregateQty = Number((currentAggregateQty + delta).toFixed(4));

      // Capacity validation
      if (newAggregateQty > effectiveCap) {
        await connection.rollback();
        connection.release();
        const remainingCap = Math.max(0, Number((effectiveCap - currentAggregateQty).toFixed(4)));
        return res.status(409).json({
          success: false,
          error: {
            code: 'CAPACITY_EXCEEDED',
            message: `Requested quantity update (+${delta} ${pool.pool_unit}) exceeds remaining pool capacity (${remainingCap} ${pool.pool_unit}).`
          }
        });
      }

      // Re-evaluate applicable price tier
      const [tiers] = await connection.query(
        'SELECT id, min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
        [poolId]
      );
      const tierPricingService = require('../services/tierPricingService');
      const pricingEval = tierPricingService.calculateApplicablePrice(tiers, newAggregateQty, suppMinQty);
      const applicableUnitPrice = pricingEval.price;
      const applicableSubtotal = Number((requestedQty * applicableUnitPrice).toFixed(2));

      // 4. Update the target reservation
      await connection.query(
        `UPDATE reservations 
         SET quantity = ?, unit_price = ?, total_price = ?, updated_at = NOW()
         WHERE id = ?`,
        [requestedQty, applicableUnitPrice, applicableSubtotal, reservationId]
      );

      // 5. Retroactively reprice ALL other active RESERVED reservations in this pool (OBS-23)
      await connection.query(
        `UPDATE reservations
         SET unit_price = ?, total_price = ROUND(quantity * ?, 2), updated_at = NOW()
         WHERE pool_id = ? AND status = 'RESERVED' AND locked_unit_price IS NULL AND id != ?`,
        [applicableUnitPrice, applicableUnitPrice, poolId, reservationId]
      );

      // 6. Update pool materialized aggregate quantity and cached pricing
      await connection.query(
        `UPDATE pools
         SET current_qty = ?, current_price_per_unit = ?, updated_at = NOW()
         WHERE id = ?`,
        [newAggregateQty, applicableUnitPrice, poolId]
      );

      const remainingCapacity = Math.max(0, Number((effectiveCap - newAggregateQty).toFixed(4)));

      const responsePayload = {
        success: true,
        message: 'Reservation quantity updated successfully',
        data: {
          reservation: {
            id: targetReservation.id,
            reservation_code: targetReservation.reservation_code,
            pool_id: targetReservation.pool_id,
            pool_code: pool.pool_code,
            buyer_id: targetReservation.buyer_id,
            old_quantity: oldQty,
            quantity: requestedQty,
            unit_price: applicableUnitPrice,
            total_price: applicableSubtotal,
            status: 'RESERVED',
            created_at: targetReservation.created_at,
            updated_at: new Date().toISOString()
          },
          pool: {
            id: pool.id,
            pool_code: pool.pool_code,
            status: pool.status,
            pool_unit: pool.pool_unit,
            expires_at: pool.expires_at,
            cancellation_terms: 'Buyer modification and cancellation permitted while pool is open (RESERVED state).'
          },
          specification: {
            id: targetReservation.spec_id,
            product_title: targetReservation.product_title,
            category: targetReservation.product_category,
            quality_grade: targetReservation.quality_grade,
            canonical_spec_hash: targetReservation.canonical_spec_hash
          },
          supplier: {
            id: pool.supplier_id,
            business_name: targetReservation.supplier_business_name,
            verification_status: targetReservation.supplier_verification_status
          },
          aggregate_progress: {
            current_aggregate_qty: newAggregateQty,
            remaining_pool_capacity: remainingCapacity,
            supplier_min_qty: suppMinQty,
            target_qty: targetQty,
            max_capacity: maxCap,
            progress_toward_supplier_min_pct: Number(Math.min(100, (newAggregateQty / suppMinQty) * 100).toFixed(1)),
            progress_toward_target_pct: Number(Math.min(100, (newAggregateQty / targetQty) * 100).toFixed(1)),
            supplier_min_met: newAggregateQty >= suppMinQty,
            target_met: newAggregateQty >= targetQty
          },
          pricing: {
            estimated_unit_price: applicableUnitPrice,
            estimated_subtotal: applicableSubtotal,
            pricing_mode: newAggregateQty >= suppMinQty ? 'ESTIMATED_TIER_CONFIRMABLE' : 'ESTIMATED_PRE_MINIMUM',
            current_tier_index: pricingEval.tierIndex,
            next_tier: pricingEval.nextTier ? {
              min_qty: Number(pricingEval.nextTier.min_qty),
              max_qty: Number(pricingEval.nextTier.max_qty),
              price_per_unit: Number(pricingEval.nextTier.price_per_unit),
              additional_qty_needed: Number(Math.max(0, Number(pricingEval.nextTier.min_qty) - newAggregateQty).toFixed(4))
            } : null
          }
        }
      };

      // 7. Write immutable mutation history entry
      await connection.query(
        `INSERT INTO reservation_mutation_history (
           reservation_id, pool_id, buyer_id, mutation_type,
           previous_quantity, new_quantity,
           previous_unit_price, new_unit_price,
           previous_total_price, new_total_price,
           previous_status, new_status,
           aggregate_qty_snapshot, idempotency_key, response_payload
         ) VALUES (?, ?, ?, 'QUANTITY_UPDATE', ?, ?, ?, ?, ?, ?, 'RESERVED', 'RESERVED', ?, ?, ?)`,
        [
          reservationId, poolId, buyer_id,
          oldQty, requestedQty,
          Number(targetReservation.unit_price), applicableUnitPrice,
          Number(targetReservation.total_price), applicableSubtotal,
          newAggregateQty, req.idempotency ? req.idempotency.key : null,
          JSON.stringify(responsePayload)
        ]
      );

      // 8. Write system audit log
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, 'BUYER', 'RESERVATION_QUANTITY_UPDATED', 'reservations', ?, ?, ?)`,
        [
          buyer_id, reservationId,
          JSON.stringify({ quantity: oldQty, unit_price: Number(targetReservation.unit_price), total_price: Number(targetReservation.total_price) }),
          JSON.stringify({ quantity: requestedQty, unit_price: applicableUnitPrice, total_price: applicableSubtotal, idempotency_key: req.idempotency ? req.idempotency.key : null })
        ]
      );

      // 9. Link idempotency resource
      if (req.idempotency) {
        await req.idempotency.setResource('reservations', reservationId, connection);
      }

      // 9b. Record durable business events (Part 4C.2B)
      const prevTierEval = tierPricingService.calculateApplicablePrice(tiers, currentAggregateQty, suppMinQty);
      await reservationEventService.recordReservationMutationEvents({
        connection,
        poolId,
        reservationId,
        buyerId: buyer_id,
        mutationType: requestedQty > oldQty ? 'QUANTITY_INCREASED' : 'QUANTITY_DECREASED',
        previousQty: oldQty,
        newQty: requestedQty,
        previousUnitPrice: Number(targetReservation.unit_price),
        newUnitPrice: applicableUnitPrice,
        previousAggregateQty: currentAggregateQty,
        newAggregateQty,
        supplierMinQty: suppMinQty,
        targetQty,
        previousTierIndex: prevTierEval.tierIndex,
        newTierIndex: pricingEval.tierIndex,
        idempotencyKey: req.idempotency ? req.idempotency.key : null,
        metadata: {
          pool_code: pool.pool_code,
          reservation_code: targetReservation.reservation_code
        }
      });

      await connection.commit();
      connection.release();

      return res.status(200).json(responsePayload);

    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {}
        connection.release();
      }
      console.error('Update Reservation Quantity Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to update reservation quantity due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST/PUT /api/v1/reservations/:id/cancel — Buyer cancels reservation
  // ---------------------------------------------------------------------------
  async cancelReservation(req, res) {
    let connection;
    try {
      const buyer_id = req.user.id;
      const reservationId = parseInt(req.params.id, 10);

      if (!reservationId || isNaN(reservationId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Valid numeric reservation ID is required in URL parameter' }
        });
      }

      // 1. Pre-check reservation existence and ownership
      const [preRows] = await db.query(
        'SELECT pool_id, buyer_id, status FROM reservations WHERE id = ?',
        [reservationId]
      );
      if (!preRows || preRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'RESERVATION_NOT_FOUND', message: 'Reservation not found' }
        });
      }

      const preRes = preRows[0];
      if (Number(preRes.buyer_id) !== Number(buyer_id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not own this reservation' }
        });
      }

      const poolId = preRes.pool_id;

      // 2. Begin dedicated transaction
      connection = await db.getConnection();
      await connection.beginTransaction();

      // Lock parent pool row FIRST
      const [poolRows] = await connection.query(
        `SELECT p.*, (p.expires_at <= NOW()) AS is_expired
         FROM pools p
         WHERE p.id = ? FOR UPDATE`,
        [poolId]
      );

      if (!poolRows || poolRows.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          error: { code: 'POOL_NOT_FOUND', message: 'Associated pool not found' }
        });
      }

      const pool = poolRows[0];

      // Lock target reservation row SECOND
      const [lockedResRows] = await connection.query(
        'SELECT * FROM reservations WHERE id = ? FOR UPDATE',
        [reservationId]
      );

      if (!lockedResRows || lockedResRows.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          error: { code: 'RESERVATION_NOT_FOUND', message: 'Reservation not found' }
        });
      }

      const targetReservation = lockedResRows[0];

      // Revalidate ownership under lock
      if (Number(targetReservation.buyer_id) !== Number(buyer_id)) {
        await connection.rollback();
        connection.release();
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not own this reservation' }
        });
      }

      // Check legacy pool read-only policy (OBS-24)
      if (!pool.product_spec_id || !pool.supplier_listing_id) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'LEGACY_POOL_READ_ONLY',
            message: 'Historical legacy pool lacks verified product specification identity and is read-only.'
          }
        });
      }

      // Cancellation conditions: Pool must be ACTIVE and not expired
      if (pool.status !== 'ACTIVE') {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'POOL_NOT_ACTIVE',
            message: `Pool is currently '${pool.status}' and cannot accept cancellations`
          }
        });
      }

      // Authoritative evaluation evaluated within the locked transaction (OBS-46 fresh post-lock revalidation)
      const [freshExpiryRows] = await connection.query(
        'SELECT (expires_at <= NOW()) AS is_freshly_expired FROM pools WHERE id = ?',
        [poolId]
      );
      const isPoolExpired = Boolean(pool.is_expired) || Boolean(freshExpiryRows[0] && freshExpiryRows[0].is_freshly_expired);
      if (isPoolExpired) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'POOL_EXPIRED',
            message: 'Pool participation deadline has expired according to authoritative server time'
          }
        });
      }

      // Check reservation status: Only RESERVED status can be cancelled
      if (targetReservation.status !== 'RESERVED') {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'RESERVATION_NOT_CANCELLABLE',
            message: `Cannot cancel a reservation in '${targetReservation.status}' status. Only active RESERVED reservations may be cancelled.`
          }
        });
      }

      if (targetReservation.locked_unit_price !== null || targetReservation.locked_total_price !== null) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'PRICE_ALREADY_LOCKED',
            message: 'This reservation has locked commercial pricing and cannot be cancelled.'
          }
        });
      }

      const cancelledQty = Number(targetReservation.quantity);

      // Compute current eligible aggregate demand (OBS-33)
      const [aggRows] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS aggregate_qty
         FROM reservations
         WHERE pool_id = ? AND status IN ('RESERVED', 'CONFIRMED', 'PAID')`,
        [poolId]
      );
      const [unknownRows] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS unknown_qty
         FROM reservations
         WHERE pool_id = ? AND status NOT IN ('RESERVED', 'CONFIRMED', 'PAID', 'CANCELLED', 'EXPIRED')`,
        [poolId]
      );
      const unknownDemand = Number(unknownRows[0].unknown_qty || 0);
      const currentAggregateQty = Number((Number(aggRows[0].aggregate_qty) + unknownDemand).toFixed(4));
      const newAggregateQty = Math.max(0, Number((currentAggregateQty - cancelledQty).toFixed(4)));

      const maxCap = pool.max_capacity !== null ? Number(pool.max_capacity) : null;
      const targetQty = Number(pool.target_qty);
      const suppMinQty = Number(pool.supplier_min_qty);
      const effectiveCap = maxCap !== null ? maxCap : targetQty;
      const remainingCapacity = Math.max(0, Number((effectiveCap - newAggregateQty).toFixed(4)));

      // Re-evaluate applicable price tier for remaining buyers
      const [tiers] = await connection.query(
        'SELECT id, min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
        [poolId]
      );
      const tierPricingService = require('../services/tierPricingService');
      const pricingEval = tierPricingService.calculateApplicablePrice(tiers, newAggregateQty, suppMinQty);
      const applicableUnitPrice = pricingEval.price;

      // 3. Mark reservation CANCELLED
      await connection.query(
        "UPDATE reservations SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?",
        [reservationId]
      );

      // 4. Retroactively reprice remaining active RESERVED reservations
      await connection.query(
        `UPDATE reservations
         SET unit_price = ?, total_price = ROUND(quantity * ?, 2), updated_at = NOW()
         WHERE pool_id = ? AND status = 'RESERVED' AND locked_unit_price IS NULL`,
        [applicableUnitPrice, applicableUnitPrice, poolId]
      );

      // 5. Update pool materialized aggregate quantity and cached pricing
      await connection.query(
        `UPDATE pools
         SET current_qty = ?, current_price_per_unit = ?, updated_at = NOW()
         WHERE id = ?`,
        [newAggregateQty, applicableUnitPrice, poolId]
      );

      const cancellationTimestamp = new Date().toISOString();
      const responsePayload = {
        success: true,
        message: 'Reservation cancelled successfully. Your reserved quantity has been returned to the pool.',
        data: {
          reservation: {
            id: targetReservation.id,
            reservation_code: targetReservation.reservation_code,
            pool_id: targetReservation.pool_id,
            pool_code: pool.pool_code,
            buyer_id: targetReservation.buyer_id,
            previous_quantity: cancelledQty,
            status: 'CANCELLED',
            cancelled_at: cancellationTimestamp
          },
          pool: {
            id: pool.id,
            pool_code: pool.pool_code,
            status: pool.status,
            pool_unit: pool.pool_unit
          },
          aggregate_progress: {
            current_aggregate_qty: newAggregateQty,
            remaining_pool_capacity: remainingCapacity,
            supplier_min_qty: suppMinQty,
            target_qty: targetQty,
            max_capacity: maxCap
          },
          financial_note: 'No payment was collected; no refund required.'
        }
      };

      // 6. Write immutable mutation history
      await connection.query(
        `INSERT INTO reservation_mutation_history (
           reservation_id, pool_id, buyer_id, mutation_type,
           previous_quantity, new_quantity,
           previous_unit_price, new_unit_price,
           previous_total_price, new_total_price,
           previous_status, new_status,
           aggregate_qty_snapshot, idempotency_key, response_payload
         ) VALUES (?, ?, ?, 'CANCELLATION', ?, 0, ?, ?, ?, 0, 'RESERVED', 'CANCELLED', ?, ?, ?)`,
        [
          reservationId, poolId, buyer_id,
          cancelledQty,
          Number(targetReservation.unit_price), applicableUnitPrice,
          Number(targetReservation.total_price),
          newAggregateQty, req.idempotency ? req.idempotency.key : null,
          JSON.stringify(responsePayload)
        ]
      );

      // 7. Write system audit log
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, 'BUYER', 'RESERVATION_CANCELLED', 'reservations', ?, ?, ?)`,
        [
          buyer_id, reservationId,
          JSON.stringify({ quantity: cancelledQty, unit_price: Number(targetReservation.unit_price), total_price: Number(targetReservation.total_price), status: 'RESERVED' }),
          JSON.stringify({ status: 'CANCELLED', idempotency_key: req.idempotency ? req.idempotency.key : null })
        ]
      );

      // 8. Link idempotency resource
      if (req.idempotency) {
        await req.idempotency.setResource('reservations', reservationId, connection);
      }

      // 8b. Record durable business events (Part 4C.2B)
      const prevTierEval = tierPricingService.calculateApplicablePrice(tiers, currentAggregateQty, suppMinQty);
      await reservationEventService.recordReservationMutationEvents({
        connection,
        poolId,
        reservationId,
        buyerId: buyer_id,
        mutationType: 'CANCEL',
        previousQty: cancelledQty,
        newQty: 0,
        previousUnitPrice: Number(targetReservation.unit_price),
        newUnitPrice: applicableUnitPrice,
        previousAggregateQty: currentAggregateQty,
        newAggregateQty,
        supplierMinQty: suppMinQty,
        targetQty,
        previousTierIndex: prevTierEval.tierIndex,
        newTierIndex: pricingEval.tierIndex,
        idempotencyKey: req.idempotency ? req.idempotency.key : null,
        metadata: {
          pool_code: pool.pool_code,
          reservation_code: targetReservation.reservation_code
        }
      });

      await connection.commit();
      connection.release();

      return res.status(200).json(responsePayload);

    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {}
        connection.release();
      }
      console.error('Cancel Reservation Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to cancel reservation due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/reservations/:id/final-offer — Authoritative Buyer Commercial Offer (Part 4D.4)
  // Constructs personalized buyer offer from qualification snapshot, supplier ACCEPT decision, and terms.
  // ---------------------------------------------------------------------------
  async getBuyerCommercialOffer(req, res) {
    try {
      const reservationId = parseInt(req.params.id, 10);
      if (!reservationId || isNaN(reservationId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric reservation ID is required' }
        });
      }

      const { CommercialLifecycleService } = require('../services/commercialLifecycleService');
      const offerData = await CommercialLifecycleService.getBuyerCommercialOffer({
        reservationId,
        actor: {
          id: req.user.id,
          role: req.user.role
        }
      });

      return res.status(200).json({
        success: true,
        data: offerData
      });

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'OFFER_FETCH_ERROR',
            message: error.message,
            details: error.details || undefined
          }
        });
      }
      console.error('getBuyerCommercialOffer Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch commercial offer' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/reservations/:id/final-decision — Explicit Buyer ACCEPT / DECLINE (Part 4D.4)
  // Enforces atomic transaction, immutable decision row, price locking on ACCEPT,
  // strict idempotency, fresh post-lock deadline checking, and outbox event emission.
  // ---------------------------------------------------------------------------
  async recordBuyerDecision(req, res) {
    try {
      const reservationId = parseInt(req.params.id, 10);
      if (!reservationId || isNaN(reservationId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric reservation ID is required' }
        });
      }

      const { decision, decline_reason_code, decline_reason_notes } = req.body || {};
      const idempotencyKey = req.headers['x-idempotency-key'] || null;

      const { CommercialLifecycleService } = require('../services/commercialLifecycleService');
      const outcome = await CommercialLifecycleService.recordBuyerDecision({
        reservationId,
        actor: {
          id: req.user.id,
          role: req.user.role
        },
        decision,
        declineReasonCode: decline_reason_code,
        declineReasonNotes: decline_reason_notes,
        idempotencyKey
      });

      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('reservations', reservationId);
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
      console.error('recordBuyerDecision Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to record buyer commercial decision' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/reservations/:id/order-readiness — Buyer Order Readiness Evaluation (Part 4E.1)
  // Authoritative, read-only reconciliation evaluating if reservation is ready for order conversion.
  // ---------------------------------------------------------------------------
  async getOrderReadiness(req, res) {
    try {
      const reservationId = parseInt(req.params.id, 10);
      if (!reservationId || isNaN(reservationId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric reservation ID is required' }
        });
      }

      const commercialReconciliationService = require('../services/commercialReconciliationService');
      const readiness = await commercialReconciliationService.evaluateOrderReadiness({
        reservationId,
        actor: {
          id: req.user.id,
          role: req.user.role,
          buyer_trust_status: req.user.buyer_trust_status
        }
      });

      return res.status(200).json({
        success: true,
        data: readiness
      });

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'READINESS_EVALUATION_ERROR',
            message: error.message,
            details: error.details || undefined
          }
        });
      }
      console.error('getOrderReadiness Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to evaluate order readiness' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/reservations/:id/confirm — Buyer confirms & locks price (Legacy route)
  // ---------------------------------------------------------------------------
  async confirmReservation(req, res) {
    try {
      const buyer_id = req.user.id;
      const { id } = req.params;

      const reservation = await reservationRepo.confirmReservation(parseInt(id, 10), buyer_id);

      // Audit log
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'BUYER', 'RESERVATION_CONFIRMED', 'reservations', ?, ?)`,
        [buyer_id, id, JSON.stringify({ locked_unit_price: reservation.locked_unit_price })]
      );

      return res.status(200).json({
        success: true,
        message: 'Reservation confirmed. Price is now locked — proceed to payment.',
        data: { reservation }
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: { code: 'CONFIRMATION_FAILED', message: error.message }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/reservations/my  — Buyer views all their reservations
  // ---------------------------------------------------------------------------
  async getMyReservations(req, res) {
    try {
      const buyer_id = req.user.id;
      const reservations = await reservationRepo.findByBuyerId(buyer_id);

      // Batch-fetch pool snapshots to avoid N+1 queries
      const poolIds = [...new Set(reservations.map(r => r.pool_id))];
      const snapshotMap = new Map();
      await Promise.all(poolIds.map(async pid => {
        const snap = await poolProgressService.getPoolSnapshot(pid);
        if (snap) snapshotMap.set(pid, snap);
      }));

      const enrichedList = reservations.map(r => {
        const snap = snapshotMap.get(r.pool_id);
        const isPoolActive = snap ? snap.status === 'ACTIVE' : r.pool_status === 'ACTIVE';
        const isPoolExpired = snap ? snap.is_expired : (new Date(r.expires_at) <= new Date());
        const isReserved = r.status === 'RESERVED';
        const isPriceLocked = r.locked_unit_price !== null || r.locked_total_price !== null;

        const canModify = isReserved && isPoolActive && !isPoolExpired && !isPriceLocked;
        const canCancel = isReserved && isPoolActive && !isPoolExpired && !isPriceLocked;

        return {
          ...r,
          quantity: Number(r.quantity),
          unit_price: Number(r.unit_price),
          total_price: Number(r.total_price),
          locked_unit_price: r.locked_unit_price !== null ? Number(r.locked_unit_price) : null,
          locked_total_price: r.locked_total_price !== null ? Number(r.locked_total_price) : null,
          specification: {
            id: r.spec_id,
            product_title: r.product_title,
            category: r.product_category,
            quality_grade: r.quality_grade,
            canonical_spec_hash: r.canonical_spec_hash
          },
          supplier: {
            business_name: r.supplier_name
          },
          pool_progress: snap ? {
            current_aggregate_qty: snap.current_qty,
            remaining_pool_capacity: snap.remaining_capacity,
            supplier_min_met: snap.minimum_reached,
            target_met: snap.target_reached
          } : null,
          permissions: {
            can_modify: canModify,
            can_cancel: canCancel
          }
        };
      });

      return res.status(200).json({
        success: true,
        count: enrichedList.length,
        data: { reservations: enrichedList }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/reservations/:id  — Get specific reservation (own or admin)
  // ---------------------------------------------------------------------------
  async getReservationById(req, res) {
    try {
      const reservation = await reservationRepo.findById(req.params.id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Reservation not found' } });
      }
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
      if (!isAdmin && Number(reservation.buyer_id) !== Number(req.user.id)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied: You do not own this reservation' } });
      }

      // Fetch unified pool snapshot for authoritative progress and pricing transparency
      const poolSnapshot = await poolProgressService.getPoolSnapshot(reservation.pool_id);

      const isPoolActive = poolSnapshot ? poolSnapshot.status === 'ACTIVE' : reservation.pool_status === 'ACTIVE';
      const isPoolExpired = poolSnapshot ? poolSnapshot.is_expired : (new Date(reservation.expires_at) <= new Date());
      const isReserved = reservation.status === 'RESERVED';
      const isPriceLocked = reservation.locked_unit_price !== null || reservation.locked_total_price !== null;

      const canModify = isReserved && isPoolActive && !isPoolExpired && !isPriceLocked;
      const canCancel = isReserved && isPoolActive && !isPoolExpired && !isPriceLocked;

      let blockedReason = null;
      if (!isReserved) {
        blockedReason = `Reservation is in '${reservation.status}' status and cannot be modified or cancelled.`;
      } else if (!isPoolActive) {
        blockedReason = `Pool is currently '${poolSnapshot ? poolSnapshot.status : reservation.pool_status}' and cannot accept changes.`;
      } else if (isPoolExpired) {
        blockedReason = 'Pool participation deadline has expired.';
      } else if (isPriceLocked) {
        blockedReason = 'Commercial pricing has already been locked for this reservation.';
      }

      const enrichedReservation = {
        ...reservation,
        quantity: Number(reservation.quantity),
        unit_price: Number(reservation.unit_price),
        total_price: Number(reservation.total_price),
        locked_unit_price: reservation.locked_unit_price !== null ? Number(reservation.locked_unit_price) : null,
        locked_total_price: reservation.locked_total_price !== null ? Number(reservation.locked_total_price) : null,
        specification: {
          id: reservation.spec_id,
          product_title: reservation.product_title,
          category: reservation.product_category,
          quality_grade: reservation.quality_grade,
          canonical_spec_hash: reservation.canonical_spec_hash
        },
        supplier: {
          id: reservation.supplier_id,
          business_name: reservation.supplier_business_name,
          verification_status: reservation.supplier_verification_status
        },
        pool_progress: poolSnapshot ? {
          current_aggregate_qty: poolSnapshot.current_qty,
          remaining_pool_capacity: poolSnapshot.remaining_capacity,
          supplier_min_qty: poolSnapshot.supplier_min_qty,
          target_qty: poolSnapshot.target_qty,
          max_capacity: poolSnapshot.max_capacity,
          supplier_min_met: poolSnapshot.minimum_reached,
          target_met: poolSnapshot.target_reached,
          progress_toward_supplier_min_pct: poolSnapshot.minimum_progress_percent,
          progress_toward_target_pct: poolSnapshot.target_progress_percent,
          pricing_mode: poolSnapshot.pricing_mode,
          is_conditional_pricing: poolSnapshot.is_conditional_pricing,
          next_tier: poolSnapshot.next_tier_quantity ? {
            min_qty: poolSnapshot.next_tier_quantity,
            price_per_unit: poolSnapshot.next_tier_price,
            additional_qty_needed: poolSnapshot.additional_quantity_for_next_tier
          } : null
        } : null,
        permissions: {
          can_modify: canModify,
          can_cancel: canCancel,
          blocked_reason: blockedReason
        }
      };

      return res.status(200).json({ success: true, data: { reservation: enrichedReservation } });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/reservations/:id/order — Create Order from Commitment (Part 4E.2)
  // Authoritative conversion of buyer ACCEPT commitment into an order (AWAITING_PAYMENT)
  // ---------------------------------------------------------------------------
  async createOrder(req, res) {
    try {
      const reservationId = parseInt(req.params.id, 10);
      if (!reservationId || isNaN(reservationId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric reservation ID is required' }
        });
      }

      const idempotencyKey = req.idempotency ? req.idempotency.key : (req.headers['x-idempotency-key'] || null);
      if (!idempotencyKey) {
        return res.status(400).json({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'X-Idempotency-Key header is mandatory for order conversion' }
        });
      }

      const { delivery_address, notes } = req.body || {};

      const orderService = require('../services/orderService');
      const result = await orderService.createOrderFromBuyerCommitment({
        reservationId,
        actor: {
          id: req.user.id,
          role: req.user.role,
          buyer_trust_status: req.user.buyer_trust_status
        },
        idempotencyKey,
        deliveryAddress: delivery_address || null,
        notes: notes || null
      });

      // Transactionally link idempotency record to order resource if middleware active
      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('orders', result.order.id);
      }

      return res.status(result.is_replay ? 200 : 201).json({
        success: true,
        message: result.is_replay 
          ? 'Existing order retrieved successfully for this commitment'
          : 'Authoritative order created successfully from commercial commitment. Initial state is AWAITING_PAYMENT.',
        data: {
          order: result.order,
          is_replay: result.is_replay
        }
      });

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'ORDER_CONVERSION_ERROR',
            message: error.message,
            details: error.details || undefined
          }
        });
      }
      console.error('createOrder Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to convert commitment into order' }
      });
    }
  }
}

module.exports = new ReservationController();