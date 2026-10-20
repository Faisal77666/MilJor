# MILJOR — PART 4E.3 ENGINEERING COMPLETION REPORT
## Safepay Sandbox Hosted Checkout, Cryptographically Verified Webhooks & Exactly-Once Payment Confirmation

**Document Reference:** `docs/MILJOR_PART4E3_SAFEPAY_SANDBOX_PAYMENT_REPORT.md`  
**Phase:** Part 4E.3 ONLY  
**Engineering Roles:** Principal Backend Architect, Senior Express.js/MySQL Engineer, Payment Gateway Specialist, Financial Integrity Engineer, Application Security Engineer, QA Lead  
**Execution Standard:** Lean Senior Engineering Mode + MilJor Advanced Engineering Execution Protocol v2.0  
**Environment:** Safepay SANDBOX ONLY (`https://sandbox.api.getsafepay.com`)  
**Date of Completion:** October 19, 2026  
**Final Status:** ✅ **100% PASS — PRODUCTION READY FOR SANDBOX**

---

## 1. Executive Summary

MilJor Part 4E.3 has authoritatively established a secure, resilient, and exactly-once payment integration connecting persisted buyer orders (`AWAITING_PAYMENT`) to Safepay's sandbox hosted checkout workflow, confirmed strictly via cryptographically verified provider webhook notifications.

### Key Milestones Delivered:
1. **Immutable Amount Derivation & Tampering Defense (OBS-81):** Client applications can never dictate payment amounts, currencies, or line-item totals during checkout session initiation. Amounts are retrieved strictly from the locked database order record. Attempts by malicious buyers to supply tampered amounts (e.g., Rs. 1.00 instead of Rs. 26,700.00) or unauthorized currencies (e.g., USD) are defeated.
2. **Network Calls Outside Database Write Locks:** Third-party HTTPS communication with Safepay (`POST /order/v1/init`) executes strictly outside MySQL write transactions, eliminating connection starvation, transaction pool exhaustion, and deadlock risks.
3. **Cryptographic Webhook Signature Verification (OBS-82):** Express middleware was configured with raw body capture (`express.json({ verify: (req, res, buf) => { req.rawBody = buf; } })`). Webhooks are verified using timing-safe HMAC-SHA256 signatures (`crypto.timingSafeEqual`) computed over `${timestamp}.${rawBody}`. Webhooks with missing, forged, or tampered signatures are rejected immediately with HTTP 401.
4. **Transactional Outbox & State Machine Confirmation:** Authentic `payment.completed` webhooks execute an atomic MySQL transaction under row-level `FOR UPDATE` locks on `payment_attempts` and `orders`. The order transitions to `PAID`, `payment_attempts` transitions to `COMPLETED`, an authoritative record is inserted into the `payments` table with `status = 'PAID'` and `escrow_status = 'HELD_IN_ESCROW'`, and a domain event `ORDER_PAID` is emitted in `reservation_business_events`.
5. **Replay Defense & Deduplication:** Webhooks are deduplicated via unique `event_id` in `payment_webhook_events`. Repeated or duplicate webhooks on already `PAID` orders are acknowledged idempotently without state corruption.
6. **Zero Premature Operations:** Zero live production charges, refunds, seller disbursements, delivery dispatches, or settlement mutations occurred. Escrow funds remain strictly `HELD_IN_ESCROW`.
7. **Full Verification:** Dedicated gate suite `tests/part4e3_safepay_sandbox_payment_gate.js` passed 28/28 assertions. Platform master regression runner `tests/master_regression_runner.js` passed all 26 suites (604/604 assertions) in 55.64s. Development database `miljor_db` remains 100% PRISTINE.

---

## 2. Policy Freshness Gate & On-Disk Baseline

Prior to implementation, the on-disk policy files were verified under the Workspace Policy Freshness Gate:
- `backend/AGENTS.md` (SHA-256 verified)
- `backend/docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md` (SHA-256 verified)
- `backend/docs/MILJOR_BUSINESS_INVARIANTS.md` (SHA-256 verified)

All instructions, database isolation requirements, and Lean Senior Engineering Mode standards were strictly observed.

---

## 3. Pre-Flight Backup & Database Migration 019

### 3.1 Pre-Flight Non-Interactive Database Backup
- **Backup File:** `database/backups/miljor_db_backup_2026-10-19T20-56-35-847Z.sql`
- **File Size:** 66.4 KB
- **Restorability Check:** Restored cleanly into isolated database `miljor_test_db`. All 27 existing tables matched row-for-row.

