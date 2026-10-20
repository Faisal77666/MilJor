# MILJOR BACKEND — PHASE 0 COMPLETE AUDIT REPORT
**Date:** October 2026  
**Auditor:** Senior Backend Engineer (AI-assisted deep inspection)  
**Status:** AUDIT ONLY — NO CODE CHANGED IN THIS PHASE  

---

## REPOSITORY STRUCTURE

```
backend/
├── .env                          ← REAL SECRETS PRESENT — CRITICAL ISSUE
├── package.json                  ← 8 dependencies, no test runner
├── server.js                     ← Entry point
├── database/
│   └── schema.sql                ← Single flat schema, no migrations
├── docs/
│   ├── MILJOR_AUDIT_REPORT.md    ← Previous audit (INACCURATE — claims COMPLETE on unimplemented features)
│   ├── MILJOR_IMPLEMENTATION_LOG.md
│   └── MILJOR_REQUIREMENTS_MATRIX.md ← INACCURATE — all marked COMPLETE AND VERIFIED
└── src/
    ├── config/
    │   └── db.js                 ← mysql2/promise pool — OK
    ├── controllers/
    │   ├── authController.js     ← register + login only
    │   ├── disputeController.js  ← createDispute + resolveDispute — NOT MOUNTED
    │   ├── paymentController.js  ← uses escrow_payments table (WRONG TABLE)
    │   ├── poolController.js     ← create + list + getById
    │   ├── productController.js  ← basic CRUD
    │   └── reservationController.js ← createReservation + getMyReservations
    ├── middlewares/
    │   ├── authGuard.js          ← protect + authorize + requireVerifiedSupplier
    │   └── idempotencyGuard.js   ← exists but NOT applied to any route
    ├── repositories/
    │   ├── ledgerRepo.js         ← uses payments table (correct) — createLedgerEntry + releaseSupplierPayout
    │   ├── paymentRepo.js        ← uses payments table (correct) — createPayment
    │   ├── poolRepo.js           ← createPool + findAllActive + findById
    │   ├── productRepo.js        ← basic CRUD
    │   ├── reservationRepo.js    ← createReservation with FOR UPDATE + retroactive pricing
    │   └── userRepo.js           ← findByEmail/Phone/Id + create + updateRole
    ├── routes/v1/
    │   ├── auditRoutes.js        ← financial-summary PUBLIC — SECURITY CRITICAL
    │   ├── authRoutes.js         ← register + login + make-me-admin (BROKEN) + /me
    │   ├── paymentRoutes.js      ← POST /initiate + GET /:id
    │   ├── poolRoutes.js         ← GET / + GET /:id + POST / (supplier/admin only)
    │   ├── productRoutes.js      ← basic CRUD
    │   └── reservationRoutes.js  ← POST / + GET /my
    └── services/
        ├── feeService.js         ← calculateBuyerFee + calculateSupplierFee — OK logic
        └── poolClosureService.js ← processExpiredPools — NOT SCHEDULED
```

---

## CRITICAL BUG INVENTORY

### BUG-01: Duplicate Payment Architecture [CRITICAL — BLOCKER]
**Severity:** CRITICAL  
**Files Involved:** `paymentController.js`, `paymentRepo.js`, `disputeController.js`, `poolClosureService.js`, `ledgerRepo.js`, `schema.sql`

**Problem:**  
- `schema.sql` defines BOTH `payments` AND `escrow_payments` tables
- `paymentController.js` line 24-35: Writes to `escrow_payments`
- `paymentRepo.js` line 15-28: Writes to `payments`
- `disputeController.js` line 30, 68: Updates `payments` table
- `poolClosureService.js` line 34-40: Updates `payments` table
- `ledgerRepo.js` line 10-15: References `payments.id` as foreign key

**Result:**  
When a buyer pays via `POST /payments/initiate`, record goes to `escrow_payments`.  
When pool expires and refund runs, it looks in `payments` → finds NOTHING → buyer never gets refund.  
When dispute is created, it locks `payments` → no record exists → payment lock fails silently.

**Fix Required:**  
Eliminate `escrow_payments`. Migrate all logic to single `payments` table.  
Ensure `payments` has all needed fields: `payment_code`, `status`, `escrow_status`, `transaction_ref`, `amount`, etc.

