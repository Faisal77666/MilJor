// =============================================================================
// src/controllers/authController.js
// MilJor Authentication & Session Management
// Security Enhancements:
//   - Password complexity validation (min 8 chars, 1 letter, 1 number)
//   - Pakistani/standard phone format validation
//   - Generic error messages preventing user enumeration
//   - Strict BUYER assignment on public registration (role injection blocked)
//   - Standard JWT claims (issuer: 'miljor-api', audience: 'miljor-app')
//   - Active account suspension check on login
//   - Logout endpoint with audit footprint
// =============================================================================
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_ISSUER, JWT_AUDIENCE } = require('../middlewares/authGuard');

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '7d';

// Sign token with standard issuer & audience claims
const signToken = (payload) => jwt.sign(payload, JWT_SECRET, {
  expiresIn: JWT_EXPIRES_IN,
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE
});

// Helper: Sanitize user response (never leak password_hash)
const safeUser = (user) => ({
  id: user.id,
  full_name: user.full_name,
  business_name: user.business_name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  verification_status: user.verification_status,
  buyer_trust_status: user.buyer_trust_status,
  is_verified: Boolean(user.is_verified),
  city: user.city,
  area: user.area,
  created_at: user.created_at
});

class AuthController {

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/register
  // Public Buyer Registration — Strictly creates BUYER accounts
  // ---------------------------------------------------------------------------
  async register(req, res) {
    try {
      const { full_name, business_name, email, phone, password, area, address } = req.body;

      // 1. Password Complexity Validation
      if (!password || password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Password must be at least 8 characters long and contain both letters and numbers'
          }
        });
      }

      // 2. Identity Contact Validation
      if (!email && !phone) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Either email address or phone number is required' }
        });
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid email format' }
        });
      }

      const cleanPhone = phone ? phone.replace(/[\s-]/g, '') : null;

      if (cleanPhone && !/^[0-9]{11}$/.test(cleanPhone)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Phone number must be exactly 11 digits (e.g. 03001234567)' }
        });
      }

      // 3. Uniqueness Check
      const [existing] = await db.query(
        'SELECT id FROM users WHERE (email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?)',
        [email || null, cleanPhone || null]
      );

      if (existing.length > 0) {
        return res.status(409).json({
          success: false,
          error: { code: 'USER_EXISTS', message: 'An account with this email or phone number already exists' }
        });
      }

      // 4. Secure Bcrypt Password Hash (12 rounds)
      const passwordHash = await bcrypt.hash(password, 12);

      // 5. Database Insertion — ALWAYS force role = 'BUYER', is_verified = 0, UNVERIFIED
      const [result] = await db.query(
        `INSERT INTO users
          (full_name, business_name, email, phone, password_hash, role, business_type, city, area, address, verification_status, is_verified)
         VALUES (?, ?, ?, ?, ?, 'BUYER', 'General', 'Lahore', ?, ?, 'UNVERIFIED', 0)`,
        [
          full_name || null,
          business_name || null,
          email || null,
          cleanPhone,
          passwordHash,
          area || null,
          address || null
        ]
      );

      const userId = result.insertId;

      // 6. Audit Trail
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'SYSTEM', 'USER_REGISTERED', 'users', ?, ?)`,
        [userId, userId, JSON.stringify({ email, phone: cleanPhone, role: 'BUYER' })]
      );

      // 7. Issue Session Token
      const token = signToken({ id: userId, email: email || null, phone: cleanPhone, role: 'BUYER' });

      return res.status(201).json({
        success: true,
        message: 'Account created successfully. Welcome to MilJor!',
        data: {
          token,
          user: {
            id: userId,
            full_name: full_name || null,
            email: email || null,
            phone: cleanPhone,
            role: 'BUYER',
            verification_status: 'UNVERIFIED',
            is_verified: false
          }
        }
      });

    } catch (error) {
      console.error('Register Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Registration failed. Please try again.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/login
  // Authenticates buyer, supplier, or admin with generic error responses
  // ---------------------------------------------------------------------------
  async login(req, res) {
    try {
      const { identifier, password } = req.body;

      if (!identifier || !password) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Email/phone and password are required' }
        });
      }

      const cleanIdentifier = identifier.trim();

      const [users] = await db.query(
        'SELECT * FROM users WHERE email = ? OR phone = ?',
        [cleanIdentifier, cleanIdentifier]
      );

      // Generic authentication failure — prevents user enumeration
      const genericAuthError = {
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email/phone or password' }
      };

      if (users.length === 0) {
        return res.status(401).json(genericAuthError);
      }

      const user = users[0];

      if (!user.password_hash) {
        return res.status(401).json(genericAuthError);
      }

      // Check account suspension / blocking
      if (user.verification_status === 'BLOCKED' || user.buyer_trust_status === 'SUSPENDED') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCOUNT_SUSPENDED',
            message: 'Your account has been suspended or blocked. Please contact MilJor support.'
          }
        });
      }

      // Verify bcrypt password
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        return res.status(401).json(genericAuthError);
      }

      // Sign session JWT
      const token = signToken({
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role
      });

      // Audit login
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id)
         VALUES (?, ?, 'USER_LOGIN', 'users', ?)`,
        [user.id, user.role, user.id]
      );

      return res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user: safeUser(user)
        }
      });

    } catch (error) {
      console.error('Login Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Login failed. Please try again.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/auth/me  (Protected)
  // Returns authenticated user's profile and supplier metadata if applicable
  // ---------------------------------------------------------------------------
  async getMe(req, res) {
    try {
      const [users] = await db.query(
        `SELECT id, full_name, business_name, email, phone, role, business_type,
                city, area, address, verification_status, buyer_trust_status,
                is_verified, created_at, updated_at
         FROM users WHERE id = ?`,
        [req.user.id]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User account not found' }
        });
      }

      const user = users[0];

      let supplierProfile = null;
      if (user.role === 'SUPPLIER') {
        const [profiles] = await db.query(
          'SELECT * FROM supplier_profiles WHERE supplier_id = ?',
          [user.id]
        );
        supplierProfile = profiles[0] || null;
      }

      return res.status(200).json({
        success: true,
        data: {
          user: safeUser(user),
          supplier_profile: supplierProfile
        }
      });

    } catch (error) {
      console.error('GetMe Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Could not fetch profile.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/supplier/apply  (Protected — BUYER only)
  // Buyer applies for supplier status
  // ---------------------------------------------------------------------------
  async applyForSupplier(req, res) {
    try {
      const userId = req.user.id;
      const { business_name, area, address, tax_ntn, food_license_no } = req.body;

      if (req.user.role !== 'BUYER') {
        return res.status(409).json({
          success: false,
          error: { code: 'ALREADY_SUPPLIER', message: 'Your account is already a supplier or admin account' }
        });
      }

      const [existing] = await db.query(
        'SELECT id FROM supplier_profiles WHERE supplier_id = ?',
        [userId]
      );
      if (existing.length > 0) {
        return res.status(409).json({
          success: false,
          error: { code: 'APPLICATION_EXISTS', message: 'You have already submitted a supplier application' }
        });
      }

      // Update user details
      await db.query(
        `UPDATE users
         SET business_name = COALESCE(?, business_name),
             area = COALESCE(?, area),
             address = COALESCE(?, address),
             verification_status = 'PENDING_SUPPLIER_VERIFICATION'
         WHERE id = ?`,
        [business_name || null, area || null, address || null, userId]
      );

      // Create initial supplier profile
      await db.query(
        `INSERT INTO supplier_profiles
          (supplier_id, verification_level, verification_status, subscription_plan, tax_ntn, food_license_no)
         VALUES (?, 'LEVEL_1_CONTACT', 'PENDING_REVIEW', 'STARTER', ?, ?)`,
        [userId, tax_ntn || null, food_license_no || null]
      );

      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id)
         VALUES (?, 'BUYER', 'SUPPLIER_APPLICATION_SUBMITTED', 'supplier_profiles', ?)`,
        [userId, userId]
      );

      return res.status(201).json({
        success: true,
        message: 'Supplier application submitted successfully. Verification team will review within 2 business days.',
        data: { verification_status: 'PENDING_REVIEW' }
      });

    } catch (error) {
      console.error('Supplier Apply Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Application failed. Please try again.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/logout  (Protected)
  // Client session termination
  // ---------------------------------------------------------------------------
  async logout(req, res) {
    try {
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id)
         VALUES (?, ?, 'USER_LOGOUT', 'users', ?)`,
        [req.user.id, req.user.role, req.user.id]
      );

      return res.status(200).json({
        success: true,
        message: 'Logged out successfully.'
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }
}

module.exports = new AuthController();