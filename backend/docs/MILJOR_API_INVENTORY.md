# MilJor Backend — Verified API Inventory

**Date of Audit:** October 18, 2026  
**Baseline Version:** 1.0.0-baseline (Part 2 Security Hardened)  
**Server Mount Point:** Express 5.x on port 5000 (Prefix: `/api/v1`)

---

## 1. Summary of Mounted Routes

Total Endpoints Mounted: **40 endpoints** across 10 route modules (+ 1 root health endpoint).

| Module | Route Prefix | Total Endpoints | Public | Buyer | Supplier | Admin Roles |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Auth** | `/api/v1/auth` | 5 | 2 | 1 (apply) | 0 | 0 (+ 1 logout for all) |
| **Admin Operations** | `/api/v1/admin` | 4 | 0 | 0 | 0 | 4 (Verification/Operations/Super) |
| **Products** | `/api/v1/products` | 3 | 2 | 0 | 1 | 1 |
| **Specifications** | `/api/v1/specifications` | 3 | 3 (search/detail/compare) | 0 | 1 (create) | 1 (create) |
| **Supplier Listings** | `/api/v1/listings` | 7 | 3 (browse/detail/history) | 0 | 4 (my/create/update/status) | 2 (update/status) |
| **Pools** | `/api/v1/pools` | 5 | 2 | 0 | 3 | 3 |
| **Reservations** | `/api/v1/reservations` | 7 | 0 | 6 | 0 | 1 (view) |
| **Orders** | `/api/v1/orders` | 3 | 0 | 3 | 0 | 2 (reconcile, view) |
| **Payments & Webhooks** | `/api/v1/payments` | 6 | 1 (webhook) | 3 | 0 | 2 (finance, view) |
| **Disputes** | `/api/v1/disputes` | 6 | 0 | 3 | 0 | 3 (support, operations) |
| **Audit** | `/api/v1/audit` | 2 | 0 | 0 | 0 | 2 (finance, support) |
| **System** | `/health` | 1 | 1 | 0 | 0 | 0 |

---

## 2. Exhaustive Endpoint Specifications

### 2.1 Authentication & Session (`/api/v1/auth`)
*Applied Middleware:* `authLimiter` (30 requests per 15 minutes per IP; 1,000 in test suite).

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | None (Public) | Anyone | `authController.register` | **FUNCTIONAL & VERIFIED:** Enforces password complexity (min 8 chars, 1 letter, 1 number); strictly forces `BUYER` role; sets `is_verified=0`, `UNVERIFIED`. |
| `POST` | `/api/v1/auth/login` | None (Public) | Anyone | `authController.login` | **FUNCTIONAL & VERIFIED:** Verifies bcrypt hash (12 rounds); returns generic error on failure (anti-enumeration); rejects blocked/suspended users (403); issues standard JWT (`miljor-api`/`miljor-app`). |
| `GET` | `/api/v1/auth/me` | Bearer JWT | Authenticated | `authController.getMe` | **FUNCTIONAL & VERIFIED:** Validates real-time active account status against DB; returns sanitized user object and supplier metadata if applicable. |
| `POST` | `/api/v1/auth/logout` | Bearer JWT | Authenticated | `authController.logout` | **FUNCTIONAL & VERIFIED:** Logs session termination event in `system_audit_logs`. |
| `POST` | `/api/v1/auth/supplier/apply` | Bearer JWT | `BUYER` | `authController.applyForSupplier` | **FUNCTIONAL & VERIFIED:** Sets user to `PENDING_SUPPLIER_VERIFICATION`; creates `supplier_profiles` record in `PENDING_REVIEW`. |

---

### 2.2 Administrative & Verification Operations (`/api/v1/admin`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/admin/suppliers/pending` | Bearer JWT | `VERIFICATION_ADMIN`, `SUPER_ADMIN` | `adminController.getPendingSuppliers` | **FUNCTIONAL & VERIFIED:** Lists pending supplier applications for verification review. |
| `PUT` | `/api/v1/admin/suppliers/:id/verify` | Bearer JWT | `VERIFICATION_ADMIN`, `SUPER_ADMIN` | `adminController.verifySupplier` | **FUNCTIONAL & VERIFIED:** Verifies/rejects supplier; enforces self-approval restriction; sets verification level & subscription plan; writes audit log. |
| `PUT` | `/api/v1/admin/users/:id/suspend` | Bearer JWT | `OPERATIONS_ADMIN`, `SUPER_ADMIN` | `adminController.suspendUser` | **FUNCTIONAL & VERIFIED:** Immediately suspends user (`BLOCKED`/`SUSPENDED`); self-suspension prohibited; writes audit log. |
| `PUT` | `/api/v1/admin/users/:id/reactivate`| Bearer JWT | `SUPER_ADMIN` | `adminController.reactivateUser` | **FUNCTIONAL & VERIFIED:** Reactivates suspended user to `VERIFIED`/`TRUSTED_BUYER`; writes audit log. |

---

