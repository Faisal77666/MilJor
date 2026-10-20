const db = require('../config/db');

class ProductRepository {
  // Create New Product Specification
  async create(productData) {
    const {
      title,
      category,
      brand,
      variety,
      processing_type,
      grade,
      pack_size,
      unit
    } = productData;

    const [result] = await db.query(
      `INSERT INTO products 
      (title, category, brand, variety, processing_type, grade, pack_size, unit) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        category,
        brand,
        variety,
        processing_type,
        grade,
        pack_size,
        unit || 'kg'
      ]
    );

    return result.insertId;
  }

  // Get All Active Products with Filtering & Search
  async findAll(filters = {}) {
    let sql = 'SELECT * FROM products WHERE is_active = TRUE';
    const params = [];

    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.brand) {
      sql += ' AND brand = ?';
      params.push(filters.brand);
    }

    if (filters.search) {
      sql += ' AND (title LIKE ? OR variety LIKE ? OR brand LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    sql += ' ORDER BY id DESC';

    const [rows] = await db.query(sql, params);
    return rows;
  }

  // Find Product By ID
  async findById(id) {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [id]);
    return rows[0];
  }
}

module.exports = new ProductRepository();