-- =============================================================================
-- Migration 006: Regular Pool Foundation, Inventory Allocation & Integrity
-- =============================================================================
-- Safe, idempotent additive schema migration.
-- Preserves all historical pools, listings, specifications, and reservations.
-- =============================================================================

-- 1. Additive fields to `pools`
-- -----------------------------------------------------------------------------
-- max_capacity: Hard ceiling for total allocated pool volume.
-- pool_unit: Canonical calculation and pricing unit (e.g. 'pack', 'kg', 'bag', 'tin').
-- purchase_increment: Step size for indivisible packs (default 1.0000).
-- early_close_allowed: Whether pool may close when target_qty is met prior to expires_at.
-- supplier_listing_id: Linkage to underlying verified commercial listing.
-- supplier_confirmation_deadline: Configurable timestamp for supplier terms confirmation.
-- buyer_commitment_deadline: Configurable timestamp for buyer final price acceptance.

SET @col_max_cap = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'max_capacity'
);
SET @sql_max_cap = IF(@col_max_cap = 0,
  'ALTER TABLE pools ADD COLUMN max_capacity DECIMAL(12,4) NULL AFTER target_qty',
  'SELECT 1'
);
PREPARE stmt_max_cap FROM @sql_max_cap;
EXECUTE stmt_max_cap;
DEALLOCATE PREPARE stmt_max_cap;

SET @col_pool_unit = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'pool_unit'
);
SET @sql_pool_unit = IF(@col_pool_unit = 0,
  'ALTER TABLE pools ADD COLUMN pool_unit VARCHAR(30) NOT NULL DEFAULT \'pack\' AFTER buyer_min_qty, ADD COLUMN purchase_increment DECIMAL(10,4) NOT NULL DEFAULT 1.0000 AFTER pool_unit',
  'SELECT 1'
);
PREPARE stmt_pool_unit FROM @sql_pool_unit;
EXECUTE stmt_pool_unit;
DEALLOCATE PREPARE stmt_pool_unit;

SET @col_early_close = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'early_close_allowed'
);
SET @sql_early_close = IF(@col_early_close = 0,
  'ALTER TABLE pools ADD COLUMN early_close_allowed TINYINT(1) NOT NULL DEFAULT 1 AFTER expires_at',
  'SELECT 1'
);
PREPARE stmt_early_close FROM @sql_early_close;
EXECUTE stmt_early_close;
DEALLOCATE PREPARE stmt_early_close;

SET @col_supp_listing = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'supplier_listing_id'
);
SET @sql_supp_listing = IF(@col_supp_listing = 0,
  'ALTER TABLE pools ADD COLUMN supplier_listing_id INT NULL AFTER product_spec_id, ADD CONSTRAINT fk_pools_supplier_listing FOREIGN KEY (supplier_listing_id) REFERENCES supplier_listings(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_supp_listing FROM @sql_supp_listing;
EXECUTE stmt_supp_listing;
DEALLOCATE PREPARE stmt_supp_listing;

SET @col_deadlines = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'supplier_confirmation_deadline'
);
SET @sql_deadlines = IF(@col_deadlines = 0,
  'ALTER TABLE pools ADD COLUMN supplier_confirmation_deadline TIMESTAMP NULL AFTER confirmed_at, ADD COLUMN buyer_commitment_deadline TIMESTAMP NULL AFTER supplier_confirmation_deadline',
  'SELECT 1'
);
PREPARE stmt_deadlines FROM @sql_deadlines;
EXECUTE stmt_deadlines;
DEALLOCATE PREPARE stmt_deadlines;

-- 2. Modify pools quantity columns to DECIMAL(12,4) for commodity precision
-- -----------------------------------------------------------------------------
-- Allows exact fractional mass/volume quantities (e.g. 12.5000 kg) while preserving whole pack integers.
ALTER TABLE pools
  MODIFY COLUMN current_qty DECIMAL(12,4) NULL DEFAULT 0.0000,
  MODIFY COLUMN target_qty DECIMAL(12,4) NOT NULL,
  MODIFY COLUMN supplier_min_qty DECIMAL(12,4) NOT NULL,
  MODIFY COLUMN buyer_min_qty DECIMAL(12,4) NOT NULL;

