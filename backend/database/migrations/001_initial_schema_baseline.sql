-- =============================================================================
-- Migration 001: Initial Schema Baseline
-- Applies baseline tables if not already existing
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  business_name VARCHAR(100) NULL,
  email VARCHAR(100) UNIQUE NULL,
  phone VARCHAR(20) UNIQUE NULL,
  password_hash VARCHAR(255) NULL,
  google_id VARCHAR(255) UNIQUE NULL,
  role ENUM('BUYER', 'SUPPLIER', 'ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'SUPPORT_ADMIN') NOT NULL DEFAULT 'BUYER',
  business_type VARCHAR(50) NULL,
  city VARCHAR(50) DEFAULT 'Lahore',
  area VARCHAR(100) NULL,
  address TEXT NULL,
  is_verified TINYINT(1) NOT NULL DEFAULT 0,
  verification_status ENUM('UNVERIFIED', 'EMAIL_OTP_SENT', 'PHONE_OTP_SENT', 'EMAIL_VERIFIED', 'PHONE_VERIFIED', 'PENDING_SUPPLIER_VERIFICATION', 'VERIFIED', 'BLOCKED') NOT NULL DEFAULT 'UNVERIFIED',
  buyer_trust_status ENUM('CONTACT_VERIFIED', 'BUSINESS_VERIFIED', 'TRUSTED_BUYER', 'UNDER_REVIEW', 'RESTRICTED', 'SUSPENDED') DEFAULT 'CONTACT_VERIFIED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_email (email),
  INDEX idx_users_phone (phone),
  INDEX idx_users_role (role)
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  category VARCHAR(50) NOT NULL,
  brand VARCHAR(50) NOT NULL,
  variety VARCHAR(50) NOT NULL,
  processing_type VARCHAR(50) NOT NULL,
  grade VARCHAR(50) NOT NULL,
  pack_size VARCHAR(30) NOT NULL,
  unit VARCHAR(20) DEFAULT 'kg',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_products_category (category),
  INDEX idx_products_brand (brand)
);
