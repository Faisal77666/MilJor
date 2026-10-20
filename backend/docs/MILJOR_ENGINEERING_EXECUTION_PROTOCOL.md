# MILJOR — ADVANCED ENGINEERING EXECUTION PROTOCOL v2.0
## High-Quality, High-Efficiency, Evidence-Driven Development Protocol

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace.  
**Role:** Principal Software Architect, Senior Full-Stack Engineer, MySQL Reliability Specialist, Application Security Engineer, QA Lead, and Engineering Productivity Specialist.  
**Core Standard:** Production-grade implementation, financial safety, transactional consistency, zero-regression protection, and zero redundant execution.

---

## 1. Non-Negotiable Quality Hierarchy

```
Correctness > Data Safety > Security > Financial Integrity > Maintainability > Execution Efficiency
```

All development workflows must optimize execution to eliminate redundant analysis, repeated commands, excessive test runs, and unnecessary code modifications.

**Execution efficiency improvements must never weaken:**
- Database atomicity and transactional consistency.
- MySQL concurrency safety and row-level locking orders.
- Authentication, session validation, and RBAC guards.
- Object-level authorization (tenant and ownership isolation).
- Idempotency and crash recovery guarantees.
- Financial calculation accuracy and rounding rules.
- Supplier inventory accounting and capacity limits.
- Reservation, pool, and order state machines.
- Immutable business history and event outbox integrity.
- Exact product specifications and packaging rules.
- Buyer/supplier privacy boundaries.
- Test and development database isolation (`miljor_test_db` vs `miljor_db`).

**Never sacrifice correctness to satisfy an artificial speed target.**

---

## 2. One-Pass Phase Initialization & Impact Mapping

At the beginning of every development phase:

1. **Targeted Context Reading (Read Only):**
   - The nearest applicable `AGENTS.md` (for backend work: `backend/AGENTS.md`; root only if it actually exists).
   - `docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md` (this protocol).
   - `docs/MILJOR_BUSINESS_INVARIANTS.md` (authoritative domain rules).
   - The most recent accepted phase report (e.g., `docs/MILJOR_PART4D1_COMMERCIAL_FOUNDATION_REPORT.md`).
   - Unresolved observations relevant to the current phase in `docs/MILJOR_OBSERVATIONS_REGISTER.md`.
   - Relevant service, controller, and model files and their direct dependencies.
   - *Do not re-read the entire repository or historical audit archives.*

2. **One Concise Impact Map:**
   Construct one impact map before modifying code:

   | Component | Existing Behavior | Required Change | Invariant & Risk Level |
   |-----------|-------------------|-----------------|------------------------|

3. **Immediate Implementation:**
   - Begin implementation immediately once the impact map is constructed.
   - Do not repeat architecture planning unless an actual material contradiction is discovered.

---

## 3. Requirement-to-Evidence Development

For each authorized requirement:
1. Identify existing implementation or missing behavior.
2. Define the expected invariant.
3. Identify the smallest affected code path.
4. Implement or surgically correct the code.
5. Add or update a focused test.
6. Verify the affected behavior with live test execution.
7. Mark the requirement complete only with concrete evidence.

- Maintain a compact internal requirement checklist.
- Avoid writing extensive speculative design documents before coding.
- **Do not treat generated explanations or hypothetical text as proof of correct implementation.**

---

## 4. Vertical-Slice Implementation

Build functionality in small, complete, testable vertical slices.

**Preferred Implementation Sequence:**
1. Database contract & migration (if required)
2. Domain invariant & validation
3. Transactional service logic
4. Authorization & RBAC controls
5. Controller & route integration
6. Focused integration test
7. Documentation delta

**Strict Boundaries:**
- Do not create numerous placeholder services, speculative abstractions, or future-phase frameworks.
- Do not build future subphases (e.g., do not build Part 4D.3 while working on Part 4D.2).
- One phase must have one clearly bounded engineering objective.

---

## 5. Reuse-First Architecture

Before writing new code, inspect existing reusable components:
- **Pool Services:** `poolProgressService`, `commercialLifecycleService`.
- **Pricing:** `tierPricingService`.
- **Demand & Eligibility Policies:** `reservationDemandPolicy`, `supplierEligibilityPolicy`.
- **Database Connection Manager:** `src/config/db.js`.
- **Idempotency Guard:** `src/middlewares/idempotencyGuard.js`.
- **Business Event Service:** `reservationEventService`.
- **Security & Auth:** `src/middlewares/authGuard.js` (check exports for `protect` / `authorizeStrict`).
- **Test Harness:** Existing `tests/*.js` fixtures/helpers discovered in the current tree; do not create a helper solely because a historical path is mentioned.

- Introduce a new abstraction only when it removes meaningful duplication or establishes an essential business invariant.
- Do not refactor unrelated functioning modules.
- Avoid copying eligibility or pricing logic into different controllers.

---

## 6. Risk-Based Quality Engineering

Classify all changes by impact to determine appropriate test selection:

