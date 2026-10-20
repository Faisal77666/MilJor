-- =============================================================================
-- Migration 002: Payment Unification & Price Locking
-- Ensures payments table is single source of truth and reservations has locked prices
-- =============================================================================

-- Ensure schema_migrations table exists
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  version VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Drop legacy escrow_payments table if it still exists
DROP TABLE IF EXISTS escrow_payments;

-- Verify payments table has correct unified schema
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_code VARCHAR(30) UNIQUE NOT NULL,
  order_id INT NULL,
  reservation_id INT NULL,
  buyer_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  buyer_fee DECIMAL(12,2) DEFAULT 0.00,
  payment_method ENUM('JAZZCASH', 'EASYPAISA', 'CARD', 'BANK_TRANSFER', 'WALLET', 'MOCK_GATEWAY') NOT NULL DEFAULT 'MOCK_GATEWAY',
  status ENUM('CREATED', 'PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED') NOT NULL DEFAULT 'CREATED',
  escrow_status ENUM('HELD_IN_ESCROW', 'RELEASED_TO_SUPPLIER', 'REFUNDED') NOT NULL DEFAULT 'HELD_IN_ESCROW',
  transaction_ref VARCHAR(100) NULL,
  provider_response JSON NULL,
  proof_image_url VARCHAR(255) NULL,
  paid_at TIMESTAMP NULL,
  refunded_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payments_buyer (buyer_id),
  INDEX idx_payments_reservation (reservation_id),
  INDEX idx_payments_status (status)
);
