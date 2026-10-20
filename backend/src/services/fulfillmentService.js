// =============================================================================
// src/services/fulfillmentService.js
// MilJor Part 4E.4: Post-Payment Fulfillment & Supplier-Managed Delivery Engine
//
// Invariants enforced:
// 1. Correctness > Data Safety > Security > Financial Integrity > Maintainability
// 2. Paid-Only Eligibility: Only authoritative PAID orders enter fulfillment.
// 3. Strict Role Boundaries & Tenant Isolation:
//    - Supplier can only view and manage orders assigned to their supplier_id.
//    - Buyer can only view and manage orders assigned to their buyer_id.
//    - Admin has read-only operational visibility (no financial/state mutation).
// 4. Sequential State Machine:
//    UNPAID -> AWAITING_SUPPLIER_ACKNOWLEDGEMENT -> PREPARING -> READY_FOR_DISPATCH ->
//    DISPATCHED -> SUPPLIER_DELIVERED -> BUYER_CONFIRMED.
//    No skipped, backwards, or unauthorized transitions.
// 5. Delivery & Receipt Separation:
//    Supplier-reported delivery does NOT imply buyer receipt or payment release.
// 6. Safe Exception Handling:
//    Exceptions preserve evidence, halt happy-path lifecycle, and never auto-refund.
// 7. Atomic Concurrency & Idempotency:
//    Parent-row FOR UPDATE locking and deterministic event deduplication.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/db');
const reservationEventService = require('./reservationEventService');
const supplierEligibilityPolicy = require('./supplierEligibilityPolicy');

const ALLOWED_SUPPLIER_TRANSITIONS = {
  'AWAITING_SUPPLIER_ACKNOWLEDGEMENT': ['PREPARING'],
  'PREPARING': ['READY_FOR_DISPATCH'],
  'READY_FOR_DISPATCH': ['DISPATCHED'],
  'DISPATCHED': ['SUPPLIER_DELIVERED']
};

const VALID_DELIVERY_METHODS = [
  'SUPPLIER_FLEET',
  'THIRD_PARTY_COURIER',
  'BUYER_PICKUP',
  'STANDARD_DELIVERY'
];

const VALID_SUPPLIER_EXCEPTION_REASONS = [
  'SUPPLIER_INVENTORY_SHORTAGE',
  'SUPPLIER_DELIVERY_DELAYED',
  'SUPPLIER_LOGISTICS_FAILURE'
];

const VALID_BUYER_DISCREPANCY_REASONS = [
  'QUANTITY_MISMATCH',
  'DAMAGED_GOODS',
  'WRONG_PRODUCT',
  'DELIVERY_NOT_RECEIVED'
];

class FulfillmentService {

