# MilJor — Master Observations & Defects Register

This register documents all architectural, security, database, concurrency, and financial observations across Parts 0 through 4B.3, their root cause analysis, corrective changes implemented, verified test evidence, and status prior to Part 4C.1.

---

## Observations Status Summary Table

| ID | Observation Area | Severity | Discovered Phase | Current Status | Release Blocking | Responsible Phase | Evidence / Test File |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **OBS-01** | Authentication, RBAC & Logout Audit | HIGH | Part 2 | **RESOLVED** | NO | Part 2 / Part 10 | `tests/part2_security_gate.js` (16/16) |
| **OBS-02** | Database Test Isolation & Clean Teardown | CRITICAL | Part 1 | **RESOLVED** | NO | Part 1 | `database/verifyBackupRestoration.js`, All suites |
| **OBS-03** | Schema, Migrations & Decimal Storage | HIGH | Part 1 / 4B.1 | **RESOLVED** | NO | Part 4B.1 | `tests/part4b1_pool_foundation_gate.js` (16/16) |
| **OBS-04** | Exact Product Specifications & Canonical Hashes | HIGH | Part 3 / 3.1 | **RESOLVED** | NO | Part 3.1 | `tests/part3_specification_gate.js` (15/15) |
| **OBS-05** | Supplier Listing, MOQ & Stock Availability | MEDIUM | Part 3 / 3.1 | **RESOLVED** | NO | Part 3.1 | `tests/part3_specification_gate.js` (15/15) |
| **OBS-06** | Four-Way Product/Listing Linkage | HIGH | Part 4A / 4B.2 | **RESOLVED** | NO | Part 4B.2 | `tests/part4b2_pool_creation_gate.js` (22/22) |
| **OBS-07** | Atomic DRAFT Pool Creation | HIGH | Part 4B.2 | **RESOLVED** | NO | Part 4B.2 | `tests/part4b2_pool_creation_gate.js` (22/22) |
| **OBS-08** | Tier Pricing Engine, Boundaries & Monotonicity | HIGH | Part 4A / 4B.3 | **RESOLVED** | NO | Part 4B.3 | `tests/part4b3_pool_publishing_gate.js` (25/25) |
| **OBS-09** | Physical Dimension & Indivisible Packaging | HIGH | Part 3 / 4B.2 | **RESOLVED** | NO | Part 4B.2 / 4B.3 | `tests/part4b2_pool_creation_gate.js`, `part4b3` |
| **OBS-10** | Inventory Allocation & Overselling Prevention | CRITICAL | Part 4B.1 / 4B.3 | **RESOLVED** | NO | Part 4B.3 | `tests/part4b3_pool_publishing_gate.js` (25/25), `pre4c1` |
| **OBS-11** | Silent Pool Cancellation Guard with Active Reservations | HIGH | Pre-4C.1 Gate | **RESOLVED** | NO | Pre-4C.1 / Part 4C.1 | `tests/pre4c1_concurrency_hardening_gate.js` (Assertion 8) |
| **OBS-12** | Idempotency Crash Recovery & Payload Fingerprinting | HIGH | Part 4B.2 / 4B.3 | **RESOLVED** | NO | Pre-4C.1 Gate | `tests/pre4c1_concurrency_hardening_gate.js` (Assertion 3, 4) |
| **OBS-13** | Pool Publishing Lifecycle & Timestamp Exclusion | MEDIUM | Part 4B.3 | **RESOLVED** | NO | Part 4B.3 | `tests/part4b3_pool_publishing_gate.js` (25/25), `pre4c1` |
| **OBS-14** | Payment, Safepay Sandbox & Settlement Boundaries | MEDIUM | Part 4A.1 | **RESOLVED (ARCH)** | NO | Part 5 | `docs/MILJOR_REGULAR_POOL_ARCHITECTURE.md` |
| **OBS-15** | Deployment, OneDrive & Credential Hygiene | HIGH | Part 0 / 1 | **RESOLVED** | NO | DevSecOps | `.gitignore`, `.env.example`, Backup Sanitization |
| **OBS-16** | DB vs Application Timezone Authority in Temporal Expiry | MEDIUM | Part 4B.4 | **RESOLVED** | NO | Part 4B.4.1 | `tests/part4b4_1_reservation_hardening_gate.js` (Tests 1, 2) |
| **OBS-17** | Transaction Isolation & Pool Row Serialization | CRITICAL | Part 4B.4 | **RESOLVED** | NO | Part 4B.4.1 | `tests/part4b4_1_reservation_hardening_gate.js` (Tests 3, 4) |
| **OBS-18** | Dynamic Tier Repricing vs Locked Prices Immutability | HIGH | Part 4B.4 | **RESOLVED** | NO | Part 4B.4.1 | `tests/part4b4_1_reservation_hardening_gate.js` (Tests 5, 6) |
| **OBS-19** | Supplier and Listing Eligibility Validation | HIGH | Part 4B.4 | **RESOLVED** | NO | Part 4B.4.1 | `tests/part4b4_1_reservation_hardening_gate.js` (Tests 7, 8, 9) |
| **OBS-20** | One Active Reservation Per Buyer Constraint | HIGH | Part 4B.4.1 | **RESOLVED** | NO | Part 4B.4.1 | `tests/part4b4_1_reservation_hardening_gate.js` (Test 10) |
| **OBS-21** | Supplier Verification & Eligibility Validation | CRITICAL | Part 4B.4.2 | **RESOLVED** | NO | Part 4B.4.2 | `tests/part4b4_2_observations_integrity_gate.js` (Tests 1–8) |
| **OBS-22** | Single Authoritative Timezone & Expiry Evaluation | HIGH | Part 4B.4.2 | **RESOLVED** | NO | Part 4B.4.2 | `tests/part4b4_2_observations_integrity_gate.js` (Tests 9–10) |
| **OBS-23** | Protect Estimated Prices & Financially Locked Commitments | CRITICAL | Part 4B.4.2 | **RESOLVED** | NO | Part 4B.4.2 | `tests/part4b4_2_observations_integrity_gate.js` (Tests 11–13) |
| **OBS-34** | Symmetrical Supplier/Pool Eligibility | MEDIUM | Part 4C.2B | **RESOLVED** | NO | Part 4C.2B | `tests/part4c2b_events_visibility_gate.js` (Tests 22–23) |
| **OBS-35** | Event ID Uniqueness & Operation Scoping | HIGH | Part 4C.2C | **RESOLVED** | NO | Part 4C.2C | `tests/part4c2_combined_integration_gate.js` (Tests 1–4, 17) |
| **OBS-36** | Explicit Event INSERT & Duplicate Recovery | HIGH | Part 4C.2C | **RESOLVED** | NO | Part 4C.2C | `tests/part4c2_combined_integration_gate.js` (Tests 5–7, 10, 18) |
| **OBS-37** | Transactional Event Atomicity & Ordering | HIGH | Part 4C.2C | **RESOLVED** | NO | Part 4C.2C | `tests/part4c2_combined_integration_gate.js` (Tests 18, 23) |
| **OBS-38** | Event ID Collision Correctness & Probabilistic Bounds | MEDIUM | Part 4C.2C.1 | **RESOLVED** | NO | Part 4C.2C.1 | `tests/part4c2_combined_integration_gate.js` (Tests 1–4, 7–9) |
| **OBS-39** | Complete Deep Semantic Duplicate Verification | HIGH | Part 4C.2C.1 | **RESOLVED** | NO | Part 4C.2C.1 | `tests/part4c2_combined_integration_gate.js` (Tests 6, 8, 9, 25) |
| **OBS-40** | Commit-Ordering vs Monotonic Auto-Increment Ordering | HIGH | Part 4C.2C.1 | **RESOLVED** | NO | Part 4C.2C.1 | `tests/part4c2_combined_integration_gate.js` (Tests 15, 23, 24) |
| **OBS-75** | Binary Floating-Point Monetary Arithmetic | HIGH | Part 4E.1.1 | **RESOLVED** | NO | Part 4E.1.1 | `tests/part4e1_1_financial_hardening_gate.js` (Tests 1–6) |
| **OBS-76** | Approximate Monetary Equality & Arbitrary Tolerance | HIGH | Part 4E.1.1 | **RESOLVED** | NO | Part 4E.1.1 | `tests/part4e1_1_financial_hardening_gate.js` (Tests 7–8, 10–11) |
| **OBS-77** | Multi-Query Inconsistent Commercial Read Isolation | HIGH | Part 4E.1.1 | **RESOLVED** | NO | Part 4E.1.1 | `tests/part4e1_1_financial_hardening_gate.js` (Tests 12–13) |
| **OBS-78** | Tax, Fee & Payable-Total Semantics Classification | MEDIUM | Part 4E.1.1 | **RESOLVED** | NO | Part 4E.1.1 | `tests/part4e1_1_financial_hardening_gate.js` (Tests 14–17) |

---

## Detailed Observations & Resolutions

### OBS-01: Authentication, Authorization & Session Management
- **Description:** Prevent privilege escalation during registration; enforce least-privilege administrative RBAC; reject suspended accounts in real-time; secure object-level authorization across buyer and supplier boundaries; audit sensitive administrative actions.
- **Root Cause Analysis:** Initial implementation accepted user-supplied `role: "ADMIN"` on registration and lacked real-time active status verification in JWT middleware.
- **Corrective Changes:**
  - `src/controllers/authController.js`: Registration strictly defaults to `role = 'BUYER'`; passwords hashed with bcrypt (12 salt rounds); anti-enumeration generic error messages.
  - `src/middlewares/authGuard.js`: Real-time database check on `is_verified` and `verification_status` on every authenticated request; rejected blocked/suspended users (403 `ACCOUNT_SUSPENDED`); added least-privilege guards (`FINANCE_ADMIN`, `OPERATIONS_ADMIN`, `VERIFICATION_ADMIN`, `SUPPORT_ADMIN`).
  - Added object-level ownership checks preventing cross-user inspection or manipulation of pools, listings, and reservations.
- **Test Evidence:** `tests/part2_security_gate.js` (**16/16 assertions passed**).
- **Residual Risks & Launch Controls:**
  - Token blacklisting / revocation list for instantaneous JWT invalidation across distributed instances.
  - Refresh token rotation (to be integrated when mobile client requires long-lived sessions).
  - Rate limiting on `/api/v1/auth/login` (currently protected by global rate limiter in `server.js`).

---

### OBS-02: Database Isolation & Test Cleanliness
- **Description:** Guarantee that automated test suites execute exclusively against `miljor_test_db` and never alter `miljor_db`. Ensure background schedulers are disabled during tests and teardowns do not perform destructive wildcards.
- **Root Cause Analysis:** Risk of environmental misconfiguration causing test execution against development data.
- **Corrective Changes:**
  - `src/config/db.js`: Enforces dynamic database selection (`miljor_test_db` when `NODE_ENV === 'test'`).
  - `server.js`: Wrapped startup in `require.main === module` to prevent automatic port binding or background scheduler startup during imports.
  - Test suites include explicit database assertion (`SELECT DATABASE()`) verifying `miljor_test_db` before executing assertions.
  - Test cleanup strictly targets ephemeral fixtures created during the test run using specific primary keys.
- **Test Evidence:** Verified before and after runs: `miljor_db` retains exactly 7 users, 8 specifications, 3 listings, and 2 historical pools.

---

### OBS-03: Schema, Migrations & Commodity Precision
- **Description:** Eliminate duplicate legacy tables; manage schema evolution via tracked, versioned migrations; ensure decimal storage for financial amounts and commodity quantities.
- **Root Cause Analysis:** Legacy codebase contained duplicate `escrow_payments` and integer/float columns for fractional physical commodities.
- **Corrective Changes:**
  - Dropped duplicate `escrow_payments`; unified payments under `payments` with escrow tracking fields.
  - Created `schema_migrations` tracking migrations `001` through `007` executed via `database/runMigrations.js`.
  - Upgraded quantity columns across `pools`, `pool_price_tiers`, and `reservations` to `DECIMAL(12,4)`.
  - Financial columns strictly enforced as `DECIMAL(12,2)`.
- **Test Evidence:** `tests/phase1_gate.js` (12/12) and `tests/part4b1_pool_foundation_gate.js` (16/16).

---

### OBS-04: Exact Product Specifications & Canonical Identity
- **Description:** Ensure distinct physical commodities (e.g. 1121 Extra Long Rice vs Super Kernel, Kainat 1121, different milling grades) cannot accidentally merge or create duplicates.
- **Root Cause Analysis:** Generic product categories conflated different commercial qualities.
- **Corrective Changes:**
  - `src/services/specificationService.js`: Implemented deterministic SHA-256 canonical hashing over normalized packaging type, pack size, pack unit, purchasing unit, and sorted JSON attributes.
  - `src/services/unitConversionService.js`: Enforced strict physical dimension separation (Mass vs Volume; 16L != 16kg).
- **Test Evidence:** `tests/part3_specification_gate.js` (**15/15 assertions passed**).

---

### OBS-05: Supplier Listing & MOQ Semantics
- **Description:** Prevent conflation between a buyer's minimum order quantity (`buyer_min_qty`) and a supplier's aggregate fulfillment threshold (`supplier_min_qty`). Exclude out-of-stock listings from buyer searches.
- **Root Cause Analysis:** A single generic `min_quantity` previously blocked pooled group buying economics.
- **Corrective Changes:**
  - `src/controllers/supplierListingController.js`: Decoupled `buyer_min_qty` and `supplier_min_qty`.
  - `src/repositories/supplierListingRepo.js`: Filtered out inactive or out-of-stock listings (`available_stock <= 0` or `< buyer_min_qty`) from public searches and multi-supplier comparisons.
  - Added audit logging to `supplier_listing_price_history`.
