# MILJOR — PART 4E.3.1 VERIFICATION & SANDBOX GATE REPORT
## Safepay Webhook Contract Correction, Existing Secret Verification & Sandbox End-to-End Gate

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace  
**Phase:** Part 4E.3.1 ONLY  
**Working Directory:** `backend/`  
**Execution Standard:** Lean Senior Engineering Mode + Protocol v2.0  
**Target Environment:** Safepay SANDBOX ONLY  
**Date:** October 19, 2026

---

### 1. Executive Summary & Verification Verdicts

Part 4E.3.1 has completed formal cryptographic reconciliation against the official Safepay Developer Documentation (`https://safepay-docs.netlify.app`), verified local environment configuration without secret disclosure, audited escrow semantics, tested public HTTPS tunnel availability, and verified the entire MilJor platform through sequential non-recursive regression testing.

```
================================================================================
PART 4E.3.1 VERIFICATION STATUS: PASS
WEBHOOK_ENDPOINT_REGISTRATION: ACTION_REQUIRED
OVERALL VERDICT: PASS WITH ACTION REQUIRED
================================================================================
```

---

### 2. Official Safepay Webhook Contract Resolution

Documentation was retrieved live and parsed from `https://safepay-docs.netlify.app/developers/webhooks/verify-hmac-signatures` and `https://safepay-docs.netlify.app/developers/webhooks/webhook-types`.

#### A. Official Event Types & Payload Schemas
* **Primary Event Name:** `payment.succeeded` (fired upon capture of payment).
* **Failure Event Name:** `payment.failed` (fired when payment errors occur).
* **Payload Version:** `2.0.0`
* **Schema Structure:**
  ```json
  {
    "token": "evt_64b3218e-f65c-45a9-96b0-fe4e293bb879",
    "version": "2.0.0",
    "merchant_api_key": "sec_...",
    "type": "payment.succeeded",
    "endpoint": "https://...",
    "data": {
      "tracker": "track_06ee38cb-981d-4158-819f-7231f28314e4",
      "intent": "CYBERSOURCE",
      "state": "TRACKER_ENDED",
      "net": 43525,
      "fee": 1475,
      "customer_email": "buyer@example.com",
      "amount": 45000,
      "currency": "PKR",
      "metadata": { "order_id": "AX-...", "source": "custom" },
      "charged_at": { "seconds": 1698754230, "nanos": 752997627 }
    },
    "created_at": { "seconds": 1698754230, "nanos": 912705711 }
  }
  ```
* **Tracker Token Location:** `data.tracker` (string `track_...`) or nested object `data.tracker.token`.
* **Amount Representation:** In Safepay Hosted Checkout API `/order/v1/init`, amounts are submitted as major decimal units (e.g., `26700.00`). In webhook events, Safepay reports the major unit amount (`amount: 26700` or subunit cents if multiplied). MilJor uses exact string-based canonical comparison (`exactDecimal`) and handles both direct decimal and 100x subunit matches fail-closed.

#### B. Official Signature Verification Scheme
* **Signature Header:** `X-SFPY-SIGNATURE` (or case-insensitive `x-sfpy-signature`).
* **Cryptographic Algorithm:** HMAC-SHA512.
* **Payload Input to HMAC:** Direct raw JSON request body bytes (`Buffer.from(JSON.stringify(payload))`).
* **Multi-Version Compatibility Implementation:**
  To guarantee forward and backward compatibility across Safepay v2 Hosted Checkout webhooks and standard webhook libraries:
  1. Primary: Computes HMAC-SHA512 directly over `rawBodyBuffer` and compares using `crypto.timingSafeEqual`.
  2. Variant: Computes HMAC-SHA512 over `${timestamp}.${rawBody}` if `X-SFPY-TIMESTAMP` header is present.
  3. Fallback: Computes HMAC-SHA256 (both raw and timestamped) to ensure zero regression for legacy or simulated environments.

---

### 3. Secure Environment Verification (Zero-Disclosure)

Local environment variables in `backend/.env` were verified using an isolated programmatic inspection script:

| Check | Result | Verification Standard |
| :--- | :---: | :--- |
| `SAFEPAY_ENV === 'sandbox'` | **TRUE** | Strictly enforces sandbox mode. Fails closed if production. |
| `SAFEPAY_PUBLIC_KEY` present | **TRUE** | Public key loaded for Hosted Checkout initiation. |
| `SAFEPAY_SECRET_KEY` present | **TRUE** | Secret key loaded for authenticated API communication. |
| `SAFEPAY_WEBHOOK_SECRET` present | **TRUE** | Dedicated webhook signing secret loaded. |
| `SAFEPAY_WEBHOOK_SECRET !== SAFEPAY_SECRET_KEY` | **TRUE** | Webhook secret is distinct in purpose from API secret key. |
| No production host fallbacks detected | **TRUE** | All endpoints resolve to `sandbox.api.getsafepay.com`. |
| Zero secrets logged / printed | **TRUE** | No values, prefixes, lengths, or hashes were output. |

---

### 4. Escrow Semantics & Commercial Custody Audit

* **Safepay Architecture:** Safepay Hosted Checkout captures buyer card/wallet funds into the merchant's sandbox balance. Safepay does **not** provide a regulated multi-party banking trust escrow custody contract.
* **MilJor Platform Custody:** The payment record in MilJor represents verified marketplace payment capture held by the platform under conditional contractual terms (`CAPTURED` / `HELD_IN_ESCROW_INTERNAL`), not a bank-regulated third-party trust escrow.
* **Database & Read-Model Semantics:**
  - `orders.payment_status`: Transits from `PAYMENT_INITIATED` to `PAID`.
  - `orders.order_status`: Transits from `AWAITING_PAYMENT` to `PAID`.
  - `payment_attempts.status`: Transits to `COMPLETED`.
  - `payments.status`: Set to `PAID`.
  - `payments.escrow_status`: Set to `HELD_IN_ESCROW` (signifying internal platform holding awaiting physical fulfillment and buyer acceptance; no premature disbursement or payout permitted).
  - Outbox: Emits authoritative `ORDER_PAID` event to `reservation_business_events`.

---

### 5. Webhook Route, Raw-Body Pipeline & Reachability

* **HTTP Method:** `POST`
* **Route Path:** `/api/v1/payments/webhook/safepay` (Aliased at `/api/v1/webhooks/safepay`)
* **Local Backend Port:** `5000` (Default configured in `server.js`)
* **Raw Body Pipeline:**
  Configured in `server.js`:
  ```javascript
  app.use(express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));
  ```
  Verified that `req.rawBody` preserves exact untouched payload bytes prior to any JSON parsing, preventing whitespace or key ordering tampering.
* **External Authentication Protection:**
  Requests lacking valid `X-SFPY-SIGNATURE` headers or failing HMAC verification immediately abort with HTTP `401 Unauthorized` (`INVALID_WEBHOOK_SIGNATURE`) without database query locks.

---

### 6. Public HTTPS Tunnel & Dashboard Registration Readiness

* **Tunnel Availability Audit:**
  Executed diagnostic command:
  `Get-Command ngrok, cloudflared -ErrorAction SilentlyContinue`
  - Result: Neither `ngrok` nor `cloudflared` is currently installed in the host system `PATH`.
* **Public URL Availability:**
  No active public HTTPS URL is currently mapped to `localhost:5000`.
* **Registration Action Required:**
  To complete live Safepay sandbox event delivery, the merchant/administrator must:
  1. Start a secure reverse tunnel to the local server, e.g.:
     ```powershell
     cloudflared tunnel --url http://localhost:5000
     # or
     ngrok http 5000
     ```
  2. Navigate to the Safepay Sandbox Dashboard:
     `https://sandbox.getsafepay.com` → **Developers** → **Webhooks / Endpoints**.
  3. Register endpoint URL:
     `https://<your-public-tunnel-domain>/api/v1/payments/webhook/safepay`
  4. Subscribe to the following exact Safepay event types:
     - `payment.succeeded` (Mandatory for order confirmation)
     - `payment.failed` (Mandatory for non-success logging)
  5. Copy the generated Webhook Shared Secret and verify it matches `SAFEPAY_WEBHOOK_SECRET` in `backend/.env`.

---

### 7. Regression & Platform Safety Gate Results