### 2.3 Products Catalog (`/api/v1/products`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/products` | None (Public) | All | `productController.getAllProducts` | **FUNCTIONAL & VERIFIED:** Lists active products with category, brand, and text search filtering. |
| `GET` | `/api/v1/products/:id` | None (Public) | All | `productController.getProductById` | **FUNCTIONAL & VERIFIED:** Fetches detailed base product details. |
| `POST` | `/api/v1/products` | Bearer JWT | `SUPPLIER`, `ADMIN`, `SUPER_ADMIN` | `productController.createProduct` | **FUNCTIONAL & VERIFIED:** Creates standard base product. |

---

### 2.4 Exact Product Specifications & Comparison (`/api/v1/specifications`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/specifications` | None (Public) | All | `specController.getAllSpecifications` | **FUNCTIONAL & VERIFIED:** Search & filter normalized specifications by category, brand, variety, grade, pack_size, pack_unit, and text query. |
| `GET` | `/api/v1/specifications/:id` | None (Public) | All | `specController.getSpecificationById` | **FUNCTIONAL & VERIFIED:** Single specification details with base product category and structured attributes. |
| `GET` | `/api/v1/specifications/:id/compare` | None (Public) | All | `specController.compareSupplierListings` | **FUNCTIONAL & VERIFIED:** Multi-supplier comparison: returns all active offers from verified suppliers for this exact specification, sorted by price or lead time. |
| `POST` | `/api/v1/specifications` | Bearer JWT | `SUPER_ADMIN`, `OPERATIONS_ADMIN`, `SUPPLIER` | `specController.createSpecification` | **FUNCTIONAL & VERIFIED:** Creates normalized specification with deterministic SHA256 hashing to prevent duplicate physical specifications (409 Conflict). |

---

### 2.5 Supplier Listings Engine (`/api/v1/listings`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/listings` | None (Public) | All | `listingController.getAllListings` | **FUNCTIONAL & VERIFIED:** Lists all active supplier listings with filtering by spec, category, and text query. |
| `GET` | `/api/v1/listings/me` | Bearer JWT | `SUPPLIER` | `listingController.getMyListings` | **FUNCTIONAL & VERIFIED:** Fetches authenticated supplier's own listings (including paused and active). |
| `GET` | `/api/v1/listings/:id` | None (Public) | All | `listingController.getListingById` | **FUNCTIONAL & VERIFIED:** Complete listing detail with supplier trust metrics and spec data. |
| `GET` | `/api/v1/listings/:id/price-history` | None (Public) | All | `listingController.getListingPriceHistory` | **FUNCTIONAL & VERIFIED:** Returns audit trail of historical price adjustments for the listing. |
| `POST` | `/api/v1/listings` | Bearer JWT | Verified `SUPPLIER` | `listingController.createListing` | **FUNCTIONAL & VERIFIED:** Enforces `requireVerifiedSupplier` (unverified rejected 403); validates positive base price & valid min quantities; enforces single active listing per spec. |
| `PUT` | `/api/v1/listings/:id` | Bearer JWT | Owner `SUPPLIER`, `SUPER_ADMIN` | `listingController.updateListing` | **FUNCTIONAL & VERIFIED:** Strict ownership check (Supplier A cannot edit Supplier B); price updates automatically log to `supplier_listing_price_history`. |
| `PATCH` | `/api/v1/listings/:id/status` | Bearer JWT | Owner `SUPPLIER`, `SUPER_ADMIN` | `listingController.updateListingStatus` | **FUNCTIONAL & VERIFIED:** Toggles listing status (`ACTIVE`, `PAUSED`, `OUT_OF_STOCK`, `ARCHIVED`) with ownership verification. |

---

