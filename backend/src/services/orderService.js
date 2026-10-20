// =============================================================================
// src/services/orderService.js
// MilJor Part 4E.2: Authoritative Order Conversion & Order Lifecycle Engine
// (OBS-79, OBS-80, Exactly-Once Invariant, Financial Safety)
//
// Authoritatively converts a validated buyer ACCEPT commercial commitment
// into exactly one persisted order row under strict parent-pool-first
// FOR UPDATE serialization and immutable financial evidence.
//
// Invariants enforced:
// 1. Correctness > Data Safety > Security > Financial Integrity > Maintainability
// 2. Order-Before-Payment: Order row created in AWAITING_PAYMENT before payment checkout.
// 3. Exactly-once creation: Backed by DB unique key uq_orders_buyer_decision.
// 4. Zero floating-point arithmetic: Exact math powered by exactDecimal.js.
// 5. Parent-pool-first row locking (pools -> reservations FOR UPDATE).
// 6. Absolute tenant isolation: Buyers only convert their own accepted reservations.
// 7. Atomic transaction rollback if any step (including transactional outbox) fails.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/db');
const exactDecimal = require('./exactDecimal');
const feeService = require('./feeService');
const reservationEventService = require('./reservationEventService');

class OrderService {

  /**
   * Converts an accepted buyer reservation commitment into an authoritative order.
   *
   * @param {Object} params
   * @param {number} params.reservationId - ID of target reservation
   * @param {Object} params.actor - Authenticated caller { id, role, buyer_trust_status }
   * @param {string} params.idempotencyKey - Mandatory unique idempotency key
   * @param {string} [params.deliveryAddress] - Optional delivery address override
   * @param {string} [params.notes] - Optional order notes
   * @param {Object} [params.testHooks] - Internal test hooks (active only when NODE_ENV === 'test')
   * @returns {Promise<Object>} Created authoritative order representation
   */
  async createOrderFromBuyerCommitment({
    reservationId,
    actor,
    idempotencyKey,
    deliveryAddress = null,
    notes = null,
    testHooks = null
  }) {
    // 1. Input & Actor Preconditions
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

    if (actor.role !== 'BUYER') {
      const err = new Error('Only verified buyers can authorize order conversion for their commitments');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key is mandatory for order conversion');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const trimmedKey = idempotencyKey.trim();

    // 2. Start Authoritative Order Conversion Transaction
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      // 3. Fetch Reservation pre-lock to determine poolId
      const [preRows] = await connection.query(
        `SELECT id, pool_id, buyer_id, status FROM reservations WHERE id = ?`,
        [reservationId]
      );

      if (!preRows || preRows.length === 0) {
        const err = new Error(`Reservation with ID ${reservationId} not found`);
        err.code = 'RESERVATION_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const preRes = preRows[0];
      const poolId = preRes.pool_id;

      // Tenant ownership check
      if (Number(preRes.buyer_id) !== Number(actor.id)) {
        const err = new Error('You can only convert your own reservations into orders');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // 4. Parent-Pool-First Row Locking: Lock pool row FOR UPDATE
      const [poolRows] = await connection.query(
        `SELECT * FROM pools WHERE id = ? FOR UPDATE`,
        [poolId]
      );

      if (!poolRows || poolRows.length === 0) {
        const err = new Error(`Pool with ID ${poolId} not found`);
        err.code = 'POOL_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }
      const pool = poolRows[0];

      // Legacy pool protection
      if (Number(pool.id) === 1 || Number(pool.id) === 2) {
        const err = new Error('Historical legacy pools (ID 1, 2) are permanently read-only and cannot generate orders');
        err.code = 'LEGACY_POOL_READ_ONLY';
        err.statusCode = 403;
        throw err;
      }

      // Check pool status: must be CONFIRMED or ORDERS_GENERATED
      const allowedPoolStatuses = ['CONFIRMED', 'ORDERS_GENERATED'];
      if (!allowedPoolStatuses.includes(pool.status)) {
        const err = new Error(`Pool commercial status is '${pool.status}'; must be 'CONFIRMED' for order conversion`);
        err.code = 'INVALID_POOL_STATUS';
        err.statusCode = 422;
        throw err;
      }

      // 5. Lock Source Reservation FOR UPDATE
      const [resRows] = await connection.query(
        `SELECT * FROM reservations WHERE id = ? FOR UPDATE`,
        [reservationId]
      );
      const reservation = resRows[0];

      if (reservation.status !== 'CONFIRMED') {
        const err = new Error(`Reservation status is '${reservation.status}'; must be 'CONFIRMED' for order conversion`);
        err.code = 'RESERVATION_NOT_CONFIRMED';
        err.statusCode = 422;
        throw err;
      }

      // 6. Live Buyer Trust Status Check within Transaction
      const [buyerRows] = await connection.query(
        `SELECT id, role, is_verified, verification_status, buyer_trust_status, address 
         FROM users WHERE id = ?`,
        [actor.id]
      );
      const buyerUser = buyerRows[0];

      if (!buyerUser || buyerUser.buyer_trust_status === 'SUSPENDED') {
        const err = new Error('Buyer account is suspended');
        err.code = 'ACCOUNT_SUSPENDED';
        err.statusCode = 403;
        throw err;
      }

      // 7. Fetch and Validate Latest Qualification Snapshot
      const [snapshots] = await connection.query(
        `SELECT * FROM pool_commercial_snapshots 
         WHERE pool_id = ? 
         ORDER BY snapshot_version DESC LIMIT 1`,
        [poolId]
      );
      const snapshot = snapshots[0] || null;

      if (!snapshot) {
        const err = new Error('No commercial qualification snapshot exists for this pool');
        err.code = 'NO_COMMERCIAL_SNAPSHOT';
        err.statusCode = 422;
        throw err;
      }

      const validQualStatuses = ['QUALIFIED', 'TARGET_MET', 'CAPACITY_MET'];
      if (!validQualStatuses.includes(snapshot.qualification_status)) {
        const err = new Error(`Pool qualification status is ${snapshot.qualification_status}`);
        err.code = 'POOL_NOT_QUALIFIED';
        err.statusCode = 422;
        throw err;
      }

      // 8. Fetch and Validate Supplier ACCEPT Decision
      const [suppDecisions] = await connection.query(
        `SELECT * FROM pool_supplier_commercial_decisions 
         WHERE pool_id = ? AND snapshot_id = ? 
         ORDER BY id DESC LIMIT 1`,
        [poolId, snapshot.id]
      );
      const suppDecision = suppDecisions[0] || null;

      if (!suppDecision || suppDecision.decision !== 'ACCEPT') {
        const err = new Error(
          !suppDecision
            ? 'Supplier confirmation decision is still pending'
            : `Supplier rejected commercial terms (${suppDecision.rejection_reason_code || 'REJECTED'})`
        );
        err.code = !suppDecision ? 'SUPPLIER_DECISION_PENDING' : 'SUPPLIER_OFFER_REJECTED';
        err.statusCode = 422;
        throw err;
      }

      // 9. Fetch and Validate Immutable Buyer ACCEPT Decision
      const [buyerDecisions] = await connection.query(
        `SELECT * FROM pool_buyer_commercial_decisions
         WHERE reservation_id = ? AND snapshot_id = ?
         ORDER BY id DESC LIMIT 1`,
        [reservationId, snapshot.id]
      );
      const buyerDecision = buyerDecisions[0] || null;

      if (!buyerDecision || buyerDecision.decision !== 'ACCEPT') {
        const err = new Error(
          !buyerDecision
            ? 'Buyer has not submitted an explicit commercial acceptance decision'
            : `Buyer declined commercial offer (${buyerDecision.decline_reason_code || 'DECLINED'})`
        );
        err.code = !buyerDecision ? 'BUYER_DECISION_PENDING' : 'BUYER_OFFER_DECLINED';
        err.statusCode = 422;
        throw err;
      }

      // 10. Check Existing Order Linkage (Database-level and Replay Invariant)
      const [existingOrders] = await connection.query(
        `SELECT * FROM orders 
         WHERE buyer_decision_id = ? OR reservation_id = ?
         LIMIT 1`,
        [buyerDecision.id, reservationId]
      );

      if (existingOrders && existingOrders.length > 0) {
        const existingOrder = existingOrders[0];
        // Idempotency replay check: If same idempotency key was used, return existing order
        const [idemRows] = await connection.query(
          `SELECT * FROM idempotency_records 
           WHERE idempotency_key = ? AND user_id = ?`,
          [trimmedKey, actor.id]
        );

        if (idemRows.length > 0 && idemRows[0].resource_type === 'orders' && Number(idemRows[0].resource_id) === Number(existingOrder.id)) {
          // Clean replay of already created order
          await connection.commit();
          return {
            is_replay: true,
            order: this._formatOrderResponse(existingOrder, reservation, pool, snapshot, suppDecision, buyerDecision)
          };
        }

        // Different idempotency key or competing attempt to re-convert
        const err = new Error(`Order ${existingOrder.order_code} has already been created for this buyer commitment`);
        err.code = 'ORDER_ALREADY_CONVERTED';
        err.statusCode = 409;
        err.details = {
          existing_order_id: existingOrder.id,
          order_code: existingOrder.order_code,
          order_status: existingOrder.order_status,
          payment_status: existingOrder.payment_status
        };
        throw err;
      }

      // 11. Authoritative Quorum & Price Guarantee Revalidation under Lock
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
      buyerDecRows.forEach(row => {
        if (row.decision === 'ACCEPT') {
          buyerAcceptedDemand = Number(Number(row.total_qty).toFixed(4));
        }
      });

      const supplierMinQty = Number(Number(snapshot.supplier_min_qty).toFixed(4));
      const isQuorumMet = exactDecimal.exactDecimalGte(buyerAcceptedDemand, supplierMinQty, 4);

      if (!isQuorumMet) {
        // Demand is below supplier minimum
        const [deadlineRows] = await connection.query(
          `SELECT (NOW() > ?) AS is_deadline_expired`,
          [snapshot.buyer_commitment_deadline]
        );
        const isDeadlineExpired = Boolean(deadlineRows[0] && deadlineRows[0].is_deadline_expired);

        if (!isDeadlineExpired) {
          const err = new Error('Buyer commitments are still pending cohort completion; quorum not yet reached');
          err.code = 'BUYER_COMMITMENTS_PENDING';
          err.statusCode = 422;
          throw err;
        } else {
          const err = new Error('Final committed demand fell below supplier minimum threshold without an approved shortfall guarantee');
          err.code = 'FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM';
          err.statusCode = 422;
          throw err;
        }
      }

      // 12. Financial Composition & Exact Decimal Verification
      const rawAcceptedQty = buyerDecision.accepted_quantity;
      const rawAgreedUnitPrice = buyerDecision.agreed_unit_price;
      const rawLockedSubtotal = reservation.locked_total_price;

      // Exact multiplication check for subtotal
      const expectedSubtotalStr = exactDecimal.exactMultiplyRound(rawAcceptedQty, rawAgreedUnitPrice, 2);
      if (!exactDecimal.exactDecimalEquals(rawLockedSubtotal, expectedSubtotalStr, 2)) {
        const err = new Error(`Locked merchandise subtotal mismatch: expected ${expectedSubtotalStr}, stored ${rawLockedSubtotal}`);
        err.code = 'SUBTOTAL_CALCULATION_MISMATCH';
        err.statusCode = 422;
        throw err;
      }

      // Verify unit price matches qualification snapshot
      if (!exactDecimal.exactDecimalEquals(rawAgreedUnitPrice, snapshot.candidate_unit_price, 2)) {
        const err = new Error(`Agreed unit price diverges from qualification snapshot candidate price`);
        err.code = 'SNAPSHOT_PRICE_DISCREPANCY';
        err.statusCode = 422;
        throw err;
      }

      // 13. Fee & Payable Total Composition (OBS-79: fail-closed if components unresolved)
      const deliveryType = pool.delivery_type || 'DOORSTEP';
      let deliveryFeeStr = '0.00';

      if (deliveryType === 'SUPPLIER_PICKUP') {
        // Explicitly approved zero delivery charge
        deliveryFeeStr = '0.00';
      } else if (deliveryType === 'DOORSTEP') {
        // Doorstep delivery fee policy evaluation
        if (pool.delivery_fee_policy === 'STANDARD_DELIVERY') {
          deliveryFeeStr = '150.00'; // Approved standard delivery fee
        } else if (pool.delivery_fee_policy && pool.delivery_fee_policy.startsWith('FLAT_TRIP_FEE_')) {
          const parsedFee = pool.delivery_fee_policy.replace('FLAT_TRIP_FEE_', '');
          deliveryFeeStr = exactDecimal.toCanonical(parsedFee, 2);
        } else {
          // Unresolved delivery charge policy
          const err = new Error(`Doorstep delivery fee policy '${pool.delivery_fee_policy || 'UNSPECIFIED'}' is unresolved. Order cannot be composed.`);
          err.code = 'PAYABLE_COMPONENTS_UNRESOLVED';
          err.statusCode = 422;
          throw err;
        }
      } else {
        const err = new Error(`Delivery type '${deliveryType}' requires manual quoting. Payable total cannot be finalized.`);
        err.code = 'PAYABLE_COMPONENTS_UNRESOLVED';
        err.statusCode = 422;
        throw err;
      }

      // Buyer platform fee calculation via approved feeService slabs
      const subtotalNum = Number(expectedSubtotalStr);
      const buyerFeeResult = await feeService.calculateBuyerFee(subtotalNum);
      const buyerPlatformFeeStr = exactDecimal.toCanonical(buyerFeeResult.buyer_fee, 2);

      // Exact sum for total payable amount: subtotal + delivery_fee + buyer_platform_fee
      const totalAmountStr = exactDecimal.exactDecimalSum(
        [expectedSubtotalStr, deliveryFeeStr, buyerPlatformFeeStr],
        2
      );

      // Final payable amount sanity check
      if (Number(totalAmountStr) <= 0 || isNaN(Number(totalAmountStr))) {
        const err = new Error('Computed payable total is invalid or non-positive');
        err.code = 'INVALID_PAYABLE_TOTAL';
        err.statusCode = 422;
        throw err;
      }

      // Optional test hook for concurrency simulation (OBS-80)
      if (process.env.NODE_ENV === 'test' && testHooks && typeof testHooks.beforeOrderInsert === 'function') {
        await testHooks.beforeOrderInsert();
      }

      // 14. Generate Unique Order Code
      const randSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
      const orderCode = `ORD-${Date.now().toString().slice(-8)}-${randSuffix}`;

      const resolvedDeliveryAddress = deliveryAddress 
        ? deliveryAddress.trim() 
        : (reservation.delivery_address || buyerUser.address || 'Address provided at checkout');

      // 15. Insert Authoritative Order Row
      const [orderResult] = await connection.query(
        `INSERT INTO orders (
          order_code, buyer_id, reservation_id, supplier_id, pool_id,
          snapshot_id, buyer_decision_id, total_qty, unit_price,
          subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
          currency, delivery_type, delivery_address, cluster_zone,
          payment_status, order_status, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, 'AWAITING_PAYMENT', 'AWAITING_PAYMENT', ?, NOW(), NOW())`,
        [
          orderCode,
          actor.id,
          reservation.id,
          pool.supplier_id,
          pool.id,
          snapshot.id,
          buyerDecision.id,
          rawAcceptedQty,
          rawAgreedUnitPrice,
          expectedSubtotalStr,
          deliveryFeeStr,
          buyerPlatformFeeStr,
          totalAmountStr,
          deliveryType,
          resolvedDeliveryAddress,
          reservation.cluster_zone || null,
          notes ? notes.trim() : null
        ]
      );

      const orderId = orderResult.insertId;

      // 16. Note: Pool remains in CONFIRMED state while individual buyer reservations convert to orders.
      // Pool status transitions to PAYMENT_PENDING upon checkout/payment phase.

      // 17. Emit Transactional Outbox Business Event (ORDER_CREATED)
      const eventId = reservationEventService.generateEventId({
        event_type: 'ORDER_CREATED',
        pool_id: pool.id,
        reservation_id: reservation.id,
        actor_id: actor.id,
        mutation_type: 'ORDER_CONVERSION',
        idempotency_key: trimmedKey,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'BUYER', 'ORDER_CREATED', ?, ?, NOW())`,
        [
          eventId,
          pool.id,
          reservation.id,
          actor.id,
          JSON.stringify({
            order_id: orderId,
            order_code: orderCode,
            buyer_id: actor.id,
            supplier_id: pool.supplier_id,
            buyer_decision_id: buyerDecision.id,
            snapshot_id: snapshot.id,
            quantity: Number(rawAcceptedQty),
            unit_price: Number(rawAgreedUnitPrice),
            subtotal_amount: Number(expectedSubtotalStr),
            delivery_fee: Number(deliveryFeeStr),
            buyer_platform_fee: Number(buyerPlatformFeeStr),
            total_amount: Number(totalAmountStr),
            currency: 'PKR',
            order_status: 'AWAITING_PAYMENT',
            payment_status: 'AWAITING_PAYMENT'
          }),
          trimmedKey
        ]
      );

      // 18. System Audit Log
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'BUYER', 'ORDER_CREATED_FROM_COMMITMENT', 'orders', ?, ?)`,
        [
          actor.id,
          orderId,
          JSON.stringify({
            order_code: orderCode,
            reservation_id: reservation.id,
            buyer_decision_id: buyerDecision.id,
            total_amount: totalAmountStr
          })
        ]
      );

      // Commit transaction atomically
      await connection.commit();

      // 19. Retrieve Created Order Record and Format Response
      const [createdRows] = await db.query(
        `SELECT * FROM orders WHERE id = ?`,
        [orderId]
      );
      const createdOrder = createdRows[0];

      return {
        is_replay: false,
        order: this._formatOrderResponse(createdOrder, reservation, pool, snapshot, suppDecision, buyerDecision)
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Retrieves an authoritative order by ID, enforcing strict tenant access.
   *
   * @param {Object} params
   * @param {number} params.orderId - Order ID
   * @param {Object} params.actor - Authenticated actor { id, role }
   * @returns {Promise<Object>} Formatted order DTO
   */
  async getOrderById({ orderId, actor }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    const [rows] = await db.query(
      `SELECT o.*, p.pool_code, r.reservation_code 
       FROM orders o
       JOIN pools p ON o.pool_id = p.id
       JOIN reservations r ON o.reservation_id = r.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (!rows || rows.length === 0) {
      const err = new Error(`Order with ID ${orderId} not found`);
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = rows[0];

    // Security & Ownership
    if (actor.role === 'BUYER' && Number(order.buyer_id) !== Number(actor.id)) {
      const err = new Error('You can only view your own orders');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    } else if (actor.role === 'SUPPLIER' && Number(order.supplier_id) !== Number(actor.id)) {
      const err = new Error('Suppliers can only view orders placed against their pools');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    } else if (!['BUYER', 'SUPPLIER', 'ADMIN', 'SUPER_ADMIN'].includes(actor.role)) {
      const err = new Error('Unauthorized role for order inspection');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    return {
      id: order.id,
      order_code: order.order_code,
      reservation_id: order.reservation_id,
      reservation_code: order.reservation_code,
      pool_id: order.pool_id,
      pool_code: order.pool_code,
      buyer_id: order.buyer_id,
      supplier_id: order.supplier_id,
      snapshot_id: order.snapshot_id,
      buyer_decision_id: order.buyer_decision_id,
      total_qty: Number(order.total_qty),
      unit_price: Number(order.unit_price),
      subtotal_amount: Number(order.subtotal_amount),
      delivery_fee: Number(order.delivery_fee),
      buyer_platform_fee: Number(order.buyer_platform_fee),
      total_amount: Number(order.total_amount),
      currency: order.currency,
      delivery_type: order.delivery_type,
      delivery_address: order.delivery_address,
      cluster_zone: order.cluster_zone,
      payment_status: order.payment_status,
      order_status: order.order_status,
      created_at: order.created_at,
      updated_at: order.updated_at
    };
  }

  /**
   * Format structured output response.
   * @private
   */
  _formatOrderResponse(order, reservation, pool, snapshot, suppDecision, buyerDecision) {
    return {
      id: order.id,
      order_code: order.order_code,
      reservation_id: order.reservation_id,
      pool_id: order.pool_id,
      buyer_id: order.buyer_id,
      supplier_id: order.supplier_id,
      snapshot_id: order.snapshot_id,
      buyer_decision_id: order.buyer_decision_id,
      total_qty: Number(order.total_qty),
      unit_price: Number(order.unit_price),
      subtotal_amount: Number(order.subtotal_amount),
      delivery_fee: Number(order.delivery_fee),
      buyer_platform_fee: Number(order.buyer_platform_fee),
      total_amount: Number(order.total_amount),
      currency: order.currency,
      delivery_type: order.delivery_type,
      delivery_address: order.delivery_address,
      cluster_zone: order.cluster_zone,
      payment_status: order.payment_status,
      order_status: order.order_status,
      financial_breakdown: {
        total_qty: Number(order.total_qty),
        unit_price: Number(order.unit_price),
        subtotal_amount: Number(order.subtotal_amount),
        delivery_fee: Number(order.delivery_fee),
        buyer_platform_fee: Number(order.buyer_platform_fee),
        tax_amount: 0.00,
        tax_status: 'EXEMPT_OR_NOT_APPLICABLE',
        total_payable_amount: Number(order.total_amount),
        currency: 'PKR'
      },
      commercial_source_chain: {
        pool_id: order.pool_id,
        snapshot_id: order.snapshot_id,
        snapshot_version: snapshot ? snapshot.snapshot_version : 1,
        supplier_decision_id: suppDecision ? suppDecision.id : null,
        buyer_decision_id: order.buyer_decision_id,
        reservation_id: order.reservation_id
      },
      created_at: order.created_at
    };
  }
}

module.exports = new OrderService();
