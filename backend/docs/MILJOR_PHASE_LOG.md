# MilJor — Phase Execution Log

This document tracks phase-by-phase execution, gates, and verification status for the MilJor B2B procurement backend.

---

## Approved Engineering Roadmap & Phase Status Summary

| Phase / Part | Description | Status | Gate Evidence | Completion Date |
| :--- | :--- | :--- | :--- | :--- |
| **Part 0** | Repository Audit & Truthful Baseline | **COMPLETE AND VERIFIED** | `MILJOR_API_INVENTORY.md`, `MILJOR_DATABASE_INVENTORY.md`, Code Path Audit | 2026-10-18 |
| **Part 1** | Database & Architecture Cleanup | **COMPLETE AND VERIFIED** | Migrations `001`, `002`, `003` tracked; 31.9KB Backup verified restorable; `tests/phase1_gate.js` (12/12 assertions passed) | 2026-10-18 |
| **Part 2** | Authentication, Authorization & Security | **COMPLETE AND VERIFIED** | `tests/part2_security_gate.js` (16/16 assertions passed); Least privilege RBAC; Object authorization; Active status check | 2026-10-18 |
| **Part 3** | Product Specification & Supplier Listing Engine | **COMPLETE AND VERIFIED** | Migration `004` tracked; Normalized specifications; Unit integrity; `tests/part3_specification_gate.js` (15/15 assertions passed) | 2026-10-18 |
| **Part 4A** | Regular Pool Architecture & Compatibility Audit | **COMPLETE AND VERIFIED** | `docs/MILJOR_REGULAR_POOL_ARCHITECTURE.md`; Inspection of code paths, lifecycle state separation, tier pricing engine design | 2026-10-18 |
| **Part 4A.1** | Correct Regular Pool Architecture & Business Reconciliation | **COMPLETE AND VERIFIED** | Reconciled order/payment sequence, Safepay sandbox provider, tier pricing semantics, indivisible packs, and configurable SLAs in `docs/MILJOR_REGULAR_POOL_ARCHITECTURE.md` | 2026-10-18 |
| **Part 4B.1** | Regular Pool Database Foundation & Integrity | **COMPLETE AND VERIFIED** | Migration `006` applied; Verified backup `45.5 KB`; `tests/part4b1_pool_foundation_gate.js` (16/16 assertions passed); Decimal precision, capacity cap, units, inventory allocations | 2026-10-18 |
| **Part 4B.2** | Atomic Regular Pool Draft Creation & Supplier Validation | **COMPLETE AND VERIFIED** | Atomic transaction creation; exact spec & listing linkage; indivisible packaging integrity; inventory feasibility check; `idempotencyGuard`; `tests/part4b2_pool_creation_gate.js` (22/22 assertions passed) | 2026-10-18 |
| **Part 4B.3** | Regular Pool Tier Pricing, Commercial Terms & Safe Publishing | **COMPLETE AND VERIFIED** | Migration `007` applied; 48.2KB Backup verified restorable; `tierPricingService`; Payload hashing idempotency; Committed inventory allocation; `tests/part4b3_pool_publishing_gate.js` (25/25 assertions passed) | 2026-10-18 |
| **Part 4C** | Regular Pool Reservation Lifecycle, Mutations & Expiry | **COMPLETE AND VERIFIED** | Parts 4C.1, 4C.2A, 4C.2B, 4C.2C, 4C.2C.1, 4C.3 verified; 16-suite single-pass regression passed (368/368 assertions) | 2026-10-18 |
| **Part 4D.2** | Production-Grade Pool Qualification & Commercial Evidence | **COMPLETE AND VERIFIED** | Migration 014; tests/part4d2_pool_qualification_gate.js (30/30 PASS) | 2026-10-18 |
| **Part 4D.2.1** | Security Audit, Legacy Route Containment & Integrity Hardening | **COMPLETE AND VERIFIED** | Migration 015; tests/part4d2_1_security_integrity_gate.js (22/22 PASS); Master 466/466 PASS | 2026-10-18 |
| **Part 4D.3** | Supplier Confirmation & Rejection Workflow | **COMPLETE AND VERIFIED** | Migration 016; `tests/part4d3_supplier_decision_gate.js` (22/22 PASS); Master Regression (21 suites, 488/488 assertions PASS, 30.14s) | 2026-10-19 |
| **Part 4D.4** | Buyer Offer, Explicit Commitment & Final Demand | **COMPLETE AND VERIFIED** | Migration 017; `tests/part4d4_buyer_commitment_gate.js` (21/21 PASS); Master Regression (22 suites, 509/509 assertions PASS) | 2026-10-19 |
| **Part 4E.1** | Order Architecture & Commercial Reconciliation | **COMPLETE AND VERIFIED** | Migration 018; `tests/part4e1_order_foundation_gate.js` (23/23 PASS); Master Regression (23 suites, 532/532 assertions PASS) | 2026-10-19 |
| **Part 4E.1.1** | Exact Financial Arithmetic & Reconciliation Hardening | **COMPLETE AND VERIFIED** | `src/services/exactDecimal.js`; `tests/part4e1_1_financial_hardening_gate.js` (22/22 PASS); Master Regression (24 suites, 554/554 assertions PASS, 37.13s) | 2026-10-19 |
| **Part 4E.2** | Authoritative Order Conversion & Order Lifecycle Engine | **NOT STARTED** | Requires explicit user authorization | — |
| **Part 5** | Flash Clearance Pools Engine | **MISSING** | Database schema only; zero mounted routes | — |
| **Part 6** | Private RFQs & Versioned Quotes | **MISSING** | Database schema only; zero mounted routes | — |
| **Part 7** | Recurring Procurement Engine | **MISSING** | Database schema only; zero mounted routes | — |
| **Part 8** | Orders, Fulfillment & Delivery Logistics | **MISSING** | Database schema only; zero mounted routes | — |
| **Part 9** | Invoicing, Communications & Notifications | **MISSING** | Not implemented | — |
| **Part 10** | External Auth (Google/Apple) & KYC | **BLOCKED BY EXTERNAL CREDENTIALS** | Live OAuth credentials & SMS gateway missing | — |
| **Part 11** | Supplier Matching & MilJor Assistant | **MISSING** | Not implemented | — |
| **Part 12** | End-to-End Hardening & Regression Suite | **NOT TESTED** | Pending full system implementation | — |

---

## Part 0 Execution Detail — Repository Audit & Truthful Baseline
- **Audit Date:** 2026-10-18
- **Objective:** Establish an accurate baseline by inspecting all 25 mounted routes, 17 MySQL tables, and code paths.
- **Key Discovered Reality:** 5 modules (`orders`, `flash_pools`, `rfqs`, `rfq_quotes`, `recurring_contracts`) exist as MySQL tables but have zero mounted API routes.
- **Status:** **PASS**.

---

## Part 1 Execution Detail — Database & Architecture Cleanup
- **Execution Date:** 2026-10-18
- **Objective:** Eliminate duplicate payment tables (`escrow_payments`), establish versioned migration framework, enforce foreign keys/constraints/exact decimal precision, create and verify point-in-time database backups, and validate data integrity under transactional rollbacks.
- **Migrations Executed:**
  - `001_initial_schema_baseline.sql`
  - `002_payment_unification_and_price_locking.sql`
  - `003_fix_seeded_password_hashes.sql`
  - Tracked in `schema_migrations` table via `database/runMigrations.js`.
- **Database Backup & Restoration Test:**
  - Backup created via `database/backupDatabase.js`: `miljor_db_backup_2026-10-18T12-29-51-701Z.sql` (31.9 KB).
  - Restoration proven via `database/verifyBackupRestoration.js`: Restored into isolated `miljor_test_db` with all 17 tables matching production.
- **Automated Integrity Gate Test:**
  - `node tests/phase1_gate.js`: **12/12 assertions passed (100%)**.
- **Status:** **PASS**.

---

## Part 2 Execution Detail — Authentication, Authorization & Security Hardening
- **Execution Date:** 2026-10-18
- **Objective:** Audit, repair, and harden authentication and authorization across the platform. Prevent role escalation, eliminate user enumeration, enforce password complexity, implement least-privilege administrative RBAC, enforce object-level authorization across buyer/supplier boundaries, implement real-time account status checks in JWT middleware, and mount admin verification routes.
- **Files Modified/Created:**
  - `src/config/db.js` (Dynamic DB selection: `miljor_test_db` for `NODE_ENV === 'test'`)
  - `server.js` (Wrapped `app.listen` in `if (require.main === module)`; disabled `startScheduler()` when `NODE_ENV === 'test'`, mounted `/api/v1/admin`)
  - `src/middlewares/authGuard.js` (Real-time DB active status check, standard issuer/audience claims, least-privilege role helpers)
  - `src/controllers/authController.js` (Password complexity, anti-enumeration login error, logout endpoint with audit)
  - `src/routes/v1/authRoutes.js` (Mounted `/logout`)
  - `src/controllers/adminController.js` (Pending supplier review, verification approval/rejection with self-approval prohibition, user suspension)
  - `src/routes/v1/adminRoutes.js` (Mounted `/api/v1/admin` with least privilege role guards)
  - `src/routes/v1/auditRoutes.js` (Restricted financial summary to `FINANCE_ADMIN`, logs to `SUPPORT_ADMIN`)
  - `src/routes/v1/paymentRoutes.js` (Restricted refund endpoint to `FINANCE_ADMIN`)
  - `src/routes/v1/disputeRoutes.js` (Restricted arbitration to `OPERATIONS_ADMIN`)
  - `tests/part2_security_gate.js` (16-point automated security suite with strict database isolation verification, fixture teardown, and immutability assertions)
- **Test Database Isolation & Scheduler Verification:**
  - Active Test Database: `miljor_test_db` strictly verified via `SELECT DATABASE()`.
  - Development Database Protection: `miljor_db` verified 100% untouched before and after test suite (7 users before, 7 users after).
  - Background Scheduler: Disabled completely in test environments; zero background cron executions during testing.
- **Automated Security Gate Test:**
  - `node tests/part2_security_gate.js`: **16/16 assertions passed (100%)**.
  - Regression check `node tests/phase1_gate.js`: **12/12 assertions passed (100%)**.
- **Status:** **PASS**.

---

## Part 3 Execution Detail — Product Specification & Supplier Listing Engine
- **Execution Date:** 2026-10-18
- **Objective:** Build an accurate, scalable, specification-driven B2B product catalog and supplier listing system. Decouple catalog physical specifications from commercial supplier offers. Enforce physical unit integrity (strict mass vs volume separation; 16L != 16kg). Preserve historical `products`, `pools`, `reservations`, and `payments` relationships.
- **Migrations Executed:**
  - `004_product_specifications_and_supplier_listings.sql` (Creates `product_specifications`, `supplier_listings`, `supplier_listing_price_history`, seeds 3 base products, 8 representative physical specifications, and 3 initial verified listings; tracked in `schema_migrations`).
  - Safe rollout proven on isolated `miljor_test_db` before applying to development `miljor_db`. Point-in-time backup verified prior to migration: `miljor_db_backup_2026-10-18T12-53-23-953Z.sql` (35.1 KB).
- **Files Modified/Created:**
  - `database/migrations/004_product_specifications_and_supplier_listings.sql` (Schema migration)
  - `src/services/unitConversionService.js` (Unit & dimension compatibility; mass vs volume separation; packaging conversions; positive quantity/price validations)
  - `src/services/specificationService.js` (Deterministic SHA256 specification hashing; category attribute validation; spec code generation)
  - `src/repositories/productSpecificationRepo.js` (CRUD, hash deduplication, structured attribute queries)
  - `src/repositories/supplierListingRepo.js` (Offer lifecycle, verified supplier filtering, price history tracking, multi-supplier comparison)
  - `src/controllers/productSpecificationController.js` (Search/list/detail, creation with 409 conflict on duplicate specs, exact-spec supplier comparison)
  - `src/controllers/supplierListingController.js` (Listing creation, positive price/stock guards, ownership verification on updates, status toggle, price history audit)
  - `src/routes/v1/specificationRoutes.js` (Mounted at `/api/v1/specifications`)
  - `src/routes/v1/listingRoutes.js` (Mounted at `/api/v1/listings`)
  - `server.js` (Mounted specification and listing routes)
  - `tests/part3_specification_gate.js` (15-scenario automated verification suite)
- **Backward Compatibility & Transaction Safety:**
  - Historical pools (Pool 1 & Pool 2) remain 100% intact and functional.
  - Existing foreign keys on `products` preserved; `products` table retained as master commodity catalog.
- **Automated Gate Results:**
  - `node tests/part3_specification_gate.js`: **15/15 assertions passed (100%)**.
  - Regression check `node tests/part2_security_gate.js`: **16/16 assertions passed (100%)**.
  - Regression check `node tests/phase1_gate.js`: **12/12 assertions passed (100%)**.
- **Status:** **PASS**.

---

## Part 3.1 Execution Detail — Product Catalog Integrity Review
- **Execution Date:** 2026-10-18
- **Objective:** Address catalog integrity requirements before Part 4: canonical specification hash normalization, decoupled MOQ semantics, safe additive `product_spec_id` column on `pools` without assigning unverified grades to historical pools, unit pricing integrity, out-of-stock offer exclusion, and transparent delivered price breakdowns.
- **Migrations Executed:**
  - `005_catalog_integrity_and_pool_spec_linkage.sql` (Adds `product_spec_id INT NULL` to `pools`; adds `pricing_unit` and `price_per_base_unit` to `supplier_listings`; recalculates canonical hashes; tracked in `schema_migrations`).
  - Tested on `miljor_test_db` first, then executed on `miljor_db`.
