-- =============================================================================
-- Rollback Migration 012: Drop Durable Reservation Business Events Outbox
-- =============================================================================

DROP TABLE IF EXISTS reservation_business_events;
