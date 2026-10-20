# MilJor B2B Marketplace — Comprehensive Repository Audit & Truthful Baseline Report

**Audit Date:** October 18, 2026  
**Auditor:** Principal Backend Engineer (Antigravity)  
**Target Codebase:** MilJor Backend Engine (`backend/`)  
**Database Evaluated:** Live MySQL 8.x (`miljor_db`)  

---

## 1. Executive Summary & Phase Classification

The engineering status is reconciled as follows:
- **Part 0 (Repository Audit & Truthful Baseline):** **PASS** — Comprehensive inventory of mounted routes, MySQL tables, code path verification, and risk discovery completed.
- **Part 1 (Database & Architecture Cleanup):** **PASS** — Safe versioned migrations (`001`, `002`, `003`) tracked in `schema_migrations`; database backup verified restorable in isolated `miljor_test_db`; `tests/phase1_gate.js` passes 12/12 integrity assertions.
- **Part 2 (Authentication, Authorization & Security):** **PASS** — `tests/part2_security_gate.js` passes 16/16 assertions. Public role escalation blocked; password complexity enforced; enumeration-free login; least-privilege RBAC; real-time DB active check; object-level authorization across buyer/supplier boundaries; admin verification review mounted.
- **Part 3 & 3.1 (Product Specification & Listing Engine):** **PASS** — Normalized specifications, canonical SHA-256 hashes, decoupled MOQ semantics, out-of-stock exclusion, delivered price transparency; `tests/part3_specification_gate.js` passes 15/15 assertions.
- **Part 4A & 4A.1 (Regular Pool Architecture Reconciliation):** **PASS** — Formal architecture contracts published in `docs/MILJOR_REGULAR_POOL_ARCHITECTURE.md`.
- **Part 4B.1 (Regular Pool Database Foundation & Integrity):** **PASS** — Migration `006` applied; capacity caps, decimal precision, packaging units, and `supplier_inventory_allocations` table; `tests/part4b1_pool_foundation_gate.js` passes 16/16 assertions.
- **Part 4B.2 (Atomic Pool DRAFT Creation):** **PASS** — Atomic transactional creation, four-way product identity linkage, indivisible pack checks, inventory feasibility, idempotency; `tests/part4b2_pool_creation_gate.js` passes 22/22 assertions.
- **Part 4B.3 (Tier Pricing & Safe Publishing):** **PASS** — Deterministic tier pricing engine, continuous non-overlapping intervals, delivery terms, committed inventory allocations on publish, payload hashing idempotency; `tests/part4b3_pool_publishing_gate.js` passes 25/25 assertions.
- **Pre-4C.1 Consolidated Gate:** **PASS** — Master observations register completed; crash recovery and reservation cancellation guards implemented; `tests/pre4c1_concurrency_hardening_gate.js` passes 15/15 assertions.
- **Part 4C.1–12:** **NOT STARTED (Pending approval)**.

---

## 2. Implementation & Architectural Evidence

### 2.1 Unified Payments Consistency
- Grep inspection confirms that zero operational queries target `escrow_payments`. All references in `src/` exist purely as descriptive comments documenting bug fixes.
- Single authoritative table `payments` handles all payment states (`CREATED`, `PENDING`, `PROCESSING`, `PAID`, `FAILED`, `EXPIRED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED`) and escrow states (`HELD_IN_ESCROW`, `RELEASED_TO_SUPPLIER`, `REFUNDED`).

### 2.2 Ledger Accounting Truth
- The `platform_ledger` table is **NOT a true double-entry general ledger** (which requires balancing debits and credits across chart-of-accounts entities like Cash, Supplier Payable, Platform Revenue).
- Instead, `platform_ledger` is a **single-row fee distribution record**:
  $$\text{gross\_amount} = \text{platform\_fee\_amount} + \text{supplier\_net\_amount}$$
- While mathematically consistent for fee deduction and payout tracking, it lacks chart-of-accounts multi-legged bookkeeping.

