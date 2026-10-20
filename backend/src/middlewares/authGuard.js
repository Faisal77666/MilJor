// =============================================================================
// src/middlewares/authGuard.js
// MilJor RBAC & Object Security Guard
// Enforces:
//   - Centralized JWT verification with standard issuer/audience claims
//   - Real-time active account check (immediate revocation on BLOCKED/SUSPENDED)
//   - Granular role authorization with principle of least privilege
//   - Tiered supplier verification checks (Contact, Business, Quality)
// =============================================================================
const jwt = require('jsonwebtoken');
const db = require('../config/db');

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = 'miljor-api';
const JWT_AUDIENCE = 'miljor-app';

// Granular System Roles
const ROLES = {
  BUYER: 'BUYER',
  SUPPLIER: 'SUPPLIER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  FINANCE_ADMIN: 'FINANCE_ADMIN',
  OPERATIONS_ADMIN: 'OPERATIONS_ADMIN',
  VERIFICATION_ADMIN: 'VERIFICATION_ADMIN',
  SUPPORT_ADMIN: 'SUPPORT_ADMIN'
};

const ALL_ROLES = Object.values(ROLES);
const ALL_ADMIN_ROLES = [
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
  ROLES.FINANCE_ADMIN,
  ROLES.OPERATIONS_ADMIN,
  ROLES.VERIFICATION_ADMIN,
  ROLES.SUPPORT_ADMIN
];

// ---------------------------------------------------------------------------
// protect — Verifies JWT token and validates real-time user account status
// ---------------------------------------------------------------------------
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Access denied. No authentication token provided.' }
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });

    // Real-time account status check against database
    // Prevents suspended/blocked users from using unexpired 7-day tokens
    const [userRows] = await db.query(
      `SELECT id, role, is_verified, verification_status, buyer_trust_status
       FROM users WHERE id = ?`,
      [decoded.id]
    );

    if (userRows.length === 0) {
      return res.status(401).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Account no longer exists.' }
      });
    }

    const liveUser = userRows[0];

    // Check account status
    if (liveUser.verification_status === 'BLOCKED' || liveUser.buyer_trust_status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message: 'Your account has been suspended or blocked. Please contact MilJor support.'
        }
      });
    }

    req.user = {
      ...decoded,
      role: liveUser.role, // Live role from DB
      is_verified: liveUser.is_verified,
      verification_status: liveUser.verification_status,
      buyer_trust_status: liveUser.buyer_trust_status
    };

    next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Your session has expired. Please log in again.' }
      });
    }
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Authentication token is invalid or corrupt.' }
    });
  }
};

// ---------------------------------------------------------------------------
// authorize — Enforces role-based permissions (Principle of Least Privilege)
// Usage: authorize('SUPER_ADMIN', 'FINANCE_ADMIN')
// ---------------------------------------------------------------------------
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' }
      });
    }

    // SUPER_ADMIN always has full administrative rights
    const hasPermission = roles.includes(req.user.role) || req.user.role === ROLES.SUPER_ADMIN;

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Permitted role(s): [${roles.join(', ')}]. Your role: ${req.user.role}.`
        }
      });
    }
    next();
  };
};

// Strict role authorization where SUPER_ADMIN cannot bypass (e.g. supplier-only commercial consent)
const authorizeStrict = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' }
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED_ROLE',
          message: `Action strictly requires role(s): [${roles.join(', ')}]. Administrators cannot impersonate commercial consent. Your role: ${req.user.role}.`
        }
      });
    }
    next();
  };
};

// Convenience role guards
const authorizeAdmin = authorize(...ALL_ADMIN_ROLES);
const authorizeFinance = authorize(ROLES.FINANCE_ADMIN);
const authorizeVerification = authorize(ROLES.VERIFICATION_ADMIN);
const authorizeOperations = authorize(ROLES.OPERATIONS_ADMIN);
const authorizeSupport = authorize(ROLES.SUPPORT_ADMIN, ROLES.OPERATIONS_ADMIN);

// ---------------------------------------------------------------------------
// requireVerifiedSupplier — Checks supplier KYC status before restricted actions
// Restricts pool creation and wholesale catalog management to verified suppliers
// ---------------------------------------------------------------------------
const requireVerifiedSupplier = async (req, res, next) => {
  if (ALL_ADMIN_ROLES.includes(req.user.role)) return next();

  if (req.user.role === ROLES.SUPPLIER) {
    try {
      const [rows] = await db.query(
        `SELECT u.verification_status AS user_verification,
                sp.verification_status AS supplier_verification,
                sp.verification_level
         FROM users u
         LEFT JOIN supplier_profiles sp ON sp.supplier_id = u.id
         WHERE u.id = ?`,
        [req.user.id]
      );

      if (!rows[0] || rows[0].supplier_verification !== 'VERIFIED') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'SUPPLIER_NOT_VERIFIED',
            message: 'Your supplier account is pending verification. You cannot launch pools until approved by MilJor Operations.'
          }
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Supplier verification check failed.' }
      });
    }
  }
  next();
};

module.exports = {
  protect,
  authorize,
  authorizeStrict,
  authorizeAdmin,
  authorizeFinance,
  authorizeVerification,
  authorizeOperations,
  authorizeSupport,
  requireVerifiedSupplier,
  ROLES,
  ALL_ROLES,
  ADMIN_ROLES: ALL_ADMIN_ROLES,
  JWT_ISSUER,
  JWT_AUDIENCE
};