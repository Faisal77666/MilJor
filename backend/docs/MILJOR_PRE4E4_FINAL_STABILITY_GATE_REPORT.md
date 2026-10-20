# MILJOR — PRE-4E.4 FINAL STABILITY & REGRESSION GATE REPORT
**Protocol v2.0 / Lean Senior Engineering Mode**  
**Execution Date:** 2026-10-20  
**Status:** READY FOR PART 4E.4

---

## 1. Executive Summary

This report documents the final resolution of the regression blocker in Suite 7 (`pre4c1_concurrency_hardening_gate.js`), the permanent elimination of the Windows/MySQL session timezone offset anomaly across the test harness, the runtime safety verification of the dedicated sandbox environment, and the 100% green execution of the 26-suite master regression runner.

Following this work:
1. **Master Regression:** All **26 suites** passed sequentially with **604 / 604 assertions PASS** in **53.40 seconds**.
2. **Database Role Separation:** `miljor_db` (development), `miljor_sandbox_db` (persistent manual sandbox), and `miljor_test_db` (disposable automated test runner) are strictly isolated with programmatic safety guards.
3. **Database Invariants:** Cryptographic fingerprints confirm that both `miljor_db` and `miljor_sandbox_db` remained **100% PRISTINE and UNMUTATED** throughout all regression and isolation testing.
4. **Sandbox Server Safety:** Background scheduler is programmatically disabled in `NODE_ENV = 'sandbox'` and `NODE_ENV = 'test'`.

---

## 2. Root Cause Analysis: Suite 7 & Timezone Discrepancy

### 2.1 The Incident
During the execution of Suite 7 (`pre4c1_concurrency_hardening_gate.js`) and downstream commercial qualification gates, assertions evaluating elapsed time or cutoffs failed unexpectedly:
- Suite 7 Assertion 4: Stale idempotency recovery check failed because `TIMESTAMPDIFF(SECOND, created_at, NOW())` produced large negative numbers (e.g. `-17930` seconds) instead of positive elapsed seconds.
- Suite 7 Assertion 9: Expired pool exclusion query (`WHERE expires_at > NOW()`) retained pools intended to be expired.
- Downstream qualification gates: `CommercialLifecycleService.qualifyPoolParticipation` threw `PREMATURE_QUALIFICATION: Pool participation cutoff (expires_at) has not been reached yet according to database server time`.

### 2.2 Root Cause Identification
1. **Client UTC Convention:** In accordance with OBS-16 and OBS-22, `src/config/db.js` configured `timezone: 'Z'` on the MySQL connection pool. When JavaScript `new Date()` instances were passed in SQL parameters, `mysql2` formatted them as UTC timestamps (`YYYY-MM-DD HH:mm:ss`).
2. **Server Local Session Time:** MySQL Community Server 8.0 on Windows defaulted `@@global.time_zone` and `@@time_zone` to `SYSTEM`, which resolved to the host operating system's timezone (`SA Pacific Standard Time` / UTC-5).
3. **Split-Brain Comparison:**
   - In MySQL, `NOW()` returns current time in the active session timezone (SA Pacific Standard Time = UTC-5).
   - Passing a UTC `new Date(Date.now() - 3600000)` inserted a timestamp that was only 1 hour behind UTC, but was **4 hours in the future** relative to MySQL's `NOW()`.
   - Consequently, `expires_at <= NOW()` evaluated to `FALSE` (0), causing premature qualification rejections and negative timestamp differences.

### 2.3 Minimal, Permanent Fix
Two complementary, defense-in-depth measures were deployed:
1. **Deterministic Test Fixtures:**
   - In `tests/pre4c1_concurrency_hardening_gate.js`, replaced client-side `new Date()` date arithmetic with native MySQL expressions: `NOW() - INTERVAL 75 SECOND` for heartbeat evaluation and `NOW() - INTERVAL 1 HOUR` for pool expiry, matching `pre4b4_idempotency_crash_recovery_gate.js`.
   - Added idempotency key cleanup in the `finally` block of Suite 7 to prevent uncommitted `PENDING` records from leaking into Suite 12 (`part4c1_reservation_mutations_gate.js`).
