# MilJor — Part 4D.1 Final Verification & Acceptance Report
## Regular Pool Commercial Lifecycle Foundation, State Integrity & Safe Closure Architecture

**Project:** MilJor — “Mil Kar Khareedo, Behtar Pao”  
**Market:** Lahore, Pakistan  
**Phase:** Part 4D.1 ONLY  
**Execution Date:** 2026-10-18  
**Verification Verdict:** **PART 4D.1: PASS**  
**Readiness for Part 4D.2:** **CAN START PART 4D.2: YES** (Awaiting explicit user instruction; execution cleanly stopped)

---

## 1. Executive Summary

Part 4D.1 establishes the authoritative commercial lifecycle foundation, state transition machines, qualification algorithms, and safe closure architecture for Regular Pools on MilJor. It bridges the demand aggregation layer (Parts 4B–4C) with future commercial execution (supplier confirmation, buyer acceptance, order conversion, and payment intents) without prematurely creating financial commitments or triggering unsafe legacy mutations.

### Key Milestones Delivered
1. **Four Independent State Machines Defined:** Formally separated and documented state machines for Pool Lifecycle (14 states), Reservation Lifecycle (5 states), Supplier Inventory Allocations (4 states), and Order/Payment Boundary.
2. **Pure Commercial Qualification Engine:** Authoritative evaluation of eligible aggregate demand against `supplier_min_qty`, `target_qty`, and `max_capacity` with fail-closed unmapped status safety and discrete tier pricing resolution (`src/services/commercialLifecycleService.js`).
3. **Safe Commercial Snapshot Contract:** Designed and persisted immutable commercial snapshots (`pool_commercial_snapshots`, Migration 013) freezing exact product specification identities, packaging units, tier prices, participating buyer reservations, delivery terms, and deadlines at qualification time.
4. **Permanent Scheduler Decommissioning (OBS-45 Resolved):** Completely expunged legacy destructive prototype closure code from `src/services/poolClosureService.js`. No flag, scheduler trigger, or manual invocation can ever execute legacy mass-cancellations, unauthorized refunds, or inventory releases.
5. **Fresh Post-Lock Expiry Revalidation (OBS-46 Resolved):** Implemented two-stage database server-time expiry evaluation inside row-locked transactions (`FOR UPDATE`) across all reservation mutations (`createReservation`, `updateReservationQuantity`, `cancelReservation`), eliminating lock-wait race vulnerabilities.
6. **Zero-Regression Platform Verification:** 414 / 414 assertions passed across all 18 test suites in 53.83s. Development database `miljor_db` verified 100% pristine.

---

## 2. Four Authoritative State Machines

### A. Pool Commercial Lifecycle State Machine
```
[DRAFT] ──(Supplier Publish)──► [ACTIVE] ──(Participation Cutoff)──► [EXPIRED / UNQUALIFIED]
                                   │
                                   ├──(Target Met)──► [TARGET_REACHED] (Milestone only, remains open)
                                   │
                                   ├──(Cutoff + Qualified)──► [AWAITING_SUPPLIER_CONFIRMATION]
                                   │                              │
                                   │                              ├──(Supplier Confirms)──► [CONFIRMED]
                                   │                              └──(Supplier Declines)──► [SUPPLIER_FAILED]
                                   │
                                   └──(Supplier / Admin Cancel)──► [CANCELLED]
```
- **Allowed States:** `DRAFT`, `ACTIVE`, `TARGET_REACHED`, `AWAITING_SUPPLIER_CONFIRMATION`, `CONFIRMED`, `PAYMENT_PENDING`, `FULFILLING`, `DISPATCHED`, `DELIVERED`, `COMPLETED`, `CANCELLED`, `FAILED`, `EXPIRED`, `SUPPLIER_FAILED`.
- **Key Boundary Invariant:** Crossing `target_qty` (`TARGET_REACHED`) records milestone progress but does NOT close the pool or confirm the supplier. Qualification evaluation occurs at participation cutoff or under authorized early closure policy.

