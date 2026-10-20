# MILJOR — PART 4E.3.2 VERIFICATION & SANDBOX GATE REPORT
## Secure Public Sandbox Webhook Setup & Real Provider Verification

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace  
**Phase:** Part 4E.3.2 ONLY  
**Working Directory:** `backend/`  
**Execution Standard:** Lean Senior Engineering Mode + Protocol v2.0  
**Target Environment:** Safepay SANDBOX ONLY  
**Date:** October 19, 2026

---

### 1. Executive Summary & Required Final Verdict Tokens

```
================================================================================
LOCAL SIGNATURE TESTS: PASS
ENDPOINT REGISTERED: NO
SECRET-ENDPOINT ASSOCIATION: NOT VERIFIED
EXTERNAL HTTPS REACHABILITY: BLOCKED
REAL SANDBOX PAYMENT: NOT TESTED
REAL PROVIDER WEBHOOK: NOT TESTED
EXACTLY-ONCE PAYMENT STATE: VERIFIED
ESCROW SEMANTICS: CORRECTED
PRODUCTION PAYMENTS: DISABLED
CAN START NEXT PHASE: NO
================================================================================
```

---

### 2. Verification of Webhook Route & Local Service Binding

* **HTTP Route Path:** `POST /api/v1/payments/webhook/safepay`
* **Route Alias:** `POST /api/v1/webhooks/safepay`
* **Local Listening Port:** `5000` (Default configured in `server.js`)
* **Raw Body Pipeline:** Verified in `server.js`:
  ```javascript
  app.use(express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));
  ```
  `req.rawBody` preserves untouched HTTP payload bytes prior to any JSON decoding or property re-ordering, guaranteeing byte-level input fidelity for cryptographic HMAC calculation.

---

### 3. Strict Safepay Signature Contract Enforcement

* **Cryptographic Algorithm:** HMAC-SHA512.
* **Payload Input:** Exact untouched `rawBodyBuffer`.
* **Header:** `X-SFPY-SIGNATURE` (or case-insensitive `x-sfpy-signature`).
* **Normalization:** Strips optional `sha512=` prefix if provided by webhook relays.
* **Timing-Attack Resistance:** Enforced via `crypto.timingSafeEqual`.
* **Disabling of Fallbacks:** All legacy SHA256 and timestamp-concatenation fallbacks have been removed. Any webhook not authenticated via HMAC-SHA512 over the raw body fails closed immediately with HTTP `401 Unauthorized` (`INVALID_WEBHOOK_SIGNATURE`).
* **Source Files Updated:**
  - [`src/services/safepayAdapter.js`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/src/services/safepayAdapter.js): `verifyWebhookSignature({ rawBody, signature })`.
  - [`src/services/safepayCheckoutService.js`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/src/services/safepayCheckoutService.js): Updated signature call and supported payload token identifier extraction (`parsedPayload.token`).

---

### 4. Escrow Semantics Correction (OBS-83 / OBS-84)

1. **Captured Payment:** Safepay Hosted Checkout executes payment capture into the merchant's sandbox account balance. Safepay does **not** provide or operate a regulated multi-party banking trust escrow facility.
2. **Platform Custodial Holding:** Within MilJor, `payments.escrow_status = 'HELD_IN_ESCROW'` represents **internal marketplace platform custody** under conditional commercial terms. Funds remain locked awaiting supplier fulfillment and buyer delivery acceptance.
3. **Payout Restriction:** Internal platform logic strictly prevents supplier payout or fund disbursement while in `HELD_IN_ESCROW`. No payout or settlement operations were executed.

---

### 5. HTTPS Tunnel Status & Blocker Analysis

* **Tunnel Availability Audit:**
  - Standard tunnel CLI tools (`cloudflared`, `ngrok`, `localtunnel`, `caddy`, `tailscale`, `zrok`) were absent from the host `PATH`.
  - Automated binary download attempts via package managers timed out or were blocked due to environmental network restrictions on automated background binary downloads.
* **Exact Blocker:**
  A secure, verified, publicly reachable HTTPS tunnel could not be established automatically in the current sandbox runner environment without user-level execution or network permission.
* **Status:** `EXTERNAL HTTPS REACHABILITY: BLOCKED` (and consequently `REAL SANDBOX PAYMENT: NOT TESTED`, `REAL PROVIDER WEBHOOK: NOT TESTED`).
* **Minimal Steps Required by User to Expose Port 5000:**
  1. Open a terminal on your host machine and run one of the following:
     ```powershell
     # Option A: Cloudflare Tunnel (recommended, no sign-in required)
     cloudflared tunnel --url http://localhost:5000

     # Option B: ngrok
     ngrok http 5000
     ```
  2. Copy the resulting HTTPS URL (e.g. `https://<generated-subdomain>.trycloudflare.com`).
  3. The exact webhook endpoint URL to enter in the Safepay Dashboard is:
     `https://<generated-subdomain>.trycloudflare.com/api/v1/payments/webhook/safepay`
  4. Ensure the tunnel remains running while navigating to:
     **Safepay Dashboard** → **Developers** → **Endpoints** → **Create a new endpoint**.
  5. Select the following official event subscriptions (Version 2.0.0):
     - `payment.succeeded` (Mandatory for order confirmation)
     - `payment.failed` (Mandatory for failure tracking)
  6. Copy the endpoint's **Shared Secret** into `backend/.env` under `SAFEPAY_WEBHOOK_SECRET`.

