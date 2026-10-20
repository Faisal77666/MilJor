-- =============================================================================
-- Migration 010: Fail-Closed Active Reservation Uniqueness
-- =============================================================================
-- Project: MilJor B2B Collective Procurement Platform
-- Objective: Ensure reservation uniqueness over active lifecycle states is fail-closed
-- against future statuses (e.g., COMMITTED, PRICE_LOCKED, ORDER_PENDING) by generating
-- the unique key for any status NOT IN ('CANCELLED', 'EXPIRED').
-- =============================================================================

ALTER TABLE reservations
  MODIFY COLUMN active_pool_buyer_key VARCHAR(64) GENERATED ALWAYS AS (
    CASE WHEN status NOT IN ('CANCELLED', 'EXPIRED') THEN CONCAT(pool_id, '_', buyer_id) ELSE NULL END
  ) VIRTUAL;
