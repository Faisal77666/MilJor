# MilJor Backend — Verified Database Inventory

**Date of Audit:** October 18, 2026  
**Target Schema:** `miljor_db` on MySQL 8.x  
**Financial Type Standard:** `DECIMAL(12,2)`

---

## 1. Catalog Summary & Entity Status

## 1. Catalog Summary & Entity Status

The live database currently contains **23 business/system tables** (+ `schema_migrations`).

| # | Table Name | Live Rows | Status / Architectural Role | Foreign Keys | API Backed? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `users` | 7 | Core identity & RBAC (Admin, Suppliers, Buyers) | None | **YES** |
| 2 | `supplier_profiles` | 3 | Tiered subscription (Starter/Growth/Business) & KYC levels | `supplier_id` → `users(id)` | **YES** (Admin verify & Apply) |
| 3 | `products` | 8 | Master base commodities catalog | None | **YES** |
| 4 | `product_specifications` | 8 | Normalized exact physical commodity specifications | `product_id` → `products(id)` | **YES** (Catalog & Compare) |
| 5 | `supplier_listings` | 3 | Decoupled verified supplier offers tied to exact specs | `supplier_id` → `users`, `product_spec_id` → `product_specifications` | **YES** (Supplier Offers & Comparison) |
| 6 | `supplier_listing_price_history` | 0 | Audit trail for supplier listing price adjustments | `listing_id` → `supplier_listings`, `changed_by` → `users` | **YES** |
| 7 | `supplier_inventory_allocations` | 0 | Safe stock allocation ledger across pools, flash offers, and direct orders | `supplier_listing_id` → `supplier_listings(id)` | **YES** (Migration 006) |
| 8 | `buyer_fee_slabs` | 5 | Configurable buyer commission slabs (Rs. 30–300 cap) | None | **YES** (Via Service) |
| 9 | `pools` | 2 | Group buying pools with exact decimal quantities & capacity caps | `supplier_id`, `product_id`, `product_spec_id`, `supplier_listing_id` | **YES** |
| 10 | `pool_price_tiers` | 5 | Quantity break tiers for pools with pricing units and DECIMAL(12,4) precision | `pool_id` → `pools(id)` | **YES** |
| 11 | `reservations` | 0 | Buyer commitments with `locked_unit_price` and `payment_deadline_at` | `pool_id` → `pools`, `buyer_id` → `users` | **YES** |
| 12 | `reservation_mutation_history` | 0 | Immutable ledger of reservation quantity changes & cancellations | `reservation_id`, `pool_id`, `buyer_id` | **YES** (Migration 011) |
| 13 | `reservation_business_events` | 0 | Transactional outbox for reservation & pool domain events | `pool_id`, `reservation_id`, `actor_id` | **YES** (Migration 012) |
| 14 | `orders` | 0 | Converted orders with delivery options | `buyer_id`, `supplier_id`, `reservation_id`, `pool_id` | **NO API MOUNTED** |
| 15 | `payments` | 0 | Single authoritative payments table with escrow status | `buyer_id`, `reservation_id`, `order_id` | **YES** |
| 16 | `platform_ledger` | 0 | Fee distribution records: Gross, Platform Fee, Supplier Net | `payment_id` → `payments(id)` | **YES** |
| 17 | `order_disputes` | 0 | Buyer disputes with escrow freeze and arbitration | `reservation_id`, `order_id`, `buyer_id`, `resolved_by` | **YES** |
| 18 | `flash_pools` | 0 | Clearance inventory batch deals | `supplier_id`, `product_id` | **NO API MOUNTED** |
| 19 | `rfqs` | 0 | Private custom requests for quote | `buyer_id` → `users(id)` | **NO API MOUNTED** |
| 20 | `rfq_quotes` | 0 | Versioned supplier quote bids | `rfq_id` → `rfqs`, `supplier_id` → `users` | **NO API MOUNTED** |
| 21 | `recurring_contracts` | 0 | Scheduled procurement with price-hike guards | `buyer_id`, `supplier_id`, `product_id` | **NO API MOUNTED** |
| 22 | `idempotency_records` | 0 | Request de-duplication cache | None | **YES** (Middleware) |
| 23 | `system_audit_logs` | 0 | Immutable append-only audit trail | None | **YES** |
| 24 | `schema_migrations` | 12 | Tracks applied migration versions (001–012) | None | **SYSTEM** |

