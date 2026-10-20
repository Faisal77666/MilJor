// =============================================================================
// src/services/supplierEligibilityPolicy.js
// MilJor Part 4C.2B: Shared Supplier and Pool Eligibility Policy (OBS-34)
// Single pure helper module that ensures consistent, fail-closed eligibility
// checks across both the advisory read model (can_join) and authoritative
// mutation transactions (createReservation, updateReservation).
// =============================================================================

/**
 * Validates affirmative supplier account and profile verification.
 * Requires:
 *  - Supplier account exists
 *  - Role is strictly 'SUPPLIER'
 *  - Account is not suspended/blocked
 *  - is_verified is affirmatively 1
 *  - verification_status is affirmatively 'VERIFIED'
 *  - Supplier profile exists and verification_status is affirmatively 'VERIFIED'
 *
 * NOTE: buyer_trust_status is strictly ignored for suppliers.
 *
 * @param {Object} supplierData
 * @returns {{ eligible: boolean, code?: string, reason?: string }}
 */
function evaluateSupplierEligibility(supplierData) {
  if (!supplierData) {
    return {
      eligible: false,
      code: 'SUPPLIER_NOT_FOUND',
      reason: 'Pool supplier record is missing or deleted.'
    };
  }

  const roleOk = supplierData.role === 'SUPPLIER' || supplierData.supplier_role === 'SUPPLIER';
  if (!roleOk) {
    return {
      eligible: false,
      code: 'SUPPLIER_INELIGIBLE',
      reason: 'Associated user does not hold an authorized SUPPLIER role.'
    };
  }

  const userStatus = supplierData.verification_status || supplierData.supplier_user_verification || supplierData.supplier_user_verification_status;
  const isVerifiedNum = supplierData.is_verified !== undefined ? Number(supplierData.is_verified) : Number(supplierData.supplier_is_verified);

  if (isVerifiedNum !== 1 || userStatus !== 'VERIFIED') {
    return {
      eligible: false,
      code: 'SUPPLIER_INELIGIBLE',
      reason: 'Supplier user account is pending verification or unapproved by MilJor Operations.'
    };
  }

  const profileStatus = supplierData.supplier_profile_verification || supplierData.supplier_profile_verification_status || supplierData.profile_verification_status;
  if (profileStatus !== 'VERIFIED') {
    return {
      eligible: false,
      code: 'SUPPLIER_INELIGIBLE',
      reason: 'Supplier business profile is not verified.'
    };
  }

  return { eligible: true };
}

/**
 * Validates that an underlying supplier listing is active and matches the pool specification.
 *
 * @param {Object} pool
 * @param {Object} listing
 * @returns {{ eligible: boolean, code?: string, reason?: string }}
 */
function evaluateListingEligibility(pool, listing) {
  const listingId = pool.supplier_listing_id || (listing ? listing.id : null);
  const listingStatus = listing ? listing.status : pool.listing_status;
  const listingSpecId = listing ? (listing.product_spec_id || listing.spec_id) : (pool.listing_product_spec_id || pool.listing_spec_id);
  const poolSpecId = pool.product_spec_id;

  if (!listingId || listingStatus !== 'ACTIVE') {
    return {
      eligible: false,
      code: 'LISTING_INACTIVE',
      reason: `Underlying supplier listing is ${listingStatus || 'missing'}.`
    };
  }

  if (poolSpecId && listingSpecId && Number(poolSpecId) !== Number(listingSpecId)) {
    return {
      eligible: false,
      code: 'SPECIFICATION_MISMATCH',
      reason: 'Pool product specification does not match underlying supplier listing.'
    };
  }

  return { eligible: true };
}

/**
 * Pure helper combining all participation criteria for Regular Pools.
 * Used by read model (advisory) and transactional guards (authoritative).
 *
 * @param {Object} pool - Joined pool row with spec, listing, and supplier fields
 * @param {number} remainingCapacity
 * @returns {{ can_join: boolean, participation_status: string, participation_reason: string|null, is_legacy: number }}
 */
function evaluatePoolParticipationEligibility(pool, remainingCapacity) {
  const isLegacy = (!pool.product_spec_id || !pool.supplier_listing_id) ? 1 : 0;
  const isExpired = Boolean(pool.is_expired);
  const buyerMin = Number(pool.buyer_min_qty || 1);

  // 1. Legacy pool protection (OBS-24)
  if (isLegacy) {
    return {
      can_join: false,
      participation_status: 'LEGACY_NOT_AVAILABLE_FOR_NEW_RESERVATIONS',
      participation_reason: 'Historical pool lacks verified product specification identity and is closed to new buyer reservations.',
      is_legacy: 1
    };
  }

  // 2. Pool lifecycle status
  if (pool.status !== 'ACTIVE') {
    return {
      can_join: false,
      participation_status: 'POOL_NOT_ACTIVE',
      participation_reason: `Pool is currently in '${pool.status}' status and is not accepting reservations.`,
      is_legacy: 0
    };
  }

  // 3. Authoritative temporal expiry (OBS-22)
  if (isExpired) {
    return {
      can_join: false,
      participation_status: 'POOL_EXPIRED',
      participation_reason: 'Pool participation deadline has passed according to authoritative server time.',
      is_legacy: 0
    };
  }

  // 4. Capacity bounds
  if (remainingCapacity <= 0 || remainingCapacity < buyerMin) {
    return {
      can_join: false,
      participation_status: 'CAPACITY_REACHED',
      participation_reason: 'Pool has reached maximum capacity or remaining capacity is below minimum order requirement.',
      is_legacy: 0
    };
  }

  // 5. Supplier affirmative verification (OBS-21 & OBS-34)
  const suppEval = evaluateSupplierEligibility(pool);
  if (!suppEval.eligible) {
    return {
      can_join: false,
      participation_status: suppEval.code,
      participation_reason: suppEval.reason,
      is_legacy: 0
    };
  }

  // 6. Listing & specification integrity (OBS-34)
  const listEval = evaluateListingEligibility(pool, null);
  if (!listEval.eligible) {
    return {
      can_join: false,
      participation_status: listEval.code,
      participation_reason: listEval.reason,
      is_legacy: 0
    };
  }

  return {
    can_join: true,
    participation_status: 'ACTIVE_PURCHASABLE',
    participation_reason: null,
    is_legacy: 0
  };
}

module.exports = {
  evaluateSupplierEligibility,
  evaluateListingEligibility,
  evaluatePoolParticipationEligibility
};