### B. Buyer Reservation Commercial Lifecycle State Machine
```
[RESERVED] ──(Buyer Cancels Pre-Expiry)──► [CANCELLED]
    │
    ├──(Pool Expired / Unqualified)──► [EXPIRED]
    │
    └──(Supplier Confirmed + Buyer Accepts)──► [CONFIRMED] ──(Safepay Paid)──► [PAID]
```
- **Migration 010 Compatibility:** Virtual column `active_pool_buyer_key` enforces one active reservation per buyer per pool for any status `NOT IN ('CANCELLED', 'EXPIRED')`. `CONFIRMED` and `PAID` statuses preserve uniqueness.

### C. Supplier Inventory Allocation Lifecycle State Machine
```
[PENDING] ──(Pool Published)──► [COMMITTED] ──(Order Delivered)──► [FULFILLED]
                                    │
                                    └──(Pool Unqualified / Cancelled)──► [RELEASED]
```
- **Invariant:** `allocation.allocated_qty >= pool.max_capacity`.
- **Safety Rule:** Inventory allocations cannot be released while active buyer reservations exist or while awaiting supplier decisions.

### D. Order & Payment Lifecycle Boundary (Future Part 5 Scope)
`Buyer Final Acceptance -> Order AWAITING_PAYMENT -> Payment Intent -> Safepay Confirmed -> Order PAID -> Fulfilment`
*(Strictly bounded: No orders, payments, or ledger mutations executed in Part 4D.1).*

---

## 3. Commercial Qualification Rules

Pure functional evaluation executed via `CommercialLifecycleService.evaluateCommercialQualification({ pool, reservations, tiers })`:
- **Eligible Demand Calculation:**
  `eligible_demand = SUM(r.quantity)` for whitelisted active demand statuses (`RESERVED`, `CONFIRMED`, `PAID`).
  `CANCELLED` and `EXPIRED` rows are strictly excluded.
- **Fail-Closed Unmapped Status Handling:** Any unknown status is detected by `auditReservationStatuses(reservations)` and conservatively counted toward demand to prevent oversubscription.
- **Threshold Comparisons:**
  1. `eligible_demand < supplier_min_qty`: `UNQUALIFIED` (`is_supplier_confirmable: false`, reason: `BELOW_SUPPLIER_MINIMUM`).
  2. `eligible_demand >= supplier_min_qty`: `QUALIFIED` (`is_supplier_confirmable: true`).
  3. `eligible_demand >= target_qty`: `TARGET_MET` (milestone progress recorded; pool remains accepting demand).
  4. `eligible_demand >= max_capacity`: `CAPACITY_MET` (pool capped from further demand).
- **Legacy Pool Protection:** Historical pools lacking specification or listing links return `qualified: false, is_legacy: true, reason: 'LEGACY_POOL_READ_ONLY'`.

---

## 4. Safe Commercial Snapshot Contract

### Database Migration 013 Applied
- **Table:** `pool_commercial_snapshots`
- **Migration File:** `database/migrations/013_pool_commercial_snapshots.sql`
- **Rollback File:** `database/migrations/rollback/013_rollback_pool_commercial_snapshots.sql`
- **Core Columns:**
  - `snapshot_code`: Unique deterministic code (`SNP-<pool_id>-<timestamp>-<hex>`).
  - `qualification_status`: `ENUM('UNQUALIFIED', 'QUALIFIED', 'TARGET_MET', 'CAPACITY_MET')`.
  - `eligible_aggregate_qty`: Authoritative eligible demand snapshot.
  - `candidate_unit_price`: Applicable tier price evaluated against active demand.
  - `participating_reservations_summary`: Canonical JSON array of all active reservation IDs, codes, buyer IDs, quantities, and prices.
  - `delivery_type`, `delivery_zones`, `delivery_fee_policy`, `fulfilment_lead_time_days`.
  - `supplier_confirmation_deadline`, `buyer_commitment_deadline`.
  - `status`: `PENDING_SUPPLIER_DECISION`.
- **Tamper Resistance:** Once created, future supplier actions cannot modify snapshot quantities, pack units, or tier pricing candidates.

---

## 5. Critical Observations Resolution

