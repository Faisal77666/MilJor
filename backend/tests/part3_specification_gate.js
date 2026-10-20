// =============================================================================
// tests/part3_specification_gate.js
// MilJor Part 3 — Product Specification & Supplier Listing Engine Gate Suite
// Tests 15 required specification, listing, and isolation scenarios
// =============================================================================
process.env.NODE_ENV = 'test';
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const app = require('../server');
const unitService = require('../src/services/unitConversionService');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_jwt_super_secret_for_local_testing_min_32_bytes_long';
const JWT_ISSUER = 'miljor-api';
const JWT_AUDIENCE = 'miljor-app';

async function runPart3Gate() {
  console.log('🌾 Starting MilJor Part 3 Specification & Listing Gate Suite...\n');

  // 1. Verify Database Isolation
  const [dbRow] = await db.query('SELECT DATABASE() as current_db');
  const activeDb = dbRow[0].current_db;
  console.log(`🔒 Test Suite Environment Verified: Active Database = '${activeDb}'`);
  assert.strictEqual(activeDb, 'miljor_test_db', 'SECURITY VIOLATION: Test suite MUST run strictly against miljor_test_db!');

  // Snapshot development database state before tests
  const [devUsersBefore] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.users');
  const [devProductsBefore] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.products');
  const [devPoolsBefore] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pools');
  const devSnapshot = {
    users: devUsersBefore[0].cnt,
    products: devProductsBefore[0].cnt,
    pools: devPoolsBefore[0].cnt
  };

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

  // Tracking arrays for clean teardown
  const cleanupListingIds = [];
  const cleanupSpecIds = [];
  const cleanupUserIds = [];

  const testPassword = 'Password123';
  const testPasswordHash = await bcrypt.hash(testPassword, 10);

  async function createTestUser({ email, role, is_verified = 1, verification_status = 'VERIFIED' }) {
    const [res] = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_verified, verification_status, city, area)
       VALUES (?, ?, ?, ?, ?, ?, 'Lahore', 'Gulberg')`,
      [`Test ${role}`, email, testPasswordHash, role, is_verified, verification_status]
    );
    cleanupUserIds.push(res.insertId);
    return res.insertId;
  }

  try {
    // Seed isolated test users
    const adminId = await createTestUser({ email: 'p3_admin@miljor.com', role: 'SUPER_ADMIN' });
    const verifiedSupp1Id = await createTestUser({ email: 'p3_supp1@miljor.com', role: 'SUPPLIER', is_verified: 1, verification_status: 'VERIFIED' });
    const verifiedSupp2Id = await createTestUser({ email: 'p3_supp2@miljor.com', role: 'SUPPLIER', is_verified: 1, verification_status: 'VERIFIED' });
    const verifiedSupp3Id = await createTestUser({ email: 'p3_supp3@miljor.com', role: 'SUPPLIER', is_verified: 1, verification_status: 'VERIFIED' });
    const unverifiedSuppId = await createTestUser({ email: 'p3_unverified_supp@miljor.com', role: 'SUPPLIER', is_verified: 0, verification_status: 'PENDING_SUPPLIER_VERIFICATION' });
    const buyerId = await createTestUser({ email: 'p3_buyer@miljor.com', role: 'BUYER' });

    // Seed supplier profiles
    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, verification_level, verification_status, subscription_plan)
       VALUES (?, 'LEVEL_2_BUSINESS', 'VERIFIED', 'GROWTH'),
              (?, 'LEVEL_2_BUSINESS', 'VERIFIED', 'GROWTH'),
              (?, 'LEVEL_2_BUSINESS', 'VERIFIED', 'GROWTH'),
              (?, 'LEVEL_1_CONTACT', 'PENDING_REVIEW', 'STARTER')`,
      [verifiedSupp1Id, verifiedSupp2Id, verifiedSupp3Id, unverifiedSuppId]
    );

    // Auth tokens
    const adminToken = jwt.sign({ id: adminId, email: 'p3_admin@miljor.com', role: 'SUPER_ADMIN' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const supp1Token = jwt.sign({ id: verifiedSupp1Id, email: 'p3_supp1@miljor.com', role: 'SUPPLIER' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const supp2Token = jwt.sign({ id: verifiedSupp2Id, email: 'p3_supp2@miljor.com', role: 'SUPPLIER' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const unverifiedSuppToken = jwt.sign({ id: unverifiedSuppId, email: 'p3_unverified_supp@miljor.com', role: 'SUPPLIER' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const buyerToken = jwt.sign({ id: buyerId, email: 'p3_buyer@miljor.com', role: 'BUYER' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE });

    let createdSpecId = null;
    let createdListing1Id = null;
    let createdListing2Id = null;

    // ---------------------------------------------------------------------------
    // 1. Exact specification creation
    // ---------------------------------------------------------------------------
    await test('1. Exact specification creation succeeds with normalized attributes', async () => {
      const res = await api('/api/v1/specifications', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          product_id: 1, // Basmati Rice
          brand: 'Al-Madina Rice',
          variety: 'Super Kernel Basmati',
          crop_year: 'Old Crop 2025',
          processing_method: 'Sella (Parboiled)',
          quality_grade: 'Export Grade A',
          packaging_type: 'PP Bag',
          pack_size: 25.0,
          pack_unit: 'kg',
          purchasing_unit: 'bag',
          storage_requirements: 'Dry warehouse',
          shelf_life_days: 730,
          spec_attributes: { moisture_percent: 11.2, broken_percent: 1.0 }
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.data.specification.id);
      assert.ok(res.data.data.specification.spec_code.startsWith('SPEC-'));
      assert.ok(res.data.data.specification.spec_hash);

      createdSpecId = res.data.data.specification.id;
      cleanupSpecIds.push(createdSpecId);
    });

    // ---------------------------------------------------------------------------
    // 2. Duplicate specification handling
    // ---------------------------------------------------------------------------
    await test('2. Duplicate specification creation is rejected with 409 Conflict', async () => {
      const res = await api('/api/v1/specifications', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          product_id: 1,
          brand: '  Al-Madina Rice  ', // Whitespace padding to test normalization
          variety: 'Super Kernel Basmati', // Same variety
          crop_year: 'Old Crop 2025', // Same crop
          processing_method: 'Sella (Parboiled)', // Same processing
          quality_grade: 'Export Grade A', // Same grade
          packaging_type: 'PP Bag', // Same packaging
          pack_size: 25.0, // Same pack size
          pack_unit: 'kg', // Same unit
          purchasing_unit: 'bag',
          spec_attributes: { broken_percent: 1.0, moisture_percent: 11.2 } // Reversed key order to test canonical normalization
        }
      });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.error.code, 'SPECIFICATION_ALREADY_EXISTS');
      assert.strictEqual(res.data.error.existing_spec_id, createdSpecId);
    });

    // ---------------------------------------------------------------------------
    // 3. Different rice grades are not treated as equivalent
    // ---------------------------------------------------------------------------
    await test('3. Different rice grades are distinct specifications with different hashes', async () => {
      // Create Grade B specification with all other attributes identical
      const res = await api('/api/v1/specifications', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          product_id: 1,
          brand: 'Al-Madina Rice',
          variety: 'Super Kernel Basmati',
          crop_year: 'Old Crop 2025',
          processing_method: 'Sella (Parboiled)',
          quality_grade: 'Grade B Commercial', // Different quality grade!
          packaging_type: 'PP Bag',
          pack_size: 25.0,
          pack_unit: 'kg'
        }
      });

      assert.strictEqual(res.status, 201);
      assert.notStrictEqual(res.data.data.specification.id, createdSpecId);
      assert.notStrictEqual(res.data.data.specification.spec_hash, (await api(`/api/v1/specifications/${createdSpecId}`)).data.data.specification.spec_hash);
      cleanupSpecIds.push(res.data.data.specification.id);
    });

    // ---------------------------------------------------------------------------
    // 4. 16L and 16kg products are not merged (unit dimension separation)
    // ---------------------------------------------------------------------------
    await test('4. Mass (kg) and Volume (L) are strictly dimensionally separated', async () => {
      // 1. Service-level physical dimension separation
      assert.strictEqual(unitService.areUnitsCompatible('kg', 'L'), false);
      assert.strictEqual(unitService.areUnitsCompatible('16L', '16kg'), false);

      assert.throws(() => {
        unitService.convertQuantity(16, 'L', 'kg');
      }, /Incompatible unit dimensions/);

      assert.throws(() => {
        unitService.convertQuantity(16, 'kg', 'L');
      }, /Incompatible unit dimensions/);

      // 2. Compatible conversion works
      assert.strictEqual(unitService.convertQuantity(1, 'kg', 'g'), 1000);
      assert.strictEqual(unitService.convertQuantity(16, 'L', 'mL'), 16000);
    });

    // ---------------------------------------------------------------------------
    // 5. Two suppliers can list the same specification
    // ---------------------------------------------------------------------------
    await test('5. Two verified suppliers can publish separate offers for the same exact specification', async () => {
      // Supplier 1 lists createdSpecId
      const res1 = await api('/api/v1/listings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supp1Token}` },
        body: {
          product_spec_id: createdSpecId,
          available_stock: 500,
          base_unit_price: 5200.0,
          supplier_min_qty: 20,
          buyer_min_qty: 1,
          delivery_zones: ['Gulberg', 'Model Town'],
          fulfilment_lead_time_days: 1
        }
      });

      assert.strictEqual(res1.status, 201);
      createdListing1Id = res1.data.data.listing.id;
      cleanupListingIds.push(createdListing1Id);

      // Supplier 2 lists the SAME createdSpecId at different price and conditions
      const res2 = await api('/api/v1/listings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supp2Token}` },
        body: {
          product_spec_id: createdSpecId,
          available_stock: 250,
          base_unit_price: 5100.0, // Cheaper price
          supplier_min_qty: 10,
          buyer_min_qty: 2,
          delivery_zones: ['All Lahore'],
          delivery_fee_policy: 'FLAT_500_PER_DELIVERY',
          fulfilment_lead_time_days: 2
        }
      });

      assert.strictEqual(res2.status, 201);
      createdListing2Id = res2.data.data.listing.id;
      cleanupListingIds.push(createdListing2Id);

      // Create an out-of-stock listing for the same spec by Supplier 1
      // It must NEVER appear as an available offer for purchase
      const oosRes = await db.query(
        `INSERT INTO supplier_listings (listing_code, supplier_id, product_spec_id, available_stock, base_unit_price, pricing_unit, price_per_base_unit, delivery_zones, status)
         VALUES ('LST-OOS-TEST', ?, ?, 0.00, 4900.00, 'bag', 196.0000, '["All Lahore"]', 'ACTIVE')`,
        [verifiedSupp3Id, createdSpecId]
      );
      cleanupListingIds.push(oosRes[0].insertId);

      // Compare endpoint returns only active in-stock offers sorted by price
      const compRes = await api(`/api/v1/specifications/${createdSpecId}/compare`);
      assert.strictEqual(compRes.status, 200);
      assert.strictEqual(compRes.data.data.total_available_offers, 2, 'Out-of-stock offer must be excluded!');
      
      const offer0 = compRes.data.data.offers[0];
      const offer1 = compRes.data.data.offers[1];
      assert.strictEqual(offer0.listing_id, createdListing2Id); // Cheaper supplier first
      assert.strictEqual(offer0.pricing.base_price_per_pack, '5100.00');
      assert.strictEqual(offer0.pricing.price_per_base_unit, '204.0000');
      assert.strictEqual(offer0.delivery.is_delivery_included, false);
      assert.strictEqual(offer0.delivery.delivered_unit_price, null, 'Must not show unsupported unit delivered price for flat trip fee');

      assert.strictEqual(offer1.listing_id, createdListing1Id);
      assert.strictEqual(offer1.pricing.base_price_per_pack, '5200.00');
      assert.strictEqual(offer1.pricing.price_per_base_unit, '208.0000');
      assert.strictEqual(offer1.delivery.is_delivery_included, true);
      assert.strictEqual(offer1.delivery.delivered_unit_price, '5200.00', 'Delivered unit price equals base price when delivery is included');
    });

    // ---------------------------------------------------------------------------
    // 6. Supplier cannot edit another supplier's listing (ownership check)
    // ---------------------------------------------------------------------------
    await test('6. Supplier 2 cannot edit Supplier 1 listing (403 Forbidden)', async () => {
      const res = await api(`/api/v1/listings/${createdListing1Id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supp2Token}` }, // Supp 2 attempting to modify Supp 1
        body: {
          base_unit_price: 3000.0
        }
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
    });

    // ---------------------------------------------------------------------------
    // 7. Unverified supplier cannot publish listings
    // ---------------------------------------------------------------------------
    await test('7. Unverified supplier cannot publish listing (403 SUPPLIER_NOT_VERIFIED)', async () => {
      const res = await api('/api/v1/listings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${unverifiedSuppToken}` },
        body: {
          product_spec_id: createdSpecId,
          available_stock: 100,
          base_unit_price: 5000.0,
          supplier_min_qty: 10,
          buyer_min_qty: 1
        }
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'SUPPLIER_NOT_VERIFIED');
    });

    // ---------------------------------------------------------------------------
    // 8. Minimum quantity validation
    // ---------------------------------------------------------------------------
    await test('8. Minimum quantity validation rejects zero, negative, or invalid quantities', async () => {
      const res1 = await api('/api/v1/listings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supp1Token}` },
        body: {
          product_spec_id: 1,
          available_stock: 100,
          base_unit_price: 4500.0,
          supplier_min_qty: 0, // Invalid: 0
          buyer_min_qty: 1
        }
      });
      assert.strictEqual(res1.status, 400);

      const res2 = await api('/api/v1/listings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supp1Token}` },
        body: {
          product_spec_id: 1,
          available_stock: -5, // Invalid: negative stock
          base_unit_price: 4500.0,
          supplier_min_qty: 10,
          buyer_min_qty: 1
        }
      });
      assert.strictEqual(res2.status, 400);
      assert.strictEqual(res2.data.error.code, 'INVALID_STOCK');
    });

    // ---------------------------------------------------------------------------
    // 9. Negative/zero price rejection
    // ---------------------------------------------------------------------------
    await test('9. Negative or zero price is rejected with 400 INVALID_PRICE', async () => {
      const res1 = await api('/api/v1/listings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supp1Token}` },
        body: {
          product_spec_id: 1,
          available_stock: 100,
          base_unit_price: 0.0,
          supplier_min_qty: 10,
          buyer_min_qty: 1
        }
      });
      assert.strictEqual(res1.status, 400);
      assert.strictEqual(res1.data.error.code, 'INVALID_PRICE');

      const res2 = await api('/api/v1/listings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supp1Token}` },
        body: {
          product_spec_id: 1,
          available_stock: 100,
          base_unit_price: -450.0,
          supplier_min_qty: 10,
          buyer_min_qty: 1
        }
      });
      assert.strictEqual(res2.status, 400);
      assert.strictEqual(res2.data.error.code, 'INVALID_PRICE');
    });

    // ---------------------------------------------------------------------------
    // 10. Search returns matching specifications
    // ---------------------------------------------------------------------------
    await test('10. Search and filter returns exact matching specifications', async () => {
      // Search by keyword "Sella"
      const res1 = await api('/api/v1/specifications?search=Sella');
      assert.strictEqual(res1.status, 200);
      assert.ok(res1.data.data.specifications.length > 0);
      assert.ok(res1.data.data.specifications.every(s => s.title.includes('Sella') || s.processing_method.includes('Sella')));

      // Filter by category "Oils & Fats"
      const res2 = await api('/api/v1/specifications?category=Oils%20%26%20Fats');
      assert.strictEqual(res2.status, 200);
      assert.ok(res2.data.data.specifications.every(s => s.product_category === 'Oils & Fats'));

      // Filter by pack_size and unit
      const res3 = await api('/api/v1/specifications?pack_size=16.00&pack_unit=L');
      assert.strictEqual(res3.status, 200);
      assert.strictEqual(res3.data.data.specifications[0].pack_unit, 'L');
      assert.strictEqual(Number(res3.data.data.specifications[0].pack_size), 16);
    });

    // ---------------------------------------------------------------------------
    // 11. Inactive listing is handled correctly
    // ---------------------------------------------------------------------------
    await test('11. Inactive / paused listing is excluded from buyer catalog and comparison', async () => {
      // Pause Listing 2
      const pauseRes = await api(`/api/v1/listings/${createdListing2Id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${supp2Token}` },
        body: { status: 'PAUSED' }
      });
      assert.strictEqual(pauseRes.status, 200);
      assert.strictEqual(pauseRes.data.data.status, 'PAUSED');

      // Now compare endpoint should only return active Listing 1
      const compRes = await api(`/api/v1/specifications/${createdSpecId}/compare`);
      assert.strictEqual(compRes.status, 200);
      assert.strictEqual(compRes.data.data.total_available_offers, 1);
      assert.strictEqual(compRes.data.data.offers[0].listing_id, createdListing1Id);

      // Reactivate Listing 2
      const resumeRes = await api(`/api/v1/listings/${createdListing2Id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${supp2Token}` },
        body: { status: 'ACTIVE' }
      });
      assert.strictEqual(resumeRes.status, 200);
    });

    // ---------------------------------------------------------------------------
    // 12. Existing Regular Pool product relationships remain valid
    // ---------------------------------------------------------------------------
    await test('12. Historical Regular Pools retain original product references and have unassigned product_spec_id', async () => {
      const res = await api('/api/v1/pools');
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.data.pools.length >= 2, 'Existing pools must be present');

      const pool1 = res.data.data.pools.find(p => p.id === 1);
      assert.ok(pool1, 'Pool 1 must exist');
      assert.strictEqual(pool1.product_id, 1);
      assert.strictEqual(pool1.pool_code, 'MJ-POOL-0001');

      const pool2 = res.data.data.pools.find(p => p.id === 2);
      assert.ok(pool2, 'Pool 2 must exist');
      assert.strictEqual(pool2.product_id, 2);
      assert.strictEqual(pool2.pool_code, 'MJ-POOL-0002');

      // Verify additive product_spec_id column exists
      const [poolCols] = await db.query(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'product_spec_id'"
      );
      assert.strictEqual(poolCols.length, 1, 'pools table must have additive product_spec_id column');

      // Verify historical pools are not arbitrarily assigned unverified grades
      const [poolRows] = await db.query('SELECT id, product_id, product_spec_id FROM pools WHERE id IN (1, 2) ORDER BY id ASC');
      assert.strictEqual(poolRows[0].product_id, 1);
      assert.strictEqual(poolRows[0].product_spec_id, null, 'Historical pool 1 product_spec_id must be null');
      assert.strictEqual(poolRows[1].product_id, 2);
      assert.strictEqual(poolRows[1].product_spec_id, null, 'Historical pool 2 product_spec_id must be null');
    });

    // ---------------------------------------------------------------------------
    // 13. Price change recording test (price history)
    // ---------------------------------------------------------------------------
    await test('13. Updating listing price automatically writes to price history audit log', async () => {
      const updateRes = await api(`/api/v1/listings/${createdListing1Id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supp1Token}` },
        body: {
          base_unit_price: 5350.0,
          price_change_reason: 'Mandi price increased'
        }
      });
      assert.strictEqual(updateRes.status, 200);

      // Check price history
      const histRes = await api(`/api/v1/listings/${createdListing1Id}/price-history`);
      assert.strictEqual(histRes.status, 200);
      assert.ok(histRes.data.data.history.length > 0);
      assert.strictEqual(Number(histRes.data.data.history[0].previous_price), 5200.0);
      assert.strictEqual(Number(histRes.data.data.history[0].new_price), 5350.0);
      assert.strictEqual(histRes.data.data.history[0].change_reason, 'Mandi price increased');
    });

    // ---------------------------------------------------------------------------
    // 14. 8 Representative Catalog Specifications Verified
    // ---------------------------------------------------------------------------
    await test('14. All 8 representative catalog specifications are present in database', async () => {
      const [rows] = await db.query('SELECT spec_code, title, pack_size, pack_unit FROM product_specifications ORDER BY id ASC');
      assert.ok(rows.length >= 8, 'At least 8 specifications must exist');

      const titles = rows.map(r => r.title);
      assert.ok(titles.some(t => t.includes('Super Kernel Basmati Old Crop Sella')), 'Super Kernel Old Crop Sella missing');
      assert.ok(titles.some(t => t.includes('Super Kernel Steam New Crop')), 'Super Kernel Steam New Crop missing');
      assert.ok(titles.some(t => t.includes('Kainat 1121 Steam')), 'Kainat 1121 Steam missing');
      assert.ok(titles.some(t => t.includes('PK-386 Non-Basmati')), 'PK-386 missing');
      assert.ok(titles.some(t => t.includes('Commercial Cooking Oil') && t.includes('16L')), 'Commercial Cooking Oil 16L missing');
      assert.ok(titles.some(t => t.includes('Chakki Flour') && t.includes('20kg')), 'Chakki Flour 20kg missing');
      assert.ok(titles.some(t => t.includes('Sugar') && t.includes('50kg')), 'Sugar 50kg missing');
      assert.ok(titles.some(t => t.includes('Chana Dal') && t.includes('25kg')), 'Chana Dal 25kg missing');
    });

    // ---------------------------------------------------------------------------
    // 15. Real development database immutability check
    // ---------------------------------------------------------------------------
    await test('15. Test suite runs in complete isolation and does not modify miljor_db', async () => {
      const [devUsersAfter] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.users');
      const [devProductsAfter] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.products');
      const [devPoolsAfter] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pools');

      assert.strictEqual(devSnapshot.users, devUsersAfter[0].cnt, 'miljor_db.users was polluted!');
      assert.strictEqual(devSnapshot.products, devProductsAfter[0].cnt, 'miljor_db.products was polluted!');
      assert.strictEqual(devSnapshot.pools, devPoolsAfter[0].cnt, 'miljor_db.pools was polluted!');
    });

  } finally {
    // Teardown test fixtures
    console.log('\n🧹 Cleaning up test fixtures from miljor_test_db...');
    if (cleanupListingIds.length) {
      await db.query(`DELETE FROM supplier_listing_price_history WHERE listing_id IN (${cleanupListingIds.join(',')})`);
      await db.query(`DELETE FROM supplier_listings WHERE id IN (${cleanupListingIds.join(',')})`);
    }
    if (cleanupSpecIds.length) {
      await db.query(`DELETE FROM product_specifications WHERE id IN (${cleanupSpecIds.join(',')})`);
    }
    if (cleanupUserIds.length) {
      await db.query(`DELETE FROM supplier_listing_price_history WHERE changed_by IN (${cleanupUserIds.join(',')})`);
      await db.query(`DELETE FROM supplier_listings WHERE supplier_id IN (${cleanupUserIds.join(',')})`);
      await db.query(`DELETE FROM supplier_profiles WHERE supplier_id IN (${cleanupUserIds.join(',')})`);
      await db.query(`DELETE FROM users WHERE id IN (${cleanupUserIds.join(',')})`);
    }

    server.close();
  }

  console.log(`\n==================================================`);
  console.log(`Part 3 Specification Gate: ${passed}/${total} assertions passed`);
  console.log(`Status: ${passed === total ? 'PASS' : 'FAIL'}`);
  console.log(`==================================================\n`);

  process.exit(passed === total ? 0 : 1);
}

runPart3Gate().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
