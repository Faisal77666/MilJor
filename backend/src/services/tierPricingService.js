// =============================================================================
// src/services/tierPricingService.js
// MilJor Regular Pool Tier Pricing Engine
// Validates continuous non-overlapping intervals, monotonic non-increasing prices,
// exact decimal pricing calculations, and deterministic price tier evaluation.
// =============================================================================

const unitConversionService = require('./unitConversionService');

class TierPricingService {
  /**
   * Validates a set of pool price tiers against commercial boundaries.
   *
   * Rules:
   * 1. Must have at least 1 tier.
   * 2. First tier min_qty must equal pool supplier_min_qty.
   * 3. Last tier max_qty must cover at least target_qty (and max_capacity if specified).
   * 4. For each tier:
   *    - min_qty > 0, max_qty >= min_qty
   *    - price_per_unit > 0
   * 5. Non-overlapping, perfectly contiguous intervals:
   *    - tier[k].min_qty === tier[k-1].max_qty + increment (for discrete/incremented)
   *      or tier[k].min_qty === tier[k-1].max_qty (for continuous decimal)
   * 6. Strictly non-increasing pricing: tier[k].price <= tier[k-1].price
   * 7. Pricing unit must match the pool's calculation unit.
   *
   * @param {Array} tiers
   * @param {Object} poolConfig { supplier_min_qty, target_qty, max_capacity, pool_unit, purchase_increment }
   * @returns {{ valid: boolean, error?: { code: string, message: string }, normalizedTiers?: Array }}
   */
  validateTiers(tiers, poolConfig = {}) {
    if (!tiers || !Array.isArray(tiers) || tiers.length === 0) {
      return {
        valid: false,
        error: {
          code: 'TIERS_REQUIRED',
          message: 'At least one price tier is required'
        }
      };
    }

    const supplierMin = Number(poolConfig.supplier_min_qty);
    const targetQty = Number(poolConfig.target_qty);
    const maxCapacity = poolConfig.max_capacity !== undefined && poolConfig.max_capacity !== null
      ? Number(poolConfig.max_capacity)
      : null;
    const poolUnit = poolConfig.pool_unit
      ? unitConversionService.normalizeUnit(poolConfig.pool_unit)
      : 'pack';
    const increment = poolConfig.purchase_increment !== undefined && poolConfig.purchase_increment !== null
      ? Number(poolConfig.purchase_increment)
      : 1.0;
    const isDiscrete = unitConversionService.isDiscreteUnit(poolUnit);

    // Sort tiers ascending by min_qty
    const sorted = [...tiers].sort((a, b) => Number(a.min_qty) - Number(b.min_qty));
    const normalized = [];

    for (let i = 0; i < sorted.length; i++) {
      const raw = sorted[i];
      const minQty = Number(raw.min_qty);
      const maxQty = Number(raw.max_qty);
      const price = Number(raw.price_per_unit);
      const tierUnit = raw.pricing_unit
        ? unitConversionService.normalizeUnit(raw.pricing_unit)
        : poolUnit;

      // Basic numeric validation
      if (isNaN(minQty) || minQty <= 0) {
        return {
          valid: false,
          error: {
            code: 'INVALID_TIER_MIN_QTY',
            message: `Tier ${i + 1}: min_qty must be a strictly positive number`
          }
        };
      }

      if (isNaN(maxQty) || maxQty <= 0) {
        return {
          valid: false,
          error: {
            code: 'INVALID_TIER_MAX_QTY',
            message: `Tier ${i + 1}: max_qty must be a strictly positive number`
          }
        };
      }

      if (maxQty < minQty) {
        return {
          valid: false,
          error: {
            code: 'INVALID_TIER_RANGE',
            message: `Tier ${i + 1}: max_qty (${maxQty}) cannot be less than min_qty (${minQty})`
          }
        };
      }

      if (isNaN(price) || price <= 0) {
        return {
          valid: false,
          error: {
            code: 'INVALID_TIER_PRICE',
            message: `Tier ${i + 1}: price_per_unit must be greater than zero`
          }
        };
      }

      // Discrete packaging indivisibility check
      if (isDiscrete) {
        if (!Number.isInteger(minQty) || !Number.isInteger(maxQty)) {
          return {
            valid: false,
            error: {
              code: 'FRACTIONAL_TIER_QUANTITY',
              message: `Tier ${i + 1}: Packaging unit '${poolUnit}' is indivisible and does not allow fractional quantities`
            }
          };
        }
      }

      // Unit compatibility check
      if (tierUnit !== poolUnit) {
        return {
          valid: false,
          error: {
            code: 'TIER_UNIT_MISMATCH',
            message: `Tier ${i + 1}: pricing_unit '${tierUnit}' must match pool_unit '${poolUnit}'`
          }
        };
      }

      // Monotonic non-increasing price rule: tier[k].price <= tier[k-1].price
      if (i > 0) {
        const prevPrice = normalized[i - 1].price_per_unit;
        if (price > prevPrice) {
          return {
            valid: false,
            error: {
              code: 'NON_MONOTONIC_PRICING',
              message: `Tier ${i + 1}: price_per_unit (${price}) cannot exceed previous tier price (${prevPrice}). Higher volume tiers must offer equal or lower prices.`
            }
          };
        }

        // Contiguity and non-overlapping interval check
        const prevMax = normalized[i - 1].max_qty;
        // Allowed next min_qty: either prevMax (continuous) or prevMax + increment / 1 (discrete/stepped)
        const expectedContiguousMinA = prevMax;
        const expectedContiguousMinB = isDiscrete ? prevMax + 1 : prevMax + increment;

        const matchesA = Math.abs(minQty - expectedContiguousMinA) < 0.0001;
        const matchesB = Math.abs(minQty - expectedContiguousMinB) < 0.0001;

        if (minQty < prevMax) {
          return {
            valid: false,
            error: {
              code: 'OVERLAPPING_TIERS',
              message: `Tier ${i + 1} overlaps with Tier ${i}: min_qty (${minQty}) is less than previous max_qty (${prevMax})`
            }
          };
        }

        if (!matchesA && !matchesB && minQty > prevMax) {
          return {
            valid: false,
            error: {
              code: 'TIER_GAP_DETECTED',
              message: `Tier gap detected between Tier ${i} (max_qty: ${prevMax}) and Tier ${i + 1} (min_qty: ${minQty}). Tiers must form a continuous interval.`
            }
          };
        }
      }

      normalized.push({
        min_qty: Number(minQty.toFixed(4)),
        max_qty: Number(maxQty.toFixed(4)),
        price_per_unit: Number(price.toFixed(4)),
        pricing_unit: tierUnit
      });
    }

    // First tier must start at or before supplier_min_qty
    if (!isNaN(supplierMin) && supplierMin > 0) {
      if (normalized[0].min_qty > supplierMin) {
        return {
          valid: false,
          error: {
            code: 'TIER_START_MISMATCH',
            message: `First tier min_qty (${normalized[0].min_qty}) cannot be higher than supplier_min_qty (${supplierMin}). Tiers must cover starting order threshold.`
          }
        };
      }
    }

    // Last tier must cover required upper bound (max_capacity if specified, otherwise target_qty)
    const requiredUpperBound = maxCapacity !== null && maxCapacity > 0 ? maxCapacity : targetQty;
    if (!isNaN(requiredUpperBound) && requiredUpperBound > 0) {
      const lastTierMax = normalized[normalized.length - 1].max_qty;
      if (lastTierMax < requiredUpperBound) {
        return {
          valid: false,
          error: {
            code: 'INSUFFICIENT_TIER_COVERAGE',
            message: `Last tier max_qty (${lastTierMax}) is less than required capacity/target (${requiredUpperBound}). Tiers must cover the full pool lifecycle range.`
          }
        };
      }
    }

    return {
      valid: true,
      normalizedTiers: normalized
    };
  }

