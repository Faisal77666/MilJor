-- =============================================================================
-- MILJOR B2B MARKETPLACE — MASTER DATABASE SCHEMA
-- Version: 2.0.0 (Phase 1 Cleanup)
-- Target: MySQL 8.0+
-- Financial Precision: DECIMAL(12,2)
-- SAFE TO RE-RUN: Uses DROP TABLE IF EXISTS in correct FK order
-- =============================================================================

USE miljor_db;

-- =============================================================================
-- DROP TABLES (Reverse FK dependency order for safe re-run)
-- =============================================================================
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS system_audit_logs;
DROP TABLE IF EXISTS idempotency_records;
DROP TABLE IF EXISTS escrow_payments;        -- BUG-01 FIX: Remove duplicate payment table
DROP TABLE IF EXISTS platform_ledger;
DROP TABLE IF EXISTS order_disputes;
DROP TABLE IF EXISTS rfq_quotes;
DROP TABLE IF EXISTS rfqs;
DROP TABLE IF EXISTS flash_pools;
DROP TABLE IF EXISTS recurring_contracts;
DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS pool_price_tiers;
DROP TABLE IF EXISTS pools;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS buyer_fee_slabs;
DROP TABLE IF EXISTS supplier_profiles;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- 1. USERS TABLE
-- BUG-04 FIX: is_verified DEFAULT 0 (was 1 — auto-verified everyone)
-- BUG-03 CONTEXT: role column here; registration controller will always force BUYER
-- =============================================================================
CREATE TABLE users (
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
  -- BUG-04 FIX: DEFAULT 0 — must be explicitly set to 1 by admin after verification
  is_verified TINYINT(1) NOT NULL DEFAULT 0,
  -- BUG-16 FIX: Default is UNVERIFIED — not PHONE_VERIFIED without OTP
  verification_status ENUM(
    'UNVERIFIED',
    'EMAIL_OTP_SENT',
    'PHONE_OTP_SENT',
    'EMAIL_VERIFIED',
    'PHONE_VERIFIED',
    'PENDING_SUPPLIER_VERIFICATION',
    'VERIFIED',
    'BLOCKED'
  ) NOT NULL DEFAULT 'UNVERIFIED',
  buyer_trust_status ENUM(
    'CONTACT_VERIFIED',
    'BUSINESS_VERIFIED',
    'TRUSTED_BUYER',
    'UNDER_REVIEW',
    'RESTRICTED',
    'SUSPENDED'
  ) DEFAULT 'CONTACT_VERIFIED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_users_contact CHECK (email IS NOT NULL OR phone IS NOT NULL OR google_id IS NOT NULL),
  INDEX idx_users_email (email),
  INDEX idx_users_phone (phone),
  INDEX idx_users_role (role)
);

