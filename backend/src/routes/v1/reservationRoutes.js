// =============================================================================
// src/routes/v1/reservationRoutes.js
// UPDATED: Added confirm and cancel routes
// =============================================================================
const express = require('express');
const router = express.Router();
const reservationController = require('../../controllers/reservationController');
const { protect, authorize, authorizeStrict } = require('../../middlewares/authGuard');
const idempotencyGuard = require('../../middlewares/idempotencyGuard');

// All reservation routes require authentication
router.use(protect);

// Create reservation (Mandatory X-Idempotency-Key)
router.post(
  '/',
  authorize('BUYER'),
  idempotencyGuard.required,
  (req, res) => reservationController.createReservation(req, res)
);

// View my reservations
router.get(
  '/my',
  authorize('BUYER'),
  (req, res) => reservationController.getMyReservations(req, res)
);

// Get specific reservation by ID
router.get(
  '/:id',
  (req, res) => reservationController.getReservationById(req, res)
);

// Get authoritative buyer commercial offer (Part 4D.4)
router.get(
  '/:id/final-offer',
  (req, res) => reservationController.getBuyerCommercialOffer(req, res)
);

// Record authoritative buyer decision (ACCEPT / DECLINE) (Part 4D.4)
// Strictly restricted to BUYER role (Administrators and Suppliers cannot impersonate buyer commercial consent)
router.post(
  '/:id/final-decision',
  authorizeStrict('BUYER'),
  idempotencyGuard.required,
  (req, res) => reservationController.recordBuyerDecision(req, res)
);

// Get authoritative buyer order readiness evaluation (Part 4E.1)
// Strictly restricted to BUYER role (and validated for resource tenancy)
router.get(
  '/:id/order-readiness',
  authorizeStrict('BUYER'),
  (req, res) => reservationController.getOrderReadiness(req, res)
);

// Authoritative Order Conversion from Buyer Commitment (Part 4E.2)
// Strictly restricted to BUYER role (Mandatory X-Idempotency-Key)
router.post(
  '/:id/order',
  authorizeStrict('BUYER'),
  idempotencyGuard.required,
  (req, res) => reservationController.createOrder(req, res)
);

// Update reservation quantity (PATCH /api/v1/reservations/:id)
router.patch(
  '/:id',
  authorize('BUYER'),
  idempotencyGuard.required,
  (req, res) => reservationController.updateReservationQuantity(req, res)
);

// Cancel reservation (POST /api/v1/reservations/:id/cancel)
router.post(
  '/:id/cancel',
  authorize('BUYER'),
  idempotencyGuard.required,
  (req, res) => reservationController.cancelReservation(req, res)
);

// Backward-compatible PUT /:id/cancel (Requires idempotency for full mutation safety - OBS-26)
router.put(
  '/:id/cancel',
  authorize('BUYER'),
  idempotencyGuard.required,
  (req, res) => reservationController.cancelReservation(req, res)
);

// Confirm reservation (lock price permanently - Part 4D)
router.put(
  '/:id/confirm',
  authorize('BUYER'),
  (req, res) => reservationController.confirmReservation(req, res)
);

module.exports = router;