  /**
   * Computes the applicable unit price for a given aggregate quantity.
   * If currentQty < supplier_min_qty, returns initial tier 1 price (or null).
   *
   * @param {Array} tiers
   * @param {number} currentQty
   * @param {number} supplierMinQty
   * @returns {{ price: number, tierIndex: number, nextTier: Object|null }}
   */
  calculateApplicablePrice(tiers, currentQty, supplierMinQty = 0) {
    if (!tiers || tiers.length === 0) {
      throw new Error('No price tiers provided');
    }

    const sorted = [...tiers].sort((a, b) => Number(a.min_qty) - Number(b.min_qty));
    const qty = Number(currentQty) || 0;

    // If below first tier, return tier 1 price as starting price
    if (qty < Number(sorted[0].min_qty)) {
      return {
        price: Number(sorted[0].price_per_unit),
        tierIndex: 0,
        nextTier: sorted.length > 1 ? sorted[1] : null,
        isQualified: false
      };
    }

    let matchingIndex = 0;
    for (let i = 0; i < sorted.length; i++) {
      const min = Number(sorted[i].min_qty);
      const max = Number(sorted[i].max_qty);
      if (qty >= min && qty <= max) {
        matchingIndex = i;
        break;
      }
      if (qty > max) {
        matchingIndex = i; // If exceeds tier max, keep highest reached
      }
    }

    const currentTier = sorted[matchingIndex];
    const nextTier = matchingIndex < sorted.length - 1 ? sorted[matchingIndex + 1] : null;

    return {
      price: Number(currentTier.price_per_unit),
      tierIndex: matchingIndex,
      nextTier,
      isQualified: qty >= (Number(supplierMinQty) || Number(sorted[0].min_qty))
    };
  }
}

module.exports = new TierPricingService();
