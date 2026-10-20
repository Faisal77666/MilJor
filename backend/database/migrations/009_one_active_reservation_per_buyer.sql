-- =============================================================================
-- Migration 009: One Active Reservation Per Buyer Per Regular Pool
-- =============================================================================
-- Part 4B.4.1: Reservation Safety Hardening
-- Replaces unconditional uniqueness with conditional uniqueness:
-- A buyer may have only ONE active reservation ('RESERVED', 'CONFIRMED', 'PAID')
-- per pool, while preserving historical 'CANCELLED' and 'EXPIRED' reservations.
-- =============================================================================

-- 1. Drop unconditional legacy unique index if it exists
SET @idx_old_unique = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_unique_buyer_pool'
);
SET @sql_drop_old = IF(@idx_old_unique > 0,
  'ALTER TABLE reservations DROP INDEX idx_unique_buyer_pool',
  'SELECT 1'
);
PREPARE stmt_drop_old FROM @sql_drop_old;
EXECUTE stmt_drop_old;
DEALLOCATE PREPARE stmt_drop_old;

-- 2. Ensure standard non-unique composite index on (buyer_id, pool_id) for fast lookups
SET @idx_buyer_pool = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_reservations_buyer_pool'
);
SET @sql_idx_buyer_pool = IF(@idx_buyer_pool = 0,
  'CREATE INDEX idx_reservations_buyer_pool ON reservations (buyer_id, pool_id)',
  'SELECT 1'
);
PREPARE stmt_idx_buyer_pool FROM @sql_idx_buyer_pool;
EXECUTE stmt_idx_buyer_pool;
DEALLOCATE PREPARE stmt_idx_buyer_pool;

-- 3. Add virtual generated column active_pool_buyer_key:
-- Evaluates to CONCAT(pool_id, '_', buyer_id) ONLY for active statuses ('RESERVED', 'CONFIRMED', 'PAID').
-- Evaluates to NULL for inactive statuses ('CANCELLED', 'EXPIRED').
SET @col_active_key = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'active_pool_buyer_key'
);
SET @sql_col_active_key = IF(@col_active_key = 0,
  'ALTER TABLE reservations
     ADD COLUMN active_pool_buyer_key VARCHAR(64) GENERATED ALWAYS AS (
       CASE WHEN status IN (\'RESERVED\', \'CONFIRMED\', \'PAID\') THEN CONCAT(pool_id, \'_\', buyer_id) ELSE NULL END
     ) VIRTUAL',
  'SELECT 1'
);
PREPARE stmt_col_active_key FROM @sql_col_active_key;
EXECUTE stmt_col_active_key;
DEALLOCATE PREPARE stmt_col_active_key;

-- 4. Add unique index on active_pool_buyer_key
-- In InnoDB, multiple NULL values are allowed, preserving cancelled/expired records.
SET @idx_unique_active = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_unique_active_pool_buyer'
);
SET @sql_idx_unique_active = IF(@idx_unique_active = 0,
  'CREATE UNIQUE INDEX idx_unique_active_pool_buyer ON reservations (active_pool_buyer_key)',
  'SELECT 1'
);
PREPARE stmt_idx_unique_active FROM @sql_idx_unique_active;
EXECUTE stmt_idx_unique_active;
DEALLOCATE PREPARE stmt_idx_unique_active;
