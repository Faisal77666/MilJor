-- =============================================================================
-- Migration 004: Exact Product Specifications & Supplier Listings Engine
-- =============================================================================

-- 1. Ensure representative base products exist in products table
INSERT INTO products (id, title, category, brand, variety, processing_type, grade, pack_size, unit, is_active)
VALUES
  (6, 'Non-Basmati Rice', 'Grains & Rice', 'Chenab Mills', 'PK-386', 'Well Milled', 'Restaurant Grade', '25kg Bag', 'kg', 1),
  (7, 'Commercial Cooking Oil', 'Oils & Fats', 'Dalda Commercial', 'Palm Olein Blend', 'Refined & Bleached', 'Grade 2 Commercial', '16L Tin', 'L', 1),
  (8, 'Chana Dal', 'Pulses & Legumes', 'National Pulses', 'Desi Chana Dal', 'Polished & Cleaned', 'Grade A Bold', '25kg Bag', 'kg', 1)
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- 2. Create product_specifications table
CREATE TABLE IF NOT EXISTS product_specifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  spec_code VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(200) NOT NULL,
  brand VARCHAR(100) NOT NULL,
  variety VARCHAR(100) NOT NULL,
  crop_year VARCHAR(30) NULL,
  processing_method VARCHAR(100) NOT NULL,
  quality_grade VARCHAR(50) NOT NULL,
  packaging_type VARCHAR(50) NOT NULL,
  pack_size DECIMAL(10,2) NOT NULL,
  pack_unit VARCHAR(20) NOT NULL,
  purchasing_unit VARCHAR(30) NOT NULL DEFAULT 'bag',
  storage_requirements VARCHAR(150) NULL,
  shelf_life_days INT NULL,
  spec_attributes JSON NULL,
  spec_hash VARCHAR(64) UNIQUE NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_spec_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Create supplier_listings table
