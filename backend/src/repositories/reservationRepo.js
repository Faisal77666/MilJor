// =============================================================================
// src/repositories/reservationRepo.js
// FIXES:
//   BUG-10: Retroactive price recalculation ONLY touches RESERVED status
//           CONFIRMED/PAID reservations are never repriced
//   Added locked_unit_price / locked_total_price on confirmation
//   Added duplicate reservation check (UNIQUE constraint in DB handles it too)
// =============================================================================
const db = require('../config/db');

class ReservationRepository {

  // ---------------------------------------------------------------------------
  // Create Reservation — Transactional with FOR UPDATE row locking
  // BUG-10 FIX: Retroactive repricing only targets 'RESERVED' status
  // ---------------------------------------------------------------------------
  async createReservation(data) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const { pool_id, buyer_id, quantity, reservation_code } = data;

      // 1. Lock the pool row to prevent race conditions
      const [pools] = await connection.query(
        'SELECT * FROM pools WHERE id = ? AND status = "ACTIVE" FOR UPDATE',
        [pool_id]
      );

      if (!pools[0]) {
        throw new Error('Pool is not active or does not exist');
      }

      const pool = pools[0];

      // 2. Check expiry
      if (new Date(pool.expires_at) < new Date()) {
        throw new Error('This pool has expired and is no longer accepting reservations');
      }

      // 3. Check buyer minimum quantity
      if (quantity < pool.buyer_min_qty) {
        throw new Error(`Minimum order quantity for this pool is ${pool.buyer_min_qty} ${pool.unit || 'kg'}`);
      }

      // 4. Check for duplicate reservation (same buyer, same pool)
      const [duplicate] = await connection.query(
        'SELECT id FROM reservations WHERE pool_id = ? AND buyer_id = ? AND status NOT IN ("CANCELLED", "EXPIRED")',
        [pool_id, buyer_id]
      );
      if (duplicate.length > 0) {
        throw new Error('You already have an active reservation in this pool. Cancel the existing one first.');
      }

      const newTotalQty = pool.current_qty + quantity;

      // 5. Determine applicable price tier
      const [tiers] = await connection.query(
        'SELECT * FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
        [pool_id]
      );

      let applicablePrice = pool.current_price_per_unit;
      let nextTierPrice = pool.next_tier_price;

      for (let i = 0; i < tiers.length; i++) {
        if (newTotalQty >= tiers[i].min_qty) {
          applicablePrice = tiers[i].price_per_unit;
          nextTierPrice = tiers[i + 1] ? tiers[i + 1].price_per_unit : applicablePrice;
        }
      }

      const totalPrice = quantity * applicablePrice;

      // 6. Insert Reservation
      const [resResult] = await connection.query(
        `INSERT INTO reservations (reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status)
         VALUES (?, ?, ?, ?, ?, ?, 'RESERVED')`,
        [reservation_code, pool_id, buyer_id, quantity, applicablePrice, totalPrice]
      );

      // 7. Update Pool quantity and status
      let newPoolStatus = 'ACTIVE';
      if (newTotalQty >= pool.target_qty) {
        newPoolStatus = 'TARGET_REACHED';
      }

      await connection.query(
        `UPDATE pools
         SET current_qty = ?, current_price_per_unit = ?, next_tier_price = ?, status = ?, updated_at = NOW()
         WHERE id = ?`,
        [newTotalQty, applicablePrice, nextTierPrice, newPoolStatus, pool_id]
      );

      // 8. BUG-10 FIX: Retroactive repricing ONLY on RESERVED status
      //    CONFIRMED and PAID reservations have locked_unit_price and must NOT be changed
      if (applicablePrice < pool.current_price_per_unit) {
        await connection.query(
          `UPDATE reservations
           SET unit_price = ?, total_price = quantity * ?, updated_at = NOW()
           WHERE pool_id = ? AND status = 'RESERVED'`,
          [applicablePrice, applicablePrice, pool_id]
        );
      }