- **Test Evidence:** `tests/part3_specification_gate.js` (**15/15 assertions passed**).

---

### OBS-06: Four-Way Linkage Hierarchy
- **Description:** Enforce strict relationship chain: `product_id -> product_spec_id -> supplier_listing_id -> authenticated supplier`.
- **Root Cause Analysis:** Pool creation allowed passing mismatched product and specification IDs or referencing listings owned by other suppliers.
- **Corrective Changes:**
  - `src/controllers/poolController.js`: Validates specification belongs to master product; validates listing belongs to specification; verifies listing is owned by authenticated supplier (`req.user.id`).
  - Historical pools 1 and 2 preserved with `product_spec_id = NULL` and `supplier_listing_id = NULL` without broken foreign keys.
- **Test Evidence:** `tests/part4b2_pool_creation_gate.js` (**22/22 assertions passed**).

---

### OBS-07: Atomic DRAFT Pool Creation
- **Description:** Guarantee that creating a pool draft with price tiers and audit logs is completely atomic and transactional.
- **Root Cause Analysis:** Previous pool creation performed multiple un-bracketed database queries, risking orphaned pool rows on tier insertion failures.
- **Corrective Changes:**
  - `src/controllers/poolController.js`: Uses dedicated connection from pool, begins transaction (`connection.beginTransaction()`), inserts pool row, inserts price tiers, writes system audit log, and commits. Rolls back completely on error.
- **Test Evidence:** `tests/part4b2_pool_creation_gate.js` (Assertion 17).

---

### OBS-08: Deterministic Tier Pricing Engine
- **Description:** Ensure continuous, contiguous intervals without gaps or overlaps from `supplier_min_qty` to `max_capacity` (or `target_qty`); enforce non-increasing prices.
- **Root Cause Analysis:** Inconsistent tier boundaries and ambiguity between target volume and maximum ceiling.
- **Corrective Changes:**
  - `src/services/tierPricingService.js`:
    - Enforces contiguity: $\text{min\_qty}_{k+1} = \text{max\_qty}_k + 1$ (discrete) or $\text{max\_qty}_k$ (decimal).
    - Enforces non-increasing prices: $\text{price}_k \le \text{price}_{k-1}$.
    - Validates that tiers cover through `max_capacity`.
    - Evaluates deterministic applicable pricing based on aggregate volume.
- **Test Evidence:** `tests/part4b3_pool_publishing_gate.js` (Assertions 1–8) and `tests/pre4c1_concurrency_hardening_gate.js` (Assertions 10, 11).

---

### OBS-09: Canonical Units & Indivisible Packaging
- **Description:** Enforce that discrete packaging units (`bag`, `tin`, `carton`, `box`) reject fractional quantities while allowing exact decimal quantities for bulk commodities (`kg`, `L`).
- **Root Cause Analysis:** Fractional pack quantities (e.g. 10.5 bags) are commercially invalid for indivisible sealed goods.
- **Corrective Changes:**
  - `src/services/unitConversionService.js`: Categorizes discrete vs divisible units.
  - `src/controllers/poolController.js` & `src/services/tierPricingService.js`: Rejects fractional quantities for discrete units with 400 `FRACTIONAL_PACK_REJECTED` and `FRACTIONAL_TIER_QUANTITY`.
- **Test Evidence:** `tests/part4b2_pool_creation_gate.js` (Assertion 13) and `tests/part4b3_pool_publishing_gate.js` (Assertion 5).

---

### OBS-10: Inventory Allocation & Overselling Prevention
- **Description:** Soft-hold supplier inventory on pool publishing to prevent simultaneous overpromising across multiple pools or direct orders.
- **Root Cause Analysis:** Pools previously had no mechanism to commit or track available-to-promise inventory.
- **Corrective Changes:**
  - Migration 006 created `supplier_inventory_allocations`.
  - `POST /api/v1/pools/:id/publish` locks the underlying listing row `FOR UPDATE`, computes available stock minus active (`COMMITTED`/`PENDING`) allocations, and inserts a `COMMITTED` allocation for `max_capacity` (or `target_qty`).
  - Concurrent publishing attempts exceeding inventory reject with 409 `INSUFFICIENT_STOCK_FOR_PUBLISHING`.
- **Test Evidence:** `tests/part4b3_pool_publishing_gate.js` (Assertions 20, 22) and `tests/pre4c1_concurrency_hardening_gate.js` (Assertions 2, 6).

---

### OBS-11: Silent Pool Cancellation Guard with Active Reservations
- **Description:** Prevent suppliers from silently cancelling pools that already have active buyer reservations when the full buyer cancellation/refund/notification pipeline is not yet implemented.
- **Root Cause Analysis:** Initial `cancelPool` cancelled reservations and allocations immediately without refund/notification guards.
- **Corrective Changes:**
  - Added check in `poolController.cancelPool`: If the pool has active reservations (`status IN ('RESERVED', 'CONFIRMED')`), cancellation by supplier is safely blocked with 422 `RESERVED_POOL_CANCELLATION_BLOCKED`.
  - Full automated reservation cancellation and refund dispatch is explicitly scheduled for Part 4C.1 and Part 5.
- **Test Evidence:** `tests/pre4c1_concurrency_hardening_gate.js` (Assertion 8).

---

### OBS-12: Idempotency Crash Recovery, Business Reconciliation & Payload Fingerprinting
- **Description:** Ensure idempotency keys are mandatory on mutations; protect against payload collisions; recover cleanly if a server crashes during execution without blindly deleting placeholders or duplicating committed business transactions.
- **Root Cause Analysis:** Blindly deleting `response_status = 0` placeholders older than 60s risked duplicating mutations if the business transaction committed but the process crashed before saving the HTTP response.
- **Corrective Changes:**
  - Migration 008 added `status ENUM('PENDING', 'COMPLETED', 'FAILED', 'UNKNOWN')`, `resource_type`, `resource_id`, `last_heartbeat_at`, and `idx_idempotency_actor_key`.
  - `src/middlewares/idempotencyGuard.js`:
    - Mandatory key enforcement on mutations (`idempotencyGuard.required`).
    - Computes SHA-256 `request_hash` across `method + url + body`; rejects mismatched payload reuse with 409 `IDEMPOTENCY_PAYLOAD_CONFLICT`.
    - Evaluates inactive records (>60s) via `reconcileCommittedBusinessOperation`: checks database and system audit log. If mutation committed before crash, reconstructs response and transitions record to `COMPLETED` without re-executing.
    - Active operations maintained with 15-second heartbeat loop updating `last_heartbeat_at` so active long-running requests are never purged.
    - Indeterminate operations (`UNKNOWN`) safely return 409 `IDEMPOTENCY_OUTCOME_UNKNOWN`.
    - Actor scoping prevents cross-user key collision or hijacking with 403 `IDEMPOTENCY_ACTOR_MISMATCH`.
  - `src/controllers/poolController.js`: Atomically links `resource_type = 'pools'` and `resource_id = poolId` inside the business transaction prior to commit.
- **Test Evidence:** `tests/pre4b4_idempotency_crash_recovery_gate.js` (11/11 passing assertions across all failure/crash/race simulation scenarios) and `tests/pre4c1_concurrency_hardening_gate.js`.

---

### OBS-13: Pool Publishing Lifecycle & Timestamp Validity
- **Description:** Ensure DRAFT pools remain private; commercial terms lock upon publishing; expired ACTIVE pools are not displayed as open.
- **Root Cause Analysis:** Status-only filters could show expired pools if background closing scheduler had not yet run.
- **Corrective Changes:**
  - `src/repositories/poolRepo.js`: `findAllActive` enforces `WHERE p.status = 'ACTIVE' AND p.expires_at > NOW()`.
  - `src/controllers/poolController.js`: Rejects edits to `ACTIVE` pools with 422 `INVALID_POOL_STATE`. Rejects publishing already `ACTIVE` pools.
- **Test Evidence:** `tests/part4b3_pool_publishing_gate.js` (Assertions 12, 21, 23, 24) and `tests/pre4c1_concurrency_hardening_gate.js` (Assertion 9).

---

### OBS-14: Payment & Order State Machine Boundaries
- **Description:** Prevent conflation between pool qualification, reservation price locking, order generation, and payment intent confirmation.
- **Root Cause Analysis:** Early documentation draft incorrectly showed payment occurring before order creation.
- **Corrective Changes:**
  - Fully reconciled in `docs/MILJOR_REGULAR_POOL_ARCHITECTURE.md`:
    $$\text{Reserve} \to \text{Pool Met} \to \text{Supplier Confirms} \to \text{Buyer Locks Price} \to \text{Order Created (AWAITING\_PAYMENT)} \to \text{Payment Intent} \to \text{Safepay Confirms} \to \text{PAID} \to \text{Fulfilment}$$
  - Acknowledged Safepay Sandbox as target gateway; platform ledger accurately identified as fee distribution records.
- **Test Evidence:** Documentation aligned; zero premature payment routes mounted.

---

### OBS-15: Deployment, Backup & Credential Safety
- **Description:** Exclude secrets from version control; identify risks of cloud-synced credential folders; provide verified restorable backups.
- **Root Cause Analysis:** Local `.env` and backups could be exposed if not strictly ignored.
- **Corrective Changes:**
  - `.gitignore` verified: excludes `.env`, `database/backups/`, `node_modules/`.
  - `database/backupDatabase.js` generates point-in-time restorable backups.
  - Verified restoration into `miljor_test_db` with all 22 tables matching.
- **Test Evidence:** Backup `miljor_db_backup_2026-10-18T14-27-30-847Z.sql` (48.7 KB) verified restorable.

---

### OBS-16: DB vs Application Timezone Authority in Temporal Expiry
- **Description:** Timezone differences between the Node.js application process runtime (`new Date()`) and the MySQL database server (`NOW()`) can cause premature or delayed expiration evaluation if JavaScript timestamps are naively compared against MySQL `DATETIME`/`TIMESTAMP` strings.
- **Root Cause Analysis:** Node.js executes in UTC or server local time, while MySQL may be configured with a different timezone (e.g. system offset). When backdating records in SQL (e.g. `DATE_SUB(NOW(), INTERVAL 1 HOUR)`), comparing `new Date(pool.expires_at) <= new Date()` in JavaScript can yield false negatives if the database clock is ahead of the application runtime.
- **Corrective Changes:**
  - `src/config/db.js`: Configured `timezone: 'Z'` on the MySQL connection pool for authoritative UTC date handling.
  - `src/controllers/reservationController.js`: Includes `(p.expires_at <= NOW()) AS is_expired` directly in the database row lock query (`FOR UPDATE`), making MySQL the authoritative source of temporal truth.
  - Evaluates both `Boolean(pool.is_expired)` and `poolExpiryDate <= new Date()` at the closed boundary (`<=`), rejecting expired pools with 422 `POOL_EXPIRED`.
- **Test Evidence:** `tests/part4b4_1_reservation_hardening_gate.js` (Test 1: Past expiry rejected; Test 2: Exact boundary `expires_at = NOW()` evaluated as closed).

---

### OBS-17: Transaction Isolation & Pool Row Serialization
- **Description:** Concurrent reservation requests must not oversubscribe pool capacity or create inconsistency between the cached `pools.current_qty` and the actual sum of reservations.
- **Root Cause Analysis:** Attempting to lock aggregate sums via `SELECT SUM(quantity) ... FOR UPDATE` introduces aggregate gap-locks which can cause deadlocks or permit phantom reads under concurrent transactions if the parent pool row is not serialized first.
- **Corrective Changes:**
  - `src/controllers/reservationController.js`: Strict lock hierarchy: the parent pool row (`SELECT ... FROM pools p WHERE p.id = ? FOR UPDATE`) is locked first as the primary serialization point.
  - Aggregate reservation queries inside the transaction use simple `WHERE pool_id = ? AND status IN ('RESERVED', 'CONFIRMED', 'PAID')` without vulnerable aggregate gap-locks.
  - Capacity calculation and `current_qty` cache updates occur atomically within the serialized transaction.
- **Test Evidence:** `tests/part4b4_1_reservation_hardening_gate.js` (Test 3: Concurrent final-capacity race across independent connections strictly serializes; Test 4: 100% mathematical consistency between `current_qty` and reservation sums).

---

### OBS-18: Dynamic Tier Repricing vs Locked Prices Immutability
- **Description:** When new reservations push pool aggregate quantity across pricing tiers, earlier active reservations must be dynamically repriced down, but financially committed/locked prices must remain strictly immutable.
- **Root Cause Analysis:** Unconditional bulk updates (`UPDATE reservations SET unit_price = ? WHERE pool_id = ?`) would illegally overwrite already-committed prices, corrupting buyer contracts and order settlements.
- **Corrective Changes:**
  - `src/controllers/reservationController.js`: Retroactive tier repricing is explicitly guarded:
    `WHERE pool_id = ? AND status = 'RESERVED' AND locked_unit_price IS NULL AND id != ?`.
  - Initial buyer reservations receive estimated prices with `locked_unit_price = NULL` and `locked_total_price = NULL`.
  - Any reservation with `locked_unit_price IS NOT NULL` or status in (`CONFIRMED`, `PAID`) is strictly immune to retroactive repricing.
- **Test Evidence:** `tests/part4b4_1_reservation_hardening_gate.js` (Test 5: Active RESERVED items receive estimated prices; Test 6: Financially locked prices remain completely immutable when aggregate crosses tiers).

---