### 3.2 Migration 019: Safepay Sandbox Payment Attempts & Webhooks
- **Migration Script:** `database/migrations/019_safepay_sandbox_payment_attempts.sql`
- **Rollback Script:** `database/migrations/rollback/019_rollback_safepay_sandbox_payment_attempts.sql`
- **Schema Additions:**
  1. `payment_attempts`:
     - Tracks checkout initiation attempts with Safepay.
     - Columns: `id`, `attempt_code` (UNIQUE), `order_id` (FK), `buyer_id` (FK), `provider` ('SAFEPAY'), `environment` ('sandbox'), `provider_tracker_token` (UNIQUE), `checkout_url`, `amount` (`DECIMAL(12,2)`), `currency` ('PKR'), `status` (`ENUM('INITIATED','COMPLETED','FAILED','EXPIRED','CANCELLED')`), `idempotency_key`, `created_at`, `updated_at`.
  2. `payment_webhook_events`:
     - Immutable forensic audit and deduplication log for inbound provider webhooks.
     - Columns: `id`, `event_id` (UNIQUE), `provider` ('SAFEPAY'), `event_type`, `order_id` (FK), `attempt_id` (FK), `provider_tracker_token`, `signature`, `timestamp_header`, `raw_payload` (JSON), `processed_status` (`ENUM('PROCESSED','IGNORED_DUPLICATE','FAILED','RECONCILIATION_REQUIRED')`), `error_message`, `created_at`.
- **Application:** Applied cleanly via `database/runMigrations.js` to `miljor_test_db` and `miljor_db`.

---

## 4. Resolution of Observations

### OBS-81: Client-Controlled Amount and Currency Tampering in Checkout Initiation
- **Vulnerability:** If checkout session creation trusts client-supplied `amount` or `currency`, an attacker can modify request parameters and pay pennies for high-value wholesale orders.
- **Remediation:** `safepayCheckoutService.initiateCheckout` completely ignores request body financial parameters. The order row is queried directly by ID; the total amount is taken from `order.total_amount` (`DECIMAL(12,2)`). The currency is strictly verified as `PKR` (`UNSUPPORTED_CURRENCY` 422 if otherwise). The Safepay tracker is initialized with the authoritative database total, and durable attempt state is persisted.
- **Verification:** Test 16 in `part4e3_safepay_sandbox_payment_gate.js` proved that a buyer supplying `{ amount: 1.00, currency: 'USD' }` was charged exactly Rs. 26,700.00 in PKR as persisted in the order record.

### OBS-82: Raw Webhook Signature Verification and Exactly-Once Order State Transition
- **Vulnerability:** JSON body parsing changes character formatting and line breaks, invalidating cryptographic HMAC signatures. In addition, uncoordinated webhook intake can result in duplicate order completions, double-credited ledger balances, or race conditions.
- **Remediation:** 
  1. `server.js` captures raw request bytes via `express.json({ verify: (req, res, buf) => { req.rawBody = buf; } })`.
  2. `safepayAdapter.verifyWebhookSignature` computes HMAC-SHA256 over `${timestamp}.${rawBody}` using the configured webhook secret and verifies it with `crypto.timingSafeEqual`.
  3. `safepayCheckoutService.processWebhookEvent` locks `payment_attempts` and `orders` using `FOR UPDATE`. It verifies currency and exact amount match (`exactDecimal.exactDecimalEquals`), advances order and attempt status, writes the authoritative `payments` entry, and emits `ORDER_PAID` outbox event in a single atomic transaction.
- **Verification:** Tests 18–25 proved that missing, tampered, or forged signatures return 401; amount discrepancies fail closed with 422; valid signatures confirm orders atomically; and duplicate deliveries are acknowledged idempotently without double-mutating database state.

---

## 5. Architectural Components Delivered

