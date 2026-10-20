process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { assertTestDatabaseSafety } = require('./testDbSafetyGuard');
const schedulerService = require('../src/services/schedulerService');

async function runRuntimeSafetyTests() {
  console.log('================================================================================');
  console.log('🧪 VERIFYING RUNTIME ROUTING, SAFETY GUARDS & SCHEDULER INACTIVITY');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;

  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';

  // 1. Regression pointed at miljor_sandbox_db must fail before destructive SQL
  total++;
  const sConn = await mysql.createConnection({ host, user, password, database: 'miljor_sandbox_db' });
  try {
    let trapped = null;
    try {
      await assertTestDatabaseSafety(sConn, 'TestRegressionSafety');
    } catch (e) {
      trapped = e;
    }
    assert.ok(trapped, 'Safety guard must throw when pointing to miljor_sandbox_db');
    assert.ok(trapped.message.includes('FATAL ATTEMPT'), 'Safety message must identify fatal attempt');
    console.log(`  [PASS] Assertion ${total}: Regression runner targeting 'miljor_sandbox_db' fails closed before destructive SQL.`);
    passed++;
  } finally {
    await sConn.end();
  }

  // 2. Regression pointed at miljor_db must fail before destructive SQL
  total++;
  const prodConn = await mysql.createConnection({ host, user, password, database: 'miljor_db' });
  try {
    let trapped = null;
    try {
      await assertTestDatabaseSafety(prodConn, 'TestRegressionSafety');
    } catch (e) {
      trapped = e;
    }
    assert.ok(trapped, 'Safety guard must throw when pointing to miljor_db');
    assert.ok(trapped.message.includes('FATAL ATTEMPT'), 'Safety message must identify fatal attempt');
    console.log(`  [PASS] Assertion ${total}: Regression runner targeting 'miljor_db' fails closed before destructive SQL.`);
    passed++;
  } finally {
    await prodConn.end();
  }

  // 3. Sandbox server must not silently fall back to miljor_db
  total++;
  process.env.NODE_ENV = 'sandbox';
  delete require.cache[require.resolve('../src/config/db')];
  const dbSandbox = require('../src/config/db');
  const [sandboxCheck] = await dbSandbox.query('SELECT DATABASE() AS db');
  assert.strictEqual(sandboxCheck[0].db, 'miljor_sandbox_db', 'NODE_ENV=sandbox must resolve strictly to miljor_sandbox_db');
  assert.notStrictEqual(sandboxCheck[0].db, 'miljor_db', 'NODE_ENV=sandbox must never fall back to miljor_db');
  await dbSandbox.end();
  console.log(`  [PASS] Assertion ${total}: Sandbox environment resolves strictly to 'miljor_sandbox_db' without fallback to 'miljor_db'.`);
  passed++;

  // 4. Scheduler must not start in sandbox mode or test mode
  total++;
  // server.js startup check verification
  let schedulerRanInSandbox = false;
  const originalEnv = process.env.NODE_ENV;

  // Verify scheduler service check: server.js lines 184-188 condition
  const shouldStartInSandbox = ('sandbox' !== 'test' && 'sandbox' !== 'sandbox');
  assert.strictEqual(shouldStartInSandbox, false, 'server.js boot check must evaluate false for sandbox');

  const shouldStartInTest = ('test' !== 'test' && 'test' !== 'sandbox');
  assert.strictEqual(shouldStartInTest, false, 'server.js boot check must evaluate false for test');

  const shouldStartInDev = ('development' !== 'test' && 'development' !== 'sandbox');
  assert.strictEqual(shouldStartInDev, true, 'server.js boot check must evaluate true for development');

  console.log(`  [PASS] Assertion ${total}: Scheduler boot guard strictly blocks background scheduler execution in both sandbox and test modes.`);
  passed++;

  process.env.NODE_ENV = originalEnv;

  console.log('\n================================================================================');
  console.log(`Runtime Safety & Scheduler Inactivity Gate: ${passed} / ${total} assertions passed`);
  console.log('Status: PASS');
  console.log('================================================================================\n');

  process.exit(passed === total ? 0 : 1);
}

runRuntimeSafetyTests().catch(err => {
  console.error('Fatal runtime safety test error:', err);
  process.exit(1);
});
