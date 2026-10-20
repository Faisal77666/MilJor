-- =============================================================================
-- Migration Rollback: 019_rollback_safepay_sandbox_payment_attempts.sql
-- =============================================================================

DROP TABLE IF EXISTS payment_webhook_events;
DROP TABLE IF EXISTS payment_attempts;
