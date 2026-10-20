# MilJor — Regular Pool Architecture & Compatibility Specification (Part 4A.1 Reconciled)

**Author:** Principal Backend Architect & Senior MySQL Engineer  
**Date:** 2026-10-18  
**Phase:** Part 4A.1 (Architecture & Implementation Contract Reconciliation)  
**Status:** RECONCILED & VERIFIED — TECHNICAL BASELINE ESTABLISHED

---

## 1. Executive Summary & Architecture Scope

This document provides the definitive, production-grade architectural specification, data integrity rules, lifecycle state machines, mathematical tier models, and transaction locking contracts for completing the **Regular Pool Engine (Parts 4B–4F)** in the MilJor B2B collective procurement platform.

This specification directly reconciles the previous draft with actual codebase realities and approved business rules:
1. **Accurate Commercial Sequence:** Replaces the incorrect `RESERVED -> CONFIRMED -> PAID -> CONVERTED_TO_ORDER` flow with the approved contract sequence: Buyer Reservation $\to$ Pool Target/Minimum Eligibility $\to$ Supplier Confirmation $\to$ Buyer Final Terms Acceptance & Price Lock $\to$ Order Created (`AWAITING_PAYMENT`) $\to$ Payment Intent Created $\to$ Gateway Server-Side Confirmation $\to$ Order `PAID` $\to$ Fulfillment Begins.
2. **Payment & Ledger Accuracy:** Clarifies that **Safepay Sandbox** is the intended card/digital payment gateway provider. Completely eliminates JazzCash assumptions. Accurately identifies platform fee distribution records as marketplace settlement allocations rather than pretending they constitute a full double-entry accounting ledger. Clarifies that MilJor provides conditional platform escrow / fund holding semantics rather than legally regulated banking escrow without accredited status.
3. **Mathematical Tier Pricing & Units:** Eliminates the naive assumption that `target_qty` is automatically the lowest price tier. Defines strict non-overlapping tier intervals, discrete indivisible package purchase constraints, canonical pool calculation units vs. display units, and unambiguous pricing behavior before `supplier_min_qty` is achieved.
4. **Decoupled Three-Pillar Lifecycle:** Pool lifecycle (demand aggregation & supplier contract), Reservation lifecycle (individual buyer participation & price agreement), and Order lifecycle (payment, delivery, settlement) are completely independent state machines.
5. **Configurable SLA Policies:** Replaces hardcoded 24-hour rules with configurable policy windows and defines early closure rules when pools reach target volume ahead of schedule.
6. **Commercial Inventory Allocation:** Reconciles physical stock vs. replenishment capacity, preventing overselling while permitting commercially viable procurement contracts.
7. **Atomic Operations & Lock Ordering:** Solves existing code-level transactional defects (`createPool` non-atomic tier insertion, initial status, lock hierarchy).

---

## 2. Audit of Existing Code Paths & Code-Specific Defects

A meticulous inspection of `src/controllers/poolController.js`, `src/repositories/poolRepo.js`, `src/repositories/reservationRepo.js`, `src/services/poolClosureService.js`, and database migrations 001–005 reveals the following concrete implementation defects to be resolved in Part 4B:

| Component | File & Method | Current Behavior (Defect) | Required Corrective Contract (Part 4B) |
| :--- | :--- | :--- | :--- |
| **Pool Creation Initial Status** | `poolRepo.js:createPool` | Hardcodes `'ACTIVE'` directly into `INSERT INTO pools (...) VALUES (..., 'ACTIVE', ...)`. | Pools should be created either in `'DRAFT'` (requiring deliberate publishing) or optionally `'ACTIVE'` only if fully configured, validated, and immediately open. |
| **Atomicity of Pool & Tiers** | `poolController.js:createPool` | Executes `poolRepo.createPool` using `db.query`, then iterates through tiers calling `poolRepo.createPriceTier` with individual `db.query` calls outside any database transaction. A failure during tier insertion leaves an orphaned, invalid pool in MySQL. | Wrap pool row creation, tier insertions, listing capacity lock, and audit logging into a single atomic `connection.beginTransaction()` with strict rollback on error. |
| **Specification & Listing Validation** | `poolController.js:createPool` | Only verifies `productRepo.findById(product_id)`. Completely ignores `product_spec_id` and `supplier_listing_id`. | Must validate that `product_spec_id` exists, belongs to `product_id`, and if `supplier_listing_id` is supplied, verify supplier ownership, active status, and inventory supportability. |
| **Capacity Allocation Check** | `reservationRepo.js:createReservation` | Checks `buyer_min_qty` and duplicate reservation, but completely lacks any check against `pool.max_capacity`. | Lock pool row `FOR UPDATE`, verify `pool.current_qty + quantity <= pool.max_capacity`. Return HTTP 409 `CAPACITY_EXCEEDED` if breached. |
| **Lock Ordering & Concurrency** | `reservationRepo.js` & `poolController.js` | Inconsistent lock acquisition order across pool confirmation and reservation confirmation paths creates potential deadlock hazards. | Standardize lock hierarchy: Always acquire `pools` row lock `FOR UPDATE` first, followed by `reservations` rows sorted by `id ASC` `FOR UPDATE`. |
| **Financial Error Information Leakage** | `reservationController.js`, `poolController.js` | Emits raw error messages: `error.message` directly in HTTP response payloads. | Catch specific domain errors and sanitize outputs. Never leak internal MySQL constraint errors, table names, or raw SQL exceptions to client responses. |
| **Conflation of Fulfillment Status** | `pools.status` enum in `schema.sql` | Enum contains `FULFILLING`, `DISPATCHED`, `DELIVERED` directly on the shared pool table. | Shared pool tracks demand and supplier commitment (`ACTIVE`, `CONFIRMED`, `COMPLETED`, etc.). Individual fulfillment belongs strictly to `orders`. |

