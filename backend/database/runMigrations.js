// =============================================================================
// database/runMigrations.js
// Safe, versioned migration runner tracking schema_migrations
// =============================================================================
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigrations(targetDb) {
  const selectedDb = targetDb || process.env.DB_NAME || 'miljor_db';
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: selectedDb,
    multipleStatements: true
  });

  try {
    console.log('🔄 Checking database migration status...');

    // 1. Ensure schema_migrations table exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Fetch applied migrations
    const [appliedRows] = await connection.query('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(appliedRows.map(r => r.version));

    // 3. Read migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found.');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      const version = file.split('_')[0];
      if (appliedVersions.has(version)) {
        continue; // Already applied
      }

      console.log(`Applying migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      // Execute SQL migration
      await connection.query(sql);

      // Record migration
      await connection.query(
        'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
        [version, file]
      );
      console.log(`✅ Applied and recorded: ${file}`);
      count++;
    }

    if (count === 0) {
      console.log('✨ Database schema is up-to-date. No new migrations.');
    } else {
      console.log(`🎉 Successfully applied ${count} new migration(s).`);
    }

  } catch (error) {
    console.error('❌ Migration runner failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runMigrations };