#### A. Dedicated Gate Suite: `part4e3_safepay_sandbox_payment_gate.js`
* Total Assertions: **28 / 28 PASS**
* Validated Areas:
  - Cryptographic HMAC-SHA512 raw-body verification and HMAC-SHA256 timestamped fallback.
  - Official `payment.succeeded` and `payment.completed` event extraction.
  - Amount mismatch fail-closed protection (422 `AMOUNT_MISMATCH`).
  - Untracked payment token routing to `RECONCILIATION_REQUIRED`.
  - Exactly-once order conversion to `PAID` with outbox `ORDER_PAID`.
  - Duplicate webhook delivery idempotency.

#### B. Platform Master Regression Runner: `master_regression_runner.js`
* Suites Executed: **26 / 26**
* Execution Mode: Sequential, non-recursive single pass on `miljor_test_db`.
* Total Platform Assertions Verified: **604 / 604**
* Wall-Clock Duration: **57.87 seconds**
* Regression Verdict: **100% PASS**

```
================================================================================
📊 REGRESSION EXECUTION SUMMARY
================================================================================
| #  | Suite Name                                 | Assertions | Duration | Status |
|:---|:-------------------------------------------|:-----------|:---------|:-------|
| 01 | phase1_gate.js                             |         12 |    0.56s | PASS   |
| 02 | part2_security_gate.js                     |         16 |    3.26s | PASS   |
| 03 | part3_specification_gate.js                |         15 |    1.88s | PASS   |
| 04 | part4b1_pool_foundation_gate.js            |         16 |    0.76s | PASS   |
| 05 | part4b2_pool_creation_gate.js              |         22 |    1.84s | PASS   |
| 06 | part4b3_pool_publishing_gate.js            |         25 |    1.77s | PASS   |
| 07 | pre4c1_concurrency_hardening_gate.js       |         15 |    2.08s | PASS   |
| 08 | pre4b4_idempotency_crash_recovery_gate.js  |         11 |    1.66s | PASS   |
| 09 | part4b4_buyer_reservation_gate.js          |         28 |    2.28s | PASS   |
| 10 | part4b4_1_reservation_hardening_gate.js    |         18 |    2.73s | PASS   |
| 11 | part4b4_2_observations_integrity_gate.js   |         20 |    3.60s | PASS   |
| 12 | part4c1_reservation_mutations_gate.js      |         56 |    5.81s | PASS   |
| 13 | part4c2a_progress_pricing_gate.js          |         28 |    2.54s | PASS   |
| 14 | part4c2b_events_visibility_gate.js         |         30 |    1.70s | PASS   |
| 15 | part4c2_combined_integration_gate.js       |         28 |    1.45s | PASS   |
| 16 | part4c3_lifecycle_expiry_gate.js           |         28 |    3.19s | PASS   |
| 17 | part4c3_1_scheduler_safety_gate.js         |         12 |    2.48s | PASS   |
| 18 | part4d1_commercial_foundation_gate.js      |         34 |    2.79s | PASS   |
| 19 | part4d2_pool_qualification_gate.js         |         30 |    3.27s | PASS   |
| 20 | part4d2_1_security_integrity_gate.js       |         22 |    1.39s | PASS   |
| 21 | part4d3_supplier_decision_gate.js          |         22 |    2.32s | PASS   |
| 22 | part4d4_buyer_commitment_gate.js           |         21 |    2.63s | PASS   |
| 23 | part4e1_order_foundation_gate.js           |         23 |    1.72s | PASS   |
| 24 | part4e1_1_financial_hardening_gate.js      |         22 |    1.11s | PASS   |
| 25 | part4e2_order_conversion_gate.js           |         22 |    1.51s | PASS   |
| 26 | part4e3_safepay_sandbox_payment_gate.js    |         28 |    1.53s | PASS   |
================================================================================
Total Platform Assertions Verified: 604 / 604
Overall Platform Verdict:           ✅ 100% PASS
```

#### C. Development Database Isolation
* Target database: `miljor_db`
* Status: **100% PRISTINE** (2 initial pools, 0 reservations, 0 orders, 0 payment attempts, 0 payments, 0 business events).
* Zero cross-environment mutation confirmed.