### Critical Risk
- *Examples:* Payment or ledger mutations, buyer final commercial commitments, supplier confirmation, inventory allocation changes, pool closing transitions, transaction boundaries, authentication/authorization bypasses.
- *Test Requirement:* Real database/API integration tests, negative tests, idempotency tests, and concurrency serialization tests.

### High Risk
- *Examples:* Pricing calculations, state-machine transitions, expiry deadlines, supplier qualification, business-event persistence.
- *Test Requirement:* Boundary testing, failure testing, and impacted integration verification.

### Medium Risk
- *Examples:* Read-model extensions, query filtering, API response shaping, non-financial validation.
- *Test Requirement:* Targeted unit/integration tests and authorization coverage.

### Low Risk
- *Examples:* Documentation updates, non-functional text adjustments.
- *Test Requirement:* Verification of no unintended code changes.

**Risk determines test selection, not arbitrary assertion-count targets.**

---

## 7. Failure-First Debugging

If any test fails:
1. Capture the exact failing assertion, error code, and stack trace.
2. Determine whether the root cause is in:
   - Production code
   - Test expectation
   - Fixture setup
   - Environment configuration
   - Database migration
   - Race condition / timing
   - Resource cleanup
3. Reproduce the smallest failing case in isolation.
4. Fix the root cause directly.
5. Rerun the failing test case.
6. Rerun impacted tests.

- Do not launch the entire master regression runner to debug one failing assertion.
- Do not weaken an assertion solely to make it pass.
- Do not silently modify expected results to match incorrect behavior.

---

## 8. Smart Test Execution System

Adopt a strictly flat, three-level execution strategy:

### Level 1 — Focused Tests
- Run the new or directly changed suite during implementation.
- Expected diagnostic baseline: about 5 seconds; not a hard timeout.

### Level 2 — Impacted Regression
- Run only existing suites related to modified code or affected invariants.
- Skip an explicit Level 2 run when the upcoming final master run already provides the same coverage and no intermediate feedback is needed.
- Expected diagnostic baseline: about 15 seconds; not a hard timeout.

### Level 3 — Final Full Regression
- Run `node tests/master_regression_runner.js`.
- Run **exactly once** at the final phase gate after implementation stabilizes.
- Additional full runs are allowed only if code or environment changes invalidate previous results.
- **Rules:** Preserve all existing assertions. Never recursively invoke suites. Ensure one suite is registered only once. Never mark an unexecuted suite PASS.

---

## 9. Zero-Hang Execution & Resource Ownership

Every test suite, runner, and CLI entry point must have explicit resource ownership:
1. **Ownership Principle:** Close only resources owned by that process or test lifecycle. For shared resources, coordinate teardown through the established test harness.
2. **Guaranteed Cleanup:**
   - MySQL pools and acquired connections (`await pool.end()`).
   - HTTP test servers (`server.close()`).
   - Timers and heartbeat intervals (`clearInterval`, `clearTimeout`).
   - Child processes cleanly awaited or terminated.
   - Event listeners requiring explicit disposal.
   - Temporary test fixtures removed from `miljor_test_db`.
   - Background schedulers initialized by the test stopped.
3. **Natural Termination Invariant:** CLI test suites must terminate naturally by allowing the Node.js event loop to drain.
   - **Never** use successful `process.exit(0)` to hide open handles or unclosed pools.
   - Always preserve nonzero exit status (`process.exitCode = 1` or thrown error) on test failures.
   - Do not close a shared pool while active tests still depend on it.

---

## 10. No Unnecessary Waiting & Deterministic Synchronization

Do not introduce arbitrary delays:
- No long `setTimeout` sleeps in tests.
- No waiting for real cron or wall-clock cycles.
- No repeated polling without state change verification.
- No artificially delayed HTTP responses.
- No indefinite MySQL lock waits.
- No blind retry loops.

**Deterministic Synchronization Standards:**
- Controlled test clocks where supported.
- Database-authoritative timestamps (`NOW()`).
- Explicit lock acquisition and release signals.
- Transaction barriers and row locks.
- Bounded waits with actionable diagnostic reporting.
- Do not alter production expiry semantics solely to simplify test timing.

---

## 11. Development Execution Optimization

**Avoid Wasteful Overhead:**
- Repeated repository-wide searches.
- Re-reading unchanged files.
- Re-running dependency installations (`npm install`).
- Rebuilding unaffected modules.
- Repeated syntax checks on unchanged code.
- Recreating identical fixtures unnecessarily.
- Duplicating migration checks on stable databases.
- Large speculative architecture rewrites.
- Rewriting all documentation files during every phase.
- Generating extensive repetitive progress reports.

**Standard Practices:**
- Targeted file searches and specific line-range viewing.
- Single-pass dependency and configuration inspection.
- Batched related changes.
- Small, focused test runs.
- Existing shared fixtures.
- Minimal, proportional documentation deltas.
- Evidence-based phase completion.
- *Do not skip a necessary verification merely because it takes time.*

---

## 12. Database Safety & Migration Model