-- =============================================================================
-- 2. PRODUCTS TABLE
-- =============================================================================
CREATE TABLE products (
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

-- =============================================================================
-- 3. SUPPLIER PROFILES TABLE
-- =============================================================================
CREATE TABLE supplier_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT UNIQUE NOT NULL,
  verification_level ENUM('LEVEL_1_CONTACT', 'LEVEL_2_BUSINESS', 'LEVEL_3_QUALITY') DEFAULT 'LEVEL_1_CONTACT',
  verification_status ENUM(
    'NOT_SUBMITTED',
    'PENDING_REVIEW',
    'MORE_INFORMATION_REQUIRED',
    'UNDER_REVIEW',
    'VERIFIED',
    'REJECTED',
    'SUSPENDED',
    'EXPIRED'
  ) DEFAULT 'NOT_SUBMITTED',
  subscription_plan ENUM('STARTER', 'GROWTH', 'BUSINESS') DEFAULT 'STARTER',
  max_active_listings INT DEFAULT 5,
  transaction_fee_percent DECIMAL(5,2) DEFAULT 2.50,
  tax_ntn VARCHAR(50) NULL,
  food_license_no VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =============================================================================
-- 4. BUYER FEE SLABS TABLE
-- =============================================================================
CREATE TABLE buyer_fee_slabs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  min_order_amount DECIMAL(12,2) NOT NULL,
  max_order_amount DECIMAL(12,2) NOT NULL,
  fee_percentage DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 5. POOLS TABLE
-- BUG-09 FIX: Added AWAITING_SUPPLIER_CONFIRMATION, PAYMENT_PENDING,
--             DISPATCHED, DELIVERED, CANCELLED, SUPPLIER_FAILED
-- =============================================================================
CREATE TABLE pools (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pool_code VARCHAR(20) UNIQUE NOT NULL,
  supplier_id INT NOT NULL,
  product_id INT NOT NULL,
  current_qty INT DEFAULT 0,
  target_qty INT NOT NULL,
  supplier_min_qty INT NOT NULL,
  buyer_min_qty INT NOT NULL,
  current_price_per_unit DECIMAL(12,2) NOT NULL,
  next_tier_price DECIMAL(12,2) NULL,
  platform_fee_percent DECIMAL(5,2) DEFAULT 2.50,
  quality_spec_grade VARCHAR(50) DEFAULT 'Grade-A Standard',
  supplier_confirmation_notes TEXT NULL,
  status ENUM(
    'DRAFT',
    'ACTIVE',
    'TARGET_REACHED',
    'AWAITING_SUPPLIER_CONFIRMATION',
    'CONFIRMED',
    'PAYMENT_PENDING',
    'FULFILLING',
    'DISPATCHED',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
    'EXPIRED',
    'SUPPLIER_FAILED'
  ) NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMP NOT NULL,
  confirmed_at TIMESTAMP NULL,
  closed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_pools_status_expiry (status, expires_at),
  INDEX idx_pools_supplier (supplier_id)
);

-- =============================================================================
-- 6. POOL PRICE TIERS TABLE
-- =============================================================================
CREATE TABLE pool_price_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pool_id INT NOT NULL,
  min_qty INT NOT NULL,
  max_qty INT NOT NULL,
  price_per_unit DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE,
  INDEX idx_tiers_pool (pool_id)
);

-- =============================================================================
-- 7. RESERVATIONS TABLE
-- BUG-10 FIX: Added locked_unit_price — set when reservation is CONFIRMED.
--             Retroactive price recalculation must NEVER touch CONFIRMED/PAID reservations.
-- =============================================================================
CREATE TABLE reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_code VARCHAR(20) UNIQUE NOT NULL,
  pool_id INT NOT NULL,
  buyer_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,          -- Current estimated price (can change while RESERVED)
  locked_unit_price DECIMAL(12,2) NULL,       -- Set on CONFIRMED — immutable thereafter
  total_price DECIMAL(12,2) NOT NULL,
  locked_total_price DECIMAL(12,2) NULL,      -- Set on CONFIRMED — immutable thereafter
  status ENUM('RESERVED', 'CONFIRMED', 'PAID', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'RESERVED',
  confirmed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_reservations_buyer (buyer_id),
  INDEX idx_reservations_pool (pool_id),
  UNIQUE INDEX idx_unique_buyer_pool (buyer_id, pool_id)   -- One reservation per buyer per pool
);

-- =============================================================================
-- 8. ORDERS TABLE
-- =============================================================================
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_code VARCHAR(20) UNIQUE NOT NULL,
  reservation_id INT NULL,
  buyer_id INT NOT NULL,
  supplier_id INT NOT NULL,
  pool_id INT NULL,
  total_qty INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  subtotal_amount DECIMAL(12,2) NOT NULL,
  delivery_fee DECIMAL(12,2) DEFAULT 0.00,
  buyer_platform_fee DECIMAL(12,2) DEFAULT 0.00,
  total_amount DECIMAL(12,2) NOT NULL,
  delivery_type ENUM('DOORSTEP', 'GROUPED_CLUSTER', 'SUPPLIER_PICKUP') NOT NULL DEFAULT 'DOORSTEP',
  delivery_address TEXT NULL,
  cluster_zone VARCHAR(100) NULL,
  payment_status ENUM(
    'AWAITING_PAYMENT',
    'PAYMENT_INITIATED',
    'PAID',
    'PAYMENT_FAILED',
    'REFUND_PENDING',
    'REFUNDED'
  ) NOT NULL DEFAULT 'AWAITING_PAYMENT',
  order_status ENUM(
    'AWAITING_PAYMENT',
    'PAID',
    'SUPPLIER_CONFIRMED',
    'PROCESSING',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED',
    'DISPUTED'
  ) NOT NULL DEFAULT 'AWAITING_PAYMENT',
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL,
  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE SET NULL,
  INDEX idx_orders_buyer (buyer_id),
  INDEX idx_orders_supplier (supplier_id)
);