  /**
   * Generates a deterministic event code for fulfillment milestone events
   */
  _generateEventCode(orderId, action, idempotencyKey) {
    const raw = `${orderId}:${action}:${(idempotencyKey || '').trim()}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 20);
    return `FE-ORD-${orderId}-${action}-${hash}`;
  }

  /**
   * Helper to verify verified supplier account and profile status
   */
  async _assertVerifiedSupplier(actor, connection) {
    if (!actor || !actor.id || actor.role !== 'SUPPLIER') {
      const err = new Error('Only authorized suppliers can perform this action');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    const [suppRows] = await connection.query(
      `SELECT u.id, u.role, u.is_verified, u.verification_status,
              sp.verification_status AS profile_verification_status
       FROM users u
       LEFT JOIN supplier_profiles sp ON u.id = sp.supplier_id
       WHERE u.id = ?`,
      [actor.id]
    );

    if (suppRows.length === 0) {
      const err = new Error('Supplier account not found');
      err.code = 'SUPPLIER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const supplierData = suppRows[0];
    const eligibility = supplierEligibilityPolicy.evaluateSupplierEligibility(supplierData);
    if (!eligibility.eligible) {
      const err = new Error(eligibility.reason || 'Supplier account or profile is not verified');
      err.code = eligibility.code || 'SUPPLIER_NOT_VERIFIED';
      err.statusCode = 403;
      throw err;
    }

    return supplierData;
  }

  // ===========================================================================
  // SUPPLIER OPERATIONS
  // ===========================================================================

  /**
   * List paid orders assigned to the calling supplier with bounded pagination
   */
  async listSupplierFulfillmentOrders({ actor, status = null, page = 1, limit = 20 }) {
    const connection = await db.getConnection();
    try {
      await this._assertVerifiedSupplier(actor, connection);

      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (parsedPage - 1) * parsedLimit;

      const params = [actor.id];
      let statusFilter = '';
      if (status) {
        statusFilter = 'AND o.fulfillment_status = ?';
        params.push(status);
      }

      // Count total matching orders
      const [countRows] = await connection.query(
        `SELECT COUNT(*) AS total
         FROM orders o
         WHERE o.supplier_id = ? AND o.payment_status = 'PAID' ${statusFilter}`,
        params
      );
      const totalOrders = Number(countRows[0]?.total || 0);

      // Fetch paginated order rows
      const queryParams = [...params, parsedLimit, offset];
      const [orderRows] = await connection.query(
        `SELECT o.id, o.order_code, o.pool_id, o.buyer_id, o.total_qty, o.unit_price,
                o.subtotal_amount, o.delivery_fee, o.buyer_platform_fee, o.total_amount,
                o.currency, o.delivery_type, o.delivery_address, o.cluster_zone,
                o.order_status, o.payment_status, o.fulfillment_status,
                o.delivery_method, o.supplier_delivery_reference,
                o.acknowledged_at, o.preparing_at, o.ready_for_dispatch_at,
                o.dispatched_at, o.supplier_delivered_at, o.buyer_confirmed_at,
                o.exception_reason, o.exception_recorded_at, o.created_at, o.updated_at,
                p.pool_code, p.pool_unit, pr.title AS product_name
         FROM orders o
         LEFT JOIN pools p ON o.pool_id = p.id
         LEFT JOIN products pr ON p.product_id = pr.id
         WHERE o.supplier_id = ? AND o.payment_status = 'PAID' ${statusFilter}
         ORDER BY o.id DESC
         LIMIT ? OFFSET ?`,
        queryParams
      );

      return {
        orders: orderRows.map(row => this._formatOrderSummary(row)),
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total: totalOrders,
          total_pages: Math.ceil(totalOrders / parsedLimit) || 1
        }
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Get fulfillment details and complete tracking timeline for a supplier order
   */
  async getSupplierFulfillmentOrderById({ orderId, actor }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    const connection = await db.getConnection();
    try {
      await this._assertVerifiedSupplier(actor, connection);

      const [orderRows] = await connection.query(
        `SELECT o.*, p.pool_code, p.pool_unit, pr.title AS product_name
         FROM orders o
         LEFT JOIN pools p ON o.pool_id = p.id
         LEFT JOIN products pr ON p.product_id = pr.id
         WHERE o.id = ?`,
        [orderId]
      );

      if (orderRows.length === 0) {
        const err = new Error(`Order with ID ${orderId} not found`);
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];

      // Tenant isolation check
      if (Number(order.supplier_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You are not the assigned supplier for this order.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Paid-only eligibility check
      if (order.payment_status !== 'PAID') {
        const err = new Error(`Order is in '${order.payment_status}' status and cannot enter fulfillment`);
        err.code = 'UNPAID_ORDER_NOT_IN_FULFILLMENT';
        err.statusCode = 422;
        throw err;
      }

      // Fetch tracking events timeline
      const [events] = await connection.query(
        `SELECT id, event_code, from_status, to_status, action, actor_role,
                notes, metadata, created_at
         FROM order_fulfillment_events
         WHERE order_id = ?
         ORDER BY id ASC`,
        [orderId]
      );

      return {
        order: this._formatOrderDetails(order),
        timeline: events
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Transition order through authorized supplier fulfillment milestones
   */
  async transitionSupplierFulfillment({
    orderId,
    actor,
    toStatus,
    deliveryMethod = null,
    supplierDeliveryReference = null,
    notes = null,
    metadata = null,
    idempotencyKey
  }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!toStatus || typeof toStatus !== 'string') {
      const err = new Error('Target fulfillment status (to_status) is required');
      err.code = 'INVALID_STATUS';
      err.statusCode = 400;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory for fulfillment transitions');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const trimmedKey = idempotencyKey.trim();
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      await this._assertVerifiedSupplier(actor, connection);

      // Lock order row exclusively
      const [orderRows] = await connection.query(
        `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
        [orderId]
      );

      if (orderRows.length === 0) {
        const err = new Error(`Order with ID ${orderId} not found`);
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];

