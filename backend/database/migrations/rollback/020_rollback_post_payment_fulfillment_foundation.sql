-- =============================================================================
-- Migration 020 Rollback: Post-Payment Fulfillment & Supplier-Managed Delivery Foundation
-- Phase: MilJor Part 4E.4
-- =============================================================================

DROP TABLE IF EXISTS order_fulfillment_events;

ALTER TABLE orders
  DROP INDEX idx_orders_supplier_fulfillment,
  DROP INDEX idx_orders_buyer_fulfillment,
  DROP COLUMN fulfillment_status,
  DROP COLUMN delivery_method,
  DROP COLUMN supplier_delivery_reference,
  DROP COLUMN delivery_evidence_notes,
  DROP COLUMN acknowledged_at,
  DROP COLUMN preparing_at,
  DROP COLUMN ready_for_dispatch_at,
  DROP COLUMN dispatched_at,
  DROP COLUMN supplier_delivered_at,
  DROP COLUMN buyer_confirmed_at,
  DROP COLUMN completed_at,
  DROP COLUMN exception_reason,
  DROP COLUMN exception_details,
  DROP COLUMN exception_recorded_at;
