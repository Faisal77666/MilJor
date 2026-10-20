-- =============================================================================
-- database/migrations/rollback/011_rollback_reservation_mutation_history.sql
-- MilJor Part 4C.1 Rollback: Drops reservation_mutation_history table
-- =============================================================================

DROP TABLE IF EXISTS reservation_mutation_history;