- **Integrity Fixes Delivered:**
  1. **Canonical Hash Completeness:** `computeSpecHash` incorporates `productId`, `brand`, `variety`, `cropYear`, `processingMethod`, `qualityGrade`, `packagingType`, `packSize`, `packUnit`, `purchasingUnit`, and normalized sorted JSON `specAttributes`. Whitespace and casing normalized.
  2. **Independent MOQ Semantics:** Decoupled `buyer_min_qty` (individual ticket size) from `supplier_min_qty` (supplier aggregate/drop fulfillment threshold). Removed rigid constraints that hindered pool economics.
  3. **Pool Specification Linkage:** Additive `product_spec_id` column added to `pools`. Historical pools 1 and 2 preserved with `product_spec_id = NULL` to avoid arbitrarily presuming unverified grades.
  4. **Unit Pricing Integrity:** Added `pricing_unit` (e.g. bag, tin) and `price_per_base_unit` (PKR/kg, PKR/L) to prevent miscomparing per-pack with per-kg prices.
  5. **Out-of-Stock Exclusion:** Listings with `available_stock <= 0` or `available_stock < buyer_min_qty` are strictly excluded from buyer searches and comparison endpoints, even if stored status is `ACTIVE`.
  6. **Delivered Price Transparency:** When delivery fee is included (`INCLUDED_IN_PRICE`), delivered price equals base price. When delivery fee is flat per-trip (`FLAT_500_PER_DELIVERY`), `delivered_unit_price` returns `null` with explicit explanation, preventing unsupported unit delivered prices.
- **Automated Gate Results:**
  - `node tests/part3_specification_gate.js`: **15/15 assertions passed (100%)**.
  - Regression check `node tests/part2_security_gate.js`: **16/16 assertions passed (100%)**.
  - Regression check `node tests/phase1_gate.js`: **12/12 assertions passed (100%)**.
- **Status:** **PASS**.


---

## Part 4A Execution Detail — Regular Pool Architecture & Compatibility Audit
- **Execution Date:** 2026-10-18
- **Objective:** Audit existing regular pool and reservation implementation, inspect code paths and database models, establish exact product identity and specification validation contract, decouple pool vs. reservation vs. order state machines, formulate deterministic tier pricing and boundary condition rules, establish clear financial architecture boundaries with Part 5, design the database migration plan (Migration 006), and author the definitive architectural specification.
- **Artifact Delivered:**
  - `docs/MILJOR_REGULAR_POOL_ARCHITECTURE.md` (Comprehensive 11-section architectural contract).
- **Core Findings & Architectural Decisions:**
  1. **Historical Data Preservation:** Historical pools 1 and 2 (`MJ-POOL-0001` and `MJ-POOL-0002`) remain intact with `product_id` references and `product_spec_id = NULL`. Unverified physical attributes are not fabricated.
  2. **Specification Linkage Hierarchy:** Enforced `product_id` -> `product_spec_id` -> optional `supplier_listing_id`. Validates supplier ownership, active status, and inventory sufficiency.
  3. **MOQ & Capacity Decoupling:** Decoupled `buyer_min_qty` (individual ticket MOQ), `supplier_min_qty` (pool threshold MOQ), `target_qty` (optimal tier target), and `max_capacity` (hard capacity cap).
  4. **State Machine Decoupling:** Decoupled aggregate `pools.status` (`DRAFT`, `ACTIVE`, `TARGET_REACHED`, `AWAITING_SUPPLIER_CONFIRMATION`, `CONFIRMED`, `COMPLETED`, `EXPIRED`, `SUPPLIER_FAILED`) from individual `reservations.status` (`RESERVED`, `CONFIRMED`, `PAID`, `CANCELLED`, `EXPIRED`).
  5. **Price Locking Architecture:** During `ACTIVE`, `unit_price` represents dynamic estimated price. Upon pool `CONFIRMED`, price is permanently frozen in `locked_unit_price` and `locked_total_price`.
  6. **Financial Boundary:** Clean separation between Part 4 (demand aggregation, price locking, reservation transition) and Part 5 (payment gateway, escrow capture, double-entry ledger posting, buyer refunds).
  7. **Migration Plan 006:** Drafted non-breaking additive migration adding `max_capacity`, `supplier_listing_id`, `payment_deadline_at`, and performance indices.
- **Automated Regression Verification:**
  - Regression check `node tests/part3_specification_gate.js`: **15/15 assertions passed (100%)**.
  - Regression check `node tests/part2_security_gate.js`: **16/16 assertions passed (100%)**.
  - Regression check `node tests/phase1_gate.js`: **12/12 assertions passed (100%)**.
- **Status:** **PASS**.


---

## Part 4A.1 Execution Detail — Correct Regular Pool Architecture & Business Reconciliation
- **Execution Date:** 2026-10-18
- **Objective:** Reconcile documented regular pool architecture with actual codebase realities and approved business rules prior to Part 4B implementation.
- **Key Architectural Corrections Implemented in `docs/MILJOR_REGULAR_POOL_ARCHITECTURE.md`:**
  1. **Order & Payment Sequence:** Corrected the flawed sequence (`RESERVED -> CONFIRMED -> PAID -> ORDER`) to the approved lifecycle:
     $$\text{Buyer Reserves} \to \text{Pool Meets Minimum} \to \text{Supplier Confirms} \to \text{Buyer Accepts & Locks Price} \to \text{Order Created (AWAITING\_PAYMENT)} \to \text{Payment Intent} \to \text{Gateway Confirmation} \to \text{Order PAID} \to \text{Fulfillment}$$
  2. **Payment Provider Realism:** Explicitly declared **Safepay Sandbox** as the intended card/digital payment gateway provider. Removed all JazzCash assumptions from Part 4 architecture. Declared platform fee records as marketplace fee distributions (not full double-entry ledger). Clarified platform fund holding semantics (not state-regulated banking escrow).
  3. **Tier Pricing & Unit Semantics:** Decoupled `target_qty` from the cheapest tier. Defined continuous non-overlapping intervals, discrete indivisible package purchase constraints, canonical calculation units (`pool_unit`) vs display units, and clear pricing behavior before `supplier_min_qty` is reached.
  4. **Three Independent Lifecycles:** Formulated distinct state machines for Pool (demand aggregation & supplier contract), Reservation (buyer commitment & price lock), and Order (payment, delivery, settlement).
  5. **Configurable Policy Windows:** Replaced hardcoded 24h timeouts with configurable policy settings and formalized early closure rules when pools reach target volume early.
  6. **Inventory Allocation & Concurrency:** Defined evaluation of supplier listing stock against real allocation obligations, permitting replenishment capacity while preventing overselling.
  7. **Code Defect Audit:** Documented exact code-level defects in `createPool` (non-atomic tier insertion, initial status), missing spec validation, missing capacity caps, lock ordering hierarchy, and financial error sanitization.
- **Automated Regression Verification:**
  - `tests/part3_specification_gate.js`: 15/15 passed (100%)
  - `tests/part2_security_gate.js`: 16/16 passed (100%)
  - `tests/phase1_gate.js`: 12/12 passed (100%)
- **Status:** **PASS**.


---

## Part 4B.1 Execution Detail — Regular Pool Database Foundation & Integrity
- **Execution Date:** 2026-10-18
- **Objective:** Establish the database foundations and strict schema integrity required for the new Regular Pool Engine without implementing APIs prematurely. Preserve all historical pools, listings, specifications, and reservations.
- **Pre-Migration Safety & Backups:**
  - Database backup created: `database/backups/miljor_db_backup_2026-10-18T13-36-46-706Z.sql` (45.5 KB).
  - Restoration proven in isolated `miljor_test_db` (21/21 tables restored and verified).
- **Migration Executed:**
  - `database/migrations/006_regular_pool_foundation.sql`
  - Tested on `miljor_test_db` first with idempotency and repeat-safety verification.
  - Executed on `miljor_db` via `database/runMigrations.js` and recorded in `schema_migrations`.
- **Database Schema Changes Delivered:**
  1. **Pool Capacity & Listing Linkage:** Added `max_capacity DECIMAL(12,4) NULL`, `supplier_listing_id INT NULL` (with FK `fk_pools_supplier_listing`), `early_close_allowed TINYINT(1) DEFAULT 1`, `supplier_confirmation_deadline TIMESTAMP NULL`, `buyer_commitment_deadline TIMESTAMP NULL`.
  2. **Canonical Units & Indivisible Packs:** Added `pool_unit VARCHAR(30) DEFAULT 'pack'` and `purchase_increment DECIMAL(10,4) DEFAULT 1.0000` to `pools`. Updated historical pools 1 and 2 to `pool_unit = 'bag'`.
  3. **Decimal Quantity Precision:** Converted `current_qty`, `target_qty`, `supplier_min_qty`, `buyer_min_qty` on `pools`, `min_qty` and `max_qty` on `pool_price_tiers`, and `quantity` on `reservations` to `DECIMAL(12,4)` for exact fractional mass/volume support without floating-point drift.
  4. **Pricing Units on Tiers:** Added `pricing_unit VARCHAR(30) DEFAULT 'pack'` to `pool_price_tiers` (Pool 1 & 2 set to `'bag'`).
  5. **Reservations Payment Deadline:** Added `payment_deadline_at TIMESTAMP NULL` to `reservations`.
  6. **Inventory Allocation Ledger:** Created `supplier_inventory_allocations` table (`id`, `supplier_listing_id`, `allocation_type`, `reference_id`, `allocated_qty`, `unit`, `status`, `notes`, `created_at`, `updated_at`) with indexes to prevent simultaneous stock overpromising.
  7. **Performance Indexes:** Created `idx_pools_status_expires` on `pools(status, expires_at)` and `idx_reservations_pool_status` on `reservations(pool_id, status)`.
  8. **Rollback Script Provided:** `database/migrations/rollback/006_rollback_regular_pool_foundation.sql`.
- **Automated Gate Results:**
  - `node tests/part4b1_pool_foundation_gate.js`: **16/16 assertions passed (100%)**.
  - Regression check `node tests/part3_specification_gate.js`: **15/15 assertions passed (100%)**.
  - Regression check `node tests/part2_security_gate.js`: **16/16 assertions passed (100%)**.
  - Regression check `node tests/phase1_gate.js`: **12/12 assertions passed (100%)**.
- **Historical Data Verification:** Historical pools 1 and 2 remain intact with `product_spec_id = NULL` and `supplier_listing_id = NULL`. Zero payments, ledger, or reservation records were modified or deleted.
- **Status:** **PASS**.


---

## Part 4B.2 Execution Detail — Atomic Regular Pool Draft Creation & Supplier Validation
- **Execution Date:** 2026-10-18
- **Objective:** Implement secure, transactionally atomic supplier Regular Pool DRAFT creation using exact product specifications, supplier listings, quantity configuration, and inventory feasibility validation.
- **Files Modified/Created:**
  - `src/controllers/poolController.js` (Rewrote `createPool` with atomic transactions, full identity validations, capacity guards, indivisible pack checks, inventory feasibility, sanitized error masking).
  - `src/repositories/poolRepo.js` (Updated `createPool` and `createPriceTier` to accept transactional connections and support all Part 4B.1 fields).
  - `src/middlewares/idempotencyGuard.js` (Hardened with atomic placeholder reservation `response_status = 0`, user-scoping, and concurrent request protection).
  - `src/routes/v1/poolRoutes.js` (Mounted `idempotencyGuard` on `POST /api/v1/pools`).
  - `tests/part4b2_pool_creation_gate.js` (Comprehensive 22-assertion automated test suite with zero external testing dependencies).
- **Core Engineering Principles Implemented:**
  1. **Supplier Eligibility:** Server-side identity verification via JWT (`req.user.id`); verified supplier check (`requireVerifiedSupplier`); unverified suppliers rejected with 403 `SUPPLIER_NOT_VERIFIED`.
  2. **Product Identity Linkage:** Strict four-way relationship enforced: `product -> exact specification -> supplier listing -> authenticated supplier`. Mismatched specifications or cross-supplier listings rejected with 400/403.
  3. **Atomic Transaction Boundary:** Database connection acquired from pool, `beginTransaction()`, pool row and tier rows inserted within the same connection, and `commit()` on success. Any error triggers `rollback()` and connection release.
  4. **Commercial Quantities & Indivisible Packs:** `buyer_min_qty` and `supplier_min_qty` validated independently; `target_qty <= max_capacity`; fractional quantities of discrete packs (bags, tins) rejected with 400 `FRACTIONAL_PACK_REJECTED`.
  5. **Inventory Feasibility without Premature Holds:** Evaluates supplier listing stock minus active allocations from `supplier_inventory_allocations`. Rejects pools exceeding available inventory with 400 `INSUFFICIENT_INVENTORY`. Does not hold inventory prematurely on DRAFT creation.
  6. **Concurrency-Safe Idempotency:** Replay of identical `X-Idempotency-Key` returns cached 201 response with matching pool ID; concurrent in-flight requests return 409 `CONCURRENT_REQUEST`.
- **Automated Gate Results:**
  - `node tests/part4b2_pool_creation_gate.js`: **22/22 assertions passed (100%)**.
  - Child regression checks (Part 4B.1: 16/16, Part 3: 15/15, Part 2: 16/16, Part 1: 12/12): **100% passed**.
  - Development database `miljor_db` immutability verified (2 historical pools untouched).
- **Status:** **PASS**.

---

