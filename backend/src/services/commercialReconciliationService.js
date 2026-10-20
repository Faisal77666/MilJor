// =============================================================================
// src/services/commercialReconciliationService.js
// MilJor Part 4E.1 / Part 4E.1.1: Order Architecture, Commercial Reconciliation
// & Exact Financial Safety Foundation (OBS-71, 72, 73, 74, 75, 76, 77, 78)
//
// Read-only authoritative reconciliation service evaluating whether an accepted
// buyer commercial commitment is ready for future order creation.
//
// Hardened in Part 4E.1.1:
// 1. Exact decimal monetary arithmetic via BigInt scaled-integer math (OBS-75)
// 2. Strict canonical equality comparison without arbitrary tolerance (OBS-76)
// 3. Multi-query consistent read snapshot in REPEATABLE READ isolation (OBS-77)
// 4. Accurate, fail-closed tax and fee classification (OBS-78)
//
// Invariants enforced:
// 1. Correctness > Data Safety > Security > Financial Integrity > Maintainability
// 2. Zero live order creation, zero payment intents, zero ledger mutations in this phase.
// 3. Exact decimal arithmetic, controlled rounding, fail-closed quorum validation.
// 4. Absolute tenant isolation: buyers only evaluate their own reservations.
// =============================================================================

const db = require('../config/db');
const { isValidStatus } = require('./reservationDemandPolicy');
const {
  toCanonical,
  exactMultiplyRound,
  exactDecimalEquals,
  exactDecimalGte
} = require('./exactDecimal');

class CommercialReconciliationService {

