-- =============================================================================
-- database/migrations/rollback/015_rollback_pool_commercial_snapshots_outcome_uniqueness.sql
-- Rollback for Migration 015
-- =============================================================================

ALTER TABLE pool_commercial_snapshots
  DROP INDEX uq_snapshot_authoritative_outcome,
  DROP COLUMN authoritative_outcome_key;
