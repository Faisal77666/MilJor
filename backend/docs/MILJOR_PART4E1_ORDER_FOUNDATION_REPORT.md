# MILJOR — PART 4E.1 VERIFICATION & ORDER ARCHITECTURE REPORT
## Order Architecture, Commercial Reconciliation & Financial Safety Foundation

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace  
**Market:** Lahore, Pakistan  
**Execution Date:** October 19, 2026  
**Phase Status:** **PART 4E.1: PASS**  
**OBS-71 Status:** **RESOLVED**  
**OBS-72 Status:** **RESOLVED**  
**OBS-73 Status:** **RESOLVED**  
**OBS-74 Status:** **RESOLVED**  
**Commercial Order Readiness Contract:** **COMMERCIAL ORDER READINESS CONTRACT: VERIFIED**  
**Next Phase Authorization:** **READY FOR PART 4E.2: NO — Awaiting explicit user authorization**

---

### A. Executive Summary

In strict compliance with **MilJor Advanced Engineering Execution Protocol v2.0**, the **Order Architecture, Commercial Reconciliation & Financial Safety Foundation (Part 4E.1)** has been established, hardened, and verified under single-pass zero-regression conditions.

1. **Capabilities Implemented:**
   - Authoritative, read-only commercial reconciliation service (`commercialReconciliationService.evaluateOrderReadiness`) reconciling 15 distinct structural, commercial, and financial criteria.
   - Separation of reservation demand accounting into 7 distinct metrics: original qualified demand, supplier-accepted demand, buyer ACCEPT quantity, buyer DECLINE quantity, pending cohort quantity, active capacity consumption, and future converted order demand.
   - Contractual price guarantee verification: confirmed that buyer price locks remain binding on the buyer (no retroactive price hikes), while order conversion readiness fails closed if final demand drops below the supplier minimum without an explicit supplier guarantee.
   - Exact financial amount contract: separated locked merchandise subtotal (`ROUND(quantity * locked_unit_price, 2)`) from delivery fees, buyer platform fees, and taxes, guaranteeing that unknown fee values are never assumed to be zero.
   - Authoritative final-demand quorum evaluation: explicit multi-state logic covering quorum met, exact minimum, active pending cohort, and expired shortfall.
   - Migration 018: updated `orders.total_qty` from `INT` to `DECIMAL(12,4)` and introduced DB-level unique constraint `uq_orders_buyer_decision (buyer_decision_id)` enforcing exactly-once order creation at the InnoDB storage engine level.
   - Mounted RESTful buyer readiness read model (`GET /api/v1/reservations/:id/order-readiness`) with strict tenant isolation, anti-impersonation, and suspended account rejection.
2. **Explicitly Unimplemented Capabilities (Strict Phase Boundary):**
   - Zero live buyer orders created.
   - Zero checkout sessions or payment intents initiated.
   - Zero Safepay payment provider integrations or webhook handlers mounted.
   - Zero refunds, ledger distributions, delivery dispatches, or supplier counteroffers.
   - No operational order-creation endpoint exposed.
3. **Authorization & Production Readiness:**
   - Actual payable order creation is **NOT authorized** in this phase.
   - Commercial reconciliation contract is production-ready for advisory evaluation and verified against real MySQL database rows.

---

### B. OBS-71–74 Verification

#### OBS-71: Reservation Demand, Commitment Accounting & Converted Order Tracking
- **Original Risk:** Conflation of demand metrics across lifecycle transitions; risk of double-counting or dropping obligations when reservations transition from `RESERVED` to `CONFIRMED`; risk of capacity reopening on post-closure cancellations.
- **Actual Code/Schema Inspected:** `src/services/reservationDemandPolicy.js`, `src/services/commercialLifecycleService.js`, `pool_buyer_commercial_decisions`, `reservations`.
- **Reproduced Defect / Finding:** `getPoolCommittedDemandSummary` lacked explicit accounting for future converted orders and supplier-accepted demand.
- **Correction:**
  - In `reservationDemandPolicy.js`: reaffirmed that `DEMAND_ELIGIBLE_STATUSES` (`RESERVED`, `CONFIRMED`, `PAID`) strictly governs capacity consumption. Transitioning from `RESERVED` to `CONFIRMED` maintains eligibility without double-counting.
  - In `commercialLifecycleService.js`: added `supplier_accepted_demand`, `converted_order_demand`, and `converted_order_count` to the accounting payload.
  - In `commercialReconciliationService.js`: verified exact 4-decimal quantity tracking.
