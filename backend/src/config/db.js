const mysql = require('mysql2/promise');
require('dotenv').config();

// Determine database role:
// - NODE_ENV === 'test': disposable automated regression database ('miljor_test_db')
// - NODE_ENV === 'sandbox': persistent manual Safepay sandbox E2E database ('miljor_sandbox_db')
// - default: protected development/business database ('miljor_db')
let dbName;
if (process.env.NODE_ENV === 'test') {
  dbName = process.env.TEST_DB_NAME || 'miljor_test_db';
} else if (process.env.NODE_ENV === 'sandbox') {
  dbName = process.env.SANDBOX_DB_NAME || 'miljor_sandbox_db';
} else {
  dbName = process.env.DB_NAME || 'miljor_db';
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z' // Authoritative UTC timestamp convention
});

// Enforce authoritative UTC session timezone on every physical MySQL connection (OBS-16, OBS-22)
pool.pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

// Test Database Connection
pool.getConnection()
  .then(connection => {
    console.log(`✅ MySQL Database connected successfully to ${dbName}!`);
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database Connection Failed:', err.message);
  });

module.exports = pool;