### OBS-19: Supplier and Listing Eligibility Validation
- **Description:** Prevent buyer reservations from succeeding if the pool's supplier has been suspended/blocked, if the underlying listing is paused/inactive, or if pool specification identity has been desynchronized from the listing.
- **Root Cause Analysis:** Initial reservation controller checked pool status and expiry, but did not verify the real-time eligibility of the supplier or the underlying listing during reservation placement.
- **Corrective Changes:**
  - `src/controllers/reservationController.js`: Added real-time checks within the transaction:
    1. Supplier verification: `verification_status !== 'BLOCKED'` and `buyer_trust_status !== 'SUSPENDED'` $\to$ 422 `SUPPLIER_INELIGIBLE`.
    2. Listing status: `listing_status === 'ACTIVE'` $\to$ 422 `LISTING_INACTIVE`.
    3. Specification and supplier linkage: `pool.listing_supplier_id === pool.supplier_id` and `pool.listing_spec_id === pool.product_spec_id` $\to$ 422 `SPECIFICATION_MISMATCH`.
- **Test Evidence:** `tests/part4b4_1_reservation_hardening_gate.js` (Test 7: Supplier suspension rejected; Test 8: Paused listing rejected; Test 9: Specification mismatch rejected).

---

### OBS-20: One Active Reservation Per Buyer Constraint
- **Description:** Prevent a buyer from holding multiple fragmented active reservations in the same regular pool, while allowing re-entry if an earlier reservation was cancelled or expired.
- **Root Cause Analysis:** Application allowed multiple reservations from the same buyer, creating fragmented commitments and potential capacity hoarding. A simple unconditional database unique constraint on `(pool_id, buyer_id)` would prevent legitimate re-entry after cancellation or expiration.
- **Corrective Changes:**
  - `database/migrations/009_one_active_reservation_per_buyer.sql`:
    - Replaced unconditional unique index with non-unique index `idx_reservations_buyer_pool (buyer_id, pool_id)`.
    - Added MySQL 8 `VIRTUAL` generated column:
      `active_pool_buyer_key VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN status IN ('RESERVED', 'CONFIRMED', 'PAID') THEN CONCAT(pool_id, '_', buyer_id) ELSE NULL END) VIRTUAL`.
    - Added unique index: `idx_unique_active_pool_buyer (active_pool_buyer_key)`.
  - `src/controllers/reservationController.js`: Checks for active reservation within the transaction; returns 409 `ACTIVE_RESERVATION_EXISTS` with existing reservation details; translates `ER_DUP_ENTRY` to 409.
- **Test Evidence:** `tests/part4b4_1_reservation_hardening_gate.js` (Test 10: Active reservation conflict returns 409 with safe reference; idempotency replay returns original 201; CANCELLED/EXPIRED records allow re-entry).

---

### OBS-21: Supplier Verification & Eligibility Validation
- **Description:** Replace negative eligibility checks (`!== 'BLOCKED'`) with positive, affirmative verification of supplier users and supplier profiles. Prevent buyer trust status from falsely verifying suppliers. Ensure pool specification and supplier ownership strictly match underlying active listing.
- **Root Cause Analysis:** Initial implementation relied on negative checks against blocked statuses and inadvertently referenced `buyer_trust_status` on the supplier user row. Furthermore, it did not verify the `supplier_profiles` table or affirmatively ensure that the user has `role = 'SUPPLIER'`, `is_verified = 1`, and `verification_status = 'VERIFIED'`.
- **Corrective Changes:**
  - `src/controllers/reservationController.js`:
    - Added join to `supplier_profiles sp ON sp.supplier_id = u.id` and selected `u.role AS supplier_role`, `u.is_verified AS supplier_is_verified`, `u.verification_status AS supplier_user_verification`, `sp.verification_status AS supplier_profile_verification`.
    - Enforced affirmative verification:
      ```javascript
      if (pool.supplier_role !== 'SUPPLIER' ||
          Number(pool.supplier_is_verified) !== 1 ||
          pool.supplier_user_verification !== 'VERIFIED' ||
          pool.supplier_profile_verification !== 'VERIFIED') {
        return res.status(422).json({
          error: { code: 'SUPPLIER_INELIGIBLE', message: 'The supplier hosting this pool is not in an active, verified status.' }
        });
      }
      ```
    - Completely removed any reliance on `buyer_trust_status` when evaluating suppliers.
    - Verified listing ownership (`listing_supplier_id === supplier_id`) and specification match (`listing_spec_id === product_spec_id`).
- **Test Evidence:** `tests/part4b4_2_observations_integrity_gate.js` (Tests 1–8: Verified active supplier succeeds; unverified user, pending profile, rejected profile, unverified flag, buyer trust spoof attempt, listing ownership mismatch, and paused listing all fail closed).

---

### OBS-22: Single Authoritative Timezone & Expiry Evaluation
- **Description:** Eliminate divergent Node.js and MySQL timezone calculations. Establish the locked database transaction evaluated in UTC as the sole authoritative source of temporal decision-making.
- **Root Cause Analysis:** Application code ran both a SQL check `(p.expires_at <= NOW())` and a redundant JavaScript check `poolExpiryDate <= new Date()`. Clock drifts, differing VM offsets, or leap second handling between Node and MySQL containers could lead to conflicting expiration determinations.
- **Corrective Changes:**
  - `src/controllers/reservationController.js`:
    - Removed redundant Node.js `new Date()` clock evaluation.
    - SQL query in locked row retrieval directly evaluates `(p.expires_at <= NOW()) AS is_expired`.
    - Controller evaluates solely `Boolean(pool.is_expired)`.
    - Exact boundary equality (`expires_at <= NOW()`) is evaluated as closed (returns 422 `POOL_EXPIRED`).
- **Test Evidence:** `tests/part4b4_2_observations_integrity_gate.js` (Test 9: Past expiry rejected authoritatively by DB clock; Test 10: Exact boundary equality `expires_at = NOW()` evaluated as closed).

---

### OBS-23: Protect Estimated Prices & Financially Locked Commitments
- **Description:** Guarantee that dynamic tier repricing strictly updates active `RESERVED` items and never mutates financially committed prices or non-`RESERVED` reservations.
- **Root Cause Analysis:** If dynamic repricing queries fail to explicitly exclude locked prices, newly joined reservations could inadvertently modify historical committed unit prices on confirmed or paid items.
- **Corrective Changes:**
  - `src/controllers/reservationController.js`:
    - Initial reservations are created with estimated tier prices and explicit `locked_unit_price = NULL` and `locked_total_price = NULL`.
    - Dynamic retroactive repricing query strictly filters:
      `WHERE pool_id = ? AND status = 'RESERVED' AND locked_unit_price IS NULL AND id != ?`.
    - Any reservation in non-`RESERVED` status (`CONFIRMED`, `PAID`, etc.) or possessing a non-NULL `locked_unit_price` is completely untouched.
- **Test Evidence:** `tests/part4b4_2_observations_integrity_gate.js` (Test 11: Estimated price set with null locked prices; Test 12: Tier repricing updates active RESERVED items; Test 13: CONFIRMED and price-locked reservations remain strictly immutable).

---

### OBS-24: Legacy Pools Protection Without Fabricated Specifications
- **Description:** Protect historical pools 1 and 2 (created before Migration 006 without `product_spec_id` or `supplier_listing_id`) from being corrupted or participating in new commercial reservations, while preserving them completely untouched in the database.
- **Root Cause Analysis:** Allowing historical pools lacking product specifications and supplier listing identities to accept reservations would corrupt unit economics, inventory allocations, and physical dimension checks. Fabricating dummy specifications or updating historical rows violates data integrity.
- **Corrective Changes:**
  - `src/controllers/reservationController.js`:
    - Added strict legacy pool guard:
      ```javascript
      if (!pool.product_spec_id || !pool.supplier_listing_id) {
        return res.status(422).json({
          error: {
            code: 'LEGACY_POOL_READ_ONLY',
            message: 'This historical pool lacks verified product specification identity and is closed to new buyer reservations.'
          }
        });
      }
      ```
  - `src/repositories/poolRepo.js`:
    - `findAllActive`: Includes computed columns:
      - `(p.product_spec_id IS NULL OR p.supplier_listing_id IS NULL) AS is_legacy`
      - `CASE WHEN (p.product_spec_id IS NULL OR p.supplier_listing_id IS NULL) THEN 'LEGACY_NOT_AVAILABLE_FOR_NEW_RESERVATIONS' ELSE 'ACTIVE_PURCHASABLE' END AS participation_status`
    - Historical rows 1 and 2 in `miljor_db` remain completely unmodified (`product_spec_id = NULL`, `supplier_listing_id = NULL`).
- **Test Evidence:** `tests/part4b4_2_observations_integrity_gate.js` (Test 15: Legacy pool 1 strictly rejects reservation with 422 `LEGACY_POOL_READ_ONLY`; Test 16: Public discovery tags legacy pools with `is_legacy = 1` and `LEGACY_NOT_AVAILABLE_FOR_NEW_RESERVATIONS`).

---

### OBS-25: Future-Safe One Active Reservation per Buyer (Fail-Closed)
- **Description:** Ensure the single active reservation per buyer constraint is future-safe and fails closed across all present and future active lifecycle states, while allowing re-entry only after terminal states (`CANCELLED` or `EXPIRED`).
- **Root Cause Analysis:** Migration 009 defined the virtual key as `CASE WHEN status IN ('RESERVED', 'CONFIRMED', 'PAID') THEN ...`. If future phases introduce intermediary active states (such as `COMMITTED`, `PRICE_LOCKED`, `AWAITING_PAYMENT`, `PAYMENT_PENDING`), a reservation in those states would evaluate to `NULL`, allowing a buyer to bypass the uniqueness constraint and place a duplicate reservation.
- **Corrective Changes:**
  - `database/migrations/010_fail_closed_active_reservation_uniqueness.sql`:
    - Modified virtual column to inverted fail-closed logic:
      ```sql
      ALTER TABLE reservations MODIFY COLUMN active_pool_buyer_key VARCHAR(64) GENERATED ALWAYS AS (
        CASE 
          WHEN status NOT IN ('CANCELLED', 'EXPIRED') THEN CONCAT(pool_id, '_', buyer_id)
          ELSE NULL 
        END
      ) VIRTUAL;
      ```
    - Added rollback migration `database/migrations/rollback/010_rollback_fail_closed_active_reservation_uniqueness.sql`.
  - `src/controllers/reservationController.js`:
    - Application query updated to `WHERE pool_id = ? AND buyer_id = ? AND status NOT IN ('CANCELLED', 'EXPIRED')`.
    - Handles `ER_DUP_ENTRY` gracefully, returning 409 `ACTIVE_RESERVATION_EXISTS`.
- **Test Evidence:** `tests/part4b4_2_observations_integrity_gate.js` (Test 17: Duplicate reservation rejected with 409; Test 18: Idempotency replay succeeds; Test 19: Non-terminal states fail closed, `CANCELLED` and `EXPIRED` permit re-entry).

---

### OBS-26: Legacy Reservation Cancellation Route Safety & Unified Idempotency Protection
- **Description:** In legacy route definitions, `PUT /api/v1/reservations/:id/cancel` existed alongside the new RESTful standard `POST /api/v1/reservations/:id/cancel`. If the legacy route lacked mandatory idempotency guards or bypassed the new transactional parent-first cancellation and bidirectional repricing logic, clients or attackers could cause state desynchronization, unmonitored cancellations, or race conditions.
- **Root Cause Analysis:** Legacy route previously used optional/unprotected middleware and legacy controller methods, permitting route bypass and creating dual cancellation implementations.
- **Corrective Changes:**
  - `src/routes/v1/reservationRoutes.js`: Routed both `POST /api/v1/reservations/:id/cancel` and backward-compatible `PUT /api/v1/reservations/:id/cancel` through `idempotencyGuard.required` and the exact same authoritative `reservationController.cancelReservation` handler.
  - Mandatory `X-Idempotency-Key` header enforced on both endpoints (rejecting missing keys with 400 `IDEMPOTENCY_KEY_REQUIRED`).
  - Strict parent-pool-first `FOR UPDATE` lock order enforced, eliminating deadlocks.
  - Full dynamic bidirectional repricing of remaining uncommitted buyers executed atomically.
  - Demand returned cleanly to pool aggregate without releasing underlying supplier inventory allocation.
  - Immutable historical snapshot recorded in `reservation_mutation_history` and structured audit recorded in `system_audit_logs`.
- **Test Evidence:** `tests/part4c1_reservation_mutations_gate.js` (Test 3: POST cancellation; Test 23: Legacy PUT cancellation requires idempotency key and enforces identical business protections; Test 42: Cancellation idempotency replay).---

### OBS-27: Exact Numeric Handling for Concurrency Precondition (`If-Match-Quantity`)
- **Description:** Precondition checks using `If-Match-Quantity` or `expected_quantity` were vulnerable to client type variations (e.g. string vs numeric, varying decimal zeros like `'12.5000'` vs `12.5`), or malformed strings causing `NaN` comparisons that could either silently fail or bypass concurrency checks.
- **Root Cause Analysis:** String equality comparisons or loose JavaScript equality can fail when comparing database `DECIMAL(12,4)` values against formatted client inputs.
- **Corrective Changes:**
  - `src/controllers/reservationController.js`:
    - Strict validation added: rejects non-numeric or non-positive values with 400 `INVALID_EXPECTED_QUANTITY`.
    - Exact numeric comparison using fixed 4-decimal precision (`toFixed(4)`) and epsilon boundary comparison (`Math.abs(curr - exp) > 0.0001`).
    - Stale expected quantities reliably trigger 412 `PRECONDITION_FAILED` with current actual quantity returned in the error payload.
- **Test Evidence:** `tests/part4c2a_progress_pricing_gate.js` (Test 16: Malformed string rejected with 400; formatted decimal matched; stale quantity triggers 412).

---