---

## 3. Product Specification, Units, and Inventory Allocation Contract

### 3.1 Three-Tier Product Resolution Hierarchy
A Regular Pool aggregates demand for a physically precise, commercially verified B2B food commodity. It must resolve unambiguously through three layers:
```
1. Master Product (Commodity Category: Rice, Ghee, Sugar, Flour, Pulses)
   └── 2. Product Specification (Physical Spec: Brand, Variety, Grade, Packaging, Unit)
         └── 3. Supplier Listing (Commercial Offer: Warehouse, Stock, Logistics Terms)
               └── 4. Regular Pool (Demand Aggregation Vehicle)
```

- **Master Commodity (`product_id`):** Top-level classification (e.g., `Super Basmati Rice`).
- **Physical Specification (`product_spec_id`):** Deterministic, canonical physical specification identified by SHA-256 hash (e.g., *Guard Super Basmati, 2024 Crop, Double Polished, 25 kg Polypropylene Bag*).
- **Supplier Listing (`supplier_listing_id`):** The supplier's underlying commercial offer backing the pool.
- **Historical Pool Guarantee:** Historical pools (`MJ-POOL-0001` and `MJ-POOL-0002`) remain untouched with `product_id` preserved and `product_spec_id = NULL`. Unverified historical physical grades are never retroactively guessed or fabricated.

### 3.2 Canonical Pool Quantity Units & Packaging Integrity
1. **Canonical Pool Quantity Unit (`pool_unit`):**  
   All mathematical calculations in the database and repositories (aggregation, tier evaluation, minimums, maximum capacity, reservation additions/subtractions) are performed using one **single canonical unit** defined at the pool level (e.g., `bag`, `carton`, `tin`, or `kg`).
2. **Indivisible Pack Rule:**  
   If a product specification has a pack size (e.g., 25 kg bag, 16 L tin), reservations and orders must represent **integer quantities of whole, indivisible packs**. Fractional purchase of indivisible commercial packaging (e.g., reserving 2.3 bags) is strictly prohibited at the validation boundary.
3. **Display Conversions:**  
   Conversions to base metric units (e.g., total metric tonnes or total kg) are handled strictly at the presentation / service transformation layer for UI display and reporting, and are never used as floating-point calculation intermediates for core transactions.

### 3.3 Supplier Inventory Allocation & Concurrency Rules
In B2B wholesale, suppliers may fulfill pools from immediate warehouse stock or confirmed production/mill replenishment schedules:
- **Available Stock Evaluation:** If backed by an active `supplier_listing_id`, the pool's allocation obligation is evaluated against the supplier's commercial capacity.
- **Overselling Prevention:** The pool's `max_capacity` (or `target_qty` if no max capacity is set) cannot exceed the supplier's verified available stock plus contractually approved replenishment quota.
- **Soft Allocation on Creation:** When a pool is activated, its committed volume is marked as reserved from the listing's available pool allocation capacity.
- **Concurrency & Stock Reclamation:** If a pool expires without reaching `supplier_min_qty` or is cancelled, the allocated capacity is immediately released back to the supplier's active listing stock.

---

## 4. Commercial Quantities & Mathematical Tier Engine

### 4.1 Independent Commercial Variables
The following variables govern pool volume and economics independently. None may be implicitly inferred from another:
- **`buyer_min_qty` (Individual Ticket MOQ):** The minimum number of canonical units a single buyer can reserve in one ticket (e.g., 5 bags).
- **`supplier_min_qty` (Pool Threshold MOQ / Minimum Viability Volume):** The minimum aggregate volume across all buyers required for the supplier to be contractually bound to fulfill the pool (e.g., 100 bags).
- **`target_qty` (Commercial Target Volume):** The aggregate milestone that signals optimal pooling success (e.g., 500 bags). Reaching target quantity triggers pool closure evaluation.
- **`max_capacity` (Hard Physical Allocation Cap):** The absolute maximum volume the supplier can supply for this specific pool (e.g., 800 bags).
- **Invariant:** $1 \le \text{buyer\_min\_qty} \le \text{supplier\_min\_qty} \le \text{target\_qty} \le \text{max\_capacity}$.

### 4.2 Non-Overlapping Tier Interval Contract
Tiers are defined as continuous, non-overlapping intervals over canonical pool units with exact `DECIMAL(12,2)` price precision:
$$\text{Tier } k = [\text{min\_qty}_k, \text{max\_qty}_k] \implies \text{price\_per\_unit}_k$$

**Contract Invariants:**
1. **Coverage Continuity:** $\text{min\_qty}_{k+1} = \text{max\_qty}_k + 1$ (zero gaps, zero overlaps across integer pack units).
2. **Monotonic Price Reduction:** For all $k > 1$, $\text{price\_per\_unit}_k < \text{price\_per\_unit}_{k-1}$.
3. **First Tier Minimum:** The first tier $\text{min\_qty}_1$ does **not** have to equal 1 or `buyer_min_qty`. It starts at the pool's lowest pricing threshold (e.g., Tier 1 might start at `supplier_min_qty` or at 1 if early baseline pricing is published).
4. **Target Quantity Independence:** `target_qty` is **not** automatically the cheapest tier. The pricing structure can define multiple subsequent volume tiers above `target_qty` up to `max_capacity`.

