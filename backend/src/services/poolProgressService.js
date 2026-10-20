// =============================================================================
// src/services/poolProgressService.js
// MilJor Regular Pool Authoritative Progress & Pricing Read Model Engine
// Provides unified, coherent, and deterministic pool progress, capacity,
// dynamic tier pricing estimates, next discount milestones, and participation eligibility.
// Reuses tierPricingService — zero duplicate pricing logic.
// =============================================================================

const db = require('../config/db');
const tierPricingService = require('./tierPricingService');
const { DEMAND_ELIGIBLE_STATUSES, isDemandEligible } = require('./reservationDemandPolicy');
const { evaluatePoolParticipationEligibility } = require('./supplierEligibilityPolicy');

class PoolProgressService {
  /**
   * Pure calculation function: computes progress metrics, capped percentages,
   * booleans, remaining capacity, and estimated tier pricing from inputs.
   *
   * @param {Object} pool - Pool row or config object
   * @param {Array} tiers - Array of pool price tiers sorted ascending by min_qty
   * @param {number} eligibleQty - Authoritative eligible aggregate demand
   * @returns {Object} Progress and pricing metrics
   */
  calculateProgressAndPricing(pool, tiers, eligibleQty) {
    const eligibleQuantity = Number(Number(eligibleQty || 0).toFixed(4));
    const supplierMin = Number(pool.supplier_min_qty || 0);
    const targetQty = Number(pool.target_qty || 0);
    const maxCapacity = pool.max_capacity !== null && pool.max_capacity !== undefined
      ? Number(pool.max_capacity)
      : targetQty;
    const effectiveCap = maxCapacity > 0 ? maxCapacity : targetQty;

    // Remaining quantities (strictly non-negative)
    const remainingCapacity = Math.max(0, Number((effectiveCap - eligibleQuantity).toFixed(4)));
    const minimumRemaining = Math.max(0, Number((supplierMin - eligibleQuantity).toFixed(4)));
    const targetRemaining = Math.max(0, Number((targetQty - eligibleQuantity).toFixed(4)));

    // Commercial milestone booleans (based strictly on quantities, not display percentages)
    const minimumReached = eligibleQuantity >= supplierMin;
    const targetReached = eligibleQuantity >= targetQty;
    const capacityReached = remainingCapacity <= 0;

    // Capped display progress percentages (0.0% to 100.0%)
    const minimumProgressPercent = supplierMin > 0
      ? Number(Math.min(100, Math.max(0, (eligibleQuantity / supplierMin) * 100)).toFixed(1))
      : 100.0;

    const targetProgressPercent = targetQty > 0
      ? Number(Math.min(100, Math.max(0, (eligibleQuantity / targetQty) * 100)).toFixed(1))
      : 100.0;

    // Tier pricing evaluation using existing tierPricingService
    let pricingEval = null;
    let estimatedUnitPrice = null;
    let nextTierQty = null;
    let additionalQtyForNextTier = null;
    let nextTierPrice = null;
    let currentTierIndex = null;
    let isConditionalPricing = !minimumReached;
    let pricingMode = minimumReached ? 'ESTIMATED_TIER_CONFIRMABLE' : 'ESTIMATED_PRE_MINIMUM';

    if (tiers && tiers.length > 0) {
      pricingEval = tierPricingService.calculateApplicablePrice(tiers, eligibleQuantity, supplierMin);
      estimatedUnitPrice = Number(pricingEval.price);
      currentTierIndex = pricingEval.tierIndex;

      if (pricingEval.nextTier) {
        nextTierQty = Number(pricingEval.nextTier.min_qty);
        additionalQtyForNextTier = Math.max(0, Number((nextTierQty - eligibleQuantity).toFixed(4)));
        nextTierPrice = Number(pricingEval.nextTier.price_per_unit);
      }
    } else if (pool.price_per_unit || pool.current_price_per_unit) {
      estimatedUnitPrice = Number(pool.current_price_per_unit || pool.price_per_unit);
    }

    return {
      eligible_quantity: eligibleQuantity,
      remaining_capacity: remainingCapacity,
      minimum_remaining: minimumRemaining,
      target_remaining: targetRemaining,
      minimum_reached: minimumReached,
      target_reached: targetReached,
      capacity_reached: capacityReached,
      minimum_progress_percent: minimumProgressPercent,
      target_progress_percent: targetProgressPercent,
      estimated_unit_price: estimatedUnitPrice,
      pricing_mode: pricingMode,
      is_conditional_pricing: isConditionalPricing,
      current_tier_index: currentTierIndex,
      next_tier_quantity: nextTierQty,
      additional_quantity_for_next_tier: additionalQtyForNextTier,
      next_tier_price: nextTierPrice
    };
  }

