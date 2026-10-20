-- =============================================================================
-- Migration 003: Fix Seeded Password Hashes
-- Sets valid bcrypt hash for 'Password123' across development seed accounts
-- =============================================================================

UPDATE users
SET password_hash = '$2b$10$f/vhLemgJ1uojnBOy8ESxegz4A..5ApdA1XpDVm2b/lJkfU5ZUFvy'
WHERE id IN (1, 2, 3, 4, 5, 6, 7);