---

### BUG-02: `make-me-admin` Route Points to Non-Existent Method [CRITICAL]
**Severity:** CRITICAL  
**Files:** `authRoutes.js` line 33, `authController.js`

**Problem:**  
Route `GET /api/v1/auth/make-me-admin` calls `authController.makeMeAdmin()`.  
`authController.js` has NO `makeMeAdmin()` method.  
This route will throw a runtime error if hit.  
This is also a dangerous privilege escalation endpoint in any environment.

**Fix Required:**  
Remove the route entirely. It must never exist in production.

---

### BUG-03: Role Injection Security Vulnerability [CRITICAL]
**Severity:** CRITICAL  
**Files:** `authController.js` lines 9, 44

**Problem:**  
`register()` accepts `role` from `req.body` and uses it directly:  
```javascript
role || 'BUYER'
```
A malicious request `{"role": "ADMIN"}` would successfully create an ADMIN account.

**Fix Required:**  
Public registration must ALWAYS create `BUYER`.  
`role` field from request body must be completely ignored/stripped.

---

### BUG-04: `is_verified` Defaults to 1 [CRITICAL — SECURITY]
**Severity:** CRITICAL  
**Files:** `schema.sql` line 31, `userRepo.js` line 31

**Problem:**  
`is_verified TINYINT(1) DEFAULT 1` — every new user is auto-verified.  
`requireVerifiedSupplier` middleware checks `is_verified` — bypassed by default.  
New suppliers can immediately create pools without any actual verification.

**Fix Required:**  
`DEFAULT 0` in schema. `is_verified = 0` in userRepo.create().

---

### BUG-05: Dispute Controller NOT Mounted [HIGH]
**Severity:** HIGH  
**Files:** `auditRoutes.js`, `server.js`, `disputeController.js`

**Problem:**  
`disputeController.js` has `createDispute()` and `resolveDispute()` methods.  
`auditRoutes.js` imports `disputeController` but does NOT mount any dispute routes.  
No dispute routes exist anywhere. `POST /disputes` would return 404.

**Fix Required:**  
Create `disputeRoutes.js`, mount dispute endpoints, register in `server.js`.

---

### BUG-06: Audit Financial Summary Endpoint is PUBLIC [CRITICAL — SECURITY]
**Severity:** CRITICAL  
**Files:** `auditRoutes.js` lines 6-21

**Problem:**  
`GET /api/v1/audit/owner/financial-summary` — no authentication, no authorization.  
Anyone can see total platform revenue, escrow amounts, supplier payouts.  
Comment in code: "Temporary Public Endpoint for Development Validation" — this must NOT reach production.

**Fix Required:**  
Apply `protect + authorize('ADMIN')` middleware.

---

### BUG-07: Idempotency Guard Not Applied to ANY Route [HIGH]
**Severity:** HIGH  
**Files:** `idempotencyGuard.js`, `server.js`, all route files

**Problem:**  
`idempotencyGuard.js` is a well-written middleware.  
It is NEVER imported or applied in `server.js` or any route file.  
Payment initiation, reservation creation have no double-click protection.

**Fix Required:**  
Apply `idempotencyGuard` to: POST /payments/initiate, POST /reservations, POST /disputes, critical order mutations.

---

### BUG-08: `getMe` Method Missing from AuthController [HIGH]
**Severity:** HIGH  
**Files:** `authRoutes.js` line 36, `authController.js`

**Problem:**  
Route `GET /api/v1/auth/me` calls `authController.getMe()`.  
`authController.js` has NO `getMe()` method.  
This route throws a runtime TypeError.

**Fix Required:**  
Implement `getMe()` in `authController.js`.

---

### BUG-09: Pool Lifecycle States Incomplete [HIGH]
**Severity:** HIGH  
**Files:** `schema.sql` line 71, `reservationRepo.js`, `poolClosureService.js`

**Problem:**  
Current pool states: `DRAFT, ACTIVE, TARGET_REACHED, CLOSED, CONFIRMED, FULFILLING, COMPLETED, FAILED, EXPIRED`  
Missing required intermediate states:  
- `AWAITING_SUPPLIER_CONFIRMATION` (after TARGET_REACHED)
- `PAYMENT_PENDING`
- `DISPATCHED`
- `DELIVERED`
- `CANCELLED`
- `SUPPLIER_FAILED`

