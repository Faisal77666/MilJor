-- =============================================================================
-- Migration 019: Safepay Sandbox Payment Attempts & Webhook Events
-- Phase: MilJor Part 4E.3
-- Purpose:
-- 1. Create payment_attempts table for durable tracking of checkout sessions,
--    provider tokens (track_...), amounts, currency, and lifecycle states.
-- 2. Create payment_webhook_events table for cryptographic webhook receipt,
--    raw signature storage, idempotency, and audit trails.
-- 3. Preserve existing orders, reservations, pools, and payments tables.
-- =============================================================================

CREATE TABLE IF NOT EXISTS payment_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attempt_code VARCHAR(36) UNIQUE NOT NULL COMMENT 'Internal attempt ID, e.g. ATT-ORD-123-ABC',
  order_id INT NOT NULL,
  buyer_id INT NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'SAFEPAY',
  environment VARCHAR(16) NOT NULL DEFAULT 'sandbox',
  provider_tracker_token VARCHAR(128) NULL COMMENT 'Safepay tracker token, e.g. track_...',
  checkout_url TEXT NULL COMMENT 'Safepay hosted checkout redirect URL',
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  status ENUM('INITIATED', 'COMPLETED', 'FAILED', 'EXPIRED', 'RECONCILIATION_REQUIRED') NOT NULL DEFAULT 'INITIATED',
  idempotency_key VARCHAR(100) NULL COMMENT 'Scoped initiation idempotency key',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_payment_attempts_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_attempts_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_attempts_order (order_id),
  INDEX idx_attempts_tracker (provider_tracker_token),
  INDEX idx_attempts_idempotency (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(128) UNIQUE NOT NULL COMMENT 'Provider event ID from X-SFPY-EVENT-ID or data.id',
  provider VARCHAR(32) NOT NULL DEFAULT 'SAFEPAY',
  event_type VARCHAR(64) NOT NULL COMMENT 'e.g. payment.completed',
  order_id INT NULL,
  attempt_id INT NULL,
  provider_tracker_token VARCHAR(128) NULL,
  signature VARCHAR(255) NOT NULL COMMENT 'X-SFPY-SIGNATURE header received',
  timestamp_header VARCHAR(64) NOT NULL COMMENT 'X-SFPY-TIMESTAMP header received',
  raw_payload JSON NOT NULL,
  processed_status ENUM('PROCESSED', 'IGNORED_DUPLICATE', 'FAILED', 'RECONCILIATION_REQUIRED') NOT NULL DEFAULT 'PROCESSED',
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_webhook_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_webhook_attempt FOREIGN KEY (attempt_id) REFERENCES payment_attempts(id) ON DELETE SET NULL,
  INDEX idx_webhook_tracker (provider_tracker_token),
  INDEX idx_webhook_type (event_type),
  INDEX idx_webhook_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