### 2.4 Regular Group Buying Pools (`/api/v1/pools`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/pools` | None (Public) | All | `poolController.getActivePools` | **FUNCTIONAL & VERIFIED (Part 4C.2A Unified Read Model):** Lists published active pools enriched with authoritative aggregated reservation progress, remaining capacity, dynamic tier pricing, and participation eligibility. Strictly excludes `DRAFT` pools; preserves full backward compatibility with legacy fields (`current_qty`, `fill_percentage`, `remaining_qty`, `is_legacy`). |
| `GET` | `/api/v1/pools/:id` | None (Public) | All | `poolController.getPoolById` | **FUNCTIONAL & VERIFIED (Part 4C.2A Authoritative Snapshot):** Returns single pool details, ordered price tiers, exact specification attributes, supplier verification metrics, and authoritative progress: `eligible_quantity`, `remaining_capacity`, `minimum_remaining`, `target_remaining`, `minimum_reached`, `target_reached`, `capacity_reached`, display-capped progress percentages (0.0% to 100.0%), `estimated_unit_price`, `pricing_mode` (`ESTIMATED_TIER_CONFIRMABLE` vs `ESTIMATED_PRE_MINIMUM`), `is_conditional_pricing`, next discount tier threshold (`next_tier_quantity`, `additional_quantity_for_next_tier`, `next_tier_price`), `can_join: boolean`, `participation_status`, and `participation_reason`. Detects cache drift against `pools.current_qty` without mutating GET endpoints (OBS-29). |
| `POST` | `/api/v1/pools` | Bearer JWT | `SUPPLIER`, `ADMIN`, `SUPER_ADMIN` | `poolController.createPool` | **FUNCTIONAL & VERIFIED (Part 4B.2/4B.3):** Enforces `requireVerifiedSupplier` (unverified suppliers rejected); validates exact specification and supplier listing linkage; verifies non-overpromising inventory feasibility; enforces indivisible pack units; delivery terms validation; creates pool atomically in `DRAFT` status within a single transaction; protected by `idempotencyGuard.required` (`X-Idempotency-Key` mandatory). |
| `PUT` | `/api/v1/pools/:id` | Bearer JWT | Owner `SUPPLIER`, `ADMIN` | `poolController.updateDraftPool` | **FUNCTIONAL & VERIFIED (Part 4B.3):** Updates commercial terms and price tiers of an existing `DRAFT` pool; strictly rejects updates on `ACTIVE` pools (422 `INVALID_POOL_STATE`). |
| `POST` | `/api/v1/pools/:id/publish` | Bearer JWT | Owner `SUPPLIER`, `ADMIN` | `poolController.publishPool` | **FUNCTIONAL & VERIFIED (Part 4B.3):** Validates tier completeness; locks listing row `FOR UPDATE`; commits stock allocation in `supplier_inventory_allocations` (`COMMITTED`); transitions status from `DRAFT` to `ACTIVE`; protected by `idempotencyGuard.required`. |
| `GET` | `/api/v1/pools/supplier/my` | Bearer JWT | `SUPPLIER`, `ADMIN`, `SUPER_ADMIN` | `poolController.getMyPools` | **FUNCTIONAL & VERIFIED:** Lists pools belonging to authenticated supplier (including `DRAFT` and `ACTIVE`). |
| `GET` | `/api/v1/pools/:id/supplier/summary` | Bearer JWT | Owner `SUPPLIER`, `ADMIN`, `SUPER_ADMIN` | `poolController.getSupplierReservationSummary` | **FUNCTIONAL & VERIFIED (Part 4C.2B):** Returns privacy-safe aggregate demand summary for the pool (total reserved quantity, active count, status counts breakdown, progress toward supplier minimum and target, current estimated tier price). Restricts access strictly to the owning verified supplier or platform admin (403 FORBIDDEN for other suppliers). Strictly omits buyer PII. |
| `GET` | `/api/v1/pools/:id/reservations/summary` | Bearer JWT | Owner `SUPPLIER`, `ADMIN`, `SUPER_ADMIN` | `poolController.getSupplierReservationSummary` | **FUNCTIONAL & VERIFIED (Part 4C.2B):** Alias route for `getSupplierReservationSummary`. |
| `POST` | `/api/v1/pools/:id/qualify` | Bearer JWT | Owner `SUPPLIER`, `ADMIN`, `SUPER_ADMIN` | `poolController.qualifyPool` | **FUNCTIONAL & VERIFIED (Part 4D.2 / OBS-47–51):** Production-grade commercial qualification engine. Evaluates pool upon deadline expiration cutoff (`expires_at <= NOW()`); parent-pool-first `FOR UPDATE` lock; strictly enforces pure qualification logic against `supplier_min_qty` (not `target_qty`); advances qualified pools to `AWAITING_SUPPLIER_CONFIRMATION` or unqualified to `EXPIRED`; creates immutable commercial snapshot in `pool_commercial_snapshots`; enforces database-level active decision uniqueness via `uq_snapshot_authoritative_decision`; preserves committed inventory allocation without release; emits durable `POOL_QUALIFIED` or `POOL_UNQUALIFIED` business event and writes to `system_audit_logs`; protected by `idempotencyGuard.required` (`X-Idempotency-Key` mandatory) with crash-recovery replay. |
| `POST` | `/api/v1/pools/:id/supplier-decision` | Bearer JWT | Owner `SUPPLIER` only (Strict) | `poolController.recordSupplierDecision` | **FUNCTIONAL & VERIFIED (Part 4D.3 / OBS-65–67):** Authoritative commercial decision engine. Verified owner supplier accepts or rejects qualified offer (`ACCEPT`/`REJECT`); enforced by `authorizeStrict('SUPPLIER')` (zero admin impersonation/override permitted); live KYC verification; parent-pool-first `FOR UPDATE` locking; post-lock DB server deadline evaluation (`NOW() <= supplier_confirmation_deadline`); snapshot integrity validation; persists immutable evidence in `pool_supplier_commercial_decisions` (`uq_supplier_decisions_snapshot`); transitions pool state (`CONFIRMED` on ACCEPT, `SUPPLIER_FAILED` on REJECT); preserves committed inventory allocations; emits durable `SUPPLIER_OFFER_ACCEPTED` or `SUPPLIER_OFFER_REJECTED` in outbox; protected by `idempotencyGuard.required` with crash-recovery reconciliation. |
| `GET` | `/api/v1/pools/:id/supplier-decision` | Bearer JWT | Owner `SUPPLIER`, Participating `BUYER`, `ADMIN` | `poolController.getSupplierDecisionStatus` | **FUNCTIONAL & VERIFIED (Part 4D.3 Read Model):** Authoritative decision status read model. Returns commercial outcome, agreed price/qty, decision timestamp, and supplier confirmation notes. Strict tenancy and role isolation: competitor suppliers blocked (403); zero buyer PII leaked. |
| `GET` | `/api/v1/pools/:id/committed-demand-summary` | Bearer JWT | Owner `SUPPLIER`, Participating `BUYER`, `ADMIN` | `poolController.getCommittedDemandSummary` | **FUNCTIONAL & VERIFIED (Part 4D.4 Read Model):** Transparent post-qualification committed demand accounting. Aggregates original qualified demand, confirmed buyer-accepted demand, buyer-declined demand, pending buyer demand, and evaluates supplier minimum volume threshold status without retroactive pricing changes. Strictly isolates buyer privacy (zero buyer identities/PII). |
| `PUT` | `/api/v1/pools/:id/confirm` | Bearer JWT | `SUPPLIER`, `ADMIN`, `SUPER_ADMIN` | `poolController.confirmPool` | **PERMANENTLY RETIRED (OBS-59 / HTTP 410 LEGACY_OPERATION_RETIRED):** Legacy confirmation endpoint is retired and blocked fail-closed for all actors including admin. Modern commercial confirmation belongs strictly to Part 4D.3. Zero database mutations. |
| `PUT` | `/api/v1/pools/:id/cancel` | Bearer JWT | Owner `SUPPLIER`, `ADMIN`, `SUPER_ADMIN` | `poolController.cancelPool` | **FUNCTIONAL & HARDENED (OBS-60 / OBS-65):** Supplier cancels unreserved/draft pool; safely handles missing request body; blocks cancellation of pools with active buyer reservations (`RESERVED_POOL_CANCELLATION_BLOCKED` or `PROTECTED_POOL_CANCELLATION_BLOCKED` with HTTP 422); strictly blocks cancellation of pools with commercial qualification snapshots or pools in `AWAITING_SUPPLIER_CONFIRMATION` / downstream states; zero admin bypass; releases inventory allocation (`RELEASED`) on safe cancellations; strictly blocks non-owner suppliers (403). |

