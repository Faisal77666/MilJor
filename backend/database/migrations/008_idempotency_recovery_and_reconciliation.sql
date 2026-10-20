-- =============================================================================
-- Migration 008: Idempotency Recovery State, Resource Linkage & Heartbeats
-- =============================================================================
-- Safe, additive schema migration for robust crash recovery and reconciliation.
-- Preserves all historical pools, listings, specifications, and reservations.
-- =============================================================================

-- 1. Add status, resource_type, resource_id, and last_heartbeat_at to idempotency_records
-- -----------------------------------------------------------------------------
-- status: 'PENDING', 'COMPLETED', 'FAILED', 'UNKNOWN'
-- resource_type: 'pools', 'supplier_inventory_allocations', 'reservations', etc.
-- resource_id: Primary key of the created/modified business entity
-- last_heartbeat_at: Heartbeat to differentiate genuinely active requests from crashed workers

SET @col_status = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idempotency_records' AND COLUMN_NAME = 'status'
);
SET @sql_status = IF(@col_status = 0,
  'ALTER TABLE idempotency_records
     ADD COLUMN status ENUM(\'PENDING\', \'COMPLETED\', \'FAILED\', \'UNKNOWN\') NOT NULL DEFAULT \'PENDING\' AFTER request_hash,
     ADD COLUMN resource_type VARCHAR(50) NULL AFTER status,
     ADD COLUMN resource_id INT NULL AFTER resource_type,
     ADD COLUMN last_heartbeat_at TIMESTAMP NULL DEFAULT NULL AFTER response_body',
  'SELECT 1'
);
PREPARE stmt_status FROM @sql_status;
EXECUTE stmt_status;
DEALLOCATE PREPARE stmt_status;

-- 2. Backfill existing records: if response_status > 0 then status = 'COMPLETED'
UPDATE idempotency_records
SET status = 'COMPLETED'
WHERE response_status > 0 AND status = 'PENDING';

-- 3. Add composite index for actor + request_path + key scoping
SET @idx_actor = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idempotency_records' AND INDEX_NAME = 'idx_idempotency_actor_key'
);
SET @sql_idx_actor = IF(@idx_actor = 0,
  'CREATE INDEX idx_idempotency_actor_key ON idempotency_records (user_id, request_path, idempotency_key)',
  'SELECT 1'
);
PREPARE stmt_idx_actor FROM @sql_idx_actor;
EXECUTE stmt_idx_actor;
DEALLOCATE PREPARE stmt_idx_actor;
