-- =============================================================================
-- Migration 018: Order Foundation, Decimal Precision & Commercial Linkage
-- Phase: MilJor Part 4E.1 (OBS-71, 72, 73, 74)
-- Purpose:
-- 1. Updates total_qty in orders table from INT to DECIMAL(12,4) to match
--    reservations.quantity and avoid truncation of fractional pack quantities.
-- 2. Links future orders to authoritative qualification snapshot (snapshot_id).
-- 3. Links future orders directly and immutably to the underlying accepted buyer
--    commercial decision (buyer_decision_id) with UNIQUE constraint to enforce
--    exactly-once order creation at the database engine level.
-- 4. Adds explicit currency column defaulting to 'PKR'.
-- 5. Adds index on (pool_id, order_status) for high-performance aggregate status queries.
-- =============================================================================

ALTER TABLE orders
  MODIFY COLUMN total_qty DECIMAL(12,4) NOT NULL,
  ADD COLUMN snapshot_id INT NULL AFTER pool_id,
  ADD COLUMN buyer_decision_id INT NULL AFTER snapshot_id,
  ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'PKR' AFTER total_amount,
  ADD CONSTRAINT fk_orders_snapshot FOREIGN KEY (snapshot_id) REFERENCES pool_commercial_snapshots(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orders_buyer_decision FOREIGN KEY (buyer_decision_id) REFERENCES pool_buyer_commercial_decisions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT uq_orders_buyer_decision UNIQUE (buyer_decision_id),
  ADD INDEX idx_orders_pool_status (pool_id, order_status);