---

### 2.5 Reservations (`/api/v1/reservations`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/reservations` | Bearer JWT | `BUYER` only | `reservationController.createReservation` | **FUNCTIONAL & VERIFIED (Part 4B.4):** Atomic reservation creation. Row-level `FOR UPDATE` capacity locking, dynamic tier repricing with retroactive adjustments on active `RESERVED` items, anti-self-dealing check, duplicate reservation guard (fail-closed, one active reservation per buyer), discrete pack validation, mandatory `X-Idempotency-Key` with crash-recovery reconciliation, and rich transparent B2B response payload. |
| `PATCH` | `/api/v1/reservations/:id` | Bearer JWT | Owner `BUYER` only | `reservationController.updateReservationQuantity` | **FUNCTIONAL & VERIFIED (Part 4C.1 / OBS-32):** Atomic quantity modification (increase, decrease, or no-op). Enforces parent-pool-first `FOR UPDATE` locking, buyer ownership, active non-expired pool, unlocked price checks, discrete packaging, buyer min quantity, purchase increments, exact 4-decimal optimistic concurrency via `If-Match-Quantity` (412 / OBS-32), capacity limits (409), bidirectional dynamic tier repricing, immutable audit tracking via `reservation_mutation_history`, durable business events in `reservation_business_events`, and mandatory `X-Idempotency-Key`. |
| `POST` | `/api/v1/reservations/:id/cancel` | Bearer JWT | Owner `BUYER` only | `reservationController.cancelReservation` | **FUNCTIONAL & VERIFIED (Part 4C.1):** RESTful reservation cancellation. Parent-first locking, transitions status to `CANCELLED`, restores reserved quantity to pool, dynamically recalculates and reprices remaining uncommitted active buyers, records snapshot in `reservation_mutation_history`, durable event in `reservation_business_events`, and enforces mandatory `X-Idempotency-Key`. |
| `PUT` | `/api/v1/reservations/:id/cancel` | Bearer JWT | Owner `BUYER` only | `reservationController.cancelReservation` | **FUNCTIONAL & VERIFIED (OBS-26):** Backward-compatible legacy cancellation route. Reuses the exact same authoritative handler and middleware as `POST /:id/cancel`, requiring mandatory `X-Idempotency-Key`. |
| `GET` | `/api/v1/reservations/my` | Bearer JWT | `BUYER` | `reservationController.getMyReservations` | **FUNCTIONAL & VERIFIED (Part 4C.2B):** Lists reservations for authenticated buyer enriched with normalized product specification attributes, verified supplier details, flattened pool progress, pricing conditionality, and action permissions (`can_modify`, `can_cancel`). |
| `GET` | `/api/v1/reservations/:id` | Bearer JWT | Owner `BUYER` or Admin | `reservationController.getReservationById` | **FUNCTIONAL & VERIFIED (Part 4C.2B):** Enforces object-level ownership check (Buyer 2 cannot view Buyer 1 reservation). Returns single reservation enriched with specification attributes, verified supplier details, flattened pool progress, pricing conditionality, and action permissions (`can_modify`, `can_cancel`). Strictly zero exposure of other buyers' private data. |
| `GET` | `/api/v1/reservations/:id/final-offer` | Bearer JWT | Owner `BUYER` only | `reservationController.getBuyerCommercialOffer` | **FUNCTIONAL & VERIFIED (Part 4D.4 Read Model):** Personalized buyer commercial offer read model. Returns final locked unit price, committed quantity, agreed total, payment terms, delivery parameters, and authoritative DB deadline status. Strict tenancy isolation: other buyers and suppliers blocked (403); zero peer buyer PII exposed. |
| `POST` | `/api/v1/reservations/:id/final-decision` | Bearer JWT | Owner `BUYER` only (Strict) | `reservationController.recordBuyerDecision` | **FUNCTIONAL & VERIFIED (Part 4D.4 / OBS-68–70):** Authoritative buyer commercial commitment engine. Verified participating buyer explicitly accepts or declines offer (`ACCEPT`/`DECLINE`); enforced by `authorizeStrict('BUYER')` (zero admin/supplier impersonation permitted); parent-pool-first `FOR UPDATE` locking; post-lock DB server deadline evaluation (`NOW() <= buyer_commitment_deadline`); locks unit and total price permanently on `ACCEPT` (`status = 'CONFIRMED'`, `locked_unit_price`); marks `CANCELLED` on `DECLINE`; preserves inventory allocations; records immutable audit row in `pool_buyer_commercial_decisions` (`uq_buyer_decisions_reservation_snapshot`); emits durable transactional business events (`BUYER_OFFER_ACCEPTED`, `BUYER_OFFER_DECLINED`); protected by `idempotencyGuard.required` with crash-recovery reconciliation. |
| `GET` | `/api/v1/reservations/:id/order-readiness` | Bearer JWT | Owner `BUYER` only (Strict) | `reservationController.getOrderReadiness` | **FUNCTIONAL & VERIFIED (Part 4E.1 / OBS-71–74):** Authoritative order readiness evaluation read model. Reconciles 15 distinct commercial and financial criteria: verified regular pool, qualification snapshot, supplier ACCEPT, buyer immutable ACCEPT, exact spec match, discrete packaging, price lock integrity, quorum verification against `supplier_min_qty`, and exactly-once order check. Exposes structured financial breakdown separating locked merchandise subtotal from pending delivery/platform fees. Fails closed on demand shortfall, missing evidence, or suspended account. Zero order/payment writes. |
| `POST` | `/api/v1/reservations/:id/order` | Bearer JWT | Owner `BUYER` only (Strict) | `reservationController.createOrder` | **FUNCTIONAL & VERIFIED (Part 4E.2 / OBS-79–80):** Authoritative order conversion workflow. Converts a validated buyer ACCEPT commercial commitment into exactly one persisted order row in `orders` table in initial `AWAITING_PAYMENT` state before any payment checkout. Enforces parent-pool-first `FOR UPDATE` locking, live trust verification, exact BigInt decimal financial arithmetic via `exactDecimal.js` (merchandise subtotal + delivery fee + platform fee), database unique constraint `uq_orders_buyer_decision`, crash-safe idempotency replay, and transactional outbox business event `ORDER_CREATED`. Fails closed (`PAYABLE_COMPONENTS_UNRESOLVED`) if delivery or platform fee policies are indeterminate. Strict zero Safepay or payment mutations. |
| `PUT` | `/api/v1/reservations/:id/confirm` | Bearer JWT | `BUYER` | `reservationController.confirmReservation` | **FUNCTIONAL & VERIFIED:** Locks unit and total price permanently; transitions to `CONFIRMED`. |