2. **Session Timezone Enforcement on DB Pool (`src/config/db.js`):**
   - Attached a connection event listener to `pool.pool` in `src/config/db.js`:
     ```javascript
     pool.pool.on('connection', (connection) => {
       connection.query("SET time_zone = '+00:00'");
     });
     ```
   - Executed `SET GLOBAL time_zone = '+00:00'` on the MySQL server instance.
   - Result: Every MySQL session across development, test, and sandbox runtimes operates in strict UTC (`+00:00`), ensuring complete synchronization between JavaScript `Date` serialization (`timezone: 'Z'`), MySQL `NOW()`, and `UTC_TIMESTAMP()`.

---

## 3. Dedicated Sandbox Environment & Runtime Safeguards

To prevent automated regressions from ever truncating persistent Safepay sandbox payment proof:
1. **Three-Tier Database Routing (`src/config/db.js`):**
   - `NODE_ENV === 'test'` $\rightarrow$ `miljor_test_db` (disposable automated test data).
   - `NODE_ENV === 'sandbox'` $\rightarrow$ `miljor_sandbox_db` (persistent manual sandbox payment evidence).
   - Default $\rightarrow$ `miljor_db` (development business database).
2. **Scheduler Runtime Gate (`server.js`):**
   - Verified that line 185 guards scheduler activation:
     ```javascript
     if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'sandbox') {
       startScheduler();
     }
     ```
   - In sandbox mode, no background jobs or autonomous pollers can mutate orders or reservations.
3. **Dedicated Runner (`start_sandbox_server.js`):**
   - Binds to `127.0.0.1:5000` with `NODE_ENV = 'sandbox'`.
   - Verified that all destructive regression test suites throw fatal errors (`assertTestDatabaseSafety`) if executed against `miljor_sandbox_db`.

---

## 4. Master Regression Runner Results

The authoritative single-pass regression runner (`node tests/master_regression_runner.js`) was executed against `miljor_test_db`.

### 4.1 Master Regression Summary Table

