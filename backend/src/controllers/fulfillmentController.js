// =============================================================================
// src/controllers/fulfillmentController.js
// MilJor Part 4E.4: Post-Payment Fulfillment & Supplier-Managed Delivery Controller
// =============================================================================

const fulfillmentService = require('../services/fulfillmentService');

class FulfillmentController {

  /**
   * Helper to map errors into standard MilJor error responses
   */
  _handleError(res, err, defaultCode = 'FULFILLMENT_OPERATION_FAILED') {
    const statusCode = err.statusCode || (
      err.code === 'UNAUTHORIZED' ? 401 :
      err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED_ROLE' || err.code === 'SUPPLIER_NOT_VERIFIED' || err.code === 'ACCOUNT_SUSPENDED' ? 403 :
      err.code === 'ORDER_NOT_FOUND' || err.code === 'SUPPLIER_NOT_FOUND' ? 404 :
      err.code === 'TRANSITION_ALREADY_COMPLETED' || err.code === 'RECEIPT_ALREADY_CONFIRMED' || err.code === 'UNRESOLVED_FULFILLMENT_EXCEPTION' || err.code === 'ORDER_ALREADY_COMPLETED' ? 409 :
      err.code === 'INVALID_FULFILLMENT_TRANSITION' || err.code === 'PREREQUISITE_NOT_MET' || err.code === 'UNPAID_ORDER_NOT_IN_FULFILLMENT' ? 422 :
      err.code === 'INVALID_ORDER_ID' || err.code === 'INVALID_STATUS' || err.code === 'DELIVERY_METHOD_REQUIRED' || err.code === 'IDEMPOTENCY_KEY_REQUIRED' || err.code === 'INVALID_EXCEPTION_REASON' || err.code === 'INVALID_DISCREPANCY_REASON' || err.code === 'DESCRIPTION_REQUIRED' || err.code === 'INVALID_REPORTED_QUANTITY' ? 400 : 500
    );

    return res.status(statusCode).json({
      success: false,
      error: {
        code: err.code || defaultCode,
        message: err.message
      }
    });
  }

  // ===========================================================================
  // SUPPLIER HANDLERS
  // ===========================================================================

  async listSupplierOrders(req, res) {
    try {
      const actor = req.user;
      const { status, page, limit } = req.query;

      const result = await fulfillmentService.listSupplierFulfillmentOrders({
        actor,
        status,
        page,
        limit
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      return this._handleError(res, err, 'LIST_SUPPLIER_ORDERS_FAILED');
    }
  }

  async getSupplierOrderById(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;

      const result = await fulfillmentService.getSupplierFulfillmentOrderById({
        orderId,
        actor
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      return this._handleError(res, err, 'GET_SUPPLIER_ORDER_FAILED');
    }
  }

  async transitionSupplierOrder(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'];
      const {
        to_status,
        delivery_method,
        supplier_delivery_reference,
        notes,
        metadata
      } = req.body || {};

      const result = await fulfillmentService.transitionSupplierFulfillment({
        orderId,
        actor,
        toStatus: to_status,
        deliveryMethod: delivery_method,
        supplierDeliveryReference: supplier_delivery_reference,
        notes,
        metadata,
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (err) {
      return this._handleError(res, err, 'TRANSITION_FAILED');
    }
  }

  async recordSupplierException(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'];
      const { reason, description, metadata } = req.body || {};

      const result = await fulfillmentService.recordSupplierFulfillmentException({
        orderId,
        actor,
        reason,
        description,
        metadata,
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (err) {
      return this._handleError(res, err, 'RECORD_EXCEPTION_FAILED');
    }
  }

  // ===========================================================================
  // BUYER HANDLERS
  // ===========================================================================

  async listBuyerOrders(req, res) {
    try {
      const actor = req.user;
      const { status, page, limit } = req.query;

      const result = await fulfillmentService.listBuyerFulfillmentOrders({
        actor,
        status,
        page,
        limit
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      return this._handleError(res, err, 'LIST_BUYER_ORDERS_FAILED');
    }
  }

  async getBuyerOrderById(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;

      const result = await fulfillmentService.getBuyerFulfillmentOrderById({
        orderId,
        actor
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      return this._handleError(res, err, 'GET_BUYER_ORDER_FAILED');
    }
  }

  async confirmBuyerReceipt(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'];
      const { notes, metadata } = req.body || {};

      const result = await fulfillmentService.confirmBuyerReceipt({
        orderId,
        actor,
        notes,
        metadata,
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (err) {
      return this._handleError(res, err, 'CONFIRM_RECEIPT_FAILED');
    }
  }

  async reportBuyerDiscrepancy(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'];
      const { reason, description, reported_quantity, metadata } = req.body || {};

      const result = await fulfillmentService.reportBuyerDiscrepancy({
        orderId,
        actor,
        reason,
        description,
        reportedQuantity: reported_quantity,
        metadata,
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (err) {
      return this._handleError(res, err, 'REPORT_DISCREPANCY_FAILED');
    }
  }

  // ===========================================================================
  // ADMIN HANDLERS
  // ===========================================================================

  async getAdminOrderById(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;

      const result = await fulfillmentService.getAdminFulfillmentOrderById({
        orderId,
        actor
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      return this._handleError(res, err, 'GET_ADMIN_ORDER_FAILED');
    }
  }
}

module.exports = new FulfillmentController();