#### `POST /api/v1/reservations` Request & Response Specification

**Headers:**
- `Authorization: Bearer <jwt_token>` (Mandatory, role must be `BUYER`, trust status must not be `SUSPENDED`)
- `X-Idempotency-Key: <unique_string>` (Mandatory, 400 if missing, 409 if reused with conflicting payload)

**Request Body:**
```json
{
  "pool_id": 12,
  "quantity": 10
}
```

**Response Body (201 Created):**
```json
{
  "success": true,
  "message": "Quantity reserved successfully in pool",
  "data": {
    "reservation": {
      "id": 42,
      "reservation_code": "MJ-RES-789012",
      "pool_id": 12,
      "pool_code": "MJ-POOL-0012",
      "buyer_id": 5,
      "quantity": 10,
      "unit_price": 5200.00,
      "total_price": 52000.00,
      "status": "RESERVED",
      "created_at": "2026-10-18T15:10:00.000Z"
    },
    "pool": {
      "id": 12,
      "pool_code": "MJ-POOL-0012",
      "status": "ACTIVE",
      "pool_unit": "bag",
      "expires_at": "2026-10-25T15:00:00.000Z",
      "cancellation_terms": "Buyer cancellation permitted while pool is open (RESERVED state). Once pool qualifies and supplier confirms, commitment and price lock apply."
    },
    "specification": {
      "id": 1,
      "product_title": "Chakki Atta (Whole Wheat Flour)",
      "category": "Flour & Grains",
      "quality_grade": "Grade-A Standard",
      "canonical_spec_hash": "a1b2c3d4..."
    },
    "supplier": {
      "id": 2,
      "business_name": "Tariq Flour Mills Lahore",
      "verification_status": "VERIFIED"
    },
    "aggregate_progress": {
      "current_aggregate_qty": 10,
      "remaining_pool_capacity": 40,
      "supplier_min_qty": 10,
      "target_qty": 25,
      "max_capacity": 50,
      "progress_toward_supplier_min_pct": 100.0,
      "progress_toward_target_pct": 40.0,
      "supplier_min_met": true,
      "target_met": false
    },
    "pricing": {
      "estimated_unit_price": 5200.00,
      "estimated_subtotal": 52000.00,
      "pricing_mode": "ESTIMATED_TIER_CONFIRMABLE",
      "current_tier_index": 0,
      "next_tier": {
        "min_qty": 25,
        "max_qty": 50,
        "price_per_unit": 4900.00,
        "additional_qty_needed": 15
      }
    }
  }
}
```

