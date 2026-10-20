// =============================================================================
// database/migrateAndSeed.js
// Executes schema.sql and seed.sql cleanly using mysql2
// =============================================================================
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runScript(connection, filePath) {
  console.log(`\n📄 Executing ${path.basename(filePath)}...`);
  const sql = fs.readFileSync(filePath, 'utf8');

  // Split SQL statements ignoring comments and delimiters
  // We can execute statement by statement
  const rawStatements = sql
    .replace(/--.*$/gm, '') // Remove single line comments
    .replace(/\/\*[\s\S]*?\*\//gm, '') // Remove multiline comments
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (let i = 0; i < rawStatements.length; i++) {
    const statement = rawStatements[i];
    if (statement.toLowerCase().startsWith('use ')) {
      continue; // Handled by connection database option
    }
    try {
      await connection.query(statement);
    } catch (err) {
      console.error(`❌ Failed on statement ${i + 1}:`);
      console.error(statement.substring(0, 120) + '...');
      console.error('Error:', err.message);
      throw err;
    }
  }
  console.log(`✅ ${path.basename(filePath)} executed successfully! (${rawStatements.length} statements)`);
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'miljor_db',
    multipleStatements: true
  });

  try {
    console.log('Connected to MySQL. Starting Phase 1 Schema & Seed migration...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const seedPath = path.join(__dirname, 'seed.sql');

    await runScript(connection, schemaPath);
    await runScript(connection, seedPath);

    console.log('\n🎉 Phase 1 Database Migration & Seed completed successfully!');
  } catch (error) {
    console.error('\n💥 Migration Failed:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

main();