- **Test Evidence:** `tests/part4e1_order_foundation_gate.js` (Test 10: Demand accounting separation; Test 17: Non-confirmed reservation status and unknown status policy fail closed).
- **Residual Risk:** None. Fully encapsulated by policy whitelist and DB queries.

#### OBS-72: Contractual Price Guarantee Verification & Fail-Closed Shortfall Policy
- **Original Risk:** Assuming that a supplier's acceptance of an aggregate snapshot unconditionally guarantees the unit price discount even if subsequent buyer opt-outs cause volume to drop below the supplier minimum or volume-tier threshold.
- **Actual Code/Schema Inspected:** `pool_supplier_commercial_decisions`, `pool_commercial_snapshots`, `pool_price_tiers`.
- **Reproduced Defect / Finding:** Neither the supplier decision table nor the snapshot schema contains an unconditional guarantee clause obligating the supplier to absorb volume shortfall deficits below `supplier_min_qty`.
- **Correction:**
  - Preserved buyer price lock: an accepted buyer's `locked_unit_price` is never retroactively repriced or increased.
  - Implemented fail-closed readiness policy: if final buyer accepted demand drops below `supplier_min_qty`, in the absence of an explicit supplier shortfall guarantee, order readiness fails closed with `eligible_for_order = false`, `reason_codes = ['FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM']`, and `pricing_guarantee_status = 'UNSUPPORTED_SHORTFALL'`.
- **Test Evidence:** `tests/part4e1_order_foundation_gate.js` (Test 6: Deficit to supplier minimum blocks readiness; Test 7: Accepted buyer price lock remains intact during shortfall evaluation).
- **Residual Risk:** Commercial policy decision required in future phases if suppliers wish to offer optional shortfall absorption guarantees.

#### OBS-73: Exact Merchandise Subtotal vs Final Payable Amount Contract
- **Original Risk:** Conflating `reservations.locked_total_price` with total payable order amount, or assuming delivery and platform fees are zero.
- **Actual Code/Schema Inspected:** `reservations`, `pools`, `orders`.
- **Reproduced Defect / Finding:** `reservations.locked_total_price` is strictly `ROUND(quantity * locked_unit_price, 2)`. It does not include delivery fees, buyer platform fees, or taxes.
- **Correction:**
  - Formally established in `commercialReconciliationService.js` that `reservations.locked_total_price` represents strictly the **merchandise subtotal**.
  - Order readiness DTO explicitly reports `financial_components_status = 'MERCHANDISE_SUBTOTAL_LOCKED'` and exposes `financial_breakdown` with separate statuses: `delivery_fee_status`, `buyer_platform_fee_status = 'PENDING_ORDER_GENERATION'`, `tax_status = 'EXEMPT_OR_UNSPECIFIED'`, and `payable_total_status = 'REQUIRES_FEE_COMPOSITION_AT_ORDER_CREATION'`.
  - Subtotal calculation tampering or divergence from snapshot candidate price triggers immediate fail-closed rejection (`SUBTOTAL_CALCULATION_MISMATCH`, `SNAPSHOT_PRICE_DISCREPANCY`).
- **Test Evidence:** `tests/part4e1_order_foundation_gate.js` (Test 2: Subtotal separated from pending fees; Test 14: Fractional decimal quantity rounding; Test 15: Tampered subtotal fails closed; Test 16: Divergent unit price fails closed).
- **Residual Risk:** Final payable total composition must be computed in transaction during Part 4E.2 order generation.

