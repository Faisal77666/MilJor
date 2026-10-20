const productRepo = require('../repositories/productRepo');

class ProductController {
  // 1. Create Product Spec (Admin / Supplier Only)
  async createProduct(req, res) {
    try {
      const {
        title,
        category,
        brand,
        variety,
        processing_type,
        grade,
        pack_size,
        unit
      } = req.body;

      if (!title || !category || !brand || !variety || !processing_type || !grade || !pack_size) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'All product specification fields (title, category, brand, variety, processing_type, grade, pack_size) are required'
          }
        });
      }

      const productId = await productRepo.create({
        title,
        category,
        brand,
        variety,
        processing_type,
        grade,
        pack_size,
        unit
      });

      const product = await productRepo.findById(productId);

      res.status(201).json({
        success: true,
        message: 'Product specification created successfully',
        data: { product }
      });
    } catch (error) {
      console.error('Create Product Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 2. Get All Products (Catalog View with Search & Filters)
  async getAllProducts(req, res) {
    try {
      const { category, brand, search } = req.query;
      const products = await productRepo.findAll({ category, brand, search });

      res.status(200).json({
        success: true,
        count: products.length,
        data: { products }
      });
    } catch (error) {
      console.error('Get Products Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 3. Get Single Product Details
  async getProductById(req, res) {
    try {
      const { id } = req.params;
      const product = await productRepo.findById(id);

      if (!product) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Product not found' }
        });
      }

      res.status(200).json({
        success: true,
        data: { product }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }
}

module.exports = new ProductController();