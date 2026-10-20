// =============================================================================
// src/services/schedulerService.js  — NEW
// BUG-14 FIX: Pool closure service existed but was never scheduled.
//             This file sets up node-cron jobs and is called from server.js.
// =============================================================================
const cron = require('node-cron');
const poolClosureService = require('./poolClosureService');

function startScheduler() {
  console.log('⏰ MilJor Scheduler starting...');

  // ---------------------------------------------------------------------------
  // Every 10 minutes: Process expired pools & flash pools
  // ---------------------------------------------------------------------------
  cron.schedule('*/10 * * * *', async () => {
    console.log(`[Scheduler] Running pool expiry check at ${new Date().toISOString()}`);
    try {
      await poolClosureService.processExpiredPools();
      await poolClosureService.processExpiredFlashPools();
    } catch (err) {
      console.error('[Scheduler] Pool expiry job failed:', err.message);
    }
  });

  // ---------------------------------------------------------------------------
  // Every hour: Clean old idempotency records (older than 24h)
  // ---------------------------------------------------------------------------
  cron.schedule('0 * * * *', async () => {
    try {
      await poolClosureService.cleanOldIdempotencyRecords();
    } catch (err) {
      console.error('[Scheduler] Idempotency cleanup failed:', err.message);
    }
  });

  console.log('✅ Scheduler active: Pool expiry every 10 min | Cleanup every hour');
}

module.exports = { startScheduler };
