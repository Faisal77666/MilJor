-- =============================================================================
-- Migration 005: Catalog Integrity, Pool Specification Linkage & Canonical Hashes
-- =============================================================================

-- 1. Safely add product_spec_id to pools if not present
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'product_spec_id'
);

SET @sql_add_col = IF(@col_exists = 0,
  'ALTER TABLE pools ADD COLUMN product_spec_id INT NULL, ADD CONSTRAINT fk_pools_product_spec FOREIGN KEY (product_spec_id) REFERENCES product_specifications(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql_add_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Add pricing_unit and price_per_base_unit to supplier_listings if not present
SET @col_pricing_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_listings' AND COLUMN_NAME = 'price_per_base_unit'
);

SET @sql_add_pricing = IF(@col_pricing_exists = 0,
  'ALTER TABLE supplier_listings ADD COLUMN pricing_unit VARCHAR(30) NOT NULL DEFAULT \'pack\' AFTER base_unit_price, ADD COLUMN price_per_base_unit DECIMAL(12,4) NULL AFTER pricing_unit',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql_add_pricing;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- 3. Update seeded specifications with canonical hashes incorporating packaging_type, purchasing_unit, and normalized attributes
UPDATE product_specifications SET spec_hash = '3da0d1e51d30bb63f3153c65e00bd2622ae8e06d1243be86cc3d1963c0acef6f' WHERE id = 1;
UPDATE product_specifications SET spec_hash = '20f8728bed6dbf1302b06eedff9f4a9700577160288357b5d70b240ffcdeed10' WHERE id = 2;
UPDATE product_specifications SET spec_hash = 'e839bce272d4c28db3a273d4a2496224dfd5bbca8cf8a28ebba2b8e9ce3da44c' WHERE id = 3;
UPDATE product_specifications SET spec_hash = 'a847c1bbf264f4a19e8430b293bc530fc71d677a6a7472f9406f23715d35e837' WHERE id = 4;
UPDATE product_specifications SET spec_hash = '99cd5816185b7156f9498c3540e58d75aff8c944ce1d12a02641a8ac0d4f999d' WHERE id = 5;
UPDATE product_specifications SET spec_hash = '9e1a0549839dc73e9e50e30fbac07530b7d7cb3d23aa48576482d0e010814da6' WHERE id = 6;
UPDATE product_specifications SET spec_hash = '79af3c6c27f638c12d86660331ea2dc19cdc7232bf78be489b6816f5e3a5d7f8' WHERE id = 7;
UPDATE product_specifications SET spec_hash = '490f151aa89bb54f32811093e89eb45892b08ca0b23b2023d419affb2166ee92' WHERE id = 8;

-- 4. Calculate price_per_base_unit for seeded listings
UPDATE supplier_listings SET pricing_unit = 'bag', price_per_base_unit = 192.0000 WHERE id = 1;
UPDATE supplier_listings SET pricing_unit = 'bag', price_per_base_unit = 190.0000 WHERE id = 2;
UPDATE supplier_listings SET pricing_unit = 'tin', price_per_base_unit = 450.0000 WHERE id = 3;
