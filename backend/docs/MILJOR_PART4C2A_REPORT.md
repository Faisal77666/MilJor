# MILJOR — PART 4C.2A VERIFICATION & READ CONSISTENCY COMPLETION REPORT

**Engineering Standard:** Production-grade implementation, backwards compatibility, financial safety, transactional consistency, strict regression protection.  
**Auditor / Roles:** Principal Backend Engineer, MySQL Concurrency Specialist, B2B Procurement Architect and QA Lead.  
**Project:** MilJor — "Mil Kar Khareedo, Behtar Pao"  
**Execution Date:** October 18, 2026  
**Scope Boundary:** Part 4C.2A only (Authoritative Pool Progress, Tier Pricing Transparency & Read Consistency).

---

## 1. Executive Summary

Part 4C.2A has been successfully executed, rigorously verified, and validated against zero regression.

A single unified read model service (`src/services/poolProgressService.js`) was engineered to compute authoritative pool demand, remaining capacity, dynamic tier pricing estimates, and real-time participation eligibility for Regular Pools. It eliminates duplicate aggregation logic and ensures that read models reflect actual buyer reservations, modifications, and cancellations without mutating database records during read operations.

### Key Milestones Delivered:
1. **Unified Authoritative Read Model (`poolProgressService.js`):** Computes progress metrics and dynamically queries active non-cancelled/non-expired reservations as the single source of aggregate demand truth.
2. **Transparent Commercial Tier Pricing:** Explicitly distinguishes `ESTIMATED_PRE_MINIMUM` (`is_conditional_pricing: true`) from `ESTIMATED_TIER_CONFIRMABLE`. Accurately evaluates `next_tier_quantity`, `additional_quantity_for_next_tier`, and `next_tier_price` (and returns `null` at the highest volume tier with zero fabricated discounts).
3. **Display Progress Capping:** Accurately calculates real mathematical percentages while capping display values at 100.0%, preventing misleading UI overflow while ensuring remaining capacity remains mathematically sound ($\max(0, \text{max\_capacity} - \text{eligible\_quantity})$).
4. **Effective Participation Eligibility (`can_join`):** Evaluates pool status (`ACTIVE`), MySQL UTC server expiration (`expires_at <= NOW()`), remaining capacity vs `buyer_min_qty`, verified supplier status (`is_verified = 1`, `verification_status = 'VERIFIED'`), active listing status, and legacy pool read-only protection.
5. **Drift Detection Policy (OBS-29):** Compares authoritative reservation sums with cached `pools.current_qty`. If drift is detected, logs a structured diagnostic warning and uses the authoritative sum for read presentation without executing write mutations on `GET` requests.
6. **OBS-27 Numeric Hardening:** Hardened `If-Match-Quantity` and `expected_quantity` parsing and comparison against string variations and malformed inputs using 4-decimal precision.
7. **Zero Premature Financial/Order Effects:** Zero orders, payments, or ledger records written during read evaluations.
8. **100% Platform Regression Pass:** 28/28 assertions passed in `tests/part4c2a_progress_pricing_gate.js`, and all 12 prior platform verification suites passed sequentially (282 total assertions).

---

## 2. Test Verification Evidence

### 2.1 Dedicated Part 4C.2A Verification Gate
File: `tests/part4c2a_progress_pricing_gate.js`  
Execution Command: `node tests/part4c2a_progress_pricing_gate.js`