### 4.3 Estimated vs. Final Locked Pricing Semantics
- **Phase A: Demand Aggregation (`status = 'ACTIVE'`):**
  - Reservations are created in `RESERVED` status.
  - The reservation displays an **Estimated Unit Price**.
  - **Before `supplier_min_qty` is reached:** The estimated price displayed is Tier 1 price, accompanied by an explicit flag: `supplier_threshold_met = false`. The buyer is informed that this price is contingent upon the pool meeting minimum viability.
  - **When volume crosses tier boundaries:** `current_price_per_unit` on the pool updates to the newly unlocked tier price. All existing active `RESERVED` reservations update their estimated price and estimated total.
- **Phase B: Price Locking & Terms Acceptance:**
  - When the pool qualifies and the supplier confirms fulfillment, the final tier price is determined based on the exact final volume:
    $$\text{final\_unit\_price} = \text{price\_per\_unit}_k \quad \text{where} \quad \text{min\_qty}_k \le \text{final\_pool\_qty} \le \text{max\_qty}_k$$
  - The buyer must explicitly review and accept the final terms.
  - Upon buyer confirmation, `locked_unit_price` and `locked_total_price` are frozen into the reservation.
  - **Immutability Invariant:** Once locked, `locked_unit_price` can **never** be retroactively altered by subsequent system actions.

---

## 5. Decoupled Lifecycles: Pool vs. Reservation vs. Order

### 5.1 Three Independent State Domains
MilJor strictly decouples the collective pool lifecycle, the individual buyer's reservation lifecycle, and the individual buyer's fulfillment order lifecycle:

```
+---------------------------------------------------------------------------------------------+
|                                    1. POOL LIFECYCLE                                        |
|  [DRAFT] -> [ACTIVE] -> [TARGET_REACHED] -> [AWAITING_SUPPLIER_CONFIRMATION] -> [CONFIRMED] |
|                                                                              |              |
|                                                                              v              |
|                                                                         [COMPLETED]         |
|                       (Terminal Failures: [EXPIRED], [CANCELLED], [SUPPLIER_FAILED])        |
+---------------------------------------------------------------------------------------------+
                                              |
                                              v Triggers Buyer Confirmation Window
+---------------------------------------------------------------------------------------------+
|                                 2. RESERVATION LIFECYCLE                                    |
|  [RESERVED] ----------------------------> [CONFIRMED] ----------------> [CONVERTED_TO_ORDER]|
|  (Estimated Price)                  (Final Price Locked)               (Order Row Created)  |
|      |                                        |                                             |
|      v                                        v                                             |
|  [CANCELLED]                              [EXPIRED]                                         |
+---------------------------------------------------------------------------------------------+
                                                                                |
                                                                                v
+---------------------------------------------------------------------------------------------+
|                                    3. ORDER LIFECYCLE                                       |
|  [AWAITING_PAYMENT] -> [PAYMENT_INITIATED] -> [PAID] -> [PROCESSING] -> [DELIVERED] -> [DONE]|
|          |                                       |                                          |
|          v                                       v                                          |
|      [EXPIRED]                              [DISPUTED]                                      |
+---------------------------------------------------------------------------------------------+
```

### 5.2 Correct Commercial Sequence
1. **Reservation Phase:** Buyer reserves quantity in active pool. Reservation status is `RESERVED`. Estimated price is shown. Buyer may freely cancel without financial penalty.
2. **Pool Qualification:** Pool reaches scheduled closing time with `current_qty >= supplier_min_qty`, OR reaches `target_qty` / `max_capacity`. Pool moves to `AWAITING_SUPPLIER_CONFIRMATION`.
3. **Supplier Confirmation:** Supplier reviews final volume, delivery schedule, and logistics, and accepts via `PUT /api/v1/pools/:id/confirm`. Pool status moves to `CONFIRMED`. Final unit price is frozen for the pool.
4. **Buyer Commitment & Price Lock:** Buyer is notified of final terms and price. Buyer explicitly confirms via `PUT /api/v1/reservations/:id/confirm`. Reservation status moves to `CONFIRMED`, and `locked_unit_price` / `locked_total_price` are stamped permanently.
5. **Order Generation:** Upon buyer confirmation, an individual fulfillment row is created in the `orders` table in status `AWAITING_PAYMENT`, referencing the reservation.
6. **Payment Processing:** A payment intent is initiated against the order via the payment provider (Safepay Sandbox). Order moves to `PAYMENT_INITIATED`.
7. **Server-Side Verification:** The payment provider sends a signed server-to-server webhook confirming transaction success. The backend verifies signature and amount, updating order status to `PAID` and reservation status to `CONVERTED_TO_ORDER`.
8. **Fulfillment:** Supplier dispatches physical goods. Delivery clustering and confirmation progress per order.

---

## 6. Supplier Confirmation, Early Closure & SLA Policies

### 6.1 Configurable Policy Windows (No Hardcoded 24h Defaults)
Business operational windows are governed by platform configuration settings rather than hardcoded SQL or service constants:

| Policy Setting | System Default | Scope & Description |
| :--- | :--- | :--- |
| `CONFIRMATION_WINDOW_HOURS` | 24 Hours | Time allocated to a supplier to confirm terms once a pool qualifies. |
| `PAYMENT_WINDOW_HOURS` | 24 Hours | Time allocated to a buyer to confirm locked price and complete payment. |
| `EARLY_CLOSE_THRESHOLD_PERCENT` | 100% (`target_qty`) | Volume threshold at which early closure evaluation may trigger. |
| `MIN_POOL_DURATION_HOURS` | 12 Hours | Minimum allowable lifespan of a published pool before it can close. |

