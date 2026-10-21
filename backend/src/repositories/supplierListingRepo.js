// =============================================================================
// src/repositories/supplierListingRepo.js
// MilJor Supplier Listing Repository
// Decoupled supplier offers tied to exact product specifications
// =============================================================================
const db = require('../config/db');

class SupplierListingRepository {
  // Create a new supplier listing
  async create(listingData) {
    const {
      listing_code,
      supplier_id,
      product_spec_id,
      available_stock,
      base_unit_price,
      pricing_unit,
      price_per_base_unit,
      currency,
      supplier_min_qty,
      buyer_min_qty,
      delivery_zones,
      delivery_fee_policy,
      fulfilment_lead_time_days,
      status,
      notes
    } = listingData;

    const [result] = await db.query(
      `INSERT INTO supplier_listings (
        listing_code, supplier_id, product_spec_id, available_stock,
        base_unit_price, pricing_unit, price_per_base_unit, currency,
        supplier_min_qty, buyer_min_qty, delivery_zones, delivery_fee_policy,
        fulfilment_lead_time_days, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        listing_code,
        supplier_id,
        product_spec_id,
        available_stock || 0.00,
        base_unit_price,
        pricing_unit || 'pack',
        price_per_base_unit || null,
        currency || 'PKR',
        supplier_min_qty || 1.00,
        buyer_min_qty || 1.00,
        JSON.stringify(delivery_zones || ['All Lahore']),
        delivery_fee_policy || 'INCLUDED_IN_PRICE',
        fulfilment_lead_time_days || 2,
        status || 'ACTIVE',
        notes || null
      ]
    );

    return result.insertId;
  }

  // Find listing by ID with complete spec and supplier information
  async findById(id) {
    const [rows] = await db.query(
      `SELECT sl.*,
              u.full_name as supplier_name,
              u.email as supplier_email,
              sp.verification_level,
              sp.verification_status as supplier_verification_status,
              sp.subscription_plan,
              ps.spec_code,
              ps.title as spec_title,
              ps.brand,
              ps.variety,
              ps.quality_grade,
              ps.packaging_type,
              ps.pack_size,
              ps.pack_unit,
              ps.purchasing_unit,
              ps.product_id,
              p.category as product_category
       FROM supplier_listings sl
       JOIN users u ON sl.supplier_id = u.id
       LEFT JOIN supplier_profiles sp ON u.id = sp.supplier_id
       JOIN product_specifications ps ON sl.product_spec_id = ps.id
       JOIN products p ON ps.product_id = p.id
       WHERE sl.id = ?`,
      [id]
    );

    if (!rows[0]) return null;

    const listing = rows[0];
    const isAvailable = listing.status === 'ACTIVE' && Number(listing.available_stock) >= Number(listing.buyer_min_qty);
    return {
      ...listing,
      effective_status: Number(listing.available_stock) <= 0 ? 'OUT_OF_STOCK' : listing.status,
      is_available_for_purchase: isAvailable
    };
  }

  // Find existing listing by supplier and exact spec
  async findBySupplierAndSpec(supplierId, specId) {
    const [rows] = await db.query(
      'SELECT * FROM supplier_listings WHERE supplier_id = ? AND product_spec_id = ?',
      [supplierId, specId]
    );
    return rows[0] || null;
  }

  // List all listings with filters
  async findAll(filters = {}) {
    let sql = `
      SELECT sl.*,
              u.full_name as supplier_name,
              sp.verification_level,
              ps.spec_code,
              ps.title as spec_title,
              ps.brand,
              ps.variety,
              ps.quality_grade,
              ps.packaging_type,
              ps.pack_size,
              ps.pack_unit,
              ps.purchasing_unit,
              ps.product_id,
              p.category as product_category
       FROM supplier_listings sl
       JOIN users u ON sl.supplier_id = u.id
       LEFT JOIN supplier_profiles sp ON u.id = sp.supplier_id
       JOIN product_specifications ps ON sl.product_spec_id = ps.id
       JOIN products p ON ps.product_id = p.id
       WHERE 1=1
    `;
    const params = [];

    // Buyer-facing active query: must be active AND in stock
    if (filters.activeOnly !== false) {
      sql += " AND sl.status = 'ACTIVE' AND sl.available_stock > 0 AND sl.available_stock >= sl.buyer_min_qty";
    } else if (filters.status) {
      sql += ' AND sl.status = ?';
      params.push(filters.status);
    }

    if (filters.supplier_id) {
      sql += ' AND sl.supplier_id = ?';
      params.push(filters.supplier_id);
    }
    if (filters.product_spec_id) {
      sql += ' AND sl.product_spec_id = ?';
      params.push(filters.product_spec_id);
    }
    if (filters.category) {
      sql += ' AND p.category = ?';
      params.push(filters.category);
    }
    if (filters.search) {
      sql += ' AND (ps.title LIKE ? OR ps.brand LIKE ? OR ps.variety LIKE ? OR u.full_name LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term, term);
    }

    sql += ' ORDER BY sl.base_unit_price ASC';

    const [rows] = await db.query(sql, params);
    return rows.map(r => ({
      ...r,
      effective_status: Number(r.available_stock) <= 0 ? 'OUT_OF_STOCK' : r.status,
      is_available_for_purchase: r.status === 'ACTIVE' && Number(r.available_stock) >= Number(r.buyer_min_qty)
    }));
  }

  // Update listing with ownership verification
  async update(id, updateData) {
    const allowed = [
      'available_stock',
      'base_unit_price',
      'pricing_unit',
      'price_per_base_unit',
      'supplier_min_qty',
      'buyer_min_qty',
      'delivery_zones',
      'delivery_fee_policy',
      'fulfilment_lead_time_days',
      'notes',
      'status'
    ];

    const sets = [];
    const params = [];

    for (const key of allowed) {
      if (updateData[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(key === 'delivery_zones' ? JSON.stringify(updateData[key]) : updateData[key]);
      }
    }

    if (sets.length === 0) return false;

    params.push(id);
    const [result] = await db.query(
      `UPDATE supplier_listings SET ${sets.join(', ')} WHERE id = ?`,
      params
    );

    return result.affectedRows > 0;
  }

  // Update listing status (e.g. ACTIVE <-> PAUSED)
  async updateStatus(id, newStatus) {
    const [result] = await db.query(
      'UPDATE supplier_listings SET status = ? WHERE id = ?',
      [newStatus, id]
    );
    return result.affectedRows > 0;
  }

  // Record price change history
  async recordPriceChange(listingId, previousPrice, newPrice, changedBy, reason = null) {
    const [result] = await db.query(
      `INSERT INTO supplier_listing_price_history (
        listing_id, previous_price, new_price, changed_by, change_reason
      ) VALUES (?, ?, ?, ?, ?)`,
      [listingId, previousPrice, newPrice, changedBy, reason]
    );
    return result.insertId;
  }

  // Fetch price history of a listing
  async getPriceHistory(listingId) {
    const [rows] = await db.query(
      `SELECT h.*, u.full_name as changed_by_name
       FROM supplier_listing_price_history h
       JOIN users u ON h.changed_by = u.id
       WHERE h.listing_id = ?
       ORDER BY h.effective_from DESC`,
      [listingId]
    );
    return rows;
  }

  // Compare multiple active verified supplier listings for an exact specification
  async compareListingsForSpec(specId, sortBy = 'price_asc') {
    let orderClause = 'sl.base_unit_price ASC';
    if (sortBy === 'price_per_kg_asc' || sortBy === 'unit_price_asc') {
      orderClause = 'sl.price_per_base_unit ASC, sl.base_unit_price ASC';
    } else if (sortBy === 'lead_time_asc') {
      orderClause = 'sl.fulfilment_lead_time_days ASC, sl.base_unit_price ASC';
    } else if (sortBy === 'stock_desc') {
      orderClause = 'sl.available_stock DESC';
    }

    const [rows] = await db.query(
      `SELECT sl.id as listing_id,
              sl.listing_code,
              sl.base_unit_price,
              sl.pricing_unit,
              sl.price_per_base_unit,
              sl.currency,
              sl.available_stock,
              sl.supplier_min_qty,
              sl.buyer_min_qty,
              sl.delivery_zones,
              sl.delivery_fee_policy,
              sl.fulfilment_lead_time_days,
              sl.status,
              u.id as supplier_id,
              u.full_name as supplier_name,
              sp.verification_level,
              sp.verification_status as supplier_verification_status,
              ps.id as spec_id,
              ps.spec_code,
              ps.title as spec_title,
              ps.brand,
              ps.variety,
              ps.quality_grade,
              ps.packaging_type,
              ps.pack_size,
              ps.pack_unit,
              ps.purchasing_unit
       FROM supplier_listings sl
       JOIN users u ON sl.supplier_id = u.id
       JOIN supplier_profiles sp ON u.id = sp.supplier_id
       JOIN product_specifications ps ON sl.product_spec_id = ps.id
       WHERE sl.product_spec_id = ?
         AND sl.status = 'ACTIVE'
         AND sl.available_stock > 0
         AND sl.available_stock >= sl.buyer_min_qty
         AND sp.verification_status = 'VERIFIED'
       ORDER BY ${orderClause}`,
      [specId]
    );

    // Map each offer with explicit unit and delivery price breakdown
    return rows.map(r => {
      const packSize = Number(r.pack_size);
      const basePrice = Number(r.base_unit_price);
      const pricePerBaseUnit = r.price_per_base_unit
        ? Number(r.price_per_base_unit)
        : (packSize > 0 ? Number((basePrice / packSize).toFixed(4)) : null);

      const isDeliveryIncluded = r.delivery_fee_policy === 'INCLUDED_IN_PRICE';

      return {
        listing_id: r.listing_id,
        listing_code: r.listing_code,
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        verification_level: r.verification_level,
        supplier_verification_status: r.supplier_verification_status,
        pricing: {
          currency: r.currency,
          base_price_per_pack: basePrice.toFixed(2),
          pricing_unit: r.pricing_unit || r.purchasing_unit || 'pack',
          price_per_base_unit: pricePerBaseUnit ? pricePerBaseUnit.toFixed(4) : null,
          base_unit: r.pack_unit,
          pack_size: packSize,
          pack_unit: r.pack_unit
        },
        stock: {
          available_packs: Number(r.available_stock),
          available_base_units: Number((Number(r.available_stock) * packSize).toFixed(2)),
          supplier_min_qty: Number(r.supplier_min_qty),
          buyer_min_qty: Number(r.buyer_min_qty)
        },
        delivery: {
          delivery_zones: typeof r.delivery_zones === 'string' ? JSON.parse(r.delivery_zones) : r.delivery_zones,
          delivery_fee_policy: r.delivery_fee_policy,
          fulfilment_lead_time_days: r.fulfilment_lead_time_days,
          is_delivery_included: isDeliveryIncluded,
          delivered_unit_price: isDeliveryIncluded ? basePrice.toFixed(2) : null,
          delivered_price_per_base_unit: (isDeliveryIncluded && pricePerBaseUnit) ? pricePerBaseUnit.toFixed(4) : null,
          delivery_explanation: isDeliveryIncluded
            ? 'Delivery included in base price'
            : (r.delivery_fee_policy === 'FLAT_500_PER_DELIVERY'
              ? 'Flat Rs. 500 delivery fee applies per trip/order. Not divided into unit price.'
              : 'Delivery fee applies per order/drop based on policy and volume.')
        }
      };
    });
  }
}

module.exports = new SupplierListingRepository();
