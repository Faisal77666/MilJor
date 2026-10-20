// =============================================================================
// src/controllers/disputeController.js
// FIXES:
//   BUG-01: Now correctly references 'payments' table (not escrow_payments)
//   BUG-05: Added getMyDisputes(), getAllDisputes(), getDisputeById(), requestEvidence()
//   Expanded dispute lifecycle states
// =============================================================================
const db = require('../config/db');
const { ADMIN_ROLES } = require('../middlewares/authGuard');

class DisputeController {

  // ---------------------------------------------------------------------------
  // POST /api/v1/disputes
  // Buyer files a dispute against a reservation or order
  // ---------------------------------------------------------------------------
  async createDispute(req, res) {
    try {
      const buyer_id = req.user.id;
      const { reservation_id, order_id, reason, description, evidence_image_url } = req.body;

      if (!reason || !description) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Reason and description are required' }
        });
      }

      if (!reservation_id && !order_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Either reservation_id or order_id is required' }
        });
      }

      // Verify buyer owns the reservation/order
      if (reservation_id) {
        const [reservations] = await db.query(
          'SELECT id, buyer_id FROM reservations WHERE id = ?',
          [reservation_id]
        );
        if (!reservations[0] || reservations[0].buyer_id !== buyer_id) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You can only dispute your own reservations' }
          });
        }
      }

      if (order_id) {
        const [orders] = await db.query(
          'SELECT id, buyer_id FROM orders WHERE id = ?',
          [order_id]
        );
        if (!orders[0] || orders[0].buyer_id !== buyer_id) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You can only dispute your own orders' }
          });
        }
      }

      // Prevent duplicate open disputes for the same reservation/order
      const checkField = reservation_id ? 'reservation_id' : 'order_id';
      const checkId = reservation_id || order_id;
      const [existing] = await db.query(
        `SELECT id FROM order_disputes WHERE ${checkField} = ? AND buyer_id = ? AND status NOT IN ('CLOSED', 'RESOLVED_REJECTED', 'RESOLVED_REFUND', 'RESOLVED_PARTIAL_REFUND')`,
        [checkId, buyer_id]
      );
      if (existing.length > 0) {
        return res.status(409).json({
          success: false,
          error: { code: 'DISPUTE_EXISTS', message: 'An active dispute already exists for this order' }
        });
      }

      // Lock the payment in escrow (BUG-01 FIX: 'payments' table)
      if (reservation_id) {
        await db.query(
          `UPDATE payments SET status = 'DISPUTED', escrow_status = 'HELD_IN_ESCROW'
           WHERE reservation_id = ? AND status = 'PAID'`,
          [reservation_id]
        );
      }
      if (order_id) {
        await db.query(
          `UPDATE payments SET status = 'DISPUTED', escrow_status = 'HELD_IN_ESCROW'
           WHERE order_id = ? AND status = 'PAID'`,
          [order_id]
        );
      }

      const dispute_code = 'MJ-DSP-' + Math.floor(100000 + Math.random() * 900000);

      const [result] = await db.query(
        `INSERT INTO order_disputes (dispute_code, reservation_id, order_id, buyer_id, reason, description, evidence_image_url, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
        [dispute_code, reservation_id || null, order_id || null, buyer_id, reason, description, evidence_image_url || null]
      );

      // Audit log
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'BUYER', 'DISPUTE_CREATED', 'order_disputes', ?, ?)`,
        [buyer_id, result.insertId, JSON.stringify({ dispute_code, reason })]
      );

      return res.status(201).json({
        success: true,
        message: 'Dispute filed successfully. Payment has been held in escrow pending review.',
        data: { dispute_id: result.insertId, dispute_code, status: 'OPEN' }
      });

    } catch (error) {
      console.error('Create Dispute Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to create dispute.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/disputes/my  — Buyer's own disputes
  // ---------------------------------------------------------------------------
  async getMyDisputes(req, res) {
    try {
      const [disputes] = await db.query(
        `SELECT d.*, r.reservation_code, o.order_code
         FROM order_disputes d
         LEFT JOIN reservations r ON d.reservation_id = r.id
         LEFT JOIN orders o ON d.order_id = o.id
         WHERE d.buyer_id = ?
         ORDER BY d.created_at DESC`,
        [req.user.id]
      );
      return res.status(200).json({
        success: true,
        count: disputes.length,
        data: { disputes }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/disputes/:id  — Get a specific dispute
  // ---------------------------------------------------------------------------
  async getDisputeById(req, res) {
    try {
      const { id } = req.params;
      const [disputes] = await db.query(
        `SELECT d.*, r.reservation_code, o.order_code
         FROM order_disputes d
         LEFT JOIN reservations r ON d.reservation_id = r.id
         LEFT JOIN orders o ON d.order_id = o.id
         WHERE d.id = ?`,
        [id]
      );

      if (!disputes[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Dispute not found' } });
      }

      const dispute = disputes[0];

      // Access control: Only owning buyer or admin can view dispute details
      const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'SUPPORT_ADMIN'].includes(req.user.role);
      if (!isAdmin && Number(dispute.buyer_id) !== Number(req.user.id)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied: You do not own this dispute' } });
      }

      return res.status(200).json({ success: true, data: { dispute } });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/disputes  — Admin: List all disputes
  // ---------------------------------------------------------------------------
  async getAllDisputes(req, res) {
    try {
      const { status, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      let whereClause = '';
      const params = [];
      if (status) {
        whereClause = 'WHERE d.status = ?';
        params.push(status);
      }

      const [disputes] = await db.query(
        `SELECT d.*, u.full_name AS buyer_name, u.email AS buyer_email,
                r.reservation_code, o.order_code
         FROM order_disputes d
         JOIN users u ON d.buyer_id = u.id
         LEFT JOIN reservations r ON d.reservation_id = r.id
         LEFT JOIN orders o ON d.order_id = o.id
         ${whereClause}
         ORDER BY d.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), parseInt(offset)]
      );

      return res.status(200).json({
        success: true,
        count: disputes.length,
        data: { disputes }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/disputes/:id/resolve  — Admin: Resolve dispute
  // BUG-01 FIX: Uses 'payments' table (not escrow_payments)
  // ---------------------------------------------------------------------------
  async resolveDispute(req, res) {
    try {
      const { id } = req.params;
      const { resolution, admin_notes, refund_amount } = req.body;

      const VALID_RESOLUTIONS = ['NO_REFUND', 'FULL_REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'RE_DELIVERY'];
      if (!VALID_RESOLUTIONS.includes(resolution)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_RESOLUTION', message: `Resolution must be one of: ${VALID_RESOLUTIONS.join(', ')}` }
        });
      }

      const [disputes] = await db.query('SELECT * FROM order_disputes WHERE id = ?', [id]);
      if (!disputes[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Dispute not found' } });
      }

      const dispute = disputes[0];

      if (['RESOLVED_REFUND', 'RESOLVED_PARTIAL_REFUND', 'RESOLVED_REJECTED', 'CLOSED'].includes(dispute.status)) {
        return res.status(422).json({
          success: false,
          error: { code: 'ALREADY_RESOLVED', message: 'This dispute has already been resolved' }
        });
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        let newStatus = 'RESOLVED_REJECTED';
        if (resolution === 'FULL_REFUND') {
          newStatus = 'RESOLVED_REFUND';

          // BUG-01 FIX: Update 'payments' table (not escrow_payments)
          await connection.query(
            `UPDATE payments
             SET status = 'REFUNDED', escrow_status = 'REFUNDED', refunded_at = NOW()
             WHERE (reservation_id = ? OR order_id = ?) AND status IN ('PAID', 'DISPUTED')`,
            [dispute.reservation_id, dispute.order_id]
          );

          await connection.query(
            `UPDATE platform_ledger
             SET payout_status = 'REFUNDED_TO_BUYER'
             WHERE payment_id IN (
               SELECT id FROM payments
               WHERE reservation_id = ? OR order_id = ?
             )`,
            [dispute.reservation_id, dispute.order_id]
          );

        } else if (resolution === 'PARTIAL_REFUND') {
          newStatus = 'RESOLVED_PARTIAL_REFUND';
          await connection.query(
            `UPDATE payments
             SET status = 'PARTIALLY_REFUNDED', updated_at = NOW()
             WHERE (reservation_id = ? OR order_id = ?) AND status IN ('PAID', 'DISPUTED')`,
            [dispute.reservation_id, dispute.order_id]
          );
        } else {
          // NO_REFUND, REPLACEMENT, RE_DELIVERY — release escrow to supplier
          await connection.query(
            `UPDATE payments
             SET status = 'PAID', escrow_status = 'RELEASED_TO_SUPPLIER', updated_at = NOW()
             WHERE (reservation_id = ? OR order_id = ?) AND status = 'DISPUTED'`,
            [dispute.reservation_id, dispute.order_id]
          );
        }

        await connection.query(
          `UPDATE order_disputes
           SET status = ?, resolution_type = ?, refund_amount = ?, admin_notes = ?, resolved_by = ?, updated_at = NOW()
           WHERE id = ?`,
          [newStatus, resolution, refund_amount || null, admin_notes || null, req.user.id, id]
        );

        // Audit
        await connection.query(
          `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
           VALUES (?, ?, 'DISPUTE_RESOLVED', 'order_disputes', ?, ?)`,
          [req.user.id, req.user.role, id, JSON.stringify({ resolution, admin_notes })]
        );

        await connection.commit();
        connection.release();

        return res.status(200).json({
          success: true,
          message: `Dispute resolved. Resolution: ${resolution}`,
          data: { resolution, status: newStatus }
        });

      } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
      }

    } catch (error) {
      console.error('Resolve Dispute Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/disputes/:id/request-evidence  — Admin: Ask buyer for more evidence
  // ---------------------------------------------------------------------------
  async requestEvidence(req, res) {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      const [result] = await db.query(
        'UPDATE order_disputes SET status = \'EVIDENCE_REQUESTED\', admin_notes = ?, updated_at = NOW() WHERE id = ? AND status = \'OPEN\'',
        [notes || null, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Dispute not found or not in OPEN status' } });
      }

      return res.status(200).json({ success: true, message: 'Evidence requested from buyer' });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }
}

module.exports = new DisputeController();