## Part 4B.3 Execution Detail — Regular Pool Tier Pricing, Commercial Terms & Safe Publishing
- **Execution Date:** 2026-10-18
- **Objective:** Complete commercial configuration and publish-readiness of supplier-created Regular Pools. Ensure DRAFT pools are safely publishable to ACTIVE with continuous non-overlapping price tiers, exact specification compliance, delivery terms, committed inventory allocations, and locked commercial terms.
- **Files Modified/Created:**
  - `database/migrations/007_pool_commercial_terms_and_idempotency.sql` (Additive delivery columns on `pools`, `request_hash` on `idempotency_records`).
  - `src/services/tierPricingService.js` (Deterministic tier engine: validates continuous intervals, monotonic non-increasing prices, discrete packaging integer enforcement, full capacity coverage, and deterministic price calculations).
  - `src/middlewares/idempotencyGuard.js` (Enhanced with SHA-256 payload hashing, conflict detection returning 409 `IDEMPOTENCY_PAYLOAD_CONFLICT`, and mandatory key enforcement returning 400 `MISSING_IDEMPOTENCY_KEY`).
  - `src/controllers/poolController.js` (Added `updateDraftPool` with draft state guard; added `publishPool` with listing row-locking `FOR UPDATE`, available-to-promise check, committed allocation insertion in `supplier_inventory_allocations`, status update to `ACTIVE`, and audit logging; updated `cancelPool` to release allocations).
  - `src/repositories/poolRepo.js` (Added `updatePool`, `replacePriceTiers`, connection forwarding, and delivery field support).
  - `src/routes/v1/poolRoutes.js` (Mounted `PUT /:id` and `POST /:id/publish` with auth guards, verified supplier checks, and idempotency guards).
  - `tests/part4b3_pool_publishing_gate.js` (25-assertion automated test suite with zero external dependencies).
- **Core Engineering Principles Implemented:**
  1. **Deterministic Tier Pricing Validation:** Enforces contiguous intervals with zero gaps and zero overlaps. Validates monotonic non-increasing prices ($\text{price}_k \le \text{price}_{k-1}$). Enforces that tiers cover from `supplier_min_qty` to `max_capacity` (or `target_qty`). Disallows fractional quantities on discrete packages.
  2. **Idempotency with Payload Fingerprinting:** Computes SHA-256 hash of `method + url + body`. Replays cached response for identical keys with matching payloads. Returns 409 `IDEMPOTENCY_PAYLOAD_CONFLICT` if the key is reused with a different payload. Returns 400 `MISSING_IDEMPOTENCY_KEY` when mandatory keys are omitted on mutation endpoints.
  3. **Atomic Safe Publishing with Committed Allocation:** When transitioning from `DRAFT` to `ACTIVE`, the engine locks the underlying listing row `FOR UPDATE`, converts capacity units if necessary, verifies available stock against active allocations, inserts a `COMMITTED` allocation record in `supplier_inventory_allocations`, updates pool status to `ACTIVE`, and commits atomically.
  4. **Post-Publish Commercial Locking:** Any attempt to edit commercial terms of an `ACTIVE` pool is rejected with 422 `INVALID_POOL_STATE`. Re-publishing an already active pool is rejected with 422 `INVALID_POOL_STATE`.
  5. **Allocation Release on Cancellation:** Cancelling an `ACTIVE` pool automatically releases the allocated stock by setting allocation status to `RELEASED`.
- **Automated Gate Results:**
  - `node tests/part4b3_pool_publishing_gate.js`: **25/25 assertions passed (100%)**.
  - `node tests/part4b2_pool_creation_gate.js`: **22/22 assertions passed (100%)**.
  - `node tests/part4b1_pool_foundation_gate.js`: **16/16 assertions passed (100%)**.
  - `node tests/part3_specification_gate.js`: **15/15 assertions passed (100%)**.
  - `node tests/part2_security_gate.js`: **16/16 assertions passed (100%)**.
  - `node tests/phase1_gate.js`: **12/12 assertions passed (100%)**.
- **Historical Data Verification:** Historical pools 1 and 2 remain completely intact and functional. Zero payment, ledger, or user records were altered.
- **Status:** **PASS**.

---

## Part 4B.4 Execution Detail — Buyer Reservations, Capacity Control & Initial Lifecycle
- **Execution Date:** 2026-10-18
- **Objective:** Implement secure, transactionally atomic buyer reservations (`POST /api/v1/reservations`) in published Regular Pools with strict capacity bounds, row-level locking (`FOR UPDATE`), dynamic tier evaluation, anti-self-dealing guards, discrete packaging verification, and post-commit crash recovery reconciliation.
- **Files Modified/Created:**
  - `src/controllers/reservationController.js`:
    - Strict `req.user.role === 'BUYER'` authorization guard.
    - Input validation: positive numeric quantity, indivisible packaging rule (`FRACTIONAL_PACK_REJECTED`), buyer MOQ (`BUYER_MIN_QTY_NOT_MET`), purchase increment alignment (`INVALID_PURCHASE_INCREMENT`).
    - Dedicated database transaction with row-level lock on `pools` (`FOR UPDATE`).
    - Pool state check: rejects non-ACTIVE pools (`POOL_NOT_ACTIVE`).
    - Database server-time authoritative expiry check: `(p.expires_at <= NOW())` (`POOL_EXPIRED`).
    - Anti-self-dealing check: rejects pool's own supplier (`SELF_PURCHASE_PROHIBITED`).
    - Duplicate active reservation check (`DUPLICATE_RESERVATION`).
    - Authoritative aggregate demand calculation under `reservations ... FOR UPDATE` lock, strictly enforcing `max_capacity` ceiling (`CAPACITY_EXCEEDED`).
    - Dynamic volume tier pricing via `tierPricingService.calculateApplicablePrice`.
    - Retroactive unit price and total price adjustment on active `RESERVED` items in the pool when price drops.
    - System audit logging (`RESERVATION_CREATED`) stamped with `idempotency_key`.
    - Atomic idempotency record linkage (`resource_type = 'reservations'`, `resource_id = reservationId`) within the transaction.
    - Rich, transparent B2B response formatting (reservation, pool, specification, supplier, aggregate progress, and pricing).
  - `src/repositories/reservationRepo.js`:
    - Fixed specification join alias (`ps.spec_hash AS canonical_spec_hash`) across `findByBuyerId` and `findById`.
  - `src/middlewares/idempotencyGuard.js`:
    - Implemented committed reservation reconstruction in `reconcileCommittedBusinessOperation` for `resource_type === 'reservations'` and audit-log fallback.
    - Stamped cleanup handlers on response finish/close to guarantee interval teardown.
  - `tests/part4b4_buyer_reservation_gate.js`:
    - Comprehensive 28-assertion automated test suite with zero external dependencies.
- **Key Assertions & Verification Highlights:**
  1. Valid buyer joins ACTIVE pool with 201 Created and rich B2B breakdown.
  2. Unauthorized requests rejected with 401 UNAUTHORIZED.
  3. Wrong roles (`SUPPLIER`, `ADMIN`) strictly rejected with 403 FORBIDDEN.
  4. Suspended buyer rejected with 403 ACCOUNT_SUSPENDED.
  5. DRAFT pool rejected with 422 POOL_NOT_ACTIVE.
  6. CANCELLED pool rejected with 422 POOL_NOT_ACTIVE.
  7. Expired pool rejected with 422 POOL_EXPIRED.
  8. Buyer minimum enforced with 400 BUYER_MIN_QTY_NOT_MET.
  9. Non-aligned purchase increment rejected with 400 INVALID_PURCHASE_INCREMENT.
  10. Fractional quantity for discrete packaging unit rejected with 400 FRACTIONAL_PACK_REJECTED.
  11. Quantity beyond capacity rejected with 409 CAPACITY_EXCEEDED.
  12. Exact remaining capacity reservation succeeds with 201 and 0 remaining capacity.
  13. Concurrent final-capacity race safely serializes via InnoDB row-locking (exactly one succeeds, zero oversubscription).
  14. Same-key replay returns existing reservation idempotently without duplicate insert.
  15. Same-key conflicting payload rejected with 409 IDEMPOTENCY_PAYLOAD_CONFLICT.
  16. Missing X-Idempotency-Key header strictly rejected with 400 MISSING_IDEMPOTENCY_KEY.
  17. Different buyers aggregate demand correctly in the same active pool.
  18. Cached `pools.current_qty` matches exact `SUM(quantity)` of active reservations in database.
  19. Buyer reservations consume internal pool capacity without creating duplicate supplier inventory allocations.
  20. Dynamic tier pricing updates pool price and retroactively updates active RESERVED reservations.
  21. Pricing remains valid and stable above `target_qty` up to `max_capacity`.
  22. Historical pools 1 & 2 remain untouched, compatible, and uncorrupted.
  23. Supplier cannot silently cancel pool with active buyer reservations (422 RESERVED_POOL_CANCELLATION_BLOCKED).
  24. Post-commit crash recovery reconciles committed reservation without duplicate insert.
  25. Database transaction rollback on validation failure leaves zero orphaned reservations.
  26. Clean architectural boundary: Buyer reservations strictly create RESERVED state with zero premature orders or payments.
  27. Test execution strictly isolated in `miljor_test_db` with complete fixture cleanup.
  28. Full sequential regression across all previous 8 suites passed with 100% success.
- **Test Results:**
  - `node tests/part4b4_buyer_reservation_gate.js`: **28/28 assertions passed (100%)**.
  - Total cumulative passing platform assertions: **160/160 (100%)**.
- **Historical Data Verification:** Historical pools 1 and 2 in `miljor_db` remain completely pristine (`product_spec_id = NULL`, `supplier_listing_id = NULL`).
- **Status:** **PASS**.

---

## Part 4B.4.1 Execution Detail — Reservation Safety Hardening, Observations Resolution & One Active Reservation Rule
- **Execution Date:** 2026-10-18
- **Objective:** Audit and resolve remaining reservation safety observations before Part 4C:
  1. **OBS-16 (Timezone Correctness & Temporal Expiry Authority):** Ensure database server `NOW()` is the sole temporal authority for pool expiration, configure MySQL connection pool `timezone: 'Z'` (UTC), and strictly close the exact boundary (`expires_at <= NOW()`).
  2. **OBS-17 (Transaction Isolation & Lock Hierarchy):** Enforce parent pool row `FOR UPDATE` as the primary serialization point; eliminate vulnerable aggregate gap-locks.
  3. **OBS-18 (Price Tier Dynamics vs Locked Prices Immutability):** Restrict retroactive dynamic repricing strictly to `status = 'RESERVED' AND locked_unit_price IS NULL AND id != ?`. Guarantee that once a buyer commits, locked prices are immutable.
  4. **OBS-19 (Supplier and Listing Eligibility Validation):** Check supplier account status (`!== 'BLOCKED'`), buyer trust status (`!== 'SUSPENDED'`), listing status (`=== 'ACTIVE'`), and 4-way specification linkage within the transaction. Return 422 `SUPPLIER_INELIGIBLE`, 422 `LISTING_INACTIVE`, or 422 `SPECIFICATION_MISMATCH`.
  5. **One Active Reservation per Buyer Rule:** Enforce at application and database level that a buyer may hold only one active reservation per pool (`RESERVED`, `CONFIRMED`, `PAID`), returning 409 `ACTIVE_RESERVATION_EXISTS` with existing reservation details, while preserving `CANCELLED` and `EXPIRED` records to permit re-entry.
- **Database Migration Applied:**
  - Migration 009: `database/migrations/009_one_active_reservation_per_buyer.sql`
  - Replaced legacy unconditional unique index with non-unique composite index `idx_reservations_buyer_pool (buyer_id, pool_id)`.
  - Added MySQL 8 `VIRTUAL` generated column:
    `active_pool_buyer_key VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN status IN ('RESERVED', 'CONFIRMED', 'PAID') THEN CONCAT(pool_id, '_', buyer_id) ELSE NULL END) VIRTUAL`.
  - Added unique index: `idx_unique_active_pool_buyer (active_pool_buyer_key)`.
  - Rollback script provided: `database/migrations/rollback/009_rollback_one_active_reservation_per_buyer.sql`.
  - Applied to `miljor_test_db` and `miljor_db` and recorded in `schema_migrations`.
- **Files Modified/Created:**
  - `database/migrations/009_one_active_reservation_per_buyer.sql`
  - `database/migrations/rollback/009_rollback_one_active_reservation_per_buyer.sql`
  - `src/config/db.js` (Added `timezone: 'Z'`)
  - `src/controllers/reservationController.js` (Hardened pool lock query with `(p.expires_at <= NOW())`, supplier/listing eligibility checks, guarded repricing with `locked_unit_price IS NULL`, and one-active-reservation 409 conflict return with safe payload)
  - `tests/part4b4_1_reservation_hardening_gate.js` (18-assertion automated gate suite with zero external dependencies)
- **Automated Gate Results:**
  - `node tests/part4b4_1_reservation_hardening_gate.js`: **18/18 assertions passed (100%)**.
  - All 9 previous verification gates verified sequentially:
    - `phase1_gate.js`: PASS
    - `part2_security_gate.js`: PASS
    - `part3_specification_gate.js`: PASS
    - `part4b1_pool_foundation_gate.js`: PASS
    - `part4b2_pool_creation_gate.js`: PASS
    - `part4b3_pool_publishing_gate.js`: PASS
    - `pre4c1_concurrency_hardening_gate.js`: PASS
    - `pre4b4_idempotency_crash_recovery_gate.js`: PASS
    - `part4b4_buyer_reservation_gate.js`: PASS
  - Total cumulative platform assertions passed: **178/178 (100%)**.
- **Historical Data Verification:** Historical pools 1 and 2 in `miljor_db` remain completely pristine (`product_spec_id = NULL`, `supplier_listing_id = NULL`).
- **Status:** **PASS**.

---

