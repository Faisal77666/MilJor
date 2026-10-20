-- =============================================================================
-- Migration 018 Rollback: Order Foundation, Decimal Precision & Commercial Linkage
-- Phase: MilJor Part 4E.1
-- =============================================================================

ALTER TABLE orders
  DROP FOREIGN KEY fk_orders_snapshot,
  DROP FOREIGN KEY fk_orders_buyer_decision,
  DROP INDEX uq_orders_buyer_decision,
  DROP INDEX idx_orders_pool_status,
  DROP COLUMN buyer_decision_id,
  DROP COLUMN snapshot_id,
  DROP COLUMN currency,
  MODIFY COLUMN total_qty INT NOT NULL;