### OBS-28: Deterministic Mutation Replay for Reservation Adjustments
- **Description:** Idempotency replay of reservation modifications and cancellations must return the exact stored HTTP response and updated entity without re-evaluating business rules or mutating data a second time.
- **Root Cause Analysis:** If response payloads are not reliably recorded with durable state or if idempotency records do not bind response status codes and headers, replays might attempt re-execution or fail.
- **Corrective Changes:**
  - `src/middlewares/idempotencyGuard.js`: Heartbeat liveness, resource linkage, and durable status tracking (`PROCESSING`, `COMPLETED`, `FAILED`).
  - Confirmed and verified deterministic idempotency replay across both reservation quantity updates and cancellations.
- **Test Evidence:** `tests/part4c1_reservation_mutations_gate.js` (Test 38, 42) & `tests/part4c2a_progress_pricing_gate.js`.

---

### OBS-29: Read Snapshot Consistency and Drift Detection Policy
- **Description:** Cached counter `pools.current_qty` can drift if historical direct updates occurred or background processes failed. Read endpoints must maintain transactional and aggregate consistency without mutating the database during `GET` requests.
- **Root Cause Analysis:** Relying solely on `pools.current_qty` for pricing calculations can expose buyers to corrupt pricing if the cache drifts. However, mutating database state inside `GET` endpoints violates HTTP idempotency and read-safety standards.
- **Corrective Changes:**
  - `src/services/poolProgressService.js`:
    - Single unified read model query derives authoritative eligible quantity dynamically via `SUM(CASE WHEN r.status NOT IN ('CANCELLED', 'EXPIRED') THEN r.quantity ELSE 0 END)`.
    - Compares authoritative sum with cached `pools.current_qty`.
    - If mismatch detected, logs diagnostic drift alert (`[PoolProgressService] Drift detected...`), flags `has_quantity_drift: true` in diagnostics, and computes all progress, capacity, and pricing metrics using the authoritative sum.
    - Zero `UPDATE` or `WRITE` operations are executed during `GET` requests.
- **Test Evidence:** `tests/part4c2a_progress_pricing_gate.js` (Test 21: Concurrent write snapshot consistency; Test 22: Corrupt cached `current_qty = 99` overridden by authoritative sum 10, database remains untouched).

---

### OBS-30: Clean Return to Zero-Demand State on All-Cancelled Pool
- **Description:** When all buyers cancel their reservations or when an empty pool is published, the read model must cleanly return `0.00` eligible demand, `0.0%` progress, full remaining capacity, and explicit conditional pricing flags.
- **Root Cause Analysis:** Aggregating empty sets in SQL can return `NULL`, which if uncoerced can cause `NaN` progress percentages or crash division operations.
- **Corrective Changes:**
  - `src/services/poolProgressService.js`:
    - Employs `COALESCE(SUM(...), 0)` and `Number(pool.eligible_quantity) || 0`.
    - Explicit zero-demand handling: `minimum_progress_percent = 0.0`, `target_progress_percent = 0.0`, `minimum_remaining = supplier_min_qty`, `target_remaining = target_qty`, `pricing_mode = ESTIMATED_PRE_MINIMUM`, `is_conditional_pricing = true`.
- **Test Evidence:** `tests/part4c2a_progress_pricing_gate.js` (Test 1: Empty published pool; Test 14: Last buyer cancellation cleanly restores zero-demand progress state).

---

### OBS-31: Backward Compatibility Across Pool Discovery Endpoints
- **Description:** Enhancements to pool progress and tier pricing transparency must enrich `GET /api/v1/pools` and `GET /api/v1/pools/:id` without breaking legacy client applications expecting original field names.
- **Root Cause Analysis:** Renaming fields like `current_qty`, `fill_percentage`, or `remaining_qty` breaks frontend consumers.
- **Corrective Changes:**
  - `src/services/poolProgressService.js`:
    - Preserves all legacy properties (`current_qty`, `fill_percentage`, `remaining_qty`, `product_title`, `price_per_unit`, `is_legacy`).
    - Enriches with authoritative metrics: `eligible_quantity`, `remaining_capacity`, `minimum_progress_percent`, `target_progress_percent`, `minimum_reached`, `target_reached`, `capacity_reached`, `estimated_unit_price`, `pricing_mode`, `is_conditional_pricing`, `next_tier_quantity`, `additional_quantity_for_next_tier`, `next_tier_price`, `can_join`, `participation_status`, `participation_reason`.
- **Test Evidence:** `tests/part4c2a_progress_pricing_gate.js` (Test 26: Complete backward compatibility verified across both list and detail endpoints).

---

### OBS-32: Exact Decimal Quantity Precondition & Boundary Validation (`If-Match-Quantity`)
- **Description:** The concurrency precondition check in `updateReservationQuantity` used a floating-point comparison `Math.abs(curr - exp) > 0.0001` which inadvertently allowed a difference of exactly 0.0001, and lacked rejection of malformed or excess precision inputs (beyond 4 decimal places).
- **Root Cause Analysis:** JavaScript IEEE-754 floating point arithmetic and loose inequality `> 0.0001` permitted slight deviations at the exact 0.0001 boundary instead of enforcing exact 4-decimal-place equality matching MySQL's `DECIMAL(12,4)` column.
- **Corrective Changes:**
  - `src/controllers/reservationController.js`:
    - Added strict validation rejecting any `expected_quantity` or `If-Match-Quantity` with more than 4 decimal places with 400 `INVALID_EXPECTED_QUANTITY`.
    - Enforced strict 4-decimal precision check using `toFixed(4)` and epsilon boundary comparison (`Math.abs(curr - exp) >= 0.00005`), ensuring any difference $\ge 0.0001$ reliably triggers 412 `PRECONDITION_FAILED` with the current reservation quantity returned in the error payload.
- **Test Evidence:** `tests/part4c2b_events_visibility_gate.js` (Test 18: Exact 0.0001 difference triggers 412 PRECONDITION_FAILED; Test 19: Malformed and excess precision rejected with 400 INVALID_EXPECTED_QUANTITY).

---

### OBS-33: Explicit Whitelisted Demand Status Policy & Fail-Closed Unknown Status Safety
- **Description:** Discrepancies between database filters (e.g. `NOT IN ('CANCELLED', 'EXPIRED')`) and application logic could permit unverified or future lifecycle statuses to behave unpredictably in capacity allocation or progress metrics.
- **Root Cause Analysis:** Relying on disparate status checks across controllers, repositories, and services without a centralized single source of truth created risk of drift or inconsistent status evaluation.
- **Corrective Changes:**
  - Created `src/services/reservationDemandPolicy.js` defining explicit sets:
    - Whitelisted active demand statuses: `['RESERVED', 'CONFIRMED', 'PAID']`
    - Terminal statuses: `['CANCELLED', 'EXPIRED']`
    - Centralized predicates: `isDemandEligible(status)`, `isTerminal(status)`, `isValidStatus(status)`.
    - Fail-closed demand audit function `auditReservationStatuses(reservations)` that detects unknown/invalid statuses, logs a warning, and conservatively treats them as demand-eligible to prevent pool oversubscription.
  - Updated `src/controllers/reservationController.js` and `src/services/poolProgressService.js` to utilize this shared policy.
- **Test Evidence:** `tests/part4c2b_events_visibility_gate.js` (Test 20: Whitelisted demand policy unit check; Test 21: Fail-closed calculation for unmapped status protects capacity).

---

### OBS-34: Unified Symmetrical Supplier & Pool Eligibility Verification Policy
- **Description:** The read model's advisory participation predicate `can_join` and the mutation controllers' transactional checks had slight variations in supplier and listing validation, creating potential discrepancy where a pool appeared joinable in read models but failed upon reservation placement.
- **Root Cause Analysis:** Independent implementations of supplier and listing verification in `poolProgressService.js` and `reservationController.js` led to code duplication and potential divergence in verification criteria.
- **Corrective Changes:**
  - Created `src/services/supplierEligibilityPolicy.js` providing:
    - Symmetrical evaluation functions: `evaluateSupplierEligibility(supplier)`, `evaluateListingEligibility(listing)`, `evaluatePoolParticipationEligibility(pool, user, listing, supplier, spec)`.
    - Affirmatively validates: `role === 'SUPPLIER'`, `is_verified === 1`, user `verification_status === 'VERIFIED'`, supplier profile `verification_status === 'VERIFIED'`, listing `status === 'ACTIVE'`, listing supplier matches pool supplier, product specification matches listing spec, pool is not legacy, pool is not expired, remaining capacity >= buyer_min_qty.
  - Integrated policy into `poolProgressService.js` and `reservationController.js`.
- **Test Evidence:** `tests/part4c2b_events_visibility_gate.js` (Test 22: Symmetrical policy passes for fully verified supplier; Test 23: Rejects pending profile or suspended supplier symmetrically across both advisory read and mutation paths).

---

### OBS-35: Event ID Generation Uniqueness, Collision Resistance & Operation-Level Scoping
- **Description:** Naive hashing `SHA256(event_type:pool_id:reservation_id:idempotency_key)` caused potential event ID collisions across different buyers/actors submitting identical client-generated idempotency keys (e.g. `order-1`, `key-1`), across distinct mutation operations sharing a key string, or across multiple events generated in sequence within the same mutation.
- **Root Cause Analysis:** Event ID hashing lacked actor isolation, mutation operation scoping, and explicit monotonic event sequencing parameters.
- **Corrective Changes:**
  - `src/services/reservationEventService.js`:
    - Hardened `generateEventId` with canonical JSON serialization incorporating scoped operation identity:
      `actor_id`, `mutation_type`, `pool_id`, `reservation_id`, `idempotency_key`, `event_type`, `event_sequence`.
    - Produces format `EVT-<PREFIX>-<HASH[0..24]>` (length $\le 47$ characters, safely within MySQL `VARCHAR(64)`).
    - Guarantees backward compatibility with positional legacy arguments while enforcing strict scope uniqueness.
- **Test Evidence:** `tests/part4c2_combined_integration_gate.js` (Tests 1, 2, 3, 4, 15: Cross-actor collision resistance, mutation scoping, deterministic replay, sequence distinctness).
- **Status:** **RESOLVED** (Verified in Part 4C.2C Gate).

---

### OBS-36: Elimination of Silent Event Loss via `INSERT IGNORE` and Semantic Duplicate Verification
- **Description:** Using `INSERT IGNORE` into `reservation_business_events` silently swallowed genuine database errors (such as foreign key constraint failures, table integrity violations, or conflicting event collisions), giving callers false confidence that events were recorded.
- **Root Cause Analysis:** `INSERT IGNORE` suppressed all MySQL errors on the statement, hiding bugs and potential data loss.
- **Corrective Changes:**
  - `src/services/reservationEventService.js`:
    - Replaced `INSERT IGNORE` with explicit `INSERT INTO reservation_business_events`.
    - Added structured `ER_DUP_ENTRY` catch block:
      - Inspects existing row against incoming event (`event_type`, `pool_id`, `actor_id`, `idempotency_key`).
      - If exact semantic match (idempotent replay): safely accepts and logs duplicate verification.
      - If mismatched attributes (conflicting collision): throws `EVENT_ID_COLLISION` with 409 status code.
    - All other database errors (foreign key errors, constraint violations, deadlocks) are re-thrown immediately, ensuring caller transaction rollback.
- **Test Evidence:** `tests/part4c2_combined_integration_gate.js` (Tests 5, 6, 7, 8, 16: Explicit insert, legitimate duplicate acceptance, collision throwing, foreign key failure propagation).
- **Status:** **RESOLVED** (Verified in Part 4C.2C Gate).

---

### OBS-37: Transactional Event Atomicity, Rollback Safety & Monotonic Ordering
- **Description:** Event recording must participate atomically within caller database transactions across all reservation operations (`createReservation`, `updateReservationQuantity`, `cancelReservation`), ensuring zero phantom events on transaction rollback and strict monotonic event sequencing.
- **Root Cause Analysis:** If events are recorded outside transactions or after commits, database crashes or transaction rollbacks could leave orphaned "ghost" events in the audit log that never took place in business state.
- **Corrective Changes:**
  - `src/controllers/reservationController.js`:
    - All 5 reservation event types (`RESERVATION_*`, `POOL_DEMAND_CHANGED`, `SUPPLIER_MINIMUM_*`, `TARGET_*`, `POOL_TIER_CHANGED`) are emitted within the caller transaction `connection`.
    - Any failure during event generation or recording triggers full transaction rollback (`await connection.rollback()`), guaranteeing zero phantom events.
    - Events maintain strictly increasing auto-increment IDs and sequential operation sequence numbering.
- **Test Evidence:** `tests/part4c2_combined_integration_gate.js` (Tests 18, 23: Complete rollback on event persistence failure, strict monotonic ordering across all pool mutations).
- **Status:** **RESOLVED** (Verified in Part 4C.2C Gate).

---

### OBS-38: Event ID Collision Correctness & Probabilistic Bounds
- **Description:** Previous design claimed mathematical collision impossibility for 32-hex (128-bit) truncated SHA-256 event identifiers. In cryptographic systems, truncation yields collision resistance bounded by the birthday paradox ($p \approx k^2 / 2^{129}$), not zero. The architecture must formally acknowledge probabilistic uniqueness backed by database constraints and transactional conflict resolution.
- **Root Cause Analysis:** Overstated collision guarantees without documenting the underlying probabilistic bounds and the transactional defense-in-depth model.
- **Corrective Changes:**
  - Standardized identifier format: `EVT-<PREFIX>-<SHA256(canonical)[0..32]>` (length $\le 47$ characters $\le$ `VARCHAR(64)`).
  - Entropy: 128 bits ($2^{128}$ states), providing negligible collision probability under normal operational volumes ($< 10^{-15}$ across billions of mutations).
  - Defense-in-depth: Database-enforced `UNIQUE KEY uq_events_event_id (event_id)` on `reservation_business_events`.
  - Transactional safety: On `ER_DUP_ENTRY`, any attribute or payload conflict raises `EVENT_ID_COLLISION` (HTTP 409) and forces caller transaction rollback (`connection.rollback()`). Collision handling **never** silently swallows an event.