-- =============================================================================
-- 9. PAYMENTS TABLE — SINGLE AUTHORITATIVE SOURCE
-- BUG-01 FIX: This is the ONLY payment table. escrow_payments is removed.
-- Full status lifecycle + escrow tracking unified here.
-- =============================================================================
CREATE TABLE payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_code VARCHAR(30) UNIQUE NOT NULL,
  order_id INT NULL,
  reservation_id INT NULL,
  buyer_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,              -- Amount buyer pays (subtotal + buyer fee)
  buyer_fee DECIMAL(12,2) DEFAULT 0.00,       -- Marketplace fee collected from buyer
  payment_method ENUM(
    'JAZZCASH',
    'EASYPAISA',
    'CARD',
    'BANK_TRANSFER',
    'WALLET',
    'MOCK_GATEWAY'
  ) NOT NULL DEFAULT 'MOCK_GATEWAY',
  -- Full payment lifecycle
  status ENUM(
    'CREATED',
    'PENDING',
    'PROCESSING',
    'PAID',
    'FAILED',
    'EXPIRED',
    'REFUND_PENDING',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'DISPUTED'
  ) NOT NULL DEFAULT 'CREATED',
  -- Escrow state (where the money sits)
  escrow_status ENUM(
    'HELD_IN_ESCROW',
    'RELEASED_TO_SUPPLIER',
    'REFUNDED'
  ) NOT NULL DEFAULT 'HELD_IN_ESCROW',
  transaction_ref VARCHAR(100) NULL,          -- Provider transaction reference
  provider_response JSON NULL,                -- Full provider callback payload
  proof_image_url VARCHAR(255) NULL,
  paid_at TIMESTAMP NULL,
  refunded_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  INDEX idx_payments_buyer (buyer_id),
  INDEX idx_payments_reservation (reservation_id),
  INDEX idx_payments_status (status)
);

-- =============================================================================
-- 10. PLATFORM LEDGER TABLE
-- payment_id references payments(id) — the unified table
-- =============================================================================
CREATE TABLE platform_ledger (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ledger_code VARCHAR(35) UNIQUE NOT NULL,
  payment_id INT NOT NULL,
  gross_amount DECIMAL(12,2) NOT NULL,
  platform_fee_amount DECIMAL(12,2) NOT NULL,
  supplier_net_amount DECIMAL(12,2) NOT NULL,
  payout_status ENUM(
    'HELD_IN_ESCROW',
    'READY_FOR_PAYOUT',
    'PAID_TO_SUPPLIER',
    'REFUNDED_TO_BUYER'
  ) NOT NULL DEFAULT 'HELD_IN_ESCROW',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
);

-- =============================================================================
-- 11. ORDER DISPUTES TABLE
-- =============================================================================
CREATE TABLE order_disputes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dispute_code VARCHAR(30) UNIQUE NOT NULL,
  order_id INT NULL,
  reservation_id INT NULL,
  buyer_id INT NOT NULL,
  reason ENUM(
    'WRONG_PRODUCT',
    'DAMAGED_GOODS',
    'SHORTAGE_IN_QUANTITY',
    'QUALITY_MISMATCH',
    'NOT_DELIVERED',
    'SAFETY_ISSUE'
  ) NOT NULL,
  description TEXT NOT NULL,
  evidence_image_url VARCHAR(255) NULL,
  status ENUM(
    'OPEN',
    'EVIDENCE_REQUESTED',
    'SUPPLIER_RESPONSE',
    'BUYER_RESPONSE',
    'UNDER_REVIEW',
    'RESOLVED_REFUND',
    'RESOLVED_PARTIAL_REFUND',
    'RESOLVED_REJECTED',
    'ESCALATED',
    'CLOSED'
  ) NOT NULL DEFAULT 'OPEN',
  resolution_type ENUM(
    'NO_REFUND',
    'FULL_REFUND',
    'PARTIAL_REFUND',
    'REPLACEMENT',
    'RE_DELIVERY'
  ) NULL,
  refund_amount DECIMAL(12,2) NULL,
  admin_notes TEXT NULL,
  resolved_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_disputes_buyer (buyer_id),
  INDEX idx_disputes_status (status)
);

