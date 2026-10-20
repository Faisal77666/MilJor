const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { runMigrations } = require('./runMigrations');

async function initSandboxDb() {
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const sandboxDb = 'miljor_sandbox_db';

  console.log(`[InitSandboxDb] Connecting to MySQL at ${host}:${process.env.DB_PORT || 3306}...`);
  const rootConn = await mysql.createConnection({ host, user, password });

  // 1. Check if database already exists
  const [dbs] = await rootConn.query('SHOW DATABASES LIKE ?', [sandboxDb]);
  if (dbs.length > 0) {
    console.log(`[InitSandboxDb] '${sandboxDb}' already exists.`);
  } else {
    console.log(`[InitSandboxDb] Creating database '${sandboxDb}'...`);
    await rootConn.query(`CREATE DATABASE ${sandboxDb} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`[InitSandboxDb] Successfully created '${sandboxDb}'.`);
  }

  // 2. Find latest verified backup
  const backupDir = path.join(__dirname, 'backups');
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql'));
  if (files.length === 0) {
    throw new Error('No backup files found in database/backups/');
  }
  const latestBackup = path.join(backupDir, files[files.length - 1]);
  console.log(`[InitSandboxDb] Restoring baseline schema from latest backup: ${path.basename(latestBackup)}`);

  // 3. Restore backup into miljor_sandbox_db using standard mysql CLI
  await new Promise((resolve, reject) => {
    const passArg = password ? `-p"${password}"` : '';
    const cmd = `mysql -h ${host} -u ${user} ${passArg} ${sandboxDb} < "${latestBackup}"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve();
    });
  });

  // 4. Ensure migrations table and any newer migrations are tracked
  console.log(`[InitSandboxDb] Running safe migrations check on '${sandboxDb}'...`);
  await runMigrations(sandboxDb);

  // 5. Verify final table count and migration count against miljor_db
  const sandboxConn = await mysql.createConnection({ host, user, password, database: sandboxDb });
  const prodConn = await mysql.createConnection({ host, user, password, database: process.env.DB_NAME || 'miljor_db' });

  const [sandboxTables] = await sandboxConn.query('SHOW TABLES');
  const [prodTables] = await prodConn.query('SHOW TABLES');
  const [sandboxMigrations] = await sandboxConn.query('SELECT version, name FROM schema_migrations ORDER BY version ASC');
  const [prodMigrations] = await prodConn.query('SELECT version, name FROM schema_migrations ORDER BY version ASC');

  console.log(`[InitSandboxDb] Table Count: sandbox=${sandboxTables.length}, prod=${prodTables.length}`);
  console.log(`[InitSandboxDb] Migration Count: sandbox=${sandboxMigrations.length}, prod=${prodMigrations.length}`);

  if (sandboxTables.length !== prodTables.length) {
    throw new Error(`Table count mismatch: Sandbox ${sandboxTables.length} vs Prod ${prodTables.length}`);
  }
  if (sandboxMigrations.length !== prodMigrations.length) {
    throw new Error(`Migration count mismatch: Sandbox ${sandboxMigrations.length} vs Prod ${prodMigrations.length}`);
  }

  await sandboxConn.end();
  await prodConn.end();
  await rootConn.end();
}

if (require.main === module) {
  initSandboxDb()
    .then(() => {
      console.log('✅ miljor_sandbox_db successfully initialized and verified against production schema.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Failed to initialize miljor_sandbox_db:', err.message);
      process.exit(1);
    });
}

module.exports = { initSandboxDb };