*Note on Deprecated Tables:* `escrow_payments` was completely removed from the database during Phase 1 migration. Verified absent via MySQL `information_schema`.

---

## 2. Table-by-Table Architectural Inspection

### 2.1 `users` (7 Rows)
- **Primary Key:** `id INT AUTO_INCREMENT`
- **Columns:** `full_name`, `business_name`, `email` (UNIQUE), `phone` (UNIQUE), `password_hash`, `google_id` (UNIQUE), `role` (`ENUM('BUYER', 'SUPPLIER', 'ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'SUPPORT_ADMIN')`), `business_type`, `city`, `area`, `address`, `is_verified` (`TINYINT(1)` DEFAULT `0`), `verification_status` (`ENUM('UNVERIFIED', 'EMAIL_OTP_SENT', 'PHONE_OTP_SENT', 'EMAIL_VERIFIED', 'PHONE_VERIFIED', 'PENDING_SUPPLIER_VERIFICATION', 'VERIFIED', 'BLOCKED')` DEFAULT `'UNVERIFIED'`), `buyer_trust_status`, `created_at`, `updated_at`.
- **Integrity Constraints:** `chk_users_contact` ensures at least one of email, phone, or google_id is present.
- **Seeded Records:**
  - ID 1: `admin@miljor.com` (`SUPER_ADMIN`, `is_verified=1`, `VERIFIED`)
  - ID 2: `supplier1@miljor.com` (Tariq Mehmood, `SUPPLIER`, Akbari Mandi, `VERIFIED`)
  - ID 3: `supplier2@miljor.com` (Abdul Razzaq, `SUPPLIER`, Badami Bagh, `VERIFIED`)
  - ID 4: `supplier3@miljor.com` (Imran Butt, `SUPPLIER`, Shahdara, `PENDING_SUPPLIER_VERIFICATION`)
  - ID 5: `buyer1@miljor.com` (Asif Khan, `BUYER`, Model Town, `UNVERIFIED`)
  - ID 6: `buyer2@miljor.com` (Sara Malik, `BUYER`, Model Town Cafe, `UNVERIFIED`)
  - ID 7: `buyer3@miljor.com` (Waqas Aziz, `BUYER`, Johar Catering, `UNVERIFIED`)

### 2.2 `supplier_profiles` (3 Rows)
- **Foreign Keys:** `supplier_id` → `users(id)` ON DELETE CASCADE (UNIQUE constraint).
- **Columns:** `verification_level` (`LEVEL_1_CONTACT`, `LEVEL_2_BUSINESS`, `LEVEL_3_QUALITY`), `verification_status`, `subscription_plan` (`STARTER`, `GROWTH`, `BUSINESS`), `max_active_listings`, `transaction_fee_percent` (`DECIMAL(5,2)`), `tax_ntn`, `food_license_no`.
- **Seeded Records:** Level 3 Business (1.0% fee), Level 2 Growth (1.5% fee), Level 1 Starter (2.5% fee).

### 2.3 `products` (5 Rows)
- **Columns:** `title`, `category`, `brand`, `variety`, `processing_type`, `grade`, `pack_size`, `unit`, `is_active`.
- **Seeded Records:**
  - ID 1: Basmati Rice Premium (1121 Extra Long, 50kg Bag)
  - ID 2: Chakki Atta Wheat Flour (Stone Ground, 10kg Bag)
  - ID 3: Canola Cooking Oil (Sufi, 16L Tin)
  - ID 4: Refined White Sugar (JDW, 50kg Bag)
  - ID 5: Masoor Dal Red Lentil (National, 25kg Bag)

### 2.4 `buyer_fee_slabs` (5 Rows)
- **Columns:** `min_order_amount DECIMAL(12,2)`, `max_order_amount DECIMAL(12,2)`, `fee_percentage DECIMAL(5,2)`.
- **Configured Slabs:**
  - Rs. 1,000 – 5,000: 1.50%
  - Rs. 5,001 – 15,000: 1.00%
  - Rs. 15,001 – 50,000: 0.75%
  - Rs. 50,001 – 100,000: 0.50%
  - Rs. 100,001+: 0.35%