When `TARGET_REACHED`, no supplier confirmation flow exists.  
Pool jumps directly to `COMPLETED` in closure service without payment.

**Fix Required:**  
Add missing status values, implement supplier confirmation API, payment trigger, state machine validation.

---

### BUG-10: Pool Price Retroactive Update Breaks After Payment [HIGH]
**Severity:** HIGH  
**Files:** `reservationRepo.js` lines 74-82

**Problem:**  
Retroactive price recalculation updates ALL `RESERVED` reservations when a new buyer drops the tier price.  
This correctly updates pre-payment estimates. BUT:  
- There is no concept of a `locked_unit_price` for confirmed/paid orders.  
- Once buyer pays, the `payments` table stores `amount` but the corresponding `reservation` `unit_price` can still be changed.

**Fix Required:**  
Add `locked_unit_price` to reservations or orders. Only recalculate prices for status `RESERVED`, never for `CONFIRMED` or `PAID`.

---

### BUG-11: `paymentController.initiatePayment` Has No Validation Beyond Fields [MEDIUM]
**Severity:** MEDIUM  
**Files:** `paymentController.js`

**Problem:**  
- No check that `reservation_id` actually belongs to the authenticated buyer.
- No check that the reservation is in `RESERVED` status.
- No check that `amount` matches the actual reservation `total_price`.
- No idempotency guard applied.
- Platform fee hardcoded at 2.5% ignoring `feeService.js`.

**Fix Required:**  
Validate reservation ownership, status, and amount. Use `feeService.js` for fee calculation. Apply idempotency.

---

### BUG-12: No `.gitignore` File [CRITICAL — SECURITY]
**Severity:** CRITICAL  

**Problem:**  
No `.gitignore` found in the backend directory.  
`.env` with `DB_PASSWORD`, `JWT_SECRET`, and `GOOGLE_CLIENT_SECRET` could be committed to git.

**Fix Required:**  
Create `.gitignore` excluding `.env`, `node_modules/`, logs, etc.  
Create `.env.example` with placeholder values.

---

### BUG-13: JWT_SECRET Has a Fallback Hardcoded Value [MEDIUM]
**Severity:** MEDIUM  
**Files:** `authRoutes.js` line 17, `paymentRoutes.js` line 17, `authController.js` line 56

**Problem:**  
Multiple files use:  
```javascript
process.env.JWT_SECRET || 'miljor_jwt_secret_key_2026'
```
But `authGuard.js` line 18 uses:
```javascript
jwt.verify(token, process.env.JWT_SECRET)  // No fallback
```
This inconsistency means tokens signed with the fallback key will fail verification in `authGuard.js` if `JWT_SECRET` is not set.

**Fix Required:**  
Centralize JWT signing. Never use hardcoded fallback secrets. Throw hard error if `JWT_SECRET` is missing.

---

### BUG-14: Pool Closure Service Has No Scheduler [MEDIUM]
**Severity:** MEDIUM  
**Files:** `poolClosureService.js`, `server.js`

**Problem:**  
`processExpiredPools()` exists but is never called.  
No cron scheduler (`node-cron`, `setInterval`, etc.) is configured.  
Pools never expire automatically.

**Fix Required:**  
Install and configure `node-cron`. Schedule pool expiry check every 5-15 minutes.

---

### BUG-15: `schema.sql` has Structural Problems [MEDIUM]
**Severity:** MEDIUM  
**Files:** `schema.sql`

**Problems:**
1. `DROP DATABASE IF EXISTS miljor_db` at top — running this accidentally destroys production data
2. `escrow_payments` table defined in the MIDDLE of seed data section (line 352) — not in schema section
3. `DELETE FROM users WHERE email = 'owner@miljor.com'` appears TWICE (lines 328, 331)
4. `USE miljor_db` appears 4 times redundantly
5. Sample pool uses `supplier_id = 1` but no user seed with id=1 exists → FK violation on fresh install
6. `ALTER TABLE users` at the bottom modifies columns after data may already be inserted
7. `TRUNCATE TABLE buyer_fee_slabs` after CREATE but before any data — harmless but confusing

