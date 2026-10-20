// =============================================================================
// src/controllers/adminController.js
// MilJor Administrative & Verification Operations
// Enforces:
//   - Least privilege access control per administrative role
//   - Self-approval prohibition (Suppliers cannot approve their own verification)
//   - Mandatory audit logging for every administrative state change
// =============================================================================
const db = require('../config/db');

class AdminController {

  // ---------------------------------------------------------------------------
  // GET /api/v1/admin/suppliers/pending
  // Permitted Roles: VERIFICATION_ADMIN, SUPER_ADMIN
  // ---------------------------------------------------------------------------
  async getPendingSuppliers(req, res) {
    try {
      const [suppliers] = await db.query(
        `SELECT sp.*, u.full_name, u.business_name, u.email, u.phone, u.city, u.area, u.address
         FROM supplier_profiles sp
         JOIN users u ON sp.supplier_id = u.id
         WHERE sp.verification_status IN ('PENDING_REVIEW', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED')
         ORDER BY sp.created_at ASC`
      );

      return res.status(200).json({
        success: true,
        count: suppliers.length,
        data: { suppliers }
      });
    } catch (error) {
      console.error('Get Pending Suppliers Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/admin/suppliers/:id/verify
  // Permitted Roles: VERIFICATION_ADMIN, SUPER_ADMIN
  // Verifies/Rejects a supplier profile with tier and verification level
  // ---------------------------------------------------------------------------
  async verifySupplier(req, res) {
    try {
      const { id } = req.params; // supplier_id (user id)
      const { verification_status, verification_level = 'LEVEL_2_BUSINESS', subscription_plan = 'GROWTH', max_active_listings = 25, transaction_fee_percent = 1.50 } = req.body;
      const adminId = req.user.id;

      // 1. Self-Verification Restriction
      if (parseInt(id) === adminId) {
        return res.status(403).json({
          success: false,
          error: { code: 'SELF_VERIFICATION_PROHIBITED', message: 'You cannot approve your own supplier account verification' }
        });
      }

      const validStatuses = ['VERIFIED', 'REJECTED', 'SUSPENDED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED'];
      if (!validStatuses.includes(verification_status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: `Status must be one of: [${validStatuses.join(', ')}]` }
        });
      }

      // Check supplier profile exists
      const [profiles] = await db.query('SELECT * FROM supplier_profiles WHERE supplier_id = ?', [id]);
      if (!profiles[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Supplier profile not found' } });
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const isApproved = verification_status === 'VERIFIED';

        // Update supplier profile
        await connection.query(
          `UPDATE supplier_profiles
           SET verification_status = ?,
               verification_level = ?,
               subscription_plan = ?,
               max_active_listings = ?,
               transaction_fee_percent = ?
           WHERE supplier_id = ?`,
          [verification_status, verification_level, subscription_plan, max_active_listings, transaction_fee_percent, id]
        );

        // Update users table
        await connection.query(
          `UPDATE users
           SET role = CASE WHEN ? = 1 THEN 'SUPPLIER' ELSE role END,
               is_verified = ?,
               verification_status = ?
           WHERE id = ?`,
          [isApproved ? 1 : 0, isApproved ? 1 : 0, isApproved ? 'VERIFIED' : 'PENDING_SUPPLIER_VERIFICATION', id]
        );

        // Audit Log
        await connection.query(
          `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
           VALUES (?, ?, 'SUPPLIER_VERIFICATION_UPDATE', 'supplier_profiles', ?, ?, ?)`,
          [
            adminId,
            req.user.role,
            id,
            JSON.stringify({ status: profiles[0].verification_status }),
            JSON.stringify({ verification_status, verification_level, subscription_plan })
          ]
        );

        await connection.commit();
        connection.release();

        return res.status(200).json({
          success: true,
          message: `Supplier verification status updated to '${verification_status}'`,
          data: {
            supplier_id: parseInt(id),
            verification_status,
            verification_level,
            subscription_plan
          }
        });

      } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
      }

    } catch (error) {
      console.error('Verify Supplier Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/admin/users/:id/suspend
  // Permitted Roles: OPERATIONS_ADMIN, SUPER_ADMIN
  // Suspends/Blocks a compromised or fraudulent user account
  // ---------------------------------------------------------------------------
  async suspendUser(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = req.user.id;

      if (parseInt(id) === adminId) {
        return res.status(403).json({
          success: false,
          error: { code: 'SELF_SUSPENSION_PROHIBITED', message: 'You cannot suspend your own administrative account' }
        });
      }

      const [users] = await db.query('SELECT id, role, verification_status FROM users WHERE id = ?', [id]);
      if (!users[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }

      await db.query(
        `UPDATE users
         SET verification_status = 'BLOCKED', buyer_trust_status = 'SUSPENDED'
         WHERE id = ?`,
        [id]
      );

      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, ?, 'USER_SUSPENDED', 'users', ?, ?)`,
        [adminId, req.user.role, id, JSON.stringify({ reason: reason || 'Administrative suspension' })]
      );

      return res.status(200).json({
        success: true,
        message: 'User account has been suspended successfully.',
        data: { user_id: parseInt(id), status: 'SUSPENDED' }
      });

    } catch (error) {
      console.error('Suspend User Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/admin/users/:id/reactivate
  // Permitted Roles: SUPER_ADMIN
  // ---------------------------------------------------------------------------
  async reactivateUser(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;

      const [users] = await db.query('SELECT id, role FROM users WHERE id = ?', [id]);
      if (!users[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }

      await db.query(
        `UPDATE users
         SET verification_status = 'VERIFIED', buyer_trust_status = 'TRUSTED_BUYER'
         WHERE id = ?`,
        [id]
      );

      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, ?, 'USER_REACTIVATED', 'users', ?, ?)`,
        [adminId, req.user.role, id, JSON.stringify({ status: 'REACTIVATED' })]
      );

      return res.status(200).json({
        success: true,
        message: 'User account has been reactivated successfully.',
        data: { user_id: parseInt(id), status: 'ACTIVE' }
      });

    } catch (error) {
      console.error('Reactivate User Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }
}

module.exports = new AdminController();