### 2.5 `pools` (2 Rows) & `pool_price_tiers` (5 Rows)
- **Foreign Keys:** `supplier_id` → `users(id)`, `product_id` → `products(id)`, `product_spec_id` → `product_specifications(id)`, `supplier_listing_id` → `supplier_listings(id)`.
- **Columns (Updated in Migrations 006 & 007):**
  - Identity & Linkage: `product_id`, `product_spec_id`, `supplier_listing_id`.
  - Precision Quantities: `target_qty DECIMAL(12,4)`, `supplier_min_qty DECIMAL(12,4)`, `buyer_min_qty DECIMAL(12,4)`, `max_capacity DECIMAL(12,4) NULL`.
  - Packaging & Units: `pool_unit VARCHAR(30)`, `purchase_increment DECIMAL(10,4)`.
  - Delivery Terms: `delivery_type ENUM('DOORSTEP', 'GROUPED_CLUSTER', 'SUPPLIER_PICKUP')`, `delivery_zones JSON NULL`, `delivery_fee_policy VARCHAR(100)`, `fulfilment_lead_time_days INT`, `cancellation_cutoff_hours INT`.
  - Lifecycle Deadlines: `expires_at`, `early_close_allowed TINYINT(1)`, `supplier_confirmation_deadline TIMESTAMP NULL`, `buyer_commitment_deadline TIMESTAMP NULL`.
- **Lifecycle Enums:** `DRAFT`, `ACTIVE`, `TARGET_REACHED`, `AWAITING_SUPPLIER_CONFIRMATION`, `CONFIRMED`, `PAYMENT_PENDING`, `FULFILLING`, `DISPATCHED`, `DELIVERED`, `COMPLETED`, `CANCELLED`, `FAILED`, `EXPIRED`, `SUPPLIER_FAILED`.
- **Seeded Pools:**
  - ID 1: Basmati Rice (Target 500kg, Supplier Min 100kg, Buyer Min 25kg, Base Price Rs 5,200). 3 price tiers: Rs 5,200 (1–150kg), Rs 4,900 (151–300kg), Rs 4,600 (301+kg).
  - ID 2: Chakki Atta (Target 1,000kg, Supplier Min 200kg, Buyer Min 50kg, Base Price Rs 1,150). 2 price tiers: Rs 1,150 (1–500kg), Rs 1,050 (501+kg).

### 2.6 `reservations` (0 Rows)
- **Key Columns:** `unit_price DECIMAL(12,2)` (dynamic/estimated), `locked_unit_price DECIMAL(12,2)` (permanent on confirmation), `total_price`, `locked_total_price`, `status` (`RESERVED`, `CONFIRMED`, `PAID`, `CANCELLED`, `EXPIRED`).
- **Fail-Closed Uniqueness Index:** `active_pool_buyer_key VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN status NOT IN ('CANCELLED', 'EXPIRED') THEN CONCAT(pool_id, '_', buyer_id) ELSE NULL END) VIRTUAL` backed by unique index `idx_unique_active_pool_buyer`. Non-unique lookup index `idx_reservations_buyer_pool (buyer_id, pool_id)`. Prevents duplicate active reservations while permitting legitimate re-entry upon cancellation or expiration.

### 2.7 `payments` (0 Rows) & `platform_ledger` (0 Rows)
- **Unified Payment Table:** Replaces both old `payments` and `escrow_payments`.
- **Status Lifecycle:** `CREATED`, `PENDING`, `PROCESSING`, `PAID`, `FAILED`, `EXPIRED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED`.
- **Escrow Tracking:** `HELD_IN_ESCROW`, `RELEASED_TO_SUPPLIER`, `REFUNDED`.
- **Ledger:** Linked to `payments(id)` via foreign key with commission calculation (`platform_fee_amount` + `supplier_net_amount = gross_amount`).

### 2.8 Database-Only Schemas (Tables with Zero API Routes)
- **`orders`**: Full schema with delivery types (`DOORSTEP`, `GROUPED_CLUSTER`, `SUPPLIER_PICKUP`), delivery fee, and payment status exists, but has no API routes.
- **`flash_pools`**: Supports inventory clearance, clearance reason, discount price, and expiry DATETIME. No API endpoints mounted.
- **`rfqs` & `rfq_quotes`**: Private custom quote request with versioned bids (`version_number INT DEFAULT 1`). No API endpoints mounted.
- **`recurring_contracts`**: Subscription orders with `price_change_status` (`STABLE`, `PRICE_CHANGE_PENDING_BUYER_APPROVAL`). No API endpoints mounted.