- **Test Evidence:** `tests/part4c2_combined_integration_gate.js` (Tests 1, 2, 3, 4, 7, 8, 9).
- **Status:** **RESOLVED** (Verified in Part 4C.2C.1 Gate).

---

### OBS-39: Complete Deep Semantic Duplicate Verification
- **Description:** Duplicate event detection under `ER_DUP_ENTRY` previously compared only 4 shallow fields (`event_type`, `pool_id`, `actor_id`, `idempotency_key`), leaving quantity snapshots, pricing snapshots, and JSON payloads unchecked. An altered payload or modified quantity under the same event ID would have been treated as an acceptable idempotent replay.
- **Root Cause Analysis:** Partial attribute verification in duplicate resolution logic.
- **Corrective Changes:**
  - `src/services/reservationEventService.js`:
    - Implemented `_canonicalizeValue(val)`: recursively sorts object keys and normalizes numeric values for canonical representation.
    - Implemented `_arePayloadsSemanticallyEqual(a, b)`: compares canonical JSON representations.
    - Implemented `_areDecimalsEqual(d1, d2, precision)`: exact decimal comparison for 4-decimal quantities and 2-decimal unit prices.
    - Rewrote `recordEvent()`'s duplicate verification: fetches the existing record and verifies full equality across:
      1. `event_type`, `pool_id`, `actor_id`, `actor_role`, `reservation_id`, `idempotency_key`
      2. `previous_quantity` and `new_quantity` (4 decimal places)
      3. `previous_aggregate_demand` and `new_aggregate_demand` (4 decimal places)
      4. `previous_unit_price` and `new_unit_price` (2 decimal places)
      5. `event_payload` normalized canonical JSON
    - If any field differs: throws `EVENT_ID_COLLISION` with 409 status code and a descriptive list of mismatched fields, prompting immediate caller transaction rollback.
- **Test Evidence:** `tests/part4c2_combined_integration_gate.js` (Test 6: Identical replay passes; Test 8: Tampered payload throws 409; Test 9: Tampered quantity throws 409; Test 25: Immutability check).
- **Status:** **RESOLVED** (Verified in Part 4C.2C.1 Gate).

---

### OBS-40: Commit-Ordering vs Monotonic Auto-Increment Ordering
- **Description:** In MySQL InnoDB, auto-increment primary keys are allocated when rows are inserted, which can diverge from transaction commit order if uncoordinated concurrent transactions insert in one order but commit in another. The platform required verification that event ordering reflects actual business commit sequence.
- **Root Cause Analysis:** General MySQL InnoDB auto-increment allocation behavior across uncoordinated concurrent transactions.
- **Architectural Analysis & Resolution:**
  - In MilJor, every reservation mutation on a pool begins with:
    `SELECT ... FROM pools p WHERE p.id = ? FOR UPDATE`.
  - Because this exclusive row lock is held until `COMMIT` or `ROLLBACK`, all concurrent reservation transactions on the **same pool** are strictly serialized.
  - Transaction B cannot insert rows into `reservation_business_events` for Pool 1 until Transaction A has completed and committed.
  - Therefore, for any given pool, auto-increment `id` order **strictly and mathematically matches transaction commit order**.
  - Within each transaction, events are recorded with sequential monotonic sequence numbers (`seq: 1` primary, `seq: 2` demand, `seq: 3` min reached, `seq: 4` target reached, `seq: 5` tier changed).
  - Across different pools, events belong to distinct independent business streams and do not interfere with each other.
  - On rollback, InnoDB rolls back all inserted event rows; zero phantom events exist.
  - No additional schema tables or queue infrastructure are required because pool row lock serialization guarantees commit-order alignment.
- **Test Evidence:** `tests/part4c2_combined_integration_gate.js` (Test 15: Concurrency serialization; Test 23: Monotonic event ordering; Test 24: Isolated pool streams).
- **Status:** **RESOLVED** (Verified in Part 4C.2C.1 Gate).

---

### OBS-41: Legacy Pool Closure Scheduler Fail-Closed Containment
- **Description:** `src/services/poolClosureService.js` previously contained a legacy `processExpiredPools()` implementation designed for simple pools. If executed on a regular pool (where buyers hold reservations and supplier inventory allocations are committed), it would blindly cancel active reservations, attempt unauthorized refunds on payment tables, and release supplier inventory allocations before the formal Part 4D qualification/supplier confirmation workflow was built.
- **Root Cause Analysis:** Legacy prototype implementation of pool closure remained mounted in `schedulerService.js` (running every 10 minutes in non-test environments) without phase boundaries or safety guards for Part 4C regular pools.
- **Corrective Changes:**
  - `src/services/poolClosureService.js`:
    - Hardened `processExpiredPools()` with an explicit fail-closed guard: `process.env.ENABLE_PART4D_POOL_CLOSURE === 'true'`.
    - When false (default across both development and production environments), the method logs containment and immediately returns:
      `{ processed: 0, contained: true, reason: 'PART_4D_CLOSURE_WORKFLOW_PENDING' }`.
    - Guarantees zero uncoordinated cancellation of `RESERVED` rows, zero premature refund or ledger mutation, and zero supplier allocation release until Part 4D is formally implemented and verified.
    - Preserved unrelated scheduled tasks: `cleanOldIdempotencyRecords()` (hourly) and `processExpiredFlashPools()` (every 10 min) remain active and functional.
- **Test Evidence:** `tests/part4c3_1_scheduler_safety_gate.js` (Tests 1, 2, 3, 4, 5, 6, 11, 12: dev/prod containment, zero reservation cancellation, zero refund/ledger mutations, zero inventory release, background task preservation, zero admin bypass).
- **Status:** **RESOLVED** (Verified in Part 4C.3.1 Gate).

---

### OBS-43: Database Server-Time Authoritative Expiry Check & Lock-Contention Post-Wait Cutoff
- **Description:** Expiry evaluation previously risked relying on client-supplied or local Node.js process timestamps. Under high database load or lock contention, the delay between query dispatch and acquiring row lock (`FOR UPDATE`) could allow mutations to proceed on pools that expired while waiting for the lock. Furthermore, MySQL evaluation of `TIMESTAMP` columns vs server time functions (`NOW()` vs `UTC_TIMESTAMP()`) required architectural clarification.
- **Root Cause Analysis:** In MySQL, `pools.expires_at` is defined as a `TIMESTAMP` column. MySQL's `TIMESTAMP` values are stored in UTC but automatically expanded to the session time zone upon comparison. `NOW()` returns the server clock in the matching session time zone, ensuring consistent, like-for-like comparison regardless of the server's session timezone. Conversely, `UTC_TIMESTAMP()` returns a un-zoned UTC datetime string; comparing a `TIMESTAMP` column directly against `UTC_TIMESTAMP()` causes MySQL to convert the `TIMESTAMP` into local session time and compare it against raw UTC, producing an offset equal to the server's timezone delta (e.g., a 5-hour error under PKT/UTC+5).
- **Corrective Changes:**
  - Standardized all pool expiry evaluations to use the database server's authoritative clock `(p.expires_at <= NOW()) AS is_expired`:
    - `src/controllers/reservationController.js` (`createReservation`, `updateReservationQuantity`, `cancelReservation`).
    - `src/services/poolProgressService.js` (`getPoolSnapshot`).
    - `src/services/poolClosureService.js` (`processExpiredPools`).
  - Strict dynamic post-lock evaluation: `expires_at <= NOW()` is evaluated dynamically after acquiring the exclusive row lock transaction (`SELECT ... FOR UPDATE`). Any reservation mutation arriving just before expiry that waits on a row lock until `NOW()` passes `expires_at` is immediately rejected with 422 `POOL_EXPIRED`.
  - Exact boundary behavior: Expiry at exact `expires_at = NOW()` is closed and rejected with 422 `POOL_EXPIRED`.
  - Zero client-supplied or local Node.js process timestamps determine expiry.
- **Test Evidence:** `tests/part4c3_1_scheduler_safety_gate.js` (Tests 7, 8, 9, 10: pre-expiry success, post-lock wait expiry rejection, exact boundary rejection, historical read integrity on expired pools).
- **Status:** **RESOLVED** (Verified in Part 4C.3.1 Gate).

---

### OBS-44: Serialization Consistency, Deadlock Prevention & Background Job Non-Interference
- **Description:** Concurrency interactions between reservation mutations and background schedulers must preserve strict lock ordering, prevent database deadlocks, and guarantee that background maintenance jobs do not interfere with active pool transactions.
- **Root Cause Analysis:** Potential lock ordering inversions between reservation operations (`pools FOR UPDATE` $\to$ `reservations FOR UPDATE`) and background maintenance processes scanning multiple tables.
- **Corrective Changes:**
  - Because `processExpiredPools()` is fail-closed, no uncoordinated background worker acquires locks on pools or reservations.
  - In `reservationController.js`, all mutation paths strictly adhere to parent-first lock hierarchy:
    `pools FOR UPDATE` $\to$ `reservations FOR UPDATE` $\to$ `reservation_business_events INSERT` $\to$ `reservation_mutation_history INSERT`.
  - Unrelated background maintenance jobs (`cleanOldIdempotencyRecords`, `processExpiredFlashPools`) touch completely independent tables (`idempotency_records`, `flash_pools`) and have zero lock contention with regular pools or reservations.
  - Audited admin routes (`src/routes/v1/adminRoutes.js`): verified zero unguarded manual pool closure or expiration bypass endpoints.
- **Test Evidence:** `tests/part4c3_1_scheduler_safety_gate.js` (Tests 11, 12).
- **Status:** **RESOLVED** (Verified in Part 4C.3.1 Gate).

---

### OBS-45: Legacy Scheduler Feature-Flag Safety & Permanent Decommissioning
- **Description:** `ENABLE_PART4D_POOL_CLOSURE=true` previously created a critical safety hazard: toggling the flag enabled legacy prototype closure code in `src/services/poolClosureService.js` that unconditionally mass-cancelled active buyer reservations, attempted unauthorized refunds on `payments`, and mutated `platform_ledger` before Part 4D qualification was built.
- **Root Cause Analysis:** Legacy prototype closure logic remained in `src/services/poolClosureService.js` behind a simple boolean environment variable check.
- **Corrective Changes:**
  - Permanently expunged legacy destructive mass-cancellation, refund, and ledger queries from `src/services/poolClosureService.js`.
  - Replaced with authoritative decommissioning handler:
    - If `ENABLE_PART4D_POOL_CLOSURE !== 'true'`: logs containment and returns `{ processed: 0, contained: true, reason: 'PART_4D_CLOSURE_WORKFLOW_PENDING' }`.
    - If `ENABLE_PART4D_POOL_CLOSURE === 'true'`: logs permanent decommissioning and returns `{ processed: 0, contained: true, legacy_decommissioned: true, reason: 'LEGACY_CLOSURE_PERMANENTLY_DECOMMISSIONED' }`.
  - Zero reservations are cancelled, zero refunds are issued, zero ledger rows are modified, and zero inventory allocations are released under any configuration flag, environment mode, or manual invocation.
  - Unrelated background maintenance jobs (`cleanOldIdempotencyRecords`, `processExpiredFlashPools`) remain preserved and functional.
- **Test Evidence:** `tests/part4d1_commercial_foundation_gate.js` (Tests 15, 16, 17, 18, 19).
- **Status:** **RESOLVED** (Verified in Part 4D.1 Gate).

---

### OBS-46: Fresh Post-Lock Database Clock Revalidation & Lock-Contention Expiry Protection
- **Description:** Evaluating pool expiry strictly within the single `SELECT ... FOR UPDATE` statement risked edge-case inaccuracy under prolonged lock waits because MySQL's `NOW()` evaluates to the query execution start time. If a transaction waits for 2 seconds to acquire a row lock, `NOW()` from the initial lock query could reflect a pre-expiry timestamp even though the lock was granted after expiry.
- **Root Cause Analysis:** MySQL statement-time timestamp binding behavior on queries queued behind row locks.
- **Corrective Changes:**
  - Implemented explicit two-stage post-lock revalidation across `createReservation`, `updateReservationQuantity`, and `cancelReservation`:
    1. Primary lock acquired: `SELECT p.*, (p.expires_at <= NOW()) AS is_expired FROM pools p WHERE p.id = ? FOR UPDATE`.
    2. Fresh database-time evaluation executed immediately after lock grant:
       `SELECT (expires_at <= NOW()) AS is_freshly_expired FROM pools WHERE id = ?`.
    3. `isExpired = Boolean(pool.is_expired) || Boolean(freshExpiryRows[0] && freshExpiryRows[0].is_freshly_expired)`.
  - If the pool expires while a transaction is waiting for the row lock, the mutation is immediately rejected with HTTP 422 `POOL_EXPIRED` with zero side effects.
  - Replays of operations committed before expiry continue to return HTTP 201/200 cached responses idempotently.
- **Test Evidence:** `tests/part4d1_commercial_foundation_gate.js` (Tests 20, 21, 22).
- **Status:** **RESOLVED** (Verified in Part 4D.1 Gate).

---