      // Tenant isolation check
      if (Number(order.supplier_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You are not the assigned supplier for this order.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Paid-only eligibility check
      if (order.payment_status !== 'PAID') {
        const err = new Error(`Order is in '${order.payment_status}' status and cannot be fulfilled`);
        err.code = 'UNPAID_ORDER_NOT_IN_FULFILLMENT';
        err.statusCode = 422;
        throw err;
      }

      const currentStatus = order.fulfillment_status || 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT';

      // Idempotency replay check: If identical target status was recorded with the same key
      if (currentStatus === toStatus) {
        const [existingEvents] = await connection.query(
          `SELECT * FROM order_fulfillment_events 
           WHERE order_id = ? AND idempotency_key = ? AND to_status = ?
           ORDER BY id DESC LIMIT 1`,
          [orderId, trimmedKey, toStatus]
        );

        if (existingEvents.length > 0) {
          await connection.commit();
          return {
            is_replay: true,
            order_id: order.id,
            order_code: order.order_code,
            fulfillment_status: currentStatus,
            message: 'Fulfillment milestone transition retrieved (idempotent replay)'
          };
        }
      }

      // If order is currently in EXCEPTION state, fail closed
      if (currentStatus === 'EXCEPTION') {
        const err = new Error(`Order is currently in EXCEPTION status (${order.exception_reason}). Resolve exception before advancing.`);
        err.code = 'UNRESOLVED_FULFILLMENT_EXCEPTION';
        err.statusCode = 409;
        throw err;
      }

      // Validate allowed transitions
      const allowedNext = ALLOWED_SUPPLIER_TRANSITIONS[currentStatus] || [];
      if (!allowedNext.includes(toStatus)) {
        // Check if transition has already passed with a different key
        const statusHierarchy = [
          'UNPAID', 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', 'PREPARING',
          'READY_FOR_DISPATCH', 'DISPATCHED', 'SUPPLIER_DELIVERED',
          'BUYER_CONFIRMED', 'COMPLETED'
        ];
        const currentIndex = statusHierarchy.indexOf(currentStatus);
        const targetIndex = statusHierarchy.indexOf(toStatus);

        if (targetIndex !== -1 && currentIndex >= targetIndex) {
          const err = new Error(`Transition to '${toStatus}' already completed or superseded by current status '${currentStatus}'`);
          err.code = 'TRANSITION_ALREADY_COMPLETED';
          err.statusCode = 409;
          throw err;
        }

        const err = new Error(`Invalid transition from '${currentStatus}' to '${toStatus}'. Allowed: [${allowedNext.join(', ')}]`);
        err.code = 'INVALID_FULFILLMENT_TRANSITION';
        err.statusCode = 422;
        throw err;
      }

      // Stage-specific validations
      if (toStatus === 'DISPATCHED') {
        if (!deliveryMethod || !VALID_DELIVERY_METHODS.includes(deliveryMethod)) {
          const err = new Error(`Valid delivery_method is required when marking order DISPATCHED. Allowed: [${VALID_DELIVERY_METHODS.join(', ')}]`);
          err.code = 'DELIVERY_METHOD_REQUIRED';
          err.statusCode = 400;
          throw err;
        }
      }

      // Update order state and timestamps
      let updateSql = 'UPDATE orders SET fulfillment_status = ?, updated_at = NOW()';
      const updateParams = [toStatus];

      if (toStatus === 'PREPARING') {
        updateSql += ', acknowledged_at = COALESCE(acknowledged_at, NOW()), preparing_at = NOW(), order_status = "PROCESSING"';
      } else if (toStatus === 'READY_FOR_DISPATCH') {
        updateSql += ', ready_for_dispatch_at = NOW()';
      } else if (toStatus === 'DISPATCHED') {
        updateSql += ', dispatched_at = NOW(), delivery_method = ?, supplier_delivery_reference = ?, order_status = "OUT_FOR_DELIVERY"';
        updateParams.push(deliveryMethod, supplierDeliveryReference ? supplierDeliveryReference.trim() : null);
      } else if (toStatus === 'SUPPLIER_DELIVERED') {
        updateSql += ', supplier_delivered_at = NOW(), delivery_evidence_notes = ?';
        updateParams.push(notes ? notes.trim() : null);
      }

      updateSql += ' WHERE id = ?';
      updateParams.push(orderId);

      await connection.query(updateSql, updateParams);

      // Record immutable milestone event in order_fulfillment_events
      const eventCode = this._generateEventCode(orderId, toStatus, trimmedKey);
      await connection.query(
        `INSERT INTO order_fulfillment_events (
          order_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'SUPPLIER', ?, ?, ?, NOW())`,
        [
          orderId,
          eventCode,
          currentStatus,
          toStatus,
          `SUPPLIER_${toStatus}`,
          actor.id,
          notes ? notes.trim() : null,
          metadata ? JSON.stringify(metadata) : null,
          trimmedKey
        ]
      );

      // Emit transactional outbox business event to reservation_business_events
      const outboxEventId = reservationEventService.generateEventId({
        event_type: `ORDER_${toStatus}`,
        pool_id: order.pool_id || 0,
        reservation_id: order.reservation_id || 0,
        actor_id: actor.id,
        mutation_type: 'FULFILLMENT_TRANSITION',
        idempotency_key: trimmedKey,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'SUPPLIER', ?, ?, ?, NOW())`,
        [
          outboxEventId,
          order.pool_id || 0,
          order.reservation_id || 0,
          actor.id,
          `ORDER_${toStatus}`,
          JSON.stringify({
            order_id: order.id,
            order_code: order.order_code,
            supplier_id: actor.id,
            from_status: currentStatus,
            to_status: toStatus,
            delivery_method: deliveryMethod || order.delivery_method,
            supplier_delivery_reference: supplierDeliveryReference || order.supplier_delivery_reference
          }),
          trimmedKey
        ]
      );

      await connection.commit();

      return {
        is_replay: false,
        order_id: order.id,
        order_code: order.order_code,
        previous_status: currentStatus,
        fulfillment_status: toStatus,
        message: `Fulfillment status advanced to ${toStatus}`
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Supplier reports an operational exception (inventory shortage, logistics failure, delay)
   */
  async recordSupplierFulfillmentException({
    orderId,
    actor,
    reason,
    description,
    metadata = null,
    idempotencyKey
  }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!reason || !VALID_SUPPLIER_EXCEPTION_REASONS.includes(reason)) {
      const err = new Error(`Invalid exception reason. Allowed: [${VALID_SUPPLIER_EXCEPTION_REASONS.join(', ')}]`);
      err.code = 'INVALID_EXCEPTION_REASON';
      err.statusCode = 400;
      throw err;
    }

    if (!description || typeof description !== 'string' || description.trim().length < 5) {
      const err = new Error('Meaningful exception description (minimum 5 characters) is required');
      err.code = 'DESCRIPTION_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory for recording exceptions');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const trimmedKey = idempotencyKey.trim();
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      await this._assertVerifiedSupplier(actor, connection);

      const [orderRows] = await connection.query(
        `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
        [orderId]
      );

      if (orderRows.length === 0) {
        const err = new Error(`Order with ID ${orderId} not found`);
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];

      if (Number(order.supplier_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You are not the assigned supplier for this order.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      if (order.payment_status !== 'PAID') {
        const err = new Error(`Order is in '${order.payment_status}' status and cannot have fulfillment exceptions`);
        err.code = 'UNPAID_ORDER_NOT_IN_FULFILLMENT';
        err.statusCode = 422;
        throw err;
      }

      // Check terminal states
      if (order.fulfillment_status === 'COMPLETED' || order.fulfillment_status === 'BUYER_CONFIRMED') {
        const err = new Error(`Cannot record exception on an order that has already been confirmed/completed`);
        err.code = 'ORDER_ALREADY_COMPLETED';
        err.statusCode = 409;
        throw err;
      }

      // Idempotency check
      if (order.fulfillment_status === 'EXCEPTION' && order.exception_reason === reason) {
        const [existingEvents] = await connection.query(
          `SELECT * FROM order_fulfillment_events 
           WHERE order_id = ? AND idempotency_key = ? AND action = 'RECORD_SUPPLIER_EXCEPTION'
           ORDER BY id DESC LIMIT 1`,
          [orderId, trimmedKey]
        );

        if (existingEvents.length > 0) {
          await connection.commit();
          return {
            is_replay: true,
            order_id: order.id,
            fulfillment_status: 'EXCEPTION',
            exception_reason: reason,
            message: 'Supplier fulfillment exception retrieved (idempotent replay)'
          };
        }
      }

      const currentStatus = order.fulfillment_status || 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT';

      // Update order to EXCEPTION state (Payment status and financial totals remain intact)
      await connection.query(
        `UPDATE orders 
         SET fulfillment_status = 'EXCEPTION',
             exception_reason = ?,
             exception_details = ?,
             exception_recorded_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [reason, description.trim(), orderId]
      );

      // Record milestone event
      const eventCode = this._generateEventCode(orderId, 'SUPPLIER_EXCEPTION', trimmedKey);
      await connection.query(
        `INSERT INTO order_fulfillment_events (
          order_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, ?, 'EXCEPTION', 'RECORD_SUPPLIER_EXCEPTION', ?, 'SUPPLIER', ?, ?, ?, NOW())`,
        [
          orderId,
          eventCode,
          currentStatus,
          actor.id,
          description.trim(),
          JSON.stringify({ reason, ...(metadata || {}) }),
          trimmedKey
        ]
      );

      // Outbox business event
      const outboxEventId = reservationEventService.generateEventId({
        event_type: 'ORDER_FULFILLMENT_EXCEPTION',
        pool_id: order.pool_id || 0,
        reservation_id: order.reservation_id || 0,
        actor_id: actor.id,
        mutation_type: 'EXCEPTION_RECORDED',
        idempotency_key: trimmedKey,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'SUPPLIER', 'ORDER_FULFILLMENT_EXCEPTION', ?, ?, NOW())`,
        [
          outboxEventId,
          order.pool_id || 0,
          order.reservation_id || 0,
          actor.id,
          JSON.stringify({
            order_id: order.id,
            order_code: order.order_code,
            reported_by_role: 'SUPPLIER',
            reporter_id: actor.id,
            reason,
            description: description.trim()
          }),
          trimmedKey
        ]
      );

      await connection.commit();

      return {
        is_replay: false,
        order_id: order.id,
        order_code: order.order_code,
        previous_status: currentStatus,
        fulfillment_status: 'EXCEPTION',
        exception_reason: reason,
        message: 'Supplier exception recorded safely. Order halted pending operational resolution.'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // BUYER OPERATIONS
  // ===========================================================================

  /**
   * List paid fulfillment orders belonging to the calling buyer
   */
  async listBuyerFulfillmentOrders({ actor, status = null, page = 1, limit = 20 }) {
    if (!actor || !actor.id || actor.role !== 'BUYER') {
      const err = new Error('Authentication required');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    const connection = await db.getConnection();
    try {
      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (parsedPage - 1) * parsedLimit;

      const params = [actor.id];
      let statusFilter = '';
      if (status) {
        statusFilter = 'AND o.fulfillment_status = ?';
        params.push(status);
      }

      const [countRows] = await connection.query(
        `SELECT COUNT(*) AS total
         FROM orders o
         WHERE o.buyer_id = ? AND o.payment_status = 'PAID' ${statusFilter}`,
        params
      );
      const totalOrders = Number(countRows[0]?.total || 0);

      const queryParams = [...params, parsedLimit, offset];
      const [orderRows] = await connection.query(
        `SELECT o.id, o.order_code, o.pool_id, o.total_qty, o.unit_price,
                o.subtotal_amount, o.delivery_fee, o.buyer_platform_fee, o.total_amount,
                o.currency, o.delivery_type, o.delivery_address, o.cluster_zone,
                o.order_status, o.payment_status, o.fulfillment_status,
                o.delivery_method, o.supplier_delivery_reference,
                o.acknowledged_at, o.preparing_at, o.ready_for_dispatch_at,
                o.dispatched_at, o.supplier_delivered_at, o.buyer_confirmed_at,
                o.exception_reason, o.exception_recorded_at, o.created_at, o.updated_at,
                p.pool_code, p.pool_unit, pr.title AS product_name,
                su.business_name AS supplier_name
         FROM orders o
         LEFT JOIN pools p ON o.pool_id = p.id
         LEFT JOIN products pr ON p.product_id = pr.id
         LEFT JOIN users su ON o.supplier_id = su.id
         WHERE o.buyer_id = ? AND o.payment_status = 'PAID' ${statusFilter}
         ORDER BY o.id DESC
         LIMIT ? OFFSET ?`,
        queryParams
      );

      return {
        orders: orderRows.map(row => this._formatOrderSummary(row)),
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total: totalOrders,
          total_pages: Math.ceil(totalOrders / parsedLimit) || 1
        }
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Get fulfillment status and full tracking history for a buyer order
   */
  async getBuyerFulfillmentOrderById({ orderId, actor }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id || actor.role !== 'BUYER') {
      const err = new Error('Authentication required');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    const connection = await db.getConnection();
    try {
      const [orderRows] = await connection.query(
        `SELECT o.*, p.pool_code, p.pool_unit, pr.title AS product_name,
                su.business_name AS supplier_name
         FROM orders o
         LEFT JOIN pools p ON o.pool_id = p.id
         LEFT JOIN products pr ON p.product_id = pr.id
         LEFT JOIN users su ON o.supplier_id = su.id
         WHERE o.id = ?`,
        [orderId]
      );

      if (orderRows.length === 0) {
        const err = new Error(`Order with ID ${orderId} not found`);
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];

      // Tenant isolation check
      if (Number(order.buyer_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You do not own this order.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Paid-only eligibility check
      if (order.payment_status !== 'PAID') {
        const err = new Error(`Order is in '${order.payment_status}' status and cannot enter fulfillment`);
        err.code = 'UNPAID_ORDER_NOT_IN_FULFILLMENT';
        err.statusCode = 422;
        throw err;
      }

      // Fetch tracking events timeline
      const [events] = await connection.query(
        `SELECT id, event_code, from_status, to_status, action, actor_role,
                notes, metadata, created_at
         FROM order_fulfillment_events
         WHERE order_id = ?
         ORDER BY id ASC`,
        [orderId]
      );

      return {
        order: this._formatOrderDetails(order),
        timeline: events
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Buyer confirms receipt of goods after supplier marks delivered
   */
  async confirmBuyerReceipt({
    orderId,
    actor,
    notes = null,
    metadata = null,
    idempotencyKey
  }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id || actor.role !== 'BUYER') {
      const err = new Error('Only the purchasing buyer can confirm receipt of an order');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory for confirming receipt');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const trimmedKey = idempotencyKey.trim();
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      const [orderRows] = await connection.query(
        `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
        [orderId]
      );

      if (orderRows.length === 0) {
        const err = new Error(`Order with ID ${orderId} not found`);
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];

      // Tenant isolation
      if (Number(order.buyer_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You do not own this order.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Paid-only eligibility
      if (order.payment_status !== 'PAID') {
        const err = new Error(`Order is in '${order.payment_status}' status and cannot be confirmed`);
        err.code = 'UNPAID_ORDER_NOT_IN_FULFILLMENT';
        err.statusCode = 422;
        throw err;
      }

      const currentStatus = order.fulfillment_status;

      // Idempotency check: Already confirmed with same key
      if (currentStatus === 'BUYER_CONFIRMED' || currentStatus === 'COMPLETED') {
        const [existingEvents] = await connection.query(
          `SELECT * FROM order_fulfillment_events 
           WHERE order_id = ? AND idempotency_key = ? AND action = 'CONFIRM_BUYER_RECEIPT'
           ORDER BY id DESC LIMIT 1`,
          [orderId, trimmedKey]
        );

        if (existingEvents.length > 0) {
          await connection.commit();
          return {
            is_replay: true,
            order_id: order.id,
            fulfillment_status: currentStatus,
            message: 'Receipt confirmation retrieved (idempotent replay)'
          };
        }

        const err = new Error('Order receipt has already been confirmed.');
        err.code = 'RECEIPT_ALREADY_CONFIRMED';
        err.statusCode = 409;
        throw err;
      }

      // Prerequisite check: Supplier MUST have marked the order DELIVERED first
      if (currentStatus !== 'SUPPLIER_DELIVERED') {
        const err = new Error(`Cannot confirm receipt: Order has not been marked delivered by the supplier (current status: '${currentStatus}')`);
        err.code = 'PREREQUISITE_NOT_MET';
        err.statusCode = 422;
        throw err;
      }

      // Advance to BUYER_CONFIRMED
      await connection.query(
        `UPDATE orders 
         SET fulfillment_status = 'BUYER_CONFIRMED',
             order_status = 'DELIVERED',
             buyer_confirmed_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [orderId]
      );

      // Record milestone event
      const eventCode = this._generateEventCode(orderId, 'BUYER_CONFIRMED', trimmedKey);
      await connection.query(
        `INSERT INTO order_fulfillment_events (
          order_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, 'SUPPLIER_DELIVERED', 'BUYER_CONFIRMED', 'CONFIRM_BUYER_RECEIPT', ?, 'BUYER', ?, ?, ?, NOW())`,
        [
          orderId,
          eventCode,
          actor.id,
          notes ? notes.trim() : null,
          metadata ? JSON.stringify(metadata) : null,
          trimmedKey
        ]
      );

      // Emit transactional outbox business event
      const outboxEventId = reservationEventService.generateEventId({
        event_type: 'ORDER_BUYER_RECEIPT_CONFIRMED',
        pool_id: order.pool_id || 0,
        reservation_id: order.reservation_id || 0,
        actor_id: actor.id,
        mutation_type: 'BUYER_RECEIPT_CONFIRMATION',
        idempotency_key: trimmedKey,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'BUYER', 'ORDER_BUYER_RECEIPT_CONFIRMED', ?, ?, NOW())`,
        [
          outboxEventId,
          order.pool_id || 0,
          order.reservation_id || 0,
          actor.id,
          JSON.stringify({
            order_id: order.id,
            order_code: order.order_code,
            buyer_id: actor.id,
            total_qty: Number(order.total_qty),
            total_amount: Number(order.total_amount)
          }),
          trimmedKey
        ]
      );

      await connection.commit();

      return {
        is_replay: false,
        order_id: order.id,
        order_code: order.order_code,
        previous_status: currentStatus,
        fulfillment_status: 'BUYER_CONFIRMED',
        message: 'Order receipt confirmed successfully. Escrow funds remain safely secured.'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Buyer reports delivery discrepancy (quantity mismatch, damaged goods, missing items)
   */
  async reportBuyerDiscrepancy({
    orderId,
    actor,
    reason,
    description,
    reportedQuantity = null,
    metadata = null,
    idempotencyKey
  }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id || actor.role !== 'BUYER') {
      const err = new Error('Only the purchasing buyer can report delivery discrepancies');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    if (!reason || !VALID_BUYER_DISCREPANCY_REASONS.includes(reason)) {
      const err = new Error(`Invalid discrepancy reason. Allowed: [${VALID_BUYER_DISCREPANCY_REASONS.join(', ')}]`);
      err.code = 'INVALID_DISCREPANCY_REASON';
      err.statusCode = 400;
      throw err;
    }

    if (!description || typeof description !== 'string' || description.trim().length < 5) {
      const err = new Error('Meaningful discrepancy description (minimum 5 characters) is required');
      err.code = 'DESCRIPTION_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory for reporting discrepancies');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const trimmedKey = idempotencyKey.trim();
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      const [orderRows] = await connection.query(
        `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
        [orderId]
      );

      if (orderRows.length === 0) {
        const err = new Error(`Order with ID ${orderId} not found`);
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];

      if (Number(order.buyer_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You do not own this order.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      if (order.payment_status !== 'PAID') {
        const err = new Error(`Order is in '${order.payment_status}' status and cannot report delivery discrepancies`);
        err.code = 'UNPAID_ORDER_NOT_IN_FULFILLMENT';
        err.statusCode = 422;
        throw err;
      }

      const currentStatus = order.fulfillment_status;

      // Discrepancy can only be reported if order was at least DISPATCHED or SUPPLIER_DELIVERED
      const validDiscrepancyStages = ['DISPATCHED', 'SUPPLIER_DELIVERED', 'BUYER_CONFIRMED'];
      if (!validDiscrepancyStages.includes(currentStatus) && currentStatus !== 'EXCEPTION') {
        const err = new Error(`Discrepancies cannot be reported before order has been dispatched (current status: '${currentStatus}')`);
        err.code = 'PREREQUISITE_NOT_MET';
        err.statusCode = 422;
        throw err;
      }

      // Quantity validation if quantity mismatch
      let parsedReportedQty = null;
      if (reason === 'QUANTITY_MISMATCH') {
        if (reportedQuantity === null || reportedQuantity === undefined || isNaN(Number(reportedQuantity)) || Number(reportedQuantity) < 0) {
          const err = new Error('Valid non-negative reported_quantity is required for QUANTITY_MISMATCH');
          err.code = 'INVALID_REPORTED_QUANTITY';
          err.statusCode = 400;
          throw err;
        }
        parsedReportedQty = Number(reportedQuantity);
      }

      // Idempotency replay check
      if (currentStatus === 'EXCEPTION' && order.exception_reason === reason) {
        const [existingEvents] = await connection.query(
          `SELECT * FROM order_fulfillment_events 
           WHERE order_id = ? AND idempotency_key = ? AND action = 'REPORT_BUYER_DISCREPANCY'
           ORDER BY id DESC LIMIT 1`,
          [orderId, trimmedKey]
        );

        if (existingEvents.length > 0) {
          await connection.commit();
          return {
            is_replay: true,
            order_id: order.id,
            fulfillment_status: 'EXCEPTION',
            exception_reason: reason,
            message: 'Buyer discrepancy report retrieved (idempotent replay)'
          };
        }
      }

      // Update to EXCEPTION state
      await connection.query(
        `UPDATE orders 
         SET fulfillment_status = 'EXCEPTION',
             exception_reason = ?,
             exception_details = ?,
             exception_recorded_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [reason, description.trim(), orderId]
      );

      // Record milestone event
      const eventCode = this._generateEventCode(orderId, 'BUYER_DISCREPANCY', trimmedKey);
      await connection.query(
        `INSERT INTO order_fulfillment_events (
          order_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, ?, 'EXCEPTION', 'REPORT_BUYER_DISCREPANCY', ?, 'BUYER', ?, ?, ?, NOW())`,
        [
          orderId,
          eventCode,
          currentStatus,
          actor.id,
          description.trim(),
          JSON.stringify({
            reason,
            reported_quantity: parsedReportedQty,
            expected_quantity: Number(order.total_qty),
            ...(metadata || {})
          }),
          trimmedKey
        ]
      );

      // Outbox business event
      const outboxEventId = reservationEventService.generateEventId({
        event_type: 'ORDER_FULFILLMENT_EXCEPTION',
        pool_id: order.pool_id || 0,
        reservation_id: order.reservation_id || 0,
        actor_id: actor.id,
        mutation_type: 'DISCREPANCY_REPORTED',
        idempotency_key: trimmedKey,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'BUYER', 'ORDER_FULFILLMENT_EXCEPTION', ?, ?, NOW())`,
        [
          outboxEventId,
          order.pool_id || 0,
          order.reservation_id || 0,
          actor.id,
          JSON.stringify({
            order_id: order.id,
            order_code: order.order_code,
            reported_by_role: 'BUYER',
            reporter_id: actor.id,
            reason,
            description: description.trim(),
            reported_quantity: parsedReportedQty,
            expected_quantity: Number(order.total_qty)
          }),
          trimmedKey
        ]
      );

      await connection.commit();

      return {
        is_replay: false,
        order_id: order.id,
        order_code: order.order_code,
        previous_status: currentStatus,
        fulfillment_status: 'EXCEPTION',
        exception_reason: reason,
        message: 'Delivery discrepancy recorded safely. Order placed in exception state without modifying financial balances.'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // ADMIN READ MODEL
  // ===========================================================================

  /**
   * Admin read-only operational visibility for fulfillment tracking
   */
  async getAdminFulfillmentOrderById({ orderId, actor }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    const connection = await db.getConnection();
    try {
      const [orderRows] = await connection.query(
        `SELECT o.*, p.pool_code, p.pool_unit, pr.title AS product_name,
                su.business_name AS supplier_name,
                bu.email AS buyer_email, su.email AS supplier_email
         FROM orders o
         LEFT JOIN pools p ON o.pool_id = p.id
         LEFT JOIN products pr ON p.product_id = pr.id
         LEFT JOIN users bu ON o.buyer_id = bu.id
         LEFT JOIN users su ON o.supplier_id = su.id
         WHERE o.id = ?`,
        [orderId]
      );

      if (orderRows.length === 0) {
        const err = new Error(`Order with ID ${orderId} not found`);
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];

      const [events] = await connection.query(
        `SELECT id, event_code, from_status, to_status, action, actor_role,
                notes, metadata, created_at
         FROM order_fulfillment_events
         WHERE order_id = ?
         ORDER BY id ASC`,
        [orderId]
      );

      return {
        order: this._formatOrderDetails(order),
        timeline: events
      };
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // PRIVATE FORMATTING HELPERS
  // ===========================================================================

  _formatOrderSummary(row) {
    return {
      order_id: row.id,
      order_code: row.order_code,
      pool_id: row.pool_id,
      pool_code: row.pool_code,
      product_name: row.product_name,
      supplier_name: row.supplier_name || undefined,
      total_qty: Number(row.total_qty),
      pool_unit: row.pool_unit,
      unit_price: Number(row.unit_price),
      subtotal_amount: Number(row.subtotal_amount),
      delivery_fee: Number(row.delivery_fee || 0),
      buyer_platform_fee: Number(row.buyer_platform_fee || 0),
      total_amount: Number(row.total_amount),
      currency: row.currency || 'PKR',
      delivery_type: row.delivery_type,
      delivery_address: row.delivery_address,
      cluster_zone: row.cluster_zone,
      payment_status: row.payment_status,
      order_status: row.order_status,
      fulfillment_status: row.fulfillment_status,
      delivery_method: row.delivery_method,
      supplier_delivery_reference: row.supplier_delivery_reference,
      acknowledged_at: row.acknowledged_at,
      dispatched_at: row.dispatched_at,
      supplier_delivered_at: row.supplier_delivered_at,
      buyer_confirmed_at: row.buyer_confirmed_at,
      exception_reason: row.exception_reason,
      exception_recorded_at: row.exception_recorded_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  _formatOrderDetails(row) {
    return {
      ...this._formatOrderSummary(row),
      delivery_evidence_notes: row.delivery_evidence_notes,
      preparing_at: row.preparing_at,
      ready_for_dispatch_at: row.ready_for_dispatch_at,
      completed_at: row.completed_at,
      exception_details: row.exception_details,
      buyer_email: row.buyer_email || undefined,
      supplier_email: row.supplier_email || undefined
    };
  }
}

module.exports = new FulfillmentService();
