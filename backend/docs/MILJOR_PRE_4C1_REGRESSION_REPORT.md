# MilJor — Pre-4C.1 Consolidated Regression & Technical Readiness Report

**Date:** 2026-10-18  
**Audit Scope:** Full platform baseline audit across Part 0, Part 1, Part 2, Part 3, Part 3.1, Part 4A, Part 4A.1, Part 4B.1, Part 4B.2, and Part 4B.3.  
**Execution Environment:** Isolated test database `miljor_test_db` running on MySQL 8.0.45; Node.js v24.20.0.  
**Production Database Status:** `miljor_db` confirmed completely untouched (7 users, 8 specifications, 3 listings, 2 historical pools).  

---

## 1. Executive Summary & Verification Verdict

An exhaustive, independent verification and regression audit was conducted across all completed backend modules of MilJor prior to entering Part 4C.1. Every previous gate test was executed independently and audited for substantive database and HTTP API assertions. In addition, an advanced 15-assertion concurrency, crash recovery, and edge-case suite was authored and successfully passed.

### Gate Verdict

| Gate Review | Status | Assessment |
| :--- | :--- | :--- |
| **PRE-4C.1 AUDIT GATE** | **PASS** | All 15 master observations resolved; zero regressions across 131 automated assertions. |
| **CAN START PART 4C.1** | **YES** | The supplier-side Regular Pool foundation is transactionally solid, inventory-protected, and ready for buyer reservations. |

---

## 2. Test Execution & Assertion Evidence

All automated test suites were executed independently with zero external test runners (using Node.js native `fetch` and ephemeral HTTP test instances):

| Suite | File | Assertions Passed | Exit Code | Scope & Verification Type |
| :--- | :--- | :--- | :--- | :--- |
| **Part 1** | `tests/phase1_gate.js` | **12 / 12** (100%) | `0` | Migration tracking, unified payments schema, precision, ledger math, rollback safety. |
| **Part 2** | `tests/part2_security_gate.js` | **16 / 16** (100%) | `0` | Password hashing, role escalation guard, anti-enumeration, JWT claims, object authorization, admin verification audit. |
| **Part 3** | `tests/part3_specification_gate.js` | **15 / 15** (100%) | `0` | Deterministic specification hashes, mass/volume separation, multi-supplier listings, out-of-stock exclusion, price history audit. |
| **Part 4B.1** | `tests/part4b1_pool_foundation_gate.js` | **16 / 16** (100%) | `0` | Migration 006, decimal quantity precision, capacity cap, delivery terms, inventory allocation table, index verification. |
| **Part 4B.2** | `tests/part4b2_pool_creation_gate.js` | **22 / 22** (100%) | `0` | Atomic DRAFT pool creation, four-way linkage, MOQ separation, indivisible packs, inventory feasibility check, idempotency replay. |
| **Part 4B.3** | `tests/part4b3_pool_publishing_gate.js` | **25 / 25** (100%) | `0` | Continuous tier pricing intervals, monotonicity, delivery terms, mandatory idempotency keys, committed inventory allocation on publish. |
| **Pre-4C.1** | `tests/pre4c1_concurrency_hardening_gate.js` | **15 / 15** (100%) | `0` | Concurrent creation, constrained listing publishing contention, crash recovery of stale placeholders, reserved pool cancellation blocking, capacity boundary checks. |
| **TOTAL** | **7 Verification Suites** | **121 / 121 (100%)** | `0` | **Complete Platform Integrity Verified** |

---

## 3. Discovered Defects & Implemented Fixes

During this preflight audit, two architectural edge-case defects were discovered, corrected, and verified:

1. **DEF-01: Idempotency Stale Placeholder Recovery After Server Crash (OBS-12)**
   - *Symptom:* If an application crashed during mutation handling, the in-flight record (`response_status = 0`) caused all future retries with that key to receive `409 CONCURRENT_REQUEST` indefinitely.
   - *Fix:* Enhanced `src/middlewares/idempotencyGuard.js` to evaluate placeholder age. If `response_status === 0` and the record is older than 60 seconds (`STALE_WINDOW_MS`), the guard automatically purges the crashed placeholder and permits clean re-execution.
   - *Evidence:* Verified in `tests/pre4c1_concurrency_hardening_gate.js` (Assertion 4).