**Standard Error Codes:**
- `400 INVALID_INPUT`: `pool_id` is missing.
- `400 INVALID_QUANTITY`: `quantity` is not a positive number.
- `400 BUYER_MIN_QTY_NOT_MET`: `quantity` is below `pool.buyer_min_qty`.
- `400 INVALID_PURCHASE_INCREMENT`: `quantity` does not conform to `pool.purchase_increment`.
- `400 FRACTIONAL_PACK_REJECTED`: Fractional quantity submitted for discrete pack unit (e.g. `bag`).
- `400 MISSING_IDEMPOTENCY_KEY`: Request header omitted `X-Idempotency-Key`.
- `401 UNAUTHORIZED`: Authentication token is missing or invalid.
- `403 FORBIDDEN`: Caller role is not `BUYER` (e.g. `SUPPLIER` or `ADMIN`).
- `403 ACCOUNT_SUSPENDED`: Authenticated buyer's `buyer_trust_status` is `SUSPENDED`.
- `403 SELF_PURCHASE_PROHIBITED`: Buyer is the pool's own supplier.
- `404 POOL_NOT_FOUND`: Target pool does not exist.
- `409 CAPACITY_EXCEEDED`: Requested quantity exceeds available remaining capacity (`max_capacity - aggregate_qty`).
- `409 ACTIVE_RESERVATION_EXISTS`: Buyer already holds an active reservation in this pool (`RESERVED`, `CONFIRMED`, `PAID`, or non-terminal state). Response includes `existing_reservation` object with id, reservation_code, quantity, unit_price, status, and created_at.
- `409 IDEMPOTENCY_PAYLOAD_CONFLICT`: Reused idempotency key with conflicting payload.
- `409 IDEMPOTENCY_OUTCOME_UNKNOWN`: Previous operation terminated in an indeterminate state requiring reconciliation.
- `422 POOL_NOT_ACTIVE`: Pool is in `DRAFT`, `CANCELLED`, or other non-ACTIVE status.
- `422 POOL_EXPIRED`: Pool deadline has expired according to authoritative DB server `NOW()` evaluated in UTC (`expires_at <= NOW()`).
- `422 SUPPLIER_INELIGIBLE`: Pool supplier does not satisfy affirmative verification requirements (`role = 'SUPPLIER'`, `is_verified = 1`, user `verification_status = 'VERIFIED'`, supplier_profile `verification_status = 'VERIFIED'`).
- `422 LISTING_INACTIVE`: Underlying supplier listing is currently paused, archived, or inactive.
- `422 SPECIFICATION_MISMATCH`: Pool specification identity or supplier does not match the underlying listing.
- `422 LEGACY_POOL_READ_ONLY`: Historical legacy pool (pool 1 or 2) lacks exact specification or supplier listing identities and is read-only for new commercial reservations.

#### `PATCH /api/v1/reservations/:id` Request & Response Specification

**Headers:**
- `Authorization: Bearer <jwt_token>` (Mandatory, role must be `BUYER`, trust status must not be `SUSPENDED`)
- `X-Idempotency-Key: <unique_string>` (Mandatory)
- `If-Match-Quantity: <integer_or_decimal>` (Optional, optimistic concurrency guard against stale client views)

**Request Body:**
```json
{
  "quantity": 15
}
```

**Response Body (200 OK):**
```json
{
  "success": true,
  "message": "Reservation quantity updated successfully",
  "data": {
    "reservation": {
      "id": 42,
      "reservation_code": "MJ-RES-789012",
      "pool_id": 12,
      "pool_code": "MJ-POOL-0012",
      "buyer_id": 5,
      "old_quantity": 10,
      "quantity": 15,
      "unit_price": 4900.00,
      "total_price": 73500.00,
      "status": "RESERVED",
      "created_at": "2026-10-18T15:10:00.000Z",
      "updated_at": "2026-10-18T15:25:00.000Z"
    },
    "pool": {
      "id": 12,
      "pool_code": "MJ-POOL-0012",
      "status": "ACTIVE",
      "pool_unit": "bag",
      "expires_at": "2026-10-25T15:00:00.000Z",
      "cancellation_terms": "Buyer modification and cancellation permitted while pool is open (RESERVED state)."
    },
    "specification": {
      "id": 1,
      "product_title": "Chakki Atta (Whole Wheat Flour)",
      "category": "Flour & Grains",
      "quality_grade": "Grade-A Standard",
      "canonical_spec_hash": "a1b2c3d4..."
    },
    "supplier": {
      "id": 2,
      "business_name": "Tariq Flour Mills Lahore",
      "verification_status": "VERIFIED"
    },
    "aggregate_progress": {
      "current_aggregate_qty": 15,
      "remaining_pool_capacity": 35,
      "supplier_min_qty": 10,
      "target_qty": 25,
      "max_capacity": 50,
      "progress_toward_supplier_min_pct": 100.0,
      "progress_toward_target_pct": 60.0,
      "supplier_min_met": true,
      "target_met": false
    },
    "pricing": {
      "estimated_unit_price": 4900.00,
      "estimated_subtotal": 73500.00,
      "pricing_mode": "ESTIMATED_TIER_CONFIRMABLE",
      "current_tier_index": 1,
      "next_tier": null
    }
  }
}
```