### 2.9 `reservation_mutation_history` (Migration 011)
- **Purpose:** Append-only ledger recording all buyer reservation modifications (quantity updates, cancellations) with complete before/after snapshots and idempotency linkage.
- **Columns:**
  - `id INT AUTO_INCREMENT PRIMARY KEY`
  - `reservation_id INT NOT NULL` (FK → `reservations(id)`)
  - `pool_id INT NOT NULL` (FK → `pools(id)`)
  - `buyer_id INT NOT NULL` (FK → `users(id)`)
  - `mutation_type ENUM('QUANTITY_UPDATE', 'CANCELLATION', 'STATUS_CHANGE') NOT NULL`
  - `previous_quantity DECIMAL(12,4) NOT NULL`
  - `new_quantity DECIMAL(12,4) NOT NULL`
  - `previous_unit_price DECIMAL(12,2) NULL`
  - `new_unit_price DECIMAL(12,2) NULL`
  - `previous_total_price DECIMAL(12,2) NULL`
  - `new_total_price DECIMAL(12,2) NULL`
  - `previous_status VARCHAR(30) NOT NULL`
  - `new_status VARCHAR(30) NOT NULL`
  - `aggregate_qty_snapshot DECIMAL(12,4) NOT NULL`
  - `idempotency_key VARCHAR(128) NULL`
  - `response_payload JSON NOT NULL`
  - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- **Indexes:**
  - `idx_res_mutation_res_id (reservation_id)`
  - `idx_res_mutation_pool_id (pool_id)`
  - `idx_res_mutation_buyer_id (buyer_id)`
  - `idx_res_mutation_idempotency (idempotency_key)`
- **Crash Recovery & Audit:** Enables exact historical response reconstruction during idempotency replays without rolling back subsequent edits.

### 2.10 `reservation_business_events` (Migration 012)
- **Purpose:** Append-only transactional domain event outbox recording fine-grained reservation lifecycle mutations and pool milestone threshold crossings.
- **Columns:**
  - `id INT AUTO_INCREMENT PRIMARY KEY`
  - `event_id VARCHAR(64) NOT NULL UNIQUE` (Deterministic SHA-256 hash or UUID)
  - `pool_id INT NOT NULL` (FK → `pools(id)`)
  - `reservation_id INT NULL` (FK → `reservations(id)`)
  - `event_type VARCHAR(64) NOT NULL` (`RESERVATION_CREATED`, `RESERVATION_QUANTITY_INCREASED`, `RESERVATION_QUANTITY_DECREASED`, `RESERVATION_CANCELLED`, `POOL_DEMAND_CHANGED`, `POOL_TIER_CHANGED`, `SUPPLIER_MINIMUM_REACHED`, `SUPPLIER_MINIMUM_LOST`, `TARGET_REACHED`, `TARGET_LOST`)
  - `actor_id INT NOT NULL` (FK → `users(id)`)
  - `actor_role VARCHAR(32) NOT NULL`
  - `idempotency_key VARCHAR(128) NULL`
  - `payload JSON NOT NULL`
  - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- **Indexes:**
  - `idx_res_event_pool (pool_id)`
  - `idx_res_event_res (reservation_id)`
  - `idx_res_event_type (event_type)`
  - `idx_res_event_idempotency (idempotency_key)`
  - `idx_res_event_created (created_at)`
