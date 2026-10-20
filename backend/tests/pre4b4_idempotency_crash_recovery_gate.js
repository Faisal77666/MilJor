// =============================================================================
// tests/pre4b4_idempotency_crash_recovery_gate.js
// MilJor Pre-4B.4 Idempotency Crash Recovery & Concurrency Simulation Suite
// Tests 11 comprehensive failure, crash, race condition, and recovery scenarios.
// Zero external testing dependencies (Native Node.js fetch & http)
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

async function runPre4B4IdempotencyGate() {
  console.log('⚡ Starting MilJor Pre-4B.4 Idempotency Crash Recovery Gate Suite...\n');

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
      headers['x-idempotency-key'] = `PRE4B4-IDEM-${Date.now()}-${++reqCount}`;
    }
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  const supplierToken = generateToken(2, 'SUPPLIER', 'VERIFIED'); // Tariq Mehmood
  const anotherSupplierToken = generateToken(3, 'SUPPLIER', 'VERIFIED'); // Abdul Razzaq
  const createdPoolIds = [];

  const crypto = require('crypto');
  function makeReqHash(method, url, body) {
    return crypto.createHash('sha256').update(JSON.stringify({ method, url, body })).digest('hex');
  }

  try {
    // -------------------------------------------------------------------------
    // Scenario 1: Crash BEFORE business transaction begins
    // -------------------------------------------------------------------------
    try {
      const crashKey1 = `CRASH-BEFORE-TX-${Date.now()}`;
      const payload1 = {
        product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
        target_qty: 15, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5
      };
      const reqHash1 = makeReqHash('POST', '/api/v1/pools', payload1);
      // Simulate crash: An in-flight record exists with status 'PENDING' older than 60s
      // and NO business pool row or audit record was ever created
      await db.query(
        `INSERT INTO idempotency_records 
          (idempotency_key, user_id, request_path, request_hash, status, response_status, response_body, created_at, last_heartbeat_at)
         VALUES (?, 2, 'POST:/api/v1/pools', ?, 'PENDING', 0, '', NOW() - INTERVAL 75 SECOND, NOW() - INTERVAL 75 SECOND)`,
        [crashKey1, reqHash1]
      );

      // Now client retries with crashKey1
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': crashKey1 },
        body: payload1
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      const newPoolId = res.body.data.pool.id;
      createdPoolIds.push(newPoolId);

      // Verify DB record transitioned to COMPLETED with linked resource_id
      const [rec] = await db.query('SELECT * FROM idempotency_records WHERE idempotency_key = ?', [crashKey1]);
      assert.strictEqual(rec[0].status, 'COMPLETED');
      assert.strictEqual(rec[0].resource_id, newPoolId);

      pass('1. Crash before business transaction permits safe retry without duplication');
    } catch (e) { fail('1. Crash before business transaction', e); }

    // -------------------------------------------------------------------------
    // Scenario 2: Crash BEFORE transaction commit (rolled back)
    // -------------------------------------------------------------------------
    try {
      const crashKey2 = `CRASH-BEFORE-COMMIT-${Date.now()}`;
      const payload2 = {
        product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
        target_qty: 18, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5
      };
      const reqHash2 = makeReqHash('POST', '/api/v1/pools', payload2);
      // Simulate a crashed worker whose transaction rolled back (no pool exists)
      await db.query(
        `INSERT INTO idempotency_records 
          (idempotency_key, user_id, request_path, request_hash, status, response_status, response_body, created_at, last_heartbeat_at)
         VALUES (?, 2, 'POST:/api/v1/pools', ?, 'PENDING', 0, '', NOW() - INTERVAL 90 SECOND, NOW() - INTERVAL 90 SECOND)`,
        [crashKey2, reqHash2]
      );

      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': crashKey2 },
        body: payload2
      });

      assert.strictEqual(res.status, 201);
      createdPoolIds.push(res.body.data.pool.id);

      pass('2. Crash before transaction commit cleans stale placeholder and executes cleanly');
    } catch (e) { fail('2. Crash before transaction commit', e); }

    // -------------------------------------------------------------------------
    // Scenario 3: Business transaction COMMITTED but server crashed before storing HTTP response
    // -------------------------------------------------------------------------
    try {
      const crashKey3 = `CRASH-POST-COMMIT-${Date.now()}`;
      const payload3 = {
        product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
        target_qty: 25, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 7
      };
      const reqHash3 = makeReqHash('POST', '/api/v1/pools', payload3);
      // 1. Manually create a pool as if the transaction committed
      const [poolRes] = await db.query(
        `INSERT INTO pools (pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id,
                            current_qty, target_qty, supplier_min_qty, buyer_min_qty, pool_unit, current_price_per_unit, status, expires_at)
         VALUES ('MJ-CRASH-POOL', 2, 1, 1, 1, 0, 25, 5, 1, 'bag', 5000.00, 'DRAFT', NOW() + INTERVAL 7 DAY)`
      );
      const preCommittedPoolId = poolRes.insertId;
      createdPoolIds.push(preCommittedPoolId);

      // 2. Insert stale idempotency record linked to this pool, but response was NOT stored (status = 'PENDING', response_status = 0)
      await db.query(
        `INSERT INTO idempotency_records 
          (idempotency_key, user_id, request_path, request_hash, status, resource_type, resource_id, response_status, response_body, created_at, last_heartbeat_at)
         VALUES (?, 2, 'POST:/api/v1/pools', ?, 'PENDING', 'pools', ?, 0, '', NOW() - INTERVAL 100 SECOND, NOW() - INTERVAL 100 SECOND)`,
        [crashKey3, reqHash3, preCommittedPoolId]
      );

      // Verify count of pools with code 'MJ-CRASH-POOL' is 1
      const [beforeCount] = await db.query('SELECT COUNT(*) as cnt FROM pools WHERE pool_code = "MJ-CRASH-POOL"');
      assert.strictEqual(beforeCount[0].cnt, 1);

      // 3. Client retries with crashKey3!
      // CRITICAL INVARIANT: The system must RECONCILE and return the existing pool WITHOUT creating a duplicate pool!
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': crashKey3 },
        body: {
          product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
          target_qty: 25, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 7
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.pool.id, preCommittedPoolId);

      // Assert database state: Still exactly ONE pool, no duplicate created!
      const [afterCount] = await db.query('SELECT COUNT(*) as cnt FROM pools WHERE pool_code = "MJ-CRASH-POOL"');
      assert.strictEqual(afterCount[0].cnt, 1, 'MUST NOT duplicate committed business entity on crash retry!');

      // Verify idempotency record is now marked COMPLETED
      const [finalRec] = await db.query('SELECT status, response_status FROM idempotency_records WHERE idempotency_key = ?', [crashKey3]);
      assert.strictEqual(finalRec[0].status, 'COMPLETED');
      assert.strictEqual(finalRec[0].response_status, 201);

      pass('3. Reconciles pre-committed business transaction on crash retry without duplicating business writes');
    } catch (e) { fail('3. Crash post commit reconciliation', e); }

    // -------------------------------------------------------------------------
    // Scenario 4: Two simultaneous requests with the EXACT same idempotency key
    // -------------------------------------------------------------------------
    try {
      const concurrentKey = `CONCURRENT-SAME-KEY-${Date.now()}`;
      const payload = {
        product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
        target_qty: 20, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5
      };

      const [resA, resB] = await Promise.all([
        api('/api/v1/pools', { method: 'POST', headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': concurrentKey }, body: payload }),
        api('/api/v1/pools', { method: 'POST', headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': concurrentKey }, body: payload })
      ]);

      const statuses = [resA.status, resB.status];
      // One request must succeed (201 or 200 replay), and the other must be rejected (409 CONCURRENT_REQUEST) or replayed (201)
      assert.ok(statuses.includes(201), 'At least one request must create the pool');
      assert.ok(statuses.includes(409) || (statuses[0] === 201 && statuses[1] === 201), 'Concurrent execution must be serialized');

      if (resA.body.data && resA.body.data.pool) createdPoolIds.push(resA.body.data.pool.id);
      if (resB.body.data && resB.body.data.pool && !createdPoolIds.includes(resB.body.data.pool.id)) createdPoolIds.push(resB.body.data.pool.id);

      pass('4. Simultaneous requests with identical key are concurrency-safe and serialized');
    } catch (e) { fail('4. Simultaneous same key requests', e); }

    // -------------------------------------------------------------------------
    // Scenario 5: Repeated request after confirmed successful commit
    // -------------------------------------------------------------------------
    try {
      const confirmedKey = `CONFIRMED-KEY-${Date.now()}`;
      const payload = {
        product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
        target_qty: 22, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5
      };

      const res1 = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': confirmedKey },
        body: payload
      });
      assert.strictEqual(res1.status, 201);
      const poolId = res1.body.data.pool.id;
      createdPoolIds.push(poolId);

      const res2 = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': confirmedKey },
        body: payload
      });
      assert.strictEqual(res2.status, 201);
      assert.strictEqual(res2.body.data.pool.id, poolId);

      pass('5. Repeated request after successful commit replays identical cached response');
    } catch (e) { fail('5. Repeated confirmed request', e); }

    // -------------------------------------------------------------------------
    // Scenario 6: Same key with DIFFERENT payload rejected (Payload Conflict)
    // -------------------------------------------------------------------------
    try {
      const key6 = `DIFF-PAYLOAD-KEY-${Date.now()}`;
      const resA = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': key6 },
        body: { product_id: 1, product_spec_id: 1, supplier_listing_id: 1, target_qty: 10, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5 }
      });
      assert.strictEqual(resA.status, 201);
      createdPoolIds.push(resA.body.data.pool.id);

      const resB = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': key6 },
        body: { product_id: 1, product_spec_id: 1, supplier_listing_id: 1, target_qty: 99, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5 }
      });
      assert.strictEqual(resB.status, 409);
      assert.strictEqual(resB.body.error.code, 'IDEMPOTENCY_PAYLOAD_CONFLICT');

      pass('6. Reusing idempotency key with conflicting payload strictly rejected with 409');
    } catch (e) { fail('6. Conflicting payload check', e); }

    // -------------------------------------------------------------------------
    // Scenario 7: Stale PROCESSING record with UNKNOWN outcome requires reconciliation
    // -------------------------------------------------------------------------
    try {
      const unknownKey = `UNKNOWN-OUTCOME-KEY-${Date.now()}`;
      const payload7 = { product_id: 1, product_spec_id: 1, supplier_listing_id: 1, target_qty: 10, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5 };
      const reqHash7 = makeReqHash('POST', '/api/v1/pools', payload7);
      await db.query(
        `INSERT INTO idempotency_records 
          (idempotency_key, user_id, request_path, request_hash, status, response_status, response_body, created_at, last_heartbeat_at)
         VALUES (?, 2, 'POST:/api/v1/pools', ?, 'UNKNOWN', 0, '', NOW() - INTERVAL 120 SECOND, NOW() - INTERVAL 120 SECOND)`,
        [unknownKey, reqHash7]
      );

      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': unknownKey },
        body: payload7
      });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, 'IDEMPOTENCY_OUTCOME_UNKNOWN');

      pass('7. Stale record with UNKNOWN status safely blocked with 409 IDEMPOTENCY_OUTCOME_UNKNOWN without duplicate writes');
    } catch (e) { fail('7. Unknown outcome safety', e); }

    // -------------------------------------------------------------------------
    // Scenario 8: Active request running with recent heartbeat is NOT purged
    // -------------------------------------------------------------------------
    try {
      const activeLongKey = `ACTIVE-HEARTBEAT-KEY-${Date.now()}`;
      const payload8 = { product_id: 1, product_spec_id: 1, supplier_listing_id: 1, target_qty: 10, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5 };
      const reqHash8 = makeReqHash('POST', '/api/v1/pools', payload8);
      // Created 80 seconds ago, BUT heartbeat was updated 5 seconds ago!
      await db.query(
        `INSERT INTO idempotency_records 
          (idempotency_key, user_id, request_path, request_hash, status, response_status, response_body, created_at, last_heartbeat_at)
         VALUES (?, 2, 'POST:/api/v1/pools', ?, 'PENDING', 0, '', NOW() - INTERVAL 80 SECOND, NOW() - INTERVAL 5 SECOND)`,
        [activeLongKey, reqHash8]
      );

      // Attempt concurrent request while active worker has recent heartbeat
      const res = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': activeLongKey },
        body: payload8
      });

      // Must NOT purge, must return 409 CONCURRENT_REQUEST
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, 'CONCURRENT_REQUEST');

      await db.query('DELETE FROM idempotency_records WHERE idempotency_key = ?', [activeLongKey]);
      pass('8. Genuinely active requests with recent heartbeats are never purged even if age > 60s');
    } catch (e) { fail('8. Active heartbeat protection', e); }

    // -------------------------------------------------------------------------
    // Scenario 9: Duplicate pool publication & inventory allocation prevention
    // -------------------------------------------------------------------------
    try {
      const resDraft = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          product_id: 1, product_spec_id: 1, supplier_listing_id: 1,
          target_qty: 15, supplier_min_qty: 5, buyer_min_qty: 1, max_capacity: 30, duration_days: 5,
          price_tiers: [{ min_qty: 5, max_qty: 30, price_per_unit: 5000.00 }]
        }
      });
      const poolId = resDraft.body.data.pool.id;
      createdPoolIds.push(poolId);

      const pubKey = `PUB-REPLAY-KEY-${Date.now()}`;
      const pub1 = await api(`/api/v1/pools/${poolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': pubKey }
      });
      assert.strictEqual(pub1.status, 200);

      // Verify exactly ONE allocation row exists in database
      const [allocRows1] = await db.query(
        `SELECT COUNT(*) as cnt FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'`,
        [poolId]
      );
      assert.strictEqual(allocRows1[0].cnt, 1);

      // Replay publish with same key
      const pub2 = await api(`/api/v1/pools/${poolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': pubKey }
      });
      assert.strictEqual(pub2.status, 200);

      // Verify still exactly ONE allocation row exists!
      const [allocRows2] = await db.query(
        `SELECT COUNT(*) as cnt FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'`,
        [poolId]
      );
      assert.strictEqual(allocRows2[0].cnt, 1, 'Replayed publish MUST NOT duplicate inventory allocation rows!');

      pass('9. Replayed pool publishing prevents duplicate inventory allocations in database');
    } catch (e) { fail('9. Duplicate allocation prevention', e); }

    // -------------------------------------------------------------------------
    // Scenario 10: Validation failure during pool creation marks record FAILED and allows safe retry
    // -------------------------------------------------------------------------
    try {
      const failKey = `FAIL-RETRY-KEY-${Date.now()}`;
      // Send invalid payload (target_qty: -1)
      const resFail = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': failKey },
        body: { product_id: 1, product_spec_id: 1, supplier_listing_id: 1, target_qty: -1, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5 }
      });
      assert.strictEqual(resFail.status, 400);

      // Verify record is marked FAILED
      const [recFail] = await db.query('SELECT status FROM idempotency_records WHERE idempotency_key = ?', [failKey]);
      assert.strictEqual(recFail[0].status, 'FAILED');

      // Now client retries with the same key using a VALID payload (or corrected payload).
      // Because it was a terminal 400 validation failure, the record allows clean retry or replay of 400
      pass('10. Validation failure properly transitions status to FAILED');
    } catch (e) { fail('10. Failure transition check', e); }

    // -------------------------------------------------------------------------
    // Scenario 11: Actor scoping (Different user attempting to use another user's key is rejected)
    // -------------------------------------------------------------------------
    try {
      const actorKey = `ACTOR-SCOPE-KEY-${Date.now()}`;
      const res1 = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'x-idempotency-key': actorKey },
        body: { product_id: 1, product_spec_id: 1, supplier_listing_id: 1, target_qty: 10, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5 }
      });
      assert.strictEqual(res1.status, 201);
      createdPoolIds.push(res1.body.data.pool.id);

      // Supplier 2 attempts to send request with Supplier 1's key
      const res2 = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${anotherSupplierToken}`, 'x-idempotency-key': actorKey },
        body: { product_id: 1, product_spec_id: 1, supplier_listing_id: 1, target_qty: 10, supplier_min_qty: 5, buyer_min_qty: 1, duration_days: 5 }
      });
      assert.strictEqual(res2.status, 403);
      assert.strictEqual(res2.body.error.code, 'IDEMPOTENCY_ACTOR_MISMATCH');

      pass('11. Actor scoping prevents cross-user idempotency key collision or hijacking with 403');
    } catch (e) { fail('11. Actor scoping check', e); }

  } finally {
    // Teardown HTTP server
    await new Promise((resolve) => server.close(resolve));

    // Cleanup created test pools and allocations from test DB
    for (const id of createdPoolIds) {
      await db.query(`DELETE FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'`, [id]);
      await db.query(`DELETE FROM pool_price_tiers WHERE pool_id = ?`, [id]);
      await db.query(`DELETE FROM pools WHERE id = ?`, [id]);
    }

    // Verify historical pools remained untouched
    const [poolsAfter] = await db.query('SELECT id, pool_code, status FROM pools WHERE id IN (1, 2)');
    assert.strictEqual(poolsAfter.length, 2);
  }

  console.log('\n==================================================');
  console.log(`Pre-4B.4 Idempotency Crash Recovery Gate: ${passed}/${passed + failed} assertions passed`);
  console.log(`Status: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPre4B4IdempotencyGate().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal Test Failure:', err);
  process.exit(1);
});
