-- =============================================================================
-- Migration 014: Pool Commercial Snapshots Invariants & Decision Uniqueness
-- =============================================================================
-- Project: MilJor B2B Collective Procurement Platform
-- Phase: Part 4D.2 — Production-Grade Pool Qualification & Atomic Closure Decision
-- Objective: Enforce database-level exactly-once business outcome for qualification
-- transitions and immutable snapshot versioning:
-- 1. Unique constraint: (pool_id, snapshot_version) prevents duplicate snapshot versions.
-- 2. Scoped unique constraint: Ensures only one active authoritative qualification
--    snapshot exists per pool lifecycle instance in PENDING_SUPPLIER_DECISION.
-- =============================================================================

-- Add unique constraint on (pool_id, snapshot_version) if not already present
ALTER TABLE pool_commercial_snapshots
  ADD CONSTRAINT uq_snapshot_pool_version UNIQUE (pool_id, snapshot_version);

-- Add authoritative_decision_key virtual column to strictly enforce at the database
-- level that only ONE qualification snapshot can exist in PENDING_SUPPLIER_DECISION per pool
ALTER TABLE pool_commercial_snapshots
  ADD COLUMN authoritative_decision_key VARCHAR(64) GENERATED ALWAYS AS (
    IF(status = 'PENDING_SUPPLIER_DECISION', CONCAT(pool_id, ':PENDING'), NULL)
  ) VIRTUAL,
  ADD CONSTRAINT uq_snapshot_authoritative_decision UNIQUE (authoritative_decision_key);