### OBS-47: Authoritative Active Decision Uniqueness & Double Qualification Race Prevention
- **Description:** Multiple concurrent workers or API requests invoking qualification at or after pool expiry could risk race conditions, creating multiple active commercial snapshots awaiting supplier decisions simultaneously.
- **Root Cause Analysis:** Application-level checks alone cannot guarantee uniqueness across concurrent database transactions without a database-level unique constraint.
- **Corrective Changes:**
  - Added Migration 014 (`database/migrations/014_pool_commercial_snapshots_invariants.sql`):
    - Added virtual generated column `authoritative_decision_key VARCHAR(100) GENERATED ALWAYS AS (IF(status = 'PENDING_SUPPLIER_DECISION', CONCAT(pool_id, ':PENDING'), NULL)) VIRTUAL`.
    - Added unique constraint `uq_snapshot_authoritative_decision UNIQUE (authoritative_decision_key)`.
  - In `src/services/commercialLifecycleService.js`: parent-pool-first `SELECT ... FOR UPDATE` acquires exclusive lock. Any concurrent qualification attempt detects existing snapshot and returns idempotent replay.
  - If a concurrent worker bypasses application locks, MySQL enforces `ER_DUP_ENTRY` on `uq_snapshot_authoritative_decision`, rolling back the duplicate attempt.
- **Test Evidence:** `tests/part4d2_pool_qualification_gate.js` (Tests 9, 17).
- **Status:** **RESOLVED** (Verified in Part 4D.2 Gate).

---

### OBS-48: Commercial Snapshot Traceability & Participating Reservation Audit
- **Description:** Once a pool qualifies, commercial evidence must freeze the exact participating buyer reservations, quantities, and pricing estimates to ensure future supplier confirmation decisions cannot alter participating quantities or prices.
- **Root Cause Analysis:** Dynamic recalculation during supplier decision could lead to discrepancies if reservations were modified or corrupted after pool qualification.
- **Corrective Changes:**
  - `CommercialLifecycleService.qualifyPoolParticipation` constructs `participating_reservations_snapshot` containing exact reservation IDs, codes, buyer IDs, quantities, and estimated unit prices.
  - Frozen snapshot data is written into `pool_commercial_snapshots.participating_reservations_summary`.
  - Subsequent buyer reservation modifications (`PATCH /api/v1/reservations/:id`) and cancellations (`PUT /api/v1/reservations/:id/cancel`) are rejected on qualified pools with 422 `POOL_NOT_ACTIVE`.
- **Test Evidence:** `tests/part4d2_pool_qualification_gate.js` (Tests 10, 11, 18).
- **Status:** **RESOLVED** (Verified in Part 4D.2 Gate).

---

### OBS-49: Supplier Inventory Allocation Commitment Preservation
- **Description:** Early or prototype pool closure implementations previously risked releasing supplier inventory allocations (`RELEASED`) during qualification or unqualified expiration.
- **Root Cause Analysis:** Incomplete lifecycle transitions prematurely modifying `supplier_inventory_allocations`.
- **Corrective Changes:**
  - In `src/services/commercialLifecycleService.js`: `validateInventoryAllocationInvariants` confirms that the pool's allocation record in `supplier_inventory_allocations` exists and remains `COMMITTED`.
  - Neither qualified (`AWAITING_SUPPLIER_CONFIRMATION`) nor unqualified (`EXPIRED`) outcomes release inventory allocations in Part 4D.2.
  - Zero duplicate allocation records are created.
- **Test Evidence:** `tests/part4d2_pool_qualification_gate.js` (Tests 23, 24).
- **Status:** **RESOLVED** (Verified in Part 4D.2 Gate).

---

### OBS-50: Zero Premature Financial Mutation & Financial Safeguard
- **Description:** Commercial qualification is an evaluation and evidence-capturing phase only. No financial transactions, orders, payments, refunds, or ledger entries may be created.
- **Root Cause Analysis:** Risk of premature order generation or refund logic triggering before supplier confirmation or buyer price lock.
- **Corrective Changes:**
  - Confirmed and verified that `qualifyPoolParticipation` performs zero writes to `orders`, `payments`, `platform_ledger`, or buyer account balances.
  - Financial safety assertions verify `orders = 0` and `payments = 0` across all qualification workflows.
- **Test Evidence:** `tests/part4d2_pool_qualification_gate.js` (Test 25).
- **Status:** **RESOLVED** (Verified in Part 4D.2 Gate).

---

### OBS-51: Fail-Closed Reservation Status Auditing
- **Description:** If a pool contains corrupted, invalid, or unexpected reservation statuses (e.g. states outside `RESERVED`, `CANCELLED`, `CONFIRMED`), qualification evaluation must fail safely.
- **Root Cause Analysis:** Blind aggregation of reservations without strict status validation could incorporate illegitimate demand into commercial contracts.
- **Corrective Changes:**
  - `CommercialLifecycleService.qualifyPoolParticipation` performs fail-closed validation of all reservation rows associated with the pool.
  - If any reservation exhibits an unexpected status or inconsistent quantity, the transaction rolls back and aborts with a descriptive validation error.
- **Test Evidence:** `tests/part4d2_pool_qualification_gate.js` (Test 19).
- **Status:** **RESOLVED** (Verified in Part 4D.2 Gate).

---

### OBS-59: Legacy `PUT /api/v1/pools/:id/confirm` Permanent Retirement
- **Description:** Legacy pool confirmation route `PUT /api/v1/pools/:id/confirm` in `src/controllers/poolController.js` permitted direct mutation of pool status to `ACTIVE` or `CANCELLED`, bypassing the modern commercial lifecycle, demand qualification, and snapshot creation.
- **Root Cause Analysis:** Historical prototype handler left in controller without containment.
- **Corrective Changes:**
  - Replaced legacy implementation in `src/controllers/poolController.js` (`confirmPool`) to immediately return HTTP 410 `LEGACY_OPERATION_RETIRED`.
  - Fail-closed for all actors including `ADMIN` and `SUPER_ADMIN` with no bypass allowed.
  - Zero database mutations occur when this legacy endpoint is invoked.
- **Test Evidence:** `tests/part4d2_1_security_integrity_gate.js` (Tests 1, 2, 3).
- **Status:** **RESOLVED** (Verified in Part 4D.2.1 Gate).

---

### OBS-60: Safe Pool Cancellation & Anti-Destruction Protection
- **Description:** Previous `cancelPool` handler permitted unrestricted cancellation of pools regardless of buyer reservations, risking arbitrary destruction of active buyer commitments. Additionally, empty request body caused runtime error `Cannot read properties of undefined (reading 'reason')`.
- **Root Cause Analysis:** Missing input null-checks and missing reservation existence guards in pool cancellation handler.
- **Corrective Changes:**
  - In `src/controllers/poolController.js` (`cancelPool`):
    - Added safe optional chaining for request body (`const reason = (req.body && req.body.reason) ? req.body.reason : null;`).
    - Enforced buyer reservation protection: blocks cancellation of pools with active buyer reservations (`RESERVED_POOL_CANCELLATION_BLOCKED` or `PROTECTED_POOL_CANCELLATION_BLOCKED` with HTTP 422).
    - Blocks non-owning suppliers from cancelling pools (HTTP 403 `FORBIDDEN`).
    - For unreserved pools with committed inventory allocations, safely marks inventory allocation as `RELEASED` upon cancellation.
- **Test Evidence:** `tests/part4d2_1_security_integrity_gate.js` (Tests 4, 5, 6, 7, 8).
- **Status:** **RESOLVED** (Verified in Part 4D.2.1 Gate).

---

### OBS-61: Conflict Isolation on Already-Qualified Commercial Pools
- **Description:** Invoking qualification on an already-qualified pool with a different idempotency key or different actor risked ambiguity or improper state mutation.
- **Root Cause Analysis:** Qualification service previously treated any call on an already-qualified pool as an idempotent replay without verifying caller or operation identity.
- **Corrective Changes:**
  - In `src/services/commercialLifecycleService.js`:
    - Differentiates true idempotent replays (exact matching idempotency key and actor) from conflicting new transition attempts.
    - True idempotent replays return the cached qualification result (`is_idempotent_replay: true`).
    - Conflicting new mutation attempts with different idempotency keys throw HTTP 409 `POOL_ALREADY_QUALIFIED`.
    - Cross-actor idempotency key reuse throws HTTP 403 `FORBIDDEN`.
    - Internal background workers with auto-generated keys safely receive the authoritative outcome.
- **Test Evidence:** `tests/part4d2_1_security_integrity_gate.js` (Tests 11, 12, 13) and `tests/part4d2_pool_qualification_gate.js` (Test 9).
- **Status:** **RESOLVED** (Verified in Part 4D.2.1 Gate).

---

### OBS-62: Mandatory Scoped Idempotency Key Enforcement
- **Description:** Qualification API allowed requests without an idempotency key, exposing the qualification endpoint to accidental network retries or concurrent double-processing.
- **Root Cause Analysis:** Route lacked mandatory idempotency header validation.
- **Corrective Changes:**
  - In `src/routes/v1/poolRoutes.js`: Attached `idempotencyGuard.required` to `POST /:id/qualify`.
  - In `src/services/commercialLifecycleService.js`: Strictly requires `idempotencyKey` when `options.requireIdempotencyKey` is true, rejecting missing keys with HTTP 400 `MISSING_IDEMPOTENCY_KEY`.
- **Test Evidence:** `tests/part4d2_1_security_integrity_gate.js` (Tests 9, 10).
- **Status:** **RESOLVED** (Verified in Part 4D.2.1 Gate).

---

### OBS-63: Idempotency Record Retention & Safe Pruning
- **Description:** Routine scheduler cleanup job `cleanOldIdempotencyRecords` could purge active, pending, or recently completed commercial operation records, breaking idempotency replay guarantees.
- **Root Cause Analysis:** Unbounded and unqualified time-based deletion query.
- **Corrective Changes:**
  - In `src/services/poolClosureService.js` (`cleanOldIdempotencyRecords`):
    - Never prunes `ACTIVE`, `PENDING`, or `UNKNOWN` idempotency records.
    - Never prunes commercial qualification (`%QUAL%`) records.
    - Only prunes terminal records (`SUCCESS`, `FAILED`) older than 7 days in bounded batches of 500 rows.
- **Test Evidence:** `tests/part4d2_1_security_integrity_gate.js` (Test 14).
- **Status:** **RESOLVED** (Verified in Part 4D.2.1 Gate).

---

### OBS-64: Database-Level Authoritative Outcome Uniqueness (Migration 015)
- **Description:** Previous unique constraint (`uq_snapshot_authoritative_decision`) guarded active snapshots in `PENDING_SUPPLIER_DECISION` status, but did not prevent duplicate snapshots across terminal qualification outcomes (`QUALIFIED`, `UNQUALIFIED`).
- **Root Cause Analysis:** Schema lacked a generated outcome uniqueness key covering all decisive commercial snapshot outcomes.
- **Corrective Changes:**
  - Authored Migration 015 (`database/migrations/015_pool_commercial_snapshots_outcome_uniqueness.sql`):
    - Added virtual generated column `authoritative_outcome_key VARCHAR(100) GENERATED ALWAYS AS (IF(snapshot_version = 1, CONCAT(pool_id, ':', qualification_status), NULL)) VIRTUAL`.
    - Added unique constraint `uq_snapshot_authoritative_outcome UNIQUE (authoritative_outcome_key)`.
  - Authored corresponding rollback migration (`database/migrations/rollback/015_rollback_pool_commercial_snapshots_outcome_uniqueness.sql`).
  - Applied and verified against both `miljor_test_db` and `miljor_db`.
- **Test Evidence:** `tests/part4d2_1_security_integrity_gate.js` (Test 15).
- **Status:** **RESOLVED** (Verified in Part 4D.2.1 Gate).

---

### OBS-65: Legacy Pool Cancellation Vulnerability on Commercially Protected Pools
- **Description:** Pre-existing `PUT /api/v1/pools/:id/cancel` allowed pool cancellation if buyer reservations were zero, even if the pool was in `ACTIVE`, `AWAITING_SUPPLIER_CONFIRMATION`, or had an authoritative commercial qualification snapshot. Furthermore, `ADMIN` callers could bypass state checks.
- **Root Cause Analysis:** Legacy cancellation controller `cancelPool` in `src/controllers/poolController.js` only checked whether active reservations existed and allowed administrative overrides.
- **Corrective Changes:**
  - Hardened `cancelPool` in `src/controllers/poolController.js`:
    - Added mandatory commercial qualification snapshot presence check (`SELECT id FROM pool_commercial_snapshots WHERE pool_id = ? LIMIT 1`).
    - Strictly blocks cancellation if commercial snapshot exists with HTTP 422 `PROTECTED_POOL_CANCELLATION_BLOCKED`.
    - Restricts cancellable status strictly to `DRAFT` (or `ACTIVE` before any snapshot/reservation lifecycle).
    - Blocks cancellation of pools in `AWAITING_SUPPLIER_CONFIRMATION` or subsequent commercial states.
    - Removed administrative role bypass for commercial protections: fail-closed across all caller roles including `ADMIN` and `SUPER_ADMIN`.
- **Test Evidence:** `tests/part4d3_supplier_decision_gate.js` (Test 1: Published ACTIVE pool cancellation blocked; Test 2: AWAITING_SUPPLIER_CONFIRMATION pool cancellation blocked for Admin).
- **Status:** **RESOLVED** (Verified in Part 4D.3 Gate).

---

