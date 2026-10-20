process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const crypto = require('crypto');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function getFingerprint() {
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';

  const report = {};

  for (const dbName of ['miljor_db', 'miljor_sandbox_db']) {
    const conn = await mysql.createConnection({ host, user, password, database: dbName });
    try {
      const [tables] = await conn.query('SHOW TABLES');
      const tableNames = tables.map(t => Object.values(t)[0]).sort();

      const tableFingerprints = {};
      let totalRows = 0;

      for (const t of tableNames) {
        const [cnt] = await conn.query(`SELECT COUNT(*) as c FROM ${t}`);
        const count = Number(cnt[0].c);
        totalRows += count;

        let contentHash = 'empty';
        if (count > 0 && count < 1000) {
          const [rows] = await conn.query(`SELECT * FROM ${t} ORDER BY 1 LIMIT 100`);
          contentHash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
        }
        tableFingerprints[t] = { count, hash: contentHash };
      }

      report[dbName] = {
        tableCount: tableNames.length,
        totalRows,
        tableFingerprints
      };
    } finally {
      await conn.end();
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

getFingerprint().catch(err => {
  console.error(err);
  process.exit(1);
});