### 2.3 Foreign Keys, Constraints, and Defaults
- Verified via live MySQL schema and `tests/phase1_gate.js`:
  - `users.is_verified` defaults to `0` (was previously `1`).
  - `users.verification_status` defaults to `'UNVERIFIED'` (was previously `'PHONE_VERIFIED'`).
  - Unique email constraint actively rejects duplicate registrations (`ER_DUP_ENTRY`).
  - Foreign key constraints actively reject orphan records without parent keys (`ER_NO_REFERENCED_ROW_2`).
  - All currency columns enforce `DECIMAL(12,2)`.

### 2.4 Migrations & Backup Verification
- Versioned migrations (`001_initial_schema_baseline.sql` and `002_payment_unification_and_price_locking.sql`) are tracked in `schema_migrations` via `database/runMigrations.js`.
- An automated point-in-time backup utility (`database/backupDatabase.js`) created `miljor_db_backup_2026-10-18T12-29-51-701Z.sql` (31.9 KB).
- Restoration was verified in an isolated test database (`miljor_test_db`) via `database/verifyBackupRestoration.js`, confirming all 17 tables match production.

---

## 3. Financial Architecture Dependencies & Order-Creation Boundary

### Current Bottleneck
In the current payment flow, payments reference `reservation_id` directly, and the `orders` table is completely bypassed. This creates significant risks:
1. Payment providers cannot be passed an authoritative order code with billing/delivery address details.
2. In the event of network disruption after provider payment verification, money is paid with no order record created.
3. Delivery, dispatch, and cluster grouping depend on `orders`, not reservations.

### Recommended Architectural Dependency Flow
```
1. Pool Reservation (RESERVED)
   ↓ (Pool hits target / supplier confirms; Buyer commits delivery details)
2. Order Creation (Order created in 'AWAITING_PAYMENT' with locked price, cluster zone, delivery address)
   ↓
3. Payment Intent (Payment record created in 'PENDING', referencing order_id)
   ↓
4. Provider Verification (Server-side validation of signature, transaction_ref, and amount match)
   ↓
5. Payment Confirmation (Payment marked 'PAID', Escrow 'HELD_IN_ESCROW')
   ↓
6. Order Transition ('PAID' / 'SUPPLIER_CONFIRMED')
   ↓
7. Ledger Distribution (platform_ledger record created in 'HELD_IN_ESCROW')
   ↓
8. Fulfillment (Supplier dispatch -> Delivery OTP / GRN confirmed)
   ↓
9. Escrow Settlement (Escrow 'RELEASED_TO_SUPPLIER', Ledger 'PAID_TO_SUPPLIER')
```

---

## 4. Prioritized Risk Register

### 🔴 Critical Risks
- **RISK-01 (Dead-Zone Modules):** 5 database tables (`orders`, `flash_pools`, `rfqs`, `rfq_quotes`, `recurring_contracts`) have zero mounted API routes or controllers.
- **RISK-02 (Cloud Credential Exposure):** `.env` resides in a local OneDrive sync directory (`OneDrive - Higher Education Commission`). Even with `.gitignore`, active cloud file sync poses an exposure hazard.

### 🟡 High Risks
- **RISK-03 (Idempotency Race Window):** In `idempotencyGuard.js`, cache storage occurs after the controller completes, leaving a sub-second parallel arrival window vulnerable to duplicate execution.
- **RISK-04 (Optional Idempotency Header):** Clients that omit `X-Idempotency-Key` bypass deduplication checks on critical mutations.
- **RISK-05 (Reservation-to-Order Disconnect):** Paid reservations do not instantiate `orders` entities, leaving fulfillment without an operational record.

### 🟢 Medium Risks
- **RISK-06 (Single-Process Cron):** `node-cron` pool expiry scheduler in `schedulerService.js` lacks distributed database locking (`GET_LOCK`) for multi-worker scaling.