## Part 4B.4.2 Execution Detail — Critical Reservation Integrity Corrections (OBS-21–25) & Zero-Regression Gate
- **Execution Date:** 2026-10-18
- **Objective:** Address observations OBS-21 through OBS-25 with zero regression:
  1. **OBS-21 (Supplier Verification & Eligibility):** Replaced negative checks with affirmative verification. Required supplier user exists, role `SUPPLIER`, `is_verified = 1`, user `verification_status = 'VERIFIED'`, and `supplier_profiles.verification_status = 'VERIFIED'`. Completely detached `buyer_trust_status`. Verified listing ownership and spec match.
  2. **OBS-22 (Single Authoritative Timezone & Expiry Evaluation):** Removed duplicate Node.js `new Date()` clock check; sole temporal authority is MySQL evaluated in UTC within the locked row query `(p.expires_at <= NOW()) AS is_expired`. Exact boundary evaluated as closed (`422 POOL_EXPIRED`).
  3. **OBS-23 (Protect Estimated Prices & Financially Locked Commitments):** Dynamic tier repricing strictly guarded to `WHERE pool_id = ? AND status = 'RESERVED' AND locked_unit_price IS NULL AND id != ?`. Any non-RESERVED or locked price item is strictly immutable.
  4. **OBS-24 (Legacy Pools Protection Without Fabricated Specifications):** Historical pools 1 and 2 strictly reject new commercial reservations with `422 LEGACY_POOL_READ_ONLY`. In public discovery (`findAllActive`), classified with `is_legacy = 1` and `participation_status = 'LEGACY_NOT_AVAILABLE_FOR_NEW_RESERVATIONS'`. Historical rows remain completely untouched.
  5. **OBS-25 (Future-Safe One Active Reservation per Buyer):** Migration 010 modified `active_pool_buyer_key` virtual column to `status NOT IN ('CANCELLED', 'EXPIRED')`. All active and future non-terminal states fail closed against duplicate reservations, while `CANCELLED` and `EXPIRED` records allow legitimate re-entry.
- **Database Migration Applied:**
  - Migration 010: `database/migrations/010_fail_closed_active_reservation_uniqueness.sql`
  - Rollback script: `database/migrations/rollback/010_rollback_fail_closed_active_reservation_uniqueness.sql`
  - Applied to `miljor_test_db` and `miljor_db` and recorded in `schema_migrations`.
- **Database Backup Verified:**
  - Pre-flight backup: `database/backups/miljor_db_backup_2026-10-18T16-04-10-500Z.sql` (49.4 KB).
  - Restoration into `miljor_test_db` verified with 22/22 tables matching.
- **Files Modified/Created:**
  - `database/migrations/010_fail_closed_active_reservation_uniqueness.sql`
  - `database/migrations/rollback/010_rollback_fail_closed_active_reservation_uniqueness.sql`
  - `src/controllers/reservationController.js` (Affirmative supplier checks, DB temporal authority, protected locked commitments, legacy pool read-only guard, fail-closed active reservation check)
  - `src/repositories/poolRepo.js` (Tagged legacy pools with `is_legacy` and `participation_status`)
  - `tests/part4b4_2_observations_integrity_gate.js` (20-assertion automated test suite with full 10-suite regression runner)
- **Automated Gate Results:**
  - `node tests/part4b4_2_observations_integrity_gate.js`: **20/20 assertions passed (100%)**.
  - All 10 prior verification gates verified sequentially:
    - `phase1_gate.js`: PASS
    - `part2_security_gate.js`: PASS
    - `part3_specification_gate.js`: PASS
    - `part4b1_pool_foundation_gate.js`: PASS
    - `part4b2_pool_creation_gate.js`: PASS
    - `part4b3_pool_publishing_gate.js`: PASS
    - `pre4c1_concurrency_hardening_gate.js`: PASS
    - `pre4b4_idempotency_crash_recovery_gate.js`: PASS
    - `part4b4_buyer_reservation_gate.js`: PASS
    - `part4b4_1_reservation_hardening_gate.js`: PASS
  - Total cumulative platform assertions passed: **198/198 (100%)**.
- **Historical Data Verification:** Historical pools 1 and 2 in `miljor_db` remain completely pristine (`product_spec_id = NULL`, `supplier_listing_id = NULL`).
- **Status:** **PASS**. Stopped cleanly before Part 4C.

---

## Part 4C.1 Execution Detail — Buyer Reservation Modification, Cancellation & Commercial Integrity
- **Execution Date:** 2026-10-18
- **Objective:** Implement atomic reservation modification (`PATCH /api/v1/reservations/:id`), RESTful reservation cancellation (`POST /api/v1/reservations/:id/cancel`), and unified legacy cancellation route protection (`PUT /api/v1/reservations/:id/cancel` via OBS-26) with bidirectional dynamic tier repricing, parent-first locking, crash-safe idempotency via `reservation_mutation_history`, and optimistic concurrency guards.
- **Database Migration Applied:**
  - Migration 011: `database/migrations/011_reservation_mutation_history.sql`
  - Rollback script: `database/migrations/rollback/011_rollback_reservation_mutation_history.sql`
  - Applied to `miljor_test_db` and `miljor_db` and recorded in `schema_migrations`.
- **Database Backup Verified:**
  - Pre-flight backup: `database/backups/miljor_db_backup_2026-10-18T16-42-00-613Z.sql` (49.5 KB).
  - Restoration into `miljor_test_db` verified with 22/22 tables matching.
- **Files Modified/Created:**
  - `database/migrations/011_reservation_mutation_history.sql`
  - `database/migrations/rollback/011_rollback_reservation_mutation_history.sql`
  - `src/middlewares/idempotencyGuard.js` (Exported optional/required guards; prioritized `reservation_mutation_history` reconciliation at top of crash recovery)
  - `src/routes/v1/reservationRoutes.js` (Mounted `PATCH /:id` and `POST /:id/cancel`; hardened legacy `PUT /:id/cancel` with mandatory idempotency)
  - `src/controllers/reservationController.js` (Implemented `updateReservationQuantity` and `cancelReservation` with parent-pool-first row locking, dynamic tier repricing, discrete pack validation, buyer min checks, capacity guards, If-Match-Quantity optimistic checks, immutable mutation history logging, and audit logs)
  - `tests/part4c1_reservation_mutations_gate.js` (Comprehensive 56-assertion automated test suite with full 11-suite regression runner)
- **Automated Gate Results:**
  - `node tests/part4c1_reservation_mutations_gate.js`: **56/56 assertions passed (100%)**.
  - All 11 prior verification gates verified sequentially:
    - `phase1_gate.js`: PASS
    - `part2_security_gate.js`: PASS
    - `part3_specification_gate.js`: PASS
    - `part4b1_pool_foundation_gate.js`: PASS
    - `part4b2_pool_creation_gate.js`: PASS
    - `part4b3_pool_publishing_gate.js`: PASS
    - `pre4c1_concurrency_hardening_gate.js`: PASS
    - `pre4b4_idempotency_crash_recovery_gate.js`: PASS
    - `part4b4_buyer_reservation_gate.js`: PASS
    - `part4b4_1_reservation_hardening_gate.js`: PASS
    - `part4b4_2_observations_integrity_gate.js`: PASS
  - Total cumulative platform assertions passed: **254/254 (100%)**.
- **Historical Data Verification:** Historical pools 1 and 2 in `miljor_db` remain completely pristine (`product_spec_id = NULL`, `supplier_listing_id = NULL`). Zero orders, payments, or premature mutations created.
- **Status:** **PASS**. Stopped cleanly before Part 4C.2.

---

## Part 4C.2A Execution Detail — Authoritative Pool Progress, Tier Pricing Transparency & Read Consistency
- **Execution Date:** 2026-10-18
- **Objective:** Implement a unified, authoritative read model service (`src/services/poolProgressService.js`) returning accurate pool progress, remaining capacity, dynamic tier pricing estimates, next discount thresholds, and participation eligibility for Regular Pools. Resolve observations OBS-27 through OBS-31.
- **Database Schema Changes:** None required (Zero schema migrations needed; leveraged existing tables and columns).
- **Files Modified/Created:**
  - `src/services/poolProgressService.js`: Core read model service containing `calculateProgressAndPricing`, `evaluateParticipationEligibility`, `getPoolSnapshot`, and `enrichPoolsList`. Implements single coherent snapshot query, display-capped progress percentages (0.0% to 100.0%), transparent conditional pricing flags, next discount tier calculation (null if at best tier), and diagnostic drift logging policy (OBS-29).
  - `src/controllers/poolController.js`: Integrated `poolProgressService.getPoolSnapshot` into `getPoolById` and `poolProgressService.enrichPoolsList` into `getActivePools`.
  - `src/controllers/reservationController.js`: Hardened OBS-27 exact numeric parsing and comparison on `If-Match-Quantity` / `expected_quantity` (validates positive numeric, parses with `toFixed(4)`, checks `Math.abs(curr - exp) > 0.0001`, rejects malformed with 400 `INVALID_EXPECTED_QUANTITY`).
  - `tests/part4c2a_progress_pricing_gate.js`: Comprehensive 28-assertion automated gate suite verifying all progress, pricing, boundary, eligibility, concurrency, and drift scenarios, concluding with full platform regression across all 12 prior gates.
- **Automated Gate Results:**
  - `node tests/part4c2a_progress_pricing_gate.js`: **28/28 assertions passed (100%)**.
  - All 12 prior verification gates verified sequentially:
    - `phase1_gate.js`: PASS
    - `part2_security_gate.js`: PASS
    - `part3_specification_gate.js`: PASS
    - `part4b1_pool_foundation_gate.js`: PASS
    - `part4b2_pool_creation_gate.js`: PASS
    - `part4b3_pool_publishing_gate.js`: PASS
    - `pre4c1_concurrency_hardening_gate.js`: PASS
    - `pre4b4_idempotency_crash_recovery_gate.js`: PASS
    - `part4b4_buyer_reservation_gate.js`: PASS
    - `part4b4_1_reservation_hardening_gate.js`: PASS
    - `part4b4_2_observations_integrity_gate.js`: PASS
    - `part4c1_reservation_mutations_gate.js`: PASS
  - Total cumulative platform assertions passed: **282/282 (100%)**.
- **Historical Data Verification:** Historical pools 1 and 2 in `miljor_db` remain completely pristine (`product_spec_id = NULL`, `supplier_listing_id = NULL`, 0 reservations, 0 orders, 0 payments).
- **Status:** **PASS**. Stopped cleanly before Part 4C.2B.

---

## Part 4C.2B Execution Detail — Durable Reservation Events, Buyer/Supplier Visibility & Read-Model Integrity
- **Execution Date:** 2026-10-18
- **Objective:** Implement durable reservation business events outbox (`reservation_business_events`), enriched buyer-facing reservation read models, privacy-safe supplier aggregate demand summary, and resolve preflight observations OBS-32 through OBS-34.
- **Database Migration Applied:**
  - Migration 012: `database/migrations/012_reservation_business_events.sql`
  - Rollback script: `database/migrations/rollback/012_rollback_reservation_business_events.sql`
  - Applied to `miljor_test_db` and `miljor_db` and recorded in `schema_migrations`.
- **Database Backup Verified:**
  - Pre-flight backup: `database/backups/miljor_db_backup_2026-10-18T18-28-34-761Z.sql` (49.6 KB).
  - Restoration into `miljor_test_db` verified with 23/23 tables matching.
- **Files Modified/Created:**
  - `database/migrations/012_reservation_business_events.sql`
  - `database/migrations/rollback/012_rollback_reservation_business_events.sql`
  - `src/services/reservationDemandPolicy.js` (OBS-33: whitelisted active demand statuses `['RESERVED', 'CONFIRMED', 'PAID']`, terminal statuses `['CANCELLED', 'EXPIRED']`, fail-closed handling for unmapped statuses)
  - `src/services/supplierEligibilityPolicy.js` (OBS-34: unified symmetrical verification of supplier and listing across advisory read models and mutation transactions)
  - `src/services/reservationEventService.js` (Transactional domain event outbox for reservation and pool events with deterministic SHA-256 idempotency deduplication and `INSERT IGNORE`)
  - `src/services/poolProgressService.js` (Integrated shared policies for demand and supplier eligibility; fail-closed unknown status handling)
  - `src/controllers/reservationController.js` (Fixed OBS-32 exact 4-decimal quantity validation and rejection of excess precision, integrated shared policies, emitted business events on creation, modification, cancellation, and enriched buyer read views)
  - `src/controllers/poolController.js` (Implemented `getSupplierReservationSummary` with verified supplier/admin authorization and zero buyer PII)
  - `src/routes/v1/poolRoutes.js` (Mounted `GET /:id/supplier/summary` and alias `GET /:id/reservations/summary`)
  - `tests/part4c2b_events_visibility_gate.js` (30-assertion dedicated test suite verifying all 10 domain event types, idempotency deduplication, buyer visibility, supplier privacy, and OBS-32–34)
- **Automated Gate Results:**
  - `node tests/part4c2b_events_visibility_gate.js`: **30/30 assertions passed (100%)**.
  - All 13 prior verification gates verified sequentially:
    - `phase1_gate.js`: PASS
    - `part2_security_gate.js`: PASS
    - `part3_specification_gate.js`: PASS
    - `part4b1_pool_foundation_gate.js`: PASS
    - `part4b2_pool_creation_gate.js`: PASS
    - `part4b3_pool_publishing_gate.js`: PASS
    - `pre4c1_concurrency_hardening_gate.js`: PASS
    - `pre4b4_idempotency_crash_recovery_gate.js`: PASS
    - `part4b4_buyer_reservation_gate.js`: PASS
    - `part4b4_1_reservation_hardening_gate.js`: PASS
    - `part4b4_2_observations_integrity_gate.js`: PASS
    - `part4c1_reservation_mutations_gate.js`: PASS
    - `part4c2a_progress_pricing_gate.js`: PASS
  - Total cumulative platform assertions passed: **312/312 (100%)**.
- **Historical Data Verification:** Historical pools 1 and 2 in `miljor_db` remain completely pristine (`product_spec_id = NULL`, `supplier_listing_id = NULL`, 0 reservations, 0 orders, 0 payments).
- **Status:** **PASS**. Stopped cleanly before Part 4C.2C.

---