### OBS-66: Migration 015 Virtual Key Impact on Supplier Decisions
- **Description:** Verified whether `authoritative_outcome_key` (`IF(snapshot_version = 1, CONCAT(pool_id, ':', qualification_status), NULL)`) and `uq_snapshot_authoritative_outcome` added in Migration 015 could collide or obstruct subsequent commercial decision updates (`ACCEPT`/`REJECT`).
- **Root Cause Analysis:** Audited schema behavior in MySQL 8.0: Virtual column relies strictly on `pool_id` and `qualification_status` (`QUALIFIED` / `UNQUALIFIED`). Supplier decisions update snapshot `status` (`ACCEPTED` / `REJECTED`), NOT `qualification_status`.
- **Corrective Changes:**
  - Verified and confirmed that subsequent supplier decisions and snapshot state updates do not mutate `qualification_status` and thus do not alter or collide on `authoritative_outcome_key`.
  - Migration 016 (`pool_supplier_commercial_decisions`) binds to `snapshot_id` via separate unique constraint `uq_supplier_decisions_snapshot`, ensuring 1:1 decision mapping.
- **Test Evidence:** `tests/part4d3_supplier_decision_gate.js` (Test 3: Migration 015 unique outcome key verified non-obstructive to decisions; Test 15: DB-level 1:1 constraint verified).
- **Status:** **RESOLVED** (Verified in Part 4D.3 Gate).

---

### OBS-67: Supplier Authorization & Anti-Impersonation Security Matrix
- **Description:** Ordinary suppliers or platform administrators must not be permitted to submit commercial decisions on behalf of another supplier. Standard `authorize('SUPPLIER')` had an automatic `SUPER_ADMIN` role bypass.
- **Root Cause Analysis:** Admin role bypasses in general authorization middlewares create a dangerous legal risk where platform operators could forge commercial supplier consent.
- **Corrective Changes:**
  - Added `authorizeStrict('SUPPLIER')` in `src/middlewares/authGuard.js` which strictly requires `req.user.role === 'SUPPLIER'` with zero administrative override or impersonation.
  - In `src/routes/v1/poolRoutes.js`: Mounted `POST /:id/supplier-decision` guarded by `protect`, `authorizeStrict('SUPPLIER')`, `requireVerifiedSupplier`, and `idempotencyGuard.required`.
  - In `src/services/commercialLifecycleService.js`: Enforced tenant ownership verification (`Number(pool.supplier_id) === Number(actor.id)`), live KYC verification, and account trust checks directly in the row-locked transaction.
  - Guarded read-model `GET /:id/supplier-decision` to authorize only Admin, Owner Supplier, and Participating Buyers with zero buyer PII exposure.
- **Test Evidence:** `tests/part4d3_supplier_decision_gate.js` (Test 8: Admin rejected with 403; Test 9: Competitor rejected with 403; Test 10: Unverified supplier rejected with 403; Test 20: Read-model competitor rejected with 403).
- **Status:** **RESOLVED** (Verified in Part 4D.3 Gate).

---

### OBS-68: Buyer Commitment Deadline Exclusive Boundary & Post-Lock Database Server Time Check
- **Description:** Buyer commercial offer acceptance or decline must strictly respect the `buyer_commitment_deadline` established during supplier acceptance. Under concurrent load or network delay, a buyer request dispatched prior to deadline could sit in an engine wait-queue or lock-contention queue until after the deadline has expired. Furthermore, using application server clocks risks clock drift vulnerabilities.
- **Root Cause Analysis:** Application-layer timestamp comparisons risk clock desynchronization, and evaluations performed before acquiring exclusive row locks allow requests to slip through if locks are acquired after deadline expiration.
- **Corrective Changes:**
  - In `src/services/commercialLifecycleService.js`:
    - Enforced post-lock database server time evaluation using `NOW()` inside the serialized transaction (`SELECT ... FOR UPDATE`):
      `NOW() > deadline` or `NOW() = deadline` triggers strict immediate rejection with HTTP 422 `COMMITMENT_DEADLINE_EXPIRED`.
    - Enforced boundary behavior where exact deadline boundary (`NOW() = deadline`) is considered closed/expired.
    - Added deadline evaluation in `getBuyerCommercialOffer`: returning `is_deadline_expired: true` and `can_act: false` when `NOW() > deadline`.
- **Test Evidence:** `tests/part4d4_buyer_commitment_gate.js` (Test 11: Expired deadline rejected with 422; Test 12: Exact deadline boundary rejected; Test 13: Read model reflects expired deadline).
- **Status:** **RESOLVED** (Verified in Part 4D.4 Gate).

---

### OBS-69: Commercial Snapshot Historical Immutability Post-Supplier Acceptance
- **Description:** Once a supplier accepts or rejects a commercial qualification snapshot, that snapshot record and its cryptographic digest (`snapshot_hash`) represent an authoritative commercial baseline. Subsequent buyer decisions (`ACCEPT` or `DECLINE`) must never mutate or overwrite the snapshot row.
- **Root Cause Analysis:** Risk of consolidating downstream buyer decision states into the single snapshot record, violating append-only audit principles.
- **Corrective Changes:**
  - Authored Migration 017 (`database/migrations/017_pool_buyer_commercial_decisions.sql`):
    - Created dedicated table `pool_buyer_commercial_decisions` to store immutable, row-level buyer consent and decline decisions.
    - Enforced unique constraint `uq_buyer_decisions_reservation_snapshot (reservation_id, snapshot_id)` guaranteeing exactly one immutable decision per buyer reservation per snapshot.
  - In `src/services/commercialLifecycleService.js`:
    - Buyer decision transactions insert into `pool_buyer_commercial_decisions` without issuing any `UPDATE` statements against `pool_commercial_snapshots`.
    - Confirmed `pool_commercial_snapshots.snapshot_hash`, `final_unit_price`, and `status` remain completely unmodified.
- **Test Evidence:** `tests/part4d4_buyer_commitment_gate.js` (Test 14: Snapshot immutability verified; snapshot hash and updated_at unchanged).
- **Status:** **RESOLVED** (Verified in Part 4D.4 Gate).

---

### OBS-70: Binding Contractual Price Locking & Opt-Out Repricing Immunity
- **Description:** When a buyer accepts an agreed commercial offer, their unit price must be contractually locked. If subsequent peer buyers in the same pool decline the offer, the remaining committed volume drops. Under collective tier pricing, falling below a volume tier threshold could tempt naive pricing systems to reprice upward or recalculate unit prices for already-accepted buyers.
- **Root Cause Analysis:** Re-evaluating volume tiers post-qualification would violate B2B commercial good faith and contractual certainty.
- **Corrective Changes:**
  - In `src/services/commercialLifecycleService.js`:
    - Upon buyer `ACCEPT`, atomic transaction updates `reservations.locked_unit_price = snapshot.final_unit_price` and sets `status = 'CONFIRMED'`.
    - `locked_total_price` is computed deterministically as `ROUND(locked_unit_price * quantity, 2)`.
    - When subsequent peer buyers `DECLINE` (or cancel), neither the pool's agreed price nor any peer buyer's `locked_unit_price` is recalculated or altered.
    - Implemented `getPoolCommittedDemandSummary(poolId)` to provide transparent, real-time demand accounting without triggering retroactive pricing changes.
- **Test Evidence:** `tests/part4d4_buyer_commitment_gate.js` (Test 3: ACCEPT locks unit price; Test 7: Peer decline does not reprice accepted buyers; Test 19: Demand accounting reflects committed vs declined demand).
- **Status:** **RESOLVED** (Verified in Part 4D.4 Gate).

---

### OBS-71: Reservation Demand, Commitment Accounting & Converted Order Tracking
- **Description:** Required strict architectural separation between original qualified demand, supplier-accepted demand, buyer ACCEPT quantity, buyer DECLINE quantity, pending cohort demand, active capacity consumption, and future converted order demand. In addition, transitioning reservations from `RESERVED` to `CONFIRMED` must never double-count or drop obligations, and unknown reservation statuses must fail closed.
- **Root Cause Analysis:** Conflation of initial aggregated reservation quantities with final binding commitments and order conversions across post-qualification states.
- **Corrective Changes:**
  - In `src/services/reservationDemandPolicy.js`:
    - Enforced `DEMAND_ELIGIBLE_STATUSES` (`RESERVED`, `CONFIRMED`, `PAID`) as the authoritative source of capacity consumption. A reservation transitioning from `RESERVED` to `CONFIRMED` remains active and cannot be double-counted or dropped.
    - Preserved `auditReservationStatuses`: any unknown status string fails closed by being treated as a potential obligation (`hasUnknownStatus: true`), preventing overselling.
  - In `src/services/commercialLifecycleService.js` (`getPoolCommittedDemandSummary`):
    - Added explicit separation for `original_qualified_demand`, `supplier_accepted_demand`, `buyer_accepted_demand`, `buyer_declined_demand`, `buyer_pending_demand`, `converted_order_demand`, and `converted_order_count`.
  - In `src/services/commercialReconciliationService.js`:
    - Evaluates exact 4-decimal quantities and counts across each lifecycle stage.
- **Test Evidence:** `tests/part4e1_order_foundation_gate.js` (Test 10: Demand accounting separation; Test 17: Non-confirmed reservation and unknown status policy fail closed).
- **Status:** **RESOLVED** (Verified in Part 4E.1 Gate).

---

### OBS-72: Contractual Price Guarantee Verification & Fail-Closed Shortfall Policy
- **Description:** Inspected whether supplier commercial acceptance contains an explicit contractual guarantee to supply at the qualified volume-tier price even if final buyer commitments drop below the supplier minimum or volume threshold.
- **Root Cause Analysis:** In standard B2B volume-tier contracts, volume discounts are contingent upon volume thresholds. Neither `pool_supplier_commercial_decisions` nor `pool_commercial_snapshots` established an unconditional supplier commitment to fulfill at a higher tier's discount price if buyer opt-outs cause final demand to collapse below `supplier_min_qty`.
- **Corrective Changes:**
  - Formulated explicit contractual rule:
    - Accepted buyer price locks (`reservations.locked_unit_price`) remain immutable and binding on that buyer's reservation (no retroactive price increase on the buyer).
    - If final buyer accepted demand meets or exceeds `supplier_min_qty`, pricing is confirmed and quorum is verified (`pricing_guarantee_status = 'QUORUM_VERIFIED'`).
    - If final buyer accepted demand falls below `supplier_min_qty`, without an explicit approved supplier shortfall guarantee, order conversion fails closed with reason code `FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM` and `pricing_guarantee_status = 'UNSUPPORTED_SHORTFALL'`.
- **Test Evidence:** `tests/part4e1_order_foundation_gate.js` (Test 6: Deficit to supplier minimum blocks readiness; Test 7: Accepted buyer price lock remains intact during shortfall evaluation).
- **Status:** **RESOLVED** (Verified in Part 4E.1 Gate).

---

### OBS-73: Exact Merchandise Subtotal vs Final Payable Amount Contract
- **Description:** Clarified the exact contractual meaning of `reservations.locked_total_price` and established explicit financial component separation to prevent assuming delivery, platform, or tax fees are zero.
- **Root Cause Analysis:** Early prototype fields risked conflating merchandise subtotal with total payable order amount before delivery and platform fees are calculated.
- **Corrective Changes:**
  - In `src/services/commercialReconciliationService.js`:
    - Formally established that `reservations.locked_total_price` is strictly the **merchandise subtotal** (`ROUND(locked_quantity * locked_unit_price, 2)`).
    - Validates exact 2-decimal calculations; any discrepancy or tampering triggers `SUBTOTAL_CALCULATION_MISMATCH` or `SNAPSHOT_PRICE_DISCREPANCY` (fail-closed).
    - Explicitly breaks out financial components in order readiness DTO:
      - `merchandise_subtotal`: locked and verified.
      - `delivery_fee_status`: `'DETERMINED_ZERO'` (for `SUPPLIER_PICKUP`) or `'PENDING_ORDER_GENERATION'` (for `DOORSTEP`/`GROUPED_CLUSTER`).
      - `buyer_platform_fee_status`: `'PENDING_ORDER_GENERATION'`.
      - `tax_status`: `'EXEMPT_OR_UNSPECIFIED'`.
      - `payable_total_status`: `'REQUIRES_FEE_COMPOSITION_AT_ORDER_CREATION'`.
    - Guarantees no premature billing or zero-fee assumptions.
- **Test Evidence:** `tests/part4e1_order_foundation_gate.js` (Test 2: Merchandise subtotal separated from pending fees; Test 14: Fractional decimal quantity rounding; Test 15: Tampered subtotal fails closed; Test 16: Divergent unit price fails closed).
- **Status:** **RESOLVED** (Verified in Part 4E.1 Gate).

---

### OBS-74: Final-Demand Quorum & State Machine Order Conversion Invariants
- **Description:** Defined authoritative rules for determining when an accepted buyer commitment is eligible to be converted into an order, handling cases where final demand is above minimum, exactly at minimum, below minimum with an active deadline, below minimum with an expired deadline, or when an order has already been converted.
- **Root Cause Analysis:** Lack of an explicit commercial readiness evaluation state machine between buyer acceptance and order creation.
- **Corrective Changes:**
  - Implemented `commercialReconciliationService.evaluateOrderReadiness`:
    - `buyer_accepted_demand >= supplier_min_qty`: `ELIGIBLE_FOR_ORDER` (quorum verified).
    - `buyer_accepted_demand < supplier_min_qty` AND `NOW() <= buyer_commitment_deadline`: `BUYER_COMMITMENTS_PENDING` (still awaiting cohort).
    - `buyer_accepted_demand < supplier_min_qty` AND `NOW() > buyer_commitment_deadline`: `FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM` (blocked).
    - Existing order in `orders` table matching `buyer_decision_id` or `reservation_id`: `ORDER_ALREADY_CONVERTED` (blocked from duplicate conversion).
    - Applied Migration 018 (`018_order_foundation_and_commercial_linkage.sql`) adding `uq_orders_buyer_decision (buyer_decision_id)` unique constraint and updating `orders.total_qty` to `DECIMAL(12,4)`.