**Standard Error Codes:**
- `400 INVALID_QUANTITY`: Quantity is not a positive number.
- `400 BUYER_MIN_QTY_NOT_MET`: Decreased quantity falls below `pool.buyer_min_qty`.
- `400 INVALID_PURCHASE_INCREMENT`: Quantity violates `pool.purchase_increment`.
- `400 FRACTIONAL_PACK_REJECTED`: Fractional quantity submitted for discrete pack unit.
- `400 IDEMPOTENCY_KEY_REQUIRED`: Request header omitted `X-Idempotency-Key`.
- `401 UNAUTHORIZED`: Authentication missing or expired.
- `403 FORBIDDEN`: Caller is not a `BUYER` or does not own the target reservation.
- `403 ACCOUNT_SUSPENDED`: Buyer account is suspended.
- `404 RESERVATION_NOT_FOUND`: Target reservation does not exist.
- `409 CAPACITY_EXCEEDED`: Increased quantity exceeds remaining pool capacity.
- `412 PRECONDITION_FAILED`: Stale update detected (`If-Match-Quantity` does not match current database quantity).
- `422 RESERVATION_NOT_EDITABLE`: Reservation is not in `RESERVED` status, or price has been locked (`locked_unit_price IS NOT NULL`).
- `422 POOL_NOT_ACTIVE`: Pool is in `DRAFT`, `CANCELLED`, or non-ACTIVE status.
- `422 POOL_EXPIRED`: Pool deadline has passed according to DB `NOW()`.
- `422 LEGACY_POOL_READ_ONLY`: Historical pool without product specification is read-only.

#### `POST /api/v1/reservations/:id/cancel` (and `PUT /:id/cancel`) Specification

**Headers:**
- `Authorization: Bearer <jwt_token>` (Mandatory, role must be `BUYER`)
- `X-Idempotency-Key: <unique_string>` (Mandatory)

**Response Body (200 OK):**
```json
{
  "success": true,
  "message": "Reservation cancelled successfully. Your reserved quantity has been returned to the pool.",
  "data": {
    "reservation": {
      "id": 42,
      "reservation_code": "MJ-RES-789012",
      "pool_id": 12,
      "pool_code": "MJ-POOL-0012",
      "buyer_id": 5,
      "previous_quantity": 15,
      "status": "CANCELLED",
      "cancelled_at": "2026-10-18T15:30:00.000Z"
    },
    "pool": {
      "id": 12,
      "pool_code": "MJ-POOL-0012",
      "status": "ACTIVE",
      "pool_unit": "bag",
      "current_aggregate_qty": 0,
      "remaining_capacity": 50
    }
  }
}
```

**Standard Error Codes:**
- `400 IDEMPOTENCY_KEY_REQUIRED`: Request header omitted `X-Idempotency-Key`.
- `401 UNAUTHORIZED`: Authentication missing or expired.
- `403 FORBIDDEN`: Caller is not a `BUYER` or does not own the target reservation.
- `404 RESERVATION_NOT_FOUND`: Target reservation does not exist.
- `422 RESERVATION_NOT_CANCELLABLE`: Reservation is not in `RESERVED` status or price has already been locked.
- `422 POOL_NOT_ACTIVE`: Pool is not in `ACTIVE` status.
- `422 POOL_EXPIRED`: Pool deadline has expired.

---