#### OBS-74: Final-Demand Quorum & State Machine Order Conversion Invariants
- **Original Risk:** Generating orders when demand is below minimum, or while remaining cohort buyers are still within their active decision window, or generating multiple orders for the same buyer commitment.
- **Actual Code/Schema Inspected:** `orders`, `pool_commercial_snapshots`, `pool_buyer_commercial_decisions`.
- **Reproduced Defect / Finding:** `orders` table had `total_qty` as `INT` (causing truncation on decimal quantities) and lacked a unique constraint linking directly to `pool_buyer_commercial_decisions`.
- **Correction:**
  - Applied Migration 018: updated `orders.total_qty` to `DECIMAL(12,4)`, added `snapshot_id`, `buyer_decision_id`, `currency`, and unique constraint `uq_orders_buyer_decision (buyer_decision_id)`.
  - Implemented multi-state quorum evaluation in `commercialReconciliationService.js`:
    - `buyer_accepted_demand >= supplier_min_qty`: `ELIGIBLE_FOR_ORDER` (quorum verified).
    - `buyer_accepted_demand < supplier_min_qty` AND `NOW() <= buyer_commitment_deadline`: `BUYER_COMMITMENTS_PENDING` (awaiting cohort).
    - `buyer_accepted_demand < supplier_min_qty` AND `NOW() > buyer_commitment_deadline`: `FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM` (blocked).
    - Existing order found in `orders`: `ORDER_ALREADY_CONVERTED` (blocked).
- **Test Evidence:** `tests/part4e1_order_foundation_gate.js` (Test 1: Quorum met eligible; Test 8: Exact minimum quorum; Test 9: Active deadline reports BUYER_COMMITMENTS_PENDING; Test 11: Migration 018 schema verification; Test 12: DB unique constraint prevents duplicate order; Test 13: ORDER_ALREADY_CONVERTED blocked).
- **Residual Risk:** None. Guaranteed at both service and database engine layers.

---

### C. Source Changes

1. **`src/services/commercialReconciliationService.js`** (Created):
   - Exported object: `commercialReconciliationService`
   - Purpose: Authoritative, read-only reconciliation evaluating 15 distinct criteria for order conversion readiness.
   - Reused services: `src/services/reservationDemandPolicy.js`.
2. **`src/controllers/reservationController.js`** (Modified):
   - Added method: `getOrderReadiness(req, res)`
   - Purpose: Handles `GET /api/v1/reservations/:id/order-readiness`.
3. **`src/routes/v1/reservationRoutes.js`** (Modified):
   - Mounted route: `GET /:id/order-readiness` guarded by `protect` and `authorizeStrict('BUYER')`.
4. **`src/services/commercialLifecycleService.js`** (Modified):
   - Method: `getPoolCommittedDemandSummary(poolId)`
   - Purpose: Added `supplier_accepted_demand`, `converted_order_demand`, and `converted_order_count` to demand accounting.
5. **`tests/part4e1_order_foundation_gate.js`** (Created):
   - 23-assertion automated gate test suite.
6. **`tests/master_regression_runner.js`** (Modified):
   - Registered Suite 23 with 23 assertions (total 532 platform assertions).
   - Added `miljor_db.orders` count check to `verifyDatabaseIsolation()`.

---

### D. Database Changes

1. **Pre-Flight Non-Interactive Backup:**
   - File: `database/backups/miljor_db_backup_2026-10-19T18-54-08-176Z.sql` (65.7 KB).
   - Restoration and integrity verified across 27 tables in `miljor_test_db`.
2. **Schema Migration:**
   - Script: `database/migrations/018_order_foundation_and_commercial_linkage.sql`
   - Rollback Script: `database/migrations/rollback/018_rollback_order_foundation_and_commercial_linkage.sql`
   - SQL Delta:
     - `orders.total_qty` modified from `INT` to `DECIMAL(12,4) NOT NULL`.
     - `orders.snapshot_id` added (`INT NULL`, FK → `pool_commercial_snapshots(id)`).
     - `orders.buyer_decision_id` added (`INT NULL`, FK → `pool_buyer_commercial_decisions(id)`).
     - `orders.currency` added (`VARCHAR(3) NOT NULL DEFAULT 'PKR'`).
     - Added constraint `uq_orders_buyer_decision UNIQUE (buyer_decision_id)`.
     - Added index `idx_orders_pool_status (pool_id, order_status)`.
3. **Rollback & Re-apply Validation:**
   - Rollback executed cleanly on `miljor_test_db` reverting column types and dropping constraints.
   - Migration 018 re-applied and verified on `miljor_test_db`.
   - Migration 018 applied to `miljor_db` and tracked in `schema_migrations`.
   - Zero test data leaked to `miljor_db`.

---

### E. Business Decision Matrix

