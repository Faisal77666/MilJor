// =============================================================================
// src/repositories/productSpecificationRepo.js
// MilJor Product Specification Repository
// =============================================================================
const db = require('../config/db');

class ProductSpecificationRepository {
  // Find specification by exact hash for deduplication
  async findByHash(specHash) {
    const [rows] = await db.query(
      'SELECT * FROM product_specifications WHERE spec_hash = ?',
      [specHash]
    );
    return rows[0] || null;
  }

  // Find specification by ID with base product details
  async findById(id) {
    const [rows] = await db.query(
      `SELECT ps.*, 
              p.title as base_product_title, 
              p.category as product_category
       FROM product_specifications ps
       JOIN products p ON ps.product_id = p.id
       WHERE ps.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  // Find specification by spec_code
  async findByCode(specCode) {
    const [rows] = await db.query(
      `SELECT ps.*, 
              p.title as base_product_title, 
              p.category as product_category
       FROM product_specifications ps
       JOIN products p ON ps.product_id = p.id
       WHERE ps.spec_code = ?`,
      [specCode]
    );
    return rows[0] || null;
  }

  // Create new exact specification
  async create(specData) {
    const {
      product_id,
      spec_code,
      title,
      brand,
      variety,
      crop_year,
      processing_method,
      quality_grade,
      packaging_type,
      pack_size,
      pack_unit,
      purchasing_unit,
      storage_requirements,
      shelf_life_days,
      spec_attributes,
      spec_hash
    } = specData;

    const [result] = await db.query(
      `INSERT INTO product_specifications (
        product_id, spec_code, title, brand, variety, crop_year,
        processing_method, quality_grade, packaging_type, pack_size,
        pack_unit, purchasing_unit, storage_requirements, shelf_life_days,
        spec_attributes, spec_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product_id,
        spec_code,
        title,
        brand,
        variety,
        crop_year || null,
        processing_method,
        quality_grade,
        packaging_type,
        pack_size,
        pack_unit,
        purchasing_unit || 'bag',
        storage_requirements || null,
        shelf_life_days || null,
        spec_attributes ? JSON.stringify(spec_attributes) : null,
        spec_hash
      ]
    );

    return result.insertId;
  }

  // Search & filter specifications
  async findAll(filters = {}) {
    let sql = `
      SELECT ps.*, 
             p.title as base_product_title, 
             p.category as product_category
      FROM product_specifications ps
      JOIN products p ON ps.product_id = p.id
      WHERE ps.is_active = 1
    `;
    const params = [];

    if (filters.category) {
      sql += ' AND p.category = ?';
      params.push(filters.category);
    }
    if (filters.brand) {
      sql += ' AND ps.brand = ?';
      params.push(filters.brand);
    }
    if (filters.variety) {
      sql += ' AND ps.variety = ?';
      params.push(filters.variety);
    }
    if (filters.quality_grade) {
      sql += ' AND ps.quality_grade = ?';
      params.push(filters.quality_grade);
    }
    if (filters.pack_size) {
      sql += ' AND ps.pack_size = ?';
      params.push(filters.pack_size);
    }
    if (filters.pack_unit) {
      sql += ' AND ps.pack_unit = ?';
      params.push(filters.pack_unit);
    }
    if (filters.product_id) {
      sql += ' AND ps.product_id = ?';
      params.push(filters.product_id);
    }
    if (filters.search) {
      sql += ' AND (ps.title LIKE ? OR ps.brand LIKE ? OR ps.variety LIKE ? OR ps.quality_grade LIKE ? OR p.category LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term);
    }

    sql += ' ORDER BY ps.id ASC';

    const [rows] = await db.query(sql, params);
    return rows;
  }
}

module.exports = new ProductSpecificationRepository();