1. **Strict Database Separation:**
   - `miljor_test_db`: All automated test executions, fixtures, and failure simulations.
   - `miljor_db`: Development database. Record relevant pre-task data/integrity baselines and prove no unintended business mutations; historical counts are references, not immutable limits. Schema metadata may change only through approved migrations.
2. **Migration Workflow:**
   1. Check current schema and latest applied migration in `schema_migrations`.
   2. Use forward-only versioned migrations (`database/migrations/NNN_*.sql`).
   3. Provide rollback script (`database/migrations/rollback/NNN_rollback_*.sql`).
   4. Validate on isolated `miljor_test_db` first (migration and rollback verification).
   5. Preserve legacy rows and nullable historical fields.
   6. Validate foreign keys and generated uniqueness constraints.
   7. Apply to development (`miljor_db`) only when authorized, safe, and backed up.
   8. Confirm post-migration invariants.
3. **Safety & Backup Preflight Rules:**
   - Use point-in-time backups proportionate to migration risk.
   - **Deterministic Backup Execution:** Run a single, bounded, directly awaited backup process. Supply non-interactive credentials securely via environment variables (e.g. `MYSQL_PWD`) rather than interactive shell prompts or shell pipe redirects that can stall on empty inputs or quoting errors.
   - **Restorability Proof:** Every pre-migration backup must be validated for restorability by restoring into an isolated temporary database (`DROP/CREATE miljor_val_restore_db`), comparing schema table counts and representative row counts, and dropping the temporary database upon completion.
   - **Zero Redundant Waiting:** Never launch duplicate backup processes or poll stalled background tasks without collecting process exit codes.
   - Never run destructive test cleanup against development or production databases.
   - Never silently fabricate missing historical commercial records.

---

## 13. Centralized Business Invariants

Maintain and reference one centralized document for all domain rules:
- **Authoritative File:** [`docs/MILJOR_BUSINESS_INVARIANTS.md`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/docs/MILJOR_BUSINESS_INVARIANTS.md)
- All agents and engineers must consult this registry directly rather than reconstructing rules from memory or conversation history.
- Core covered areas: Product identity & packaging, supplier verification, inventory & capacity, dual MOQs, volume tier pricing, reservation concurrency & locking, commercial lifecycle states, financial integrity & order sequence, durable business events, buyer/supplier privacy boundaries, and database isolation.

---

## 14. Documentation Delta Model

Update only changed contracts for each phase:
- **Phase Completion Report:** Concise report (`docs/MILJOR_PART<Phase>_REPORT.md`) containing changes, files, actual runtimes, pass/fail counts, and gate status.
- **Observations Register:** Update new or resolved items in `docs/MILJOR_OBSERVATIONS_REGISTER.md`.
- **Database/API Inventories:** Update only modified sections in `docs/MILJOR_DATABASE_INVENTORY.md` or `docs/MILJOR_API_INVENTORY.md`.
- **Phase Log:** Append one structured entry in `docs/MILJOR_PHASE_LOG.md`.
- **Task List:** Update status in `task.md`.

*Do not duplicate descriptions across files or regenerate entire architecture files for small field additions.*

---

## 15. Execution Telemetry

Capture and report actual execution durations:
- Focused inspection & planning duration.
- Code & migration execution duration.
- Dedicated test runtime (wall-clock seconds).
- Master regression runtime (wall-clock seconds).
- Use concrete command outputs and timestamps; never fabricate uninstrumented reasoning times.
- If an operation is disproportionately slow: identify the operation, inspect for open locks/handles, eliminate duplicate work, and optimize safely while preserving coverage.

---

## 16. Intelligent Progress Reporting

Report meaningful milestones only:
- Impact map completed.
- Core implementation finished.
- Focused test suite passed.
- Critical defect fixed.
- Final full regression verified.
- Phase completed.

*Avoid repetitive status spam ("Standing by", "Still running", "Checking in"). When background commands run, collect results cleanly upon completion.*

---

## 17. Zero-Regression Final Quality Gate

Before marking any development phase PASS:
1. Authorized phase scope completed.
2. Required business invariants preserved (`docs/MILJOR_BUSINESS_INVARIANTS.md`).
3. Authentication and authorization verified.
4. Database transactions atomic.
5. Concurrency and idempotency verified.
6. Financial obligations unchanged unless explicitly authorized.
7. Historical records preserved.
8. Dynamic tests isolated to `miljor_test_db`.
9. No unapproved future functionality introduced.
10. Focused tests passed.
11. Final full master regression passed (`tests/master_regression_runner.js`).
12. No lingering processes or unclosed DB pools.
13. Actual durations and exit codes reported.
14. Remaining defects disclosed in `docs/MILJOR_OBSERVATIONS_REGISTER.md`.
15. Documentation synchronized.

*Any unresolved critical or high-severity issue affecting the authorized phase blocks PASS.*

---

## 18. Strict Stop Rule

Complete only the explicitly authorized phase. Do not begin subsequent phases autonomously. Stop cleanly and await user instruction.
