# MILJOR — SECURE WEBHOOK-ONLY TUNNEL SETUP REPORT
## Restricted Reverse Proxy & Cloudflare Quick Tunnel Verification

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace  
**Phase:** Part 4E.3.2 — Webhook-Only Public Tunnel Gateway  
**Date:** October 19, 2026  
**Backend Port:** 5000 (`NODE_ENV=test`, `miljor_test_db`, `SAFEPAY_ENV=sandbox`)  
**Gateway Forwarding Port:** 5005 (`127.0.0.1:5005`)  

---

### 1. Tunnel & Gateway Execution Status

```
================================================================================
GATEWAY FORWARDING PORT: 5005 (127.0.0.1:5005)
UPSTREAM APPLICATION:    5000 (127.0.0.1:5000)
ALLOWED ROUTE:           POST /api/v1/payments/webhook/safepay
ALL OTHER ROUTES:        REJECTED (HTTP 404 / 405)
TUNNEL STATUS:           ACTIVE (RUNNING)
PUBLIC HTTPS TUNNEL URL: https://toronto-times-hit-disabilities.trycloudflare.com
COMPLETE WEBHOOK URL:    https://toronto-times-hit-disabilities.trycloudflare.com/api/v1/payments/webhook/safepay
================================================================================
```

---

### 2. Architecture & Forwarding Protection

1. **Restricted Reverse Proxy Gateway:**
   - Source: [`src/services/webhookForwardingProxy.js`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/src/services/webhookForwardingProxy.js)
   - Binds exclusively to local loopback interface `127.0.0.1:5005`.
   - Never exposes backend port 5000 directly to the public tunnel.
   - Enforces strict method and path matching before touching upstream backend:
     - Method must be `POST`. Any `GET`, `PUT`, `DELETE` is rejected with `405 PROXY_METHOD_NOT_ALLOWED`.
     - Path must be `/api/v1/payments/webhook/safepay`. Any request to `/health`, `/api/v1/auth/*`, `/api/v1/admin/*`, etc., is rejected at the proxy with `404 PROXY_ROUTE_FORBIDDEN`.
   - Preserves incoming payload bytes verbatim (`Buffer.concat(chunks)`) and forwards the `X-SFPY-SIGNATURE` header unchanged, ensuring cryptographically accurate HMAC-SHA512 verification.

2. **Cloudflare Quick Tunnel:**
   - Established using installed `cloudflared` binary at `C:\Program Files (x86)\cloudflared\cloudflared.exe`.
   - Command: `cloudflared tunnel --url http://127.0.0.1:5005`.
   - Public HTTPS Hostname: `toronto-times-hit-disabilities.trycloudflare.com`.

---

### 3. Public Verification Test Evidence

All tests were performed over the live public internet using HTTPS requests against `https://toronto-times-hit-disabilities.trycloudflare.com`:

| Test Scenario | Public HTTP Request | Observed Response | Verification Verdict |
| :--- | :--- | :--- | :---: |
| **Unrelated Path Blocked** | `GET /health` | `HTTP 404` (`PROXY_ROUTE_FORBIDDEN`) | **PASS** |
| **Method Not Allowed** | `GET /api/v1/payments/webhook/safepay` | `HTTP 405` (`PROXY_METHOD_NOT_ALLOWED`) | **PASS** |
| **Unrelated API Blocked** | `POST /api/v1/auth/login` | `HTTP 404` (`PROXY_ROUTE_FORBIDDEN`) | **PASS** |
| **Unsigned Webhook Blocked**| `POST /api/v1/payments/webhook/safepay` | `HTTP 401` (`INVALID_WEBHOOK_SIGNATURE`) | **PASS** |
| **Zero Database Mutation** | State Inspection | `miljor_test_db`: 0 events, 0 payments<br>`miljor_db`: 0 orders, 0 payments (100% PRISTINE) | **PASS** |

---

### 4. Manual Actions Required by User in Safepay Sandbox Dashboard

To register the webhook endpoint:

1. **Dashboard Location:**
   Navigate to [Safepay Sandbox Dashboard](https://sandbox.getsafepay.com) → **Developers** → **Endpoints** → **Create a new endpoint**.
2. **Exact Webhook URL to Paste:**
   ```
   https://toronto-times-hit-disabilities.trycloudflare.com/api/v1/payments/webhook/safepay
   ```
3. **Event Subscriptions to Select (Version 2.0.0):**
   - `payment.succeeded`
   - `payment.failed`
4. **Shared Secret:**
   After creating the endpoint, copy the provided Webhook Shared Secret and verify it matches `SAFEPAY_WEBHOOK_SECRET` in `backend/.env`.
