-- =============================================================================
-- Migration Rollback 014: Rollback Pool Commercial Snapshots Invariants
-- =============================================================================

ALTER TABLE pool_commercial_snapshots
  DROP CONSTRAINT uq_snapshot_authoritative_decision,
  DROP COLUMN authoritative_decision_key,
  DROP CONSTRAINT uq_snapshot_pool_version;