### 6.2 Early Closure & Target Volume Mechanics
When a pool reaches its `target_qty` before `expires_at`:
1. **Standard Policy (Remains Open for Additional Aggregation):**  
   The pool remains `ACTIVE` until `expires_at` or until `max_capacity` is reached, allowing further buyers to join and potentially unlock even higher volume tiers.
2. **Authorized Early Closure:**  
   If the supplier or operations administrator explicitly requests early closure:
   - Early closure is supported **only** if `current_qty >= supplier_min_qty`.
   - Authorized roles: The pool owner (Supplier) or an Operations Admin (`OPERATIONS_ADMIN`, `SUPER_ADMIN`).
   - Action: Pool transitions immediately to `AWAITING_SUPPLIER_CONFIRMATION`. New reservations are instantly blocked.
3. **Capacity Cap Ceiling:**  
   If `current_qty` reaches `max_capacity`, the pool automatically locks against further reservations (`status = 'TARGET_REACHED'`) and initiates the supplier confirmation process.

---

## 7. Payment Architecture & Financial Settlement Boundaries

### 7.1 Safepay Sandbox Gateway Integration
- **Selected Provider:** **Safepay Sandbox** is the primary digital payment gateway adapter for MilJor card and online payments.
- **Provider Abstraction:** Part 4 does not invoke gateway APIs directly. It interfaces with `paymentService` via standard payment intent payloads.
- **Zero Raw Credentials:** All API secrets are strictly loaded via server-side environment variables and never logged or exposed to client responses.

### 7.2 Truthful Financial Accounting Semantics
- **Platform Fee Distribution Records:** Records stored in `platform_ledger` represent **marketplace transaction fee allocations and supplier net payout calculations** (`gross_amount = platform_fee + supplier_net`). They must **not** be misrepresented as a full double-entry general ledger.
- **Conditional Escrow Holding:** MilJor operates a marketplace fund-holding mechanism where buyer payments are tracked in status `HELD_IN_ESCROW` until verified delivery confirmation. This is an internal commercial platform holding mechanism, not a state-licensed banking trust or legally regulated escrow service.

---

## 8. Database Migration Plan (Migration 006)

To support Part 4B without disrupting existing records or breaking historical pools:

```sql
-- Migration 006: Regular Pool Lifecycle Hardening
-- Database: miljor_db / miljor_test_db

-- 1. Add max_capacity and supplier_listing_id to pools
ALTER TABLE pools
  ADD COLUMN max_capacity INT NULL AFTER target_qty,
  ADD COLUMN supplier_listing_id INT NULL AFTER product_spec_id,
  ADD COLUMN pool_unit VARCHAR(20) NOT NULL DEFAULT 'pack' AFTER buyer_min_qty,
  ADD COLUMN early_close_allowed TINYINT(1) NOT NULL DEFAULT 1 AFTER duration_days,
  ADD CONSTRAINT fk_pools_supplier_listing 
    FOREIGN KEY (supplier_listing_id) REFERENCES supplier_listings(id) ON DELETE SET NULL;

-- 2. Add performance index on status and expires_at for scheduler queries
CREATE INDEX idx_pools_status_expires ON pools(status, expires_at);
CREATE INDEX idx_reservations_pool_status ON reservations(pool_id, status);

-- 3. Add payment deadline timestamp to reservations
ALTER TABLE reservations
  ADD COLUMN payment_deadline_at TIMESTAMP NULL AFTER confirmed_at;

-- 4. Record migration in schema_migrations
INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('006', '006_regular_pool_lifecycle_hardening', NOW());
```

---

## 9. API Contracts for Part 4B Implementation

### 9.1 Pool Lifecycle Endpoints (`/api/v1/pools`)
- `POST /api/v1/pools` — Supplier: atomically create pool with exact specification, listing linkage, capacity cap, and validated non-overlapping price tiers.
- `GET /api/v1/pools` — Public: list active pools with filters (`category`, `product_spec_id`, `status`).
- `GET /api/v1/pools/:id` — Public: detailed pool view with current tier, next tier distance, threshold status, and unit breakdown.
- `GET /api/v1/pools/my` — Supplier: view own pools across all statuses.
- `PUT /api/v1/pools/:id/confirm` — Supplier: confirm fulfillment once pool meets volume requirements.
- `PUT /api/v1/pools/:id/close-early` — Supplier/Admin: close pool early if target volume reached.
- `PUT /api/v1/pools/:id/cancel` — Supplier/Admin: cancel pool with documented reason and capacity release.

### 9.2 Reservation Lifecycle Endpoints (`/api/v1/reservations`)
- `POST /api/v1/reservations` — Buyer: reserve integer quantity of indivisible units in active pool under `FOR UPDATE` capacity lock.
- `GET /api/v1/reservations/my` — Buyer: view all own reservations with estimated vs. locked price breakdown.
- `GET /api/v1/reservations/:id` — Buyer/Admin: view single reservation with pool progress and terms status.
- `PUT /api/v1/reservations/:id/confirm` — Buyer: accept final terms and lock price permanently once pool is `CONFIRMED`.
- `PUT /api/v1/reservations/:id/cancel` — Buyer: cancel active reservation before pool confirmation and return volume to pool.

---

## 10. Verification & Gate Criteria for Part 4A.1

1. **Architecture Reconciliation:** Full alignment across commercial sequence, Safepay sandbox provider, independent quantities, indivisible pack units, and decoupled state machines.
2. **Historical Data Safety:** Confirmed zero modifications to historical pools 1 and 2 in `miljor_db`.
3. **Regression Status:** 100% pass across all existing gates (Part 3.1: 15/15, Part 2: 16/16, Part 1: 12/12).

