-- =============================================================================
-- Migration 016: Immutable Supplier Commercial Decisions
-- =============================================================================
-- Project: MilJor B2B Collective Procurement Platform
-- Phase: Part 4D.3 — Production-Grade Supplier Confirmation & Rejection Engine
-- Objective: Record immutable, authoritative commercial decisions made by verified
-- suppliers on qualified Regular Pools (AWAITING_SUPPLIER_CONFIRMATION).
--
-- Invariants:
-- 1. Snapshot Linkage: Exactly one authoritative decision per qualification snapshot.
-- 2. Decision Uniqueness: uq_supplier_decisions_snapshot enforces at DB level that
--    a qualification snapshot cannot have conflicting decisions (e.g. ACCEPT & REJECT).
-- 3. Immutability: Append-only audit table with strict foreign key constraints.
-- 4. Idempotency Linkage: Stores originating idempotency key and operation hash.
-- 5. Outbox Event Linkage: Linked to durable business event (SUPPLIER_OFFER_ACCEPTED / SUPPLIER_OFFER_REJECTED).
-- =============================================================================

CREATE TABLE IF NOT EXISTS pool_supplier_commercial_decisions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  decision_code VARCHAR(36) UNIQUE NOT NULL COMMENT 'Unique identifier, e.g. DEC-10-1771345678-ABC123',
  pool_id INT NOT NULL,
  snapshot_id INT NOT NULL,
  snapshot_version INT NOT NULL DEFAULT 1,
  supplier_id INT NOT NULL COMMENT 'Authoritative supplier identity (users.id)',
  actor_id INT NOT NULL COMMENT 'Authenticated actor who submitted the decision',
  actor_role VARCHAR(32) NOT NULL COMMENT 'Must be SUPPLIER',
  decision ENUM('ACCEPT', 'REJECT') NOT NULL,
  rejection_reason_code VARCHAR(64) NULL COMMENT 'Required when decision=REJECT, e.g. CAPACITY_SHORTAGE, LOGISTICS_UNAVAILABLE, PRICING_UNVIABLE, OTHER',
  rejection_reason_notes VARCHAR(255) NULL COMMENT 'Sanitized explanation with bounded length',
  agreed_aggregate_qty DECIMAL(12,4) NOT NULL COMMENT 'Frozen agreed aggregate quantity matching snapshot',
  agreed_unit_price DECIMAL(12,2) NOT NULL COMMENT 'Frozen candidate tier unit price matching snapshot',
  originating_event_id VARCHAR(64) NULL COMMENT 'Outbox event ID emitted within the same transaction',
  idempotency_key VARCHAR(100) NULL COMMENT 'Scoped idempotency key used for the operation',
  decision_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_decisions_pool FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_decisions_snapshot FOREIGN KEY (snapshot_id) REFERENCES pool_commercial_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_decisions_supplier FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_decisions_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,

  -- Exactly one authoritative decision per qualification snapshot
  CONSTRAINT uq_supplier_decisions_snapshot UNIQUE (snapshot_id),
  INDEX idx_decisions_pool (pool_id),
  INDEX idx_decisions_supplier (supplier_id),
  INDEX idx_decisions_idempotency (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