| Supplier Decision | Buyer Decision | Final Demand vs Min | Deadline Status | Existing Order? | `eligible_for_order` | Reason Code | Pricing Guarantee Status |
|:---|:---|:---|:---|:---|:---:|:---|:---|
| `ACCEPT` | `ACCEPT` | $\ge \text{Min}$ | Any | No | **`true`** | `ELIGIBLE_FOR_ORDER` | `QUORUM_VERIFIED` |
| `ACCEPT` | `ACCEPT` | $<\text{Min}$ | Active | No | **`false`** | `BUYER_COMMITMENTS_PENDING` | `PENDING_COHORT_COMPLETION` |
| `ACCEPT` | `ACCEPT` | $<\text{Min}$ | Expired | No | **`false`** | `FINAL_DEMAND_BELOW_SUPPLIER_MINIMUM` | `UNSUPPORTED_SHORTFALL` |
| `ACCEPT` | `ACCEPT` | $\ge \text{Min}$ | Any | Yes | **`false`** | `ORDER_ALREADY_CONVERTED` | `QUORUM_VERIFIED` |
| `ACCEPT` | `DECLINE` | Any | Any | No | **`false`** | `BUYER_OFFER_DECLINED` | `NOT_EVALUATED` |
| `REJECT` | Any | Any | Any | No | **`false`** | `SUPPLIER_OFFER_REJECTED` | `NOT_EVALUATED` |
| Pending | Any | Any | Any | No | **`false`** | `SUPPLIER_DECISION_PENDING` | `NOT_EVALUATED` |
| `ACCEPT` | Pending | Any | Any | No | **`false`** | `BUYER_DECISION_PENDING` | `NOT_EVALUATED` |

---

### F. Financial Correctness

1. **Quantity Precision:** Authoritative `DECIMAL(12,4)` across pools, reservations, snapshots, decisions, and orders.
2. **Currency Standard:** Explicitly enforced as `'PKR'`.
3. **Unit-Price Precision:** Authoritative `DECIMAL(12,2)`.
4. **Merchandise Subtotal Rounding:** Computed deterministically as `ROUND(quantity * locked_unit_price, 2)`.
5. **Fee and Tax Treatment:**
   - `merchandise_subtotal`: locked and contractually guaranteed.
   - `delivery_fee`: dependent on pool delivery type (`DETERMINED_ZERO` for supplier pickup; `PENDING_ORDER_GENERATION` for doorstep/cluster).
   - `buyer_platform_fee`: `PENDING_ORDER_GENERATION` (derived from `buyer_fee_slabs`).
   - `tax_status`: `EXEMPT_OR_UNSPECIFIED`.
   - `payable_total_status`: `REQUIRES_FEE_COMPOSITION_AT_ORDER_CREATION`.

---

### G. Security and Concurrency

1. **Authorization Matrix:**
   - `BUYER`: Can only inspect order readiness for reservations they own (`reservation.buyer_id === req.user.id`). Other reservations return HTTP 403 `FORBIDDEN`.
   - `SUPPLIER`: Blocked from calling `GET /api/v1/reservations/:id/order-readiness` (HTTP 403 `FORBIDDEN`). Suppliers access aggregate demand via `GET /api/v1/pools/:id/committed-demand-summary`.
   - `ADMIN` / `SUPER_ADMIN`: Permitted to inspect readiness for auditing; zero impersonation capabilities.
   - `SUSPENDED` Buyer: Immediately rejected with HTTP 403 `ACCOUNT_SUSPENDED`.
2. **Consistent Read Strategy:**
   - Read-only queries with zero long-lived exclusive locks, ensuring zero lock contention or blocking of concurrent reservation transactions.
3. **Exactly-Once Order Guarantee:**
   - Enforced by MySQL unique index `uq_orders_buyer_decision (buyer_decision_id)`. Re-conversion attempts throw `ER_DUP_ENTRY` at the database level and return `ORDER_ALREADY_CONVERTED` at the service layer.

---

### H. Exact Test Evidence

1. **Dedicated Part 4E.1 Gate:**
   - Suite: `tests/part4e1_order_foundation_gate.js`
   - Assertions: **23 / 23 PASS (100%)**
   - Execution duration: **2.29 seconds**
   - Process exit code: **0 (Natural exit)**

