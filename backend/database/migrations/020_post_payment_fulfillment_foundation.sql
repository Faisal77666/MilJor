-- =============================================================================
-- Migration 020: Post-Payment Fulfillment & Supplier-Managed Delivery Foundation
-- Phase: MilJor Part 4E.4
-- Purpose:
-- 1. Add fulfillment_status to orders table to track granular fulfillment milestones:
--    UNPAID -> AWAITING_SUPPLIER_ACKNOWLEDGEMENT -> PREPARING -> READY_FOR_DISPATCH ->
--    DISPATCHED -> SUPPLIER_DELIVERED -> BUYER_CONFIRMED -> COMPLETED (or EXCEPTION).
-- 2. Add delivery and tracking metadata columns on orders:
--    delivery_method, supplier_delivery_reference, delivery_evidence_notes.
-- 3. Add milestone timestamps on orders for high-performance indexing and fast lookup:
--    acknowledged_at, preparing_at, ready_for_dispatch_at, dispatched_at,
--    supplier_delivered_at, buyer_confirmed_at, completed_at.
-- 4. Add exception tracking columns on orders:
--    exception_reason, exception_details, exception_recorded_at.
-- 5. Add order_fulfillment_events table for immutable milestone tracking and audit trails.
-- 6. Add indexes on (supplier_id, fulfillment_status) and (buyer_id, fulfillment_status).
-- =============================================================================

ALTER TABLE orders
  ADD COLUMN fulfillment_status ENUM(
    'UNPAID',
    'AWAITING_SUPPLIER_ACKNOWLEDGEMENT',
    'PREPARING',
    'READY_FOR_DISPATCH',
    'DISPATCHED',
    'SUPPLIER_DELIVERED',
    'BUYER_CONFIRMED',
    'COMPLETED',
    'EXCEPTION'
  ) NOT NULL DEFAULT 'UNPAID' AFTER order_status,
  ADD COLUMN delivery_method VARCHAR(64) NULL AFTER delivery_type,
  ADD COLUMN supplier_delivery_reference VARCHAR(100) NULL AFTER delivery_method,
  ADD COLUMN delivery_evidence_notes TEXT NULL AFTER supplier_delivery_reference,
  ADD COLUMN acknowledged_at TIMESTAMP NULL AFTER delivery_evidence_notes,
  ADD COLUMN preparing_at TIMESTAMP NULL AFTER acknowledged_at,
  ADD COLUMN ready_for_dispatch_at TIMESTAMP NULL AFTER preparing_at,
  ADD COLUMN dispatched_at TIMESTAMP NULL AFTER ready_for_dispatch_at,
  ADD COLUMN supplier_delivered_at TIMESTAMP NULL AFTER dispatched_at,
  ADD COLUMN buyer_confirmed_at TIMESTAMP NULL AFTER supplier_delivered_at,
  ADD COLUMN completed_at TIMESTAMP NULL AFTER buyer_confirmed_at,
  ADD COLUMN exception_reason VARCHAR(64) NULL AFTER completed_at,
  ADD COLUMN exception_details TEXT NULL AFTER exception_reason,
  ADD COLUMN exception_recorded_at TIMESTAMP NULL AFTER exception_details,
  ADD INDEX idx_orders_supplier_fulfillment (supplier_id, fulfillment_status),
  ADD INDEX idx_orders_buyer_fulfillment (buyer_id, fulfillment_status);

CREATE TABLE IF NOT EXISTS order_fulfillment_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  event_code VARCHAR(64) UNIQUE NOT NULL COMMENT 'Unique deterministic event code, e.g. FE-ORD-123-...',
  from_status VARCHAR(64) NOT NULL,
  to_status VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_id INT NOT NULL,
  actor_role ENUM('SUPPLIER', 'BUYER', 'ADMIN', 'SYSTEM') NOT NULL,
  notes TEXT NULL,
  metadata JSON NULL,
  idempotency_key VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_fulfillment_events_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fulfillment_events_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_fulfillment_events_order_time (order_id, created_at),
  INDEX idx_fulfillment_events_idempotency (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill any existing PAID orders
UPDATE orders 
SET fulfillment_status = 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT' 
WHERE payment_status = 'PAID' AND fulfillment_status = 'UNPAID';