## Part 4C.2C Execution Detail — Combined Reservation Integrity, Durable Event Safety & Zero-Regression Gate
- **Execution Date:** 2026-10-18
- **Objective:** Establish the permanent MilJor Engineering Execution Protocol, eliminate nested recursive test runs, resolve critical observations OBS-35 (scoped event ID uniqueness), OBS-36 (explicit INSERT and duplicate verification), and OBS-37 (transactional event atomicity), guarantee natural Node.js process termination without forced `process.exit(0)`, and execute single-pass zero-regression verification across the entire platform.
- **Protocol Documentation Applied:**
  - `docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md` (11-section protocol).
  - Root and backend `AGENTS.md` linking to protocol.
- **Files Modified/Created:**
  - `docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`
  - `backend/AGENTS.md` and `AGENTS.md`
  - `tests/master_regression_runner.js` (Flat, sequential single-pass runner across all 15 suites)
  - `backend/package.json` (Updated `npm test` script to master runner)
  - `src/services/reservationEventService.js` (Hardened OBS-35 scoped operation identity and OBS-36 explicit INSERT with semantic duplicate verification and conflict throwing)
  - `tests/part4c2_combined_integration_gate.js` (Dedicated 24-assertion integration gate with natural process termination and real-time millisecond diagnostics)
  - `docs/MILJOR_PART4C2_FINAL_REPORT.md`
  - `docs/MILJOR_OBSERVATIONS_REGISTER.md` (Recorded resolutions for OBS-35, OBS-36, OBS-37)
- **Elimination of Nested Regression Loops:**
  - Refactored `part4b1`, `part4b2`, `part4b4`, `part4b4_1`, `part4b4_2`, `part4c1`, `part4c2a` to remove nested `child_process.execSync` runner invocations, replacing with direct schema and invariant assertions.
- **Automated Gate Results:**
  - `node tests/part4c2_combined_integration_gate.js`: **24/24 assertions passed (0.58s)** with clean natural exit (exit code 0).
  - `node tests/master_regression_runner.js`: **336/336 assertions passed across all 15 suites in 32.29 seconds (100% PASS)**.
- **Database Isolation Verification:**
  - Tests executed strictly against `miljor_test_db`.
  - Development database `miljor_db` verified 100% pristine (`pools = 2`, `reservations = 0`, `events = 0`, `mutations = 0`, `orders = 0`, `payments = 0`).
- **Status:** **PASS**. Stopped cleanly before Part 4C.2C.1.

---

## Part 4C.2C.1 Execution Detail — Event Identity, Semantic Deduplication & Commit-Ordering Safety Gate
- **Execution Date:** 2026-10-18
- **Objective:** Narrow, evidence-based verification and hardening of three remaining event-integrity concerns (OBS-38, OBS-39, OBS-40) before closing the Part 4C.2 milestone.
- **Observations Hardened & Resolved:**
  - **OBS-38 (Event ID Collision Correctness & Probabilistic Bounds):** Formally acknowledged 128-bit truncated SHA-256 probabilistic uniqueness ($p \approx k^2 / 2^{129}$) backed by database `UNIQUE KEY (event_id)` and transactional conflict rollback (`EVENT_ID_COLLISION`).
  - **OBS-39 (Complete Deep Semantic Duplicate Verification):** Replaced 4-field comparison with full canonical equality checking across all 11 event snapshot attributes (`event_type`, `pool_id`, `actor_id`, `actor_role`, `reservation_id`, `idempotency_key`, `previous_quantity`, `new_quantity`, `previous_aggregate_demand`, `new_aggregate_demand`, `previous_unit_price`, `new_unit_price`, and normalized JSON `event_payload`). Mismatches raise `EVENT_ID_COLLISION` (HTTP 409).
  - **OBS-40 (Commit-Ordering vs Auto-Increment Ordering):** Formally proved and tested that MilJor's exclusive row lock (`SELECT ... FROM pools WHERE id = ? FOR UPDATE`) serializes all reservation mutations on a given pool, guaranteeing that auto-increment allocation strictly aligns with transaction commit order.
- **Files Modified:**
  - `src/services/reservationEventService.js` (Implemented canonical value recursive sorting, decimal equality comparison, payload comparison, and comprehensive 11-field semantic check under `ER_DUP_ENTRY`).
  - `tests/part4c2_combined_integration_gate.js` (Added Tests 8, 9, 24, 25 for deep semantic checks, pool event stream isolation, and event immutability; renumbered suite to 28 sequential assertions).
  - `tests/master_regression_runner.js` (Updated expected assertions for suite 15 to 28).
  - `docs/MILJOR_OBSERVATIONS_REGISTER.md` (Updated summary table and added detailed entries for OBS-38, OBS-39, OBS-40).
  - `docs/MILJOR_PART4C2_FINAL_REPORT.md` (Updated executive summary, suite results, and OBS-38-40 resolutions).
  - `docs/MILJOR_PHASE_LOG.md` (Logged Part 4C.2C.1).
- **Automated Gate Results:**
  - `node tests/part4c2_combined_integration_gate.js`: **28/28 assertions passed (0.95s)** with natural process exit (exit code 0).
  - `node tests/master_regression_runner.js`: **340/340 assertions passed across all 15 suites in 33.62 seconds (100% PASS)**.
- **Database Isolation Verification:**
  - Tests executed strictly against `miljor_test_db`.
  - Development database `miljor_db` verified 100% pristine (`pools = 2`, `reservations = 0`, `events = 0`, `mutations = 0`, `orders = 0`, `payments = 0`).
- **Milestone Status:**
  - `PART 4C.2C.1: PASS`
  - `PART 4C.2 MILESTONE READY TO CLOSE: YES`
  - `CAN START PART 4C.3: NO` (Stopped cleanly; awaiting user prompt).

---

## Part 4C.3 Execution Detail — Reservation Lifecycle, Expiry Integrity & Final Regular Pool Participation Gate
- **Execution Date:** 2026-10-18
- **Objective:** Final integration and lifecycle-safety gate ensuring Regular Pool reservation participation behaves consistently across all lifecycle boundaries (active accepting, capacity capped, deadline passed, pre/post-expiry, lock-acquisition revalidation, scheduler safety, and stock allocation protection).
- **Core Verification Areas:**
  - Stored `ACTIVE` vs effective expired state (`expires_at <= NOW()` evaluated under lock).
  - Post-expiry request rejection (422 `POOL_EXPIRED`) for new reservations, quantity edits, and cancellations.
  - Concurrency lock revalidation: transaction begins before expiry, lock acquired after expiry -> correctly rejected with 422 `POOL_EXPIRED`.
  - Idempotent replay across expiry: legitimate pre-expiry committed mutation replayed after expiry returns 200 with cached payload; first-time mutation after expiry rejected with 422.
  - Existing scheduler safety: verified `startScheduler()` is strictly disabled during tests; audited destructive queries in `poolClosureService.js` and established Part 4D responsibility boundaries.
  - Stock allocation safeguards: verified single committed inventory allocation per published pool; zero buyer double-allocation; zero stock release upon expiry.
  - Privacy and read consistency: zero buyer PII leaked to suppliers; historical reservations remain readable after cancellation or pool expiry.
- **Files Modified / Created:**
  - `src/controllers/reservationController.js` (Added legacy pool read-only guard to `cancelReservation`).
  - `src/services/poolProgressService.js` (Included authoritative `is_expired` indicator in pool snapshot output).
  - `tests/part4c3_lifecycle_expiry_gate.js` (Created dedicated 28-assertion integration test suite).
  - `tests/master_regression_runner.js` (Registered Part 4C.3 gate suite as Suite 16).
  - `docs/MILJOR_PART4C3_LIFECYCLE_REPORT.md` (Created comprehensive milestone completion report).
  - `docs/MILJOR_PHASE_LOG.md` (Updated roadmap table and execution details).
- **Automated Gate Results:**
  - `node tests/part4c3_lifecycle_expiry_gate.js`: **28/28 assertions passed in 3.03s (100% PASS)** with natural process exit (exit code 0).
  - `node tests/master_regression_runner.js`: **368/368 assertions passed across all 16 suites in 29.27s (100% PASS)**.
- **Database Isolation Verification:**
  - Tests executed strictly against `miljor_test_db`.
  - Development database `miljor_db` verified 100% pristine (`pools = 2`, `reservations = 0`, `events = 0`, `mutations = 0`, `orders = 0`, `payments = 0`).
- **Milestone Status:**
  - `PART 4C.3: PASS`
  - `REGULAR POOL PARTICIPATION LAYER READY FOR PART 4D: YES`
  - `CAN START PART 4D: NO` (Stopped cleanly; awaiting user prompt).

---

## Part 4C.3.1 Execution Detail — Existing Scheduler Containment & Expiry Clock Verification
- **Execution Date:** 2026-10-18
- **Objective:** Strictly verify and correct OBS-41 (legacy scheduler fail-closed containment), OBS-43 (database server-time authoritative expiry check and lock-contention post-wait cutoff), and OBS-44 (lock serialization, deadlock prevention, and background job non-interference).
- **Observations Hardened & Resolved:**
  - **OBS-41 (Fail-Closed Scheduler Containment):** Added explicit guard `process.env.ENABLE_PART4D_POOL_CLOSURE === 'true'` to `src/services/poolClosureService.js`. When false (default across dev & prod), `processExpiredPools()` logs containment and returns `{ processed: 0, contained: true, reason: 'PART_4D_CLOSURE_WORKFLOW_PENDING' }`. Completely prevents uncoordinated reservation cancellation, premature refunds, or ledger mutations before Part 4D is formally implemented.
  - **OBS-43 (Database Server-Time Authoritative Expiry Check):** Standardized all expiry checks to MySQL server clock `(p.expires_at <= NOW()) AS is_expired` evaluated under exclusive row locks (`FOR UPDATE`). Resolved subtle MySQL timezone mismatch where `UTC_TIMESTAMP()` compared to `TIMESTAMP` columns produces a timezone delta under non-UTC session timezones. Revalidated lock-wait cutoff: requests waiting on row locks until expiry deadline are immediately rejected with 422 `POOL_EXPIRED`. Exact boundary (`expires_at = NOW()`) is closed.
  - **OBS-44 (Serialization & Background Job Non-Interference):** Verified parent-first lock hierarchy (`pools FOR UPDATE` -> `reservations FOR UPDATE`), verified unrelated scheduled maintenance tasks (`cleanOldIdempotencyRecords`, `processExpiredFlashPools`) remain fully operational, and confirmed zero bypass closure endpoints in admin routes.
- **Files Modified / Created:**
  - `src/services/poolClosureService.js` (Added fail-closed guard, consistent `NOW()` check, and return count for idempotency cleanup).
  - `src/controllers/reservationController.js` (Standardized authoritative DB server clock evaluation under row locks).
  - `src/services/poolProgressService.js` (Standardized authoritative DB server clock evaluation in pool snapshot).
  - `tests/part4c3_1_scheduler_safety_gate.js` (Created dedicated 12-assertion automated test suite with natural process termination).
  - `tests/master_regression_runner.js` (Registered Part 4C.3.1 gate suite as Suite 17 with 12 expected assertions).
  - `docs/MILJOR_OBSERVATIONS_REGISTER.md` (Added detailed entries for OBS-41, OBS-43, OBS-44).
  - `docs/MILJOR_PHASE_LOG.md` (Logged Part 4C.3.1).
- **Automated Gate Results:**
  - `node tests/part4c3_1_scheduler_safety_gate.js`: **12/12 assertions passed in 1.69s (100% PASS)** with natural process exit (exit code 0).
- **Database Isolation Verification:**
  - Tests executed strictly against `miljor_test_db`.
  - Development database `miljor_db` verified 100% pristine (`pools = 2`, `reservations = 0`, `events = 0`, `mutations = 0`, `orders = 0`, `payments = 0`).
- **Milestone Status:**
  - `PART 4C.3.1: PASS`
  - `CAN START PART 4D: YES` (Authorized Part 4D.1).

---

## Part 4D.1 Execution Detail — Regular Pool Commercial Lifecycle Foundation, State Integrity & Safe Closure Architecture
- **Execution Date:** 2026-10-18
- **Objective:** Establish the commercial lifecycle foundation, state transition machines, pure qualification rules, immutable commercial snapshot contract, permanent legacy scheduler decommissioning (OBS-45), and fresh post-lock expiry revalidation (OBS-46) for Regular Pools.
- **Database Migration Applied:**
  - Migration 013: `database/migrations/013_pool_commercial_snapshots.sql`
  - Rollback script: `database/migrations/rollback/013_rollback_pool_commercial_snapshots.sql`
  - Applied and verified on both `miljor_test_db` and `miljor_db` and tracked in `schema_migrations`.
- **Database Backup Verified:**
  - Pre-flight backup: `database/backups/miljor_db_backup_2026-10-18T20-37-10-231Z.sql` (54.1 KB).
  - Restoration into `miljor_test_db` verified across all 24 tables.
- **Observations Hardened & Resolved:**
  - **OBS-45 (Legacy Scheduler Feature-Flag Safety):** Expunged legacy destructive prototype closure code from `src/services/poolClosureService.js`. Both disabled and enabled flag configurations enforce safe decommissioning without executing raw reservation cancellations, payment refunds, or ledger mutations.
  - **OBS-46 (Fresh Post-Lock Expiry Revalidation):** Added dynamic post-lock database time evaluation (`SELECT (expires_at <= NOW()) AS is_freshly_expired FROM pools WHERE id = ?`) across `createReservation`, `updateReservationQuantity`, and `cancelReservation`. Transactions waiting on row locks across expiry deadlines are immediately rejected with 422 `POOL_EXPIRED`.