CREATE TABLE IF NOT EXISTS supplier_listings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  listing_code VARCHAR(50) UNIQUE NOT NULL,
  supplier_id INT NOT NULL,
  product_spec_id INT NOT NULL,
  available_stock DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  base_unit_price DECIMAL(12,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'PKR',
  supplier_min_qty DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  buyer_min_qty DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  delivery_zones JSON NOT NULL,
  delivery_fee_policy VARCHAR(255) NOT NULL DEFAULT 'INCLUDED_IN_PRICE',
  fulfilment_lead_time_days INT NOT NULL DEFAULT 2,
  status ENUM('ACTIVE', 'PAUSED', 'OUT_OF_STOCK', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_listing_supplier FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_listing_spec FOREIGN KEY (product_spec_id) REFERENCES product_specifications(id) ON DELETE RESTRICT,
  UNIQUE KEY uniq_supplier_spec (supplier_id, product_spec_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Create supplier_listing_price_history table
CREATE TABLE IF NOT EXISTS supplier_listing_price_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  listing_id INT NOT NULL,
  previous_price DECIMAL(12,2) NOT NULL,
  new_price DECIMAL(12,2) NOT NULL,
  changed_by INT NOT NULL,
  change_reason VARCHAR(255) NULL,
  effective_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_price_hist_listing FOREIGN KEY (listing_id) REFERENCES supplier_listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_price_hist_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Seed representative normalized specifications (Specifications 1 to 8)
INSERT INTO product_specifications (
  id, product_id, spec_code, title, brand, variety, crop_year, processing_method,
  quality_grade, packaging_type, pack_size, pack_unit, purchasing_unit,
  storage_requirements, shelf_life_days, spec_attributes, spec_hash
) VALUES
  (1, 1, 'SPEC-RICE-SB-001', 'Super Kernel Basmati Old Crop Sella, Export Grade A, 25kg', 'Super Kernel Mills', 'Super Kernel Basmati', 'Old Crop', 'Sella (Parboiled)', 'Export Grade A', 'PP Bag', 25.00, 'kg', 'bag', 'Dry, well-ventilated warehouse', 730, '{"moisture_percent": 11.5, "average_grain_length_mm": 7.4, "broken_percent": 1.0, "purity_percent": 98.0}', 'c37010c6f4e1e6a90b274290494ef87cb2c2c2791b7b895d2a49c7c8a4c99a05'),
  (2, 1, 'SPEC-RICE-SS-002', 'Super Kernel Steam New Crop, Grade A, 25kg', 'Guard / Mughal', 'Super Kernel', 'New Crop', 'Steam', 'Grade A', 'PP Bag', 25.00, 'kg', 'bag', 'Dry, well-ventilated warehouse', 365, '{"moisture_percent": 12.0, "average_grain_length_mm": 7.2, "broken_percent": 2.0, "purity_percent": 95.0}', '2389750ed54be257e7e10c23d40435b9bcd890ae828c9625af1123fe98aa3992'),
  (3, 1, 'SPEC-RICE-KS-003', 'Kainat 1121 Steam, Premium, 25kg', 'Kainat Mills', '1121 Extra Long', 'Current Crop', 'Steam', 'Premium', 'PP Bag', 25.00, 'kg', 'bag', 'Dry warehouse away from pests', 540, '{"moisture_percent": 11.0, "average_grain_length_mm": 8.3, "broken_percent": 0.5, "purity_percent": 99.0}', '13013f42309b0faf8e1fd2c759677e4467d6d06c1f3ea83a4ab6b93b15dfd6b3'),
  (4, 6, 'SPEC-RICE-PK-004', 'PK-386 Non-Basmati, Restaurant Grade, 25kg', 'Chenab Mills', 'PK-386', 'Standard Crop', 'Well Milled', 'Restaurant Grade', 'PP Bag', 25.00, 'kg', 'bag', 'Standard dry storage', 365, '{"moisture_percent": 13.0, "average_grain_length_mm": 6.8, "broken_percent": 5.0, "purity_percent": 92.0}', 'f67a20487128c2ace9a2bc8b190ced5c230a08a5761d19ff60c15d27e47fcc0b'),
  (5, 7, 'SPEC-OIL-CO-005', 'Commercial Cooking Oil, Grade 2, 16L', 'Dalda Commercial', 'Palm Olein Blend', NULL, 'Refined & Bleached', 'Grade 2 Commercial', 'Tin', 16.00, 'L', 'tin', 'Store at 15-25°C, avoid direct sunlight', 365, '{"free_fatty_acids_percent": 0.15, "peroxide_value": 2.0, "smoke_point_celsius": 215}', '8b481fc28985878c569c4ddce73e1bfe7e83485caf3331a741f959f159fc7b41'),
  (6, 2, 'SPEC-FLOUR-CF-006', 'Chakki Flour, 20kg', 'Sunridge Mills', 'Desi Wheat', 'Current Season', 'Stone Ground (Chakki)', 'Grade A Whole Wheat', 'Cotton/PP Bag', 20.00, 'kg', 'bag', 'Cool, well-aerated dry store', 45, '{"extraction_rate_percent": 95.0, "moisture_percent": 12.5, "ash_percent": 1.4, "gluten_percent": 9.5}', '6a6165f19f403baf0840a22b290119ccf77eae9b28aec1f918c1271728571220'),
  (7, 4, 'SPEC-SUGAR-WS-007', 'Sugar, 50kg', 'JDW Sugar', 'Refined Cane Sugar', 'Current Crushing Season', 'Refined Crystal', 'ICUMSA 45 Food Grade', 'HDPE Lined PP Bag', 50.00, 'kg', 'bag', 'Dry environment humidity <65%', 730, '{"polarization_degree": 99.8, "moisture_percent": 0.04, "color_icumsa": 45}', 'ae0d5532eaeb094dfcb972aaaf5e78448680068dd9a8c4bd09d05bbb8f96974b'),
  (8, 8, 'SPEC-PULSE-CD-008', 'Chana Dal, 25kg', 'National Pulses', 'Desi Chana Dal', 'Current Season', 'Polished & Cleaned', 'Grade A Bold', 'Jute/PP Bag', 25.00, 'kg', 'bag', 'Moisture-free cool warehouse', 365, '{"foreign_matter_percent": 0.1, "weevilled_percent": 0.0, "moisture_percent": 10.0}', '146ac2935e3aeae1e56dc3d6b928e6934816be83ff72392975078c28dea65464')
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- 6. Seed initial verified supplier listings for multi-supplier comparison
INSERT INTO supplier_listings (
  id, listing_code, supplier_id, product_spec_id, available_stock, base_unit_price,
  currency, supplier_min_qty, buyer_min_qty, delivery_zones, delivery_fee_policy,
  fulfilment_lead_time_days, status, notes
) VALUES
  (1, 'LST-2026-0001', 2, 1, 500.00, 4800.00, 'PKR', 20.00, 1.00, '["Gulberg", "Model Town", "DHA Lahore", "Allama Iqbal Town"]', 'INCLUDED_IN_PRICE', 1, 'ACTIVE', 'Direct from Akbari Mandi wholesale warehouse'),
  (2, 'LST-2026-0002', 3, 1, 300.00, 4750.00, 'PKR', 10.00, 1.00, '["Badami Bagh", "Ravi Zone", "Shalimar", "Gulberg"]', 'FLAT_500_PER_DELIVERY', 2, 'ACTIVE', 'Export quality aged rice. Bulk orders preferred.'),
  (3, 'LST-2026-0003', 2, 5, 200.00, 7200.00, 'PKR', 5.00, 1.00, '["All Lahore"]', 'FREE_ABOVE_10_TINS', 1, 'ACTIVE', 'Commercial cooking oil 16L tin')
ON DUPLICATE KEY UPDATE base_unit_price = VALUES(base_unit_price);