  /**
   * Evaluates participation eligibility for a pool without exposing confidential internals.
   *
   * @param {Object} pool - Joined pool data row
   * @param {number} remainingCapacity - Calculated remaining capacity
   * @returns {{ can_join: boolean, participation_status: string, participation_reason: string|null, is_legacy: number }}
   * Evaluates real-time participation eligibility for a pool (OBS-34).
   *
   * @param {Object} pool
   * @param {number} remainingCapacity
   * @returns {{ can_join: boolean, participation_status: string, participation_reason: string|null, is_legacy: number }}
   */
  evaluateParticipationEligibility(pool, remainingCapacity) {
    return evaluatePoolParticipationEligibility(pool, remainingCapacity);
  }

  /**
   * Retrieves a comprehensive, coherent, authoritative pool snapshot.
   * Resolves authoritative aggregate demand, detects cached drift, evaluates tier pricing,
   * and computes participation status in a single consistent view.
   *
   * @param {number|string} poolId
   * @param {Object} options - { connection?: PoolConnection, enforceRepeatableRead?: boolean }
   * @returns {Promise<Object|null>}
   */
  async getPoolSnapshot(poolId, options = {}) {
    const executor = options.connection || db;
    const parsedPoolId = parseInt(poolId, 10);
    if (isNaN(parsedPoolId)) return null;

    // Single consistent query: joins pool, products, specifications, supplier listings,
    // supplier user & profile, and sums all non-terminal reservations.
    const [rows] = await executor.query(
      `SELECT
        p.id, p.pool_code, p.status, p.product_id, p.product_spec_id, p.supplier_listing_id,
        p.supplier_id, p.target_qty, p.supplier_min_qty, p.buyer_min_qty, p.max_capacity,
        p.pool_unit, p.purchase_increment, p.delivery_type, p.delivery_zones,
        p.delivery_fee_policy, p.fulfilment_lead_time_days, p.cancellation_cutoff_hours,
        p.current_qty, p.current_price_per_unit, p.next_tier_price,
        p.expires_at, p.early_close_allowed,
        p.supplier_confirmation_deadline, p.buyer_commitment_deadline,
        p.closed_at, p.confirmed_at, p.created_at, p.updated_at,
        (p.expires_at <= NOW()) AS is_expired,
        -- Product information
        pr.title AS product_title, pr.category AS product_category, pr.brand AS product_brand,
        pr.variety AS product_variety, pr.pack_size AS product_pack_size, pr.unit AS product_unit,
        -- Specification information
        ps.id AS spec_id, ps.quality_grade, ps.spec_hash AS canonical_spec_hash,
        ps.packaging_type, ps.pack_unit, ps.purchasing_unit,
        -- Supplier Listing information
        sl.id AS listing_id, sl.status AS listing_status, sl.available_stock,
        sl.price_per_base_unit, sl.product_spec_id AS listing_product_spec_id,
        -- Supplier identity and verification
        u.id AS supplier_user_id, u.business_name AS supplier_business_name,
        u.verification_status AS supplier_user_verification_status,
        u.role AS supplier_role, u.is_verified AS supplier_is_verified,
        u.area AS supplier_area,
        sp.verification_status AS supplier_profile_verification_status,
        -- Authoritative reservation aggregation (strictly whitelisted active demand statuses)
        COALESCE(SUM(CASE WHEN r.status IN ('RESERVED', 'CONFIRMED', 'PAID') THEN r.quantity ELSE 0 END), 0) AS authoritative_aggregate_qty,
        COUNT(CASE WHEN r.status IN ('RESERVED', 'CONFIRMED', 'PAID') THEN r.id ELSE NULL END) AS active_reservations_count
      FROM pools p
      JOIN products pr ON p.product_id = pr.id
      LEFT JOIN product_specifications ps ON p.product_spec_id = ps.id
      LEFT JOIN supplier_listings sl ON p.supplier_listing_id = sl.id
      JOIN users u ON p.supplier_id = u.id
      LEFT JOIN supplier_profiles sp ON u.id = sp.supplier_id
      LEFT JOIN reservations r ON p.id = r.pool_id
      WHERE p.id = ?
      GROUP BY p.id, pr.id, ps.id, sl.id, u.id, sp.id`,
      [parsedPoolId]
    );

    if (!rows || rows.length === 0) return null;
    const pool = rows[0];

    // Status audit for OBS-33 fail-closed guarantee: check if any unknown statuses exist in pool
    const [statusBreakdown] = await executor.query(
      'SELECT status, SUM(quantity) AS status_qty, COUNT(*) AS status_count FROM reservations WHERE pool_id = ? GROUP BY status',
      [parsedPoolId]
    );
    let unknownDemandAdjustment = 0;
    if (statusBreakdown && statusBreakdown.length > 0) {
      for (const sb of statusBreakdown) {
        if (!['RESERVED', 'CONFIRMED', 'PAID', 'CANCELLED', 'EXPIRED'].includes(sb.status)) {
          console.warn(`[PoolProgressService] WARNING: Unknown reservation status '${sb.status}' detected in pool ${parsedPoolId}. Applying fail-closed capacity protection.`);
          unknownDemandAdjustment += Number(sb.status_qty || 0);
        }
      }
    }

    // Fetch price tiers ordered by min_qty ASC
    const [tiers] = await executor.query(
      'SELECT id, pool_id, min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
      [parsedPoolId]
    );

    // Authoritative demand vs cached drift detection policy (OBS-29 & OBS-33)
    const authoritativeQty = Number((Number(pool.authoritative_aggregate_qty) + unknownDemandAdjustment).toFixed(4));
    const cachedQty = Number(Number(pool.current_qty).toFixed(4));

    if (Math.abs(authoritativeQty - cachedQty) > 0.0001) {
      // Expose internal diagnostic without mutating GET endpoint or exposing details to buyers
      console.warn(
        `[PoolProgressService] Drift detected on pool ${pool.id} (${pool.pool_code}): ` +
        `cached current_qty (${cachedQty}) != authoritative reservation sum (${authoritativeQty}). ` +
        `Using authoritative sum as single source of truth.`
      );
    }

    // Always use authoritative reservation sum for calculations
    const progressPricing = this.calculateProgressAndPricing(pool, tiers, authoritativeQty);
    const eligibility = this.evaluateParticipationEligibility(pool, progressPricing.remaining_capacity);

    // Format unified, backward-compatible pool snapshot
    const targetQtyNum = Number(pool.target_qty);
    const maxCapNum = pool.max_capacity !== null && pool.max_capacity !== undefined
      ? Number(pool.max_capacity)
      : targetQtyNum;

    return {
      id: pool.id,
      pool_code: pool.pool_code,
      status: pool.status,
      product_id: pool.product_id,
      product_spec_id: pool.product_spec_id,
      supplier_listing_id: pool.supplier_listing_id,
      supplier_id: pool.supplier_id,
      target_qty: targetQtyNum,
      supplier_min_qty: Number(pool.supplier_min_qty),
      buyer_min_qty: Number(pool.buyer_min_qty),
      max_capacity: maxCapNum,
      pool_unit: pool.pool_unit,
      purchase_increment: Number(pool.purchase_increment),
      delivery_type: pool.delivery_type,
      delivery_zones: typeof pool.delivery_zones === 'string' ? JSON.parse(pool.delivery_zones) : pool.delivery_zones,
      delivery_fee_policy: pool.delivery_fee_policy,
      fulfilment_lead_time_days: pool.fulfilment_lead_time_days,
      cancellation_cutoff_hours: pool.cancellation_cutoff_hours,
      current_qty: authoritativeQty, // Authoritative demand
      cached_current_qty: cachedQty,
      has_quantity_drift: Math.abs(authoritativeQty - cachedQty) > 0.0001,
      current_price_per_unit: progressPricing.estimated_unit_price,
      next_tier_price: progressPricing.next_tier_price,
      expires_at: pool.expires_at,
      is_expired: Number(pool.is_expired) === 1 ? 1 : 0,
      early_close_allowed: Boolean(pool.early_close_allowed),
      supplier_confirmation_deadline: pool.supplier_confirmation_deadline,
      buyer_commitment_deadline: pool.buyer_commitment_deadline,
      closed_at: pool.closed_at,
      confirmed_at: pool.confirmed_at,
      created_at: pool.created_at,
      updated_at: pool.updated_at,

      // Authoritative Progress Metrics
      eligible_quantity: progressPricing.eligible_quantity,
      remaining_capacity: progressPricing.remaining_capacity,
      minimum_remaining: progressPricing.minimum_remaining,
      target_remaining: progressPricing.target_remaining,
      minimum_reached: progressPricing.minimum_reached,
      target_reached: progressPricing.target_reached,
      capacity_reached: progressPricing.capacity_reached,
      minimum_progress_percent: progressPricing.minimum_progress_percent,
      target_progress_percent: progressPricing.target_progress_percent,
      active_reservations_count: Number(pool.active_reservations_count),

      // Pricing Transparency
      estimated_unit_price: progressPricing.estimated_unit_price,
      pricing_mode: progressPricing.pricing_mode,
      is_conditional_pricing: progressPricing.is_conditional_pricing,
      current_tier_index: progressPricing.current_tier_index,
      next_tier_quantity: progressPricing.next_tier_quantity,
      additional_quantity_for_next_tier: progressPricing.additional_quantity_for_next_tier,

      // Participation Eligibility
      can_join: eligibility.can_join,
      participation_status: eligibility.participation_status,
      participation_reason: eligibility.participation_reason,
      is_legacy: eligibility.is_legacy,

      // Product & Supplier Details (Backward Compatibility)
      product_title: pool.product_title,
      category: pool.product_category,
      brand: pool.product_brand,
      variety: pool.product_variety,
      pack_size: pool.product_pack_size,
      unit: pool.product_unit,
      supplier_name: pool.supplier_business_name,
      supplier_area: pool.supplier_area,
      remaining_qty: Math.max(0, Number((targetQtyNum - authoritativeQty).toFixed(4))),
      fill_percentage: targetQtyNum > 0 ? Number(Math.min(100, (authoritativeQty / targetQtyNum) * 100).toFixed(1)) : 100.0,

      // Structured Specification & Supplier Object
      specification: pool.spec_id ? {
        id: pool.spec_id,
        product_title: pool.product_title,
        category: pool.product_category,
        quality_grade: pool.quality_grade,
        canonical_spec_hash: pool.canonical_spec_hash,
        packaging_type: pool.packaging_type,
        pack_unit: pool.pack_unit
      } : null,

      supplier: {
        id: pool.supplier_id,
        business_name: pool.supplier_business_name,
        verification_status: pool.supplier_user_verification_status
      },

      price_tiers: tiers.map(t => ({
        id: t.id,
        min_qty: Number(t.min_qty),
        max_qty: Number(t.max_qty),
        price_per_unit: Number(t.price_per_unit),
        pricing_unit: t.pricing_unit
      }))
    };
  }

