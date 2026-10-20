-- =============================================================================
-- database/migrations/011_reservation_mutation_history.sql
-- MilJor Part 4C.1: Immutable Reservation Mutation History & Durable Operation Auditing
-- Tracks every quantity update and cancellation event with before/after state,
-- estimated pricing snapshot, aggregate demand snapshot, actor, and idempotency key.
-- =============================================================================

CREATE TABLE IF NOT EXISTS reservation_mutation_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  pool_id INT NOT NULL,
  buyer_id INT NOT NULL,
  mutation_type ENUM('QUANTITY_UPDATE', 'CANCELLATION') NOT NULL,
  previous_quantity DECIMAL(12,4) NOT NULL,
  new_quantity DECIMAL(12,4) NOT NULL,
  previous_unit_price DECIMAL(12,2) NOT NULL,
  new_unit_price DECIMAL(12,2) NOT NULL,
  previous_total_price DECIMAL(12,2) NOT NULL,
  new_total_price DECIMAL(12,2) NOT NULL,
  previous_status ENUM('RESERVED','CONFIRMED','PAID','CANCELLED','EXPIRED') NOT NULL,
  new_status ENUM('RESERVED','CONFIRMED','PAID','CANCELLED','EXPIRED') NOT NULL,
  aggregate_qty_snapshot DECIMAL(12,4) NOT NULL,
  idempotency_key VARCHAR(100) NULL,
  response_payload JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rmh_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON DELETE CASCADE,
  CONSTRAINT fk_rmh_pool FOREIGN KEY (pool_id) REFERENCES pools (id) ON DELETE CASCADE,
  CONSTRAINT fk_rmh_buyer FOREIGN KEY (buyer_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_rmh_res_created (reservation_id, created_at),
  INDEX idx_rmh_idem_key (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
