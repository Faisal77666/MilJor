-- =============================================================================
-- Migration 012: Durable Reservation Business Events Outbox
-- MilJor Part 4C.2B: Durable Reservation Events, Buyer/Supplier Visibility & Read-Model Integrity
-- Establishes immutable, idempotent business event persistence for reservation mutations
-- and threshold milestone crossings (supplier minimum, target, tier shifts).
-- =============================================================================

CREATE TABLE IF NOT EXISTS reservation_business_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL UNIQUE COMMENT 'Unique deterministic or UUID event identifier',
  event_type VARCHAR(64) NOT NULL COMMENT 'RESERVATION_CREATED, RESERVATION_QUANTITY_INCREASED, RESERVATION_QUANTITY_DECREASED, RESERVATION_CANCELLED, POOL_DEMAND_CHANGED, POOL_TIER_CHANGED, SUPPLIER_MINIMUM_REACHED, SUPPLIER_MINIMUM_LOST, TARGET_REACHED, TARGET_LOST',
  pool_id INT NOT NULL,
  reservation_id INT NULL COMMENT 'Associated reservation ID if applicable',
  actor_id INT NOT NULL COMMENT 'User ID performing the operation',
  actor_role VARCHAR(32) NOT NULL COMMENT 'BUYER, SUPPLIER, ADMIN',
  idempotency_key VARCHAR(100) NULL COMMENT 'Originating idempotency key to prevent duplicate events on replay',
  previous_quantity DECIMAL(12,4) NULL,
  new_quantity DECIMAL(12,4) NULL,
  previous_aggregate_demand DECIMAL(12,4) NULL,
  new_aggregate_demand DECIMAL(12,4) NULL,
  previous_unit_price DECIMAL(12,2) NULL,
  new_unit_price DECIMAL(12,2) NULL,
  event_payload JSON NOT NULL COMMENT 'Structured event snapshot (excluding sensitive auth/financial data)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_events_pool_created (pool_id, created_at),
  INDEX idx_events_reservation (reservation_id),
  INDEX idx_events_type_created (event_type, created_at),
  INDEX idx_events_idempotency (idempotency_key),
  CONSTRAINT fk_events_pool FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
