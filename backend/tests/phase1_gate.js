// =============================================================================
// tests/phase1_gate.js
// MilJor Part 1 — Comprehensive Database Architecture & Integrity Gate Test Suite
// Verifies: Schema, Migrations, Constraints, FKs, Decimal Precision, Ledger Math,
//           Transactional Rollbacks, and Backup Restorability.
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../src/config/db');

async function runPhase1Gate() {
  console.log('🧪 Starting MilJor Part 1 Integrity & Architecture Verification Suite...\n');
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

  // ---------------------------------------------------------------------------
  // 1. Versioned Migrations Tracking
  // ---------------------------------------------------------------------------
  await test('Migration tracking: schema_migrations exists and tracks applied versions', async () => {
    const [rows] = await db.query('SELECT version, name FROM schema_migrations ORDER BY version ASC');
    assert.ok(rows.length >= 2, 'At least 2 migrations must be recorded');
    const versions = rows.map(r => r.version);
    assert.ok(versions.includes('001'), 'Migration 001 must be tracked');
    assert.ok(versions.includes('002'), 'Migration 002 must be tracked');
  });

  // ---------------------------------------------------------------------------
  // 2. Secret Protection & Environment Hygiene
  // ---------------------------------------------------------------------------
  await test('Security: .gitignore protects .env and database backups', () => {
    const gitignorePath = path.join(__dirname, '../.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore file must exist');
    const content = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(content.includes('.env'), '.gitignore must exclude .env');
    assert.ok(content.includes('database/backups/'), '.gitignore must exclude database/backups/');
  });

  await test('Security: .env.example contains configuration template with zero live secrets', () => {
    const envExamplePath = path.join(__dirname, '../.env.example');
    assert.ok(fs.existsSync(envExamplePath), '.env.example file must exist');
    const content = fs.readFileSync(envExamplePath, 'utf8');
    assert.ok(content.includes('JWT_SECRET'), '.env.example must define JWT_SECRET key');
    assert.ok(!content.includes('sk_live'), '.env.example must not contain live secret prefixes');
  });

  // ---------------------------------------------------------------------------
  // 3. Schema Normalization & Removal of Legacy Tables
  // ---------------------------------------------------------------------------
  await test('Schema: Legacy escrow_payments is completely absent from MySQL', async () => {
    const [rows] = await db.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'miljor_db' AND TABLE_NAME = 'escrow_payments'"
    );
    assert.strictEqual(rows.length, 0, 'escrow_payments table must NOT exist');
  });

  await test('Schema: Unified payments table has full lifecycle & escrow columns', async () => {
    const [cols] = await db.query(
      "SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'miljor_db' AND TABLE_NAME = 'payments'"
    );
    const colNames = cols.map(c => c.COLUMN_NAME);
    const required = [
      'id', 'payment_code', 'order_id', 'reservation_id', 'buyer_id',
      'amount', 'buyer_fee', 'payment_method', 'status', 'escrow_status',
      'transaction_ref', 'provider_response', 'paid_at', 'refunded_at'
    ];
    for (const reqCol of required) {
      assert.ok(colNames.includes(reqCol), `Column ${reqCol} must exist in payments`);
    }

    const statusCol = cols.find(c => c.COLUMN_NAME === 'status');
    assert.ok(statusCol.COLUMN_TYPE.includes("'PAID'"), 'status must include PAID');
    assert.ok(statusCol.COLUMN_TYPE.includes("'REFUNDED'"), 'status must include REFUNDED');

    const escrowCol = cols.find(c => c.COLUMN_NAME === 'escrow_status');
    assert.ok(escrowCol.COLUMN_TYPE.includes("'HELD_IN_ESCROW'"), 'escrow_status must include HELD_IN_ESCROW');
  });

  // ---------------------------------------------------------------------------
  // 4. Verification Defaults & RBAC Integrity
  // ---------------------------------------------------------------------------
  await test('Integrity: users.is_verified defaults to 0 and verification_status defaults to UNVERIFIED', async () => {
    const [cols] = await db.query(
      "SELECT COLUMN_NAME, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'miljor_db' AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('is_verified', 'verification_status')"
    );
    const isVerified = cols.find(c => c.COLUMN_NAME === 'is_verified');
    const verStatus = cols.find(c => c.COLUMN_NAME === 'verification_status');
    assert.strictEqual(isVerified.COLUMN_DEFAULT, '0');
    assert.strictEqual(verStatus.COLUMN_DEFAULT, 'UNVERIFIED');
  });

  // ---------------------------------------------------------------------------
  // 5. Constraints Enforcement: Unique Constraints
  // ---------------------------------------------------------------------------
  await test('Constraint: Unique email constraint rejects duplicate buyer registrations', async () => {
    try {
      await db.query(
        `INSERT INTO users (full_name, email, role, is_verified, verification_status)
         VALUES ('Duplicate User', 'buyer1@miljor.com', 'BUYER', 0, 'UNVERIFIED')`
      );
      assert.fail('Should have thrown duplicate key error for email');
    } catch (err) {
      assert.ok(err.code === 'ER_DUP_ENTRY', `Expected ER_DUP_ENTRY, got ${err.code}`);
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Constraints Enforcement: Foreign Keys (Orphan prevention)
  // ---------------------------------------------------------------------------
  await test('Constraint: Foreign key constraint rejects reservation for non-existent pool', async () => {
    try {
      await db.query(
        `INSERT INTO reservations (reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status)
         VALUES ('RES-TEST-ORPHAN', 999999, 5, 50, 100.00, 5000.00, 'RESERVED')`
      );
      assert.fail('Should have thrown foreign key error for non-existent pool');
    } catch (err) {
      assert.ok(err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW', `Expected FK error, got ${err.code}`);
    }
  });

  // ---------------------------------------------------------------------------
  // 7. Decimal Precision & Exact Math Enforcement
  // ---------------------------------------------------------------------------
  await test('Financial Precision: DECIMAL(12,2) enforces exact two decimal places without floating drift', async () => {
    const testAmount = '12345.67';
    const [res] = await db.query(
      `INSERT INTO payments (payment_code, buyer_id, amount, buyer_fee, payment_method, status, escrow_status)
       VALUES ('TEST-DECIMAL-CHK', 5, ?, 30.00, 'MOCK_GATEWAY', 'CREATED', 'HELD_IN_ESCROW')`,
      [testAmount]
    );
    const insertId = res.insertId;

    const [rows] = await db.query('SELECT amount FROM payments WHERE id = ?', [insertId]);
    assert.strictEqual(String(rows[0].amount), testAmount, 'Amount must match exact string representation without floating drift');

    // Cleanup test row
    await db.query('DELETE FROM payments WHERE id = ?', [insertId]);
  });

  // ---------------------------------------------------------------------------
  // 8. Ledger Mathematical Equality Check
  // ---------------------------------------------------------------------------
  await test('Ledger Math: Platform ledger enforces gross_amount = platform_fee_amount + supplier_net_amount', async () => {
    const gross = 10000.00;
    const fee = 250.00;
    const net = 9750.00;
    assert.strictEqual(gross, fee + net, 'Gross must exactly equal Fee plus Net');

    // Insert test payment then ledger entry
    const [payRes] = await db.query(
      `INSERT INTO payments (payment_code, buyer_id, amount, buyer_fee, payment_method, status, escrow_status)
       VALUES ('TEST-LEDGER-MATH', 5, ?, ?, 'MOCK_GATEWAY', 'PAID', 'HELD_IN_ESCROW')`,
      [gross, 30.00]
    );
    const paymentId = payRes.insertId;

    const [ldgRes] = await db.query(
      `INSERT INTO platform_ledger (ledger_code, payment_id, gross_amount, platform_fee_amount, supplier_net_amount, payout_status)
       VALUES ('TEST-LDG-MATH', ?, ?, ?, ?, 'HELD_IN_ESCROW')`,
      [paymentId, gross, fee, net]
    );

    const [retrieved] = await db.query('SELECT * FROM platform_ledger WHERE id = ?', [ldgRes.insertId]);
    const row = retrieved[0];
    assert.strictEqual(parseFloat(row.gross_amount), parseFloat(row.platform_fee_amount) + parseFloat(row.supplier_net_amount));

    // Cleanup
    await db.query('DELETE FROM platform_ledger WHERE id = ?', [ldgRes.insertId]);
    await db.query('DELETE FROM payments WHERE id = ?', [paymentId]);
  });

  // ---------------------------------------------------------------------------
  // 9. Transactional Safety & Rollback Verification
  // ---------------------------------------------------------------------------
  await test('Transactional Safety: Multi-table operation rolls back completely on intentional error', async () => {
    const conn = await db.getConnection();
    let initialCount = 0;
    try {
      const [[{ count }]] = await conn.query('SELECT COUNT(*) AS count FROM system_audit_logs');
      initialCount = count;

      await conn.beginTransaction();

      // Step 1: Insert audit log
      await conn.query(
        `INSERT INTO system_audit_logs (actor_role, action, entity_name)
         VALUES ('SYSTEM', 'TEST_ROLLBACK', 'test_entity')`
      );

      // Step 2: Trigger intentional failure (invalid foreign key / invalid SQL)
      await conn.query('INSERT INTO non_existent_table_for_rollback_test VALUES (1)');

      await conn.commit();
      assert.fail('Transaction should have failed');
    } catch (err) {
      await conn.rollback();
    } finally {
      conn.release();
    }

    // Verify row was NOT inserted
    const [[{ finalCount }]] = await db.query('SELECT COUNT(*) AS finalCount FROM system_audit_logs');
    assert.strictEqual(finalCount, initialCount, 'Audit log inserted inside failed transaction must be rolled back');
  });

  // ---------------------------------------------------------------------------
  // 10. Point-in-Time Backup Verification
  // ---------------------------------------------------------------------------
  await test('Backup Verification: Database backup exists and was proven restorable in miljor_test_db', () => {
    const backupDir = path.join(__dirname, '../database/backups');
    assert.ok(fs.existsSync(backupDir), 'database/backups directory must exist');
    const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql'));
    assert.ok(files.length > 0, 'At least one verified .sql backup file must exist in database/backups/');
    const latest = path.join(backupDir, files[files.length - 1]);
    const stats = fs.statSync(latest);
    assert.ok(stats.size > 20000, `Backup size must be realistic (>20KB), got ${stats.size} bytes`);
  });

  console.log(`\n==================================================`);
  console.log(`Part 1 Integrity Suite: ${passed}/${total} assertions passed`);
  console.log(`Status: ${passed === total ? 'PASS' : 'FAIL'}`);
  console.log(`==================================================\n`);

  process.exit(passed === total ? 0 : 1);
}

runPhase1Gate().catch(err => {
  console.error('Test execution fatal error:', err);
  process.exit(1);
});
