// =============================================================================
// src/routes/v1/auditRoutes.js
// MilJor Platform Audit & Ledger Reports
// Enforces Least Privilege Role-Based Access:
//   - Financial summary: FINANCE_ADMIN, SUPER_ADMIN only
//   - Audit logs: SUPPORT_ADMIN, OPERATIONS_ADMIN, SUPER_ADMIN
// =============================================================================
const express = require('express');
const router = express.Router();
const ledgerRepo = require('../../repositories/ledgerRepo');
const { protect, authorizeFinance, authorizeSupport } = require('../../middlewares/authGuard');

// ---------------------------------------------------------------------------
// GET /api/v1/audit/owner/financial-summary
// Permitted: FINANCE_ADMIN, SUPER_ADMIN
// ---------------------------------------------------------------------------
router.get(
  '/owner/financial-summary',
  protect,
  authorizeFinance,
  async (req, res) => {
    try {
      const summary = await ledgerRepo.getOwnerFinancialSummary();
      return res.status(200).json({
        success: true,
        message: 'Platform Owner Revenue & Escrow Ledger Audit',
        data: { summary }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Could not fetch financial summary.' }
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/v1/audit/logs — System audit log viewer
// Permitted: SUPPORT_ADMIN, OPERATIONS_ADMIN, SUPER_ADMIN
// ---------------------------------------------------------------------------
router.get(
  '/logs',
  protect,
  authorizeSupport,
  async (req, res) => {
    try {
      const { entity, action, page = 1, limit = 50 } = req.query;
      const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 50));
      const parsedPage = Math.max(1, parseInt(page) || 1);
      const offset = (parsedPage - 1) * parsedLimit;

      const params = [];
      let where = 'WHERE 1=1';

      if (entity) { where += ' AND entity_name = ?'; params.push(entity); }
      if (action) { where += ' AND action = ?'; params.push(action); }

      const db = require('../../config/db');
      const [logs] = await db.query(
        `SELECT l.*, u.full_name AS actor_name
         FROM system_audit_logs l
         LEFT JOIN users u ON l.actor_id = u.id
         ${where}
         ORDER BY l.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, parsedLimit, offset]
      );

      return res.status(200).json({
        success: true,
        count: logs.length,
        page: parsedPage,
        limit: parsedLimit,
        data: { logs }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }
);

module.exports = router;