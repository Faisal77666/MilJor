-- =============================================================================
-- Rollback Migration 009: One Active Reservation Per Buyer
-- =============================================================================

SET @idx_unique_active = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_unique_active_pool_buyer'
);
SET @sql_drop_unique = IF(@idx_unique_active > 0,
  'ALTER TABLE reservations DROP INDEX idx_unique_active_pool_buyer',
  'SELECT 1'
);
PREPARE stmt_drop_unique FROM @sql_drop_unique;
EXECUTE stmt_drop_unique;
DEALLOCATE PREPARE stmt_drop_unique;

SET @col_active_key = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'active_pool_buyer_key'
);
SET @sql_drop_col = IF(@col_active_key > 0,
  'ALTER TABLE reservations DROP COLUMN active_pool_buyer_key',
  'SELECT 1'
);
PREPARE stmt_drop_col FROM @sql_drop_col;
EXECUTE stmt_drop_col;
DEALLOCATE PREPARE stmt_drop_col;

-- Recreate legacy unique index if desired
SET @idx_old_unique = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_unique_buyer_pool'
);
SET @sql_add_old = IF(@idx_old_unique = 0,
  'ALTER TABLE reservations ADD UNIQUE INDEX idx_unique_buyer_pool (buyer_id, pool_id)',
  'SELECT 1'
);
PREPARE stmt_add_old FROM @sql_add_old;
EXECUTE stmt_add_old;
DEALLOCATE PREPARE stmt_add_old;

DELETE FROM schema_migrations WHERE version = '009';
