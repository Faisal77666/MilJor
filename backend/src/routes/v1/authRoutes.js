// =============================================================================
// src/routes/v1/authRoutes.js
// Authentication & Identity Routes
// =============================================================================
const express = require('express');
const router = express.Router();
const authController = require('../../controllers/authController');
const { protect } = require('../../middlewares/authGuard');

// ---------------------------------------------------------------------------
// Public Routes
// ---------------------------------------------------------------------------
router.post('/register', (req, res) => authController.register(req, res));
router.post('/login', (req, res) => authController.login(req, res));
router.post('/verify-email', (req, res) => authController.verifyEmail(req, res));
router.post('/resend-otp', (req, res) => authController.resendOtp(req, res));

// ---------------------------------------------------------------------------
// Protected Routes
// ---------------------------------------------------------------------------
router.get('/me', protect, (req, res) => authController.getMe(req, res));
router.post('/logout', protect, (req, res) => authController.logout(req, res));
router.post('/supplier/apply', protect, (req, res) => authController.applyForSupplier(req, res));

module.exports = router;