| # | Test Assertion Description | Result |
| :--- | :--- | :--- |
| 1 | Empty published pool: 0 eligible demand, 0.0% progress, full remaining capacity, conditional pricing clearly flagged | **PASS** |
| 2 | Single reservation: 5 bags reserved correctly updates remaining capacity (45) and progress (50% min, 20% target) | **PASS** |
| 3 | Multiple buyers: Authoritative demand combines accurately (5 + 3 = 8 bags) across buyers | **PASS** |
| 4 | Supplier minimum boundary: Exactly 10 bags transitions `minimum_reached: true`, mode: `ESTIMATED_TIER_CONFIRMABLE` | **PASS** |
| 5 | Below-minimum conditional estimate: `pricing_mode` is `ESTIMATED_PRE_MINIMUM`, `is_conditional_pricing: true` | **PASS** |
| 6 | Target boundary: Exactly 20 bags transitions `target_reached: true`, `target_remaining: 0`, 100% target progress | **PASS** |
| 7 | Quantity above target: 25 bags capped at 100.0% target progress, remaining capacity (5) strictly non-negative | **PASS** |
| 8 | Maximum capacity reached: `remaining_capacity: 0`, `capacity_reached: true`, `can_join: false` (`CAPACITY_REACHED`) | **PASS** |
| 9 | Next discount tier: At 12 bags, next tier is at 20 bags (Rs. 5,000), additional needed is exactly 8 bags | **PASS** |
| 10 | Final discount tier: At 37 bags, `next_tier_quantity` is null (zero fabricated discounts) | **PASS** |
| 11 | Dynamic quantity increase: Scaling from 15 to 22 bags shifts snapshot price from 5100 to 4750 | **PASS** |
| 12 | Dynamic quantity decrease: Scaling from 22 down to 14 bags restores snapshot price back to 5100 | **PASS** |
| 13 | Cancellation reflection: Cancelled reservation quantity is completely removed from pool snapshot | **PASS** |
| 14 | Last buyer cancellation (OBS-30): Returns pool cleanly to zero-demand progress state | **PASS** |
| 15 | Decimal precision: Exact fractional quantities (12.5 kg) calculate progress and capacity without drift | **PASS** |
| 16 | OBS-27: Exact numeric handling for `If-Match-Quantity` validates input and avoids floating point divergence | **PASS** |
| 17 | Expired ACTIVE pool: Evaluates `can_join: false` and `participation_status: POOL_EXPIRED` under DB UTC time | **PASS** |
| 18 | Unverified supplier: Evaluates `can_join: false` and `participation_status: SUPPLIER_INELIGIBLE` | **PASS** |
| 19 | Inactive listing: Evaluates `can_join: false` and `participation_status: LISTING_INACTIVE` | **PASS** |
| 20 | Legacy pool read-only: Historical pool 1 returns `is_legacy: 1`, `can_join: false` | **PASS** |
| 21 | Snapshot consistency: Concurrent writes serialize and reflect exact total (5 + 8 + 10 = 23 bags) | **PASS** |
| 22 | Drift policy (OBS-29): Corrupt cached `current_qty` overridden by authoritative reservation sum without silent GET mutation | **PASS** |
| 23 | Locked price immutability: CONFIRMED locked reservations remain strictly untouched by snapshot evaluations | **PASS** |
| 24 | Inventory boundary: Reading snapshots and calculating progress generates zero duplicate inventory allocations | **PASS** |
| 25 | Commercial & financial boundary: Zero orders, payments, or ledger records written during progress reads | **PASS** |
| 26 | API backward compatibility: `GET /api/v1/pools` preserves legacy fields while exposing authoritative metrics | **PASS** |
| 27 | Database isolation verified: All operations strictly confined to `miljor_test_db` | **PASS** |
| 28 | Full platform regression verified: All 12 previous suites passed with 100% success | **PASS** |

**Part 4C.2A Gate Score:** 28 / 28 Assertions Passed (100%).

---

### 2.2 Full Platform Sequential Regression Gate (Test 28)