### 2.6 Payments & Escrow (`/api/v1/payments`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/payments/initiate` | Bearer JWT | `BUYER` | `paymentController.initiatePayment` | **FUNCTIONAL (MOCK MODE):** Validates reservation ownership and `CONFIRMED` status; calculates slab fee; writes `payments` in `PENDING`. |
| `POST` | `/api/v1/payments/verify` | Bearer JWT | `BUYER` | `paymentController.verifyPayment` | **FUNCTIONAL (MOCK MODE):** Server-side verification via `paymentProviderService`; marks payment & reservation `PAID`; posts to `platform_ledger`. |
| `POST` | `/api/v1/payments/webhook/safepay` | None (Public) | External Provider | `paymentController.handleSafepayWebhook` | **FUNCTIONAL & VERIFIED (Part 4E.3):** Safepay sandbox webhook listener; verifies cryptographic HMAC-SHA256 signature; confirms order payment to `PAID`; updates attempt to `COMPLETED`; writes authoritative `payments` row (`HELD_IN_ESCROW`); emits transactional outbox `ORDER_PAID` event. Aliased at `/api/v1/webhooks/safepay`. |
| `GET` | `/api/v1/payments/my` | Bearer JWT | `BUYER` | `paymentController.getMyPayments` | **FUNCTIONAL & VERIFIED:** Lists payment history for authenticated buyer. |
| `GET` | `/api/v1/payments/:id` | Bearer JWT | Owner `BUYER` or Admin | `paymentController.getPaymentStatus` | **FUNCTIONAL & VERIFIED:** Enforces object-level ownership check (Buyer 2 cannot view Buyer 1 payment). |
| `POST` | `/api/v1/payments/:id/refund` | Bearer JWT | `FINANCE_ADMIN`, `SUPER_ADMIN` | `paymentController.initiateRefund` | **FUNCTIONAL (MOCK MODE):** Enforces least privilege (Finance / Super Admin only); sets status `REFUNDED`. |

---

### 2.7 Authoritative Orders & Checkout (`/api/v1/orders`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/orders/:id/checkout` | Bearer JWT | `BUYER` | `orderController.initiateCheckout` | **FUNCTIONAL & VERIFIED (Part 4E.3):** Initiates Safepay sandbox checkout session for an `AWAITING_PAYMENT` order; enforces mandatory `X-Idempotency-Key`; ignores client amount tampering; calls Safepay outside DB locks; records `payment_attempts` (`INITIATED`); updates order `payment_status = 'PAYMENT_INITIATED'`; returns hosted checkout URL. |
| `GET` | `/api/v1/orders/:id/payment-status` | Bearer JWT | Owner `BUYER` or Admin | `orderController.getPaymentStatus` | **FUNCTIONAL & VERIFIED (Part 4E.3):** Authoritative read model for order payment lifecycle; enforces tenant isolation; reports payment status, order status, total payable amount, lifecycle phase, and latest attempt metadata. |
| `POST` | `/api/v1/orders/:id/reconcile` | Bearer JWT | Owner `BUYER` or Admin | `orderController.reconcilePayment` | **FUNCTIONAL & VERIFIED (Part 4E.3.6):** Authoritatively reconciles order payment state with Safepay provider; queries GET /order/v1/:tracker outside DB locks; validates cryptographic transaction signature and exact amounts; transactionally updates payment attempt to `COMPLETED`, order to `PAID`, inserts authoritative `payments` record (`HELD_IN_ESCROW`), logs `payment_webhook_events` (`PROCESSED`), and emits outbox `ORDER_PAID` event. Fully idempotent. |

---

### 2.7 Order Disputes (`/api/v1/disputes`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/disputes` | Bearer JWT | `BUYER` | `disputeController.createDispute` | **FUNCTIONAL & VERIFIED:** Files dispute; freezes payment in escrow (`DISPUTED`). |
| `GET` | `/api/v1/disputes/my` | Bearer JWT | `BUYER` | `disputeController.getMyDisputes` | **FUNCTIONAL & VERIFIED:** Lists disputes belonging to authenticated buyer. |
| `GET` | `/api/v1/disputes/:id` | Bearer JWT | Owner `BUYER` or Admin | `disputeController.getDisputeById` | **FUNCTIONAL & VERIFIED:** Enforces object-level ownership. |
| `GET` | `/api/v1/disputes` | Bearer JWT | `SUPPORT_ADMIN`, `OPERATIONS_ADMIN`, `SUPER_ADMIN` | `disputeController.getAllDisputes` | **FUNCTIONAL & VERIFIED:** Lists all system disputes for administrative arbitration. |
| `PUT` | `/api/v1/disputes/:id/resolve` | Bearer JWT | `OPERATIONS_ADMIN`, `SUPER_ADMIN` | `disputeController.resolveDispute` | **FUNCTIONAL & VERIFIED:** Arbitrates dispute with full/partial refund options. |
| `PUT` | `/api/v1/disputes/:id/request-evidence`| Bearer JWT | `OPERATIONS_ADMIN`, `SUPER_ADMIN` | `disputeController.requestEvidence` | **FUNCTIONAL & VERIFIED:** Moves dispute to `EVIDENCE_REQUESTED`. |

---

### 2.8 Platform Financial Audit (`/api/v1/audit`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/audit/owner/financial-summary` | Bearer JWT | `FINANCE_ADMIN`, `SUPER_ADMIN` | Inline / `ledgerRepo` | **FUNCTIONAL & VERIFIED:** Enforces least privilege (Finance / Super Admin only). |
| `GET` | `/api/v1/audit/logs` | Bearer JWT | `SUPPORT_ADMIN`, `OPERATIONS_ADMIN`, `SUPER_ADMIN` | Inline | **FUNCTIONAL & VERIFIED:** Paginated query over `system_audit_logs`. |

---

### 2.9 System Health (`/health`)

| Method | Endpoint | Auth Required | Roles Permitted | Controller Method | Status / Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | None (Public) | All | Inline in `server.js` | **FUNCTIONAL & VERIFIED:** Returns health status and server timestamp. |
