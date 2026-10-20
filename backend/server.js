// =============================================================================
// server.js — MilJor Backend Entry Point
// FIXES:
//   BUG-05: disputeRoutes now mounted
//   BUG-06: audit route now protected (done inside auditRoutes.js)
//   BUG-07: idempotencyGuard applied at route level (paymentRoutes, reservationRoutes)
//   BUG-13: JWT_SECRET check done inside authGuard.js — server fails fast if missing
//   BUG-14: schedulerService now started on boot
//   SECURITY: rate limiting applied to auth endpoints
//   SECURITY: CORS restricted (open CORS removed)
//   SECURITY: 404 handler added
//   SECURITY: Error handler never leaks stack traces
// =============================================================================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Fail fast if critical env vars are missing
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set in environment. Exiting.');
  process.exit(1);
}
if (!process.env.DB_PASSWORD && process.env.NODE_ENV === 'production') {
  console.error('FATAL: DB_PASSWORD is not set in production environment. Exiting.');
  process.exit(1);
}

// Database
const db = require('./src/config/db');

// Scheduler (BUG-14 FIX: pools now actually expire automatically)
const { startScheduler } = require('./src/services/schedulerService');

// Routes
const authRoutes = require('./src/routes/v1/authRoutes');
const productRoutes = require('./src/routes/v1/productRoutes');
const poolRoutes = require('./src/routes/v1/poolRoutes');
const reservationRoutes = require('./src/routes/v1/reservationRoutes');
const paymentRoutes = require('./src/routes/v1/paymentRoutes');
const auditRoutes = require('./src/routes/v1/auditRoutes');
const disputeRoutes = require('./src/routes/v1/disputeRoutes'); // BUG-05 FIX
const adminRoutes = require('./src/routes/v1/adminRoutes'); // Part 2 Admin Routes
const specificationRoutes = require('./src/routes/v1/specificationRoutes'); // Part 3 Specifications
const listingRoutes = require('./src/routes/v1/listingRoutes'); // Part 3 Supplier Listings
const orderRoutes = require('./src/routes/v1/orderRoutes'); // Part 4E.3 Orders
const fulfillmentRoutes = require('./src/routes/v1/fulfillmentRoutes'); // Part 4E.4 Post-Payment Fulfillment
const paymentController = require('./src/controllers/paymentController'); // Safepay webhook handler

const app = express();

// =============================================================================
// Security Middleware
// =============================================================================
app.use(helmet());

// CORS — restrict to known origins in production
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5500'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    return callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true
}));

// =============================================================================
// Body Parsing
// =============================================================================
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// =============================================================================
// Rate Limiting
// Auth endpoints: 10 requests per 15 minutes per IP (brute force protection)
// General API: 200 requests per 15 minutes per IP
// =============================================================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 1000 : 30, // 30 in dev/prod, 1000 in test suite
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait 15 minutes before trying again.' }
  }
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' }
  }
});

app.use('/api/', generalLimiter);
app.use('/api/v1/auth', authLimiter); // Stricter limit on auth

// =============================================================================
// Route Mounts
// =============================================================================
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/pools', poolRoutes);
app.use('/api/v1/reservations', reservationRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/disputes', disputeRoutes); // BUG-05 FIX: Was never mounted
app.use('/api/v1/admin', adminRoutes); // Part 2 Admin Routes
app.use('/api/v1/specifications', specificationRoutes); // Part 3 Exact Specifications & Comparison
app.use('/api/v1/listings', listingRoutes); // Part 3 Supplier Listings
app.use('/api/v1/orders', orderRoutes); // Part 4E.3 Orders & Checkout
app.use('/api/v1/fulfillment', fulfillmentRoutes); // Part 4E.4 Post-Payment Fulfillment
app.post('/api/v1/webhooks/safepay', (req, res) => paymentController.handleSafepayWebhook(req, res)); // Webhook alias

// =============================================================================
// Health Check
// =============================================================================
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'MilJor Backend is running',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// =============================================================================
// 404 Handler — catches any unmatched routes
// =============================================================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} does not exist` }
  });
});

// =============================================================================
// Global Error Handler — never leaks stack traces to client
// =============================================================================
app.use((err, req, res, next) => {
  // CORS errors
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ success: false, error: { code: 'CORS_ERROR', message: err.message } });
  }

  console.error(`[${new Date().toISOString()}] Server Error:`, err.stack);

  res.status(err.status || 500).json({
    success: false,
    error: {
      code: 'SERVER_ERROR',
      // SECURITY: Never expose stack traces or internal messages in production
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred. Please try again.'
        : err.message
    }
  });
});

// =============================================================================
// Start Server
// =============================================================================
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 MilJor Backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);

    // BUG-14 FIX: Start scheduler after server is up (disabled in test and sandbox environments)
    if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'sandbox') {
      startScheduler();
    }
  });
}

module.exports = app;