### OBS-45 (Legacy Scheduler Feature-Flag Safety) — RESOLVED
- **Defect:** `ENABLE_PART4D_POOL_CLOSURE=true` previously exposed legacy prototype closure logic that executed raw mass cancellations on reservations and direct updates on `payments` and `platform_ledger`.
- **Resolution:** Permanently deleted lines 43–138 of `src/services/poolClosureService.js`. Replaced with safe decommissioning logger returning `legacy_decommissioned: true, reason: 'LEGACY_CLOSURE_PERMANENTLY_DECOMMISSIONED'`.
- **Evidence:** Tested under normal development, production (`NODE_ENV=production`), with `ENABLE_PART4D_POOL_CLOSURE='true'`, and via direct manual invocation. Zero reservations cancelled, zero payments refunded, zero ledger rows touched.

### OBS-46 (Fresh Post-Lock Expiry Revalidation) — RESOLVED
- **Defect:** MySQL's `NOW()` in a queued lock statement binds to the query start time, meaning transactions queued behind a row lock for multiple seconds could evaluate expiry using pre-lock time.
- **Resolution:** Implemented two-stage evaluation across `createReservation`, `updateReservationQuantity`, and `cancelReservation`. After acquiring the exclusive row lock (`SELECT ... FOR UPDATE`), a fresh query evaluates:
  ```sql
  SELECT (expires_at <= NOW()) AS is_freshly_expired FROM pools WHERE id = ?
  ```
  Mutations that crossed expiry while queued for the lock are immediately caught and rejected with HTTP 422 `POOL_EXPIRED`.
- **Evidence:** Test 21 verifies prolonged 1.3s lock hold crossing a 1-second expiry window; queued transaction acquires lock, fresh evaluation triggers, and mutation is cleanly rejected with 422 `POOL_EXPIRED`.

---

## 6. Test Suite Execution & Master Regression

### Dedicated Part 4D.1 Suite Results
`node tests/part4d1_commercial_foundation_gate.js` — **34 / 34 assertions passed (2.16s, exit code 0)**

### Master Platform Regression (18 Suites Single Pass)
`node tests/master_regression_runner.js` — **414 / 414 assertions passed (53.83s, exit code 0)**

| # | Suite Name | Assertions | Duration | Status |
|:---|:---|:---:|:---:|:---:|
| 01 | phase1_gate.js | 12 | 0.72s | PASS |
| 02 | part2_security_gate.js | 16 | 3.98s | PASS |
| 03 | part3_specification_gate.js | 15 | 2.16s | PASS |
| 04 | part4b1_pool_foundation_gate.js | 16 | 0.91s | PASS |
| 05 | part4b2_pool_creation_gate.js | 22 | 2.45s | PASS |
| 06 | part4b3_pool_publishing_gate.js | 25 | 2.29s | PASS |
| 07 | pre4c1_concurrency_hardening_gate.js | 15 | 2.51s | PASS |
| 08 | pre4b4_idempotency_crash_recovery_gate.js | 11 | 2.15s | PASS |
| 09 | part4b4_buyer_reservation_gate.js | 28 | 2.91s | PASS |
| 10 | part4b4_1_reservation_hardening_gate.js | 18 | 3.70s | PASS |
| 11 | part4b4_2_observations_integrity_gate.js | 20 | 3.62s | PASS |
| 12 | part4c1_reservation_mutations_gate.js | 56 | 6.79s | PASS |
| 13 | part4c2a_progress_pricing_gate.js | 28 | 4.47s | PASS |
| 14 | part4c2b_events_visibility_gate.js | 30 | 2.39s | PASS |
| 15 | part4c2_combined_integration_gate.js | 28 | 2.23s | PASS |
| 16 | part4c3_lifecycle_expiry_gate.js | 28 | 3.70s | PASS |
| 17 | part4c3_1_scheduler_safety_gate.js | 12 | 3.37s | PASS |
| 18 | part4d1_commercial_foundation_gate.js | 34 | 3.48s | PASS |
| **TOTAL** | **All 18 Suites Verified** | **414** | **53.83s** | **100% PASS** |

### Database Isolation Verification
- **Development Database (`miljor_db`):** 100% PRISTINE (`pools = 2`, `reservations = 0`, `events = 0`, `mutations = 0`, `snapshots = 0`, `orders = 0`, `payments = 0`).

---

## 7. Gate Status & Safe Stop

- **`PART 4D.1: PASS`**
- **`CAN START PART 4D.2: YES`** (Stopped cleanly; awaiting user prompt).