- **Files Modified / Created:**
  - `database/migrations/013_pool_commercial_snapshots.sql`
  - `database/migrations/rollback/013_rollback_pool_commercial_snapshots.sql`
  - `src/services/commercialLifecycleService.js` (Defined 4 state machines, qualification evaluator, commercial snapshot builder/persister, deadline validator, and inventory invariant checker)
  - `src/services/poolClosureService.js` (Permanently decommissioned legacy destructive mass cancellation, refund, and ledger queries)
  - `src/controllers/reservationController.js` (Added fresh post-lock database time expiry revalidation across create, update, cancel)
  - `tests/part4d1_commercial_foundation_gate.js` (Created dedicated 34-assertion automated test suite with natural process exit)
  - `tests/master_regression_runner.js` (Registered Suite 18 with 34 expected assertions, total 414 platform assertions)
  - `docs/MILJOR_PART4D1_COMMERCIAL_FOUNDATION_REPORT.md` (Published comprehensive milestone report)
  - `docs/MILJOR_DATABASE_INVENTORY.md` (Added Section 2.11 for `pool_commercial_snapshots`)
  - `docs/MILJOR_OBSERVATIONS_REGISTER.md` (Documented OBS-45 and OBS-46 resolutions)
  - `docs/MILJOR_PHASE_LOG.md` (Logged Part 4D.1)
  - `task.md` (Updated Part 4D.1 checklist)
- **Automated Gate Results:**
  - `node tests/part4d1_commercial_foundation_gate.js`: **34/34 assertions passed in 2.16s (100% PASS)** with natural process exit (code 0).
  - `node tests/master_regression_runner.js`: **414/414 assertions passed across all 18 suites in 53.83s (100% PASS)**.
- **Database Isolation Verification:**
  - Tests executed strictly against `miljor_test_db`.
  - Development database `miljor_db` verified 100% pristine (`pools = 2`, `reservations = 0`, `events = 0`, `mutations = 0`, `snapshots = 0`, `orders = 0`, `payments = 0`).
- **Milestone Status:**
  - `PART 4D.1: PASS`
  - `CAN START PART 4D.2: YES` (Awaiting explicit user authorization).

---

## Protocol v2.0 Integration Detail — Advanced Engineering Execution Model
- **Execution Date:** 2026-10-18
- **Objective:** Integrate Advanced Engineering Execution Model v2.0 into project operating instructions without modifying application business logic, schemas, or completed Part 4D.1 code.
- **Documents Created / Modified:**
  - `docs/MILJOR_BUSINESS_INVARIANTS.md`: Created centralized single source of truth for 11 core domain invariants.
  - `docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`: Updated to Protocol v2.0 incorporating non-negotiable quality hierarchy, one-pass initialization & impact mapping, requirement-to-evidence flow, risk-based 3-level testing, zero-hang natural termination, deterministic synchronization, and zero-regression final gates.
  - `backend/AGENTS.md`: Updated with Protocol v2.0 guidelines and direct references to business invariants.
  - `AGENTS.md`: Updated root instructions with Protocol v2.0 guidance and references.
  - `docs/MILJOR_PHASE_LOG.md`: Logged Protocol v2.0 integration milestone.
- **Application Code Changed:** **NO** (0 application files modified; documentation & protocol files only).
- **Milestone Status:**
  - `PROTOCOL v2.0: INTEGRATED`
  - `APPLICATION CODE CHANGED: NO`
  - `CAN CONTINUE TO PART 4D.2: NO — Awaiting separate technical review and authorization`

---

## Part 4D.2 Execution Detail — Production-Grade Pool Qualification, Atomic Closure Decision & Immutable Commercial Evidence
- **Execution Date:** 2026-10-18
- **Objective:** Implement production-grade commercial qualification engine, parent-pool-first transaction locking, pure decision evaluation against `supplier_min_qty`, immutable snapshot persistence, database-level active decision uniqueness (OBS-47), participating reservation freeze (OBS-48), committed inventory allocation preservation (OBS-49), zero premature financial mutation (OBS-50), fail-closed reservation auditing (OBS-51), and dedicated qualification API with crash-recovery idempotency.
- **Database Migration Applied:**
  - Migration 014: `database/migrations/014_pool_commercial_snapshots_invariants.sql`
  - Rollback script: `database/migrations/rollback/014_rollback_pool_commercial_snapshots_invariants.sql`
  - Applied and verified on both `miljor_test_db` and `miljor_db` and tracked in `schema_migrations`.
- **Database Backup Verified:**
  - Pre-flight backup: `database/backups/miljor_db_backup_2026-10-18T21-05-32-394Z.sql` (57.7 KB).
  - Full restoration and verification into `miljor_test_db` across all 25 tables.
- **Observations Hardened & Resolved:**
  - **OBS-47 (Active Decision Uniqueness):** Enforced via generated virtual column `authoritative_decision_key` (`IF(status = 'PENDING_SUPPLIER_DECISION', CONCAT(pool_id, ':PENDING'), NULL)`) with unique constraint `uq_snapshot_authoritative_decision`. Prevents race conditions from ever creating duplicate active supplier decisions.
  - **OBS-48 (Reservation Snapshot Traceability):** Commercial snapshot stores exact array of participating reservation IDs, codes, buyer IDs, quantities, and pricing estimates in `participating_reservations_snapshot`.
  - **OBS-49 (Inventory Allocation Safeguard):** Confirmed supplier inventory allocation remains `COMMITTED` without premature release during qualified or unqualified outcomes.
  - **OBS-50 (Zero Premature Financial Mutation):** Verified 0 orders, 0 payments, 0 refunds, and 0 ledger mutations occur during pool qualification.
  - **OBS-51 (Fail-Closed Audit Validation):** Any pool exhibiting reservations in unknown/invalid states is safely rejected with rollback.
- **Files Modified / Created:**
  - `database/migrations/014_pool_commercial_snapshots_invariants.sql`
  - `database/migrations/rollback/014_rollback_pool_commercial_snapshots_invariants.sql`
  - `src/services/commercialLifecycleService.js` (Added `qualifyPoolParticipation` with parent-pool-first locking, fresh UTC cutoff check, snapshot construction, event emission, and audit logging)
  - `src/controllers/poolController.js` (Added `qualifyPool` handler)
  - `src/routes/v1/poolRoutes.js` (Mounted `POST /:id/qualify` guarded by `protect`, `authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN')`, and `idempotencyGuard.required`)
  - `src/middlewares/idempotencyGuard.js` (Added `/qualify` crash reconciliation)
  - `tests/part4d2_pool_qualification_gate.js` (Authored dedicated 30-assertion automated test suite with natural process exit)
  - `tests/master_regression_runner.js` (Registered Suite 19 with 30 expected assertions, total 444 platform assertions)
  - `docs/MILJOR_PART4D2_QUALIFICATION_REPORT.md` (Published comprehensive milestone report)
  - `docs/MILJOR_DATABASE_INVENTORY.md` (Updated snapshot schema documentation)
  - `docs/MILJOR_API_INVENTORY.md` (Documented `POST /api/v1/pools/:id/qualify`)
  - `docs/MILJOR_OBSERVATIONS_REGISTER.md` (Documented OBS-47 through OBS-51 resolutions)
  - `docs/MILJOR_PHASE_LOG.md` (Logged Part 4D.2)
  - `task.md` (Updated Part 4D.2 checklist)
- **Automated Gate Results:**
  - `node tests/part4d2_pool_qualification_gate.js`: **30/30 assertions passed in 3.11s (100% PASS)** with natural process exit (code 0).
  - `node tests/master_regression_runner.js`: **444/444 assertions passed across all 19 suites in 54.92s (100% PASS)**.
- **Database Isolation Verification:**
  - Tests executed strictly against `miljor_test_db`.
  - Development database `miljor_db` verified 100% pristine (`pools = 2`, `reservations = 0`, `events = 0`, `mutations = 0`, `snapshots = 0`, `orders = 0`, `payments = 0`).
- **Milestone Status:**
  - `PART 4D.2: PASS`
  - `CAN START PART 4D.3: NO — Awaiting explicit user authorization`

---

## Part 4D.2.1 Execution Detail — Comprehensive Backend Security Audit, Legacy Route Containment & Commercial Integrity Hardening
- **Execution Date:** 2026-10-18
- **Objective:** Resolve OBS-59 through OBS-64, permanently retire dangerous legacy endpoints, implement safe pool cancellation safeguards against buyer demand destruction, enforce strict idempotency scoping and conflict isolation, safeguard idempotency retention against destructive scheduler pruning, enforce database-level authoritative outcome uniqueness via Migration 015, verify object-level authorization across buyer/supplier boundaries, and verify zero premature financial mutations.
- **Database Migration Applied:**
  - Migration 015: database/migrations/015_pool_commercial_snapshots_outcome_uniqueness.sql
  - Rollback script: database/migrations/rollback/015_rollback_pool_commercial_snapshots_outcome_uniqueness.sql
  - Applied and verified on both miljor_test_db and miljor_db and tracked in schema_migrations.
- **Database Backup & Restorability Proof:**
  - Non-interactive pre-flight backup: database/backups/miljor_db_backup_2026-10-18T22-12-09-306Z.sql (60,312 bytes).
  - Full restoration and verification into isolated miljor_val_restore_db with 25/25 tables verified.
- **Observations Resolved:**
  - **OBS-59 (Legacy Pool Confirmation Retired):** PUT /api/v1/pools/:id/confirm immediately returns HTTP 410 LEGACY_OPERATION_RETIRED. Fail-closed for all roles (including Admin). Zero DB mutations.
  - **OBS-60 (Safe Pool Cancellation & Anti-Destruction):** PUT /api/v1/pools/:id/cancel handles optional request body safely, strictly blocks cancellation of pools with active buyer reservations (HTTP 422), releases inventory allocation for safe cancellations, and blocks non-owner suppliers (HTTP 403).
  - **OBS-61 (Conflict Isolation on Already-Qualified Pools):** Qualification differentiates true idempotent replays from conflicting new transition attempts (HTTP 409 POOL_ALREADY_QUALIFIED), cross-actor key theft (HTTP 403), while permitting concurrent internal workers to safely receive authoritative outcomes.
  - **OBS-62 (Mandatory Idempotency Keys):** POST /api/v1/pools/:id/qualify enforces mandatory X-Idempotency-Key via idempotencyGuard.required (HTTP 400 if missing).
  - **OBS-63 (Safe Idempotency Retention):** cleanOldIdempotencyRecords preserves active, pending, unknown, and commercial records. Only prunes non-critical terminal records older than 7 days in bounded batches of 500.
  - **OBS-64 (Authoritative Outcome Uniqueness):** Migration 015 adds virtual column authoritative_outcome_key and unique constraint uq_snapshot_authoritative_outcome to pool_commercial_snapshots.
- **Files Modified / Created:**
  - database/migrations/015_pool_commercial_snapshots_outcome_uniqueness.sql
  - database/migrations/rollback/015_rollback_pool_commercial_snapshots_outcome_uniqueness.sql
  - src/controllers/poolController.js
  - src/routes/v1/poolRoutes.js
  - src/services/commercialLifecycleService.js
  - src/services/poolClosureService.js
  - src/controllers/disputeController.js
  - docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md (Standardized non-interactive backup)
  - tests/part4d2_1_security_integrity_gate.js (Dedicated 22-assertion security & integrity test suite)
  - tests/master_regression_runner.js (Registered Suite 20 with 22 assertions, total 466 platform assertions)
  - docs/MILJOR_PART4D2_1_SECURITY_REPORT.md (Published comprehensive security audit report)
  - docs/MILJOR_DATABASE_INVENTORY.md (Updated with Migration 015)
  - docs/MILJOR_API_INVENTORY.md (Updated pool route inventory)
  - docs/MILJOR_OBSERVATIONS_REGISTER.md (Documented OBS-59 to OBS-64)
- **Automated Gate Results:**
  - node tests/part4d2_1_security_integrity_gate.js: 22/22 assertions passed in 1.66s (100% PASS) with natural process exit.
  - node tests/part4d2_pool_qualification_gate.js: 30/30 assertions passed in 2.55s (100% PASS) with natural process exit.
  - node tests/master_regression_runner.js: 466/466 assertions passed across all 20 suites in 50.49s (100% PASS).
- **Database Isolation Verification:**
  - Tests executed strictly against miljor_test_db.
  - Development database miljor_db verified 100% pristine (pools = 2, reservations = 0, events = 0, snapshots = 0, migrations = 15).
- **Milestone Status:**
  - PART 4D.2.1: PASS
  - CAN START PART 4D.3: NO — Awaiting explicit user authorization

---

## Part 4D.3 Execution Detail — Authoritative Supplier Confirmation & Rejection Engine, Immutable Commercial Decisions and Zero-Regression Safety Gate
- **Execution Date:** 2026-10-19
- **Objective:** Implement an authoritative, secure, and transactionally atomic supplier accept/reject workflow for qualified Regular Pools, while protecting buyer reservations, supplier inventory, immutable snapshots, business events, and future payment obligations.
- **Database Migration Applied:**
  - Migration 016: `database/migrations/016_pool_supplier_commercial_decisions.sql`
  - Rollback script: `database/migrations/rollback/016_rollback_pool_supplier_commercial_decisions.sql`
  - Applied and verified on both `miljor_test_db` and `miljor_db` and tracked in `schema_migrations`.
- **Database Backup & Restorability Proof:**
  - Non-interactive pre-flight backup: `database/backups/miljor_db_backup_2026-10-19T12-50-36-870Z.sql` (59,343 bytes).
  - Restoration and integrity proven across 25 tables in `miljor_test_db`.
- **Observations Resolved:**
  - **OBS-65 (Published Pool Cancellation Safety):** Hardened `cancelPool` in `src/controllers/poolController.js` to strictly reject cancellation of pools with commercial status outside `DRAFT`/`ACTIVE` and pools with existing commercial snapshots (`PROTECTED_POOL_CANCELLATION_BLOCKED` with HTTP 422). Fail-closed for all roles including Admin.
  - **OBS-66 (Migration 015 Uniqueness Non-Obstructive):** Confirmed `authoritative_outcome_key` and unique index `uq_snapshot_authoritative_outcome` enforce global qualification outcome uniqueness without obstructing decision lifecycle.
  - **OBS-67 (Security & Anti-Impersonation Matrix):** Enforced `authorizeStrict('SUPPLIER')` (zero admin bypass/impersonation), verified supplier requirement, live KYC check, and tenancy isolation mapped and verified.
