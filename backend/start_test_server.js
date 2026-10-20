// =============================================================================
// start_test_server.js
// MilJor Part 4E.3.4: Isolated Test Environment Server Runner
// Runs server.js strictly with:
//   NODE_ENV = 'test'
//   DB_NAME = 'miljor_test_db'
//   PORT = 5000
// Scheduler is strictly inactive in NODE_ENV === 'test'.
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'miljor_test_db';
process.env.PORT = '5000';

const app = require('./server');

const PORT = 5000;
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[TestServer] MilJor Backend listening on http://127.0.0.1:${PORT} [test/miljor_test_db]`);
  console.log('[TestServer] Scheduler is inactive. Production DB is completely untouched.');
});

server.on('error', (err) => {
  console.error('[TestServer] Fatal server error:', err);
  process.exit(1);
});