  /**
   * Enriches an array of pools (e.g. from findAllActive) with authoritative progress & participation.
   *
   * @param {Array} pools
   * @param {Object} options
   * @returns {Promise<Array>}
   */
  async enrichPoolsList(pools, options = {}) {
    if (!pools || pools.length === 0) return [];
    const poolIds = pools.map(p => p.id);

    // Batch query: authoritative reservation sums for all pools
    const [aggRows] = await db.query(
      `SELECT pool_id, COALESCE(SUM(quantity), 0) AS authoritative_qty
       FROM reservations
       WHERE pool_id IN (?) AND status IN ('RESERVED', 'CONFIRMED', 'PAID')
       GROUP BY pool_id`,
      [poolIds]
    );
    const aggMap = new Map();
    aggRows.forEach(r => aggMap.set(r.pool_id, Number(r.authoritative_qty)));

    // Batch query: price tiers for all pools
    const [tierRows] = await db.query(
      `SELECT id, pool_id, min_qty, max_qty, price_per_unit, pricing_unit
       FROM pool_price_tiers
       WHERE pool_id IN (?)
       ORDER BY min_qty ASC`,
      [poolIds]
    );
    const tierMap = new Map();
    tierRows.forEach(t => {
      if (!tierMap.has(t.pool_id)) tierMap.set(t.pool_id, []);
      tierMap.get(t.pool_id).push(t);
    });

    return pools.map(pool => {
      const authQty = aggMap.get(pool.id) !== undefined
        ? aggMap.get(pool.id)
        : Number(pool.current_qty || 0);

      const tiers = tierMap.get(pool.id) || [];
      const progressPricing = this.calculateProgressAndPricing(pool, tiers, authQty);

      const poolWithDetails = {
        ...pool,
        supplier_role: pool.supplier_role || 'SUPPLIER',
        supplier_is_verified: pool.supplier_is_verified !== undefined ? pool.supplier_is_verified : 1,
        supplier_user_verification_status: pool.supplier_user_verification_status || 'VERIFIED',
        supplier_profile_verification_status: pool.supplier_profile_verification_status || 'VERIFIED',
        listing_status: pool.listing_status || 'ACTIVE',
        is_expired: pool.expires_at ? new Date(pool.expires_at) <= new Date() : false
      };

      const eligibility = this.evaluateParticipationEligibility(poolWithDetails, progressPricing.remaining_capacity);

      return {
        ...pool,
        current_qty: authQty,
        eligible_quantity: progressPricing.eligible_quantity,
        remaining_capacity: progressPricing.remaining_capacity,
        minimum_remaining: progressPricing.minimum_remaining,
        target_remaining: progressPricing.target_remaining,
        minimum_reached: progressPricing.minimum_reached,
        target_reached: progressPricing.target_reached,
        capacity_reached: progressPricing.capacity_reached,
        minimum_progress_percent: progressPricing.minimum_progress_percent,
        target_progress_percent: progressPricing.target_progress_percent,
        estimated_unit_price: progressPricing.estimated_unit_price,
        pricing_mode: progressPricing.pricing_mode,
        is_conditional_pricing: progressPricing.is_conditional_pricing,
        next_tier_quantity: progressPricing.next_tier_quantity,
        additional_quantity_for_next_tier: progressPricing.additional_quantity_for_next_tier,
        can_join: eligibility.can_join,
        participation_status: eligibility.participation_status,
        participation_reason: eligibility.participation_reason,
        is_legacy: eligibility.is_legacy
      };
    });
  }
}

module.exports = new PoolProgressService();
