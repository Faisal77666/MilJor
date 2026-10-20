# MILJOR — BUSINESS INVARIANTS REGISTRY
## Canonical Single Source of Truth for Domain Rules & Safety Invariants

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace.  
**Authority:** Principal Software Architect, Concurrency Specialist, Security & Financial Integrity Lead.  
**Version:** 1.0 (Authored under Protocol v2.0).  
**Scope:** Universal across all backend, database, testing, and operational phases.

---

## 1. Product Identity & Indivisible Packaging

1. **Four-Way Product Linkage:**
   ```
   Product (Catalog) -> Product Specification (Standardized) -> Supplier Listing (Inventory Anchor) -> Verified Supplier
   ```
2. **Indivisible Packaging Rules:**
   - Units such as `bag`, `tin`, `carton`, `sack` are strictly indivisible discrete integers.
   - No fractional quantities are permitted for discrete packaging units (`step_size = 1.00`, integer validation enforced).
   - Loose commodities (`kg`, `litre`) conform strictly to defined increment constraints (`step_size`).

---

## 2. Supplier Listing & Affirmative Verification

1. **Three-Way Affirmative Verification Invariant:**
   - A supplier cannot create, list, or confirm a pool unless:
     1. User account has `role = 'SUPPLIER'`.
     2. User record has `is_verified = 1`.
     3. Supplier profile has `verification_status = 'VERIFIED'`.
   - Any check failing closed aborts operation with `403 FORBIDDEN` or unlisted eligibility.

---

## 3. Supplier Committed Inventory & Capacity Accounting

1. **Dedicated Pool Allocation:**
   - When an active Regular Pool is published, `pools.max_capacity` represents the committed supplier inventory ceiling.
   - Individual buyer reservations consume internal pool ceiling; they **do not** double-allocate or mutate supplier inventory tables during the reservation collection phase.
2. **Supplier Inventory Invariant:**
   ```
   Sum(Buyer Active Reserved Qty) <= pools.max_capacity <= supplier_listing.available_quantity
   ```
3. **No Over-Subscription:**
   - Aggregate reserved quantity must never exceed `max_capacity`.

---

## 4. Minimum Order Quantities (MOQs)

1. **Dual Independent MOQs:**
   - `buyer_min_qty`: Minimum quantity an individual buyer can reserve in a single reservation. Enforced on reservation create and edit.
   - `supplier_min_qty` (Pool Target / Minimum Demand Threshold): Collective minimum demand required for the pool to commercially qualify (`total_reserved_quantity >= target_qty`).
2. **Independence:**
   - `buyer_min_qty` and `target_qty` operate on separate business boundaries and must never be conflated.

---

## 5. Volume Tier Pricing & Estimations

1. **Contiguous & Non-Overlapping Tiers:**
   - Tier ranges `[min_qty, max_qty]` must form a contiguous, non-overlapping sequence covering from Tier 1 minimum up to `max_capacity`.
2. **Monotonic Non-Increasing Prices:**
   - Higher quantity tiers must have unit prices less than or equal to lower quantity tiers:
     `tier[N].unit_price <= tier[N-1].unit_price`.
3. **Dynamic Estimated Pricing vs. Immutable Locked Pricing:**
   - In `RESERVED` status during pool open phase, unit price is **dynamic and estimated** based on current aggregate pool demand.
   - Once a pool is confirmed and buyer accepts (`PRICE_LOCKED` or order created), `locked_unit_price` is **immutable**.
4. **Zero Fabricated Pricing:**
   - Never synthesize artificial discount tiers, stock levels, or phantom savings.

---

## 6. Reservation Concurrency & Identity

1. **One Active Reservation per Buyer per Pool:**
   - Enforced cryptographically and physically by database virtual column and unique index:
     `active_pool_buyer_key = IF(status IN ('RESERVED'), CONCAT(pool_id, ':', buyer_id), NULL)`
     `UNIQUE KEY uq_active_pool_buyer (active_pool_buyer_key)`.
   - Clean re-entry permitted: If a buyer cancels (`CANCELLED`) or the pool expires (`EXPIRED`), the buyer may create a new reservation if the pool is active.
2. **Parent-Pool-First `FOR UPDATE` Locking:**
   - Any reservation mutation (create, increase, decrease, cancel) must first acquire an exclusive row lock on the parent pool row:
     `SELECT id, status, current_quantity, max_capacity, expires_at FROM pools WHERE id = ? FOR UPDATE`.
   - Prevents capacity race conditions and deadlocks between concurrent buyers.