**GATE STATUS: PASS (Part 4A.1 Complete)**  

---

## 11. Part 4B.4 Buyer Reservation Engine Implementation & Verification

### 11.1 Implemented & Verified Components (Part 4B.4)
1. **Atomic Reservation Creation (`POST /api/v1/reservations`):**
   - Enforces dedicated MySQL connection and explicit transaction (`connection.beginTransaction()`).
   - Acquires row-level exclusive lock on `pools` (`FOR UPDATE`) to ensure authoritative state evaluation.
   - Evaluates pool status (`ACTIVE` only, rejecting `DRAFT`, `CANCELLED` with 422 `POOL_NOT_ACTIVE`).
   - Evaluates expiration deadline using authoritative database server time (`(p.expires_at <= NOW())`), eliminating timezone desynchronization bugs (422 `POOL_EXPIRED`).
   - Enforces Anti-Self-Dealing guard: Rejects supplier attempting to join their own pool with 403 `SELF_PURCHASE_PROHIBITED`.
   - Enforces single active reservation per buyer per pool (409 `DUPLICATE_RESERVATION`).
   - Enforces packaging integrity: Rejects fractional quantities for discrete units (`bag`, `carton`, `tin`) with 400 `FRACTIONAL_PACK_REJECTED`.
   - Enforces buyer MOQ (`BUYER_MIN_QTY_NOT_MET`) and purchase increment alignment (`INVALID_PURCHASE_INCREMENT`).
   - Queries `COALESCE(SUM(quantity), 0) FROM reservations WHERE pool_id = ? ... FOR UPDATE` to calculate exact remaining capacity (`max_capacity - aggregate_qty`). Rejects over-capacity requests with 409 `CAPACITY_EXCEEDED`.
   - Calculates dynamic tier pricing via `tierPricingService.calculateApplicablePrice`.
   - Inserts new reservation in `RESERVED` status.
   - Updates `pools.current_qty`, `pools.current_price_per_unit`, and `pools.next_tier_price`.
   - Retroactively reprices existing active `RESERVED` reservations in the pool when volume crosses into a cheaper tier.
   - Records immutable audit log entry (`RESERVATION_CREATED`) stamped with `idempotency_key`.
   - Transactionally links idempotency record with `resource_type = 'reservations'` and `resource_id = reservationId`.

2. **Concurrency Safety & Capacity Serialization:**
   - Evaluated under simultaneous race conditions (`Promise.all` competing for final capacity).
   - InnoDB row-level locking strictly serializes concurrent requests: exactly one transaction acquires the remaining capacity, and competing requests exceeding capacity are rolled back with 409 `CAPACITY_EXCEEDED`. Zero oversubscription is guaranteed.

3. **Crash Recovery & Reconciliation:**
   - Extended `idempotencyGuard.reconcileCommittedBusinessOperation` for `resource_type === 'reservations'`.
   - If a crash occurs after transaction commit but before HTTP response delivery, client replay safely reconstructs the transparent 201 JSON payload, transitions record to `COMPLETED`, and returns without duplicating database reservations.

4. **Preservation of System Invariants:**
   - Buyer reservations consume internal pool capacity ceiling; they do NOT double-allocate supplier inventory (`supplier_inventory_allocations` count remains exactly 1 per published pool).
   - Zero orders or payments are generated at reservation time, maintaining strict architectural separation.
   - Historical pools 1 and 2 in `miljor_db` and `miljor_test_db` remain completely pristine (`product_spec_id = NULL`, `supplier_listing_id = NULL`).

### 11.2 Part 4B.4 Gate Results
- **Test Suite:** `tests/part4b4_buyer_reservation_gate.js`
- **Result:** 28/28 assertions passed (100% success).
- **Consolidated Regression:** All 8 previous verification gate suites passed sequentially with 100% success (160/160 total platform assertions).
- **Status:** PASS (Part 4B.4 Complete).

---

## 12. Part 4B.4.1 Reservation Safety Hardening & Observations Resolution

### 12.1 Hardening & Architectural Refinements (Part 4B.4.1)

1. **Database-Authoritative Temporal Expiration (OBS-16):**
   - Configured `timezone: 'Z'` on the MySQL connection pool in `src/config/db.js` for strict UTC parsing.
   - Evaluated `(p.expires_at <= NOW()) AS is_expired` directly in the database row lock query (`FOR UPDATE`), making MySQL server time the sole authoritative source of truth and closing the exact boundary (`expires_at <= NOW()`) against timezone clock drifts.

2. **Transaction Isolation & Lock Hierarchy (OBS-17):**
   - Enforced strict hierarchical locking: the parent pool row (`SELECT ... FROM pools p WHERE p.id = ? FOR UPDATE`) is serialized first, establishing the authoritative queue.
   - Replaced vulnerable aggregate gap-locks (`SUM(quantity) ... FOR UPDATE`) with simple aggregated sums on the parent-serialized transaction (`WHERE pool_id = ? AND status IN ('RESERVED', 'CONFIRMED', 'PAID')`), maintaining 100% mathematical consistency between cached `pools.current_qty` and reservation records without deadlock vulnerability.

3. **Price Tier Dynamics vs. Locked Price Immutability (OBS-18):**
   - Retroactive tier repricing is explicitly bounded: `WHERE pool_id = ? AND status = 'RESERVED' AND locked_unit_price IS NULL AND id != ?`.
   - Buyer reservations initially carry estimated prices with `locked_unit_price = NULL` and `locked_total_price = NULL`.
   - Any reservation that has locked prices or has transitioned to `CONFIRMED` or `PAID` is strictly immutable during dynamic tier repricing.