| Gate Suite | Focus Area | Assertions | Result |
| :--- | :--- | :--- | :--- |
| `phase1_gate.js` | Core Models & DB Foundations | 12 / 12 | **PASS** |
| `part2_security_gate.js` | Security, RBAC & Protection | 16 / 16 | **PASS** |
| `part3_specification_gate.js` | Catalog Normalization & Canonical Hashes | 15 / 15 | **PASS** |
| `part4b1_pool_foundation_gate.js` | Regular Pool Foundation & Migrations | 16 / 16 | **PASS** |
| `part4b2_pool_creation_gate.js` | Atomic Pool Creation & Term Validations | 22 / 22 | **PASS** |
| `part4b3_pool_publishing_gate.js` | Inventory Allocations & Publishing | 25 / 25 | **PASS** |
| `pre4c1_concurrency_hardening_gate.js` | Concurrency & Isolation Hardening | 15 / 15 | **PASS** |
| `pre4b4_idempotency_crash_recovery_gate.js` | Crash Recovery & Heartbeat Liveness | 11 / 11 | **PASS** |
| `part4b4_buyer_reservation_gate.js` | Reservation Engine & Capacity Control | 28 / 28 | **PASS** |
| `part4b4_1_reservation_hardening_gate.js` | Reservation Hardening & State Integrity | 18 / 18 | **PASS** |
| `part4b4_2_observations_integrity_gate.js` | Critical Integrity & OBS-21–25 | 20 / 20 | **PASS** |
| `part4c1_reservation_mutations_gate.js` | Reservation Modifications & Cancellations | 56 / 56 | **PASS** |
| `part4c2a_progress_pricing_gate.js` | Authoritative Progress, Pricing & Read Model | 28 / 28 | **PASS** |
| **Total Cumulative Platform Assertions** | **Complete MilJor Platform Scope** | **282 / 282** | **100% PASS** |

---

## 3. Database Integrity & Isolation Audit

### 3.1 Development Database (`miljor_db`)
- `pools`: 2 rows (historical legacy pools 1 and 2 intact, `product_spec_id = NULL`, `supplier_listing_id = NULL`).
- `users`: 7 rows.
- `reservations`: 0 rows.
- `orders`: 0 rows.
- `payments`: 0 rows.
- Status: **Pristine, untouched, and uncorrupted.**

### 3.2 Test Database (`miljor_test_db`)
- Verified isolation: All dynamic test creations (pools, reservations, mutation histories, test allocations) were strictly executed in `miljor_test_db` and cleaned up during teardown.
- Historical legacy rows in `miljor_test_db` remained intact with NULL spec IDs.
- Supplier listing 1 stock was fully restored to 500.00.

---

## 4. Observations Register (OBS-27 through OBS-31)

All five newly registered observations have been documented and resolved:
- **OBS-27:** Exact numeric comparison for `If-Match-Quantity` (rejects malformed strings with 400 `INVALID_EXPECTED_QUANTITY`, handles formatted decimal strings like `'12.5000'`, detects stale quantities with 412 `PRECONDITION_FAILED`).
- **OBS-28:** Deterministic mutation replay for reservation quantity adjustments and cancellations verified.
- **OBS-29:** Read snapshot consistency and drift detection policy established (derives authoritative sum dynamically; flags diagnostic warning if drift is detected without mutating the database on `GET` requests).
- **OBS-30:** Clean return to zero-demand state on empty or all-cancelled pools verified.
- **OBS-31:** Backward compatibility across pool discovery endpoints (`GET /api/v1/pools` and `GET /api/v1/pools/:id`) verified.

---

## 5. Scope Boundary Enforcement

- **Part 4C.2B (Qualification Transition & Pool Closing):** STRICTLY NOT STARTED.
- **Part 4C.3 (Supplier Confirmation):** STRICTLY NOT STARTED.
- **Part 4D (Buyer Price Locking & Terms Acceptance):** STRICTLY NOT STARTED.
- **Part 5 (Orders, Safepay Sandbox, Payments, Refunds):** STRICTLY NOT STARTED.
- **Notifications / Clearance Pools / RFQ:** STRICTLY NOT STARTED.

Execution stopped cleanly at the boundary of Part 4C.2A.