-- =============================================================================
-- 12. FLASH POOLS TABLE
-- =============================================================================
CREATE TABLE flash_pools (
  id INT AUTO_INCREMENT PRIMARY KEY,
  flash_code VARCHAR(35) UNIQUE NOT NULL,
  supplier_id INT NOT NULL,
  product_id INT NOT NULL,
  total_stock DECIMAL(12,2) NOT NULL,
  remaining_stock DECIMAL(12,2) NOT NULL,
  discounted_unit_price DECIMAL(12,2) NOT NULL,
  original_unit_price DECIMAL(12,2) NULL,
  min_quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
  max_quantity_per_buyer DECIMAL(12,2) NULL,
  clearance_reason VARCHAR(255) NOT NULL,
  condition_notes TEXT NULL,
  expiry_time DATETIME NOT NULL,
  status ENUM('ACTIVE', 'SOLD_OUT', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_flash_status (status, expiry_time)
);

-- =============================================================================
-- 13. RFQs TABLE
-- =============================================================================
CREATE TABLE rfqs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rfq_code VARCHAR(35) UNIQUE NOT NULL,
  buyer_id INT NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  required_specifications TEXT NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  delivery_address TEXT NOT NULL,
  delivery_date DATE NOT NULL,
  target_price DECIMAL(12,2) NULL,
  quote_expiry_date DATE NOT NULL,
  special_requirements TEXT NULL,
  status ENUM('OPEN', 'QUOTED', 'ACCEPTED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_rfqs_buyer (buyer_id),
  INDEX idx_rfqs_status (status)
);

-- =============================================================================
-- 14. RFQ QUOTES TABLE (Versioned)
-- =============================================================================
CREATE TABLE rfq_quotes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quote_code VARCHAR(35) UNIQUE NOT NULL,
  rfq_id INT NOT NULL,
  supplier_id INT NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  delivery_fee DECIMAL(12,2) DEFAULT 0.00,
  total_delivered_cost DECIMAL(12,2) NOT NULL,
  quote_validity_date DATETIME NOT NULL,
  supplier_notes TEXT NULL,
  status ENUM('SUBMITTED', 'REVISED', 'ACCEPTED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'SUBMITTED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_quotes_rfq (rfq_id),
  INDEX idx_quotes_supplier (supplier_id)
);

-- =============================================================================
-- 15. RECURRING CONTRACTS TABLE
-- =============================================================================
CREATE TABLE recurring_contracts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contract_code VARCHAR(35) UNIQUE NOT NULL,
  buyer_id INT NOT NULL,
  supplier_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'kg',
  frequency ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM') NOT NULL DEFAULT 'WEEKLY',
  agreed_unit_price DECIMAL(12,2) NOT NULL,
  pending_new_price DECIMAL(12,2) NULL,
  price_change_status ENUM(
    'STABLE',
    'PRICE_CHANGE_PENDING_BUYER_APPROVAL'
  ) NOT NULL DEFAULT 'STABLE',
  delivery_address TEXT NULL,
  delivery_window_start TIME NULL,
  delivery_window_end TIME NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  next_delivery_date DATE NOT NULL,
  status ENUM('ACTIVE', 'PAUSED', 'CANCELLED', 'SUPPLIER_FAILED', 'COMPLETED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_recurring_buyer (buyer_id)
);

-- =============================================================================
-- 16. IDEMPOTENCY RECORDS TABLE
-- =============================================================================
CREATE TABLE idempotency_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  idempotency_key VARCHAR(100) UNIQUE NOT NULL,
  user_id INT NULL,
  request_path VARCHAR(255) NOT NULL,
  response_status INT NOT NULL,
  response_body LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Auto-expire after 24 hours (application-level cleanup)
  INDEX idx_idempotency_key (idempotency_key),
  INDEX idx_idempotency_created (created_at)
);

-- =============================================================================
-- 17. SYSTEM AUDIT LOGS TABLE
-- =============================================================================
CREATE TABLE system_audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NULL,
  actor_role VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity_name VARCHAR(100) NOT NULL,
  entity_id INT NULL,
  previous_value JSON NULL,
  new_value JSON NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor (actor_id),
  INDEX idx_audit_entity (entity_name, entity_id),
  INDEX idx_audit_created (created_at)
);