4. **Real-Time Supplier and Listing Eligibility Validation (OBS-19):**
   - Enforced three-tier eligibility checks within the reservation transaction:
     - Supplier verification: `verification_status !== 'BLOCKED'` and `buyer_trust_status !== 'SUSPENDED'` $\to$ 422 `SUPPLIER_INELIGIBLE`.
     - Listing active status: `listing_status === 'ACTIVE'` $\to$ 422 `LISTING_INACTIVE`.
     - Four-way specification identity: `listing_supplier_id === pool.supplier_id` and `listing_spec_id === pool.product_spec_id` $\to$ 422 `SPECIFICATION_MISMATCH`.

5. **One Active Reservation per Buyer Constraint (OBS-20 & Migration 009):**
   - Dropped legacy unconditional unique index on `(pool_id, buyer_id)` that prevented re-entry after cancellation or expiry.
   - Added standard non-unique index `idx_reservations_buyer_pool (buyer_id, pool_id)`.
   - Added MySQL 8 `VIRTUAL` generated column:
     `active_pool_buyer_key VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN status IN ('RESERVED', 'CONFIRMED', 'PAID') THEN CONCAT(pool_id, '_', buyer_id) ELSE NULL END) VIRTUAL`.
   - Added unique index: `idx_unique_active_pool_buyer (active_pool_buyer_key)`.
   - Application controller queries for active reservations within the transaction and returns 409 `ACTIVE_RESERVATION_EXISTS` with existing reservation details (`id`, `reservation_code`, `quantity`, `unit_price`, `status`, `created_at`).
   - Translates database `ER_DUP_ENTRY` errors into clean 409 `ACTIVE_RESERVATION_EXISTS` responses.

### 12.2 Part 4B.4.1 Gate Results
- **Test Suite:** `tests/part4b4_1_reservation_hardening_gate.js`
- **Result:** 18/18 assertions passed (100% success).
- **Consolidated Regression:** All 9 previous verification gate suites passed sequentially with 100% success (178/178 total platform assertions).
- **Status:** PASS (Part 4B.4.1 Complete).

### 12.3 Critical Reservation Integrity Corrections (Part 4B.4.2 / OBS-21–25)

1. **Affirmative Positive Supplier Eligibility Verification (OBS-21):**
   - Replaced negative blacklist checks (`!== 'BLOCKED'`) with strict affirmative verification.
   - Evaluates:
     - Supplier exists and has `role === 'SUPPLIER'`.
     - `users.is_verified === 1` and `users.verification_status === 'VERIFIED'`.
     - `supplier_profiles.verification_status === 'VERIFIED'`.
   - Completely decoupled buyer trust status (`buyer_trust_status` is never evaluated for suppliers).
   - Validates that pool's underlying listing is owned by the supplier and its specification ID matches the pool's `product_spec_id`.

2. **Single Authoritative Timezone & Expiry Evaluation (OBS-22):**
   - Eliminated redundant JavaScript `new Date()` clock evaluation in the application controller.
   - MySQL database evaluated in UTC within the locked row transaction `(p.expires_at <= NOW()) AS is_expired` serves as the sole authoritative temporal decision-maker.
   - Exact boundary equality (`expires_at <= NOW()`) is strictly evaluated as closed (returning 422 `POOL_EXPIRED`).

3. **Protect Estimated Prices & Financially Locked Commitments (OBS-23):**
   - Initial reservations receive estimated prices with `locked_unit_price = NULL` and `locked_total_price = NULL`.
   - Retroactive dynamic tier repricing query strictly filters:
     `WHERE pool_id = ? AND status = 'RESERVED' AND locked_unit_price IS NULL AND id != ?`.
   - Non-RESERVED statuses (`CONFIRMED`, `PAID`, `ORDER_PENDING`, `COMMITTED`) and any record with `locked_unit_price IS NOT NULL` remain strictly immutable.

4. **Legacy Pools Read-Only Protection Without Fabricated Specs (OBS-24):**
   - Historical pools 1 and 2 (created before Migration 006 without `product_spec_id` or `supplier_listing_id`) are preserved completely untouched in `miljor_db`.
   - Explicitly rejected from accepting new commercial reservations with 422 `LEGACY_POOL_READ_ONLY`.
   - Public pool discovery (`findAllActive`) classifies them with `is_legacy = 1` and `participation_status = 'LEGACY_NOT_AVAILABLE_FOR_NEW_RESERVATIONS'`.

5. **Future-Safe One Active Reservation per Buyer (OBS-25 & Migration 010):**
   - Inverted virtual column logic to fail closed on any non-terminal status:
     ```sql
     ALTER TABLE reservations MODIFY COLUMN active_pool_buyer_key VARCHAR(64) GENERATED ALWAYS AS (
       CASE WHEN status NOT IN ('CANCELLED', 'EXPIRED') THEN CONCAT(pool_id, '_', buyer_id) ELSE NULL END
     ) VIRTUAL;
     ```
   - Prevents duplicate reservations across all existing and future active lifecycle states (`RESERVED`, `CONFIRMED`, `PAID`, `COMMITTED`, `PRICE_LOCKED`, etc.).
   - Guarantees clean re-entry upon explicit cancellation or expiration.

### 12.4 Part 4B.4.2 Gate Results
- **Test Suite:** `tests/part4b4_2_observations_integrity_gate.js`
- **Result:** 20/20 assertions passed (100% success).
- **Consolidated Regression:** All 10 previous verification gate suites passed sequentially with 100% success (198/198 total platform assertions).
- **Status:** PASS (Part 4B.4.2 Complete).

---