- **Core Engine & Architecture:**
  - In `src/services/commercialLifecycleService.js`:
    - `recordSupplierDecision()`: Parent-pool-first `FOR UPDATE` locking, live KYC and trust checks, fresh post-lock DB deadline evaluation (`NOW() <= supplier_confirmation_deadline`), snapshot validation, immutable decision insertion (`pool_supplier_commercial_decisions`), state transitions (`ACCEPT` -> `CONFIRMED`/`ACCEPTED`; `REJECT` -> `SUPPLIER_FAILED`/`REJECTED`), inventory preservation (no release on reject/accept), and transactional outbox business events (`SUPPLIER_OFFER_ACCEPTED`, `SUPPLIER_OFFER_REJECTED`).
    - `getPoolDecisionStatus()`: Sanitized read-model returning decision outcome to Admin, Owner Supplier, and Participating Buyers with zero buyer PII leakage.
  - In `src/routes/v1/poolRoutes.js`: Mounted `POST /:id/supplier-decision` and `GET /:id/supplier-decision`.
  - In `src/middlewares/authGuard.js`: Added `authorizeStrict('SUPPLIER')`.
  - In `src/middlewares/idempotencyGuard.js`: Integrated `/supplier-decision` crash recovery reconciliation and resource linkage.
- **Automated Gate Results:**
  - `node tests/part4d3_supplier_decision_gate.js`: **22/22 assertions passed (100% PASS)** with natural process exit.
  - `node tests/master_regression_runner.js`: **488/488 assertions passed across all 21 suites in 30.14s (100% PASS)** with natural process exit.
- **Database Isolation Verification:**
  - Tests executed strictly against `miljor_test_db`.
  - Development database `miljor_db` verified 100% PRISTINE (pools: 2, reservations: 0, events: 0, mutations: 0, snapshots: 0, decisions: 0, migrations: 16).
- **Milestone Status:**
  - **PART 4D.3: PASS**
  - **CAN START PART 4D.4: YES (Completed in Part 4D.4)**

---

## Part 4D.4 Execution Detail — Buyer Offer, Explicit Commitment, Price Integrity & Final Demand Accounting
- **Execution Date:** 2026-10-19
- **Objective:** Implement a secure, reliable, and transactionally atomic buyer ACCEPT/DECLINE workflow for supplier-accepted Regular Pools, establishing binding contractual price locking, opt-out immunity, immutable decision recording, outbox domain events, and real-time demand accounting without triggering order generation, payment processing, or retroactive repricing.
- **Database Migration Applied:**
  - Migration 017: `database/migrations/017_pool_buyer_commercial_decisions.sql`
  - Rollback script: `database/migrations/rollback/017_rollback_pool_buyer_commercial_decisions.sql`
  - Applied and verified on both `miljor_test_db` and `miljor_db` and tracked in `schema_migrations`.
- **Database Backup & Restorability Proof:**
  - Non-interactive pre-flight backup: `database/backups/miljor_db_backup_2026-10-19T14-20-01-852Z.sql` (62,400 bytes).
  - Restoration and integrity proven across 26 tables in `miljor_test_db`.
- **Observations Resolved:**
  - **OBS-68 (Exclusive Deadline Boundary & Post-Lock Database Clock):** Enforced authoritative DB server time check (`NOW() > buyer_commitment_deadline` or `NOW() = buyer_commitment_deadline`) dynamically evaluated inside the exclusive row lock transaction. Exact boundary is rejected fail-closed with HTTP 422 `COMMITMENT_DEADLINE_EXPIRED`. Read model evaluates and exposes authoritative deadline status (`is_deadline_expired`, `can_act`).
  - **OBS-69 (Snapshot Historical Immutability):** Commercial qualification snapshot records and digests remain completely append-only and untouched by buyer decisions. All buyer decisions are persisted in dedicated table `pool_buyer_commercial_decisions`.
  - **OBS-70 (Binding Contractual Price Locking & Opt-Out Repricing Immunity):** Buyer `ACCEPT` irrevocably locks unit price (`locked_unit_price = snapshot.final_unit_price`) and computes `locked_total_price`. When peer buyers decline or opt out, committed demand decreases but neither the pool price nor any accepted buyer's locked price is repriced or altered.
- **Core Engine & Architecture:**
  - In `src/services/commercialLifecycleService.js`:
    - `getBuyerCommercialOffer()`: Constructs personalized buyer commercial offer from stored qualification snapshot, supplier acceptance decision, and commercial terms. Enforces strict tenant ownership and account trust. Zero peer buyer PII exposure.
    - `recordBuyerDecision()`: Parent-pool-first `FOR UPDATE` locking, live trust verification, fresh post-lock DB deadline evaluation (`NOW() <= buyer_commitment_deadline`), cohort membership validation, immutable decision insertion (`pool_buyer_commercial_decisions`), state transition (`ACCEPT` -> `CONFIRMED` with `locked_unit_price` / `locked_total_price`; `DECLINE` -> `CANCELLED`), inventory preservation (no release), and transactional outbox business events (`BUYER_OFFER_ACCEPTED`, `BUYER_OFFER_DECLINED`). Intercepts `ER_DUP_ENTRY` to throw HTTP 409 `BUYER_DECISION_ALREADY_RECORDED`.
    - `getPoolCommittedDemandSummary()`: Transparent post-qualification demand accounting (`original_qualified_demand`, `buyer_accepted_demand`, `buyer_declined_demand`, `buyer_pending_demand`, and quorum check `supplier_min_met`).
  - In `src/routes/v1/reservationRoutes.js`: Mounted `GET /:id/final-offer` and `POST /:id/final-decision` guarded by `protect`, `authorizeStrict('BUYER')`, and `idempotencyGuard.required`.
  - In `src/routes/v1/poolRoutes.js`: Mounted `GET /:id/committed-demand-summary` guarded by `protect`.
  - In `src/middlewares/idempotencyGuard.js`: Added `/final-decision` crash recovery reconciliation and resource linkage.
- **Automated Gate Results:**
  - `node tests/part4d4_buyer_commitment_gate.js`: **21/21 assertions passed (100% PASS)** with natural process exit.
  - `node tests/master_regression_runner.js`: **509/509 assertions passed across all 22 suites in 58.39s (100% PASS)** with natural process exit.
- **Database Isolation Verification:**
  - Tests executed strictly against `miljor_test_db`.
  - Development database `miljor_db` verified 100% PRISTINE (pools: 2, reservations: 0, events: 0, mutations: 0, snapshots: 0, supplier_decisions: 0, buyer_decisions: 0, migrations: 17).
- **Milestone Status:**
  - **PART 4D.4: PASS**
  - **BINDING BUYER PRICE LOCKING: VERIFIED**
  - **FINAL BUYER COMMITMENT ENGINE: READY**
  - **CAN START PART 4E.1: YES (Completed in Part 4E.1)**

---

## Part 4E.1 Execution Detail — Order Architecture, Commercial Reconciliation & Financial Safety Foundation
- **Execution Date:** 2026-10-19
- **Objective:** Establish the minimal, secure, and transaction-ready foundation for converting valid buyer commitments into future authoritative orders, verifying commercial reconciliation and payment readiness without creating live orders, checkout sessions, or payment mutations.
- **Database Migration Applied:**
  - Migration 018: `database/migrations/018_order_foundation_and_commercial_linkage.sql`
  - Rollback script: `database/migrations/rollback/018_rollback_order_foundation_and_commercial_linkage.sql`
  - Applied and verified on both `miljor_test_db` and `miljor_db` and tracked in `schema_migrations`.
  - Schema updates: `orders.total_qty` converted from `INT` to `DECIMAL(12,4)`, added `snapshot_id`, `buyer_decision_id`, `currency`, `fk_orders_snapshot`, `fk_orders_buyer_decision`, `uq_orders_buyer_decision` (DB-level exactly-once order constraint), and index `idx_orders_pool_status`.
- **Database Backup & Restorability Proof:**
  - Non-interactive pre-flight backup: `database/backups/miljor_db_backup_2026-10-19T18-54-08-176Z.sql` (65.7 KB).
  - Restoration and integrity proven across 27 tables in `miljor_test_db`.
- **Observations Resolved:**
  - **OBS-71 (Reservation Demand, Commitment Accounting & Converted Orders):** Enforced clean separation across original qualified, supplier accepted, buyer accepted, buyer declined, pending cohort demand, capacity consumption, and converted order demand. Preserved fail-closed handling for unknown reservation statuses.
  - **OBS-72 (Contractual Price Guarantee Verification & Fail-Closed Shortfall):** Confirmed accepted buyer price locks remain binding on the buyer (no retroactive price hikes), but order conversion readiness fails closed with `FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM` and `pricing_guarantee_status = 'UNSUPPORTED_SHORTFALL'` if final demand drops below supplier minimum without an explicit supplier guarantee.
  - **OBS-73 (Exact Merchandise Subtotal vs Final Payable Amount):** Established that `reservations.locked_total_price` strictly represents the merchandise subtotal (`ROUND(locked_qty * locked_unit_price, 2)`). Explicitly broke out financial components in the readiness model (`merchandise_subtotal`, `delivery_fee_status`, `buyer_platform_fee_status`, `tax_status`, `payable_total_status`), guaranteeing no zero-fee assumptions.
  - **OBS-74 (Final-Demand Quorum & State Machine Invariants):** Implemented authoritative multi-state quorum evaluation (`ELIGIBLE_FOR_ORDER`, `BUYER_COMMITMENTS_PENDING`, `FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM`, `ORDER_ALREADY_CONVERTED`).
- **Core Engine & Architecture:**
  - Created `src/services/commercialReconciliationService.js` validating 15 distinct criteria for order conversion readiness.
  - Updated `src/controllers/reservationController.js` adding `getOrderReadiness(req, res)`.
  - Mounted `GET /api/v1/reservations/:id/order-readiness` in `src/routes/v1/reservationRoutes.js` guarded by `protect` and `authorizeStrict('BUYER')`.
  - Enriched `getPoolCommittedDemandSummary` in `src/services/commercialLifecycleService.js` with converted orders demand accounting.
- **Automated Gate Results:**
  - `node tests/part4e1_order_foundation_gate.js`: **23/23 assertions passed (100% PASS)** with natural process exit.
  - `node tests/master_regression_runner.js`: **532/532 assertions passed across all 23 suites in 58.33s (100% PASS)** with natural process exit.
- **Database Isolation Verification:**
  - Tests executed strictly against `miljor_test_db`.
  - Development database `miljor_db` verified 100% PRISTINE (pools: 2, reservations: 0, events: 0, mutations: 0, snapshots: 0, supplier_decisions: 0, buyer_decisions: 0, orders: 0, migrations: 18).
- **Milestone Status:**
  - **PART 4E.1: PASS**
  - **OBS-71: RESOLVED**
  - **OBS-72: RESOLVED**
  - **OBS-73: RESOLVED**
  - **OBS-74: RESOLVED**
  - **COMMERCIAL ORDER READINESS CONTRACT: VERIFIED**
  - **READY FOR PART 4E.2: NO — Awaiting explicit user authorization**

---

## Part 4E.1.1 Execution Detail — Exact Financial Arithmetic, Commercial Reconciliation Consistency & Pre-Order Integrity Hardening
- **Execution Date:** 2026-10-19
- **Objective:** Resolve confirmed or suspected financial-integrity weaknesses in the Part 4E.1 order-readiness foundation without redesigning the service, adding migrations, creating live orders, or mutating database business data.
- **Observations Resolved:**
  - **OBS-75 (Binary Floating-Point Monetary Arithmetic):** Eliminated IEEE-754 binary floating-point calculations from the authoritative financial reconciliation path. Implemented `src/services/exactDecimal.js` using BigInt scaled-integer math with explicit half-up rounding matching MySQL `ROUND(x, 2)`. Corrected edge cases (e.g. `0.0030 * 5.00 = 0.02` vs JS float `0.01`).
  - **OBS-76 (Approximate Monetary Equality & Arbitrary Tolerance):** Replaced arbitrary `0.01` tolerance comparisons (`Math.abs(expected - stored) <= 0.01`) with exact canonical string equality (`exactDecimal.exactDecimalEquals`). Discrepancies of even 1 minor currency unit fail closed with `SUBTOTAL_CALCULATION_MISMATCH`.
  - **OBS-77 (Multi-Query Inconsistent Commercial Read Isolation):** Replaced independent uncoordinated connection queries with a single dedicated connection running in `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; START TRANSACTION WITH CONSISTENT SNAPSHOT;`. Verified with a deterministic concurrency test that concurrent buyer decisions made during evaluation are isolated by the MVCC snapshot, with cleanup guaranteed in `finally`.
  - **OBS-78 (Tax, Fee & Payable-Total Semantics Classification):** Resolved classification ambiguity by updating `tax_status` to `'PENDING_DETERMINATION'` (never asserting unsubstantiated exemption) and doorstep delivery fee to `'PENDING_QUOTE'`, keeping merchandise subtotal strictly isolated from payable total.
- **Automated Gate Results:**
  - `node tests/part4e1_1_financial_hardening_gate.js`: **22/22 assertions passed (100% PASS)** in 0.70s with natural process exit.
  - `node tests/part4e1_order_foundation_gate.js`: **23/23 assertions passed (100% PASS)** in 0.93s with natural process exit.
  - `node tests/master_regression_runner.js`: **554/554 assertions passed across all 24 suites in 37.13s (100% PASS)** with natural process exit.
- **Database & Business Data Preservation:**
  - Zero database migrations or schema alterations required.
  - Development database `miljor_db` verified 100% PRISTINE (pools: 2, reservations: 0, events: 0, mutations: 0, snapshots: 0, supplier_decisions: 0, buyer_decisions: 0, orders: 0, migrations: 18).
  - Zero operational orders, payment sessions, or inventory mutations created.