      // 9. Audit log
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'BUYER', 'RESERVATION_CREATED', 'reservations', ?, ?)`,
        [buyer_id, resResult.insertId, JSON.stringify({ pool_id, quantity, unit_price: applicablePrice })]
      );

      await connection.commit();
      connection.release();
      return resResult.insertId;

    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Confirm Reservation — Locks price permanently
  // Called by buyer after pool reaches CONFIRMED status
  // BUG-10 FIX: Sets locked_unit_price — this price NEVER changes after this point
  // ---------------------------------------------------------------------------
  async confirmReservation(reservationId, buyerId) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        'SELECT * FROM reservations WHERE id = ? FOR UPDATE',
        [reservationId]
      );

      if (!rows[0]) throw new Error('Reservation not found');
      if (rows[0].buyer_id !== buyerId) throw new Error('You do not own this reservation');
      if (rows[0].status !== 'RESERVED') {
        throw new Error(`Cannot confirm a reservation in status: ${rows[0].status}`);
      }

      // Verify the pool is in CONFIRMED state
      const [poolRows] = await connection.query(
        'SELECT status FROM pools WHERE id = ?',
        [rows[0].pool_id]
      );
      if (!poolRows[0] || !['CONFIRMED', 'PAYMENT_PENDING'].includes(poolRows[0].status)) {
        throw new Error('Pool must be CONFIRMED before you can confirm your reservation');
      }

      // Lock the price
      await connection.query(
        `UPDATE reservations
         SET status = 'CONFIRMED',
             locked_unit_price = unit_price,
             locked_total_price = total_price,
             confirmed_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [reservationId]
      );

      await connection.commit();
      connection.release();

      const [updated] = await db.query('SELECT * FROM reservations WHERE id = ?', [reservationId]);
      return updated[0];

    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Cancel Reservation — Buyer cancels their RESERVED reservation
  // ---------------------------------------------------------------------------
  async cancelReservation(reservationId, buyerId) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        'SELECT * FROM reservations WHERE id = ? FOR UPDATE',
        [reservationId]
      );

      if (!rows[0]) throw new Error('Reservation not found');
      if (rows[0].buyer_id !== buyerId) throw new Error('You do not own this reservation');
      if (!['RESERVED'].includes(rows[0].status)) {
        throw new Error(`Cannot cancel a reservation in status: ${rows[0].status}. Contact support for confirmed/paid reservations.`);
      }

      const cancelledQty = rows[0].quantity;

      // Update reservation
      await connection.query(
        "UPDATE reservations SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?",
        [reservationId]
      );

      // Return quantity to pool
      await connection.query(
        `UPDATE pools SET current_qty = GREATEST(0, current_qty - ?), updated_at = NOW() WHERE id = ?`,
        [cancelledQty, rows[0].pool_id]
      );

      await connection.commit();
      connection.release();
      return true;

    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Find reservations by buyer ID (with full pool, spec, and supplier details)
  // ---------------------------------------------------------------------------
  async findByBuyerId(buyer_id) {
    const [rows] = await db.query(
      `SELECT r.*, p.pool_code, p.status AS pool_status, p.pool_unit, p.expires_at,
              pr.title AS product_title, pr.category AS product_category, pr.unit AS product_unit,
              ps.id AS spec_id, ps.quality_grade, ps.spec_hash AS canonical_spec_hash,
              u.business_name AS supplier_name
       FROM reservations r
       JOIN pools p ON r.pool_id = p.id
       JOIN products pr ON p.product_id = pr.id
       LEFT JOIN product_specifications ps ON p.product_spec_id = ps.id
       JOIN users u ON p.supplier_id = u.id
       WHERE r.buyer_id = ?
       ORDER BY r.id DESC`,
      [buyer_id]
    );
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Find reservation by ID (with full pool, spec, and supplier details)
  // ---------------------------------------------------------------------------
  async findById(id, connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT r.*, p.pool_code, p.status AS pool_status, p.pool_unit, p.supplier_id, p.buyer_min_qty,
              p.purchase_increment, p.target_qty, p.supplier_min_qty, p.max_capacity, p.expires_at,
              pr.title AS product_title, pr.category AS product_category, pr.unit AS product_unit,
              ps.id AS spec_id, ps.quality_grade, ps.spec_hash AS canonical_spec_hash,
              u.business_name AS supplier_business_name, u.verification_status AS supplier_verification_status
       FROM reservations r
       JOIN pools p ON r.pool_id = p.id
       JOIN products pr ON p.product_id = pr.id
       LEFT JOIN product_specifications ps ON p.product_spec_id = ps.id
       JOIN users u ON p.supplier_id = u.id
       WHERE r.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  // ---------------------------------------------------------------------------
  // Find all active reservations for a pool
  // ---------------------------------------------------------------------------
  async findByPoolId(poolId, connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT r.*, u.full_name AS buyer_name, u.email AS buyer_email, u.phone AS buyer_phone
       FROM reservations r
       JOIN users u ON r.buyer_id = u.id
       WHERE r.pool_id = ? AND r.status NOT IN ('CANCELLED', 'EXPIRED')
       ORDER BY r.created_at ASC`,
      [poolId]
    );
    return rows;
  }
}

module.exports = new ReservationRepository();