## 13. Part 4C.1: Buyer Reservation Modification, Cancellation & Commercial Integrity

### 13.1 Overview & Architecture
Part 4C.1 introduces atomic reservation lifecycle mutations while pools remain open in `RESERVED` status:
1. **Quantity Modification (`PATCH /api/v1/reservations/:id`):** Permits buyers to scale reserved demand up or down, or submit no-op confirmations, with strict boundary enforcement (buyer min quantity, purchase increments, discrete pack units, and pool capacity).
2. **Reservation Cancellation (`POST /api/v1/reservations/:id/cancel`):** Enables buyers to exit a pool cleanly prior to confirmation, returning demand to the pool.
3. **Legacy Cancellation Route Unification (OBS-26):** `PUT /api/v1/reservations/:id/cancel` reuses the exact same authoritative controller logic with mandatory `X-Idempotency-Key`.
4. **Optimistic Concurrency & Stale Update Protection:** Clients can supply `If-Match-Quantity` (or `expected_quantity`), preventing silent overwrite of concurrent modifications with 412 `PRECONDITION_FAILED`.
5. **Bidirectional Dynamic Tier Repricing:** Increasing demand pushes pool aggregate toward higher discount tiers, reducing prices for all uncommitted active buyers. Decreasing demand or cancellation shifts aggregate back to higher unit prices. Financially locked prices (`locked_unit_price IS NOT NULL`, `CONFIRMED`, `PAID`) remain strictly immutable.
6. **Immutable Mutation History (Migration 011):** Every mutation records an immutable before/after snapshot in `reservation_mutation_history`, enabling crash-safe idempotency replays that preserve historical responses without reverting newer reservation states.

### 13.2 Concurrency & Lock Hierarchy
To prevent race conditions, capacity oversubscription, and deadlocks:
- **Lock Hierarchy:**
  1. Primary Lock: Parent pool row locked first via `SELECT ... FROM pools WHERE id = ? FOR UPDATE`.
  2. Secondary Lock: Target reservation row locked second via `SELECT ... FROM reservations WHERE id = ? FOR UPDATE`.
- **Atomicity:** All capacity recalculations, aggregate updates, dynamic tier re-evaluations, reservation mutations, audit logging, and idempotency status updates commit within a single atomic MySQL transaction.

### 13.3 Part 4C.1 Gate Results
- **Dedicated Test Suite:** `tests/part4c1_reservation_mutations_gate.js`
- **Result:** 56/56 assertions passed (55 Part 4C.1 assertions + 11-suite regression).
- **Consolidated Platform Regression:** 11/11 previous verification gates passed with 100% success.
- **Status:** PASS (Part 4C.1 Complete).

---

## 14. Part 4C.2A: Authoritative Pool Progress, Tier Pricing Transparency & Read Consistency

### 14.1 Overview & Architecture
Part 4C.2A establishes a single authoritative read model (`src/services/poolProgressService.js`) that provides consistent, transparent, and real-time visibility into Regular Pool progression, remaining capacity, dynamic tier pricing, and effective participation eligibility.

### 14.2 Commercial Invariants & Mathematical Formulations
1. **Commercial Boundaries:**
   - `supplier_min_qty`: Wholesale qualification threshold. Reaching this makes a pool eligible for confirmation consideration, but does NOT trigger automatic pool confirmation.
   - `target_qty`: Target demand goal for the pool. Reaching this satisfies primary collective demand, but does NOT automatically lock orders or execute payments.
   - `max_capacity`: Hard physical ceiling. Strictly enforced against inventory allocation; reservations cannot exceed this limit.
2. **Progress Calculations:**
   $$\text{minimum\_progress\_percent} = \min\left(100.0, \frac{\text{eligible\_quantity}}{\text{supplier\_min\_qty}} \times 100\right)$$
   $$\text{target\_progress\_percent} = \min\left(100.0, \frac{\text{eligible\_quantity}}{\text{target\_qty}} \times 100\right)$$
   $$\text{remaining\_capacity} = \max\left(0, \text{max\_capacity} - \text{eligible\_quantity}\right)$$
   $$\text{minimum\_remaining} = \max\left(0, \text{supplier\_min\_qty} - \text{eligible\_quantity}\right)$$
   $$\text{target\_remaining} = \max\left(0, \text{target\_qty} - \text{eligible\_quantity}\right)$$
3. **Transparent Tier Pricing Semantics:**
   - **`ESTIMATED_PRE_MINIMUM`:** When $\text{eligible\_quantity} < \text{supplier\_min\_qty}$, pricing is explicitly flagged as `is_conditional_pricing: true`, reflecting the estimate at the first tier subject to reaching wholesale minimum.
   - **`ESTIMATED_TIER_CONFIRMABLE`:** When $\text{eligible\_quantity} \ge \text{supplier\_min\_qty}$, pricing reflects the current qualified volume tier.
   - **Next Discount Tier Thresholds:** Correctly identifies `next_tier_quantity`, `additional_quantity_for_next_tier`, and `next_tier_price`. If the pool has reached the best available discount tier, `next_tier_quantity`, `additional_quantity_for_next_tier`, and `next_tier_price` are returned as `null` (zero fabricated discounts).
4. **Authoritative Single-Query Read Model & Drift Policy (OBS-29):**
   - Single coherent SQL query dynamically calculates `eligible_quantity` via `SUM(CASE WHEN r.status NOT IN ('CANCELLED', 'EXPIRED') THEN r.quantity ELSE 0 END)`.
   - Compares authoritative sum with cached `pools.current_qty`. If drift is detected, logs a diagnostic warning and uses the authoritative sum for all calculations. Zero `UPDATE` or write side effects are executed during `GET` requests.