| # | Test Suite | Focus Area | Assertions | Duration | Status |
|:--|:-----------|:-----------|:-----------|:---------|:-------|
| 01 | `phase1_gate.js` | Core Models & DB Foundations | 12 | 0.55s | **PASS** |
| 02 | `part2_security_gate.js` | Security, RBAC & Protection | 16 | 3.17s | **PASS** |
| 03 | `part3_specification_gate.js` | Catalog Normalization & Canonical Hashes | 15 | 1.70s | **PASS** |
| 04 | `part4b1_pool_foundation_gate.js` | Regular Pool Foundation & Migrations | 16 | 0.73s | **PASS** |
| 05 | `part4b2_pool_creation_gate.js` | Atomic Pool Creation & Term Validations | 22 | 1.59s | **PASS** |
| 06 | `part4b3_pool_publishing_gate.js` | Inventory Allocations & Publishing | 25 | 1.52s | **PASS** |
| 07 | `pre4c1_concurrency_hardening_gate.js` | Concurrency & Isolation Hardening | 15 | 1.81s | **PASS** |
| 08 | `pre4b4_idempotency_crash_recovery_gate.js` | Crash Recovery & Heartbeat Liveness | 11 | 1.65s | **PASS** |
| 09 | `part4b4_buyer_reservation_gate.js` | Reservation Engine & Capacity Control | 28 | 2.48s | **PASS** |
| 10 | `part4b4_1_reservation_hardening_gate.js` | Reservation Hardening & State Integrity | 18 | 2.68s | **PASS** |
| 11 | `part4b4_2_observations_integrity_gate.js` | Critical Integrity & OBS-21–25 | 20 | 3.02s | **PASS** |
| 12 | `part4c1_reservation_mutations_gate.js` | Reservation Modifications & Cancellations | 56 | 5.05s | **PASS** |
| 13 | `part4c2a_progress_pricing_gate.js` | Authoritative Progress, Pricing & Read Model | 28 | 2.63s | **PASS** |
| 14 | `part4c2b_events_visibility_gate.js` | Durable Business Events & Visibility | 30 | 1.66s | **PASS** |
| 15 | `part4c2_combined_integration_gate.js` | Combined Reservation & Event Hardening | 28 | 1.41s | **PASS** |
| 16 | `part4c3_lifecycle_expiry_gate.js` | Reservation Lifecycle, Expiry & Participation Gate | 28 | 2.85s | **PASS** |
| 17 | `part4c3_1_scheduler_safety_gate.js` | Scheduler Containment & Expiry Clock | 12 | 2.60s | **PASS** |
| 18 | `part4d1_commercial_foundation_gate.js` | Commercial Lifecycle Foundation & Safe Closure | 34 | 2.63s | **PASS** |
| 19 | `part4d2_pool_qualification_gate.js` | Production-Grade Pool Qualification & Closure | 30 | 3.04s | **PASS** |
| 20 | `part4d2_1_security_integrity_gate.js` | Security Audit & Integrity Hardening | 22 | 1.39s | **PASS** |
| 21 | `part4d3_supplier_decision_gate.js` | Supplier Confirmation & Rejection Engine | 22 | 1.94s | **PASS** |
| 22 | `part4d4_buyer_commitment_gate.js` | Buyer Offer & Final Demand Accounting | 21 | 2.35s | **PASS** |
| 23 | `part4e1_order_foundation_gate.js` | Order Architecture & Commercial Reconciliation | 23 | 1.32s | **PASS** |
| 24 | `part4e1_1_financial_hardening_gate.js` | Exact Financial Arithmetic & Rounding | 22 | 1.11s | **PASS** |
| 25 | `part4e2_order_conversion_gate.js` | Authoritative Order Conversion & Exactly-Once Gate | 22 | 1.34s | **PASS** |
| 26 | `part4e3_safepay_sandbox_payment_gate.js` | Safepay Sandbox Checkout & Payment State Machine | 28 | 1.18s | **PASS** |

- **Total Assertions:** **604 / 604 PASS (100%)**
- **Total Execution Time:** **53.40 seconds**
- **Regressions Detected:** **0**

---

## 5. Database Isolation & Fingerprint Verification

A SHA-256 state fingerprint (`tests/db_fingerprint.js`) was executed immediately prior to and after the full regression run.

### 5.1 Development Database (`miljor_db`)
- **Total Tables:** 29
- **Total Operational Rows:** 71 (seeds & migrations only)
- **Active Pools:** 2 (seeded)
- **Reservations:** 0
- **Orders:** 0
- **Payment Attempts:** 0
- **Payments:** 0
- **Outbox Events:** 0
- **Ledger Records:** 0
- **Verdict:** **100% PRISTINE (UNTOUCHED)**

### 5.2 Sandbox Database (`miljor_sandbox_db`)
- **Total Tables:** 29
- **Schema Migrations:** 19 applied
- **Orders:** 0
- **Payments:** 0
- **Verdict:** **100% ISOLATED & PRESERVED**

---

## 6. Pre-4E.4 Status Gate

```
================================================================================
PRE-4E.4 FINAL STABILITY & REGRESSION STATUS GATE
================================================================================
Database Role Isolation:     IMPLEMENTED & VERIFIED
Timezone Offset Bug:         RESOLVED (UTC Session Hook & Server Sync)
Suite 7 (pre4c1):            15 / 15 PASS
Suite 19 (part4d2):          30 / 30 PASS
Suite 21 (part4d3):          22 / 22 PASS
Master Regression Runner:    604 / 604 PASS (26 Suites, 53.40s)
Development DB (miljor_db):  100% PRISTINE
Sandbox DB (miljor_sandbox): PRESERVED & PROTECTED
Overall Status:              READY FOR PART 4E.4
================================================================================
```

*In strict compliance with Protocol v2.0, execution is paused. Awaiting explicit instruction before proceeding to Part 4E.4.*
