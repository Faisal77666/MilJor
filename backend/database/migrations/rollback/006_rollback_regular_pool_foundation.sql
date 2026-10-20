-- =============================================================================
-- Migration 006 Rollback Script: Regular Pool Foundation & Inventory Allocation
-- =============================================================================

-- 1. Drop supplier_inventory_allocations table
DROP TABLE IF EXISTS supplier_inventory_allocations;

-- 2. Drop added indexes
ALTER TABLE pools DROP INDEX idx_pools_status_expires;
ALTER TABLE reservations DROP INDEX idx_reservations_pool_status;

-- 3. Drop added columns and FK from pools
ALTER TABLE pools DROP FOREIGN KEY fk_pools_supplier_listing;
ALTER TABLE pools DROP COLUMN supplier_listing_id;
ALTER TABLE pools DROP COLUMN buyer_commitment_deadline;
ALTER TABLE pools DROP COLUMN supplier_confirmation_deadline;
ALTER TABLE pools DROP COLUMN early_close_allowed;
ALTER TABLE pools DROP COLUMN purchase_increment;
ALTER TABLE pools DROP COLUMN pool_unit;
ALTER TABLE pools DROP COLUMN max_capacity;

-- 4. Revert pools quantity columns to INT
ALTER TABLE pools
  MODIFY COLUMN current_qty INT NULL DEFAULT 0,
  MODIFY COLUMN target_qty INT NOT NULL,
  MODIFY COLUMN supplier_min_qty INT NOT NULL,
  MODIFY COLUMN buyer_min_qty INT NOT NULL;

-- 5. Drop pricing_unit from pool_price_tiers and revert to INT
ALTER TABLE pool_price_tiers DROP COLUMN pricing_unit;
ALTER TABLE pool_price_tiers
  MODIFY COLUMN min_qty INT NOT NULL,
  MODIFY COLUMN max_qty INT NOT NULL;

-- 6. Drop payment_deadline_at from reservations and revert quantity to INT
ALTER TABLE reservations DROP COLUMN payment_deadline_at;
ALTER TABLE reservations
  MODIFY COLUMN quantity INT NOT NULL;

-- 7. Remove migration record from schema_migrations
DELETE FROM schema_migrations WHERE version = '006';
