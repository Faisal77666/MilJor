# MilJor Backend — Agent Engineering Instructions

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace.  
**Priority Hierarchy:** Correctness > Data Safety > Security > Financial Integrity > Maintainability > Execution Efficiency.  
**Authoritative Protocol Reference:** [`docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`](docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md)  
**Authoritative Business Invariants:** [`docs/MILJOR_BUSINESS_INVARIANTS.md`](docs/MILJOR_BUSINESS_INVARIANTS.md)

---

## 1. Core Operating Rules (Protocol v2.0)

1. **One-Pass Inspection & Impact Mapping:**
   - Before starting any phase, read only the latest phase report (e.g. `docs/MILJOR_PART4D1_COMMERCIAL_FOUNDATION_REPORT.md`), unresolved items in `docs/MILJOR_OBSERVATIONS_REGISTER.md`, and direct dependencies.
   - Construct one concise impact map (`Component | Existing Behavior | Required Change | Risk`).
   - Reuse existing services (`tierPricingService`, `poolProgressService`, `commercialLifecycleService`, `reservationEventService`, `reservationDemandPolicy`, `supplierEligibilityPolicy`, `idempotencyGuard`). Do not build duplicate engines.

2. **Vertical-Slice & Small Implementation:**
   - One bounded engineering objective per phase. Build in vertical slices: DB contract -> Invariants -> Transactional Service -> Auth -> Controller/Route -> Focused Test -> Doc Delta.
   - Avoid unrelated refactoring or speculative future-phase frameworks.
   - Preserve completed behavior and backwards compatibility.

3. **Risk-Based Three-Level Testing:**
   - **Level 1 (Focused):** Run only the modified component's test suite immediately after editing (expected baseline ~5s; not a hard timeout).
   - **Level 2 (Impacted):** Run directly affected subsystem suites when needed (expected baseline ~15s; not a hard timeout).
   - **Level 3 (Master Regression):** Run once at the final phase gate via `node tests/master_regression_runner.js`.

4. **Zero-Hang Execution & Resource Ownership:**
   - Individual test files (`tests/*.js`) must test their own feature set only.
   - Never invoke other test suites inside child test files via `execSync` or `spawnSync`.
   - Standalone Master Runner is the sole orchestrator for full regression.
   - Release all resources: close MySQL connection pool (`await pool.end()`), close HTTP servers (`server.close()`), clear timers, and allow Node.js event loop to drain naturally.
   - Never use successful `process.exit(0)` to hide open handles. Preserve non-zero exit codes on failures.

5. **Resource & Database Safety:**
   - All tests, fixtures, and failure simulations run strictly in `miljor_test_db`.
   - Protect `miljor_db`: capture a relevant pre-task baseline and verify that no unintended business data changed. Historical row counts are reference evidence, not permanent fixed limits; authorized migrations may update schema metadata. Never run dynamic test fixtures against `miljor_db`.
   - A restorable, verified pre-migration backup is required before applying migrations to `miljor_db`; reuse one only when it matches the exact pre-migration state.

6. **Domain & Business Invariants:**
   - Consult [`docs/MILJOR_BUSINESS_INVARIANTS.md`](docs/MILJOR_BUSINESS_INVARIANTS.md) for all rules regarding:
     - Exact commodity specifications & packaging.
     - Affirmative supplier verification.
     - Independent MOQs (`buyer_min_qty` vs `target_qty`).
     - Contiguous volume tier pricing with dynamic vs immutable locked pricing.
     - One active reservation per buyer (fail-closed virtual column).
     - Parent-pool-first `FOR UPDATE` row locking & fresh post-lock expiry revalidation (OBS-46).
     - Order-before-payment & provider-verified payments.
     - Outbox business events with deterministic event IDs (OBS-38, OBS-39).
     - Buyer & supplier privacy boundaries.

7. **Strict Stop Rule:**
   - Complete only the explicitly authorized phase.
   - Produce final quality gate report with actual wall-clock runtimes and pass/fail counts.
   - Output `CAN START NEXT PHASE: NO` and stop cleanly. Do not launch autonomous tasks.

## 2. Lean Senior Engineering Mode (complements Protocol v2.0)

- Prefer **no change** when the requirement is already satisfied. Otherwise reuse existing MilJor code, platform features, and installed dependencies before adding the smallest readable implementation. No speculative framework, wrapper, config, dependency, or future-phase functionality.
- Before modifying shared code, inspect its affected callers, routes, exports, fixtures, and tests once. Fix the root cause at the authoritative layer; preserve validation, errors, compatibility, and useful diagnostics.
- Verification is proportional: documentation-only changes get document/link/diff checks; configuration or schema changes get focused safety checks; business logic gets focused behavior tests; security, money, inventory, and lifecycle changes additionally require applicable authorization, rollback, idempotency, and concurrency evidence. The existing final master-regression requirement remains in force for development phases.
- Never simplify away tenant-scoped authorization, supplier verification, DB transaction/lock order, exact decimal monetary calculations, durable idempotency, post-lock DB deadline validation, immutable historical evidence, inventory allocation, privacy, or safe forward migrations. Do not delete historical business records or applied migrations for convenience.
- Treat test time targets as **diagnostic baselines**, not deadlines. If a command is abnormally slow, inspect its PID, last completed step, database locks, pending handles, and exit status before attempting a retry. Never launch duplicate tests, backups, or migrations while an earlier task may still be active.
- Every completed task reports changed paths, reason, caller/data impact, actual verification results and runtimes, preserved invariants, safe recovery where applicable, and deliberately deferred scope. For major phases follow the more detailed phase-specific report.
- **Precedence:** The engineering protocol and business invariants override every lean-code preference. Do not weaken tests or security to shorten execution.
- **Workspace Policy Freshness Gate:** At the start of every development phase, read the current on-disk `backend/AGENTS.md`, `backend/docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`, and `backend/docs/MILJOR_BUSINESS_INVARIANTS.md` using paths relative to the project workspace. Verify all three files exist and are readable. Treat current disk contents as authoritative over cached summaries, previous task context, or earlier copies. Do not repeat these reads during the same phase unless the files change. If a required file is missing, unreadable, or materially contradictory, report the exact issue before making affected code changes. Do not recreate policy files, silently substitute cached content, or launch redundant audits.