// =============================================================================
// start_sandbox_server.js
// MilJor Part 4E.3/4E.4: Persistent Safepay Sandbox E2E Server Runner
// Runs server.js strictly with:
//   NODE_ENV = 'sandbox'
//   DB_NAME = 'miljor_sandbox_db'
//   PORT = 5000
// Dedicated to manual Safepay sandbox checkout, real tunnels, and persistent webhooks.
// Scheduler is strictly inactive in sandbox runner.
// Completely isolated from automated regression runs (miljor_test_db) and
// production database (miljor_db).
// =============================================================================

process.env.NODE_ENV = 'sandbox';
process.env.DB_NAME = 'miljor_sandbox_db';
process.env.SAFEPAY_ENV = 'sandbox';
process.env.PORT = process.env.PORT || '5000';

const app = require('./server');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[SandboxServer] MilJor Backend listening on http://127.0.0.1:${PORT} [sandbox/miljor_sandbox_db]`);
  console.log('[SandboxServer] Persistent Sandbox DB active. Scheduler inactive. miljor_db and miljor_test_db untouched.');
});

server.on('error', (err) => {
  console.error('[SandboxServer] Fatal server error:', err);
  process.exit(1);
});
