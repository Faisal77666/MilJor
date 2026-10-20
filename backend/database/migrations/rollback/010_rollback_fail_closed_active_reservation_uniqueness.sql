-- =============================================================================
-- Rollback Migration 010: Fail-Closed Active Reservation Uniqueness
-- =============================================================================
-- Revert to explicit list of active statuses from Migration 009.
-- =============================================================================

ALTER TABLE reservations
  MODIFY COLUMN active_pool_buyer_key VARCHAR(64) GENERATED ALWAYS AS (
    CASE WHEN status IN ('RESERVED', 'CONFIRMED', 'PAID') THEN CONCAT(pool_id, '_', buyer_id) ELSE NULL END
  ) VIRTUAL;

DELETE FROM schema_migrations WHERE version = '010';