-- 3. Update existing historical pools with consistent pool_unit
UPDATE pools SET pool_unit = 'bag' WHERE id = 1 AND pool_unit = 'pack';
UPDATE pools SET pool_unit = 'bag' WHERE id = 2 AND pool_unit = 'pack';

-- 4. Modify pool_price_tiers quantity columns to DECIMAL(12,4) & add pricing_unit
-- -----------------------------------------------------------------------------
ALTER TABLE pool_price_tiers
  MODIFY COLUMN min_qty DECIMAL(12,4) NOT NULL,
  MODIFY COLUMN max_qty DECIMAL(12,4) NOT NULL;

SET @col_tier_unit = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pool_price_tiers' AND COLUMN_NAME = 'pricing_unit'
);
SET @sql_tier_unit = IF(@col_tier_unit = 0,
  'ALTER TABLE pool_price_tiers ADD COLUMN pricing_unit VARCHAR(30) NOT NULL DEFAULT \'pack\' AFTER price_per_unit',
  'SELECT 1'
);
PREPARE stmt_tier_unit FROM @sql_tier_unit;
EXECUTE stmt_tier_unit;
DEALLOCATE PREPARE stmt_tier_unit;

UPDATE pool_price_tiers SET pricing_unit = 'bag' WHERE pool_id IN (1, 2) AND pricing_unit = 'pack';

-- 5. Modify reservations quantity columns to DECIMAL(12,4) & add payment_deadline_at
-- -----------------------------------------------------------------------------
ALTER TABLE reservations
  MODIFY COLUMN quantity DECIMAL(12,4) NOT NULL;

SET @col_pay_deadline = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'payment_deadline_at'
);
SET @sql_pay_deadline = IF(@col_pay_deadline = 0,
  'ALTER TABLE reservations ADD COLUMN payment_deadline_at TIMESTAMP NULL AFTER confirmed_at',
  'SELECT 1'
);
PREPARE stmt_pay_deadline FROM @sql_pay_deadline;
EXECUTE stmt_pay_deadline;
DEALLOCATE PREPARE stmt_pay_deadline;

-- 6. Minimal, safe inventory allocation ledger table
-- -----------------------------------------------------------------------------
-- Tracks soft allocations against supplier listings across pools, flash offers, and direct orders.
-- Distinguishes ON_HAND vs ALLOCATED vs RELEASED vs FULFILLED without mutating historical balance blindly.
CREATE TABLE IF NOT EXISTS supplier_inventory_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_listing_id INT NOT NULL,
  allocation_type ENUM('REGULAR_POOL', 'FLASH_POOL', 'ORDER_DIRECT', 'MANUAL_HOLD') NOT NULL,
  reference_id INT NOT NULL,
  allocated_qty DECIMAL(12,4) NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'pack',
  status ENUM('PENDING', 'COMMITTED', 'RELEASED', 'FULFILLED') NOT NULL DEFAULT 'PENDING',
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_listing_id) REFERENCES supplier_listings(id) ON DELETE CASCADE,
  INDEX idx_alloc_listing_status (supplier_listing_id, status),
  INDEX idx_alloc_ref (allocation_type, reference_id)
);

-- 7. Performance Indexes on pools and reservations
-- -----------------------------------------------------------------------------
SET @idx_pools_expires = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND INDEX_NAME = 'idx_pools_status_expires'
);
SET @sql_idx_pools = IF(@idx_pools_expires = 0,
  'CREATE INDEX idx_pools_status_expires ON pools(status, expires_at)',
  'SELECT 1'
);
PREPARE stmt_idx_pools FROM @sql_idx_pools;
EXECUTE stmt_idx_pools;
DEALLOCATE PREPARE stmt_idx_pools;

SET @idx_res_status = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_reservations_pool_status'
);
SET @sql_idx_res = IF(@idx_res_status = 0,
  'CREATE INDEX idx_reservations_pool_status ON reservations(pool_id, status)',
  'SELECT 1'
);
PREPARE stmt_idx_res FROM @sql_idx_res;
EXECUTE stmt_idx_res;
DEALLOCATE PREPARE stmt_idx_res;