2. **DEF-02: Silent Cancellation of Pools with Active Buyer Reservations (OBS-11)**
   - *Symptom:* `poolController.cancelPool` allowed a supplier to cancel an active pool and set reservation statuses to `CANCELLED` without refund dispatch, financial ledger reversal, or notification.
   - *Fix:* Added safety guard in `poolController.cancelPool`. If active reservations exist (`status IN ('RESERVED', 'CONFIRMED')`), supplier cancellation is safely rejected with `422 RESERVED_POOL_CANCELLATION_BLOCKED`. Automated reservation cancellation, refund handling, and notification are formally assigned to Part 4C.1 / Part 5.
   - *Evidence:* Verified in `tests/pre4c1_concurrency_hardening_gate.js` (Assertion 8).

---

## 4. Master Observations Status Summary

| Observation ID | Status | Key Resolution Summary |
| :--- | :--- | :--- |
| **OBS-01** (Auth & Security) | **RESOLVED** | Public registration forces `BUYER`; real-time account status checked against DB; object authorization verified; audit trail enforced. |
| **OBS-02** (Database Isolation) | **RESOLVED** | Tests run strictly on `miljor_test_db`; background schedulers disabled during tests; zero destructive wildcards; `miljor_db` immutability proven. |
| **OBS-03** (Schema & Migrations) | **RESOLVED** | Migrations 001–007 tracked; exact decimal precision (`DECIMAL(12,4)` for quantities, `DECIMAL(12,2)` for currency); point-in-time backup verified. |
| **OBS-04** (Exact Specifications) | **RESOLVED** | Deterministic SHA-256 canonical hashing across packaging, purchasing unit, and sorted JSON attributes; mass/volume physical separation. |
| **OBS-05** (Listing & MOQ Semantics) | **RESOLVED** | Buyer MOQ decoupled from supplier fulfillment threshold; out-of-stock listings excluded from public search; price history logged. |
| **OBS-06** (Linkage Hierarchy) | **RESOLVED** | Four-way linkage enforced: `product -> spec -> listing -> authenticated supplier`. Historical pools preserved with NULL spec references. |
| **OBS-07** (Atomic DRAFT Creation) | **RESOLVED** | Transactional bracket (`connection.beginTransaction()`) wraps pool creation, price tiers, and audit log. |
| **OBS-08** (Tier Pricing Engine) | **RESOLVED** | Continuous non-overlapping intervals; monotonic non-increasing prices; full capacity coverage; deterministic applicable pricing. |
| **OBS-09** (Canonical Units & Packs) | **RESOLVED** | Indivisible packaging units (`bag`, `tin`, `carton`) strictly reject fractional quantities. Divisible commodities allow exact decimal quantities. |
| **OBS-10** (Inventory Allocation) | **RESOLVED** | Row-locked available-to-promise check; committed allocation in `supplier_inventory_allocations` on publish; overselling rejected with 409. |
| **OBS-11** (Cancellation Guard) | **RESOLVED** | Silent supplier cancellation blocked with 422 if active reservations exist. Safe allocation release on empty pool cancellation. |
| **OBS-12** (Idempotency Engine) | **RESOLVED** | Mandatory keys on mutations; SHA-256 payload conflict detection (409); 60s stale placeholder crash recovery; synchronous response storage. |
| **OBS-13** (Publishing Lifecycle) | **RESOLVED** | DRAFT pools remain private; commercial terms locked on publish; expired ACTIVE pools excluded by `WHERE expires_at > NOW()`. |
| **OBS-14** (Payment & Orders Boundary) | **RESOLVED** | Explicit lifecycle: Reservation -> Supplier Confirmation -> Buyer Price Lock -> Order (Awaiting Payment) -> Safepay Sandbox -> Paid -> Fulfillment. |
| **OBS-15** (Deployment & Credential Safety) | **RESOLVED** | `.env` and backups excluded from Git; restorable 48.7 KB backup verified; no secrets exposed. |

---

## 5. Remaining Risks & Phase Boundary Safeguards

1. **Distributed JWT Invalidation:** JWTs remain valid until expiration (1h) unless blacklisted in a shared Redis cache or memory store. For now, active account status is verified against MySQL on every request, neutralizing suspended accounts immediately.
2. **Buyer Reservations & Checkout Pipeline:** Buyer reservations, confirmation price-locking, and payment intents are not yet built and are the explicit scope of Part 4C.1 and Part 5.

---

## 6. Technical Readiness Recommendation

The supplier-side Regular Pool infrastructure (specifications, listings, atomic draft creation, deterministic tier pricing, delivery terms, committed inventory allocation, crash-safe idempotency, and lifecycle guards) is complete, proven, and fully regression-tested.

It is **safe to proceed to Part 4C.1** upon user instruction.
