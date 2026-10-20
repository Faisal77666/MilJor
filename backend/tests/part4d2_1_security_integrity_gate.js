// =============================================================================
// tests/part4d2_1_security_integrity_gate.js
// MilJor Part 4D.2.1 Verification Suite:
// Comprehensive Backend Security Audit, Legacy Route Containment & Commercial Integrity Hardening
// Validates: OBS-59, OBS-60, OBS-61, OBS-62, OBS-63, OBS-64 and Mounted Routes Security
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const { CommercialLifecycleService } = require('../src/services/commercialLifecycleService');
const poolClosureService = require('../src/services/poolClosureService');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

// Tokens
const superAdminToken = generateToken(1, 'SUPER_ADMIN', 'VERIFIED');
const supplierToken = generateToken(2, 'SUPPLIER', 'VERIFIED'); // Tariq Mehmood
const otherSupplierToken = generateToken(3, 'SUPPLIER', 'VERIFIED'); // Abdul Razzaq
const buyerToken = generateToken(5, 'BUYER', 'UNVERIFIED'); // Asif Khan
const otherBuyerToken = generateToken(6, 'BUYER', 'UNVERIFIED'); // Bilal Ahmed

let testServer = null;
let baseUrl = '';

function makeRequest(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const postData = body ? JSON.stringify(body) : null;

    const reqHeaders = {
      ...headers
    };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method.toUpperCase(),
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch (e) {
          json = { raw: rawData };
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

const createdPoolIds = [];
const createdReservationIds = [];

// Helpers for test fixtures
async function createTestPoolFixture(overrides = {}) {
  const code = `P${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
  const expiresAt = overrides.expires_at || new Date(Date.now() - 3600000); // 1h in past
  const status = overrides.status || 'ACTIVE';

  const [res] = await db.query(
    `INSERT INTO pools (
      pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id,
      pool_unit, target_qty, supplier_min_qty, buyer_min_qty, max_capacity,
      purchase_increment, current_qty, current_price_per_unit, status, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      overrides.supplier_id || 2,
      1,
      1,
      1,
      'bag',
      overrides.target_qty || 100.0,
      overrides.supplier_min_qty || 50.0,
      1.0,
      overrides.max_capacity || 200.0,
      1.0,
      overrides.current_qty || 0.0,
      480.00,
      status,
      expiresAt
    ]
  );
  const poolId = res.insertId;
  createdPoolIds.push(poolId);

  // Add tier pricing
  await db.query(
    `INSERT INTO pool_price_tiers (pool_id, min_qty, max_qty, price_per_unit, pricing_unit)
     VALUES (?, 1.0, 49.0, 500.00, 'bag'),
            (?, 50.0, 99.0, 480.00, 'bag'),
            (?, 100.0, 200.0, 460.00, 'bag')`,
    [poolId, poolId, poolId]
  );

  // Add committed inventory allocation if published
  if (status !== 'DRAFT') {
    await db.query(
      `INSERT INTO supplier_inventory_allocations (
        supplier_listing_id, allocation_type, reference_id,
        allocated_qty, unit, status
      ) VALUES (1, 'REGULAR_POOL', ?, ?, 'bag', 'COMMITTED')`,
      [poolId, overrides.max_capacity || 200.0]
    );
  }

  return { poolId, poolCode: code };
}

async function addReservationFixture(poolId, buyerId, qty, status = 'RESERVED') {
  const resCode = `R${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
  const [res] = await db.query(
    `INSERT INTO reservations (
      reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status
    ) VALUES (?, ?, ?, ?, 480.00, ?, ?)`,
    [resCode, poolId, buyerId, qty, qty * 480.00, status]
  );
  createdReservationIds.push(res.insertId);
  return res.insertId;
}

async function runPart4D21SecurityGate() {
  console.log('================================================================================');
  console.log('🛡️ Starting MilJor Part 4D.2.1: Security Audit & Integrity Hardening Gate...');
  console.log('Target Database: miljor_test_db');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(name, ms = 0) {
    console.log(`✅ [PASS] ${name} (${ms}ms)`);
    passed++;
  }

  function fail(name, err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    failed++;
  }

  function startTest(name) {
    process.stdout.write(`⏳ [RUN] ${name}... `);
  }

  const [dbRow] = await db.query('SELECT DATABASE() as current_db');
  const activeDb = dbRow[0].current_db;
  console.log(`🔒 Test Suite Environment Verified: Active Database = '${activeDb}'\n`);
  assert.strictEqual(activeDb, 'miljor_test_db', 'Must execute strictly against miljor_test_db!');

  // Start ephemeral HTTP server
  testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, resolve));
  const port = testServer.address().port;
  baseUrl = `http://localhost:${port}`;

  try {
    // -------------------------------------------------------------------------
    // OBS-59: Legacy Confirmation Decommissioning
    // -------------------------------------------------------------------------
    startTest('1. OBS-59: Legacy PUT /api/v1/pools/:id/confirm is retired with 410 (Supplier Owner)');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ status: 'AWAITING_SUPPLIER_CONFIRMATION' });

      const res = await makeRequest('PUT', `${baseUrl}/api/v1/pools/${fixture.poolId}/confirm`, {
        Authorization: `Bearer ${supplierToken}`
      }, { confirmation_notes: 'Trying legacy confirm' });

      assert.strictEqual(res.status, 410);
      assert.strictEqual(res.body.error.code, 'LEGACY_OPERATION_RETIRED');

      // Verify DB pool status remains untouched
      const [poolRows] = await db.query('SELECT status FROM pools WHERE id = ?', [fixture.poolId]);
      assert.strictEqual(poolRows[0].status, 'AWAITING_SUPPLIER_CONFIRMATION');

      pass('1. OBS-59: Legacy PUT /api/v1/pools/:id/confirm is retired with 410 (Supplier Owner)', Date.now() - t0);
    } catch (e) { fail('1. OBS-59: Legacy PUT /api/v1/pools/:id/confirm is retired with 410 (Supplier Owner)', e); }

    startTest('2. OBS-59: Legacy confirm blocked for Admin callers (no bypass permitted)');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ status: 'AWAITING_SUPPLIER_CONFIRMATION' });

      const res = await makeRequest('PUT', `${baseUrl}/api/v1/pools/${fixture.poolId}/confirm`, {
        Authorization: `Bearer ${superAdminToken}`
      });

      assert.strictEqual(res.status, 410);
      assert.strictEqual(res.body.error.code, 'LEGACY_OPERATION_RETIRED');
      pass('2. OBS-59: Legacy confirm blocked for Admin callers (no bypass permitted)', Date.now() - t0);
    } catch (e) { fail('2. OBS-59: Legacy confirm blocked for Admin callers (no bypass permitted)', e); }

    startTest('3. OBS-59: Unauthenticated legacy confirm rejected with 401');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture();
      const res = await makeRequest('PUT', `${baseUrl}/api/v1/pools/${fixture.poolId}/confirm`);
      assert.strictEqual(res.status, 401);
      pass('3. OBS-59: Unauthenticated legacy confirm rejected with 401', Date.now() - t0);
    } catch (e) { fail('3. OBS-59: Unauthenticated legacy confirm rejected with 401', e); }

    // -------------------------------------------------------------------------
    // OBS-60: Destructive Cancellation & Admin Bypass Prevention
    // -------------------------------------------------------------------------
    startTest('4. OBS-60: Safe DRAFT pool cancellation succeeds (zero reservations, zero stock)');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ status: 'DRAFT' });

      const res = await makeRequest('PUT', `${baseUrl}/api/v1/pools/${fixture.poolId}/cancel`, {
        Authorization: `Bearer ${supplierToken}`
      }, { reason: 'Cancelling uncommitted draft' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'CANCELLED');

      const [poolRows] = await db.query('SELECT status FROM pools WHERE id = ?', [fixture.poolId]);
      assert.strictEqual(poolRows[0].status, 'CANCELLED');

      pass('4. OBS-60: Safe DRAFT pool cancellation succeeds (zero reservations, zero stock)', Date.now() - t0);
    } catch (e) { fail('4. OBS-60: Safe DRAFT pool cancellation succeeds', e); }

    startTest('5. OBS-60: Non-owner supplier cannot cancel draft pool (403 FORBIDDEN)');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ status: 'DRAFT', supplier_id: 2 });

      const res = await makeRequest('PUT', `${baseUrl}/api/v1/pools/${fixture.poolId}/cancel`, {
        Authorization: `Bearer ${otherSupplierToken}`
      });

      assert.strictEqual(res.status, 403);
      pass('5. OBS-60: Non-owner supplier cannot cancel draft pool (403 FORBIDDEN)', Date.now() - t0);
    } catch (e) { fail('5. OBS-60: Non-owner supplier cannot cancel draft pool', e); }

    startTest('6. OBS-60: Published ACTIVE pool cancellation blocked for supplier (422 PROTECTED)');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ status: 'ACTIVE' });
      await addReservationFixture(fixture.poolId, 5, 10.0, 'RESERVED');

      const res = await makeRequest('PUT', `${baseUrl}/api/v1/pools/${fixture.poolId}/cancel`, {
        Authorization: `Bearer ${supplierToken}`
      });

      assert.strictEqual(res.status, 422);
      assert.ok(
        ['RESERVED_POOL_CANCELLATION_BLOCKED', 'PROTECTED_POOL_CANCELLATION_BLOCKED'].includes(res.body.error.code),
        `Unexpected error code: ${res.body.error.code}`
      );

      // Assert inventory and reservations were NOT modified
      const [allocRows] = await db.query('SELECT status FROM supplier_inventory_allocations WHERE reference_id = ?', [fixture.poolId]);
      assert.strictEqual(allocRows[0].status, 'COMMITTED');

      const [resRows] = await db.query('SELECT status FROM reservations WHERE pool_id = ?', [fixture.poolId]);
      assert.strictEqual(resRows[0].status, 'RESERVED');

      pass('6. OBS-60: Published ACTIVE pool cancellation blocked for supplier (422 PROTECTED)', Date.now() - t0);
    } catch (e) { fail('6. OBS-60: Published ACTIVE pool cancellation blocked for supplier', e); }

    startTest('7. OBS-60: Published ACTIVE pool cancellation blocked for Admin (no admin bypass)');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ status: 'ACTIVE' });
      await addReservationFixture(fixture.poolId, 5, 10.0, 'RESERVED');

      const res = await makeRequest('PUT', `${baseUrl}/api/v1/pools/${fixture.poolId}/cancel`, {
        Authorization: `Bearer ${superAdminToken}`
      });

      assert.strictEqual(res.status, 422);
      assert.ok(
        ['RESERVED_POOL_CANCELLATION_BLOCKED', 'PROTECTED_POOL_CANCELLATION_BLOCKED'].includes(res.body.error.code),
        `Unexpected error code: ${res.body.error.code}`
      );

      pass('7. OBS-60: Published ACTIVE pool cancellation blocked for Admin (no admin bypass)', Date.now() - t0);
    } catch (e) { fail('7. OBS-60: Published ACTIVE pool cancellation blocked for Admin', e); }

    startTest('8. OBS-60: Pool with 0 buyers allows safe cancellation and releases committed inventory');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ status: 'ACTIVE' }); // Has committed inventory, 0 reservations

      const res = await makeRequest('PUT', `${baseUrl}/api/v1/pools/${fixture.poolId}/cancel`, {
        Authorization: `Bearer ${supplierToken}`
      }, { reason: 'Cancelling published pool before any buyers joined' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'CANCELLED');

      // Assert inventory allocation was cleanly released to RELEASED
      const [allocRows] = await db.query('SELECT status FROM supplier_inventory_allocations WHERE reference_id = ?', [fixture.poolId]);
      assert.strictEqual(allocRows[0].status, 'RELEASED');

      pass('8. OBS-60: Pool with 0 buyers allows safe cancellation and releases committed inventory', Date.now() - t0);
    } catch (e) { fail('8. Pool with 0 buyers allows safe cancellation and releases committed inventory', e); }

    // -------------------------------------------------------------------------
    // OBS-61 & OBS-62: Mandatory Idempotency & Replay vs Conflict Semantics
    // -------------------------------------------------------------------------
    startTest('9. OBS-62: POST /api/v1/pools/:id/qualify strictly requires X-Idempotency-Key (400)');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });

      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${supplierToken}`
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'MISSING_IDEMPOTENCY_KEY');
      pass('9. OBS-62: POST /api/v1/pools/:id/qualify strictly requires X-Idempotency-Key (400)', Date.now() - t0);
    } catch (e) { fail('9. OBS-62: POST /api/v1/pools/:id/qualify strictly requires X-Idempotency-Key', e); }

    startTest('10. OBS-62: Service layer qualifyPoolParticipation throws on missing idempotencyKey');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });

      let thrown = null;
      try {
        await CommercialLifecycleService.qualifyPoolParticipation({
          poolId: fixture.poolId,
          actor: { id: 2, role: 'SUPPLIER' },
          idempotencyKey: null,
          options: { requireIdempotencyKey: true }
        });
      } catch (err) {
        thrown = err;
      }

      assert.ok(thrown !== null);
      assert.strictEqual(thrown.code, 'MISSING_IDEMPOTENCY_KEY');
      assert.strictEqual(thrown.statusCode, 400);
      pass('10. OBS-62: Service layer qualifyPoolParticipation throws on missing idempotencyKey', Date.now() - t0);
    } catch (e) { fail('10. OBS-62: Service layer qualifyPoolParticipation throws on missing idempotencyKey', e); }

    startTest('11. OBS-61: Exact replay returns cached response with matching operation identity');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 5, 60.0, 'RESERVED');
      const idemKey = `QUAL-IDEM-REPLAY-${Date.now()}`;

      // Call 1: primary qualification
      const res1 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idemKey
      });
      assert.strictEqual(res1.status, 200);

      // Call 2: exact replay with same key & same actor
      const res2 = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': idemKey
      });
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.snapshot_code, res1.body.data.snapshot_code);

      pass('11. OBS-61: Exact replay returns cached response with matching operation identity', Date.now() - t0);
    } catch (e) { fail('11. OBS-61: Exact replay returns cached response with matching operation identity', e); }

    startTest('12. OBS-61: Different idempotency key on already-qualified pool returns 409 POOL_ALREADY_QUALIFIED');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });
      await addReservationFixture(fixture.poolId, 5, 60.0, 'RESERVED');

      // Primary qualification with Key A
      await CommercialLifecycleService.qualifyPoolParticipation({
        poolId: fixture.poolId,
        actor: { id: 2, role: 'SUPPLIER' },
        idempotencyKey: `KEY-A-${Date.now()}`
      });

      // New mutation attempt with Key B (not a replay)
      let thrown = null;
      try {
        await CommercialLifecycleService.qualifyPoolParticipation({
          poolId: fixture.poolId,
          actor: { id: 2, role: 'SUPPLIER' },
          idempotencyKey: `KEY-B-${Date.now()}`
        });
      } catch (err) {
        thrown = err;
      }

      assert.ok(thrown !== null);
      assert.strictEqual(thrown.code, 'POOL_ALREADY_QUALIFIED');
      assert.strictEqual(thrown.statusCode, 409);

      pass('12. OBS-61: Different idempotency key on already-qualified pool returns 409 POOL_ALREADY_QUALIFIED', Date.now() - t0);
    } catch (e) { fail('12. OBS-61: Different idempotency key on already-qualified pool returns 409', e); }

    startTest('13. OBS-61: Cross-actor idempotency key theft rejected with 403');
    try {
      const t0 = Date.now();
      const sharedKey = `SHARED-KEY-${Date.now()}`;
      const fixture = await createTestPoolFixture();

      // Supplier 2 initiates with key
      await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': sharedKey
      });

      // Other supplier attempts to reuse Supplier 2's key
      const res = await makeRequest('POST', `${baseUrl}/api/v1/pools/${fixture.poolId}/qualify`, {
        Authorization: `Bearer ${otherSupplierToken}`,
        'X-Idempotency-Key': sharedKey
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'IDEMPOTENCY_ACTOR_MISMATCH');

      pass('13. OBS-61: Cross-actor idempotency key theft rejected with 403', Date.now() - t0);
    } catch (e) { fail('13. OBS-61: Cross-actor idempotency key theft rejected with 403', e); }

    // -------------------------------------------------------------------------
    // OBS-63: Idempotency Retention & Safe Cleanup Policy
    // -------------------------------------------------------------------------
    startTest('14. OBS-63: cleanOldIdempotencyRecords preserves active, UNKNOWN, and commercial records');
    try {
      const t0 = Date.now();
      // Insert test records in past
      const eightDaysAgo = new Date(Date.now() - 8 * 86400000);

      // Record 1: Old non-critical completed (SAFE TO DELETE)
      await db.query(
        `INSERT INTO idempotency_records 
         (idempotency_key, user_id, request_path, request_hash, status, response_status, response_body, created_at)
         VALUES (?, 2, 'GET:/test/non-critical', 'hash1', 'COMPLETED', 200, '{}', ?)`,
        [`TEST-SAFE-CLEAN-${Date.now()}`, eightDaysAgo]
      );

      // Record 2: Old UNKNOWN outcome (MUST BE PRESERVED)
      const unknownKey = `TEST-PRESERVE-UNKNOWN-${Date.now()}`;
      await db.query(
        `INSERT INTO idempotency_records 
         (idempotency_key, user_id, request_path, request_hash, status, response_status, response_body, created_at)
         VALUES (?, 2, 'POST:/api/v1/pools/1/qualify', 'hash2', 'UNKNOWN', 0, '', ?)`,
        [unknownKey, eightDaysAgo]
      );

      // Record 3: Old commercial qualification record (MUST BE PRESERVED)
      const commKey = `TEST-PRESERVE-COMMERCIAL-${Date.now()}`;
      await db.query(
        `INSERT INTO idempotency_records 
         (idempotency_key, user_id, request_path, request_hash, status, resource_type, resource_id, response_status, response_body, created_at)
         VALUES (?, 2, 'POST:/api/v1/pools/1/qualify', 'hash3', 'COMPLETED', 'pools', 1, 200, '{}', ?)`,
        [commKey, eightDaysAgo]
      );

      // Run cleanup
      await poolClosureService.cleanOldIdempotencyRecords();

      // Check preservation
      const [uRows] = await db.query('SELECT * FROM idempotency_records WHERE idempotency_key = ?', [unknownKey]);
      assert.strictEqual(uRows.length, 1, 'UNKNOWN record must be preserved');

      const [cRows] = await db.query('SELECT * FROM idempotency_records WHERE idempotency_key = ?', [commKey]);
      assert.strictEqual(cRows.length, 1, 'Commercial record must be preserved');

      pass('14. OBS-63: cleanOldIdempotencyRecords preserves active, UNKNOWN, and commercial records', Date.now() - t0);
    } catch (e) { fail('14. OBS-63: cleanOldIdempotencyRecords preserves active, UNKNOWN, and commercial records', e); }

    // -------------------------------------------------------------------------
    // OBS-64: Qualification Snapshot Global Outcome Uniqueness (Migration 015)
    // -------------------------------------------------------------------------
    startTest('15. OBS-64: Migration 015 uq_snapshot_authoritative_outcome rejects duplicate outcomes');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ supplier_min_qty: 50.0 });

      // First snapshot: EXPIRED (Unqualified)
      await db.query(
        `INSERT INTO pool_commercial_snapshots (
          snapshot_code, pool_id, snapshot_version, qualification_status, participation_cutoff,
          supplier_id, product_id, pool_unit, eligible_aggregate_qty, supplier_min_qty, target_qty,
          max_capacity, candidate_unit_price, participating_reservations_summary, delivery_type, status
        ) VALUES (?, ?, 1, 'UNQUALIFIED', NOW(), 2, 1, 'bag', 20.0, 50.0, 100.0, 200.0, 500.00, '[]', 'DOORSTEP', 'EXPIRED')`,
        [`SNAP-P4D21-1-${Date.now()}`, fixture.poolId]
      );

      // Second attempt for same pool with EXPIRED or PENDING_SUPPLIER_DECISION (must trigger ER_DUP_ENTRY)
      let dupError = null;
      try {
        await db.query(
          `INSERT INTO pool_commercial_snapshots (
            snapshot_code, pool_id, snapshot_version, qualification_status, participation_cutoff,
            supplier_id, product_id, pool_unit, eligible_aggregate_qty, supplier_min_qty, target_qty,
            max_capacity, candidate_unit_price, participating_reservations_summary, delivery_type, status
          ) VALUES (?, ?, 2, 'QUALIFIED', NOW(), 2, 1, 'bag', 60.0, 50.0, 100.0, 200.0, 480.00, '[]', 'DOORSTEP', 'PENDING_SUPPLIER_DECISION')`,
          [`SNAP-P4D21-2-${Date.now()}`, fixture.poolId]
        );
      } catch (err) {
        dupError = err;
      }

      assert.ok(dupError !== null, 'Expected duplicate outcome insert to fail');
      assert.strictEqual(dupError.code, 'ER_DUP_ENTRY');
      assert.ok(dupError.sqlMessage.includes('uq_snapshot_authoritative_outcome'));

      pass('15. OBS-64: Migration 015 uq_snapshot_authoritative_outcome rejects duplicate outcomes', Date.now() - t0);
    } catch (e) { fail('15. OBS-64: Migration 015 uq_snapshot_authoritative_outcome rejects duplicate outcomes', e); }

    // -------------------------------------------------------------------------
    // Full Route Security & Object-Level Authorization
    // -------------------------------------------------------------------------
    startTest('16. Object Auth: Buyer A cannot view Buyer B reservation (403 FORBIDDEN)');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture();
      const resId = await addReservationFixture(fixture.poolId, 5, 10.0, 'RESERVED'); // Owned by Buyer 5

      // Buyer 6 tries to view Buyer 5's reservation
      const res = await makeRequest('GET', `${baseUrl}/api/v1/reservations/${resId}`, {
        Authorization: `Bearer ${otherBuyerToken}`
      });

      assert.strictEqual(res.status, 403);
      pass('16. Object Auth: Buyer A cannot view Buyer B reservation (403 FORBIDDEN)', Date.now() - t0);
    } catch (e) { fail('16. Object Auth: Buyer A cannot view Buyer B reservation', e); }

    startTest('17. Object Auth: Supplier A cannot view Supplier B reservation summary (403 FORBIDDEN)');
    try {
      const t0 = Date.now();
      const fixture = await createTestPoolFixture({ supplier_id: 2 }); // Owned by Supplier 2

      // Supplier 3 tries to view Supplier 2's summary
      const res = await makeRequest('GET', `${baseUrl}/api/v1/pools/${fixture.poolId}/supplier/summary`, {
        Authorization: `Bearer ${otherSupplierToken}`
      });

      assert.strictEqual(res.status, 403);
      pass('17. Object Auth: Supplier A cannot view Supplier B reservation summary (403 FORBIDDEN)', Date.now() - t0);
    } catch (e) { fail('17. Object Auth: Supplier A cannot view Supplier B reservation summary', e); }

    startTest('18. Object Auth: Buyer A cannot view Buyer B dispute (403 FORBIDDEN)');
    try {
      const t0 = Date.now();
      const [dispRes] = await db.query(
        `INSERT INTO order_disputes (dispute_code, buyer_id, reason, description, status)
         VALUES (?, 5, 'DAMAGED_GOODS', 'Damaged packaging details', 'OPEN')`,
        [`DSP-${Date.now().toString().slice(-6)}`]
      );
      const disputeId = dispRes.insertId;

      // Buyer 6 tries to view Buyer 5's dispute
      const res = await makeRequest('GET', `${baseUrl}/api/v1/disputes/${disputeId}`, {
        Authorization: `Bearer ${otherBuyerToken}`
      });

      assert.strictEqual(res.status, 403);
      pass('18. Object Auth: Buyer A cannot view Buyer B dispute (403 FORBIDDEN)', Date.now() - t0);
    } catch (e) { fail('18. Object Auth: Buyer A cannot view Buyer B dispute', e); }

    startTest('19. Account Security: Suspended user token is rejected in real time (403 ACCOUNT_SUSPENDED)');
    try {
      const t0 = Date.now();
      // Temporarily mark buyer 5 as SUSPENDED
      await db.query("UPDATE users SET buyer_trust_status = 'SUSPENDED' WHERE id = 5");

      const res = await makeRequest('GET', `${baseUrl}/api/v1/reservations/my`, {
        Authorization: `Bearer ${buyerToken}`
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'ACCOUNT_SUSPENDED');

      // Restore trust status to valid ENUM TRUSTED_BUYER
      await db.query("UPDATE users SET buyer_trust_status = 'TRUSTED_BUYER' WHERE id = 5");

      pass('19. Account Security: Suspended user token is rejected in real time (403 ACCOUNT_SUSPENDED)', Date.now() - t0);
    } catch (e) { fail('19. Account Security: Suspended user token is rejected in real time', e); }

    startTest('20. Privilege Boundary: Buyer cannot invoke admin endpoints (403 FORBIDDEN)');
    try {
      const t0 = Date.now();
      const res = await makeRequest('GET', `${baseUrl}/api/v1/admin/suppliers/pending`, {
        Authorization: `Bearer ${buyerToken}`
      });

      assert.strictEqual(res.status, 403);
      pass('20. Privilege Boundary: Buyer cannot invoke admin endpoints (403 FORBIDDEN)', Date.now() - t0);
    } catch (e) { fail('20. Privilege Boundary: Buyer cannot invoke admin endpoints', e); }

    startTest('21. Financial Boundary: Zero orders, payments, or ledger records created during audit tests');
    try {
      const t0 = Date.now();
      const [orderRows] = await db.query('SELECT COUNT(*) AS c FROM orders');
      const [payRows] = await db.query('SELECT COUNT(*) AS c FROM payments');
      assert.strictEqual(Number(orderRows[0].c), 0);
      assert.strictEqual(Number(payRows[0].c), 0);
      pass('21. Financial Boundary: Zero orders, payments, or ledger records created during audit tests', Date.now() - t0);
    } catch (e) { fail('21. Financial Boundary: Zero orders, payments, or ledger records created during audit tests', e); }

    startTest('22. Database Isolation: Development database miljor_db remains 100% PRISTINE');
    try {
      const t0 = Date.now();
      const [devPools] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pools');
      const [devRes] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservations');
      const [devEvents] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservation_business_events');
      const [devSnapshots] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.pool_commercial_snapshots');

      assert.strictEqual(Number(devPools[0].c), 2);
      assert.strictEqual(Number(devRes[0].c), 0);
      assert.strictEqual(Number(devEvents[0].c), 0);
      assert.strictEqual(Number(devSnapshots[0].c), 0);

      pass('22. Database Isolation: Development database miljor_db remains 100% PRISTINE', Date.now() - t0);
    } catch (e) { fail('22. Database Isolation: Development database miljor_db remains 100% PRISTINE', e); }

  } finally {
    if (testServer) {
      await new Promise((resolve) => testServer.close(resolve));
    }

    try {
      if (createdReservationIds.length > 0) {
        await db.query('DELETE FROM reservation_mutation_history WHERE reservation_id IN (?)', [createdReservationIds]);
        await db.query('DELETE FROM reservation_business_events WHERE reservation_id IN (?)', [createdReservationIds]);
        await db.query('DELETE FROM reservations WHERE id IN (?)', [createdReservationIds]);
      }
      if (createdPoolIds.length > 0) {
        await db.query('DELETE FROM pool_commercial_snapshots WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM reservation_business_events WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query("DELETE FROM supplier_inventory_allocations WHERE reference_id IN (?) AND allocation_type = 'REGULAR_POOL'", [createdPoolIds]);
        await db.query('DELETE FROM pool_price_tiers WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
      }
      await db.query("DELETE FROM idempotency_records WHERE idempotency_key LIKE 'IDEM-%' OR idempotency_key LIKE 'QUAL-%' OR idempotency_key LIKE 'KEY-%'");
    } catch (cleanupErr) {
      console.error('Fixture cleanup error:', cleanupErr.message);
    }
  }

  console.log('\n================================================================================');
  console.log(`Part 4D.2.1 Security & Integrity Gate: ${passed} / ${passed + failed} assertions passed`);
  console.log(`Status: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================================\n');

  if (failed > 0) {
    throw new Error(`Part 4D.2.1 Security Gate: ${failed} assertion(s) failed`);
  }
}

if (require.main === module) {
  runPart4D21SecurityGate()
    .then(async () => {
      await db.end();
      process.exitCode = 0;
    })
    .catch(async (err) => {
      console.error('Fatal error in Part 4D.2.1 Security Gate:', err);
      try { await db.end(); } catch (e) {}
      process.exitCode = 1;
    });
}

module.exports = { runPart4D21SecurityGate };
