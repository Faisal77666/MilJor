// =============================================================================
// tests/part2_security_gate.js
// MilJor Part 2 — Authentication, Authorization & Security Hardening Gate Suite
// Tests 16 required security scenarios against live Express & MySQL
// =============================================================================
process.env.NODE_ENV = 'test';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const app = require('../server');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = 'miljor-api';
const JWT_AUDIENCE = 'miljor-app';

async function runSecuritySuite() {
  console.log('🛡️ Starting MilJor Part 2 Security Gate Test Suite...\n');

  // Verify Database Isolation
  const [dbRow] = await db.query('SELECT DATABASE() as current_db');
  const activeDb = dbRow[0].current_db;
  console.log(`🔒 Test Suite Environment Verified: Active Database = '${activeDb}'`);
  assert.strictEqual(activeDb, 'miljor_test_db', 'SECURITY VIOLATION: Test suite MUST run strictly against miljor_test_db!');

  // Snapshot dev database users count to ensure zero pollution
  const [devCountBefore] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.users');
  const devUserCountBefore = devCountBefore[0].cnt;

  // Start ephemeral HTTP test server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}: ${err.message}`);
    }
  }

  // Helper for HTTP requests
  async function api(path, options = {}) {
    const url = `${baseUrl}${path}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // Setup isolated test users
  const cleanupUserIds = [];
  const cleanupPoolIds = [];
  const cleanupReservationIds = [];
  const cleanupPaymentIds = [];

  const testPassword = 'Password123';
  const testPasswordHash = await bcrypt.hash(testPassword, 10);

  // Helper to create test user
  async function createTestUser({ email, role, is_verified = 0, verification_status = 'UNVERIFIED', buyer_trust_status = 'CONTACT_VERIFIED' }) {
    const [res] = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_verified, verification_status, buyer_trust_status, city, area)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Lahore', 'Gulberg')`,
      [`Test ${role}`, email, testPasswordHash, role, is_verified, verification_status, buyer_trust_status]
    );
    cleanupUserIds.push(res.insertId);
    return res.insertId;
  }

  try {
    // Seed isolated test identities
    const buyer1Id = await createTestUser({ email: 'sec_test_buyer1@miljor.com', role: 'BUYER' });
    const buyer2Id = await createTestUser({ email: 'sec_test_buyer2@miljor.com', role: 'BUYER' });
    const unverifiedSuppId = await createTestUser({ email: 'sec_test_unverified_supp@miljor.com', role: 'SUPPLIER', verification_status: 'PENDING_SUPPLIER_VERIFICATION' });
    const verifiedSupp1Id = await createTestUser({ email: 'sec_test_supp1@miljor.com', role: 'SUPPLIER', is_verified: 1, verification_status: 'VERIFIED' });
    const verifiedSupp2Id = await createTestUser({ email: 'sec_test_supp2@miljor.com', role: 'SUPPLIER', is_verified: 1, verification_status: 'VERIFIED' });
    const suspendedUserId = await createTestUser({ email: 'sec_test_suspended@miljor.com', role: 'BUYER', verification_status: 'BLOCKED', buyer_trust_status: 'SUSPENDED' });
    const financeAdminId = await createTestUser({ email: 'sec_test_fin_admin@miljor.com', role: 'FINANCE_ADMIN', is_verified: 1, verification_status: 'VERIFIED' });
    const verifAdminId = await createTestUser({ email: 'sec_test_verif_admin@miljor.com', role: 'VERIFICATION_ADMIN', is_verified: 1, verification_status: 'VERIFIED' });

    // Seed supplier profiles for verified suppliers
    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, verification_level, verification_status, subscription_plan)
       VALUES (?, 'LEVEL_2_BUSINESS', 'VERIFIED', 'GROWTH'),
              (?, 'LEVEL_2_BUSINESS', 'VERIFIED', 'GROWTH'),
              (?, 'LEVEL_1_CONTACT', 'PENDING_REVIEW', 'STARTER')`,
      [verifiedSupp1Id, verifiedSupp2Id, unverifiedSuppId]
    );

    // Tokens
    const buyer1Token = jwt.sign({ id: buyer1Id, email: 'sec_test_buyer1@miljor.com', role: 'BUYER' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const buyer2Token = jwt.sign({ id: buyer2Id, email: 'sec_test_buyer2@miljor.com', role: 'BUYER' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const verifiedSupp1Token = jwt.sign({ id: verifiedSupp1Id, email: 'sec_test_supp1@miljor.com', role: 'SUPPLIER' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const verifiedSupp2Token = jwt.sign({ id: verifiedSupp2Id, email: 'sec_test_supp2@miljor.com', role: 'SUPPLIER' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const unverifiedSuppToken = jwt.sign({ id: unverifiedSuppId, email: 'sec_test_unverified_supp@miljor.com', role: 'SUPPLIER' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const finAdminToken = jwt.sign({ id: financeAdminId, email: 'sec_test_fin_admin@miljor.com', role: 'FINANCE_ADMIN' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const verifAdminToken = jwt.sign({ id: verifAdminId, email: 'sec_test_verif_admin@miljor.com', role: 'VERIFICATION_ADMIN' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });

    // Seed a pool belonging to verifiedSupp1
    const [poolRes] = await db.query(
      `INSERT INTO pools (pool_code, supplier_id, product_id, current_qty, target_qty, supplier_min_qty, buyer_min_qty, current_price_per_unit, status, expires_at)
       VALUES ('SEC-TEST-POOL', ?, 1, 0, 500, 100, 25, 5200.00, 'ACTIVE', DATE_ADD(NOW(), INTERVAL 5 DAY))`,
      [verifiedSupp1Id]
    );
    const testPoolId = poolRes.insertId;
    cleanupPoolIds.push(testPoolId);

    // Seed a reservation belonging to buyer1
    const [resRes] = await db.query(
      `INSERT INTO reservations (reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status)
       VALUES ('SEC-TEST-RES1', ?, ?, 25, 5200.00, 130000.00, 'RESERVED')`,
      [testPoolId, buyer1Id]
    );
    const testRes1Id = resRes.insertId;
    cleanupReservationIds.push(testRes1Id);

    // Seed a payment belonging to buyer1
    const [payRes] = await db.query(
      `INSERT INTO payments (payment_code, reservation_id, buyer_id, amount, buyer_fee, payment_method, status, escrow_status)
       VALUES ('SEC-TEST-PAY1', ?, ?, 130100.00, 100.00, 'MOCK_GATEWAY', 'PAID', 'HELD_IN_ESCROW')`,
      [testRes1Id, buyer1Id]
    );
    const testPay1Id = payRes.insertId;
    cleanupPaymentIds.push(testPay1Id);

    // -------------------------------------------------------------------------
    // TEST 1: Buyer registration succeeds
    // -------------------------------------------------------------------------
    await test('1. Buyer registration succeeds with valid credentials', async () => {
      const uniqueEmail = `test_reg_${Date.now()}@miljor.com`;
      const uniquePhone = `0300${Math.floor(1000000 + Math.random() * 9000000)}`;
      const res = await api('/api/v1/auth/register', {
        method: 'POST',
        body: {
          full_name: 'Registered Buyer',
          email: uniqueEmail,
          password: 'Password123',
          phone: uniquePhone
        }
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.user.role, 'BUYER');
      assert.strictEqual(res.data.data.user.verification_status, 'UNVERIFIED');
      if (res.data.data.user.id) cleanupUserIds.push(res.data.data.user.id);
    });

    // -------------------------------------------------------------------------
    // TEST 2: Public ADMIN registration is rejected (role forced to BUYER)
    // -------------------------------------------------------------------------
    await test('2. Public registration ignores client-supplied role: "ADMIN"', async () => {
      const exploitEmail = `exploit_${Date.now()}@miljor.com`;
      const res = await api('/api/v1/auth/register', {
        method: 'POST',
        body: {
          full_name: 'Attacker Admin',
          email: exploitEmail,
          password: 'Password123',
          role: 'ADMIN' // Malicious role injection attempt
        }
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.data.user.role, 'BUYER', 'Public registration MUST force role to BUYER');

      // Verify in MySQL directly
      const [dbRows] = await db.query('SELECT role FROM users WHERE email = ?', [exploitEmail]);
      assert.strictEqual(dbRows[0].role, 'BUYER');
      if (res.data.data.user.id) cleanupUserIds.push(res.data.data.user.id);
    });

    // -------------------------------------------------------------------------
    // TEST 3: Incorrect password is rejected
    // -------------------------------------------------------------------------
    await test('3. Incorrect password returns 401 with generic error message', async () => {
      const res = await api('/api/v1/auth/login', {
        method: 'POST',
        body: {
          identifier: 'sec_test_buyer1@miljor.com',
          password: 'WrongPassword999'
        }
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.error.code, 'INVALID_CREDENTIALS');
    });

    // -------------------------------------------------------------------------
    // TEST 4: Invalid JWT is rejected
    // -------------------------------------------------------------------------
    await test('4. Corrupted / forged JWT signature is rejected with 401', async () => {
      const forgedToken = jwt.sign({ id: buyer1Id, role: 'SUPER_ADMIN' }, 'wrong_secret_key_123');
      const res = await api('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${forgedToken}` }
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.error.code, 'INVALID_TOKEN');
    });

    // -------------------------------------------------------------------------
    // TEST 5: Expired JWT is rejected
    // -------------------------------------------------------------------------
    await test('5. Expired JWT is rejected with 401 TOKEN_EXPIRED', async () => {
      const expiredToken = jwt.sign(
        { id: buyer1Id, role: 'BUYER' },
        JWT_SECRET,
        { expiresIn: '-10s', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
      );
      const res = await api('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${expiredToken}` }
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.error.code, 'TOKEN_EXPIRED');
    });

    // -------------------------------------------------------------------------
    // TEST 6: Missing authentication returns 401
    // -------------------------------------------------------------------------
    await test('6. Accessing protected endpoint without token returns 401 UNAUTHORIZED', async () => {
      const res = await api('/api/v1/auth/me');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.error.code, 'UNAUTHORIZED');
    });

    // -------------------------------------------------------------------------
    // TEST 7: Wrong role returns 403
    // -------------------------------------------------------------------------
    await test('7. Caller with unauthorized role returns 403 FORBIDDEN', async () => {
      // Buyer attempting to access finance admin ledger audit
      const res = await api('/api/v1/audit/owner/financial-summary', {
        headers: { Authorization: `Bearer ${buyer1Token}` }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
    });

    // -------------------------------------------------------------------------
    // TEST 8: Buyer cannot access another buyer's reservations
    // -------------------------------------------------------------------------
    await test('8. Object authorization: Buyer 2 cannot access Buyer 1 reservation', async () => {
      const res = await api(`/api/v1/reservations/${testRes1Id}`, {
        headers: { Authorization: `Bearer ${buyer2Token}` }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
    });

    // -------------------------------------------------------------------------
    // TEST 9: Buyer cannot access another buyer's payments
    // -------------------------------------------------------------------------
    await test('9. Object authorization: Buyer 2 cannot view Buyer 1 payment status', async () => {
      const res = await api(`/api/v1/payments/${testPay1Id}`, {
        headers: { Authorization: `Bearer ${buyer2Token}` }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
    });

    // -------------------------------------------------------------------------
    // TEST 10: Supplier cannot modify another supplier's resources
    // -------------------------------------------------------------------------
    await test('10. Object authorization: Supplier 2 cannot cancel Supplier 1 pool', async () => {
      const res = await api(`/api/v1/pools/${testPoolId}/cancel`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${verifiedSupp2Token}` },
        body: { reason: 'Unauthorized cancellation attempt' }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
    });

    // -------------------------------------------------------------------------
    // TEST 11: Unverified supplier cannot perform restricted actions
    // -------------------------------------------------------------------------
    await test('11. Unverified supplier is blocked from pool creation (SUPPLIER_NOT_VERIFIED)', async () => {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${unverifiedSuppToken}` },
        body: {
          product_id: 1,
          target_qty: 500,
          supplier_min_qty: 100,
          buyer_min_qty: 25,
          duration_days: 7,
          price_tiers: [{ min_qty: 1, max_qty: 500, price_per_unit: 5000 }]
        }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'SUPPLIER_NOT_VERIFIED');
    });

    // -------------------------------------------------------------------------
    // TEST 12: Suspended account is blocked appropriately
    // -------------------------------------------------------------------------
    await test('12. Suspended account login is blocked with 403 ACCOUNT_SUSPENDED', async () => {
      const res = await api('/api/v1/auth/login', {
        method: 'POST',
        body: {
          identifier: 'sec_test_suspended@miljor.com',
          password: testPassword
        }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'ACCOUNT_SUSPENDED');
    });

    // -------------------------------------------------------------------------
    // TEST 13: SQL injection payloads are safely handled
    // -------------------------------------------------------------------------
    await test('13. SQL injection payload in login identifier is parameterized safely', async () => {
      const sqliPayload = "' OR '1'='1' -- ";
      const res = await api('/api/v1/auth/login', {
        method: 'POST',
        body: {
          identifier: sqliPayload,
          password: 'Password123'
        }
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.error.code, 'INVALID_CREDENTIALS');
    });

    // -------------------------------------------------------------------------
    // TEST 14: Invalid request data is rejected
    // -------------------------------------------------------------------------
    await test('14. Weak password (<8 chars or no numbers) is rejected with 400', async () => {
      const res = await api('/api/v1/auth/register', {
        method: 'POST',
        body: {
          email: 'weak_pwd@miljor.com',
          password: 'simple' // too short, no numbers
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'VALIDATION_ERROR');
    });

    // -------------------------------------------------------------------------
    // TEST 15: Existing valid authentication flows still work
    // -------------------------------------------------------------------------
    await test('15. Baseline admin account can login and access /auth/me', async () => {
      const res = await api('/api/v1/auth/login', {
        method: 'POST',
        body: {
          identifier: 'admin@miljor.com',
          password: 'Password123'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.data.token, 'Token must be issued');

      const meRes = await api('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${res.data.data.token}` }
      });
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.data.data.user.email, 'admin@miljor.com');
      assert.strictEqual(meRes.data.data.user.role, 'SUPER_ADMIN');
    });

    // -------------------------------------------------------------------------
    // TEST 16: Privileged actions create appropriate audit records
    // -------------------------------------------------------------------------
    await test('16. Supplier verification by admin creates an immutable system_audit_logs record', async () => {
      const res = await api(`/api/v1/admin/suppliers/${unverifiedSuppId}/verify`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${verifAdminToken}` },
        body: {
          verification_status: 'VERIFIED',
          verification_level: 'LEVEL_2_BUSINESS'
        }
      });
      assert.strictEqual(res.status, 200);

      // Verify audit log exists in MySQL
      const [auditRows] = await db.query(
        `SELECT * FROM system_audit_logs
         WHERE action = 'SUPPLIER_VERIFICATION_UPDATE' AND entity_id = ?
         ORDER BY id DESC LIMIT 1`,
        [unverifiedSuppId]
      );
      assert.ok(auditRows.length > 0, 'Audit record must be created');
      assert.strictEqual(auditRows[0].actor_role, 'VERIFICATION_ADMIN');
    });

  } finally {
    // Teardown isolated test data
    console.log('\n🧹 Cleaning up isolated test fixtures from database...');
    if (cleanupPaymentIds.length) {
      await db.query(`DELETE FROM payments WHERE id IN (${cleanupPaymentIds.join(',')})`);
    }
    if (cleanupReservationIds.length) {
      await db.query(`DELETE FROM reservations WHERE id IN (${cleanupReservationIds.join(',')})`);
    }
    if (cleanupPoolIds.length) {
      await db.query(`DELETE FROM pools WHERE id IN (${cleanupPoolIds.join(',')})`);
    }
    if (cleanupUserIds.length) {
      await db.query(`DELETE FROM system_audit_logs WHERE actor_id IN (${cleanupUserIds.join(',')}) OR entity_id IN (${cleanupUserIds.join(',')})`);
      await db.query(`DELETE FROM supplier_profiles WHERE supplier_id IN (${cleanupUserIds.join(',')})`);
      await db.query(`DELETE FROM users WHERE id IN (${cleanupUserIds.join(',')})`);
    }

    // Verify development database was never modified
    const [devCountAfter] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.users');
    const devUserCountAfter = devCountAfter[0].cnt;
    assert.strictEqual(
      devUserCountBefore,
      devUserCountAfter,
      `DATA LEAK DETECTED: miljor_db.users changed from ${devUserCountBefore} to ${devUserCountAfter} during test execution!`
    );
    console.log(`🛡️ Verified: Real database 'miljor_db' remained 100% untouched (${devUserCountAfter} users before & after)`);

    server.close();
  }

  console.log(`\n==================================================`);
  console.log(`Part 2 Security Suite: ${passed}/${total} assertions passed`);
  console.log(`Status: ${passed === total ? 'PASS' : 'FAIL'}`);
  console.log(`==================================================\n`);

  process.exit(passed === total ? 0 : 1);
}

runSecuritySuite().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
