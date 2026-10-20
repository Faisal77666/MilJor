// =============================================================================
// database/backupDatabase.js
// Generates a point-in-time, verifiable SQL backup of the live MySQL database
// =============================================================================
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

function runBackup() {
  return new Promise((resolve, reject) => {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `miljor_db_backup_${timestamp}.sql`);

    const host = process.env.DB_HOST || 'localhost';
    const user = process.env.DB_USER || 'root';
    const password = process.env.DB_PASSWORD || '';
    const dbName = process.env.DB_NAME || 'miljor_db';

    // Construct mysqldump command safely
    const passFlag = password ? `-p"${password}"` : '';
    const cmd = `mysqldump -h ${host} -u ${user} ${passFlag} --single-transaction --quick --routines --triggers ${dbName} > "${backupFile}"`;

    console.log(`📦 Initiating database backup for '${dbName}'...`);
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error('❌ Backup failed:', err.message);
        return reject(err);
      }
      if (fs.existsSync(backupFile)) {
        const stats = fs.statSync(backupFile);
        if (stats.size > 0) {
          console.log(`✅ Backup successfully created: ${path.basename(backupFile)} (${(stats.size / 1024).toFixed(1)} KB)`);
          return resolve(backupFile);
        } else {
          return reject(new Error('Backup file was created but has 0 bytes.'));
        }
      } else {
        return reject(new Error('Backup file does not exist after execution.'));
      }
    });
  });
}

if (require.main === module) {
  runBackup()
    .then(file => {
      console.log(`🎉 Backup verified and ready for restoration testing: ${file}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('💥 Fatal Backup Error:', err.message);
      process.exit(1);
    });
}

module.exports = { runBackup };
