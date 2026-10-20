// =============================================================================
// tests/testDbSafetyGuard.js
// MilJor Pre-4E.4 Reusable Fail-Closed Database Target Guard
// Enforces:
// 1. Destructive test suites can ONLY execute against 'miljor_test_db'.
// 2. Immediate termination if connected to 'miljor_db' (production/dev) or
//    'miljor_sandbox_db' (persistent sandbox E2E data).
// 3. Fails closed before any DELETE, TRUNCATE, or schema drop operation.
// =============================================================================

const assert = require('assert');

/**
 * Asserts that the currently connected database in the pool/connection
 * is strictly an allowed ephemeral test database ('miljor_test_db').
 * Throws a fatal safety error if pointing to protected databases.
 *
 * @param {Object} db - The mysql2 pool or connection instance
 * @param {string} [suiteName] - Calling test suite identifier
 * @returns {Promise<string>} The verified database name
 */
async function assertTestDatabaseSafety(db, suiteName = 'Unknown Suite') {
  const [rows] = await db.query('SELECT DATABASE() AS current_db');
  const currentDb = rows[0]?.current_db;

  const ALLOWED_TEST_DBS = ['miljor_test_db'];
  const FORBIDDEN_PROTECTED_DBS = ['miljor_db', 'miljor_sandbox_db'];

  if (!currentDb) {
    throw new Error(`[CRITICAL TEST SAFETY GUARD] ${suiteName}: No database currently selected. Refusing to run destructive operations.`);
  }

  if (FORBIDDEN_PROTECTED_DBS.includes(currentDb)) {
    const errorMsg = `[CRITICAL TEST SAFETY GUARD] ${suiteName} FATAL ATTEMPT to run against protected database '${currentDb}'. Refusing execution to prevent data corruption or loss.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  if (!ALLOWED_TEST_DBS.includes(currentDb)) {
    const errorMsg = `[CRITICAL TEST SAFETY GUARD] ${suiteName} Database '${currentDb}' is not in the allowed test database list [${ALLOWED_TEST_DBS.join(', ')}].`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  return currentDb;
}

module.exports = {
  assertTestDatabaseSafety
};