---

### 6. Endpoint-Secret Verification Status

* `SAFEPAY_WEBHOOK_SECRET` is present in local `backend/.env`.
* However, because public endpoint registration in the Safepay Dashboard requires user registration of a live reachable HTTPS URL, the association between the local secret and an active Safepay sandbox endpoint is:
  `SECRET-ENDPOINT ASSOCIATION: NOT VERIFIED`

---

### 7. Regression & Platform Safety Gate Results

#### A. Dedicated Gate Suite: `part4e3_safepay_sandbox_payment_gate.js`
* Total Assertions: **28 / 28 PASS** (1.28s)
* Validated Areas:
  - Cryptographic HMAC-SHA512 raw-body verification; legacy SHA256 rejected.
  - Official `payment.succeeded` event processing with tracker and amount verification.
  - Unsigned requests rejected with 401 without database query locks.
  - Replay defense, duplicate delivery idempotency, and amount mismatch fail-closed protection.

#### B. Platform Master Regression Runner: `master_regression_runner.js`
* Suites Executed: **26 / 26**
* Execution Mode: Sequential, non-recursive single pass on `miljor_test_db`.
* Total Platform Assertions Verified: **604 / 604**
* Wall-Clock Duration: **60.46 seconds**
* Regression Verdict: **100% PASS**

```
================================================================================
📊 REGRESSION EXECUTION SUMMARY
================================================================================
| #  | Suite Name                                 | Assertions | Duration | Status |
|:---|:-------------------------------------------|:-----------|:---------|:-------|
| 01 | phase1_gate.js                             |         12 |    0.61s | PASS   |
| 02 | part2_security_gate.js                     |         16 |    3.31s | PASS   |
| 03 | part3_specification_gate.js                |         15 |    1.80s | PASS   |
| 04 | part4b1_pool_foundation_gate.js            |         16 |    0.82s | PASS   |
| 05 | part4b2_pool_creation_gate.js              |         22 |    1.93s | PASS   |
| 06 | part4b3_pool_publishing_gate.js            |         25 |    1.79s | PASS   |
| 07 | pre4c1_concurrency_hardening_gate.js       |         15 |    1.99s | PASS   |
| 08 | pre4b4_idempotency_crash_recovery_gate.js  |         11 |    1.73s | PASS   |
| 09 | part4b4_buyer_reservation_gate.js          |         28 |    2.87s | PASS   |
| 10 | part4b4_1_reservation_hardening_gate.js    |         18 |    3.05s | PASS   |
| 11 | part4b4_2_observations_integrity_gate.js   |         20 |    3.25s | PASS   |
| 12 | part4c1_reservation_mutations_gate.js      |         56 |    5.67s | PASS   |
| 13 | part4c2a_progress_pricing_gate.js          |         28 |    2.75s | PASS   |
| 14 | part4c2b_events_visibility_gate.js         |         30 |    1.92s | PASS   |
| 15 | part4c2_combined_integration_gate.js       |         28 |    1.77s | PASS   |
| 16 | part4c3_lifecycle_expiry_gate.js           |         28 |    3.39s | PASS   |
| 17 | part4c3_1_scheduler_safety_gate.js         |         12 |    2.82s | PASS   |
| 18 | part4d1_commercial_foundation_gate.js      |         34 |    3.03s | PASS   |
| 19 | part4d2_pool_qualification_gate.js         |         30 |    3.43s | PASS   |
| 20 | part4d2_1_security_integrity_gate.js       |         22 |    1.55s | PASS   |
| 21 | part4d3_supplier_decision_gate.js          |         22 |    2.24s | PASS   |
| 22 | part4d4_buyer_commitment_gate.js           |         21 |    2.75s | PASS   |
| 23 | part4e1_order_foundation_gate.js           |         23 |    1.74s | PASS   |
| 24 | part4e1_1_financial_hardening_gate.js      |         22 |    1.48s | PASS   |
| 25 | part4e2_order_conversion_gate.js           |         22 |    1.49s | PASS   |
| 26 | part4e3_safepay_sandbox_payment_gate.js    |         28 |    1.28s | PASS   |
================================================================================
Total Platform Assertions Verified: 604 / 604
Overall Platform Verdict:           ✅ 100% PASS
```

#### C. Database Isolation
* `miljor_db` is **100% PRISTINE** (2 pools, 0 reservations, 0 orders, 0 attempts, 0 payments).
* Zero cross-environment leakage.
