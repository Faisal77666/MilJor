process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { assertTestDatabaseSafety } = require('./testDbSafetyGuard');

async function runSafetyGuardTests() {
  console.log('================================================================================');
  console.log('🧪 VERIFYING FAIL-CLOSED TEST DATABASE TARGET SAFETY GUARD');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;

  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';

  // Test 1: Verification against allowed test database ('miljor_test_db') must PASS
  total++;
  const testConn = await mysql.createConnection({ host, user, password, database: 'miljor_test_db' });
  try {
    const verifiedDb = await assertTestDatabaseSafety(testConn, 'SafetyTest-AllowedDb');
    assert.strictEqual(verifiedDb, 'miljor_test_db');
    console.log(`  [PASS] Assertion ${total}: Allowed database 'miljor_test_db' passes target safety check.`);
    passed++;
  } finally {
    await testConn.end();
  }

  // Test 2: Pointing to protected 'miljor_db' must FAIL CLOSED before any query execution
  total++;
  const prodConn = await mysql.createConnection({ host, user, password, database: 'miljor_db' });
  try {
    let trappedError = null;
    try {
      await assertTestDatabaseSafety(prodConn, 'SafetyTest-ProtectedProd');
    } catch (err) {
      trappedError = err;
    }
    assert.ok(trappedError, 'Targeting miljor_db must throw a fatal safety error');
    assert.ok(trappedError.message.includes('FATAL ATTEMPT to run against protected database'), 'Error must identify protected database violation');
    console.log(`  [PASS] Assertion ${total}: Protected database 'miljor_db' fails closed with fatal safety exception.`);
    passed++;
  } finally {
    await prodConn.end();
  }

  // Test 3: Pointing to protected 'miljor_sandbox_db' must FAIL CLOSED before any query execution
  total++;
  const sandboxConn = await mysql.createConnection({ host, user, password, database: 'miljor_sandbox_db' });
  try {
    let trappedError = null;
    try {
      await assertTestDatabaseSafety(sandboxConn, 'SafetyTest-ProtectedSandbox');
    } catch (err) {
      trappedError = err;
    }
    assert.ok(trappedError, 'Targeting miljor_sandbox_db must throw a fatal safety error');
    assert.ok(trappedError.message.includes('FATAL ATTEMPT to run against protected database'), 'Error must identify protected database violation');
    console.log(`  [PASS] Assertion ${total}: Protected persistent database 'miljor_sandbox_db' fails closed with fatal safety exception.`);
    passed++;
  } finally {
    await sandboxConn.end();
  }

  // Test 4: Environment database resolution routing test
  total++;
  // Verify test routing:
  process.env.NODE_ENV = 'test';
  delete require.cache[require.resolve('../src/config/db')];
  const dbTest = require('../src/config/db');
  const [testRes] = await dbTest.query('SELECT DATABASE() AS db');
  assert.strictEqual(testRes[0].db, 'miljor_test_db', 'NODE_ENV=test must route to miljor_test_db');
  await dbTest.end();

  // Verify sandbox routing:
  process.env.NODE_ENV = 'sandbox';
  delete require.cache[require.resolve('../src/config/db')];
  const dbSandbox = require('../src/config/db');
  const [sandboxRes] = await dbSandbox.query('SELECT DATABASE() AS db');
  assert.strictEqual(sandboxRes[0].db, 'miljor_sandbox_db', 'NODE_ENV=sandbox must route to miljor_sandbox_db');
  await dbSandbox.end();

  // Verify default production routing:
  process.env.NODE_ENV = 'production';
  delete require.cache[require.resolve('../src/config/db')];
  const dbProd = require('../src/config/db');
  const [prodRes] = await dbProd.query('SELECT DATABASE() AS db');
  assert.strictEqual(prodRes[0].db, 'miljor_db', 'NODE_ENV=production must route to miljor_db');
  await dbProd.end();

  console.log(`  [PASS] Assertion ${total}: Environment routing strictly differentiates test, sandbox, and production databases.`);
  passed++;

  console.log('\n================================================================================');
  console.log(`Safety Guard Verification: ${passed} / ${total} assertions passed`);
  console.log('Status: PASS');
  console.log('================================================================================\n');

  process.exit(passed === total ? 0 : 1);
}

runSafetyGuardTests().catch(err => {
  console.error('Fatal safety test error:', err);
  process.exit(1);
});
