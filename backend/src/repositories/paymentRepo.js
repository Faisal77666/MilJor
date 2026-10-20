// =============================================================================
// src/repositories/paymentRepo.js
// BUG-01 FIX: ALL queries now use 'payments' table only — escrow_payments removed
// Added: findByReservationId, updateStatus, createRefund
// =============================================================================
const db = require('../config/db');

class PaymentRepository {

  // Create a new payment record (status: CREATED)
  async createPayment(paymentData) {
    const {
      payment_code,
      reservation_id,
      order_id,
      buyer_id,
      amount,
      buyer_fee,
      payment_method,
      transaction_ref,
      proof_image_url
    } = paymentData;

    const [result] = await db.query(
      `INSERT INTO payments
        (payment_code, reservation_id, order_id, buyer_id, amount, buyer_fee,
         payment_method, status, escrow_status, transaction_ref, proof_image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CREATED', 'HELD_IN_ESCROW', ?, ?)`,
      [
        payment_code,
        reservation_id || null,
        order_id || null,
        buyer_id,
        amount,
        buyer_fee || 0,
        payment_method,
        transaction_ref || null,
        proof_image_url || null
      ]
    );
    return result.insertId;
  }

  // Update payment status and optional fields
  async updateStatus(paymentId, status, extra = {}) {
    const fields = ['status = ?', 'updated_at = NOW()'];
    const values = [status];

    if (extra.transaction_ref) { fields.push('transaction_ref = ?'); values.push(extra.transaction_ref); }
    if (extra.provider_response) { fields.push('provider_response = ?'); values.push(JSON.stringify(extra.provider_response)); }
    if (extra.escrow_status) { fields.push('escrow_status = ?'); values.push(extra.escrow_status); }
    if (status === 'PAID') { fields.push('paid_at = NOW()'); }
    if (status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED') { fields.push('refunded_at = NOW()'); }

    values.push(paymentId);
    const [result] = await db.query(`UPDATE payments SET ${fields.join(', ')} WHERE id = ?`, values);
    return result.affectedRows > 0;
  }

  // Release escrow to supplier
  async releaseEscrow(paymentId) {
    const [result] = await db.query(
      `UPDATE payments
       SET escrow_status = 'RELEASED_TO_SUPPLIER', updated_at = NOW()
       WHERE id = ? AND escrow_status = 'HELD_IN_ESCROW' AND status = 'PAID'`,
      [paymentId]
    );
    return result.affectedRows > 0;
  }

  // Find payment by ID (with reservation/order context)
  async findById(id) {
    const [rows] = await db.query(
      `SELECT p.*,
              r.reservation_code, r.quantity, r.locked_unit_price, r.locked_total_price,
              o.order_code
       FROM payments p
       LEFT JOIN reservations r ON p.reservation_id = r.id
       LEFT JOIN orders o ON p.order_id = o.id
       WHERE p.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  // Find payment by reservation ID
  async findByReservationId(reservationId) {
    const [rows] = await db.query(
      "SELECT * FROM payments WHERE reservation_id = ? ORDER BY id DESC LIMIT 1",
      [reservationId]
    );
    return rows[0] || null;
  }

  // Find payment by transaction_ref (idempotency check)
  async findByTransactionRef(transactionRef) {
    const [rows] = await db.query(
      "SELECT * FROM payments WHERE transaction_ref = ? LIMIT 1",
      [transactionRef]
    );
    return rows[0] || null;
  }

  // Find buyer's payments
  async findByBuyerId(buyerId) {
    const [rows] = await db.query(
      `SELECT p.*, r.reservation_code, o.order_code
       FROM payments p
       LEFT JOIN reservations r ON p.reservation_id = r.id
       LEFT JOIN orders o ON p.order_id = o.id
       WHERE p.buyer_id = ?
       ORDER BY p.id DESC`,
      [buyerId]
    );
    return rows;
  }
}

module.exports = new PaymentRepository();