// =============================================================================
// tests/order_read_and_checkout_flow.test.js
// MilJor Level 1 Focused Test: Order Read & Buyer Checkout API Endpoints
// Enforces tenant isolation, RBAC, spec enrichment, and miljor_db preservation.
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_super_secret_jwt_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

let passedAssertions = 0;
function recordPass(desc) {
  passedAssertions++;
  console.log(`  [PASS] Assertion ${passedAssertions}: ${desc}`);
}

async function runSuite() {
  console.log('================================================================================');
  console.log('MILJOR FOCUSED GATE: BUYER ORDERS & CHECKOUT READ MODEL');
  console.log('================================================================================');

  let server;
  let testPort;
  const createdOrderIds = [];
  const createdPoolIds = [];

  try {
    // Start test server
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        testPort = server.address().port;
        resolve();
      });
    });

    // Capture baseline for miljor_db
    const [initialPools] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pools');
    const [initialOrders] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.orders');

    // Setup fixtures in miljor_test_db
    const [poolRes] = await db.query(
      `INSERT INTO pools (
        pool_code, product_id, product_spec_id, supplier_listing_id, supplier_id,
        status, pool_unit, buyer_min_qty, purchase_increment, target_qty,
        supplier_min_qty, max_capacity, current_qty, current_price_per_unit,
        delivery_type, delivery_fee_policy, expires_at, created_at, updated_at
      ) VALUES (
        CONCAT('POOL-READ-', UNIX_TIMESTAMP()), 1, 1, 1, 2,
        'CONFIRMED', 'BAG_50KG', 5.0000, 1.0000, 30.0000,
        20.0000, 50.0000, 30.0000, 1250.00,
        'DOORSTEP', 'STANDARD_DELIVERY', DATE_ADD(NOW(), INTERVAL 2 DAY), NOW(), NOW()
      )`
    );
    const poolId = poolRes.insertId;
    createdPoolIds.push(poolId);

    // Insert buyer 1 order (AWAITING_PAYMENT)
    const [order1Res] = await db.query(
      `INSERT INTO orders (
        order_code, buyer_id, supplier_id, pool_id, total_qty, unit_price,
        subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
        currency, delivery_type, delivery_address, cluster_zone,
        payment_status, order_status, fulfillment_status, created_at, updated_at
      ) VALUES (
        CONCAT('ORD-T1-', UNIX_TIMESTAMP()), 5, 2, ?, 10.0000, 1250.00,
        12500.00, 300.00, 250.00, 13050.00,
        'PKR', 'DOORSTEP', 'Shop 12, Main Market Gulberg, Lahore', 'Gulberg Central',
        'AWAITING_PAYMENT', 'AWAITING_PAYMENT', 'UNPAID', NOW(), NOW()
      )`,
      [poolId]
    );
    createdOrderIds.push(order1Res.insertId);

    // Insert buyer 2 order (AWAITING_PAYMENT)
    const [order2Res] = await db.query(
      `INSERT INTO orders (
        order_code, buyer_id, supplier_id, pool_id, total_qty, unit_price,
        subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
        currency, delivery_type, delivery_address, cluster_zone,
        payment_status, order_status, fulfillment_status, created_at, updated_at
      ) VALUES (
        CONCAT('ORD-T2-', UNIX_TIMESTAMP()), 6, 2, ?, 20.0000, 1250.00,
        25000.00, 400.00, 500.00, 25900.00,
        'PKR', 'DOORSTEP', 'Plaza 4, DHA Phase 5, Lahore', 'DHA Zone A',
        'AWAITING_PAYMENT', 'AWAITING_PAYMENT', 'UNPAID', NOW(), NOW()
      )`,
      [poolId]
    );
    createdOrderIds.push(order2Res.insertId);

    const buyer1Token = generateToken(5, 'BUYER');
    const buyer2Token = generateToken(6, 'BUYER');
    const supplierToken = generateToken(2, 'SUPPLIER');

    // Test 1: GET /api/v1/orders/my requires authentication
    const unauthRes = await makeRequest(server, {
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/v1/orders/my',
      method: 'GET'
    });
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must return 401');
    recordPass('GET /api/v1/orders/my strictly requires authentication (401)');

    // Test 2: GET /api/v1/orders/my restricted to BUYER role
    const suppListRes = await makeRequest(server, {
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/v1/orders/my',
      method: 'GET',
      headers: { Authorization: `Bearer ${supplierToken}` }
    });
    assert.strictEqual(suppListRes.status, 403, 'Supplier calling /orders/my must return 403');
    recordPass('GET /api/v1/orders/my strictly restricted to BUYER role (403)');

    // Test 3: Buyer 1 sees only Buyer 1 orders
    const b1ListRes = await makeRequest(server, {
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/v1/orders/my',
      method: 'GET',
      headers: { Authorization: `Bearer ${buyer1Token}` }
    });
    assert.strictEqual(b1ListRes.status, 200, 'Buyer 1 must get 200');
    assert.ok(b1ListRes.body.success, 'Response must indicate success');
    const b1Orders = b1ListRes.body.data.orders;
    assert.ok(Array.isArray(b1Orders), 'orders must be an array');
    const foundOrder1 = b1Orders.find(o => o.id === order1Res.insertId);
    const foundOrder2 = b1Orders.find(o => o.id === order2Res.insertId);
    assert.ok(foundOrder1, 'Buyer 1 must find order 1');
    assert.strictEqual(foundOrder2, undefined, 'Buyer 1 must NOT see Buyer 2 order');
    assert.strictEqual(foundOrder1.product_name, 'Basmati Rice Premium', 'Product name enriched');
    assert.strictEqual(foundOrder1.total_amount, 13050.00, 'Total amount matches');
    recordPass('Buyer 1 lists orders with strict tenant isolation and spec enrichment');

    // Test 4: GET /api/v1/orders/:id tenant isolation (Buyer 2 cannot view Buyer 1 order)
    const crossBuyerRes = await makeRequest(server, {
      hostname: '127.0.0.1',
      port: testPort,
      path: `/api/v1/orders/${order1Res.insertId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${buyer2Token}` }
    });
    assert.strictEqual(crossBuyerRes.status, 403, 'Cross-buyer order inspection must return 403');
    recordPass('Cross-buyer GET /api/v1/orders/:id denied with 403 FORBIDDEN');

    // Test 5: Buyer 1 views own order by ID with enriched details
    const b1DetailRes = await makeRequest(server, {
      hostname: '127.0.0.1',
      port: testPort,
      path: `/api/v1/orders/${order1Res.insertId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${buyer1Token}` }
    });
    assert.strictEqual(b1DetailRes.status, 200, 'Buyer 1 viewing own order returns 200');
    const orderObj = b1DetailRes.body.data.order;
    assert.strictEqual(orderObj.id, order1Res.insertId, 'Correct order returned');
    assert.strictEqual(orderObj.total_amount, 13050.00, 'Total amount accurate');
    assert.strictEqual(orderObj.product_name, 'Basmati Rice Premium', 'Product name enriched');
    assert.strictEqual(orderObj.payment_status, 'AWAITING_PAYMENT', 'Payment status accurate');
    recordPass('Buyer 1 views authoritative order details with financial breakdown and specs');

    // Test 6: miljor_db preservation check
    const [finalPools] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.pools');
    const [finalOrders] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.orders');
    assert.strictEqual(finalPools[0].cnt, initialPools[0].cnt, 'miljor_db pools must remain unchanged');
    assert.strictEqual(finalOrders[0].cnt, initialOrders[0].cnt, 'miljor_db orders must remain unchanged');
    recordPass('Database isolation: miljor_db remains 100% PRISTINE');

    console.log('================================================================================');
    console.log(`Focused Gate Status: PASS (${passedAssertions}/${passedAssertions} assertions passed)`);
    console.log('================================================================================');

  } finally {
    if (server) {
      await new Promise(r => server.close(r));
    }
    // Clean up test fixtures in miljor_test_db
    if (createdOrderIds.length > 0) {
      await db.query(`DELETE FROM orders WHERE id IN (?)`, [createdOrderIds]);
    }
    if (createdPoolIds.length > 0) {
      await db.query(`DELETE FROM pools WHERE id IN (?)`, [createdPoolIds]);
    }
    await db.end();
  }
}

runSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