**Fix Required:**  
Rewrite schema as clean sequential migrations. Separate DDL from DML from seed.

---

### BUG-16: Verification Status Inconsistency [MEDIUM]
**Severity:** MEDIUM  
**Files:** `schema.sql` line 29, `authController.js` line 49

**Problem:**  
`authController.register()` sets `verification_status = 'PHONE_VERIFIED'` if phone is provided.  
But the intent is that a new user is NOT verified until actual OTP/workflow completes.  
Schema has `UNVERIFIED` as the correct default.

**Fix Required:**  
Registration should always set `verification_status = 'UNVERIFIED'`. OTP workflows not yet implemented.

---

## FEATURES — HONEST STATUS ASSESSMENT

| Feature | Claimed Status (docs) | Actual Status | Gap |
|---|---|---|---|
| Express server | — | ✅ WORKING | — |
| MySQL pool | — | ✅ WORKING | — |
| JWT login/register | COMPLETE | 🟡 PARTIALLY | getMe missing, role injection, verification default wrong |
| bcrypt hashing | — | ✅ WORKING | — |
| RBAC middleware | COMPLETE | 🟡 PARTIALLY | Roles incomplete (ADMIN only, no SUPER_ADMIN etc), is_verified default broken |
| Product CRUD | — | ✅ WORKING | Basic but functional |
| Regular Pool creation | COMPLETE | 🟡 PARTIALLY | No supplier confirmation, no payment trigger, no price lock, no full lifecycle |
| Pool reservations | COMPLETE | 🟡 PARTIALLY | FOR UPDATE ✅, but retroactive pricing unsafe after payment |
| Pool price tiers | COMPLETE | ✅ WORKING | Logic good |
| Pool expiry automation | COMPLETE | 🔴 BROKEN | Service exists, scheduler missing, uses wrong payments table |
| Flash Pools | COMPLETE | 🔴 MISSING | Schema only, zero APIs |
| RFQ system | COMPLETE | 🔴 MISSING | Schema only, zero APIs |
| Recurring contracts | COMPLETE | 🔴 MISSING | Schema only, zero APIs |
| Payments | COMPLETE | 🔴 BROKEN | Two competing tables, wrong table used, no validation |
| Escrow | COMPLETE | 🔴 BROKEN | Split across two tables inconsistently |
| Ledger | COMPLETE | 🟡 PARTIALLY | Logic correct but references wrong payment source |
| Disputes | COMPLETE | 🔴 BROKEN | Controller exists, ZERO routes mounted |
| Refunds | COMPLETE | 🔴 BROKEN | Only in pool closure (which also uses wrong table) |
| Delivery system | — | 🔴 MISSING | No tables, no APIs |
| Verification/KYC workflow | COMPLETE | 🔴 MISSING | Schema fields only, no document upload, no workflow |
| Google OAuth | BLOCKED | 🔴 NOT IMPLEMENTED | Credentials in .env, zero passport/strategy code |
| Apple OAuth | BLOCKED | 🔴 NOT IMPLEMENTED | — |
| SMS OTP | BLOCKED | 🔴 NOT IMPLEMENTED | — |
| Email system | — | 🔴 NOT IMPLEMENTED | — |
| Password reset | — | 🔴 NOT IMPLEMENTED | — |
| Invoice PDF | — | 🔴 NOT IMPLEMENTED | — |
| Notifications | — | 🔴 NOT IMPLEMENTED | — |
| Idempotency | COMPLETE | 🔴 NOT CONNECTED | Middleware written, never applied |
| Audit logs | COMPLETE | 🟡 PARTIALLY | Table exists, nothing writes to it |
| make-me-admin | — | 🔴 BROKEN | Route calls non-existent method |
| /auth/me | — | 🔴 BROKEN | Route calls non-existent method |
| Audit financial summary | COMPLETE | 🔴 PUBLIC | No auth, security risk |
| Supplier matching | — | 🔴 NOT IMPLEMENTED | — |
| MilJor Assistant | — | 🔴 NOT IMPLEMENTED | — |
| Fraud engine | — | 🔴 NOT IMPLEMENTED | — |
| Collective quotes | — | 🔴 NOT IMPLEMENTED | — |