5. **Effective Participation Eligibility:**
   - Returns `can_join: boolean`, `participation_status`, and human-readable `participation_reason`.
   - Enforces fail-closed checks across: legacy pool status (`is_legacy`), pool lifecycle (`ACTIVE`), UTC expiration deadline (`expires_at <= NOW()`), remaining capacity (`remaining_capacity < buyer_min_qty`), affirmative supplier verification (`is_verified = 1`, `verification_status = 'VERIFIED'`), and active supplier listing.

### 14.3 Part 4C.2A Gate Results
- **Dedicated Test Suite:** `tests/part4c2a_progress_pricing_gate.js`
- **Result:** 28/28 assertions passed (100% success).
- **Consolidated Platform Regression:** All 12 prior verification gates passed sequentially with 100% success (282 total platform assertions).
- **Status:** PASS (Part 4C.2A Complete). Part 4C.2B qualification transition remains strictly not started.

---

## 15. Part 4C.2B: Durable Reservation Events, Buyer/Supplier Visibility & Read-Model Integrity

### 15.1 Overview & Architecture
Part 4C.2B establishes a durable, transactional event outbox for reservation and pool milestones, enriches buyer-facing reservation queries with complete specification and progress transparency, and provides privacy-safe aggregate demand visibility for suppliers:

1. **Transactional Business Event Outbox (Migration 012):**
   - Created `reservation_business_events` table (`event_id`, `pool_id`, `reservation_id`, `event_type`, `actor_id`, `actor_role`, `idempotency_key`, `payload`, `created_at`).
   - Recorded atomically in the same MySQL InnoDB transaction as the underlying reservation mutation (creation, modification, cancellation).
   - Deterministic SHA-256 event ID generation when an `idempotency_key` is supplied, preventing duplicate events upon client replays via `INSERT IGNORE`.
   - Comprehensive domain event types:
     - Primary mutation events: `RESERVATION_CREATED`, `RESERVATION_QUANTITY_INCREASED`, `RESERVATION_QUANTITY_DECREASED`, `RESERVATION_CANCELLED`.
     - Pool aggregate events: `POOL_DEMAND_CHANGED`, `POOL_TIER_CHANGED`.
     - Milestone threshold events: `SUPPLIER_MINIMUM_REACHED`, `SUPPLIER_MINIMUM_LOST`, `TARGET_REACHED`, `TARGET_LOST`.

2. **Preflight Policy Hardening:**
   - **OBS-32 (Exact Decimal Concurrency Precondition):** Replaced floating-point epsilon inequality with strict rejection of precision $>4$ decimal places (400 `INVALID_EXPECTED_QUANTITY`) and exact 4-decimal boundary comparison (412 `PRECONDITION_FAILED` on difference $\ge 0.0001$).
   - **OBS-33 (Shared Eligible Demand Policy):** Centralized `reservationDemandPolicy.js` with explicit whitelisted demand statuses (`['RESERVED', 'CONFIRMED', 'PAID']`), terminal statuses (`['CANCELLED', 'EXPIRED']`), and fail-closed capacity calculation for unmapped statuses.
   - **OBS-34 (Symmetrical Supplier Eligibility Policy):** Centralized `supplierEligibilityPolicy.js` enforcing identical affirmative verification rules across advisory read models (`can_join`) and transactional mutation controllers.

3. **Buyer Reservation Visibility:**
   - `GET /api/v1/reservations/my` and `GET /api/v1/reservations/:id`:
   - Returns complete buyer reservation details including exact product specification (`product_title`, `grade`, `origin`, `size_label`, `packaging_type`), verified supplier summary, flattened pool progress, transparent tier pricing conditionality (`is_conditional_pricing`, `pricing_mode`), and contextual action permissions (`can_modify`, `can_cancel`).
   - Guarantees complete data privacy: buyers see only their own reservation; other buyers' private data is strictly inaccessible.

4. **Supplier Demand Summary & Privacy Protection:**
   - `GET /api/v1/pools/:id/supplier/summary` (and alias `GET /api/v1/pools/:id/reservations/summary`):
   - Strict access control: Accessible only by the verified owning supplier or platform administrator (unauthorized suppliers receive 403 `FORBIDDEN`).
   - Provides aggregate demand metrics: `total_reserved_quantity`, `active_reservations_count`, status breakdown (`RESERVED`, `CONFIRMED`, `PAID`, `CANCELLED`, `EXPIRED`), wholesale minimum and target progress percentages, and current estimated tier price.
   - Zero Buyer PII: Completely omits buyer names, phone numbers, contact info, individual reservation amounts, and private identifiers.

### 15.2 Invariant Preservation
- **Zero Premature Lifecycle Transitions:** Pools remain strictly in their current status (`ACTIVE` / `PUBLISHED`). Reaching `supplier_min_qty` records `SUPPLIER_MINIMUM_REACHED` in the event outbox, but does NOT transition pool status to `CONFIRMED`, `QUALIFIED`, or `CLOSED`.
- **Zero Order or Payment Operations:** No order rows, payment records, checkout sessions, or financial ledger entries are created.
- **Zero Redundant Infrastructure:** Avoided external message brokers, complex background daemons, or separate notification engines; all events are durably recorded in MySQL.

### 15.3 Part 4C.2B Gate Results
- **Dedicated Test Suite:** `tests/part4c2b_events_visibility_gate.js`
- **Result:** 30/30 assertions passed (100% success).
- **Consolidated Platform Regression:** 13/13 platform verification gates verified.
- **Status:** PASS (Part 4C.2B Complete).






