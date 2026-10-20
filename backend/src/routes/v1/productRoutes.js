const express = require('express');
const router = express.Router();
const productController = require('../../controllers/productController');
const { protect, authorize } = require('../../middlewares/authGuard');

// Public Routes (Buyers & Visitors can view catalog)
router.get('/', productController.getAllProducts);
router.get('/:id', productController.getProductById);

// Protected Routes (Only SUPPLIER and ADMIN can add products)
router.post(
  '/',
  protect,
  authorize('SUPPLIER', 'ADMIN'),
  productController.createProduct
);

module.exports = router;