### 2.11 `pool_commercial_snapshots` (Migration 013, 014 & 015)
- **Purpose:** Immutable audit and commercial contract snapshots capturing the exact commercial state of a Regular Pool upon qualification evaluation (participation cutoff or authorized early closure).
- **Columns:**
  - `id INT AUTO_INCREMENT PRIMARY KEY`
  - `snapshot_code VARCHAR(36) NOT NULL UNIQUE` (e.g. `SNP-10-1771345678-ABC123`)
  - `pool_id INT NOT NULL` (FK → `pools(id)`)
  - `snapshot_version INT NOT NULL DEFAULT 1`
  - `qualification_status ENUM('UNQUALIFIED', 'QUALIFIED', 'TARGET_MET', 'CAPACITY_MET') NOT NULL`
  - `qualification_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
  - `participation_cutoff TIMESTAMP NOT NULL`
  - `supplier_id INT NOT NULL` (FK → `users(id)`)
  - `supplier_listing_id INT NULL` (FK → `supplier_listings(id)`)
  - `product_id INT NOT NULL` (FK → `products(id)`)
  - `product_spec_id INT NULL` (FK → `product_specifications(id)`)
  - `canonical_spec_hash VARCHAR(64) NULL`
  - `pool_unit VARCHAR(30) NOT NULL`
  - `eligible_aggregate_qty DECIMAL(12,4) NOT NULL`
  - `supplier_min_qty DECIMAL(12,4) NOT NULL`
  - `target_qty DECIMAL(12,4) NOT NULL`
  - `max_capacity DECIMAL(12,4) NOT NULL`
  - `applicable_tier_index INT NULL`
  - `candidate_unit_price DECIMAL(12,2) NOT NULL`
  - `participating_reservations_count INT NOT NULL DEFAULT 0`
  - `participating_reservations_summary JSON NOT NULL`
  - `delivery_type ENUM('DOORSTEP', 'GROUPED_CLUSTER', 'SUPPLIER_PICKUP') NOT NULL`
  - `delivery_zones JSON NULL`
  - `delivery_fee_policy VARCHAR(100) NULL`
  - `fulfilment_lead_time_days INT NOT NULL DEFAULT 1`
  - `supplier_confirmation_deadline TIMESTAMP NULL`
  - `buyer_commitment_deadline TIMESTAMP NULL`
  - `status ENUM('PENDING_SUPPLIER_DECISION', 'SUPERSEDED', 'ACCEPTED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'PENDING_SUPPLIER_DECISION'`
  - `originating_event_id VARCHAR(64) NULL`
  - `authoritative_decision_key VARCHAR(100) GENERATED ALWAYS AS (IF(status = 'PENDING_SUPPLIER_DECISION', CONCAT(pool_id, ':PENDING'), NULL)) VIRTUAL` (Migration 014 - OBS-47)
  - `authoritative_outcome_key VARCHAR(100) GENERATED ALWAYS AS (IF(snapshot_version = 1, CONCAT(pool_id, ':', qualification_status), NULL)) VIRTUAL` (Migration 015 - OBS-64)
  - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
  - `updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
### 2.12 `pool_supplier_commercial_decisions` (Migration 016)
- **Purpose:** Immutable audit and commercial contract decision records capturing the authoritative acceptance or rejection decision made by a verified supplier on a qualified Regular Pool snapshot.
- **Columns:**
  - `id INT AUTO_INCREMENT PRIMARY KEY`
  - `decision_code VARCHAR(36) NOT NULL UNIQUE` (e.g. `DEC-10-1771345678-ABC123`)
  - `pool_id INT NOT NULL` (FK → `pools(id)`)
  - `snapshot_id INT NOT NULL` (FK → `pool_commercial_snapshots(id)`)
  - `snapshot_version INT NOT NULL DEFAULT 1`
  - `supplier_id INT NOT NULL` (FK → `users(id)`)
  - `actor_id INT NOT NULL` (FK → `users(id)`)
  - `actor_role ENUM('SUPPLIER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'SUPPLIER'`
  - `decision ENUM('ACCEPT', 'REJECT') NOT NULL`
  - `rejection_reason_code ENUM('PRICE_TOO_LOW', 'CAPACITY_SHORTAGE', 'FULFILMENT_TIMELINE_UNREALISTIC', 'LOGISTICAL_IMPOSSIBILITY', 'OTHER') NULL`
  - `rejection_reason_notes TEXT NULL`
  - `agreed_aggregate_qty DECIMAL(12,4) NOT NULL`
  - `agreed_unit_price DECIMAL(12,2) NOT NULL`
  - `originating_event_id VARCHAR(64) NULL`
  - `idempotency_key VARCHAR(128) NULL`
  - `decision_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
  - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- **Constraints & Indexes:**
  - `uq_supplier_decisions_snapshot (snapshot_id)` (UNIQUE - Enforces at DB level exactly one decision per snapshot)
  - `idx_supplier_decisions_pool (pool_id)`
  - `idx_supplier_decisions_supplier (supplier_id)`
  - `idx_supplier_decisions_decision (decision)`
  - `idx_supplier_decisions_timestamp (decision_timestamp)`
  - `idx_supplier_decisions_idempotency (idempotency_key)`
- **Commercial Contract Design:** Guarantees immutable decision evidence. A supplier can only ACCEPT the exact qualified snapshot terms or REJECT with a controlled reason code. Once recorded, the decision row cannot be modified.

### 2.13 `pool_buyer_commercial_decisions` (Migration 017)
- **Purpose:** Immutable audit and commercial contract decision records capturing the explicit acceptance or decline decision made by a verified participating buyer on their commercial offer for a supplier-accepted Regular Pool snapshot.
- **Columns:**
  - `id INT AUTO_INCREMENT PRIMARY KEY`
  - `decision_code VARCHAR(36) NOT NULL UNIQUE` (e.g. `BDEC-10-1771345678-ABC123`)
  - `pool_id INT NOT NULL` (FK → `pools(id)`)
  - `snapshot_id INT NOT NULL` (FK → `pool_commercial_snapshots(id)`)
  - `reservation_id INT NOT NULL` (FK → `reservations(id)`)
  - `buyer_id INT NOT NULL` (FK → `users(id)`)
  - `actor_id INT NOT NULL` (FK → `users(id)`)
  - `actor_role ENUM('BUYER') NOT NULL DEFAULT 'BUYER'`
  - `decision ENUM('ACCEPT', 'DECLINE') NOT NULL`
  - `decline_reason_code ENUM('PRICE_HIGH', 'FOUND_ALTERNATIVE', 'NO_LONGER_NEEDED', 'DELIVERY_WINDOW_UNSUITABLE', 'TERMS_UNACCEPTABLE', 'OTHER') NULL`
  - `decline_reason_notes TEXT NULL`
  - `committed_quantity DECIMAL(12,4) NOT NULL`
  - `agreed_unit_price DECIMAL(12,2) NOT NULL`
  - `agreed_total_price DECIMAL(12,2) NOT NULL`
  - `originating_event_id VARCHAR(64) NULL`
  - `idempotency_key VARCHAR(128) NULL`
  - `decision_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
  - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- **Constraints & Indexes:**
  - `uq_buyer_decisions_reservation_snapshot (reservation_id, snapshot_id)` (UNIQUE - Enforces at DB level exactly one decision per buyer reservation per snapshot)
  - `idx_buyer_decisions_pool (pool_id)`
  - `idx_buyer_decisions_buyer (buyer_id)`
  - `idx_buyer_decisions_decision (decision)`
  - `idx_buyer_decisions_timestamp (decision_timestamp)`
  - `idx_buyer_decisions_idempotency (idempotency_key)`
- **Commercial Contract Design:** Guarantees immutable buyer consent evidence. A buyer can explicitly ACCEPT the locked agreed terms or DECLINE with a controlled reason code. Once recorded, the decision row cannot be modified or updated.

### 2.14 `orders` (Migration 001, Updated in Migration 018)
- **Purpose:** Authoritative commercial orders table establishing formal contracts between verified buyers and suppliers upon post-qualification commitment closure.
- **Columns:**
  - `id INT AUTO_INCREMENT PRIMARY KEY`
  - `order_code VARCHAR(20) NOT NULL UNIQUE` (e.g. `ORD-12345678`)
  - `reservation_id INT NULL` (FK → `reservations(id)`)
  - `buyer_id INT NOT NULL` (FK → `users(id)`)
  - `supplier_id INT NOT NULL` (FK → `users(id)`)
  - `pool_id INT NULL` (FK → `pools(id)`)
  - `snapshot_id INT NULL` (FK → `pool_commercial_snapshots(id)`) (Migration 018)
  - `buyer_decision_id INT NULL` (FK → `pool_buyer_commercial_decisions(id)`) (Migration 018)
  - `total_qty DECIMAL(12,4) NOT NULL` (Updated from INT in Migration 018 to support precise commodity pack units)
  - `unit_price DECIMAL(12,2) NOT NULL`
  - `subtotal_amount DECIMAL(12,2) NOT NULL` (Merchandise subtotal)
  - `delivery_fee DECIMAL(12,2) DEFAULT '0.00'`
  - `buyer_platform_fee DECIMAL(12,2) DEFAULT '0.00'`
  - `total_amount DECIMAL(12,2) NOT NULL` (Payable total composed of subtotal + delivery + platform fee)
  - `currency VARCHAR(3) NOT NULL DEFAULT 'PKR'` (Migration 018)
  - `delivery_type ENUM('DOORSTEP','GROUPED_CLUSTER','SUPPLIER_PICKUP') NOT NULL DEFAULT 'DOORSTEP'`
  - `delivery_address TEXT NULL`
  - `cluster_zone VARCHAR(100) NULL`
  - `payment_status ENUM('AWAITING_PAYMENT','PAYMENT_INITIATED','PAID','PAYMENT_FAILED','REFUND_PENDING','REFUNDED') NOT NULL DEFAULT 'AWAITING_PAYMENT'`
  - `order_status ENUM('AWAITING_PAYMENT','PAID','SUPPLIER_CONFIRMED','PROCESSING','OUT_FOR_DELIVERY','DELIVERED','COMPLETED','CANCELLED','DISPUTED') NOT NULL DEFAULT 'AWAITING_PAYMENT'`
  - `notes TEXT NULL`
  - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
  - `updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
- **Constraints & Indexes:**
  - `uq_orders_buyer_decision (buyer_decision_id)` (UNIQUE - Enforces at DB level exactly-once order creation per buyer commitment decision)
  - `idx_orders_pool_status (pool_id, order_status)` (High performance aggregate queries)
  - `KEY reservation_id (reservation_id)`
  - `KEY pool_id (pool_id)`
  - `idx_orders_buyer (buyer_id)`
  - `idx_orders_supplier (supplier_id)`
- **Architectural Role (Part 4E.1):** Prepared and validated for future order conversion. Zero live order rows created in Part 4E.1.

### 2.15 `payment_attempts` (Migration 019)
- **Purpose:** Authoritative record of checkout initiation attempts made with external payment providers (Safepay Sandbox).
- **Columns:**
  - `id INT AUTO_INCREMENT PRIMARY KEY`
  - `attempt_code VARCHAR(32) NOT NULL UNIQUE` (e.g. `ATT-12345678-9999`)
  - `order_id INT NOT NULL` (FK → `orders(id)`)
  - `buyer_id INT NOT NULL` (FK → `users(id)`)
  - `provider VARCHAR(32) NOT NULL DEFAULT 'SAFEPAY'`
  - `environment VARCHAR(16) NOT NULL DEFAULT 'sandbox'`
  - `provider_tracker_token VARCHAR(128) NOT NULL UNIQUE` (Safepay `track_...` token)
  - `checkout_url TEXT NOT NULL` (Fully qualified hosted checkout URL)
  - `amount DECIMAL(12,2) NOT NULL` (Major unit amount taken directly from `orders.total_amount`)
  - `currency VARCHAR(3) NOT NULL DEFAULT 'PKR'`
  - `status ENUM('INITIATED','COMPLETED','FAILED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'INITIATED'`
  - `idempotency_key VARCHAR(128) NULL` (Correlation with request idempotency)
  - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
  - `updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
- **Constraints & Indexes:**
  - `uq_payment_attempts_token (provider_tracker_token)`
  - `idx_payment_attempts_order (order_id)`
  - `idx_payment_attempts_buyer (buyer_id)`
  - `idx_payment_attempts_status (status)`
  - `idx_payment_attempts_idempotency (idempotency_key)`

### 2.16 `payment_webhook_events` (Migration 019)
- **Purpose:** Immutable audit and deduplication log for all inbound webhooks from payment providers.
- **Columns:**
  - `id INT AUTO_INCREMENT PRIMARY KEY`
  - `event_id VARCHAR(128) NOT NULL UNIQUE` (Provider-assigned webhook event identifier)
  - `provider VARCHAR(32) NOT NULL DEFAULT 'SAFEPAY'`
  - `event_type VARCHAR(64) NOT NULL` (e.g. `payment.completed`, `payment.failed`)
  - `order_id INT NULL` (FK → `orders(id)`)
  - `attempt_id INT NULL` (FK → `payment_attempts(id)`)
  - `provider_tracker_token VARCHAR(128) NULL`
  - `signature VARCHAR(255) NULL` (Raw received signature header)
  - `timestamp_header VARCHAR(64) NULL` (Received timestamp header)
  - `raw_payload JSON NOT NULL` (Untampered webhook payload for forensic auditing)
  - `processed_status ENUM('PROCESSED','IGNORED_DUPLICATE','FAILED','RECONCILIATION_REQUIRED') NOT NULL DEFAULT 'PROCESSED'`
  - `error_message TEXT NULL`
  - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- **Constraints & Indexes:**
  - `uq_webhook_events_provider_event (provider, event_id)`
  - `idx_webhook_events_tracker (provider_tracker_token)`
  - `idx_webhook_events_order (order_id)`
  - `idx_webhook_events_status (processed_status)`


