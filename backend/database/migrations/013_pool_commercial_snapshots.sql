-- =============================================================================
-- Migration 013: Pool Commercial Snapshots Foundation
-- =============================================================================
-- Project: MilJor B2B Collective Procurement Platform
-- Phase: Part 4D.1 — Regular Pool Commercial Lifecycle Foundation
-- Objective: Provide immutable audit and commercial contract snapshots capturing
-- the exact commercial state of a Regular Pool upon qualification evaluation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pool_commercial_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snapshot_code VARCHAR(36) UNIQUE NOT NULL,
  pool_id INT NOT NULL,
  snapshot_version INT NOT NULL DEFAULT 1,
  qualification_status ENUM('UNQUALIFIED', 'QUALIFIED', 'TARGET_MET', 'CAPACITY_MET') NOT NULL,
  qualification_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  participation_cutoff TIMESTAMP NOT NULL,
  supplier_id INT NOT NULL,
  supplier_listing_id INT NULL,
  product_id INT NOT NULL,
  product_spec_id INT NULL,
  canonical_spec_hash VARCHAR(64) NULL,
  pool_unit VARCHAR(30) NOT NULL,
  eligible_aggregate_qty DECIMAL(12,4) NOT NULL,
  supplier_min_qty DECIMAL(12,4) NOT NULL,
  target_qty DECIMAL(12,4) NOT NULL,
  max_capacity DECIMAL(12,4) NOT NULL,
  applicable_tier_index INT NULL,
  candidate_unit_price DECIMAL(12,2) NOT NULL,
  participating_reservations_count INT NOT NULL DEFAULT 0,
  participating_reservations_summary JSON NOT NULL,
  delivery_type ENUM('DOORSTEP', 'GROUPED_CLUSTER', 'SUPPLIER_PICKUP') NOT NULL,
  delivery_zones JSON NULL,
  delivery_fee_policy VARCHAR(100) NULL,
  fulfilment_lead_time_days INT NOT NULL DEFAULT 1,
  supplier_confirmation_deadline TIMESTAMP NULL,
  buyer_commitment_deadline TIMESTAMP NULL,
  status ENUM('PENDING_SUPPLIER_DECISION', 'SUPERSEDED', 'ACCEPTED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'PENDING_SUPPLIER_DECISION',
  originating_event_id VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_snapshots_pool FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_snapshots_supplier FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_snapshots_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_snapshots_listing FOREIGN KEY (supplier_listing_id) REFERENCES supplier_listings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_snapshots_spec FOREIGN KEY (product_spec_id) REFERENCES product_specifications(id) ON DELETE RESTRICT,
  INDEX idx_snapshots_pool_version (pool_id, snapshot_version),
  INDEX idx_snapshots_status (status),
  INDEX idx_snapshots_qualification (qualification_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
