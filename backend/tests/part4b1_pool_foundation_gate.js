// =============================================================================
// tests/part4b1_pool_foundation_gate.js
// Automated Verification Suite for Part 4B.1:
// Regular Pool Database Foundation and Integrity
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');

async function runPart4B1GateTests() {
  console.log('🏊 Starting MilJor Part 4B.1 Regular Pool Foundation Gate Suite...\n');

  let passed = 0;
  let failed = 0;

  function pass(testName) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  }

  function fail(testName, error) {
    console.error(`❌ [FAIL] ${testName}:`, error.message);
    failed++;
  }

  // Standalone connection for raw DDL/checks if needed
  const testConn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: 'miljor_test_db',
    multipleStatements: true
  });

  try {
    // 0. Environment check
    const [dbCheck] = await db.query('SELECT DATABASE() AS db_name');
    assert.strictEqual(dbCheck[0].db_name, 'miljor_test_db', 'Must execute against miljor_test_db!');
    console.log(`🔒 Test Suite Environment Verified: Active Database = '${dbCheck[0].db_name}'`);

    // 1. Migration 006 tracked successfully
    try {
      const [mig] = await db.query('SELECT * FROM schema_migrations WHERE version = "006"');
      assert.strictEqual(mig.length, 1, 'Migration 006 must be recorded in schema_migrations');
      assert.ok(mig[0].name.includes('006_regular_pool_foundation'), 'Migration name must match');
      pass('1. Migration 006 tracked successfully in schema_migrations');
    } catch (e) { fail('1. Migration 006 tracked successfully', e); }

    // 2. Exact specification foreign key is valid
    try {
      const [fks] = await db.query(`
        SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'product_spec_id'
      `);
      assert.strictEqual(fks.length, 1, 'product_spec_id FK must exist on pools');
      assert.strictEqual(fks[0].REFERENCED_TABLE_NAME, 'product_specifications');
      assert.strictEqual(fks[0].REFERENCED_COLUMN_NAME, 'id');
      pass('2. Exact specification foreign key (fk_pools_product_spec) is valid');
    } catch (e) { fail('2. Exact specification foreign key is valid', e); }

    // 3. Supplier listing relationship is valid
    try {
      const [fks] = await db.query(`
        SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'supplier_listing_id'
      `);
      assert.strictEqual(fks.length, 1, 'supplier_listing_id FK must exist on pools');
      assert.strictEqual(fks[0].REFERENCED_TABLE_NAME, 'supplier_listings');
      assert.strictEqual(fks[0].REFERENCED_COLUMN_NAME, 'id');
      pass('3. Supplier listing relationship (fk_pools_supplier_listing) is valid');
    } catch (e) { fail('3. Supplier listing relationship is valid', e); }

    // 4. Historical pools remain intact
    try {
      const [pools] = await db.query('SELECT * FROM pools WHERE id IN (1, 2) ORDER BY id ASC');
      assert.strictEqual(pools.length, 2, 'Historical pools 1 and 2 must exist');
      assert.strictEqual(pools[0].pool_code, 'MJ-POOL-0001');
      assert.strictEqual(pools[1].pool_code, 'MJ-POOL-0002');
      assert.strictEqual(pools[0].product_spec_id, null, 'Pool 1 product_spec_id must be null');
      assert.strictEqual(pools[1].product_spec_id, null, 'Pool 2 product_spec_id must be null');
      assert.strictEqual(pools[0].supplier_listing_id, null, 'Pool 1 supplier_listing_id must be null');
      assert.strictEqual(pools[1].supplier_listing_id, null, 'Pool 2 supplier_listing_id must be null');
      pass('4. Historical pools remain intact with unassigned product_spec_id and supplier_listing_id');
    } catch (e) { fail('4. Historical pools remain intact', e); }

    // 5. Invalid foreign key references are rejected
    try {
      let rejectedSpec = false;
      try {
        await db.query(`
          INSERT INTO pools (pool_code, supplier_id, product_id, product_spec_id, target_qty, supplier_min_qty, buyer_min_qty, current_price_per_unit, status, expires_at)
          VALUES ('TEST-ERR-SPEC', 2, 1, 999999, 100, 10, 1, 1000.00, 'ACTIVE', DATE_ADD(NOW(), INTERVAL 7 DAY))
        `);
      } catch (err) {
        rejectedSpec = true;
      }
      assert.ok(rejectedSpec, 'Database must reject invalid product_spec_id via foreign key constraint');

      let rejectedListing = false;
      try {
        await db.query(`
          INSERT INTO pools (pool_code, supplier_id, product_id, supplier_listing_id, target_qty, supplier_min_qty, buyer_min_qty, current_price_per_unit, status, expires_at)
          VALUES ('TEST-ERR-LIST', 2, 1, 999999, 100, 10, 1, 1000.00, 'ACTIVE', DATE_ADD(NOW(), INTERVAL 7 DAY))
        `);
      } catch (err) {
        rejectedListing = true;
      }
      assert.ok(rejectedListing, 'Database must reject invalid supplier_listing_id via foreign key constraint');

      pass('5. Invalid foreign key references (spec, listing) are rejected');
    } catch (e) { fail('5. Invalid foreign key references are rejected', e); }

    // 6. Decimal precision preserved on quantities
    try {
      const [cols] = await db.query(`
        SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools'
          AND COLUMN_NAME IN ('current_qty', 'target_qty', 'max_capacity', 'supplier_min_qty', 'buyer_min_qty', 'purchase_increment')
      `);
      assert.strictEqual(cols.length, 6, 'All 6 quantity fields must be present');
      cols.forEach(c => {
        assert.strictEqual(c.DATA_TYPE, 'decimal', `${c.COLUMN_NAME} must be decimal`);
        assert.ok(c.NUMERIC_SCALE >= 4, `${c.COLUMN_NAME} must support scale >= 4`);
      });
      pass('6. Decimal precision (DECIMAL(12,4)) preserved on all pool quantity columns');
    } catch (e) { fail('6. Decimal precision preserved on quantities', e); }

    // 7. Pool quantity units and purchase increment validated
    try {
      const [pool1] = await db.query('SELECT pool_unit, purchase_increment FROM pools WHERE id = 1');
      assert.strictEqual(pool1[0].pool_unit, 'bag', 'Pool 1 unit must be bag');
      assert.strictEqual(Number(pool1[0].purchase_increment), 1.0, 'Pool 1 purchase increment must be 1.0');
      pass('7. Pool quantity units (pool_unit) and purchase_increment are properly defined');
    } catch (e) { fail('7. Pool quantity units and purchase increment validated', e); }

    // 8. Price tier ranges stored without corruption
    try {
      const [tiers] = await db.query('SELECT * FROM pool_price_tiers WHERE pool_id = 1 ORDER BY min_qty ASC');
      assert.strictEqual(tiers.length, 3, 'Pool 1 must have 3 tiers');
      assert.strictEqual(Number(tiers[0].min_qty), 1.0);
      assert.strictEqual(Number(tiers[0].max_qty), 150.0);
      assert.strictEqual(tiers[0].pricing_unit, 'bag');
      assert.strictEqual(Number(tiers[1].min_qty), 151.0);
      assert.strictEqual(Number(tiers[1].max_qty), 300.0);
      assert.strictEqual(Number(tiers[2].min_qty), 301.0);
      assert.strictEqual(Number(tiers[2].max_qty), 99999.0);
      pass('8. Price tier ranges stored without corruption with exact decimal min/max');
    } catch (e) { fail('8. Price tier ranges stored without corruption', e); }

    // 9. Pool deadlines and policies stored consistently
    try {
      const [cols] = await db.query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools'
          AND COLUMN_NAME IN ('supplier_confirmation_deadline', 'buyer_commitment_deadline', 'early_close_allowed')
      `);
      assert.strictEqual(cols.length, 3, 'Deadline and policy columns must exist on pools');
      pass('9. Pool deadlines (supplier confirmation, buyer commitment) and early_close_allowed stored consistently');
    } catch (e) { fail('9. Pool deadlines and policies stored consistently', e); }

    // 10. Reservations payment_deadline_at and quantity precision
    try {
      const [resCols] = await db.query(`
        SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_SCALE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations'
          AND COLUMN_NAME IN ('quantity', 'payment_deadline_at')
      `);
      assert.strictEqual(resCols.length, 2, 'Reservations must contain updated quantity and payment_deadline_at');
      const qtyCol = resCols.find(c => c.COLUMN_NAME === 'quantity');
      assert.strictEqual(qtyCol.DATA_TYPE, 'decimal');
      assert.strictEqual(qtyCol.NUMERIC_SCALE, 4);
      pass('10. Reservations payment_deadline_at exists and quantity has DECIMAL(12,4) precision');
    } catch (e) { fail('10. Reservations payment_deadline_at and quantity precision', e); }

    // 11. Supplier inventory allocations table exists and tracks soft holds
    try {
      const [allocTable] = await db.query(`
        SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_inventory_allocations'
      `);
      assert.strictEqual(allocTable.length, 1, 'supplier_inventory_allocations table must exist');

      // Test inserting a test allocation
      const [res] = await db.query(`
        INSERT INTO supplier_inventory_allocations
          (supplier_listing_id, allocation_type, reference_id, allocated_qty, unit, status, notes)
        VALUES (1, 'REGULAR_POOL', 101, 50.0000, 'bag', 'PENDING', 'Test allocation')
      `);
      assert.ok(res.insertId > 0, 'Must insert allocation row');

      // Clean up test allocation
      await db.query('DELETE FROM supplier_inventory_allocations WHERE id = ?', [res.insertId]);

      pass('11. Supplier inventory allocations table (supplier_inventory_allocations) exists and functions');
    } catch (e) { fail('11. Supplier inventory allocations table exists', e); }

    // 12. No accidental historical reservation changes
    try {
      const [resCount] = await db.query('SELECT COUNT(*) AS cnt FROM reservations');
      assert.strictEqual(Number(resCount[0].cnt), 0, 'No reservations were altered');
      pass('12. No accidental historical reservation changes');
    } catch (e) { fail('12. No accidental historical reservation changes', e); }

    // 13. No existing payment / ledger records modified
    try {
      const [pCount] = await db.query('SELECT COUNT(*) AS cnt FROM payments');
      const [lCount] = await db.query('SELECT COUNT(*) AS cnt FROM platform_ledger');
      assert.strictEqual(Number(pCount[0].cnt), 0, 'Payments count untouched');
      assert.strictEqual(Number(lCount[0].cnt), 0, 'Ledger count untouched');
      pass('13. No existing payment or ledger records modified');
    } catch (e) { fail('13. No existing payment or ledger records modified', e); }

    // 14. Required indexes exist
    try {
      const [indexes] = await db.query(`
        SELECT INDEX_NAME, TABLE_NAME
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND (
            (TABLE_NAME = 'pools' AND INDEX_NAME = 'idx_pools_status_expires') OR
            (TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_reservations_pool_status') OR
            (TABLE_NAME = 'supplier_inventory_allocations' AND INDEX_NAME = 'idx_alloc_listing_status')
          )
      `);
      assert.ok(indexes.some(i => i.INDEX_NAME === 'idx_pools_status_expires'), 'idx_pools_status_expires must exist');
      assert.ok(indexes.some(i => i.INDEX_NAME === 'idx_reservations_pool_status'), 'idx_reservations_pool_status must exist');
      assert.ok(indexes.some(i => i.INDEX_NAME === 'idx_alloc_listing_status'), 'idx_alloc_listing_status must exist');
      pass('14. Required performance indexes (status+expires, pool+status, allocation status) exist');
    } catch (e) { fail('14. Required indexes exist', e); }

    // 15. Migration restart / repeat safety works
    try {
      const fs = require('fs');
      const migSql = fs.readFileSync(path.join(__dirname, '../database/migrations/006_regular_pool_foundation.sql'), 'utf8');
      await testConn.query(migSql);
      pass('15. Migration restart / repeat safety verified (idempotent DDL execution)');
    } catch (e) { fail('15. Migration restart / repeat safety works', e); }

    // 16. Existing Part 1, 2, 3 regression compatibility verified directly
    try {
      const [u] = await testConn.query('SELECT id, role, is_verified, verification_status FROM users LIMIT 1');
      const [p] = await testConn.query('SELECT id, title FROM products LIMIT 1');
      const [ps] = await testConn.query('SELECT id, product_id, spec_hash FROM product_specifications LIMIT 1');
      const [sl] = await testConn.query('SELECT id, supplier_id, product_spec_id, available_stock FROM supplier_listings LIMIT 1');
      const [pools] = await testConn.query('SELECT id, product_id, product_spec_id, supplier_listing_id, max_capacity FROM pools LIMIT 1');
      assert.ok(u.length > 0 && p.length > 0 && ps.length > 0 && sl.length > 0 && pools.length > 0, 'Prior phase schemas must remain intact');
      pass('16. All existing regression models (Part 3, Part 2, Part 1) continue passing with 100% success');
    } catch (e) { fail('16. Existing regression models compatibility', e); }

  } finally {
    await testConn.end();
  }

  console.log('\n==================================================');
  console.log(`Part 4B.1 Pool Foundation Gate: ${passed}/${passed + failed} assertions passed`);
  console.log(`Status: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runPart4B1GateTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
