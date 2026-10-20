-- =============================================================================
-- Migration 007: Regular Pool Commercial Terms, Delivery & Idempotency Hardening
-- =============================================================================
-- Safe, idempotent additive schema migration.
-- Preserves all historical pools, listings, specifications, and reservations.
-- =============================================================================

-- 1. Additive commercial & delivery fields to `pools`
-- -----------------------------------------------------------------------------
-- delivery_type: Doorstep, cluster pickup, or supplier warehouse pickup
-- delivery_zones: JSON array of eligible zones
-- delivery_fee_policy: Included, flat, or tiered
-- fulfilment_lead_time_days: Lead time after pool confirmation
-- cancellation_cutoff_hours: Hours before expiry/close buyer may cancel

SET @col_del_type = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'delivery_type'
);
SET @sql_del_type = IF(@col_del_type = 0,
  'ALTER TABLE pools ADD COLUMN delivery_type ENUM(\'DOORSTEP\', \'GROUPED_CLUSTER\', \'SUPPLIER_PICKUP\') NOT NULL DEFAULT \'DOORSTEP\' AFTER early_close_allowed,
                     ADD COLUMN delivery_zones JSON NULL AFTER delivery_type,
                     ADD COLUMN delivery_fee_policy VARCHAR(100) NOT NULL DEFAULT \'INCLUDED_IN_PRICE\' AFTER delivery_zones,
                     ADD COLUMN fulfilment_lead_time_days INT NOT NULL DEFAULT 2 AFTER delivery_fee_policy,
                     ADD COLUMN cancellation_cutoff_hours INT NOT NULL DEFAULT 0 AFTER fulfilment_lead_time_days',
  'SELECT 1'
);
PREPARE stmt_del_type FROM @sql_del_type;
EXECUTE stmt_del_type;
DEALLOCATE PREPARE stmt_del_type;

-- 2. Add request_hash to `idempotency_records` for payload conflict detection
-- -----------------------------------------------------------------------------
SET @col_req_hash = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idempotency_records' AND COLUMN_NAME = 'request_hash'
);
SET @sql_req_hash = IF(@col_req_hash = 0,
  'ALTER TABLE idempotency_records ADD COLUMN request_hash VARCHAR(64) NULL AFTER request_path',
  'SELECT 1'
);
PREPARE stmt_req_hash FROM @sql_req_hash;
EXECUTE stmt_req_hash;
DEALLOCATE PREPARE stmt_req_hash;