---

## MISSING DATABASE TABLES (vs Requirements)

Current: 18 tables (including duplicate `escrow_payments`)  
Required for Phase 1-4:

```
orders (exists but not properly used)
order_items (MISSING)
refunds (MISSING)
deliveries (MISSING)
delivery_clusters (MISSING)
delivery_stops (MISSING)
delivery_proofs (MISSING)
reviews (MISSING)
notifications (MISSING)
notification_preferences (MISSING)
subscriptions (MISSING)
subscription_plans (MISSING)
invoices (MISSING)
invoice_items (MISSING)
receipts (MISSING)
returns (MISSING)
return_items (MISSING)
return_events (MISSING)
authentication_identities (MISSING)
sessions (MISSING)
otp_verifications (MISSING)
password_reset_tokens (MISSING)
verification_requests (MISSING)
verification_documents (MISSING)
verification_events (MISSING)
supplier_reliability_metrics (MISSING)
buyer_reliability_metrics (MISSING)
pool_events (MISSING)
rfq_quote_events (MISSING)
recurring_orders (MISSING)
recurring_order_events (MISSING)
collective_quotes (MISSING)
collective_quote_members (MISSING)
collective_quote_offers (MISSING)
addresses (MISSING)
```

---

## DEPENDENCIES STATUS

| Package | Version | Status | Notes |
|---|---|---|---|
| express | ^5.3.0 | ✅ | v5 (stable) |
| mysql2 | ^3.24.5 | ✅ | With promise support |
| bcryptjs | ^3.0.3 | ✅ | bcryptjs (not bcrypt) |
| jsonwebtoken | ^9.0.3 | ✅ | |
| dotenv | ^18.0.7 | ✅ | |
| helmet | ^8.3.0 | ✅ | |
| cors | ^2.8.6 | ✅ | |
| express-rate-limit | ^8.7.1 | ✅ INSTALLED | ❌ NOT USED — not applied to any route |
| node-cron | — | ❌ MISSING | Needed for pool expiry scheduler |
| nodemon | dev | ✅ | |

**Missing packages for full implementation:**
- `node-cron` — pool/flash expiry scheduler
- `joi` or `express-validator` — input validation
- `passport` + `passport-google-oauth20` — Google OAuth (when credentials available)
- `nodemailer` — email (when SMTP credentials available)
- `pdfkit` or `puppeteer` — invoice PDF generation
- `uuid` — better ID generation

---

## SECURITY ISSUES SUMMARY

| Issue | Severity | Fix |
|---|---|---|
| Real DB_PASSWORD in .env | CRITICAL | Create .gitignore, rotate if leaked |
| Real GOOGLE_CLIENT_SECRET in .env | CRITICAL | Rotate immediately if public |
| Role injection via registration | CRITICAL | Strip role from req.body |
| make-me-admin route | CRITICAL | Remove entirely |
| /audit/financial-summary public | CRITICAL | Add auth + ADMIN role |
| is_verified DEFAULT 1 | HIGH | Change to DEFAULT 0 |
| JWT fallback hardcoded secret | MEDIUM | Remove fallback |
| express-rate-limit installed but unused | MEDIUM | Apply to auth endpoints |
| No CORS whitelist (open CORS) | MEDIUM | Configure allowed origins |
| Stack traces in error responses | MEDIUM | Remove error.message from production 500s |

---

## PHASE 0 CONCLUSION

**Realistic Score:** ~3.5/10 toward production-ready MilJor

**Foundation Assessment:**  
- The architecture pattern (controllers/repos/services/routes) is good and worth keeping.  
- The pool reservation with FOR UPDATE is the strongest piece of actual working logic.  
- The fee calculation service is correct in logic.  
- The idempotency middleware code quality is good — just disconnected.

**Primary Blockers Before Any Frontend Integration:**
1. Two payment tables must become one
2. Routes for disputes must be mounted
3. /auth/me and make-me-admin must be fixed
4. Role injection must be eliminated
5. Idempotency must be connected
6. Pool lifecycle must be completed with supplier confirmation

**DO NOT modify business logic in Phase 0.**  
This document is the baseline for Phase 1 execution.
