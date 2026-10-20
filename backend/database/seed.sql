-- =============================================================================
-- MILJOR B2B MARKETPLACE — REALISTIC DEVELOPMENT SEED DATA
-- Run AFTER schema.sql
-- FK-safe order: users → products → supplier_profiles → buyer_fee_slabs → pools → pool_price_tiers
-- =============================================================================

USE miljor_db;

-- =============================================================================
-- 1. USERS — Admin, Suppliers, Buyers
-- Passwords: all set to 'Password123' — bcrypt hash (10 rounds)
-- Hash: $2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi (Password123)
-- =============================================================================
INSERT INTO users (id, full_name, business_name, email, phone, password_hash, role, business_type, city, area, address, is_verified, verification_status) VALUES
-- Admin
(1, 'MilJor Admin', 'MilJor Platform', 'admin@miljor.com', '03001000001',
 '$2b$10$f/vhLemgJ1uojnBOy8ESxegz4A..5ApdA1XpDVm2b/lJkfU5ZUFvy',
 'SUPER_ADMIN', 'Platform', 'Lahore', 'Gulberg', 'Gulberg III, Lahore', 1, 'VERIFIED'),

-- Suppliers
(2, 'Tariq Mehmood', 'Lahore Rice Traders', 'supplier1@miljor.com', '03001000002',
 '$2b$10$f/vhLemgJ1uojnBOy8ESxegz4A..5ApdA1XpDVm2b/lJkfU5ZUFvy',
 'SUPPLIER', 'Wholesale', 'Lahore', 'Akbari Mandi', 'Shop 14, Akbari Mandi, Lahore', 1, 'VERIFIED'),

(3, 'Abdul Razzaq', 'Punjab Food Distributors', 'supplier2@miljor.com', '03001000003',
 '$2b$10$f/vhLemgJ1uojnBOy8ESxegz4A..5ApdA1XpDVm2b/lJkfU5ZUFvy',
 'SUPPLIER', 'Wholesale', 'Lahore', 'Badami Bagh', 'Warehouse Block B, Badami Bagh, Lahore', 1, 'VERIFIED'),

(4, 'Imran Butt', 'Central Wholesale Foods', 'supplier3@miljor.com', '03001000004',
 '$2b$10$f/vhLemgJ1uojnBOy8ESxegz4A..5ApdA1XpDVm2b/lJkfU5ZUFvy',
 'SUPPLIER', 'Wholesale', 'Lahore', 'Shahdara', 'Main GT Road, Shahdara, Lahore', 0, 'PENDING_SUPPLIER_VERIFICATION'),

-- Buyers
(5, 'Asif Khan', 'Lahore Fresh Bites', 'buyer1@miljor.com', '03001000005',
 '$2b$10$f/vhLemgJ1uojnBOy8ESxegz4A..5ApdA1XpDVm2b/lJkfU5ZUFvy',
 'BUYER', 'Restaurant', 'Lahore', 'Model Town', 'House 12, Block C, Model Town, Lahore', 0, 'UNVERIFIED'),

(6, 'Sara Malik', 'Model Town Cafe', 'buyer2@miljor.com', '03001000006',
 '$2b$10$f/vhLemgJ1uojnBOy8ESxegz4A..5ApdA1XpDVm2b/lJkfU5ZUFvy',
 'BUYER', 'Cafe', 'Lahore', 'Model Town', '45 B3 Model Town, Lahore', 0, 'UNVERIFIED'),

(7, 'Waqas Aziz', 'Johar Catering Services', 'buyer3@miljor.com', '03001000007',
 '$2b$10$f/vhLemgJ1uojnBOy8ESxegz4A..5ApdA1XpDVm2b/lJkfU5ZUFvy',
 'BUYER', 'Catering', 'Lahore', 'Johar Town', 'Plot 22, Johar Town, Lahore', 0, 'UNVERIFIED');

-- =============================================================================
-- 2. PRODUCTS
-- =============================================================================
INSERT INTO products (id, title, category, brand, variety, processing_type, grade, pack_size, unit) VALUES
(1, 'Basmati Rice Premium', 'Grains & Rice', 'Akbari Brand', '1121 Extra Long Grain', 'Double Polished', 'Grade A', '50kg Bag', 'kg'),
(2, 'Chakki Atta Wheat Flour', 'Flour & Grain', 'Akbari Mills', 'Whole Wheat Chakki', 'Stone Ground', 'Grade A', '10kg Bag', 'kg'),
(3, 'Canola Cooking Oil', 'Oils & Fats', 'Sufi', 'Pure Canola', 'Refined', 'Food Grade', '16L Tin', 'litre'),
(4, 'Refined White Sugar', 'Sugar & Sweeteners', 'JDW Sugar', 'ICUMSA 45', 'Refined Crystal', 'Premium', '50kg Bag', 'kg'),
(5, 'Masoor Dal Red Lentil', 'Pulses & Legumes', 'National Brand', 'Split Red Lentil', 'Dehusked & Split', 'Grade A', '25kg Bag', 'kg');

-- =============================================================================
-- 3. SUPPLIER PROFILES
-- =============================================================================
INSERT INTO supplier_profiles (supplier_id, verification_level, verification_status, subscription_plan, max_active_listings, transaction_fee_percent) VALUES
(2, 'LEVEL_3_QUALITY', 'VERIFIED', 'BUSINESS', 75, 1.00),
(3, 'LEVEL_2_BUSINESS', 'VERIFIED', 'GROWTH', 25, 1.50),
(4, 'LEVEL_1_CONTACT', 'PENDING_REVIEW', 'STARTER', 5, 2.50);

-- =============================================================================
-- 4. BUYER FEE SLABS (Configurable)
-- =============================================================================
INSERT INTO buyer_fee_slabs (min_order_amount, max_order_amount, fee_percentage) VALUES
(1000.00,    5000.00,      1.50),
(5001.00,    15000.00,     1.00),
(15001.00,   50000.00,     0.75),
(50001.00,   100000.00,    0.50),
(100001.00,  99999999.00,  0.35);

-- =============================================================================
-- 5. POOLS (Active — with future expiry)
-- =============================================================================
INSERT INTO pools (id, pool_code, supplier_id, product_id, current_qty, target_qty, supplier_min_qty, buyer_min_qty, current_price_per_unit, next_tier_price, platform_fee_percent, quality_spec_grade, status, expires_at) VALUES
(1, 'MJ-POOL-0001', 2, 1, 0, 500, 100, 25,
 5200.00, 4900.00, 2.50, 'Grade A — 1121 Extra Long, Double Polished',
 'ACTIVE', DATE_ADD(NOW(), INTERVAL 7 DAY)),
(2, 'MJ-POOL-0002', 3, 2, 0, 1000, 200, 50,
 1150.00, 1050.00, 2.50, 'Grade A — Chakki Atta, Stone Ground',
 'ACTIVE', DATE_ADD(NOW(), INTERVAL 5 DAY));

-- =============================================================================
-- 6. POOL PRICE TIERS
-- Pool 1 — Basmati Rice (3 tiers)
-- Pool 2 — Wheat Flour (2 tiers)
-- =============================================================================
INSERT INTO pool_price_tiers (pool_id, min_qty, max_qty, price_per_unit) VALUES
-- Pool 1: Basmati Rice
(1, 1,   150,  5200.00),
(1, 151, 300,  4900.00),
(1, 301, 99999, 4600.00),
-- Pool 2: Wheat Flour
(2, 1,   500,  1150.00),
(2, 501, 99999, 1050.00);
