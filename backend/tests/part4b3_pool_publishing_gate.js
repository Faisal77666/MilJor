// =============================================================================
// tests/part4b3_pool_publishing_gate.js
// MilJor Part 4B.3 Verification Suite:
// Regular Pool Tier Pricing, Commercial Terms & Safe Publishing
// Zero external testing dependencies (Uses native Node.js fetch & http)
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const tierPricingService = require('../src/services/tierPricingService');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

async function runPart4B3GateTests() {
  console.log('🚀 Starting MilJor Part 4B.3 Pool Publishing & Tier Pricing Gate Suite...\n');

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

  // 1. Verify Database Isolation
  const [dbRow] = await db.query('SELECT DATABASE() as current_db');
  const activeDb = dbRow[0].current_db;
  console.log(`🔒 Test Suite Environment Verified: Active Database = '${activeDb}'`);
  assert.strictEqual(activeDb, 'miljor_test_db', 'Must execute strictly against miljor_test_db!');

  // Start ephemeral HTTP test server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  let reqCount = 0;
  async function api(endpoint, options = {}) {
    const url = `${baseUrl}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if ((options.method === 'POST' || options.method === 'PUT') && !headers['x-idempotency-key'] && !options.skipIdempotency) {
      headers['x-idempotency-key'] = `PART4B3-IDEM-${Date.now()}-${++reqCount}`;
    }
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  // Tokens
  const supplier1Token = generateToken(2, 'SUPPLIER', 'VERIFIED'); // Tariq Mehmood (Listing 1 & 2)
  const supplier2Token = generateToken(3, 'SUPPLIER', 'VERIFIED'); // Abdul Razzaq (Listing 3)
  const buyerToken = generateToken(5, 'BUYER', 'UNVERIFIED'); // Asif Khan

  // Snapshot initial state
  const [poolsBefore] = await db.query('SELECT id, pool_code, status FROM pools WHERE id IN (1, 2)');

  let testDraftPoolId = null;

  try {
    // -------------------------------------------------------------------------
    // Tier Pricing Engine Unit Verifications
    // -------------------------------------------------------------------------

    // 1. Valid contiguous non-overlapping tiers pass validation
    try {
      const validTiers = [
        { min_qty: 10, max_qty: 24, price_per_unit: 5200.00, pricing_unit: 'bag' },
        { min_qty: 25, max_qty: 50, price_per_unit: 4900.00, pricing_unit: 'bag' }
      ];
      const res = tierPricingService.validateTiers(validTiers, {
        supplier_min_qty: 10,
        target_qty: 25,
        max_capacity: 50,
        pool_unit: 'bag',
        purchase_increment: 1
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.normalizedTiers.length, 2);
      pass('1. Contiguous, non-overlapping price tiers pass tier engine validation');
    } catch (e) { fail('1. Contiguous non-overlapping tiers pass', e); }

    // 2. Overlapping tiers are rejected with OVERLAPPING_TIERS
    try {
      const overlapTiers = [
        { min_qty: 10, max_qty: 25, price_per_unit: 5200.00 },
        { min_qty: 20, max_qty: 50, price_per_unit: 4900.00 } // Overlaps with 10-25
      ];
      const res = tierPricingService.validateTiers(overlapTiers, {
        supplier_min_qty: 10,
        target_qty: 25,
        max_capacity: 50,
        pool_unit: 'bag'
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error.code, 'OVERLAPPING_TIERS');
      pass('2. Overlapping price tier intervals rejected with OVERLAPPING_TIERS');
    } catch (e) { fail('2. Overlapping tiers rejected', e); }

    // 3. Gap between tiers is rejected with TIER_GAP_DETECTED
    try {
      const gapTiers = [
        { min_qty: 10, max_qty: 20, price_per_unit: 5200.00 },
        { min_qty: 25, max_qty: 50, price_per_unit: 4900.00 } // Gap 21-24
      ];
      const res = tierPricingService.validateTiers(gapTiers, {
        supplier_min_qty: 10,
        target_qty: 25,
        max_capacity: 50,
        pool_unit: 'bag'
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error.code, 'TIER_GAP_DETECTED');
      pass('3. Gap between price tiers rejected with TIER_GAP_DETECTED');
    } catch (e) { fail('3. Gap between tiers rejected', e); }

    // 4. Non-monotonic pricing (higher tier more expensive) is rejected
    try {
      const invertedTiers = [
        { min_qty: 10, max_qty: 24, price_per_unit: 4500.00 },
        { min_qty: 25, max_qty: 50, price_per_unit: 5000.00 } // Higher price for higher volume
      ];
      const res = tierPricingService.validateTiers(invertedTiers, {
        supplier_min_qty: 10,
        target_qty: 25,
        max_capacity: 50,
        pool_unit: 'bag'
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error.code, 'NON_MONOTONIC_PRICING');
      pass('4. Inverted / non-monotonic pricing rejected with NON_MONOTONIC_PRICING');
    } catch (e) { fail('4. Inverted pricing rejected', e); }

    // 5. Fractional pack quantity in discrete unit is rejected
    try {
      const fractionalTiers = [
        { min_qty: 10.5, max_qty: 25, price_per_unit: 5000.00 }
      ];
      const res = tierPricingService.validateTiers(fractionalTiers, {
        supplier_min_qty: 10,
        target_qty: 25,
        max_capacity: 25,
        pool_unit: 'bag'
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error.code, 'FRACTIONAL_TIER_QUANTITY');
      pass('5. Fractional tier quantities on discrete packaging rejected with FRACTIONAL_TIER_QUANTITY');
    } catch (e) { fail('5. Fractional tier quantities rejected', e); }

    // 6. Tier unit mismatch with pool_unit is rejected
    try {
      const mismatchTiers = [
        { min_qty: 10, max_qty: 50, price_per_unit: 5000.00, pricing_unit: 'kg' } // pool is 'bag'
      ];
      const res = tierPricingService.validateTiers(mismatchTiers, {
        supplier_min_qty: 10,
        target_qty: 50,
        max_capacity: 50,
        pool_unit: 'bag'
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error.code, 'TIER_UNIT_MISMATCH');
      pass('6. Tier pricing unit mismatch with pool calculation unit rejected with TIER_UNIT_MISMATCH');
    } catch (e) { fail('6. Tier unit mismatch rejected', e); }

    // 7. Insufficient tier coverage (doesn't reach max_capacity) is rejected
    try {
      const shortTiers = [
        { min_qty: 10, max_qty: 30, price_per_unit: 5000.00 } // max_capacity is 50
      ];
      const res = tierPricingService.validateTiers(shortTiers, {
        supplier_min_qty: 10,
        target_qty: 25,
        max_capacity: 50,
        pool_unit: 'bag'
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error.code, 'INSUFFICIENT_TIER_COVERAGE');
      pass('7. Incomplete tier coverage failing to reach pool capacity rejected with INSUFFICIENT_TIER_COVERAGE');
    } catch (e) { fail('7. Incomplete tier coverage rejected', e); }

    // 8. Applicable price calculation evaluates correct tier deterministically
    try {
      const tiers = [
        { min_qty: 10, max_qty: 24, price_per_unit: 5200.00 },
        { min_qty: 25, max_qty: 50, price_per_unit: 4900.00 }
      ];
      const belowMin = tierPricingService.calculateApplicablePrice(tiers, 5, 10);
      assert.strictEqual(belowMin.price, 5200.00);
      assert.strictEqual(belowMin.isQualified, false);

      const tier1 = tierPricingService.calculateApplicablePrice(tiers, 15, 10);
      assert.strictEqual(tier1.price, 5200.00);
      assert.strictEqual(tier1.tierIndex, 0);
      assert.strictEqual(tier1.isQualified, true);

      const tier2 = tierPricingService.calculateApplicablePrice(tiers, 30, 10);
      assert.strictEqual(tier2.price, 4900.00);
      assert.strictEqual(tier2.tierIndex, 1);
      assert.strictEqual(tier2.isQualified, true);

      pass('8. Applicable price calculation correctly evaluates qualification and tier index');
    } catch (e) { fail('8. Applicable price calculation', e); }

    // -------------------------------------------------------------------------
    // Idempotency Contract Verifications
    // -------------------------------------------------------------------------

    // 9. Mutation endpoint without X-Idempotency-Key returns 400 MISSING_IDEMPOTENCY_KEY
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        skipIdempotency: true,
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          duration_days: 7
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'MISSING_IDEMPOTENCY_KEY');
      pass('9. Mutation endpoint without X-Idempotency-Key rejected with 400 MISSING_IDEMPOTENCY_KEY');
    } catch (e) { fail('9. Missing idempotency key rejected', e); }

    // 10. Reusing same idempotency key with different payload returns 409 IDEMPOTENCY_PAYLOAD_CONFLICT
    try {
      const sharedKey = `CONFLICT-TEST-${Date.now()}`;
      const payloadA = {
        product_id: 1,
        product_spec_id: 1,
        supplier_listing_id: 1,
        target_qty: 10,
        supplier_min_qty: 5,
        buyer_min_qty: 1,
        duration_days: 7
      };
      const payloadB = {
        product_id: 1,
        product_spec_id: 1,
        supplier_listing_id: 1,
        target_qty: 25, // Different quantity / payload!
        supplier_min_qty: 5,
        buyer_min_qty: 1,
        duration_days: 7
      };

      const resA = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}`, 'x-idempotency-key': sharedKey },
        body: payloadA
      });
      assert.strictEqual(resA.status, 201);

      const resB = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}`, 'x-idempotency-key': sharedKey },
        body: payloadB
      });
      assert.strictEqual(resB.status, 409);
      assert.strictEqual(resB.body.error.code, 'IDEMPOTENCY_PAYLOAD_CONFLICT');
      pass('10. Reusing idempotency key with conflicting payload rejected with 409 IDEMPOTENCY_PAYLOAD_CONFLICT');
    } catch (e) { fail('10. Conflicting payload rejected', e); }

    // -------------------------------------------------------------------------
    // Pool Commercial Terms & Draft Creation
    // -------------------------------------------------------------------------

    // 11. Create a complete DRAFT pool with delivery terms and valid tiers
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 25,
          supplier_min_qty: 10,
          buyer_min_qty: 2,
          max_capacity: 50,
          pool_unit: 'bag',
          purchase_increment: 1,
          duration_days: 7,
          delivery_type: 'DOORSTEP',
          delivery_zones: ['Gulberg', 'Model Town', 'DHA'],
          delivery_fee_policy: 'INCLUDED_IN_PRICE',
          fulfilment_lead_time_days: 3,
          cancellation_cutoff_hours: 12,
          price_tiers: [
            { min_qty: 10, max_qty: 24, price_per_unit: 5100.00, pricing_unit: 'bag' },
            { min_qty: 25, max_qty: 50, price_per_unit: 4800.00, pricing_unit: 'bag' }
          ]
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.pool.status, 'DRAFT');
      assert.strictEqual(res.body.data.pool.delivery_type, 'DOORSTEP');
      assert.strictEqual(res.body.data.pool.fulfilment_lead_time_days, 3);
      assert.strictEqual(res.body.data.pool.cancellation_cutoff_hours, 12);
      assert.strictEqual(res.body.data.pool.price_tiers.length, 2);

      testDraftPoolId = res.body.data.pool.id;
      pass('11. Supplier creates DRAFT pool with delivery terms and verified price tiers');
    } catch (e) { fail('11. Create DRAFT pool with terms', e); }

    // 12. Public GET /api/v1/pools strictly excludes DRAFT pools
    try {
      const res = await api('/api/v1/pools');
      assert.strictEqual(res.status, 200);
      const poolIds = res.body.data.pools.map(p => p.id);
      assert.ok(!poolIds.includes(testDraftPoolId), 'DRAFT pool must not appear in public listing');
      pass('12. Public active pools query strictly excludes DRAFT pools');
    } catch (e) { fail('12. DRAFT excluded from public listing', e); }

    // 13. Supplier GET /api/v1/pools/supplier/my includes their DRAFT pools
    try {
      const res = await api('/api/v1/pools/supplier/my', {
        headers: { Authorization: `Bearer ${supplier1Token}` }
      });
      assert.strictEqual(res.status, 200);
      const myPoolIds = res.body.data.pools.map(p => p.id);
      assert.ok(myPoolIds.includes(testDraftPoolId), 'DRAFT pool must appear in supplier own pools');
      pass('13. Supplier my-pools endpoint correctly includes supplier\'s own DRAFT pools');
    } catch (e) { fail('13. Supplier my-pools includes DRAFT', e); }

    // 14. Invalid delivery_type is rejected with 400
    try {
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          product_id: 1,
          product_spec_id: 1,
          supplier_listing_id: 1,
          target_qty: 20,
          supplier_min_qty: 5,
          buyer_min_qty: 1,
          duration_days: 7,
          delivery_type: 'TELEPORTATION' // Invalid!
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'INVALID_DELIVERY_TYPE');
      pass('14. Unsupported delivery_type rejected with 400 INVALID_DELIVERY_TYPE');
    } catch (e) { fail('14. Invalid delivery_type rejected', e); }

    // -------------------------------------------------------------------------
    // Draft Editing Verifications
    // -------------------------------------------------------------------------

    // 15. Supplier 2 cannot edit Supplier 1's DRAFT pool (403 Forbidden)
    try {
      const res = await api(`/api/v1/pools/${testDraftPoolId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supplier2Token}` },
        body: { target_qty: 30 }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
      pass('15. Unauthorized supplier cannot edit another supplier\'s DRAFT pool (403 Forbidden)');
    } catch (e) { fail('15. Unauthorized supplier cannot edit draft', e); }

    // 16. Supplier 1 successfully updates DRAFT commercial terms and tiers
    try {
      const res = await api(`/api/v1/pools/${testDraftPoolId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: {
          target_qty: 30,
          fulfilment_lead_time_days: 4,
          price_tiers: [
            { min_qty: 10, max_qty: 24, price_per_unit: 5050.00, pricing_unit: 'bag' },
            { min_qty: 25, max_qty: 50, price_per_unit: 4750.00, pricing_unit: 'bag' }
          ]
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(Number(res.body.data.pool.target_qty), 30);
      assert.strictEqual(res.body.data.pool.fulfilment_lead_time_days, 4);
      assert.strictEqual(Number(res.body.data.pool.price_tiers[0].price_per_unit), 5050.00);
      pass('16. Supplier successfully updates DRAFT commercial terms and price tiers');
    } catch (e) { fail('16. Supplier updates DRAFT pool', e); }

    // -------------------------------------------------------------------------
    // Safe Publishing & Inventory Allocation Verifications
    // -------------------------------------------------------------------------

    // 17. Publishing requires X-Idempotency-Key
    try {
      const res = await api(`/api/v1/pools/${testDraftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        skipIdempotency: true
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'MISSING_IDEMPOTENCY_KEY');
      pass('17. Publishing without X-Idempotency-Key rejected with 400 MISSING_IDEMPOTENCY_KEY');
    } catch (e) { fail('17. Publishing requires idempotency key', e); }

    // 18. Buyer cannot publish a pool (403 Forbidden)
    try {
      const res = await api(`/api/v1/pools/${testDraftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` }
      });
      assert.strictEqual(res.status, 403);
      pass('18. Buyer is blocked from publishing pool (403 Forbidden)');
    } catch (e) { fail('18. Buyer cannot publish pool', e); }

    // 19. Supplier 2 cannot publish Supplier 1's pool (403 Forbidden)
    try {
      const res = await api(`/api/v1/pools/${testDraftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier2Token}` }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
      pass('19. Unauthorized supplier cannot publish another supplier\'s pool (403 Forbidden)');
    } catch (e) { fail('19. Unauthorized supplier cannot publish', e); }

    // 20. Supplier 1 successfully publishes DRAFT pool to ACTIVE
    try {
      const res = await api(`/api/v1/pools/${testDraftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.pool.status, 'ACTIVE');
      assert.strictEqual(res.body.data.inventory_allocation.status, 'COMMITTED');
      assert.strictEqual(Number(res.body.data.inventory_allocation.allocated_qty), 50.0); // max_capacity

      pass('20. Supplier successfully publishes DRAFT pool to ACTIVE with committed inventory allocation');
    } catch (e) { fail('20. Supplier publishes DRAFT to ACTIVE', e); }

    // 21. Published pool now appears in public active pools listing
    try {
      const res = await api('/api/v1/pools');
      assert.strictEqual(res.status, 200);
      const poolIds = res.body.data.pools.map(p => p.id);
      assert.ok(poolIds.includes(testDraftPoolId), 'Published ACTIVE pool must appear in public listing');
      pass('21. Newly published ACTIVE pool immediately appears in public active pools listing');
    } catch (e) { fail('21. Published pool appears in public listing', e); }

    // 22. Database verifies inventory allocation row created with status COMMITTED
    try {
      const [allocRows] = await db.query(
        `SELECT * FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL' AND status = 'COMMITTED'`,
        [testDraftPoolId]
      );
      assert.strictEqual(allocRows.length, 1);
      assert.strictEqual(Number(allocRows[0].allocated_qty), 50.0);
      assert.strictEqual(allocRows[0].allocation_type, 'REGULAR_POOL');
      pass('22. Database records active COMMITTED allocation in supplier_inventory_allocations');
    } catch (e) { fail('22. Allocation recorded in database', e); }

    // 23. Editing an ACTIVE pool commercial terms is strictly rejected (422 INVALID_POOL_STATE)
    try {
      const res = await api(`/api/v1/pools/${testDraftPoolId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: { target_qty: 99 }
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'INVALID_POOL_STATE');
      pass('23. Editing commercial terms of an ACTIVE pool strictly rejected with 422 INVALID_POOL_STATE');
    } catch (e) { fail('23. Editing active pool rejected', e); }

    // 24. Re-publishing an already ACTIVE pool is rejected (422 INVALID_POOL_STATE)
    try {
      const res = await api(`/api/v1/pools/${testDraftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` }
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'INVALID_POOL_STATE');
      pass('24. Re-publishing an already ACTIVE pool rejected with 422 INVALID_POOL_STATE');
    } catch (e) { fail('24. Re-publishing active pool rejected', e); }

    // 25. Cancelling an ACTIVE pool releases the inventory allocation
    try {
      const res = await api(`/api/v1/pools/${testDraftPoolId}/cancel`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: { reason: 'Test cancellation' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'CANCELLED');

      const [allocRows] = await db.query(
        `SELECT status FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'`,
        [testDraftPoolId]
      );
      assert.strictEqual(allocRows[0].status, 'RELEASED', 'Allocation must be transitioned to RELEASED upon pool cancellation');
      pass('25. Pool cancellation transitions status to CANCELLED and releases inventory allocation to RELEASED');
    } catch (e) { fail('25. Cancelling pool releases allocation', e); }

  } finally {
    // Teardown HTTP server
    await new Promise((resolve) => server.close(resolve));

    // Cleanup created test pools and allocations from test DB
    if (testDraftPoolId) {
      await db.query(`DELETE FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'`, [testDraftPoolId]);
      await db.query('DELETE FROM pool_price_tiers WHERE pool_id = ?', [testDraftPoolId]);
      await db.query('DELETE FROM pools WHERE id = ?', [testDraftPoolId]);
    }

    // Verify historical pools remained untouched
    const [poolsAfter] = await db.query('SELECT id, pool_code, status FROM pools WHERE id IN (1, 2)');
    assert.deepStrictEqual(poolsBefore, poolsAfter, 'Historical pools 1 and 2 must remain completely intact!');
  }

  console.log('\n==================================================');
  console.log(`Part 4B.3 Pool Publishing Gate: ${passed}/${passed + failed} assertions passed`);
  console.log(`Status: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPart4B3GateTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal Test Failure:', err);
  process.exit(1);
});
