// =============================================================================
// src/repositories/userRepo.js
// FIXES:
//   BUG-04: is_verified = 0 by default (was 1)
//   BUG-16: verification_status = 'UNVERIFIED' by default
//   BUG-03: role not accepted in create() — always BUYER for public registration
// =============================================================================
const db = require('../config/db');

class UserRepository {
  // Find User By Email
  async findByEmail(email) {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] || null;
  }

  // Find User By Phone
  async findByPhone(phone) {
    const [rows] = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    return rows[0] || null;
  }

  // Find User By Google ID (for OAuth)
  async findByGoogleId(googleId) {
    const [rows] = await db.query('SELECT * FROM users WHERE google_id = ?', [googleId]);
    return rows[0] || null;
  }

  // Create New User
  // BUG-03 FIX: role parameter removed — always BUYER for public registration
  // BUG-04 FIX: is_verified = 0
  // BUG-16 FIX: verification_status = 'UNVERIFIED'
  async create(userData) {
    const {
      full_name,
      business_name = null,
      email = null,
      phone = null,
      password_hash = null,
      google_id = null,
      business_type = null,
      city = 'Lahore',
      area = null,
      address = null
    } = userData;

    const sql = `
      INSERT INTO users (
        full_name, business_name, email, phone, password_hash, google_id,
        role, business_type, city, area, address,
        verification_status, is_verified
      ) VALUES (?, ?, ?, ?, ?, ?, 'BUYER', ?, ?, ?, ?, 'UNVERIFIED', 0)
    `;

    const values = [
      full_name,
      business_name,
      email,
      phone,
      password_hash,
      google_id,
      business_type,
      city,
      area,
      address
    ];

    const [result] = await db.query(sql, values);
    return result.insertId;
  }

  // Find User By ID (safe — no password_hash)
  async findById(id) {
    const [rows] = await db.query(
      `SELECT id, full_name, business_name, email, phone, role, business_type,
              city, area, address, verification_status, buyer_trust_status,
              is_verified, created_at, updated_at
       FROM users WHERE id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  // Update User Role — Admin use only (not exposed via public endpoint)
  async updateRole(id, role) {
    const ALLOWED_ROLES = ['BUYER', 'SUPPLIER', 'ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'SUPPORT_ADMIN'];
    if (!ALLOWED_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }
    const [result] = await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    return result.affectedRows > 0;
  }

  // Set is_verified — Admin only
  async setVerified(id, isVerified) {
    const [result] = await db.query(
      'UPDATE users SET is_verified = ?, verification_status = ? WHERE id = ?',
      [isVerified ? 1 : 0, isVerified ? 'VERIFIED' : 'UNVERIFIED', id]
    );
    return result.affectedRows > 0;
  }

  // Update verification status
  async updateVerificationStatus(id, status) {
    const [result] = await db.query(
      'UPDATE users SET verification_status = ? WHERE id = ?',
      [status, id]
    );
    return result.affectedRows > 0;
  }
}

module.exports = new UserRepository();