- **Test Evidence:** `tests/part4e1_order_foundation_gate.js` (Test 1: Quorum met eligible; Test 8: Exact minimum quorum; Test 9: Active deadline reports BUYER_COMMITMENTS_PENDING; Test 12: DB unique constraint prevents duplicate order; Test 13: ORDER_ALREADY_CONVERTED blocked).
- **Status:** **RESOLVED** (Verified in Part 4E.1 Gate).

---

### OBS-75: Binary Floating-Point Monetary Arithmetic
- **Description:** Remove unsafe binary floating-point operations from authoritative monetary calculation and comparison paths affected by commercial reconciliation.
- **Root Cause Analysis:** JavaScript `Number()`, multiplication, and `.toFixed(2)` suffer from IEEE-754 binary floating-point representation limits. For example, `0.0030 * 5.00 = 0.015`, but in JavaScript `(0.015).toFixed(2)` produces `'0.01'` (downward truncation due to `0.014999999999999999...`), whereas MySQL `ROUND(0.0030 * 5.00, 2)` produces `'0.02'`.
- **Corrective Changes:**
  - Built `src/services/exactDecimal.js` using BigInt scaled-integer math for exact decimal multiplication, half-up rounding, and canonical formatting.
  - In `src/services/commercialReconciliationService.js`: Replaced JavaScript `Number` multiplication with `exactDecimal.exactMultiplyRound(rawQty, rawUnitPrice, 2)`.
  - Added strict validation rejecting `NaN`, `Infinity`, scale overflow, and syntax errors.
- **Test Evidence:** `tests/part4e1_1_financial_hardening_gate.js` (Tests 1–6: Exact multiplication, rounding invariants, float edge-cases matching MySQL ROUND, overflow checks).
- **Status:** **RESOLVED** (Verified in Part 4E.1.1 Gate).

---

### OBS-76: Approximate Monetary Equality & Arbitrary Tolerance Removal
- **Description:** Eliminate arbitrary tolerance logic (e.g. `Math.abs(expected - stored) <= 0.01`) that could allow subtotal discrepancies or tampering to pass undetected.
- **Root Cause Analysis:** Initial reconciliation draft utilized `Math.abs(lockedTotalPrice - expectedSubtotal) > 0.01` and `Math.abs(lockedUnitPrice - snapshotPrice) > 0.01`, allowing subtle 1-cent differences to pass.
- **Corrective Changes:**
  - Implemented `exactDecimal.exactDecimalEquals(valA, valB, scale = 2)` performing exact string comparison in canonical format (e.g. `'4800.00'`).
  - In `src/services/commercialReconciliationService.js`: Replaced tolerance thresholds with `!exactDecimalEquals(rawLockedTotalPrice, expectedSubtotalStr, 2)` and `!exactDecimalEquals(rawLockedUnitPrice, rawSnapshotPrice, 2)`.
  - Enforced zero-tolerance fail-closed rejection: exactly 1-cent tampering triggers `SUBTOTAL_CALCULATION_MISMATCH`.
- **Test Evidence:** `tests/part4e1_1_financial_hardening_gate.js` (Tests 7–8: Canonical comparison & 1-cent rejection; Test 10: 1-cent tampering fails closed; Test 11: Snapshot unit price discrepancy fails closed).
- **Status:** **RESOLVED** (Verified in Part 4E.1.1 Gate).

---

### OBS-77: Multi-Query Inconsistent Commercial Read Isolation
- **Description:** Advisory order readiness read model evaluated multiple SQL queries (reservations, snapshots, supplier decisions, buyer decisions, quorum demand aggregates) across uncoordinated pool connections, risking inconsistent state observation during concurrent buyer decisions.
- **Root Cause Analysis:** Independent `db.query()` calls execute over separate connections from the connection pool, observing different committed snapshots if concurrent transactions commit midway through evaluation.
- **Corrective Changes:**
  - In `src/services/commercialReconciliationService.js`:
    - Acquired a single dedicated connection: `const connection = await db.getConnection()`.
    - Set isolation level and established point-in-time snapshot:
      `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;`
      `START TRANSACTION WITH CONSISTENT SNAPSHOT;`
    - Routed all queries (reservation, users, snapshots, supplier decisions, buyer decisions, orders, cohort demand) through `connection`.
    - Guaranteed cleanup in `finally` block: `await connection.rollback(); connection.release();`.
    - Zero write locks, zero pool-level blocking, zero outbox events, advisory-only.
- **Test Evidence:** `tests/part4e1_1_financial_hardening_gate.js` (Test 12: Deterministic concurrency test verifying MVCC snapshot isolates unobserved concurrent decisions; Test 13: Subsequent call observes updated quorum).
- **Status:** **RESOLVED** (Verified in Part 4E.1.1 Gate).

---

### OBS-78: Tax, Fee & Payable-Total Semantics Classification
- **Description:** Resolve ambiguity in financial breakdown statuses, specifically verifying that unknown tax or fees are not mislabeled as exempt or zero.
- **Root Cause Analysis:** Previous readiness payload returned `tax_status: 'EXEMPT_OR_UNSPECIFIED'` and `delivery_fee_status: 'PENDING_ORDER_GENERATION'`, which risked being misinterpreted as confirmed tax exemption or zero delivery fee.
- **Corrective Changes:**
  - In `src/services/commercialReconciliationService.js`:
    - `tax_status` updated to `'PENDING_DETERMINATION'` (never asserting legal exemption without proof).
    - `delivery_fee_status`: `'DETERMINED_ZERO'` for `SUPPLIER_PICKUP`; `'PENDING_QUOTE'` for `DOORSTEP` / cluster delivery.
    - `buyer_platform_fee_status`: `'PENDING_ORDER_GENERATION'` / `'PENDING_POLICY'`.
    - `payable_total_status`: `'REQUIRES_FEE_COMPOSITION_AT_ORDER_CREATION'`.
    - Strict separation maintained: `merchandise_subtotal` is explicitly isolated from payable total.
- **Test Evidence:** `tests/part4e1_1_financial_hardening_gate.js` (Tests 14–17: Tax status PENDING_DETERMINATION, delivery fee PENDING_QUOTE vs DETERMINED_ZERO, and merchandise subtotal isolation).
- **Status:** **RESOLVED** (Verified in Part 4E.1.1 Gate).

---

### OBS-79: Order Readiness vs Order Creatable vs Payment-Ready Lifecycle States
- **Description:** Disentangle the conceptual difference between order-readiness evaluation, order creation readiness, and payment readiness to ensure an order is never generated with unresolved payable components and no payment intent is triggered prematurely.
- **Root Cause Analysis:** Order readiness evaluates whether commercial prerequisites (snapshot, supplier confirmation, buyer acceptance, cohort quorum) are satisfied. However, order creation requires composing and freezing approved payable components (`merchandise_subtotal + delivery_fee + buyer_platform_fee`). If delivery fee policy or platform fees cannot be authoritatively determined, order creation must fail closed with `PAYABLE_COMPONENTS_UNRESOLVED`. Initial order state is strictly `AWAITING_PAYMENT` before any Safepay interaction.
- **Corrective Changes:**
  - `src/services/orderService.js`:
    - Strict validation in write transaction under parent-pool-first `FOR UPDATE` lock.
    - Delivery fee evaluation: explicitly supports `SUPPLIER_PICKUP` (Rs. 0.00), `STANDARD_DELIVERY` (Rs. 150.00), or flat trip fee; fails closed with 422 `PAYABLE_COMPONENTS_UNRESOLVED` for unsupported/unquoted policies.
    - Buyer platform fee evaluation via `feeService.calculateBuyerFee()` using database slabs.
    - Exact decimal summation: `total_amount = exactAddRound(subtotal, exactAddRound(deliveryFee, platformFee))`.
    - Initial order status and payment status are strictly `AWAITING_PAYMENT`.
- **Test Evidence:** `tests/part4e2_order_conversion_gate.js` (Test 1: Canonical order creation in AWAITING_PAYMENT; Test 8: SUPPLIER_PICKUP zero delivery fee; Test 9: Unresolved delivery fee fails closed with 422 PAYABLE_COMPONENTS_UNRESOLVED; Test 21: Zero payments/sessions created).
- **Status:** **RESOLVED** (Verified in Part 4E.2 Gate).

---

### OBS-80: Security Trust Boundary on Test Hooks (`testHooks`)
- **Description:** Internal testing injection hooks (`testHooks`) in domain services must never be reachable or exploitable via HTTP client request bodies or query parameters.
- **Root Cause Analysis:** Direct forwarding of `req.body` or options objects into internal service methods could allow an adversary to supply arbitrary hooks (such as bypassing checks or inducing crashes) if not strictly isolated by trust boundary.
- **Corrective Changes:**
  - `src/services/commercialReconciliationService.js` and `src/services/orderService.js`:
    - Wrapped `testHooks` execution inside `process.env.NODE_ENV === 'test'` condition.
    - `src/controllers/reservationController.js`: Excluded `testHooks` from HTTP request payload extraction (`const { delivery_address, notes } = req.body || {}`).
    - Service layer ignores `testHooks` when `NODE_ENV !== 'test'` and never reads hooks from untrusted request input.
- **Test Evidence:** `tests/part4e2_order_conversion_gate.js` (Test 18: Simulated crash via test hook strictly isolated under test environment; production payload test in Part 4E.2).
- **Status:** **RESOLVED** (Verified in Part 4E.2 Gate).

---

### OBS-81: Client-Controlled Amount and Currency Tampering in Checkout Initiation
- **Description:** Payment checkout session generation must never accept amounts, currencies, or line-item totals from client request bodies or query parameters. Checkout initiation must be strictly server-driven and bound directly to authoritative, persisted database order records.
- **Root Cause Analysis:** In naive payment integrations, client applications often submit `{ amount, currency, order_id }` in the checkout body. If server controllers forward these values to the payment gateway (e.g. Safepay), a malicious buyer can tamper with the payload (e.g. paying Rs. 1.00 for a Rs. 26,700.00 order) and gain unauthorized order confirmation.
- **Corrective Changes:**
  - `src/services/safepayCheckoutService.js`:
    - Completely ignores any `amount` or `currency` passed in `req.body`.
    - Fetches the locked `orders` row by `orderId` under consistent database read.
    - Validates order state (strictly `AWAITING_PAYMENT`), buyer ownership (tenant isolation), and buyer trust status (`buyer_trust_status !== 'SUSPENDED'`).
    - Uses exact canonical decimal value from `order.total_amount` for the Safepay tracker initiation.
    - Strictly restricts currency to `PKR` (fails closed with `UNSUPPORTED_CURRENCY` if otherwise).
    - Executes third-party Safepay API request completely outside MySQL transaction write locks.
    - Durably records session in `payment_attempts` with `status = 'INITIATED'` and updates `orders.payment_status = 'PAYMENT_INITIATED'`.
- **Test Evidence:** `tests/part4e3_safepay_sandbox_payment_gate.js` (Test 16: Client sends tampered Rs. 1.00 and USD currency; server successfully defeats tampering, charges exact stored Rs. 26,700.00 in PKR, and persists attempt).
- **Status:** **RESOLVED** (Verified in Part 4E.3 Gate).

---

### OBS-82: Raw Webhook Signature Verification and Exactly-Once Order State Transition
- **Description:** Webhook notifications from Safepay must be authenticated via cryptographic HMAC-SHA256 signature verification over untouched raw body bytes, and must atomically confirm order payment exactly once while preventing replay attacks and race conditions.
- **Root Cause Analysis:** Standard JSON body parsers alter JSON formatting and whitespace, which invalidates cryptographic HMAC signatures computed over the original HTTP request bytes. Furthermore, concurrent or repeated webhook deliveries can trigger duplicate state mutations, duplicate payments entries, or duplicate business events if not guarded by database transactions and deduplication keys.
- **Corrective Changes:**
  - `server.js`: Added `verify: (req, res, buf) => { req.rawBody = buf; }` to `express.json({ limit: '10mb' })` to capture the exact raw buffer of incoming requests.
  - `src/services/safepayAdapter.js`:
    - Implemented `verifyWebhookSignature({ rawBody, signature, timestamp })`.
    - Formats signed payload as `${timestampHeader}.${rawBody}`.
    - Supports both `sha256=<hex>` and raw `<hex>` header formats.
    - Uses `crypto.timingSafeEqual` with matching buffer lengths to prevent timing attacks.
  - `src/services/safepayCheckoutService.js`:
    - Idempotently checks `payment_webhook_events` for existing `event_id` before processing.
    - In atomic MySQL transaction under `FOR UPDATE` lock on matching `payment_attempts` and `orders`:
      * Verifies currency and exact decimal amount equality via `exactDecimal.exactDecimalEquals`.
      * Fails closed with 422 if amount or currency does not match order.
      * Ignores duplicates safely if order is already `PAID`.
      * Updates `payment_attempts.status = 'COMPLETED'`.
      * Transitions `orders.order_status = 'PAID'` and `orders.payment_status = 'PAID'`.
      * Inserts authoritative record into `payments` table with `status = 'PAID'` and `escrow_status = 'HELD_IN_ESCROW'`.
      * Emits transactional outbox event `ORDER_PAID` into `reservation_business_events`.
- **Test Evidence:** `tests/part4e3_safepay_sandbox_payment_gate.js` (Tests 18–25: Missing/forged/tampered signature rejected with 401; amount mismatch rejected with 422; authentic webhook transitions order to PAID and inserts payment row; duplicate webhook acknowledged safely without duplicate mutations).
- **Status:** **RESOLVED** (Verified in Part 4E.3 Gate).




