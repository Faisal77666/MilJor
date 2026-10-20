-- =============================================================================
-- Migration 021: Add User Verification OTP and Expiration
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verification_otp VARCHAR(10) NULL,
  ADD COLUMN IF NOT EXISTS otp_expires_at DATETIME NULL;