```
                         ┌────────────────────────────────────────────────────────┐
                         │               BUYER (Mobile App / Web)                 │
                         └─────────────────────────┬──────────────────────────────┘
                                                   │
                          1. POST /api/v1/orders/:id/checkout (X-Idempotency-Key)
                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Express API: OrderController / SafepayCheckoutService                                           │
│  - Strict BUYER RBAC & Tenant Isolation                                                         │
│  - Guard: Order must be in AWAITING_PAYMENT                                                     │
│  - Server-Derived Amount: totalPayable = order.total_amount (Defeats Tampering)                 │
└──────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                           │
                    2. POST /order/v1/init (OUTSIDE DB write lock)
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Safepay Sandbox API (https://sandbox.api.getsafepay.com)                                        │
│  - Returns trackerToken: "track_..."                                                            │
└──────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                           │
                    3. Return Hosted Checkout URL (?beacon=track_...&env=sandbox)
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ MySQL Database: payment_attempts                                                                │
│  - Status: INITIATED                                                                            │
│  - Orders: payment_status = PAYMENT_INITIATED                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

═════════════════════════════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Safepay Sandbox Webhook Engine                                                                  │
└──────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                           │
      4. POST /api/v1/payments/webhook/safepay
         Headers: X-SFPY-SIGNATURE, X-SFPY-TIMESTAMP
         Payload: { type: "payment.completed", data: { tracker: { token, amount, currency } } }
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Express API: PaymentController / SafepayAdapter / SafepayCheckoutService                       │
│  - Raw Body HMAC-SHA256 Verification: crypto.timingSafeEqual against ${timestamp}.${rawBody}     │
│  - Deduplication: Check payment_webhook_events(event_id)                                        │
│  - BEGIN TRANSACTION;                                                                           │
│      SELECT * FROM payment_attempts WHERE provider_tracker_token = ? FOR UPDATE;                │
│      SELECT * FROM orders WHERE id = ? FOR UPDATE;                                              │
│      Exact Amount & Currency Equality: exactDecimal.exactDecimalEquals                          │
│      UPDATE payment_attempts SET status = 'COMPLETED';                                          │
│      UPDATE orders SET order_status = 'PAID', payment_status = 'PAID';                          │
│      INSERT INTO payments (status = 'PAID', escrow_status = 'HELD_IN_ESCROW');                  │
│      INSERT INTO payment_webhook_events (processed_status = 'PROCESSED');                       │
│      INSERT INTO reservation_business_events (event_type = 'ORDER_PAID');                       │
│    COMMIT;                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Service & Controller Catalog
- `src/services/safepayAdapter.js`:
  - `validateConfig()`: Validates sandbox mode and API keys.
  - `createTracker({ amount, currency, orderCode, mockClient })`: Pure HTTPS POST to `/order/v1/init`.
  - `constructCheckoutUrl({ trackerToken, orderCode, redirectUrl, cancelUrl })`: Constructs hosted checkout URL with beacon, order_id, source, and env.
  - `verifyWebhookSignature({ rawBody, signature, timestamp })`: Cryptographic verification supporting raw hex and `sha256=` prefix.
- `src/services/safepayCheckoutService.js`:
  - `initiateCheckout({ orderId, actor, idempotencyKey, redirectUrl, cancelUrl, mockClient })`: Authoritative checkout session creation.
  - `processWebhookEvent({ rawBody, signature, timestamp, eventId, eventType })`: Atomic webhook intake and state transition engine.
  - `getOrderPaymentStatus({ orderId, actor })`: Authoritative payment status read model.
- `src/controllers/orderController.js`:
  - `initiateCheckout`: Express handler for `POST /api/v1/orders/:id/checkout`.
  - `getPaymentStatus`: Express handler for `GET /api/v1/orders/:id/payment-status`.
- `src/controllers/paymentController.js`:
  - `handleSafepayWebhook`: Express handler for unauthenticated webhook intake.
- `src/routes/v1/orderRoutes.js`: Mounted at `/api/v1/orders`.
- `src/routes/v1/paymentRoutes.js`: Mounted public webhook before `router.use(protect)`.

---

## 6. Verification Evidence

### 6.1 Dedicated Test Gate (`tests/part4e3_safepay_sandbox_payment_gate.js`)
All 28 assertions passed in 1.33 seconds with natural process termination:

| # | Assertion Description | Result |
|:---|:---------------------|:-------|
| 01 | Safepay adapter config validated (sandbox mode, keys present) | **PASS** |
| 02 | Hosted checkout URL constructed with required parameters | **PASS** |
| 03 | Cryptographic HMAC-SHA256 signature verification (raw hex, sha256= prefix, tampered defense) | **PASS** |
| 04 | Unsupported currency rejected with UNSUPPORTED_CURRENCY (PKR-only rule) | **PASS** |
| 05 | Commercial fixtures initialized (pools, reservations, buyer decisions, orders 1, 2, 3) | **PASS** |
| 06 | Checkout initiation requires authentication (401 without token) | **PASS** |
| 07 | Supplier role strictly prohibited from initiating checkout (403) | **PASS** |
| 08 | Admin role strictly prohibited from initiating buyer checkout (403) | **PASS** |
| 09 | Suspended buyer account blocked from checkout initiation (403) | **PASS** |
| 10 | Mandatory X-Idempotency-Key enforced on checkout initiation (400) | **PASS** |
| 11 | Nonexistent order ID returns 404 ORDER_NOT_FOUND | **PASS** |
| 12 | Tenant isolation: Cross-buyer order checkout denied (403 FORBIDDEN) | **PASS** |
| 13 | Already-paid order blocked from initiating duplicate checkout (409 ORDER_ALREADY_PAID) | **PASS** |
| 14 | Safepay provider timeout gracefully returned as 504 SAFEPAY_TIMEOUT | **PASS** |
| 15 | Safepay provider connection error gracefully returned as 502 SAFEPAY_CONNECTION_ERROR | **PASS** |
| 16 | Successful checkout initiation: Amount tampering defeated, payment_attempt created, payment_status=PAYMENT_INITIATED | **PASS** |
| 17 | Idempotent replay returns cached checkout session without duplicate DB records | **PASS** |
| 18 | Webhook without signature rejected (401 INVALID_WEBHOOK_SIGNATURE) | **PASS** |
| 19 | Webhook with forged signature rejected (401) | **PASS** |
| 20 | Webhook with tampered payload rejected (401) | **PASS** |
| 21 | Non-success webhook (payment.failed) recorded without corrupting order state | **PASS** |
| 22 | Amount mismatch between webhook and order fails closed with 422 AMOUNT_MISMATCH | **PASS** |
| 23 | Untracked payment session safely captured in RECONCILIATION_REQUIRED | **PASS** |
| 24 | Authoritative payment confirmation: Order PAID, attempt COMPLETED, payments row inserted, ORDER_PAID outbox event | **PASS** |
| 25 | Duplicate webhook delivery acknowledged idempotently without duplicate mutations | **PASS** |
| 26 | Order payment status read model enforces tenant isolation and reports authoritative lifecycle | **PASS** |
| 27 | Commercial safety: Escrow funds strictly remain HELD_IN_ESCROW | **PASS** |
| 28 | Database isolation: miljor_db is 100% PRISTINE | **PASS** |

### 6.2 26-Suite Platform Master Regression (`tests/master_regression_runner.js`)
Sequential execution across all 26 verification suites completed in 55.64s with 100% PASS:

| Suite # | Suite File | Focus Area | Assertions | Time | Status |
|:---|:---|:---|:---:|:---:|:---:|
| 01 | `phase1_gate.js` | Core Models & DB Foundations | 12 | 0.64s | **PASS** |
| 02 | `part2_security_gate.js` | Security, RBAC & Protection | 16 | 3.25s | **PASS** |
| 03 | `part3_specification_gate.js` | Catalog Normalization & Canonical Hashes | 15 | 1.79s | **PASS** |
| 04 | `part4b1_pool_foundation_gate.js` | Regular Pool Foundation & Migrations | 16 | 0.80s | **PASS** |
| 05 | `part4b2_pool_creation_gate.js` | Atomic Pool Creation & Term Validations | 22 | 1.71s | **PASS** |
| 06 | `part4b3_pool_publishing_gate.js` | Inventory Allocations & Publishing | 25 | 1.66s | **PASS** |
| 07 | `pre4c1_concurrency_hardening_gate.js` | Concurrency & Isolation Hardening | 15 | 1.73s | **PASS** |
| 08 | `pre4b4_idempotency_crash_recovery_gate.js` | Crash Recovery & Heartbeat Liveness | 11 | 1.57s | **PASS** |
| 09 | `part4b4_buyer_reservation_gate.js` | Reservation Engine & Capacity Control | 28 | 3.03s | **PASS** |
| 10 | `part4b4_1_reservation_hardening_gate.js` | Reservation Hardening & State Integrity | 18 | 2.78s | **PASS** |
| 11 | `part4b4_2_observations_integrity_gate.js` | Critical Integrity & OBS-21–25 | 20 | 2.89s | **PASS** |
| 12 | `part4c1_reservation_mutations_gate.js` | Reservation Modifications & Cancellations | 56 | 5.16s | **PASS** |
| 13 | `part4c2a_progress_pricing_gate.js` | Authoritative Progress, Pricing & Read Model | 28 | 2.65s | **PASS** |
| 14 | `part4c2b_events_visibility_gate.js` | Durable Business Events & Visibility | 30 | 1.82s | **PASS** |
| 15 | `part4c2_combined_integration_gate.js` | Combined Reservation & Event Hardening | 28 | 1.58s | **PASS** |
| 16 | `part4c3_lifecycle_expiry_gate.js` | Reservation Lifecycle & Expiry Gate | 28 | 3.09s | **PASS** |
| 17 | `part4c3_1_scheduler_safety_gate.js` | Scheduler Containment & Expiry Clock | 12 | 2.51s | **PASS** |
| 18 | `part4d1_commercial_foundation_gate.js` | Commercial Lifecycle Foundation & Safe Closure | 34 | 2.73s | **PASS** |
| 19 | `part4d2_pool_qualification_gate.js` | Pool Qualification & Atomic Closure Decision | 30 | 3.07s | **PASS** |
| 20 | `part4d2_1_security_integrity_gate.js` | Security Audit & Integrity Hardening | 22 | 1.41s | **PASS** |
| 21 | `part4d3_supplier_decision_gate.js` | Supplier Confirmation & Rejection Engine | 22 | 2.01s | **PASS** |
| 22 | `part4d4_buyer_commitment_gate.js` | Buyer Offer, Explicit Commitment & Final Demand | 21 | 2.49s | **PASS** |
| 23 | `part4e1_order_foundation_gate.js` | Order Architecture & Commercial Reconciliation | 23 | 1.34s | **PASS** |
| 24 | `part4e1_1_financial_hardening_gate.js` | Exact Financial Arithmetic & Consistency Hardening | 22 | 1.17s | **PASS** |
| 25 | `part4e2_order_conversion_gate.js` | Authoritative Order Conversion & Exactly-Once Gate | 22 | 1.44s | **PASS** |
| 26 | `part4e3_safepay_sandbox_payment_gate.js` | Safepay Sandbox Checkout & Payment State Machine | 28 | 1.33s | **PASS** |
| **TOTAL** | **26 Suites** | **Complete Platform Coverage** | **604 / 604** | **55.64s** | **100% PASS** |

### 6.3 Development Database Isolation (`miljor_db`)
The development database was inspected immediately following the master regression runner:
- `pools`: 2 (original baseline)
- `reservations`: 0
- `orders`: 0
- `payment_attempts`: 0
- `payments`: 0
- `platform_ledger`: 0
- `pool_commercial_snapshots`: 0
- `pool_supplier_commercial_decisions`: 0
- `pool_buyer_commercial_decisions`: 0
- `reservation_business_events`: 0
- `reservation_mutation_history`: 0
- `schema_migrations`: 19 (Migration 001 through 019 applied)
- **Result:** Development database `miljor_db` is **100% PRISTINE**.

---

## 7. Phase Boundary & Non-Negotiable Safeguards

In strict compliance with Part 4E.3 authorized scope:
- **Environment Restriction:** Strictly restricted to Safepay sandbox (`https://sandbox.api.getsafepay.com`). Zero production credentials used.
- **No Premature Escrow Release:** All confirmed payments are marked with `escrow_status = 'HELD_IN_ESCROW'`. No seller payouts or platform ledger disbursements were executed.
- **No Physical Fulfillment:** Order fulfillment, delivery logistics, driver dispatch, and buyer delivery acceptance remain strictly unstarted.
- **No Subsequent Phase Authorization:** The system has completed Part 4E.3 and stopped cleanly awaiting technical authorization for future phases.

---

## 8. Sign-off & Verification Status

```
================================================================================
FINAL VERIFICATION SIGN-OFF: MILJOR PART 4E.3
================================================================================
[x] Pre-Flight Backup & Migration 019 Applied Cleanly
[x] Safepay Sandbox HTTPS Adapter & URL Construction
[x] Client Amount & Currency Tampering Defeated (OBS-81)
[x] Network Calls Executed Outside MySQL Transaction Locks
[x] Timing-Safe Cryptographic Webhook HMAC Verification (OBS-82)
[x] Atomic State Transition to PAID & HELD_IN_ESCROW
[x] Transactional Outbox Event ORDER_PAID Emitted
[x] Dedicated Gate Passed: 28 / 28 Assertions (100% PASS)
[x] Platform Master Regression Passed: 604 / 604 Assertions Across 26 Suites (100% PASS)
[x] Development Database miljor_db Verified 100% PRISTINE
[x] Status: PASS — STOPPED CLEANLY
================================================================================
```
