// =============================================================================
// src/repositories/poolRepo.js
// MilJor Regular Pool Repository
// Supports DRAFT creation, atomic updates, publishing, and tier management
// =============================================================================
const db = require('../config/db');

class PoolRepository {

  async createPool(poolData, connection = null) {
    const executor = connection || db;
    const {
      pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id,
      target_qty, supplier_min_qty, buyer_min_qty, max_capacity, pool_unit,
      purchase_increment, early_close_allowed, delivery_type, delivery_zones,
      delivery_fee_policy, fulfilment_lead_time_days, cancellation_cutoff_hours,
      current_price_per_unit, next_tier_price, quality_spec_grade, status,
      expires_at, supplier_confirmation_deadline, buyer_commitment_deadline
    } = poolData;

    const [result] = await executor.query(
      `INSERT INTO pools
        (pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id,
         current_qty, target_qty, supplier_min_qty, buyer_min_qty, max_capacity,
         pool_unit, purchase_increment, early_close_allowed, delivery_type,
         delivery_zones, delivery_fee_policy, fulfilment_lead_time_days,
         cancellation_cutoff_hours, current_price_per_unit, next_tier_price,
         quality_spec_grade, status, expires_at, supplier_confirmation_deadline,
         buyer_commitment_deadline)
       VALUES (?, ?, ?, ?, ?, 0.0000, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pool_code,
        supplier_id,
        product_id,
        product_spec_id || null,
        supplier_listing_id || null,
        target_qty,
        supplier_min_qty,
        buyer_min_qty,
        max_capacity || null,
        pool_unit || 'pack',
        purchase_increment || 1.0000,
        early_close_allowed !== undefined ? (early_close_allowed ? 1 : 0) : 1,
        delivery_type || 'DOORSTEP',
        delivery_zones ? JSON.stringify(delivery_zones) : null,
        delivery_fee_policy || 'INCLUDED_IN_PRICE',
        fulfilment_lead_time_days !== undefined && fulfilment_lead_time_days !== null ? fulfilment_lead_time_days : 2,
        cancellation_cutoff_hours !== undefined && cancellation_cutoff_hours !== null ? cancellation_cutoff_hours : 0,
        current_price_per_unit,
        next_tier_price || null,
        quality_spec_grade || null,
        status || 'DRAFT',
        expires_at,
        supplier_confirmation_deadline || null,
        buyer_commitment_deadline || null
      ]
    );
    return result.insertId;
  }

  async updatePool(poolId, updateData, connection = null) {
    const executor = connection || db;
    const allowedFields = [
      'target_qty', 'supplier_min_qty', 'buyer_min_qty', 'max_capacity',
      'pool_unit', 'purchase_increment', 'early_close_allowed', 'delivery_type',
      'delivery_zones', 'delivery_fee_policy', 'fulfilment_lead_time_days',
      'cancellation_cutoff_hours', 'current_price_per_unit', 'next_tier_price',
      'quality_spec_grade', 'status', 'expires_at',
      'supplier_confirmation_deadline', 'buyer_commitment_deadline'
    ];

    const sets = [];
    const values = [];

    for (const [key, val] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        sets.push(`${key} = ?`);
        if (key === 'delivery_zones' && val !== null && typeof val === 'object') {
          values.push(JSON.stringify(val));
        } else {
          values.push(val);
        }
      }
    }

    if (sets.length === 0) return;

    sets.push('updated_at = NOW()');
    values.push(poolId);

    await executor.query(
      `UPDATE pools SET ${sets.join(', ')} WHERE id = ?`,
      values
    );
  }

  async createPriceTier(tierData, connection = null) {
    const executor = connection || db;
    const { pool_id, min_qty, max_qty, price_per_unit, pricing_unit } = tierData;
    await executor.query(
      'INSERT INTO pool_price_tiers (pool_id, min_qty, max_qty, price_per_unit, pricing_unit) VALUES (?, ?, ?, ?, ?)',
      [pool_id, min_qty, max_qty, price_per_unit, pricing_unit || 'pack']
    );
  }

  async replacePriceTiers(poolId, tiers, connection = null) {
    const executor = connection || db;
    await executor.query('DELETE FROM pool_price_tiers WHERE pool_id = ?', [poolId]);
    for (const tier of tiers) {
      await executor.query(
        'INSERT INTO pool_price_tiers (pool_id, min_qty, max_qty, price_per_unit, pricing_unit) VALUES (?, ?, ?, ?, ?)',
        [poolId, tier.min_qty, tier.max_qty, tier.price_per_unit, tier.pricing_unit || 'pack']
      );
    }
  }

  // All active pools — public listing with optional filters (DRAFT is strictly excluded)
  async findAllActive({ category, min_price, max_price } = {}) {
    let where = "WHERE p.status = 'ACTIVE' AND p.expires_at > NOW()";
    const params = [];

    if (category) {
      where += ' AND pr.category = ?';
      params.push(category);
    }
    if (min_price) {
      where += ' AND p.current_price_per_unit >= ?';
      params.push(parseFloat(min_price));
    }
    if (max_price) {
      where += ' AND p.current_price_per_unit <= ?';
      params.push(parseFloat(max_price));
    }

    const [rows] = await db.query(`
      SELECT
        p.*,
        pr.title AS product_title, pr.category, pr.brand, pr.variety, pr.pack_size, pr.unit,
        u.business_name AS supplier_name, u.area AS supplier_area,
        (p.target_qty - p.current_qty) AS remaining_qty,
        ROUND((p.current_qty / p.target_qty) * 100, 1) AS fill_percentage,
        CASE WHEN p.product_spec_id IS NULL OR p.supplier_listing_id IS NULL THEN 1 ELSE 0 END AS is_legacy,
        CASE WHEN p.product_spec_id IS NULL OR p.supplier_listing_id IS NULL THEN 'LEGACY_NOT_AVAILABLE_FOR_NEW_RESERVATIONS' ELSE 'ACTIVE_PURCHASABLE' END AS participation_status
      FROM pools p
      JOIN products pr ON p.product_id = pr.id
      JOIN users u ON p.supplier_id = u.id
      ${where}
      ORDER BY p.id DESC
    `, params);
    return rows;
  }

  // Single pool by ID with price tiers
  async findById(id, connection = null) {
    const executor = connection || db;
    const [pools] = await executor.query(`
      SELECT
        p.*,
        pr.title AS product_title, pr.category, pr.brand, pr.variety, pr.pack_size, pr.unit,
        u.business_name AS supplier_name, u.area AS supplier_area,
        (p.target_qty - p.current_qty) AS remaining_qty
      FROM pools p
      JOIN products pr ON p.product_id = pr.id
      JOIN users u ON p.supplier_id = u.id
      WHERE p.id = ?
    `, [id]);

    if (!pools[0]) return null;

    const [tiers] = await executor.query(
      'SELECT id, min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
      [id]
    );

    return { ...pools[0], price_tiers: tiers };
  }

  // Supplier's own pools (includes DRAFT, ACTIVE, etc.)
  async findBySupplier(supplierId) {
    const [rows] = await db.query(`
      SELECT
        p.*,
        pr.title AS product_title, pr.category, pr.unit,
        (p.target_qty - p.current_qty) AS remaining_qty,
        ROUND((p.current_qty / p.target_qty) * 100, 1) AS fill_percentage,
        (SELECT COUNT(*) FROM reservations r WHERE r.pool_id = p.id AND r.status NOT IN ('CANCELLED','EXPIRED')) AS reservation_count
      FROM pools p
      JOIN products pr ON p.product_id = pr.id
      WHERE p.supplier_id = ?
      ORDER BY p.id DESC
    `, [supplierId]);
    return rows;
  }

  // Find pools expired but still ACTIVE (for scheduler)
  async findExpiredActive() {
    const [rows] = await db.query(
      "SELECT * FROM pools WHERE status = 'ACTIVE' AND expires_at <= NOW()"
    );
    return rows;
  }

  // Update pool status
  async updateStatus(poolId, status, extra = {}, connection = null) {
    const executor = connection || db;
    const fields = ['status = ?', 'updated_at = NOW()'];
    const values = [status];

    if (extra.closed_at) { fields.push('closed_at = NOW()'); }
    if (extra.confirmed_at) { fields.push('confirmed_at = NOW()'); }
    if (extra.notes !== undefined) { fields.push('supplier_confirmation_notes = ?'); values.push(extra.notes); }

    values.push(poolId);
    await executor.query(`UPDATE pools SET ${fields.join(', ')} WHERE id = ?`, values);
  }
}

module.exports = new PoolRepository();