2. **Master Platform Regression Runner (Single Non-Recursive Pass):**
   - Runner: `tests/master_regression_runner.js`
   - Total Suites: **23 test suites**
   - Total Platform Assertions: **532 / 532 PASS (100%)**
   - Total Wall-Clock Execution Time: **58.33 seconds**
   - Regressions: **0**

| # | Suite Name | Assertions | Duration | Status |
|:---|:---|:---:|:---:|:---:|
| 01 | phase1_gate.js | 12 | 0.71s | PASS |
| 02 | part2_security_gate.js | 16 | 3.36s | PASS |
| 03 | part3_specification_gate.js | 15 | 1.84s | PASS |
| 04 | part4b1_pool_foundation_gate.js | 16 | 0.79s | PASS |
| 05 | part4b2_pool_creation_gate.js | 22 | 1.71s | PASS |
| 06 | part4b3_pool_publishing_gate.js | 25 | 1.85s | PASS |
| 07 | pre4c1_concurrency_hardening_gate.js | 15 | 1.80s | PASS |
| 08 | pre4b4_idempotency_crash_recovery_gate.js | 11 | 1.77s | PASS |
| 09 | part4b4_buyer_reservation_gate.js | 28 | 2.48s | PASS |
| 10 | part4b4_1_reservation_hardening_gate.js | 18 | 3.21s | PASS |
| 11 | part4b4_2_observations_integrity_gate.js | 20 | 3.41s | PASS |
| 12 | part4c1_reservation_mutations_gate.js | 56 | 5.82s | PASS |
| 13 | part4c2a_progress_pricing_gate.js | 28 | 3.02s | PASS |
| 14 | part4c2b_events_visibility_gate.js | 30 | 2.07s | PASS |
| 15 | part4c2_combined_integration_gate.js | 28 | 1.75s | PASS |
| 16 | part4c3_lifecycle_expiry_gate.js | 28 | 3.34s | PASS |
| 17 | part4c3_1_scheduler_safety_gate.js | 12 | 2.94s | PASS |
| 18 | part4d1_commercial_foundation_gate.js | 34 | 3.08s | PASS |
| 19 | part4d2_pool_qualification_gate.js | 30 | 3.39s | PASS |
| 20 | part4d2_1_security_integrity_gate.js | 22 | 1.61s | PASS |
| 21 | part4d3_supplier_decision_gate.js | 22 | 2.43s | PASS |
| 22 | part4d4_buyer_commitment_gate.js | 21 | 3.66s | PASS |
| 23 | part4e1_order_foundation_gate.js | 23 | 2.29s | PASS |

3. **Development Database (`miljor_db`) Isolation:**
   - `pools`: 2 (Historical baseline intact)
   - `reservations`: 0
   - `reservation_business_events`: 0
   - `reservation_mutation_history`: 0
   - `pool_commercial_snapshots`: 0
   - `pool_supplier_commercial_decisions`: 0
   - `pool_buyer_commercial_decisions`: 0
   - `orders`: 0
   - `schema_migrations`: 18 applied migrations (100% PRISTINE)

---

### I. Remaining Concerns & Future Dependencies

1. **Unresolved Critical/High Issues:** Zero. All OBS-71–74 items resolved.
2. **Part 4E.2 Order-Creation Dependencies:**
   - Order creation service must compose final payable total: `merchandise_subtotal + delivery_fee + buyer_platform_fee`.
   - Delivery address collection and zone dispatch verification.
   - Outbox event emission: `ORDER_CREATED`.
   - Inventory allocation transition from `COMMITTED` to `ORDER_ALLOCATED`.
3. **Commercial Policy Considerations:**
   - If suppliers wish to optionally agree to absorb volume-tier shortfalls when demand is below minimum, a dedicated boolean `guarantee_shortfall_pricing` can be added to supplier decisions in future phases. Currently fails closed.

---

### J. Final Gate Sign-Off

```
================================================================================
PART 4E.1: PASS
OBS-71: RESOLVED
OBS-72: RESOLVED
OBS-73: RESOLVED
OBS-74: RESOLVED
COMMERCIAL ORDER READINESS CONTRACT: VERIFIED
READY FOR PART 4E.2: NO — Awaiting explicit user authorization
================================================================================
```