  /**
   * Evaluates order-handoff readiness for a specific reservation.
   * Read-only: Executes under a single consistent REPEATABLE READ snapshot.
   * Does NOT mutate any pool, reservation, snapshot, decision, or order rows.
   *
   * @param {Object} params
   * @param {number} params.reservationId - ID of target reservation
   * @param {Object} params.actor - Authenticated caller { id, role, buyer_trust_status }
   * @param {Object} [params.testHooks] - Internal test hooks for concurrency simulation
   * @returns {Promise<Object>} Structured readiness evaluation
   */
  async evaluateOrderReadiness({ reservationId, actor, testHooks = null }) {
    if (!reservationId || isNaN(reservationId)) {
      const err = new Error('Valid numeric reservation ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id) {
      const err = new Error('Authentication required');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    // OBS-77: Acquire dedicated connection and establish consistent read snapshot
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');

      // 1. Fetch reservation
      const [resRows] = await connection.query(
        `SELECT r.*, p.pool_code, p.status AS pool_status, p.product_spec_id, 
                p.supplier_listing_id, p.pool_unit, p.delivery_type, p.delivery_zones, 
                p.delivery_fee_policy, p.supplier_id, p.supplier_min_qty, p.target_qty,
                (p.expires_at <= NOW()) AS pool_expired
         FROM reservations r
         JOIN pools p ON r.pool_id = p.id
         WHERE r.id = ?`,
        [reservationId]
      );

      if (!resRows || resRows.length === 0) {
        const err = new Error(`Reservation with ID ${reservationId} not found`);
        err.code = 'RESERVATION_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const reservation = resRows[0];
      const poolId = reservation.pool_id;

      // 2. Security & Tenant Ownership within the transaction
      if (actor.role === 'BUYER') {
        if (Number(reservation.buyer_id) !== Number(actor.id)) {
          const err = new Error('You can only inspect order readiness for your own reservations');
          err.code = 'FORBIDDEN';
          err.statusCode = 403;
          throw err;
        }
      } else if (actor.role === 'SUPPLIER') {
        if (Number(reservation.supplier_id) !== Number(actor.id)) {
          const err = new Error('Suppliers can only inspect order readiness for their own pools');
          err.code = 'FORBIDDEN';
          err.statusCode = 403;
          throw err;
        }
      } else if (!['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) {
        const err = new Error('Unauthorized role for order readiness inspection');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Live buyer trust check within consistent snapshot
      const [buyerRows] = await connection.query(
        `SELECT id, buyer_trust_status FROM users WHERE id = ?`,
        [reservation.buyer_id]
      );
      if (buyerRows[0] && buyerRows[0].buyer_trust_status === 'SUSPENDED') {
        const err = new Error('Buyer account is suspended');
        err.code = 'ACCOUNT_SUSPENDED';
        err.statusCode = 403;
        throw err;
      }

      // Legacy pool fail-closed
      if (Number(poolId) === 1 || Number(poolId) === 2) {
        return this._formatBlockedResponse({
          reservation,
          reasonCodes: ['LEGACY_POOL_READ_ONLY'],
          message: 'Historical legacy pools (ID 1, 2) are permanently read-only and cannot generate commercial orders'
        });
      }

      // 3. Fetch latest qualification snapshot
      const [snapshots] = await connection.query(
        `SELECT * FROM pool_commercial_snapshots 
         WHERE pool_id = ? 
         ORDER BY snapshot_version DESC LIMIT 1`,
        [poolId]
      );
      const snapshot = snapshots[0] || null;

      if (!snapshot) {
        return this._formatBlockedResponse({
          reservation,
          reasonCodes: ['NO_COMMERCIAL_SNAPSHOT'],
          message: 'No commercial qualification snapshot exists for this pool'
        });
      }

      // Verify snapshot qualification status
      const validQualStatuses = ['QUALIFIED', 'TARGET_MET', 'CAPACITY_MET'];
      if (!validQualStatuses.includes(snapshot.qualification_status)) {
        return this._formatBlockedResponse({
          reservation,
          snapshot,
          reasonCodes: ['POOL_NOT_QUALIFIED'],
          message: `Pool qualification status is ${snapshot.qualification_status}`
        });
      }

      // 4. Fetch supplier decision
      const [suppDecisions] = await connection.query(
        `SELECT * FROM pool_supplier_commercial_decisions 
         WHERE pool_id = ? AND snapshot_id = ? 
         ORDER BY id DESC LIMIT 1`,
        [poolId, snapshot.id]
      );
      const suppDecision = suppDecisions[0] || null;

      if (!suppDecision || suppDecision.decision !== 'ACCEPT') {
        const reasonCode = !suppDecision ? 'SUPPLIER_DECISION_PENDING' : 'SUPPLIER_OFFER_REJECTED';
        return this._formatBlockedResponse({
          reservation,
          snapshot,
          suppDecision,
          reasonCodes: [reasonCode],
          message: !suppDecision 
            ? 'Supplier confirmation decision is still pending' 
            : `Supplier rejected commercial terms (${suppDecision.rejection_reason_code || 'REJECTED'})`
        });
      }

      // 5. Fetch buyer immutable decision
      const [buyerDecisions] = await connection.query(
        `SELECT * FROM pool_buyer_commercial_decisions
         WHERE reservation_id = ? AND snapshot_id = ?
         ORDER BY id DESC LIMIT 1`,
        [reservationId, snapshot.id]
      );
      const buyerDecision = buyerDecisions[0] || null;

      if (!buyerDecision || buyerDecision.decision !== 'ACCEPT') {
        const reasonCode = !buyerDecision ? 'BUYER_DECISION_PENDING' : 'BUYER_OFFER_DECLINED';
        return this._formatBlockedResponse({
          reservation,
          snapshot,
          suppDecision,
          buyerDecision,
          reasonCodes: [reasonCode],
          message: !buyerDecision
            ? 'Buyer has not yet submitted an explicit commercial acceptance decision'
            : `Buyer declined commercial offer (${buyerDecision.decline_reason_code || 'DECLINED'})`
        });
      }

      // 6. Reservation status validation (OBS-71)
      if (!isValidStatus(reservation.status)) {
        return this._formatBlockedResponse({
          reservation,
          snapshot,
          suppDecision,
          buyerDecision,
          reasonCodes: ['UNKNOWN_RESERVATION_STATUS'],
          message: `Reservation status '${reservation.status}' is unrecognized (fail-closed)`
        });
      }

      if (reservation.status !== 'CONFIRMED') {
        return this._formatBlockedResponse({
          reservation,
          snapshot,
          suppDecision,
          buyerDecision,
          reasonCodes: ['RESERVATION_NOT_CONFIRMED'],
          message: `Reservation status is '${reservation.status}'; must be 'CONFIRMED' for order readiness`
        });
      }

      // 7. Check for already existing orders (Exactly-Once Invariant)
      const [existingOrders] = await connection.query(
        `SELECT id, order_code, order_status, payment_status, total_qty, total_amount, created_at 
         FROM orders 
         WHERE buyer_decision_id = ? OR reservation_id = ?
         LIMIT 1`,
        [buyerDecision.id, reservationId]
      );

      if (existingOrders && existingOrders.length > 0) {
        const existingOrder = existingOrders[0];
        return {
          eligible_for_order: false,
          reason_codes: ['ORDER_ALREADY_CONVERTED'],
          message: `Order ${existingOrder.order_code} has already been created for this buyer commitment`,
          existing_order: {
            id: existingOrder.id,
            order_code: existingOrder.order_code,
            order_status: existingOrder.order_status,
            payment_status: existingOrder.payment_status,
            total_qty: Number(existingOrder.total_qty),
            total_amount: Number(existingOrder.total_amount),
            created_at: existingOrder.created_at
          },
          reservation_id: reservation.id,
          buyer_decision_id: buyerDecision.id
        };
      }

      // Optional test hook for deterministic concurrency testing (OBS-77 / OBS-80)
      // Strictly isolated to test environment; ignored fail-safe in production/development
      if (process.env.NODE_ENV === 'test' && testHooks && typeof testHooks.beforeDemandQuery === 'function') {
        await testHooks.beforeDemandQuery();
      }

      // 8. Financial components and exact price check (OBS-72, OBS-73, OBS-75, OBS-76)
      const rawQty = reservation.quantity;
      const rawLockedUnitPrice = reservation.locked_unit_price;
      const rawLockedTotalPrice = reservation.locked_total_price;
      const rawSnapshotPrice = snapshot.candidate_unit_price;

      // Validate decimal representation & non-zero price locking
      if (!rawLockedUnitPrice || !rawLockedTotalPrice) {
        return this._formatBlockedResponse({
          reservation,
          snapshot,
          suppDecision,
          buyerDecision,
          reasonCodes: ['PRICE_LOCK_INCOMPLETE'],
          message: 'Reservation price locking is incomplete or missing'
        });
      }

      let expectedSubtotalStr;
      try {
        expectedSubtotalStr = exactMultiplyRound(rawQty, rawLockedUnitPrice, 2);
      } catch (err) {
        return this._formatBlockedResponse({
          reservation,
          snapshot,
          suppDecision,
          buyerDecision,
          reasonCodes: ['PRICE_LOCK_INCOMPLETE'],
          message: `Invalid decimal format in reservation pricing: ${err.message}`
        });
      }

      // Exact canonical comparison for locked subtotal (OBS-75, OBS-76)
      if (!exactDecimalEquals(rawLockedTotalPrice, expectedSubtotalStr, 2)) {
        return this._formatBlockedResponse({
          reservation,
          snapshot,
          suppDecision,
          buyerDecision,
          reasonCodes: ['SUBTOTAL_CALCULATION_MISMATCH'],
          message: `Locked total price (${toCanonical(rawLockedTotalPrice, 2)}) does not match exact subtotal calculation (${expectedSubtotalStr})`
        });
      }

      // Exact canonical comparison between locked unit price and qualification snapshot price
      if (!exactDecimalEquals(rawLockedUnitPrice, rawSnapshotPrice, 2)) {
        return this._formatBlockedResponse({
          reservation,
          snapshot,
          suppDecision,
          buyerDecision,
          reasonCodes: ['SNAPSHOT_PRICE_DISCREPANCY'],
          message: `Reservation locked unit price (${toCanonical(rawLockedUnitPrice, 2)}) diverges from qualification snapshot price (${toCanonical(rawSnapshotPrice, 2)})`
        });
      }

      // 9. Quorum & Final Demand Accounting within consistent snapshot (OBS-71, 74, 77)
      const [buyerDecRows] = await connection.query(
        `SELECT decision, 
                COALESCE(SUM(accepted_quantity), 0) AS total_qty,
                COUNT(*) AS decision_count
         FROM pool_buyer_commercial_decisions
         WHERE pool_id = ? AND snapshot_id = ?
         GROUP BY decision`,
        [poolId, snapshot.id]
      );

      let buyerAcceptedDemand = 0;
      let buyerAcceptedCount = 0;
      let buyerDeclinedDemand = 0;
      let buyerDeclinedCount = 0;

      buyerDecRows.forEach(row => {
        if (row.decision === 'ACCEPT') {
          buyerAcceptedDemand = Number(Number(row.total_qty).toFixed(4));
          buyerAcceptedCount = Number(row.decision_count);
        } else if (row.decision === 'DECLINE') {
          buyerDeclinedDemand = Number(Number(row.total_qty).toFixed(4));
          buyerDeclinedCount = Number(row.decision_count);
        }
      });

      const originalQualifiedDemand = Number(Number(snapshot.eligible_aggregate_qty).toFixed(4));
      const totalOriginalCount = Number(snapshot.participating_reservations_count);
      const buyerPendingDemand = Math.max(0, Number((originalQualifiedDemand - (buyerAcceptedDemand + buyerDeclinedDemand)).toFixed(4)));
      const buyerPendingCount = Math.max(0, totalOriginalCount - (buyerAcceptedCount + buyerDeclinedCount));
      const supplierMinQty = Number(Number(snapshot.supplier_min_qty).toFixed(4));

      // Check authoritative deadline status from DB server within transaction
      const [deadlineRows] = await connection.query(
        `SELECT (NOW() > ?) AS is_deadline_expired`,
        [snapshot.buyer_commitment_deadline]
      );
      const isDeadlineExpired = Boolean(deadlineRows[0] && deadlineRows[0].is_deadline_expired);

      // Evaluate Quorum Status (OBS-74)
      const reasonCodes = [];
      let eligibleForOrder = false;
      let pricingGuaranteeStatus = 'QUORUM_VERIFIED';

      const isQuorumMet = exactDecimalGte(buyerAcceptedDemand, supplierMinQty, 4);

      if (isQuorumMet) {
        // Quorum met! Approved final-demand minimum satisfied
        eligibleForOrder = true;
        reasonCodes.push('ELIGIBLE_FOR_ORDER');
        pricingGuaranteeStatus = 'QUORUM_VERIFIED';
      } else {
        // Demand is currently below supplier minimum
        if (!isDeadlineExpired && buyerPendingCount > 0) {
          // Still awaiting remaining cohort buyers
          eligibleForOrder = false;
          reasonCodes.push('BUYER_COMMITMENTS_PENDING');
          pricingGuaranteeStatus = 'PENDING_COHORT_COMPLETION';
        } else {
          // Deadline expired or all buyers decided, and demand is below supplier minimum!
          // OBS-72 / OBS-74: Without an explicit supplier shortfall guarantee, fail-closed.
          eligibleForOrder = false;
          reasonCodes.push('FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM');
          pricingGuaranteeStatus = 'UNSUPPORTED_SHORTFALL';
        }
      }

      // 10. Financial components categorization (OBS-73, OBS-78)
      // reservations.locked_total_price is STRICTLY the merchandise subtotal
      const deliveryType = reservation.delivery_type || snapshot.delivery_type || 'DOORSTEP';
      let deliveryFeeStatus = 'PENDING_QUOTE';
      let estimatedDeliveryFee = null;

      if (deliveryType === 'SUPPLIER_PICKUP') {
        deliveryFeeStatus = 'DETERMINED_ZERO';
        estimatedDeliveryFee = 0.00;
      } else if (reservation.delivery_fee_policy) {
        deliveryFeeStatus = 'PENDING_QUOTE';
      }

      const lockedQty = Number(reservation.quantity);
      const lockedUnitPrice = Number(reservation.locked_unit_price);
      const lockedTotalPrice = Number(reservation.locked_total_price);

      return {
        eligible_for_order: eligibleForOrder,
        reason_codes: reasonCodes,
        qualification_snapshot_id: snapshot.id,
        snapshot_version: snapshot.snapshot_version,
        supplier_decision_id: suppDecision.id,
        buyer_decision_id: buyerDecision.id,
        reservation_id: reservation.id,
        pool_id: poolId,
        buyer_id: reservation.buyer_id,
        locked_quantity: lockedQty,
        locked_unit_price: lockedUnitPrice,
        merchandise_subtotal: lockedTotalPrice,
        currency: 'PKR',
        final_committed_demand: buyerAcceptedDemand,
        minimum_required_demand: supplierMinQty,
        financial_components_status: 'MERCHANDISE_SUBTOTAL_LOCKED',
        pricing_guarantee_status: pricingGuaranteeStatus,
        financial_breakdown: {
          locked_quantity: lockedQty,
          locked_unit_price: lockedUnitPrice,
          merchandise_subtotal: lockedTotalPrice,
          delivery_type: deliveryType,
          delivery_fee_policy: reservation.delivery_fee_policy || null,
          delivery_fee_status: deliveryFeeStatus,
          estimated_delivery_fee: estimatedDeliveryFee,
          buyer_platform_fee_status: 'PENDING_ORDER_GENERATION',
          tax_status: 'PENDING_DETERMINATION',
          payable_total_status: 'REQUIRES_FEE_COMPOSITION_AT_ORDER_CREATION'
        },
        accounting: {
          original_qualified_demand: originalQualifiedDemand,
          original_reservations_count: totalOriginalCount,
          buyer_accepted_demand: buyerAcceptedDemand,
          buyer_accepted_count: buyerAcceptedCount,
          buyer_declined_demand: buyerDeclinedDemand,
          buyer_declined_count: buyerDeclinedCount,
          buyer_pending_demand: buyerPendingDemand,
          buyer_pending_count: buyerPendingCount,
          supplier_min_qty: supplierMinQty,
          quorum_met: isQuorumMet
        },
        lifecycle: {
          pool_status: reservation.pool_status,
          reservation_status: reservation.status,
          supplier_decision: suppDecision.decision,
          buyer_decision: buyerDecision.decision,
          is_deadline_expired: isDeadlineExpired,
          buyer_commitment_deadline: snapshot.buyer_commitment_deadline
        }
      };

    } finally {
      // Always roll back read-only transaction and release connection (OBS-77)
      try {
        await connection.rollback();
      } catch (rbErr) {
        // ignore rollback errors on released connection
      }
      connection.release();
    }
  }

  /**
   * Helper formatting standard fail-closed blocked response.
   * @private
   */
  _formatBlockedResponse({ reservation, snapshot, suppDecision, buyerDecision, reasonCodes, message }) {
    return {
      eligible_for_order: false,
      reason_codes: reasonCodes,
      message: message,
      qualification_snapshot_id: snapshot ? snapshot.id : null,
      supplier_decision_id: suppDecision ? suppDecision.id : null,
      buyer_decision_id: buyerDecision ? buyerDecision.id : null,
      reservation_id: reservation ? reservation.id : null,
      pool_id: reservation ? reservation.pool_id : null,
      buyer_id: reservation ? reservation.buyer_id : null,
      locked_quantity: reservation ? Number(reservation.quantity) : null,
      locked_unit_price: reservation && reservation.locked_unit_price ? Number(reservation.locked_unit_price) : null,
      merchandise_subtotal: reservation && reservation.locked_total_price ? Number(reservation.locked_total_price) : null,
      currency: 'PKR',
      financial_components_status: 'INCOMPLETE_OR_BLOCKED',
      pricing_guarantee_status: 'NOT_EVALUATED'
    };
  }
}

module.exports = new CommercialReconciliationService();