3. **Post-Lock Expiry Revalidation (OBS-46):**
   - Statement start time `NOW()` in MySQL binds at query start. If a request waited in a lock queue past `expires_at`, it must re-evaluate `SELECT (expires_at <= NOW())` afresh while holding the lock.
   - If expired, reject immediately with `422 POOL_EXPIRED`.

---

## 7. Commercial Lifecycle & State Transitions

1. **Four Independent State Machines:**
   - **Pool Commercial States (14):**
     `DRAFT`, `UPCOMING`, `ACTIVE`, `AWAITING_SUPPLIER_CONFIRMATION`, `CONFIRMED`, `SUPPLIER_FAILED`, `EXPIRED`, `PRICE_LOCKED`, `ORDERS_GENERATED`, `ORDER_PAYMENTS_PENDING`, `FULFILLMENT_PENDING`, `COMPLETED`, `CANCELLED_ADMIN`, `FAILED_COMMERCIAL`.
   - **Reservation Commercial States (5):**
     `RESERVED`, `PRICE_LOCKED`, `ORDERED`, `CANCELLED`, `EXPIRED`.
   - **Allocation Commercial States (4):**
     `UNCOMMITTED`, `HELD`, `COMMITTED`, `RELEASED`.
   - **Order & Payment Lifecycle:**
     `ORDER_CREATED` -> `PAYMENT_PENDING` -> `PAYMENT_CONFIRMED` -> `PAID`.
2. **Fail-Closed Commercial Qualification:**
   - A pool qualifies for supplier confirmation **only if** `pool.status === 'ACTIVE'` AND `total_reserved_quantity >= target_qty` AND `total_reserved_quantity <= max_capacity`.
   - Unmapped or unknown statuses fail closed.
3. **Deadlines & Sequence Invariant:**
   ```
   pool.created_at < pool.start_date < participation_cutoff (expires_at) <= supplier_confirmation_deadline < buyer_acceptance_deadline <= delivery_date
   ```

---

## 8. Financial Integrity, Orders & Payments

1. **Order-Before-Payment Invariant:**
   - An order record must be generated and persisted in the database before any Safepay payment intent can be requested or initialized.
2. **Provider-Verified Payments:**
   - Payments are never marked `PAID` or `CONFIRMED` based on client-side success callbacks. Only verified cryptographic webhook signatures or authoritative server-to-server verification may confirm payment.
3. **Zero Premature Financial Obligations:**
   - During demand aggregation (`RESERVED` status), no payment intent, order, or financial ledger entry exists. Reservations carry zero upfront financial obligation until commercial qualification and buyer confirmation.

---

## 9. Durable Business Events & Idempotency

1. **Deterministic Business Event IDs (OBS-38):**
   - Outbox business events must compute deterministic unique event IDs:
     `eventId = UUIDv5(namespace, [poolId, reservationId, eventType, mutationSeq, idempotencyKey].join(':'))`.
2. **Atomic Outbox Writes (OBS-39):**
   - Business events must be written within the exact same database transaction as the reservation/pool mutation.
3. **Crash-Safe Idempotency:**
   - Mandatory `X-Idempotency-Key` header on all mutation endpoints.
   - In-flight requests lock key (`heartbeat_at`).
   - Completed requests return identical recorded payload deterministically.
   - Expired or crashed locks auto-recover after 60-second liveness timeout.

---

## 10. Buyer & Supplier Privacy Boundaries

1. **Buyer Privacy:**
   - Individual buyer identities, individual reserved quantities, and delivery locations are strictly confidential.
   - Suppliers only see authorized aggregate metrics: `total_reserved_quantity`, `reservation_count`, `current_tier`, `progress_percent`.
   - Other buyers never see peer buyer names or specific reservation breakdowns.
2. **Supplier Transparency:**
   - Buyers see verified supplier business name, commodity grade, verified location, active pool tier pricing schedule, and progress towards the next discount threshold.

---

## 11. Database Isolation & Historical Integrity

1. **Strict Database Separation:**
   - `miljor_test_db`: All automated tests, fixtures, and failure simulations.
   - `miljor_db`: Development database. Compare current business data and integrity against the captured pre-task baseline; no unintended/test-generated business mutations. Historical counts are only reference baselines, not permanent limits.
2. **Append-Only History:**
   - Never overwrite or delete mutation logs, business events, or audit trails.
   - Never delete legitimate historical records to force test passes.
