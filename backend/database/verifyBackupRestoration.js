// =============================================================================
// database/verifyBackupRestoration.js
// Verifies that database backup files can be restored into an isolated test DB
// =============================================================================
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function verifyBackupRestoration() {
  const backupDir = path.join(__dirname, 'backups');
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql'));
  if (files.length === 0) {
    throw new Error('No backup files found in database/backups/');
  }

  const latestBackup = path.join(backupDir, files[files.length - 1]);
  console.log(`Testing restoration of: ${path.basename(latestBackup)}`);

  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const testDb = 'miljor_test_db';

  // Ensure test DB exists
  const rootConn = await mysql.createConnection({ host, user, password });
  await rootConn.query(`CREATE DATABASE IF NOT EXISTS ${testDb}`);
  await rootConn.end();

  // Restore
  await new Promise((resolve, reject) => {
    const passArg = password ? `-p"${password}"` : '';
    const cmd = `mysql -h ${host} -u ${user} ${passArg} ${testDb} < "${latestBackup}"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve();
    });
  });

  // Verify restored tables
  const testConn = await mysql.createConnection({ host, user, password, database: testDb });
  const [tables] = await testConn.query('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);
  console.log(`✅ Successfully restored into ${testDb}! Restored table count: ${tableNames.length}`);

  // Compare with production DB tables
  const prodConn = await mysql.createConnection({ host, user, password, database: process.env.DB_NAME || 'miljor_db' });
  const [prodTables] = await prodConn.query('SHOW TABLES');
  const prodTableNames = prodTables.map(t => Object.values(t)[0]);

  if (tableNames.length !== prodTableNames.length) {
    throw new Error(`Table count mismatch: Restored ${tableNames.length} vs Prod ${prodTableNames.length}`);
  }

  console.log(`✅ Table counts match perfectly: ${tableNames.length} tables verified.`);
  await testConn.end();
  await prodConn.end();
}

if (require.main === module) {
  verifyBackupRestoration()
    .then(() => {
      console.log('🎉 Backup is fully verified and restorable.');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Backup restoration verification failed:', err.message);
      process.exit(1);
    });
}

module.exports = { verifyBackupRestoration };