- **Milestone Status:**
  - **PART 4E.1.1: PASS**
  - **OBS-75: RESOLVED**
  - **OBS-76: RESOLVED**
  - **OBS-77: RESOLVED**
  - **OBS-78: RESOLVED**
  - **EXACT MONETARY RECONCILIATION: VERIFIED**
  - **CONSISTENT READINESS EVALUATION: VERIFIED**
  - **FINANCIAL COMPONENT CLASSIFICATION: VERIFIED**
  - **READY FOR PART 4E.2 TECHNICAL REVIEW: YES**
  - **CAN START PART 4E.2: NO — Awaiting explicit user authorization**

---

## Part 4E.2 Execution Detail — Authoritative Order Conversion, Exactly-Once Order Creation & Financial Integrity Gate
- **Execution Date:** 2026-10-19
- **Objective:** Implement the authoritative workflow that converts a validated buyer ACCEPT commercial commitment into exactly one persisted order row in initial `AWAITING_PAYMENT` state with immutable financial evidence before any payment checkout, without initiating any Safepay payment or payment mutations.
- **Observations Resolved:**
  - **OBS-79 (Order Readiness vs Order Creatable vs Payment-Ready Lifecycle States):** Disentangled the three states. Established that commercial eligibility is necessary but order creation requires approved, complete payable components (`merchandise_subtotal + delivery_fee + buyer_platform_fee`). If delivery fee policy or platform fee is unresolved, order creation fails closed with 422 `PAYABLE_COMPONENTS_UNRESOLVED`. Initial order state is strictly `AWAITING_PAYMENT` before any Safepay interaction.
  - **OBS-80 (Security Trust Boundary on Test Hooks):** Isolated `testHooks` inside `commercialReconciliationService.js` and `orderService.js` behind `process.env.NODE_ENV === 'test'`. Request body/query parameters cannot trigger hooks.
- **Implementation Highlights:**
  - `src/services/orderService.js`:
    - Strict parent-pool-first `FOR UPDATE` locking (`pools` row locked before `reservations` row).
    - Re-validation under lock of qualification snapshot, supplier ACCEPT decision, buyer ACCEPT decision, and quorum/minimum demand.
    - Exact BigInt decimal math via `exactDecimal.js` (no floating-point math, zero tolerance).
    - Approved fee composition: Merchandise subtotal (from locked price), delivery fee (`0.00` for `SUPPLIER_PICKUP`, `150.00` for `STANDARD_DELIVERY`, or flat trip fee; otherwise fails closed), buyer platform fee via `feeService.calculateBuyerFee()`.
    - Exactly-once database constraint `uq_orders_buyer_decision`.
    - Outbox event `ORDER_CREATED` written atomically in same transaction.
    - Pool state remains `CONFIRMED` until checkout/payment phase.
  - `src/controllers/reservationController.js`: Added `createOrder(req, res)` handling `POST /api/v1/reservations/:id/order`.
  - `src/routes/v1/reservationRoutes.js`: Mounted `POST /:id/order` guarded by `protect`, `authorizeStrict('BUYER')`, and `idempotencyGuard.required`.
  - `src/middlewares/idempotencyGuard.js`: Added crash recovery and idempotent replay handling for `orders` resource type and `/order` route.
- **Automated Gate Results:**
  - `node tests/part4e2_order_conversion_gate.js`: **22/22 assertions passed (100% PASS)** in 0.93s with natural process exit.
  - `node tests/master_regression_runner.js`: **576/576 assertions passed across all 25 suites in 39.63s (100% PASS)** with natural process exit.
- **Database & Business Data Preservation:**
  - Zero database migrations needed (Migration 018 schema baseline was 100% sufficient).
  - Development database `miljor_db` verified 100% PRISTINE (pools: 2, reservations: 0, events: 0, mutations: 0, snapshots: 0, supplier_decisions: 0, buyer_decisions: 0, orders: 0, migrations: 18).
  - Zero operational orders, payment sessions, or inventory mutations created.
- **Milestone Status:**
  - **PART 4E.2: PASS**
  - **OBS-79: RESOLVED**
  - **OBS-80: RESOLVED**
  - **AUTHORITATIVE ORDER CONVERSION: VERIFIED**
  - **EXACTLY-ONCE CREATION & REPLAY: VERIFIED**
  - **FINANCIAL COMPOSITION & FAIL-CLOSED GATE: VERIFIED**
  - **ZERO SAFEPAY / PAYMENT INTERACTIONS: VERIFIED**
  - **READY FOR PART 4E.3: YES — Completed in Part 4E.3**

---

## Part 4E.3 Execution Detail — Safepay Sandbox Checkout, Verified Webhooks & Exactly-Once Payment Confirmation
- **Execution Date:** 2026-10-19
- **Objective:** Connect a valid, persisted `AWAITING_PAYMENT` order to Safepay's sandbox hosted-checkout workflow and confirm payment using cryptographically verified provider webhook evidence, while preventing client-controlled amount tampering, race conditions, replay attacks, and premature disbursements.
- **Observations Resolved:**
  - **OBS-81 (Client-Controlled Amount & Currency Tampering in Checkout Initiation):** Checkout session creation never trusts client-supplied amounts or currencies. Amount and currency are fetched strictly from the authoritative database `orders` row. Fails closed if order is not in `AWAITING_PAYMENT` state, if the buyer is suspended, or if currency is not PKR. The third-party Safepay API request is executed outside database write locks. A durable record is created in `payment_attempts` with `status = 'INITIATED'`, and `orders.payment_status` advances to `PAYMENT_INITIATED`.
  - **OBS-82 (Raw Webhook Signature Verification & Exactly-Once Order State Transition):** Webhook intake validates cryptographic HMAC-SHA256 signatures (`X-SFPY-SIGNATURE`) computed against `${timestampHeader}.${rawBody}` using `crypto.timingSafeEqual`. Captured raw body via `express.json({ verify: ... })`. In atomic transaction with row locks on `payment_attempts` and `orders`, validates exact amount and currency match, transitions order to `PAID`, updates attempt to `COMPLETED`, inserts authoritative record in `payments` table with `status = 'PAID'` and `escrow_status = 'HELD_IN_ESCROW'`, and emits transactional outbox event `ORDER_PAID` in `reservation_business_events`. Duplicate webhooks are acknowledged idempotently without state mutation.
- **Database Migration Applied:**
  - Migration 019: `database/migrations/019_safepay_sandbox_payment_attempts.sql` (Tables `payment_attempts` and `payment_webhook_events`).
  - Rollback script: `database/migrations/rollback/019_rollback_safepay_sandbox_payment_attempts.sql`.
  - Applied to `miljor_test_db` and `miljor_db` via `database/runMigrations.js`.
- **Database Backup Verified:**
  - Pre-flight backup: `database/backups/miljor_db_backup_2026-10-19T20-56-35-847Z.sql` (66.4 KB).
  - Restoration into `miljor_test_db` verified with 27/27 tables matching.
- **Files Modified/Created:**
  - `database/migrations/019_safepay_sandbox_payment_attempts.sql`
  - `database/migrations/rollback/019_rollback_safepay_sandbox_payment_attempts.sql`
  - `src/services/safepayAdapter.js` (Pure HTTPS Safepay client: validateConfig, createTracker, constructCheckoutUrl, verifyWebhookSignature)
  - `src/services/safepayCheckoutService.js` (initiateCheckout, processWebhookEvent, getOrderPaymentStatus)
  - `src/controllers/orderController.js` (initiateCheckout, getPaymentStatus)
  - `src/controllers/paymentController.js` (Added handleSafepayWebhook)
  - `src/routes/v1/orderRoutes.js` (POST /:id/checkout, GET /:id/payment-status)
  - `src/routes/v1/paymentRoutes.js` (Mounted unauthenticated POST /webhook/safepay before protect)
  - `src/middlewares/idempotencyGuard.js` (Added payment_attempts crash recovery in reconcileCommittedBusinessOperation)
  - `src/services/exactDecimal.js` (Added toCanonicalString alias)
  - `server.js` (Configured rawBody verification in express.json, mounted /api/v1/orders and /api/v1/webhooks/safepay)
  - `tests/part4e3_safepay_sandbox_payment_gate.js` (28-assertion dedicated test gate)
  - `tests/master_regression_runner.js` (Registered Suite 26; updated database isolation verification)
- **Automated Gate Results:**
  - `node tests/part4e3_safepay_sandbox_payment_gate.js`: **28/28 assertions passed (100% PASS)** in 1.33s with natural process exit.
  - `node tests/master_regression_runner.js`: **604/604 assertions passed across all 26 suites in 55.64s (100% PASS)** with natural process exit.
- **Database & Business Data Preservation:**
  - Migration 019 applied cleanly.
  - Development database `miljor_db` verified 100% PRISTINE (pools: 2, reservations: 0, events: 0, mutations: 0, snapshots: 0, supplier_decisions: 0, buyer_decisions: 0, orders: 0, payment_attempts: 0, payments: 0, migrations: 19).
  - Zero live production charges, refunds, disbursements, or settlement mutations created.
- **Milestone Status:**
  - **PART 4E.3: PASS**
  - **OBS-81: RESOLVED**
  - **OBS-82: RESOLVED**
  - **SAFEPAY SANDBOX CHECKOUT: VERIFIED**
  - **CRYPTOGRAPHIC WEBHOOK VERIFICATION: VERIFIED**
  - **EXACTLY-ONCE PAYMENT CONFIRMATION: VERIFIED**
  - **ESCROW FUNDS HELD_IN_ESCROW: VERIFIED**
  - **ZERO DISBURSEMENTS / SETTLEMENT MUTATIONS: VERIFIED**
  - **AWAITING USER AUTHORIZATION FOR SUBSEQUENT PHASES: YES**

---

## Part 4E.3.6 Execution Detail — Captured Sandbox Payment Recovery & Reconciliation
- **Execution Date:** 2026-10-20
- **Objective:** Recover existing captured Safepay sandbox payment for Order 66 (`ORD-51774214-528C88`, 24,330.00 PKR), investigate missing webhook delivery, independently verify captured status via authenticated Safepay sandbox API, execute controlled transactional reconciliation without manual SQL updates, and prove full financial integrity.
- **Provider Status Verification:**
  - Authenticated query to `GET /order/v1/track_11f5abcf-a392-4a2d-9c99-396f8c63f1ac` returned `state: "TRACKER_ENDED"`, amount `24330 PKR`, transaction token `trans_e47b8706-47b3-4bb8-bbc2-58dcda929441`, and reference `065304`.
  - Transaction signature `5902430cdfbd3704435cdde07cb2d6aeb5d50781b2d6fe707ee8c17424991cff` cryptographically matched HMAC-SHA256 over tracker using `SAFEPAY_SECRET_KEY`.
- **Files Modified/Created:**
  - `src/services/safepayAdapter.js`: Added `fetchTracker(trackerToken, options)` with DNS IPv4 retry resilience.
  - `src/services/safepayCheckoutService.js`: Added `reconcilePaymentWithProvider({ orderId, actor, mockClient })` using the exact same atomic payment confirmation transaction as webhook processing.
  - `src/controllers/orderController.js`: Added `reconcilePayment(req, res)` controller action.
  - `src/routes/v1/orderRoutes.js`: Mounted `POST /api/v1/orders/:id/reconcile` protected with RBAC.
  - `tests/part4e3_6_payment_recovery_gate.js`: Dedicated 18-assertion test suite validating adapter fetch, security defenses (404, 403, 422 for missing attempt, uncaptured, currency mismatch, amount shortfall, forged signature), Order 66 recovery, idempotent replay, read-model, and production DB isolation.
- **Automated Gate Results:**
  - `node tests/part4e3_6_payment_recovery_gate.js`: **18/18 assertions passed (100% PASS)** with natural process exit.
  - `node tests/part4e3_safepay_sandbox_payment_gate.js`: **28/28 assertions passed (100% PASS)** with natural process exit.
- **State Transition & Financial Records (Order 66):**
  - `orders` (ID 66): `order_status = 'PAID'`, `payment_status = 'PAID'`, total amount `24,330.00 PKR`.
  - `payment_attempts` (ID 14): `status = 'COMPLETED'`, tracker `track_11f5abcf-a392-4a2d-9c99-396f8c63f1ac`.
  - `payments` (ID 48): `payment_code = 'PAY-4-528C88-6648'`, `status = 'PAID'`, `escrow_status = 'HELD_IN_ESCROW'`, `amount = 24330.00`, `transaction_ref = 'trans_e47b8706-47b3-4bb8-bbc2-58dcda929441'`.
  - `payment_webhook_events` (ID 43): `event_id = 'evt_rec_trans_e47b8706-47b3-4bb8-bbc2-58dcda929441'`, `processed_status = 'PROCESSED'`.
  - `reservation_business_events` (ID 1549): Outbox event `ORDER_PAID` emitted with full metadata.
- **Database & Business Data Preservation:**
  - Zero database schema alterations or migrations required.
  - Development database `miljor_db` verified 100% PRISTINE (pools: 2, reservations: 0, events: 0, mutations: 0, snapshots: 0, supplier_decisions: 0, buyer_decisions: 0, orders: 0, payment_attempts: 0, payments: 0, migrations: 19).
  - Zero live production charges, duplicate payment rows, runaway attempts, or manual SQL updates created.
- **Milestone Status:**
  - **PART 4E.3.6: PASS**
  - **PROVIDER CAPTURE: VERIFIED**
  - **ORDER 66: PAID**
  - **PAYMENT RECORD: VERIFIED**
  - **IDEMPOTENCY: PASS**
  - **DEVELOPMENT DB: UNTOUCHED**
  - **PART 4E.3 FINAL GATE: PASS**



