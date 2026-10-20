-- =============================================================================
-- database/migrations/015_pool_commercial_snapshots_outcome_uniqueness.sql
-- Migration 015: Enforce Global Qualification Outcome Uniqueness (OBS-64)
--
-- Ensures that for any pool, exactly ONE authoritative terminal qualification
-- outcome can exist across both qualified (PENDING_SUPPLIER_DECISION) and
-- unqualified (EXPIRED) decisions, preventing duplicate snapshots from retry/race.
-- =============================================================================

-- Add virtual column for authoritative qualification outcome
ALTER TABLE pool_commercial_snapshots
  ADD COLUMN authoritative_outcome_key VARCHAR(100) GENERATED ALWAYS AS (
    IF(status IN ('PENDING_SUPPLIER_DECISION', 'EXPIRED'), CONCAT(pool_id, ':QUALIFIED_OUTCOME'), NULL)
  ) VIRTUAL,
  ADD CONSTRAINT uq_snapshot_authoritative_outcome UNIQUE (authoritative_outcome_key);
