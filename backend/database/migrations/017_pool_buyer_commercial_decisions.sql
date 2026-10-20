-- =============================================================================
-- Migration 017: pool_buyer_commercial_decisions
-- Creates the immutable historical ledger of buyer commercial decisions (ACCEPT / DECLINE)
-- on qualified, supplier-accepted Regular Pool offers.
-- Enforces DB-level uniqueness: One decision per reservation per snapshot.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pool_buyer_commercial_decisions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  decision_code VARCHAR(36) NOT NULL UNIQUE,
  pool_id INT NOT NULL,
  reservation_id INT NOT NULL,
  snapshot_id INT NOT NULL,
  snapshot_version INT NOT NULL DEFAULT 1,
  supplier_decision_id INT NOT NULL,
  buyer_id INT NOT NULL,
  actor_id INT NOT NULL,
  actor_role ENUM('BUYER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'BUYER',
  decision ENUM('ACCEPT', 'DECLINE') NOT NULL,
  decline_reason_code ENUM(
    'PRICE_HIGH',
    'FOUND_ALTERNATIVE',
    'NO_LONGER_NEEDED',
    'DELIVERY_WINDOW_UNSUITABLE',
    'TERMS_UNACCEPTABLE',
    'OTHER'
  ) NULL,
  decline_reason_notes TEXT NULL,
  accepted_quantity DECIMAL(12,4) NOT NULL,
  agreed_unit_price DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  price_lock_status ENUM('LOCKED', 'DECLINED', 'BLOCKED') NOT NULL,
  originating_event_id VARCHAR(64) NULL,
  idempotency_key VARCHAR(128) NULL,
  decision_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Foreign keys
  CONSTRAINT fk_buyer_decisions_pool FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_buyer_decisions_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_buyer_decisions_snapshot FOREIGN KEY (snapshot_id) REFERENCES pool_commercial_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_buyer_decisions_supp_dec FOREIGN KEY (supplier_decision_id) REFERENCES pool_supplier_commercial_decisions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_buyer_decisions_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_buyer_decisions_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,

  -- DB-Level Uniqueness: Exactly one authoritative buyer decision per reservation per snapshot
  CONSTRAINT uq_buyer_decisions_reservation_snapshot UNIQUE (reservation_id, snapshot_id),

  -- Performance and audit indexes
  INDEX idx_buyer_decisions_pool (pool_id),
  INDEX idx_buyer_decisions_buyer (buyer_id),
  INDEX idx_buyer_decisions_decision (decision),
  INDEX idx_buyer_decisions_timestamp (decision_timestamp),
  INDEX idx_buyer_decisions_idempotency (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
