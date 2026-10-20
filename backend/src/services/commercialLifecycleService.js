// =============================================================================
// src/services/commercialLifecycleService.js
// MilJor Part 4D.1: Regular Pool Commercial Lifecycle Foundation,
// State Integrity & Safe Closure Architecture
// =============================================================================

const crypto = require('crypto');
const db = require('../config/db');
const tierPricingService = require('./tierPricingService');
const { auditReservationStatuses, isDemandEligible } = require('./reservationDemandPolicy');

/**
 * Authoritative Commercial State Machine Definitions
 */
const POOL_COMMERCIAL_STATES = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  TARGET_REACHED: 'TARGET_REACHED',
  AWAITING_SUPPLIER_CONFIRMATION: 'AWAITING_SUPPLIER_CONFIRMATION',
  CONFIRMED: 'CONFIRMED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  FULFILLING: 'FULFILLING',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  SUPPLIER_FAILED: 'SUPPLIER_FAILED'
};

const POOL_STATE_TRANSITIONS = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['EXPIRED', 'TARGET_REACHED', 'AWAITING_SUPPLIER_CONFIRMATION', 'FAILED', 'CANCELLED'],
  TARGET_REACHED: ['AWAITING_SUPPLIER_CONFIRMATION', 'EXPIRED', 'FAILED', 'CANCELLED'],
  AWAITING_SUPPLIER_CONFIRMATION: ['CONFIRMED', 'SUPPLIER_FAILED', 'FAILED'],
  CONFIRMED: ['PAYMENT_PENDING', 'CANCELLED', 'FAILED'],
  PAYMENT_PENDING: ['FULFILLING', 'FAILED'],
  FULFILLING: ['DISPATCHED', 'FAILED'],
  DISPATCHED: ['DELIVERED', 'FAILED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
  EXPIRED: [],
  SUPPLIER_FAILED: []
};

const POOL_STATE_ROLE_AUTHORITY = {
  'DRAFT->ACTIVE': ['SUPPLIER', 'ADMIN'],
  'DRAFT->CANCELLED': ['SUPPLIER', 'ADMIN'],
  'ACTIVE->CANCELLED': ['SUPPLIER', 'ADMIN'],
  'ACTIVE->TARGET_REACHED': ['SYSTEM'],
  'ACTIVE->AWAITING_SUPPLIER_CONFIRMATION': ['SYSTEM', 'ADMIN'],
  'ACTIVE->EXPIRED': ['SYSTEM'],
  'ACTIVE->FAILED': ['SYSTEM', 'ADMIN'],
  'TARGET_REACHED->AWAITING_SUPPLIER_CONFIRMATION': ['SYSTEM', 'ADMIN'],
  'TARGET_REACHED->EXPIRED': ['SYSTEM'],
  'AWAITING_SUPPLIER_CONFIRMATION->CONFIRMED': ['SUPPLIER', 'ADMIN'],
  'AWAITING_SUPPLIER_CONFIRMATION->SUPPLIER_FAILED': ['SUPPLIER', 'SYSTEM', 'ADMIN'],
  'AWAITING_SUPPLIER_CONFIRMATION->FAILED': ['SYSTEM', 'ADMIN'],
  'CONFIRMED->PAYMENT_PENDING': ['SYSTEM', 'ADMIN'],
  'PAYMENT_PENDING->FULFILLING': ['SYSTEM', 'ADMIN'],
  'FULFILLING->DISPATCHED': ['SUPPLIER', 'ADMIN'],
  'DISPATCHED->DELIVERED': ['SUPPLIER', 'ADMIN'],
  'DELIVERED->COMPLETED': ['SYSTEM', 'ADMIN']
};

const RESERVATION_COMMERCIAL_STATES = {
  RESERVED: 'RESERVED',
  CONFIRMED: 'CONFIRMED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED'
};

const RESERVATION_STATE_TRANSITIONS = {
  RESERVED: ['CANCELLED', 'CONFIRMED', 'EXPIRED'],
  CONFIRMED: ['PAID', 'CANCELLED', 'EXPIRED'],
  PAID: ['CANCELLED'],
  CANCELLED: [],
  EXPIRED: []
};

const ALLOCATION_COMMERCIAL_STATES = {
  PENDING: 'PENDING',
  COMMITTED: 'COMMITTED',
  RELEASED: 'RELEASED',
  FULFILLED: 'FULFILLED'
};

const ALLOCATION_STATE_TRANSITIONS = {
  PENDING: ['COMMITTED', 'RELEASED'],
  COMMITTED: ['RELEASED', 'FULFILLED'],
  RELEASED: [],
  FULFILLED: []
};

class CommercialLifecycleService {

  /**
   * Pure qualification calculation evaluating eligible demand against supplier requirements
   */
  evaluateCommercialQualification({ pool, reservations = [], tiers = [] }) {
    if (!pool) {
      throw new Error('Pool object is required for qualification evaluation');
    }

    // Historical legacy pools lacking specifications or listings are non-qualifiable
    if (!pool.product_spec_id || !pool.supplier_listing_id) {
      return {
        qualified: false,
        qualification_status: 'UNQUALIFIED',
        is_supplier_confirmable: false,
        is_legacy: true,
        reason: 'LEGACY_POOL_READ_ONLY',
        eligible_demand: 0,
        supplier_min_qty: Number(pool.supplier_min_qty) || 0,
        target_qty: Number(pool.target_qty) || 0,
        max_capacity: Number(pool.max_capacity) || 0,
        pricing: null,
        active_reservations: []
      };
    }

    // Fail-closed reservation status audit (OBS-33)
    const statusAudit = auditReservationStatuses(reservations);

    // Filter active reservations governed by whitelisted demand policy
    const activeReservations = reservations.filter(r => isDemandEligible(r.status));

    // Calculate authoritative aggregate demand
    const eligibleDemand = Number(
      activeReservations
        .reduce((sum, r) => sum + Number(r.quantity || 0), 0)
        .toFixed(4)
    );

    const suppMin = Number(pool.supplier_min_qty);
    const targetQty = Number(pool.target_qty);
    const maxCapacity = Number(pool.max_capacity);

    const supplierMinMet = eligibleDemand >= suppMin;
    const targetMet = eligibleDemand >= targetQty;
    const capacityMet = eligibleDemand >= maxCapacity;

    let qualificationStatus = 'UNQUALIFIED';
    let isSupplierConfirmable = false;
    let reason = 'BELOW_SUPPLIER_MINIMUM';

    if (supplierMinMet) {
      isSupplierConfirmable = true;
      if (capacityMet) {
        qualificationStatus = 'CAPACITY_MET';
        reason = 'MAX_CAPACITY_REACHED';
      } else if (targetMet) {
        qualificationStatus = 'TARGET_MET';
        reason = 'TARGET_QUANTITY_REACHED';
      } else {
        qualificationStatus = 'QUALIFIED';
        reason = 'SUPPLIER_MINIMUM_MET';
      }
    }

    // Tier pricing candidate evaluation
    const pricing = tierPricingService.calculateApplicablePrice(tiers, eligibleDemand, suppMin);

    return {
      qualified: supplierMinMet,
      qualification_status: qualificationStatus,
      is_supplier_confirmable: isSupplierConfirmable,
      supplier_min_met: supplierMinMet,
      target_met: targetMet,
      capacity_met: capacityMet,
      reason,
      eligible_demand: eligibleDemand,
      supplier_min_qty: suppMin,
      target_qty: targetQty,
      max_capacity: maxCapacity,
      pricing: {
        tier_index: pricing.tierIndex,
        candidate_price_per_unit: Number(pricing.price),
        next_tier: pricing.nextTier ? {
          min_qty: Number(pricing.nextTier.min_qty),
          price_per_unit: Number(pricing.nextTier.price_per_unit)
        } : null
      },
      active_reservations_count: activeReservations.length,
      active_reservations: activeReservations.map(r => ({
        id: r.id,
        reservation_code: r.reservation_code,
        buyer_id: r.buyer_id,
        quantity: Number(r.quantity),
        unit_price: Number(r.unit_price)
      })),
      unknown_status_detected: statusAudit.hasUnknownStatus
    };
  }

  /**
   * Build immutable commercial snapshot contract payload
   */
  buildCommercialSnapshot({ pool, reservations = [], tiers = [], metadata = {} }) {
    const qual = this.evaluateCommercialQualification({ pool, reservations, tiers });

    if (qual.is_legacy) {
      throw new Error('Cannot generate commercial snapshot for legacy read-only pool');
    }

    const snapshotCode = `SNP-${pool.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    return {
      snapshot_code: snapshotCode,
      pool_id: pool.id,
      snapshot_version: metadata.version || 1,
      qualification_status: qual.qualification_status,
      qualification_timestamp: new Date(),
      participation_cutoff: pool.expires_at,
      supplier_id: pool.supplier_id,
      supplier_listing_id: pool.supplier_listing_id,
      product_id: pool.product_id,
      product_spec_id: pool.product_spec_id,
      canonical_spec_hash: pool.canonical_spec_hash || null,
      pool_unit: pool.pool_unit,
      eligible_aggregate_qty: qual.eligible_demand,
      supplier_min_qty: qual.supplier_min_qty,
      target_qty: qual.target_qty,
      max_capacity: qual.max_capacity,
      applicable_tier_index: qual.pricing ? qual.pricing.tier_index : null,
      candidate_unit_price: qual.pricing ? qual.pricing.candidate_price_per_unit : Number(pool.current_price_per_unit || 0),
      participating_reservations_count: qual.active_reservations_count,
      participating_reservations_summary: qual.active_reservations,
      delivery_type: pool.delivery_type || 'DOORSTEP',
      delivery_zones: pool.delivery_zones || null,
      delivery_fee_policy: pool.delivery_fee_policy || null,
      fulfilment_lead_time_days: pool.fulfilment_lead_time_days || 1,
      supplier_confirmation_deadline: pool.supplier_confirmation_deadline || null,
      buyer_commitment_deadline: pool.buyer_commitment_deadline || null,
      status: 'PENDING_SUPPLIER_DECISION',
      originating_event_id: metadata.originating_event_id || null
    };
  }

  /**
   * Persist commercial snapshot to database
   */
  async persistCommercialSnapshot(connection, snapshotPayload) {
    const [result] = await connection.query(
      `INSERT INTO pool_commercial_snapshots (
        snapshot_code, pool_id, snapshot_version, qualification_status,
        qualification_timestamp, participation_cutoff, supplier_id,
        supplier_listing_id, product_id, product_spec_id, canonical_spec_hash,
        pool_unit, eligible_aggregate_qty, supplier_min_qty, target_qty,
        max_capacity, applicable_tier_index, candidate_unit_price,
        participating_reservations_count, participating_reservations_summary,
        delivery_type, delivery_zones, delivery_fee_policy, fulfilment_lead_time_days,
        supplier_confirmation_deadline, buyer_commitment_deadline, status,
        originating_event_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        snapshotPayload.snapshot_code,
        snapshotPayload.pool_id,
        snapshotPayload.snapshot_version,
        snapshotPayload.qualification_status,
        snapshotPayload.participation_cutoff,
        snapshotPayload.supplier_id,
        snapshotPayload.supplier_listing_id,
        snapshotPayload.product_id,
        snapshotPayload.product_spec_id,
        snapshotPayload.canonical_spec_hash,
        snapshotPayload.pool_unit,
        snapshotPayload.eligible_aggregate_qty,
        snapshotPayload.supplier_min_qty,
        snapshotPayload.target_qty,
        snapshotPayload.max_capacity,
        snapshotPayload.applicable_tier_index,
        snapshotPayload.candidate_unit_price,
        snapshotPayload.participating_reservations_count,
        JSON.stringify(snapshotPayload.participating_reservations_summary),
        snapshotPayload.delivery_type,
        snapshotPayload.delivery_zones ? JSON.stringify(snapshotPayload.delivery_zones) : null,
        snapshotPayload.delivery_fee_policy,
        snapshotPayload.fulfilment_lead_time_days,
        snapshotPayload.supplier_confirmation_deadline,
        snapshotPayload.buyer_commitment_deadline,
        snapshotPayload.status,
        snapshotPayload.originating_event_id
      ]
    );

    return {
      snapshotId: result.insertId,
      snapshot_code: snapshotPayload.snapshot_code
    };
  }

  /**
   * Validate lifecycle state transition and actor authorization
   */
  validateLifecycleTransition({ currentStatus, targetStatus, actorRole, pool = null, context = {} }) {
    // 1. Check if state transition exists in the state machine
    const allowedTargets = POOL_STATE_TRANSITIONS[currentStatus];
    if (!allowedTargets || !allowedTargets.includes(targetStatus)) {
      return {
        valid: false,
        error: 'INVALID_STATE_TRANSITION',
        message: `Transition from '${currentStatus}' to '${targetStatus}' is invalid in the commercial lifecycle`
      };
    }

    // 2. Check actor role authorization
    const transitionKey = `${currentStatus}->${targetStatus}`;
    const authorizedRoles = POOL_STATE_ROLE_AUTHORITY[transitionKey];
    if (authorizedRoles && !authorizedRoles.includes(actorRole)) {
      return {
        valid: false,
        error: 'UNAUTHORIZED_ROLE',
        message: `Role '${actorRole}' is not authorized to transition pool from '${currentStatus}' to '${targetStatus}'`
      };
    }

    // 3. Precondition validation
    if (targetStatus === 'AWAITING_SUPPLIER_CONFIRMATION') {
      if (context.qualified === false) {
        return {
          valid: false,
          error: 'UNQUALIFIED_FOR_SUPPLIER_CONFIRMATION',
          message: 'Pool demand is below supplier minimum; cannot transition to supplier confirmation'
        };
      }
    }

    return { valid: true };
  }

  /**
   * Validate lifecycle timeline ordering and presence
   */
  validateLifecycleDeadlines(pool) {
    if (!pool.expires_at) {
      return { valid: false, error: 'MISSING_EXPIRY_DEADLINE', message: 'Pool expires_at is required' };
    }

    const expiryTime = new Date(pool.expires_at).getTime();

    // Supplier confirmation deadline check
    if (pool.supplier_confirmation_deadline) {
      const suppTime = new Date(pool.supplier_confirmation_deadline).getTime();
      if (suppTime <= expiryTime) {
        return {
          valid: false,
          error: 'INVALID_DEADLINE_SEQUENCE',
          message: 'supplier_confirmation_deadline must be strictly after expires_at'
        };
      }

      // Buyer commitment deadline check
      if (pool.buyer_commitment_deadline) {
        const buyerTime = new Date(pool.buyer_commitment_deadline).getTime();
        if (buyerTime <= suppTime) {
          return {
            valid: false,
            error: 'INVALID_DEADLINE_SEQUENCE',
            message: 'buyer_commitment_deadline must be strictly after supplier_confirmation_deadline'
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Authoritative Atomic Commercial Qualification & Safe Closure Service (Part 4D.2)
   *
   * Executes authoritative qualification transition at or after participation deadline:
   * 1. Acquires parent pool row lock (FOR UPDATE).
   * 2. Evaluates fresh database server time (SELECT (expires_at <= NOW())).
   * 3. Locks and recalculates all active reservations in the pool.
   * 4. Evaluates supplier inventory allocation invariants.
   * 5. Determines qualification outcome:
   *    - Qualified (eligible demand >= supplier_min_qty) -> AWAITING_SUPPLIER_CONFIRMATION
   *    - Unqualified (eligible demand < supplier_min_qty) -> EXPIRED
   * 6. Builds and persists immutable commercial snapshot (enforced by DB unique constraints).
   * 7. Emits and persists durable business event in the same transaction.
   * 8. Updates pool status and timestamps.
   * 9. Maintains complete buyer reservation history, supplier allocations, zero payments, zero orders.
   *
   * @param {Object} params
   * @param {number} params.poolId - ID of pool to qualify
   * @param {Object} params.actor - Actor executing transition ({ id, role })
   * @param {string} [params.idempotencyKey] - Optional idempotency key for durable operation deduplication
   * @param {Object} [params.options] - Execution options (e.g. existingConnection)
   * @returns {Promise<Object>} Authoritative qualification outcome and snapshot
   */
  async qualifyPoolParticipation({ poolId, actor, idempotencyKey = null, options = {} }) {
    if (!poolId || isNaN(poolId)) {
      const err = new Error('Valid numeric poolId is required for qualification');
      err.code = 'INVALID_POOL_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.role) {
      const err = new Error('Actor identity and role are required for qualification');
      err.code = 'UNAUTHENTICATED';
      err.statusCode = 401;
      throw err;
    }

    // OBS-62: Scoped Idempotency Key
    // Strictly required when options.requireIdempotencyKey is set (or via idempotencyGuard middleware).
    // If not provided by internal programmatic caller, defaults safely to deterministic generated key.
    if (options.requireIdempotencyKey && (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0)) {
      const err = new Error('Durable idempotencyKey is required for commercial pool qualification');
      err.code = 'MISSING_IDEMPOTENCY_KEY';
      err.statusCode = 400;
      throw err;
    }

    const isAutoGeneratedKey = !idempotencyKey;
    if (!idempotencyKey) {
      idempotencyKey = `AUTO-QUAL-${poolId}-${Date.now()}`;
    }

    if (idempotencyKey.length > 100) {
      const err = new Error('Idempotency key exceeds maximum length of 100 characters');
      err.code = 'INVALID_IDEMPOTENCY_KEY';
      err.statusCode = 400;
      throw err;
    }

    // Role authorization: Only SYSTEM, ADMIN, SUPER_ADMIN, or the owning SUPPLIER can invoke qualification
    const allowedRoles = ['SYSTEM', 'ADMIN', 'SUPER_ADMIN', 'SUPPLIER'];
    if (!allowedRoles.includes(actor.role)) {
      const err = new Error(`Role '${actor.role}' is not authorized to execute pool qualification`);
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    const externalConnection = options.connection || null;
    const connection = externalConnection || await db.getConnection();
    const shouldManageTransaction = !externalConnection;

    try {
      if (shouldManageTransaction) {
        await connection.beginTransaction();
      }

      // 1. Lock parent pool row FIRST
      const [poolRows] = await connection.query(
        `SELECT p.*, (p.expires_at <= NOW()) AS is_expired_at_start
         FROM pools p
         WHERE p.id = ? FOR UPDATE`,
        [poolId]
      );

      if (!poolRows || poolRows.length === 0) {
        const err = new Error(`Pool with ID ${poolId} not found`);
        err.code = 'POOL_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const pool = poolRows[0];

      // Supplier tenancy check: If actor is SUPPLIER, they can only qualify their own pool
      if (actor.role === 'SUPPLIER' && Number(pool.supplier_id) !== Number(actor.id)) {
        const err = new Error('Suppliers are not permitted to qualify pools belonging to other suppliers');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Reject historical legacy pools lacking specifications or listings (OBS-24)
      if (!pool.product_spec_id || !pool.supplier_listing_id) {
        const err = new Error('Historical legacy pool lacks verified product specification identity and is read-only');
        err.code = 'LEGACY_POOL_READ_ONLY';
        err.statusCode = 422;
        throw err;
      }

      // Check current pool status
      // OBS-61: Separate true idempotent replay from conflicting new transitions on already-qualified pools
      if (pool.status === 'AWAITING_SUPPLIER_CONFIRMATION' || pool.status === 'EXPIRED') {
        const [existingSnaps] = await connection.query(
          `SELECT * FROM pool_commercial_snapshots WHERE pool_id = ? ORDER BY snapshot_version DESC LIMIT 1`,
          [poolId]
        );
        if (existingSnaps.length > 0) {
          const snap = existingSnaps[0];

          // Check if this caller holds the exact matching idempotency record for this operation
          const [idemRows] = await connection.query(
            `SELECT * FROM idempotency_records WHERE idempotency_key = ?`,
            [idempotencyKey]
          );

          const isMatchingCaller = idemRows.length > 0 && 
            (idemRows[0].user_id === null || Number(idemRows[0].user_id) === Number(actor.id));

          if (isMatchingCaller || options.isInternalReplay || isAutoGeneratedKey) {
            if (shouldManageTransaction) {
              await connection.commit();
            }
            return {
              success: true,
              is_idempotent_replay: true,
              message: `Pool qualification already completed with status: ${pool.status}`,
              data: {
                pool_id: pool.id,
                status: pool.status,
                qualification_status: snap.qualification_status,
                qualified: snap.qualification_status !== 'UNQUALIFIED',
                snapshot_code: snap.snapshot_code,
                snapshot_version: snap.snapshot_version,
                eligible_aggregate_qty: Number(snap.eligible_aggregate_qty),
                supplier_min_qty: Number(snap.supplier_min_qty),
                candidate_unit_price: Number(snap.candidate_unit_price),
                participating_reservations_count: snap.participating_reservations_count
              }
            };
          }

          // Conflicting new transition attempt without matching operation identity
          const conflictErr = new Error(
            `Pool has already undergone qualification and is currently '${pool.status}'. Separate read model must be used to inspect existing outcome.`
          );
          conflictErr.code = 'POOL_ALREADY_QUALIFIED';
          conflictErr.statusCode = 409;
          conflictErr.details = {
            pool_id: pool.id,
            status: pool.status,
            snapshot_code: snap.snapshot_code
          };
          throw conflictErr;
        }
      }

      // Pool must be in ACTIVE or TARGET_REACHED status to undergo qualification
      if (!['ACTIVE', 'TARGET_REACHED'].includes(pool.status)) {
        const err = new Error(`Pool is currently '${pool.status}' and cannot undergo qualification evaluation`);
        err.code = 'INVALID_POOL_STATUS';
        err.statusCode = 422;
        throw err;
      }

      // 2. Authoritative Fresh Database Time Evaluation (OBS-46)
      // Must re-evaluate NOW() post-lock-wait to ensure timing is evaluated freshly while holding row lock
      const [freshTimeRows] = await connection.query(
        `SELECT (expires_at <= NOW()) AS is_freshly_expired,
                expires_at, NOW() AS db_now
         FROM pools WHERE id = ?`,
        [poolId]
      );

      const isExpired = Boolean(freshTimeRows[0] && freshTimeRows[0].is_freshly_expired);
      if (!isExpired) {
        const err = new Error('Pool participation cutoff (expires_at) has not been reached yet according to database server time');
        err.code = 'PREMATURE_QUALIFICATION';
        err.statusCode = 422;
        err.details = {
          expires_at: freshTimeRows[0].expires_at,
          db_now: freshTimeRows[0].db_now
        };
        throw err;
      }

      // 3. Lock all reservations for this pool in order to lock dependent rows
      const [reservations] = await connection.query(
        `SELECT * FROM reservations WHERE pool_id = ? ORDER BY id ASC FOR UPDATE`,
        [poolId]
      );

      // Check for unmapped/unknown reservation statuses (Fail-Closed OBS-33)
      const statusAudit = auditReservationStatuses(reservations);
      if (statusAudit.hasUnknownStatus) {
        const err = new Error(`Unrecognized reservation status detected in pool: ${statusAudit.unknownStatuses.join(', ')}`);
        err.code = 'UNKNOWN_RESERVATION_STATUS';
        err.statusCode = 500;
        throw err;
      }

      // 4. Fetch volume price tiers
      const [tiers] = await connection.query(
        `SELECT id, min_qty, max_qty, price_per_unit, pricing_unit 
         FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC`,
        [poolId]
      );

      // 5. Fetch and validate committed supplier inventory allocation
      const [allocations] = await connection.query(
        `SELECT * FROM supplier_inventory_allocations 
         WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL' AND status = 'COMMITTED'
         FOR UPDATE`,
        [poolId]
      );

      const allocation = allocations[0] || null;
      const allocValidation = this.validateInventoryAllocationInvariants({
        pool,
        allocation,
        reservations
      });

      if (!allocValidation.valid) {
        const err = new Error(allocValidation.message);
        err.code = allocValidation.error;
        err.statusCode = 422;
        throw err;
      }

      // 6. Perform Authoritative Qualification Evaluation
      const qual = this.evaluateCommercialQualification({ pool, reservations, tiers });

      // Determine Target Lifecycle State based on Authoritative Outcome
      // Qualified -> AWAITING_SUPPLIER_CONFIRMATION
      // Unqualified -> EXPIRED
      let targetPoolStatus;
      let targetSnapshotStatus;
      let eventType;

      if (qual.qualified) {
        targetPoolStatus = POOL_COMMERCIAL_STATES.AWAITING_SUPPLIER_CONFIRMATION;
        targetSnapshotStatus = 'PENDING_SUPPLIER_DECISION';
        eventType = 'POOL_QUALIFIED';
      } else {
        targetPoolStatus = POOL_COMMERCIAL_STATES.EXPIRED;
        targetSnapshotStatus = 'EXPIRED';
        eventType = 'POOL_UNQUALIFIED';
      }

      // 7. Generate Deterministic Event ID & Prepare Business Event
      const reservationEventService = require('./reservationEventService');
      const eventId = reservationEventService.generateEventId({
        event_type: eventType,
        pool_id: pool.id,
        reservation_id: null,
        actor_id: actor.id,
        mutation_type: 'QUALIFICATION',
        idempotency_key: idempotencyKey,
        event_sequence: 1
      });

      // 8. Build Commercial Snapshot
      const snapshotPayload = this.buildCommercialSnapshot({
        pool,
        reservations,
        tiers,
        metadata: {
          version: 1,
          originating_event_id: eventId
        }
      });
      snapshotPayload.status = targetSnapshotStatus;

      // 9. Persist Commercial Snapshot (protected by DB uniqueness uq_snapshot_authoritative_decision)
      const snapshotRecord = await this.persistCommercialSnapshot(connection, snapshotPayload);

      // 10. Update Pool Status and Timestamps
      await connection.query(
        `UPDATE pools
         SET status = ?,
             closed_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [targetPoolStatus, poolId]
      );

      // 11. Record Business History / Event within the Same Transaction
      await reservationEventService.recordEvent(
        {
          event_id: eventId,
          event_type: eventType,
          pool_id: pool.id,
          reservation_id: null,
          actor_id: actor.id,
          actor_role: actor.role,
          idempotency_key: idempotencyKey,
          previous_quantity: 0,
          new_quantity: 0,
          previous_aggregate_demand: Number(pool.current_qty || 0),
          new_aggregate_demand: qual.eligible_demand,
          previous_unit_price: Number(pool.current_price_per_unit || 0),
          new_unit_price: qual.pricing ? qual.pricing.candidate_price_per_unit : Number(pool.current_price_per_unit || 0),
          event_payload: {
            qualification_status: qual.qualification_status,
            qualified: qual.qualified,
            reason: qual.reason,
            eligible_demand: qual.eligible_demand,
            supplier_min_qty: qual.supplier_min_qty,
            target_qty: qual.target_qty,
            max_capacity: qual.max_capacity,
            candidate_price: qual.pricing ? qual.pricing.candidate_price_per_unit : null,
            participating_reservations_count: qual.active_reservations_count,
            snapshot_code: snapshotRecord.snapshot_code,
            inventory_allocation_id: allocation.id,
            inventory_allocation_status: allocation.status
          }
        },
        connection
      );

      // 12. Record Audit Log in the Same Transaction
      await connection.query(
        `INSERT INTO system_audit_logs 
          (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, ?, ?, 'pools', ?, ?, ?)`,
        [
          actor.id,
          actor.role,
          qual.qualified ? 'POOL_COMMERCIAL_QUALIFIED' : 'POOL_COMMERCIAL_UNQUALIFIED',
          pool.id,
          JSON.stringify({ status: pool.status, current_qty: pool.current_qty }),
          JSON.stringify({
            status: targetPoolStatus,
            eligible_demand: qual.eligible_demand,
            snapshot_code: snapshotRecord.snapshot_code
          })
        ]
      );

      if (shouldManageTransaction) {
        await connection.commit();
      }

      return {
        success: true,
        is_idempotent_replay: false,
        message: qual.qualified
          ? 'Pool successfully qualified and advanced to AWAITING_SUPPLIER_CONFIRMATION'
          : 'Pool evaluated as unqualified (demand below supplier minimum) and closed as EXPIRED',
        data: {
          pool_id: pool.id,
          status: targetPoolStatus,
          qualification_status: qual.qualification_status,
          qualified: qual.qualified,
          reason: qual.reason,
          snapshot_id: snapshotRecord.snapshotId,
          snapshot_code: snapshotRecord.snapshot_code,
          snapshot_version: 1,
          eligible_aggregate_qty: qual.eligible_demand,
          supplier_min_qty: qual.supplier_min_qty,
          target_qty: qual.target_qty,
          max_capacity: qual.max_capacity,
          candidate_unit_price: qual.pricing ? qual.pricing.candidate_price_per_unit : Number(pool.current_price_per_unit || 0),
          participating_reservations_count: qual.active_reservations_count,
          event_id: eventId,
          inventory_allocation: {
            id: allocation.id,
            allocated_qty: Number(allocation.allocated_qty),
            unit: allocation.unit,
            status: allocation.status,
            preservation_notes: qual.qualified
              ? 'Committed inventory preserved for supplier confirmation (Part 4D.3)'
              : 'Committed inventory held pending authorized administrative/supplier settlement'
          }
        }
      };

    } catch (err) {
      if (shouldManageTransaction && connection) {
        try { await connection.rollback(); } catch (rbErr) {}
      }
      throw err;
    } finally {
      if (shouldManageTransaction && connection) {
        connection.release();
      }
    }
  }

  /**
   * Validate supplier inventory allocation invariants
   */
  validateInventoryAllocationInvariants({ pool, allocation, reservations = [] }) {
    if (!allocation) {
      return { valid: false, error: 'MISSING_ALLOCATION', message: 'Supplier inventory allocation is missing' };
    }

    // Allocation must be COMMITTED for active pools
    if (['ACTIVE', 'TARGET_REACHED', 'AWAITING_SUPPLIER_CONFIRMATION'].includes(pool.status)) {
      if (allocation.status !== 'COMMITTED') {
        return {
          valid: false,
          error: 'ALLOCATION_NOT_COMMITTED',
          message: `Allocation status must be COMMITTED while pool is '${pool.status}'`
        };
      }
    }

    // Quantity invariant: allocated_qty >= max_capacity (or target_qty)
    const requiredCapacity = Number(pool.max_capacity || pool.target_qty || 0);
    if (Number(allocation.allocated_qty) < requiredCapacity) {
      return {
        valid: false,
        error: 'ALLOCATION_UNDERSIZED',
        message: `Allocated quantity (${allocation.allocated_qty}) is less than required capacity (${requiredCapacity})`
      };
    }

    // Release protection: cannot release while active reservations exist
    const hasActiveReservations = reservations.some(r => isDemandEligible(r.status));
    if (hasActiveReservations && allocation.status === 'RELEASED') {
      return {
        valid: false,
        error: 'PREMATURE_ALLOCATION_RELEASE',
        message: 'Committed inventory cannot be released while active buyer reservations exist'
      };
    }

    return { valid: true };
  }

  /**
   * Authoritative, secure, and transactionally atomic supplier accept/reject decision workflow (Part 4D.3).
   * 
   * Strict Invariants Enforced:
   * 1. Actor Verification: Authenticated SUPPLIER only (ADMIN/SUPER_ADMIN cannot forge supplier commercial consent).
   * 2. Live Supplier KYC: Must be affirmatively active and VERIFIED in users & supplier_profiles.
   * 3. Ownership & Listing: Must own the pool and linked supplier listing.
   * 4. Pool State: Pool must be in AWAITING_SUPPLIER_CONFIRMATION.
   * 5. Snapshot Integrity: Snapshot must exist, be in PENDING_SUPPLIER_DECISION, match version & pool.
   * 6. Deadline Integrity: Fresh post-lock-wait DB time evaluation (db_now <= supplier_confirmation_deadline).
   * 7. Idempotency & Replay: Scoped idempotencyKey strictly required; replay returns original decision;
   *    conflicting attempts throw 409 POOL_DECISION_ALREADY_RECORDED; cross-actor theft throws 403.
   * 8. State Transitions:
   *    - ACCEPT -> Pool: CONFIRMED; Snapshot: ACCEPTED; Event: SUPPLIER_OFFER_ACCEPTED.
   *    - REJECT -> Pool: SUPPLIER_FAILED; Snapshot: REJECTED; Event: SUPPLIER_OFFER_REJECTED.
   * 9. Exact Pricing & Quantity Safeguard: Agreed quantity and unit price match frozen snapshot exactly.
   * 10. Inventory Safeguard: Committed inventory remains COMMITTED without premature release or double allocation.
   * 11. Financial Boundaries: Zero orders, payments, refunds, ledger entries, or buyer price locks created.
   * 
   * @param {Object} params
   * @param {number} params.poolId
   * @param {Object} params.actor - Authenticated actor { id, role }
   * @param {string} params.decision - 'ACCEPT' | 'REJECT'
   * @param {number} params.qualificationSnapshotId
   * @param {string} [params.rejectionReasonCode]
   * @param {string} [params.rejectionReasonNotes]
   * @param {string} params.idempotencyKey
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async recordSupplierDecision({
    poolId,
    actor,
    decision,
    qualificationSnapshotId,
    rejectionReasonCode = null,
    rejectionReasonNotes = null,
    idempotencyKey
  }, options = {}) {
    if (!poolId || isNaN(Number(poolId))) {
      const err = new Error('Valid poolId is required');
      err.code = 'INVALID_POOL_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id || !actor.role) {
      const err = new Error('Authenticated actor identity and role are required');
      err.code = 'UNAUTHENTICATED';
      err.statusCode = 401;
      throw err;
    }

    // Role Invariant: Only SUPPLIER role may provide commercial consent (Admin cannot forge supplier acceptance)
    if (actor.role !== 'SUPPLIER') {
      const err = new Error(`Role '${actor.role}' is not authorized to submit supplier commercial decisions. Ordinary ADMIN or SUPER_ADMIN cannot impersonate supplier commercial consent.`);
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    // Validate Decision Input
    const normalizedDecision = String(decision || '').trim().toUpperCase();
    if (!['ACCEPT', 'REJECT'].includes(normalizedDecision)) {
      const err = new Error("Decision must be either 'ACCEPT' or 'REJECT'");
      err.code = 'INVALID_DECISION';
      err.statusCode = 400;
      throw err;
    }

    if (!qualificationSnapshotId || isNaN(Number(qualificationSnapshotId))) {
      const err = new Error('Valid qualificationSnapshotId is required');
      err.code = 'INVALID_SNAPSHOT_ID';
      err.statusCode = 400;
      throw err;
    }

    // Rejection validation
    if (normalizedDecision === 'REJECT') {
      const allowedReasonCodes = ['CAPACITY_SHORTAGE', 'LOGISTICS_UNAVAILABLE', 'PRICING_UNVIABLE', 'FORCE_MAJEURE', 'OTHER'];
      if (!rejectionReasonCode || !allowedReasonCodes.includes(rejectionReasonCode)) {
        const err = new Error(`rejection_reason_code is required for REJECT decisions. Permitted codes: [${allowedReasonCodes.join(', ')}]`);
        err.code = 'INVALID_REJECTION_REASON';
        err.statusCode = 400;
        throw err;
      }
      if (rejectionReasonNotes && typeof rejectionReasonNotes === 'string' && rejectionReasonNotes.length > 255) {
        const err = new Error('rejection_reason_notes exceeds maximum length of 255 characters');
        err.code = 'INVALID_REJECTION_NOTES';
        err.statusCode = 400;
        throw err;
      }
    }

    // Idempotency Key validation
    const isAutoGeneratedKey = !idempotencyKey;
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('Durable idempotencyKey is required for supplier commercial decision');
      err.code = 'MISSING_IDEMPOTENCY_KEY';
      err.statusCode = 400;
      throw err;
    }

    idempotencyKey = String(idempotencyKey).trim();
    if (idempotencyKey.length > 100) {
      const err = new Error('Idempotency key exceeds maximum length of 100 characters');
      err.code = 'INVALID_IDEMPOTENCY_KEY';
      err.statusCode = 400;
      throw err;
    }

    const externalConnection = options.connection || null;
    const connection = externalConnection || await db.getConnection();
    const shouldManageTransaction = !externalConnection;

    try {
      if (shouldManageTransaction) {
        await connection.beginTransaction();
      }

      // 1. Lock parent pool row FIRST (Strict lock hierarchy)
      const [poolRows] = await connection.query(
        `SELECT * FROM pools WHERE id = ? FOR UPDATE`,
        [poolId]
      );

      if (!poolRows || poolRows.length === 0) {
        const err = new Error(`Pool with ID ${poolId} not found`);
        err.code = 'POOL_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const pool = poolRows[0];

      // 2. Ownership Verification: Authenticated supplier MUST be the pool owner
      if (Number(pool.supplier_id) !== Number(actor.id)) {
        const err = new Error('Supplier cannot submit decision on a pool belonging to another supplier');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // 3. Live Fresh Supplier Eligibility Verification (Edge Case 1)
      const [suppUserRows] = await connection.query(
        `SELECT u.id, u.role, u.verification_status AS user_verification,
                u.buyer_trust_status, sp.verification_status AS supplier_verification
         FROM users u
         LEFT JOIN supplier_profiles sp ON sp.supplier_id = u.id
         WHERE u.id = ?`,
        [actor.id]
      );

      const suppUser = suppUserRows[0] || null;
      if (!suppUser || suppUser.user_verification === 'BLOCKED' || suppUser.buyer_trust_status === 'SUSPENDED') {
        const err = new Error('Supplier account is suspended or blocked. Cannot record commercial decision.');
        err.code = 'ACCOUNT_SUSPENDED';
        err.statusCode = 403;
        throw err;
      }

      if (suppUser.supplier_verification !== 'VERIFIED') {
        const err = new Error('Supplier profile is not affirmatively verified. Cannot execute commercial decisions.');
        err.code = 'SUPPLIER_NOT_VERIFIED';
        err.statusCode = 403;
        throw err;
      }

      // 4. Check for existing decision on this pool
      const [existingDecisions] = await connection.query(
        `SELECT * FROM pool_supplier_commercial_decisions WHERE pool_id = ? ORDER BY id DESC LIMIT 1`,
        [poolId]
      );

      if (existingDecisions.length > 0) {
        const existingDec = existingDecisions[0];

        // Check if this caller holds the exact matching idempotency record for this operation
        const [idemRows] = await connection.query(
          `SELECT * FROM idempotency_records WHERE idempotency_key = ?`,
          [idempotencyKey]
        );

        const isMatchingKey = (existingDec.idempotency_key && existingDec.idempotency_key === idempotencyKey) ||
          (idemRows.length > 0 && idemRows[0].idempotency_key === existingDec.idempotency_key);
        const isMatchingCaller = isMatchingKey &&
          (idemRows.length === 0 || idemRows[0].user_id === null || Number(idemRows[0].user_id) === Number(actor.id));

        if (isMatchingCaller || options.isInternalReplay || isAutoGeneratedKey) {
          if (shouldManageTransaction) {
            await connection.commit();
          }
          return {
            success: true,
            is_idempotent_replay: true,
            message: `Supplier commercial decision already recorded: ${existingDec.decision}`,
            data: {
              decision_code: existingDec.decision_code,
              pool_id: existingDec.pool_id,
              pool_status: pool.status,
              snapshot_id: existingDec.snapshot_id,
              decision: existingDec.decision,
              rejection_reason_code: existingDec.rejection_reason_code,
              agreed_aggregate_qty: Number(existingDec.agreed_aggregate_qty),
              agreed_unit_price: Number(existingDec.agreed_unit_price),
              decision_timestamp: existingDec.decision_timestamp
            }
          };
        }

        // Conflicting new decision attempt on already-decided pool
        const conflictErr = new Error(
          `Pool has already undergone supplier commercial decision (${existingDec.decision}) and is currently '${pool.status}'.`
        );
        conflictErr.code = 'POOL_DECISION_ALREADY_RECORDED';
        conflictErr.statusCode = 409;
        conflictErr.details = {
          pool_id: pool.id,
          pool_status: pool.status,
          decision: existingDec.decision,
          decision_code: existingDec.decision_code
        };
        throw conflictErr;
      }

      // 5. Pool State Check: Must be AWAITING_SUPPLIER_CONFIRMATION
      if (pool.status !== POOL_COMMERCIAL_STATES.AWAITING_SUPPLIER_CONFIRMATION) {
        const err = new Error(`Pool is currently in status '${pool.status}'. Decisions are only permitted while in 'AWAITING_SUPPLIER_CONFIRMATION'.`);
        err.code = 'INVALID_POOL_STATE';
        err.statusCode = 422;
        err.details = { pool_id: pool.id, current_status: pool.status };
        throw err;
      }

      // 6. Lock and load Qualification Snapshot
      const [snapRows] = await connection.query(
        `SELECT * FROM pool_commercial_snapshots WHERE id = ? FOR UPDATE`,
        [qualificationSnapshotId]
      );

      if (!snapRows || snapRows.length === 0) {
        const err = new Error(`Qualification snapshot with ID ${qualificationSnapshotId} not found`);
        err.code = 'SNAPSHOT_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const snapshot = snapRows[0];

      // Validate Snapshot Linkage
      if (Number(snapshot.pool_id) !== Number(pool.id)) {
        const err = new Error(`Snapshot ${qualificationSnapshotId} belongs to pool ${snapshot.pool_id}, not pool ${pool.id}`);
        err.code = 'SNAPSHOT_MISMATCH';
        err.statusCode = 422;
        throw err;
      }

      if (Number(snapshot.supplier_id) !== Number(actor.id)) {
        const err = new Error('Snapshot supplier identity does not match authenticated supplier');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      if (snapshot.status !== 'PENDING_SUPPLIER_DECISION') {
        const err = new Error(`Snapshot is currently in status '${snapshot.status}' and cannot accept supplier decision`);
        err.code = 'SNAPSHOT_NOT_PENDING';
        err.statusCode = 422;
        throw err;
      }

      if (snapshot.qualification_status === 'UNQUALIFIED') {
        const err = new Error('Cannot submit supplier decision on an UNQUALIFIED snapshot');
        err.code = 'UNQUALIFIED_SNAPSHOT';
        err.statusCode = 422;
        throw err;
      }

      // 7. Fresh Database-Authoritative Deadline Integrity Check (Edge Case 2)
      // Check supplier_confirmation_deadline against fresh NOW()
      const effectiveDeadline = snapshot.supplier_confirmation_deadline || pool.supplier_confirmation_deadline;
      if (!effectiveDeadline) {
        const err = new Error('Supplier confirmation deadline is missing or undefined. Operation failed closed.');
        err.code = 'MISSING_CONFIRMATION_DEADLINE';
        err.statusCode = 422;
        throw err;
      }

      const [timeRows] = await connection.query(
        `SELECT (NOW() > ?) AS is_deadline_passed,
                (NOW() = ?) AS is_exact_boundary,
                NOW() AS db_now`,
        [effectiveDeadline, effectiveDeadline]
      );

      const isDeadlinePassed = Boolean(timeRows[0] && timeRows[0].is_deadline_passed);
      const isExactBoundary = Boolean(timeRows[0] && timeRows[0].is_exact_boundary);

      if (isDeadlinePassed || isExactBoundary) {
        const err = new Error('Supplier confirmation window has expired according to database server time. New commercial decisions are blocked.');
        err.code = 'SUPPLIER_CONFIRMATION_DEADLINE_EXPIRED';
        err.statusCode = 422;
        err.details = {
          deadline: effectiveDeadline,
          db_now: timeRows[0].db_now
        };
        throw err;
      }

      // 8. Validate Inventory Allocation Invariant (Allocation must remain COMMITTED)
      const [allocRows] = await connection.query(
        `SELECT * FROM supplier_inventory_allocations
         WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL' AND status = 'COMMITTED'
         FOR UPDATE`,
        [poolId]
      );

      if (!allocRows || allocRows.length === 0) {
        const err = new Error('Committed supplier inventory allocation not found for this pool. State integrity violation.');
        err.code = 'ALLOCATION_MISSING';
        err.statusCode = 422;
        throw err;
      }

      const allocation = allocRows[0];
      const agreedQty = Number(snapshot.eligible_aggregate_qty);
      if (Number(allocation.allocated_qty) < agreedQty) {
        const err = new Error(`Allocated inventory (${allocation.allocated_qty}) does not cover agreed aggregate quantity (${agreedQty})`);
        err.code = 'ALLOCATION_UNDERSIZED';
        err.statusCode = 422;
        throw err;
      }

      // 9. Generate Deterministic Event ID & Unique Decision Code
      const reservationEventService = require('./reservationEventService');
      const eventType = normalizedDecision === 'ACCEPT' ? 'SUPPLIER_OFFER_ACCEPTED' : 'SUPPLIER_OFFER_REJECTED';
      const eventId = reservationEventService.generateEventId({
        event_type: eventType,
        pool_id: pool.id,
        reservation_id: null,
        actor_id: actor.id,
        mutation_type: 'SUPPLIER_DECISION',
        idempotency_key: idempotencyKey,
        event_sequence: 1
      });

      const randSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
      const decisionCode = `DEC-${pool.id}-${Date.now()}-${randSuffix}`;

      // 10. Persist Immutable Supplier Decision Record
      await connection.query(
        `INSERT INTO pool_supplier_commercial_decisions (
          decision_code, pool_id, snapshot_id, snapshot_version,
          supplier_id, actor_id, actor_role, decision,
          rejection_reason_code, rejection_reason_notes,
          agreed_aggregate_qty, agreed_unit_price,
          originating_event_id, idempotency_key, decision_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          decisionCode,
          pool.id,
          snapshot.id,
          snapshot.snapshot_version,
          pool.supplier_id,
          actor.id,
          actor.role,
          normalizedDecision,
          normalizedDecision === 'REJECT' ? rejectionReasonCode : null,
          normalizedDecision === 'REJECT' ? (rejectionReasonNotes ? rejectionReasonNotes.trim() : null) : null,
          snapshot.eligible_aggregate_qty,
          snapshot.candidate_unit_price,
          eventId,
          idempotencyKey
        ]
      );

      // 11. Transition Pool State and Snapshot State
      let nextPoolStatus;
      let nextSnapshotStatus;

      if (normalizedDecision === 'ACCEPT') {
        nextPoolStatus = POOL_COMMERCIAL_STATES.CONFIRMED;
        nextSnapshotStatus = 'ACCEPTED';

        await connection.query(
          `UPDATE pools
           SET status = ?,
               confirmed_at = NOW(),
               supplier_confirmation_notes = ?,
               updated_at = NOW()
           WHERE id = ?`,
          [nextPoolStatus, 'Supplier confirmed commercial terms', pool.id]
        );
      } else {
        nextPoolStatus = POOL_COMMERCIAL_STATES.SUPPLIER_FAILED;
        nextSnapshotStatus = 'REJECTED';

        await connection.query(
          `UPDATE pools
           SET status = ?,
               closed_at = NOW(),
               supplier_confirmation_notes = ?,
               updated_at = NOW()
           WHERE id = ?`,
          [nextPoolStatus, `Supplier rejected: ${rejectionReasonCode}`, pool.id]
        );
      }

      await connection.query(
        `UPDATE pool_commercial_snapshots
         SET status = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [nextSnapshotStatus, snapshot.id]
      );

      // 12. Record Business Event in Outbox within the Same Transaction
      await reservationEventService.recordEvent(
        {
          event_id: eventId,
          event_type: eventType,
          pool_id: pool.id,
          reservation_id: null,
          actor_id: actor.id,
          actor_role: actor.role,
          idempotency_key: idempotencyKey,
          previous_aggregate_demand: Number(snapshot.eligible_aggregate_qty),
          new_aggregate_demand: Number(snapshot.eligible_aggregate_qty),
          previous_unit_price: Number(snapshot.candidate_unit_price),
          new_unit_price: Number(snapshot.candidate_unit_price),
          event_payload: {
            decision_code: decisionCode,
            decision: normalizedDecision,
            snapshot_id: snapshot.id,
            snapshot_code: snapshot.snapshot_code,
            snapshot_version: snapshot.snapshot_version,
            pool_id: pool.id,
            pool_code: pool.pool_code,
            supplier_id: pool.supplier_id,
            agreed_aggregate_qty: Number(snapshot.eligible_aggregate_qty),
            agreed_unit_price: Number(snapshot.candidate_unit_price),
            previous_pool_status: pool.status,
            new_pool_status: nextPoolStatus,
            rejection_reason_code: normalizedDecision === 'REJECT' ? rejectionReasonCode : null,
            inventory_allocation_id: allocation.id,
            inventory_status: allocation.status
          }
        },
        connection
      );

      // 13. System Audit Log
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, ?, ?, 'pools', ?, ?, ?)`,
        [
          actor.id,
          actor.role,
          normalizedDecision === 'ACCEPT' ? 'REGULAR_POOL_SUPPLIER_CONFIRMED' : 'REGULAR_POOL_SUPPLIER_REJECTED',
          pool.id,
          JSON.stringify({ status: pool.status, snapshot_status: snapshot.status }),
          JSON.stringify({
            status: nextPoolStatus,
            snapshot_status: nextSnapshotStatus,
            decision_code: decisionCode,
            decision: normalizedDecision,
            rejection_reason_code: normalizedDecision === 'REJECT' ? rejectionReasonCode : null
          })
        ]
      );

      if (shouldManageTransaction) {
        await connection.commit();
      }

      // 14. Return Allowlisted DTO (Edge Case 5: Zero buyer PII exposure)
      return {
        success: true,
        message: normalizedDecision === 'ACCEPT'
          ? 'Supplier successfully confirmed and committed to the qualified pool offer'
          : 'Supplier declined the qualified pool offer. Pool transitioned to SUPPLIER_FAILED.',
        data: {
          decision_code: decisionCode,
          pool_id: pool.id,
          pool_status: nextPoolStatus,
          snapshot_id: snapshot.id,
          decision: normalizedDecision,
          rejection_reason_code: normalizedDecision === 'REJECT' ? rejectionReasonCode : null,
          agreed_aggregate_qty: Number(snapshot.eligible_aggregate_qty),
          agreed_unit_price: Number(snapshot.candidate_unit_price),
          allocation_status: allocation.status,
          decision_timestamp: new Date()
        }
      };

    } catch (err) {
      if (shouldManageTransaction) {
        await connection.rollback();
      }
      throw err;
    } finally {
      if (shouldManageTransaction) {
        connection.release();
      }
    }
  }

  /**
   * Fetches authorized decision history and status for a pool.
   * Strictly sanitizes buyer PII and enforces ownership boundaries.
   * 
   * @param {number} poolId
   * @param {Object} actor - { id, role }
   * @returns {Promise<Object>}
   */
  async getPoolDecisionStatus(poolId, actor) {
    if (!poolId || isNaN(Number(poolId))) {
      const err = new Error('Valid poolId is required');
      err.code = 'INVALID_POOL_ID';
      err.statusCode = 400;
      throw err;
    }

    const [poolRows] = await db.query('SELECT * FROM pools WHERE id = ?', [poolId]);
    if (!poolRows || poolRows.length === 0) {
      const err = new Error(`Pool with ID ${poolId} not found`);
      err.code = 'POOL_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    const pool = poolRows[0];

    // Authorization:
    // - ADMIN / SUPER_ADMIN: Can view all
    // - SUPPLIER: Can view only own pool
    // - BUYER: Can view public commercial outcome (if they have an active or historical reservation in the pool)
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(actor.role);
    const isOwnerSupplier = actor.role === 'SUPPLIER' && Number(pool.supplier_id) === Number(actor.id);

    let isParticipatingBuyer = false;
    if (actor.role === 'BUYER') {
      const [buyerRes] = await db.query(
        'SELECT id FROM reservations WHERE pool_id = ? AND buyer_id = ? LIMIT 1',
        [poolId, actor.id]
      );
      isParticipatingBuyer = buyerRes.length > 0;
    }

    if (!isAdmin && !isOwnerSupplier && !isParticipatingBuyer) {
      const err = new Error('Access denied: You do not have authorization to view commercial decision details for this pool');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    const [decisions] = await db.query(
      `SELECT d.id, d.decision_code, d.pool_id, d.snapshot_id, d.decision,
              d.rejection_reason_code, d.agreed_aggregate_qty, d.agreed_unit_price,
              d.decision_timestamp, d.created_at
       FROM pool_supplier_commercial_decisions d
       WHERE d.pool_id = ?
       ORDER BY d.id DESC LIMIT 1`,
      [poolId]
    );

    const [snapshots] = await db.query(
      `SELECT id, snapshot_code, snapshot_version, qualification_status,
              eligible_aggregate_qty, candidate_unit_price, status,
              supplier_confirmation_deadline, buyer_commitment_deadline
       FROM pool_commercial_snapshots
       WHERE pool_id = ?
       ORDER BY snapshot_version DESC LIMIT 1`,
      [poolId]
    );

    const snapshot = snapshots[0] || null;
    const decision = decisions[0] || null;

    return {
      pool_id: pool.id,
      pool_code: pool.pool_code,
      pool_status: pool.status,
      has_decision: decision !== null,
      decision: decision ? {
        decision_code: decision.decision_code,
        decision: decision.decision,
        rejection_reason_code: decision.rejection_reason_code,
        agreed_aggregate_qty: Number(decision.agreed_aggregate_qty),
        agreed_unit_price: Number(decision.agreed_unit_price),
        decision_timestamp: decision.decision_timestamp
      } : null,
      qualification_snapshot: snapshot ? {
        id: snapshot.id,
        snapshot_code: snapshot.snapshot_code,
        qualification_status: snapshot.qualification_status,
        eligible_aggregate_qty: Number(snapshot.eligible_aggregate_qty),
        candidate_unit_price: Number(snapshot.candidate_unit_price),
        snapshot_status: snapshot.status,
        supplier_confirmation_deadline: snapshot.supplier_confirmation_deadline
      } : null
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * GET BUYER COMMERCIAL OFFER (Part 4D.4)
   * Constructs authoritative buyer-specific offer from stored qualification evidence,
   * supplier ACCEPT decision, and immutable terms.
   * ---------------------------------------------------------------------------
   */
  async getBuyerCommercialOffer({ reservationId, actor }) {
    if (!reservationId || isNaN(reservationId)) {
      const err = new Error('Valid numeric reservation ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id) {
      const err = new Error('Authenticated buyer identity is required');
      err.code = 'UNAUTHENTICATED';
      err.statusCode = 401;
      throw err;
    }

    // 1. Fetch reservation with linked pool, spec, and supplier details
    const [resRows] = await db.query(
      `SELECT r.*,
              p.id AS pool_id, p.pool_code, p.status AS pool_status, p.pool_unit,
              p.supplier_id, p.buyer_min_qty, p.purchase_increment, p.target_qty,
              p.supplier_min_qty, p.max_capacity, p.expires_at,
              p.delivery_type, p.delivery_zones, p.delivery_fee_policy, p.fulfilment_lead_time_days,
              p.supplier_confirmation_deadline, p.buyer_commitment_deadline,
              pr.title AS product_title, pr.category AS product_category,
              ps.id AS spec_id, ps.quality_grade, ps.spec_hash AS canonical_spec_hash,
              u.business_name AS supplier_business_name, u.verification_status AS supplier_verification_status
       FROM reservations r
       JOIN pools p ON r.pool_id = p.id
       JOIN products pr ON p.product_id = pr.id
       LEFT JOIN product_specifications ps ON p.product_spec_id = ps.id
       JOIN users u ON p.supplier_id = u.id
       WHERE r.id = ?`,
      [reservationId]
    );

    if (!resRows || resRows.length === 0) {
      const err = new Error(`Reservation with ID ${reservationId} not found`);
      err.code = 'RESERVATION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const reservation = resRows[0];

    // 2. Ownership & Authorization: Authenticated user must own the reservation (Admin can view for support)
    const isOwner = Number(reservation.buyer_id) === Number(actor.id);
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(actor.role);
    if (!isOwner && !isAdmin) {
      const err = new Error('You do not own this reservation');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    // 3. Buyer Account Suspension / Block Check
    const [buyerRows] = await db.query(
      `SELECT id, role, verification_status, buyer_trust_status FROM users WHERE id = ?`,
      [reservation.buyer_id]
    );
    const buyerUser = buyerRows[0] || null;
    if (!buyerUser || buyerUser.verification_status === 'BLOCKED' || buyerUser.buyer_trust_status === 'SUSPENDED') {
      const err = new Error('Buyer account is suspended or blocked. Cannot access commercial offer.');
      err.code = 'ACCOUNT_SUSPENDED';
      err.statusCode = 403;
      throw err;
    }

    // 4. Load Authoritative Qualification Snapshot
    const [snapshots] = await db.query(
      `SELECT * FROM pool_commercial_snapshots 
       WHERE pool_id = ? 
       ORDER BY snapshot_version DESC LIMIT 1`,
      [reservation.pool_id]
    );

    const snapshot = snapshots[0] || null;
    if (!snapshot || snapshot.qualification_status === 'UNQUALIFIED') {
      return {
        offer_available: false,
        reason_code: 'POOL_NOT_QUALIFIED',
        message: 'This pool did not achieve qualification. No commercial offer is available.',
        reservation_id: reservation.id,
        pool_id: reservation.pool_id,
        pool_status: reservation.pool_status
      };
    }

    // 5. Verify Buyer Inclusion in Snapshot Participating Reservations Cohort
    let cohort = [];
    try {
      cohort = typeof snapshot.participating_reservations_summary === 'string'
        ? JSON.parse(snapshot.participating_reservations_summary)
        : (snapshot.participating_reservations_summary || []);
    } catch (e) {
      cohort = [];
    }

    const inCohort = cohort.find(item => Number(item.id) === Number(reservation.id));
    if (!inCohort) {
      return {
        offer_available: false,
        reason_code: 'RESERVATION_NOT_IN_QUALIFIED_COHORT',
        message: 'This reservation was not part of the authoritative qualification cohort.',
        reservation_id: reservation.id,
        pool_id: reservation.pool_id
      };
    }

    // 6. Load Authoritative Supplier Decision
    const [suppDecisions] = await db.query(
      `SELECT * FROM pool_supplier_commercial_decisions 
       WHERE pool_id = ? AND snapshot_id = ? 
       ORDER BY id DESC LIMIT 1`,
      [reservation.pool_id, snapshot.id]
    );

    const supplierDecision = suppDecisions[0] || null;
    if (!supplierDecision || supplierDecision.decision !== 'ACCEPT') {
      return {
        offer_available: false,
        reason_code: supplierDecision ? 'SUPPLIER_REJECTED_OFFER' : 'AWAITING_SUPPLIER_DECISION',
        message: supplierDecision
          ? 'Supplier declined the commercial pool offer. No buyer offer available.'
          : 'Supplier has not yet accepted the qualified pool offer.',
        reservation_id: reservation.id,
        pool_id: reservation.pool_id,
        pool_status: reservation.pool_status
      };
    }

    // 7. Check Existing Buyer Decision on this Reservation & Snapshot
    const [existingBuyerDecs] = await db.query(
      `SELECT * FROM pool_buyer_commercial_decisions 
       WHERE reservation_id = ? AND snapshot_id = ? 
       ORDER BY id DESC LIMIT 1`,
      [reservation.id, snapshot.id]
    );

    const existingBuyerDecision = existingBuyerDecs[0] || null;

    // 8. Evaluate Deadline
    const effectiveDeadline = snapshot.buyer_commitment_deadline || reservation.buyer_commitment_deadline;
    const [timeRows] = await db.query(
      `SELECT (NOW() > ?) AS is_deadline_passed,
              (NOW() = ?) AS is_exact_boundary,
              NOW() AS db_now`,
      [effectiveDeadline, effectiveDeadline]
    );

    const isDeadlinePassed = Boolean(timeRows[0] && timeRows[0].is_deadline_passed);
    const isExactBoundary = Boolean(timeRows[0] && timeRows[0].is_exact_boundary);
    const isWindowClosed = isDeadlinePassed || isExactBoundary;

    // Actions permitted only if no decision recorded and deadline has not expired
    const canDecide = !existingBuyerDecision && !isWindowClosed && ['CONFIRMED'].includes(reservation.pool_status);

    const exactQty = Number(inCohort.quantity || reservation.quantity);
    const confirmedUnitPrice = Number(supplierDecision.agreed_unit_price);
    const confirmedSubtotal = Number((exactQty * confirmedUnitPrice).toFixed(2));

    return {
      offer_available: true,
      offer_id: `OFFER-POOL-${reservation.pool_id}-REV-${snapshot.snapshot_version}`,
      offer_version: snapshot.snapshot_version,
      snapshot_id: snapshot.id,
      snapshot_code: snapshot.snapshot_code,
      supplier_decision_id: supplierDecision.id,
      supplier_decision_code: supplierDecision.decision_code,
      pool: {
        id: reservation.pool_id,
        pool_code: reservation.pool_code,
        status: reservation.pool_status
      },
      reservation: {
        id: reservation.id,
        reservation_code: reservation.reservation_code,
        status: reservation.status,
        quantity: exactQty,
        unit: reservation.pool_unit
      },
      specification: {
        id: reservation.spec_id,
        product_title: reservation.product_title,
        category: reservation.product_category,
        quality_grade: reservation.quality_grade,
        canonical_spec_hash: reservation.canonical_spec_hash
      },
      supplier: {
        id: reservation.supplier_id,
        business_name: reservation.supplier_business_name,
        verification_status: reservation.supplier_verification_status
      },
      pricing: {
        currency: 'PKR',
        candidate_unit_price: confirmedUnitPrice,
        estimated_subtotal: confirmedSubtotal,
        contractual_price_status: existingBuyerDecision
          ? (existingBuyerDecision.decision === 'ACCEPT' ? 'LOCKED' : 'DECLINED')
          : (canDecide ? 'CONDITIONAL' : 'UNAVAILABLE')
      },
      commercial_terms: {
        delivery_type: snapshot.delivery_type,
        delivery_zones: snapshot.delivery_zones,
        delivery_fee_policy: snapshot.delivery_fee_policy,
        fulfilment_lead_time_days: snapshot.fulfilment_lead_time_days
      },
      fee_disclosure: {
        known_fees: [],
        disclosed_policy: snapshot.delivery_fee_policy || 'STANDARD_DELIVERY',
        unresolved_fees_warning: 'Final order invoice will include delivery fees according to the disclosed delivery policy upon order conversion.'
      },
      deadlines: {
        buyer_commitment_deadline: effectiveDeadline,
        db_now: timeRows[0] ? timeRows[0].db_now : null,
        is_window_closed: isWindowClosed
      },
      buyer_decision_status: {
        has_decision: existingBuyerDecision !== null,
        decision: existingBuyerDecision ? existingBuyerDecision.decision : null,
        decision_code: existingBuyerDecision ? existingBuyerDecision.decision_code : null,
        decision_timestamp: existingBuyerDecision ? existingBuyerDecision.decision_timestamp : null,
        price_lock_status: existingBuyerDecision ? existingBuyerDecision.price_lock_status : null,
        can_accept: canDecide,
        can_decline: canDecide,
        action_unavailable_reason: existingBuyerDecision
          ? 'DECISION_ALREADY_RECORDED'
          : (isWindowClosed ? 'DEADLINE_EXPIRED' : (reservation.pool_status !== 'CONFIRMED' ? 'POOL_NOT_CONFIRMED' : null))
      },
      order_handoff_eligible: existingBuyerDecision !== null && existingBuyerDecision.decision === 'ACCEPT'
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * RECORD BUYER COMMERCIAL DECISION (Part 4D.4)
   * Transactional, row-locked buyer ACCEPT or DECLINE.
   * Enforces DB-level uniqueness, immutable evidence, price locking on ACCEPT,
   * fresh post-lock deadline checking, and outbox event recording.
   * ---------------------------------------------------------------------------
   */
  async recordBuyerDecision({
    reservationId,
    actor,
    decision,
    declineReasonCode = null,
    declineReasonNotes = null,
    idempotencyKey = null,
    options = {}
  }) {
    if (!reservationId || isNaN(reservationId)) {
      const err = new Error('Valid numeric reservation ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id) {
      const err = new Error('Authenticated actor identity is required');
      err.code = 'UNAUTHENTICATED';
      err.statusCode = 401;
      throw err;
    }

    // Role check: Only strict BUYER can submit buyer decision (zero admin consent forgery)
    if (actor.role !== 'BUYER') {
      const err = new Error('Only the authenticated buyer who owns this reservation can submit a commercial decision');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    // Validate decision verb
    const normalizedDecision = String(decision || '').trim().toUpperCase();
    if (!['ACCEPT', 'DECLINE'].includes(normalizedDecision)) {
      const err = new Error("Invalid buyer decision verb. Must be 'ACCEPT' or 'DECLINE'.");
      err.code = 'INVALID_DECISION';
      err.statusCode = 400;
      throw err;
    }

    // Validate decline reason code if DECLINE
    const validDeclineCodes = [
      'PRICE_HIGH',
      'FOUND_ALTERNATIVE',
      'NO_LONGER_NEEDED',
      'DELIVERY_WINDOW_UNSUITABLE',
      'TERMS_UNACCEPTABLE',
      'OTHER'
    ];
    if (normalizedDecision === 'DECLINE') {
      if (!declineReasonCode || !validDeclineCodes.includes(declineReasonCode)) {
        const err = new Error(`Controlled decline_reason_code is required for DECLINE: ${validDeclineCodes.join(', ')}`);
        err.code = 'INVALID_DECLINE_REASON';
        err.statusCode = 400;
        throw err;
      }
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('Durable idempotencyKey is required for buyer commercial decision');
      err.code = 'MISSING_IDEMPOTENCY_KEY';
      err.statusCode = 400;
      throw err;
    }

    if (idempotencyKey.length > 128) {
      const err = new Error('Idempotency key exceeds maximum length of 128 characters');
      err.code = 'INVALID_IDEMPOTENCY_KEY';
      err.statusCode = 400;
      throw err;
    }

    const externalConnection = options.connection || null;
    const connection = externalConnection || await db.getConnection();
    const shouldManageTransaction = !externalConnection;

    try {
      if (shouldManageTransaction) {
        await connection.beginTransaction();
      }

      // 1. Lock Target Reservation FIRST to identify pool
      const [preRes] = await connection.query(
        `SELECT r.id, r.pool_id, r.buyer_id, r.quantity, r.status, r.unit_price, r.total_price 
         FROM reservations r WHERE r.id = ?`,
        [reservationId]
      );

      if (!preRes || preRes.length === 0) {
        const err = new Error(`Reservation with ID ${reservationId} not found`);
        err.code = 'RESERVATION_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const poolId = preRes[0].pool_id;

      // 2. Lock Parent Pool Row FIRST (Strict Lock Hierarchy to prevent deadlocks)
      const [poolRows] = await connection.query(
        `SELECT * FROM pools WHERE id = ? FOR UPDATE`,
        [poolId]
      );

      if (!poolRows || poolRows.length === 0) {
        const err = new Error(`Parent pool with ID ${poolId} not found`);
        err.code = 'POOL_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const pool = poolRows[0];

      // 3. Lock Target Reservation Row SECOND
      const [lockedResRows] = await connection.query(
        `SELECT * FROM reservations WHERE id = ? FOR UPDATE`,
        [reservationId]
      );
      const reservation = lockedResRows[0];

      // 4. Ownership Verification: Authenticated buyer must own reservation
      if (Number(reservation.buyer_id) !== Number(actor.id)) {
        const err = new Error('You do not own this reservation');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // 5. Live Fresh Buyer Eligibility & Trust Verification
      const [buyerUserRows] = await connection.query(
        `SELECT id, role, verification_status, buyer_trust_status FROM users WHERE id = ?`,
        [actor.id]
      );
      const buyerUser = buyerUserRows[0] || null;
      if (!buyerUser || buyerUser.verification_status === 'BLOCKED' || buyerUser.buyer_trust_status === 'SUSPENDED') {
        const err = new Error('Buyer account is suspended or blocked. Cannot record commercial decision.');
        err.code = 'ACCOUNT_SUSPENDED';
        err.statusCode = 403;
        throw err;
      }

      // 6. Validate Pool Commercial State: Must be CONFIRMED (Supplier ACCEPT confirmed)
      if (pool.status !== POOL_COMMERCIAL_STATES.CONFIRMED) {
        const err = new Error(`Pool is currently in '${pool.status}' status. Buyer decisions are only permitted on CONFIRMED pools.`);
        err.code = 'INVALID_POOL_STATE';
        err.statusCode = 422;
        throw err;
      }

      // 7. Load and Validate Authoritative Qualification Snapshot
      const [snapshots] = await connection.query(
        `SELECT * FROM pool_commercial_snapshots 
         WHERE pool_id = ? 
         ORDER BY snapshot_version DESC LIMIT 1 FOR UPDATE`,
        [poolId]
      );

      if (!snapshots || snapshots.length === 0) {
        const err = new Error('Authoritative qualification snapshot not found for this pool');
        err.code = 'SNAPSHOT_NOT_FOUND';
        err.statusCode = 422;
        throw err;
      }

      const snapshot = snapshots[0];
      if (snapshot.qualification_status === 'UNQUALIFIED') {
        const err = new Error('Pool snapshot was evaluated as UNQUALIFIED. Buyer decisions are blocked.');
        err.code = 'POOL_UNQUALIFIED';
        err.statusCode = 422;
        throw err;
      }

      // 8. Load and Validate Authoritative Supplier Decision
      const [suppDecisions] = await connection.query(
        `SELECT * FROM pool_supplier_commercial_decisions 
         WHERE pool_id = ? AND snapshot_id = ? 
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [poolId, snapshot.id]
      );

      if (!suppDecisions || suppDecisions.length === 0) {
        const err = new Error('Supplier decision not found for this qualified snapshot');
        err.code = 'SUPPLIER_DECISION_MISSING';
        err.statusCode = 422;
        throw err;
      }

      const supplierDecision = suppDecisions[0];
      if (supplierDecision.decision !== 'ACCEPT') {
        const err = new Error(`Supplier declined this pool offer (${supplierDecision.rejection_reason_code}). Buyer decisions are blocked.`);
        err.code = 'SUPPLIER_OFFER_REJECTED';
        err.statusCode = 422;
        throw err;
      }

      // 9. Verify Buyer Cohort Membership in Snapshot
      let cohort = [];
      try {
        cohort = typeof snapshot.participating_reservations_summary === 'string'
          ? JSON.parse(snapshot.participating_reservations_summary)
          : (snapshot.participating_reservations_summary || []);
      } catch (e) {
        cohort = [];
      }

      const inCohort = cohort.find(item => Number(item.id) === Number(reservation.id));
      if (!inCohort) {
        const err = new Error('Reservation was not part of the authoritative qualification snapshot cohort');
        err.code = 'RESERVATION_NOT_IN_QUALIFIED_COHORT';
        err.statusCode = 422;
        throw err;
      }

      // 10. Check for Existing Buyer Decision on this Reservation & Snapshot
      const [existingDecisions] = await connection.query(
        `SELECT * FROM pool_buyer_commercial_decisions 
         WHERE reservation_id = ? AND snapshot_id = ? 
         ORDER BY id DESC LIMIT 1`,
        [reservation.id, snapshot.id]
      );

      if (existingDecisions.length > 0) {
        const existingDec = existingDecisions[0];

        // Check if this caller holds the exact matching idempotency record for this operation
        const isMatchingKey = (existingDec.idempotency_key && existingDec.idempotency_key === idempotencyKey);

        if (isMatchingKey) {
          // Idempotent replay of already committed decision
          if (shouldManageTransaction) {
            await connection.rollback();
          }
          return {
            success: true,
            is_idempotent_replay: true,
            message: existingDec.decision === 'ACCEPT'
              ? 'Buyer decision already recorded: Accepted with contractual price locked'
              : 'Buyer decision already recorded: Declined',
            data: {
              decision_code: existingDec.decision_code,
              reservation_id: reservation.id,
              pool_id: pool.id,
              decision: existingDec.decision,
              accepted_quantity: Number(existingDec.accepted_quantity),
              agreed_unit_price: Number(existingDec.agreed_unit_price),
              price_lock_status: existingDec.price_lock_status,
              decision_timestamp: existingDec.decision_timestamp
            }
          };
        }

        // Different idempotency key attempting a second decision on the same reservation/snapshot: CONFLICT (409)
        const err = new Error(`An authoritative buyer decision (${existingDec.decision}) has already been recorded for this reservation and snapshot`);
        err.code = 'BUYER_DECISION_ALREADY_RECORDED';
        err.statusCode = 409;
        err.details = {
          existing_decision: existingDec.decision,
          existing_decision_code: existingDec.decision_code,
          decision_timestamp: existingDec.decision_timestamp
        };
        throw err;
      }

      // 11. Fresh Post-Lock Database Server Deadline Evaluation (OBS-68: Exclusive boundary)
      const effectiveDeadline = snapshot.buyer_commitment_deadline || pool.buyer_commitment_deadline;
      if (!effectiveDeadline) {
        const err = new Error('Buyer commitment deadline is missing or undefined. Operation failed closed.');
        err.code = 'MISSING_COMMITMENT_DEADLINE';
        err.statusCode = 422;
        throw err;
      }

      const [timeRows] = await connection.query(
        `SELECT (NOW() > ?) AS is_deadline_passed,
                (NOW() = ?) AS is_exact_boundary,
                NOW() AS db_now`,
        [effectiveDeadline, effectiveDeadline]
      );

      const isDeadlinePassed = Boolean(timeRows[0] && timeRows[0].is_deadline_passed);
      const isExactBoundary = Boolean(timeRows[0] && timeRows[0].is_exact_boundary);

      if (isDeadlinePassed || isExactBoundary) {
        const err = new Error('Buyer commitment window has expired according to database server time. New commercial decisions are blocked.');
        err.code = 'BUYER_COMMITMENT_DEADLINE_EXPIRED';
        err.statusCode = 422;
        err.details = {
          deadline: effectiveDeadline,
          db_now: timeRows[0].db_now
        };
        throw err;
      }

      // 12. Validate Quantities and Money Rules
      const exactAcceptedQty = Number(inCohort.quantity || reservation.quantity);
      const agreedUnitPrice = Number(supplierDecision.agreed_unit_price);
      const lockedTotalPrice = Number((exactAcceptedQty * agreedUnitPrice).toFixed(2));

      // 13. Generate Deterministic Event ID & Unique Decision Code
      const reservationEventService = require('./reservationEventService');
      const eventType = normalizedDecision === 'ACCEPT' ? 'BUYER_OFFER_ACCEPTED' : 'BUYER_OFFER_DECLINED';
      const eventId = reservationEventService.generateEventId({
        event_type: eventType,
        pool_id: pool.id,
        reservation_id: reservation.id,
        actor_id: actor.id,
        mutation_type: 'BUYER_DECISION',
        idempotency_key: idempotencyKey,
        event_sequence: 1
      });

      const randSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
      const decisionCode = `BDEC-${reservation.id}-${Date.now()}-${randSuffix}`;
      const priceLockStatus = normalizedDecision === 'ACCEPT' ? 'LOCKED' : 'DECLINED';

      // 14. Persist Immutable Buyer Decision Record in pool_buyer_commercial_decisions
      await connection.query(
        `INSERT INTO pool_buyer_commercial_decisions (
          decision_code, pool_id, reservation_id, snapshot_id, snapshot_version,
          supplier_decision_id, buyer_id, actor_id, actor_role, decision,
          decline_reason_code, decline_reason_notes, accepted_quantity,
          agreed_unit_price, currency, price_lock_status, originating_event_id,
          idempotency_key, decision_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, NOW())`,
        [
          decisionCode,
          pool.id,
          reservation.id,
          snapshot.id,
          snapshot.snapshot_version,
          supplierDecision.id,
          reservation.buyer_id,
          actor.id,
          actor.role,
          normalizedDecision,
          normalizedDecision === 'DECLINE' ? declineReasonCode : null,
          normalizedDecision === 'DECLINE' ? (declineReasonNotes ? declineReasonNotes.trim() : null) : null,
          exactAcceptedQty,
          agreedUnitPrice,
          priceLockStatus,
          eventId,
          idempotencyKey
        ]
      );

      // 15. Update Reservation State
      if (normalizedDecision === 'ACCEPT') {
        await connection.query(
          `UPDATE reservations
           SET status = 'CONFIRMED',
               unit_price = ?,
               total_price = ?,
               locked_unit_price = ?,
               locked_total_price = ?,
               confirmed_at = NOW(),
               updated_at = NOW()
           WHERE id = ?`,
          [agreedUnitPrice, lockedTotalPrice, agreedUnitPrice, lockedTotalPrice, reservation.id]
        );
      } else {
        // DECLINE: Reservation transitions to CANCELLED so it does not count as active demand
        await connection.query(
          `UPDATE reservations
           SET status = 'CANCELLED',
               updated_at = NOW()
           WHERE id = ?`,
          [reservation.id]
        );
      }

      // 16. Record Business Event in Outbox within the Same Transaction
      await reservationEventService.recordEvent(
        {
          event_id: eventId,
          event_type: eventType,
          pool_id: pool.id,
          reservation_id: reservation.id,
          actor_id: actor.id,
          actor_role: actor.role,
          idempotency_key: idempotencyKey,
          previous_quantity: exactAcceptedQty,
          new_quantity: normalizedDecision === 'ACCEPT' ? exactAcceptedQty : 0,
          previous_unit_price: Number(reservation.unit_price),
          new_unit_price: agreedUnitPrice,
          previous_aggregate_demand: Number(snapshot.eligible_aggregate_qty),
          new_aggregate_demand: Number(snapshot.eligible_aggregate_qty),
          event_payload: {
            decision_code: decisionCode,
            decision: normalizedDecision,
            pool_id: pool.id,
            reservation_id: reservation.id,
            snapshot_id: snapshot.id,
            supplier_decision_id: supplierDecision.id,
            buyer_id: reservation.buyer_id,
            accepted_quantity: exactAcceptedQty,
            agreed_unit_price: agreedUnitPrice,
            currency: 'PKR',
            price_lock_status: priceLockStatus,
            decline_reason_code: normalizedDecision === 'DECLINE' ? declineReasonCode : null
          }
        },
        connection
      );

      // 17. System Audit Log
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, ?, ?, 'reservations', ?, ?, ?)`,
        [
          actor.id,
          actor.role,
          normalizedDecision === 'ACCEPT' ? 'BUYER_OFFER_ACCEPTED' : 'BUYER_OFFER_DECLINED',
          reservation.id,
          JSON.stringify({ status: reservation.status, unit_price: reservation.unit_price }),
          JSON.stringify({
            status: normalizedDecision === 'ACCEPT' ? 'CONFIRMED' : 'CANCELLED',
            decision_code: decisionCode,
            decision: normalizedDecision,
            agreed_unit_price: agreedUnitPrice,
            locked_total_price: normalizedDecision === 'ACCEPT' ? lockedTotalPrice : null
          })
        ]
      );

      if (shouldManageTransaction) {
        await connection.commit();
      }

      return {
        success: true,
        message: normalizedDecision === 'ACCEPT'
          ? 'Buyer successfully accepted the qualified pool offer. Contractual unit price is locked.'
          : 'Buyer declined the qualified pool offer.',
        data: {
          decision_code: decisionCode,
          reservation_id: reservation.id,
          pool_id: pool.id,
          decision: normalizedDecision,
          accepted_quantity: exactAcceptedQty,
          agreed_unit_price: agreedUnitPrice,
          currency: 'PKR',
          price_lock_status: priceLockStatus,
          locked_total_price: normalizedDecision === 'ACCEPT' ? lockedTotalPrice : null,
          decision_timestamp: new Date()
        }
      };

    } catch (error) {
      if (shouldManageTransaction && connection) {
        try { await connection.rollback(); } catch (rbErr) {}
      }
      if (error.code === 'ER_DUP_ENTRY') {
        const dupErr = new Error('An authoritative buyer decision has already been recorded for this reservation and snapshot');
        dupErr.code = 'BUYER_DECISION_ALREADY_RECORDED';
        dupErr.statusCode = 409;
        throw dupErr;
      }
      throw error;
    } finally {
      if (shouldManageTransaction && connection) {
        connection.release();
      }
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * GET POOL COMMITTED DEMAND SUMMARY (Part 4D.4)
   * Calculates authoritative post-qualification buyer demand accounting:
   * Originally qualified demand, buyer-accepted demand, buyer-declined demand,
   * buyer-pending demand, and quorum verification against supplier minimum.
   * ---------------------------------------------------------------------------
   */
  async getPoolCommittedDemandSummary(poolId) {
    if (!poolId || isNaN(poolId)) {
      const err = new Error('Valid numeric pool ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    const [pools] = await db.query('SELECT * FROM pools WHERE id = ?', [poolId]);
    if (!pools || pools.length === 0) {
      const err = new Error(`Pool with ID ${poolId} not found`);
      err.code = 'POOL_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    const pool = pools[0];

    const [snapshots] = await db.query(
      `SELECT * FROM pool_commercial_snapshots 
       WHERE pool_id = ? 
       ORDER BY snapshot_version DESC LIMIT 1`,
      [poolId]
    );
    const snapshot = snapshots[0] || null;

    if (!snapshot) {
      return {
        pool_id: pool.id,
        has_snapshot: false,
        message: 'No commercial qualification snapshot exists for this pool'
      };
    }

    const [suppDecisions] = await db.query(
      `SELECT * FROM pool_supplier_commercial_decisions 
       WHERE pool_id = ? AND snapshot_id = ? 
       ORDER BY id DESC LIMIT 1`,
      [poolId, snapshot.id]
    );
    const suppDecision = suppDecisions[0] || null;

    // Buyer decisions aggregation
    const [buyerDecRows] = await db.query(
      `SELECT decision, 
              COALESCE(SUM(accepted_quantity), 0) AS total_qty,
              COUNT(*) AS decision_count
       FROM pool_buyer_commercial_decisions
       WHERE pool_id = ? AND snapshot_id = ?
       GROUP BY decision`,
      [poolId, snapshot.id]
    );

    let buyerAcceptedQty = 0;
    let buyerAcceptedCount = 0;
    let buyerDeclinedQty = 0;
    let buyerDeclinedCount = 0;

    buyerDecRows.forEach(row => {
      if (row.decision === 'ACCEPT') {
        buyerAcceptedQty = Number(row.total_qty);
        buyerAcceptedCount = Number(row.decision_count);
      } else if (row.decision === 'DECLINE') {
        buyerDeclinedQty = Number(row.total_qty);
        buyerDeclinedCount = Number(row.decision_count);
      }
    });

    const originalQualifiedDemand = Number(snapshot.eligible_aggregate_qty);
    const totalOriginalCount = Number(snapshot.participating_reservations_count);
    const buyerPendingCount = Math.max(0, totalOriginalCount - (buyerAcceptedCount + buyerDeclinedCount));
    const buyerPendingQty = Math.max(0, Number((originalQualifiedDemand - (buyerAcceptedQty + buyerDeclinedQty)).toFixed(4)));

    const supplierMinQty = Number(snapshot.supplier_min_qty);
    const finalQuorumMet = buyerAcceptedQty >= supplierMinQty;

    const [convertedOrders] = await db.query(
      `SELECT COALESCE(SUM(total_qty), 0) AS total_qty, COUNT(*) AS c 
       FROM orders 
       WHERE pool_id = ? AND order_status != 'CANCELLED'`,
      [poolId]
    );
    const convertedOrderDemand = Number(Number(convertedOrders[0].total_qty).toFixed(4));
    const convertedOrderCount = Number(convertedOrders[0].c);

    return {
      pool_id: pool.id,
      pool_code: pool.pool_code,
      pool_status: pool.status,
      snapshot_id: snapshot.id,
      snapshot_version: snapshot.snapshot_version,
      supplier_decision: suppDecision ? suppDecision.decision : null,
      accounting: {
        original_qualified_demand: originalQualifiedDemand,
        original_reservations_count: totalOriginalCount,
        supplier_accepted_demand: suppDecision ? Number(suppDecision.agreed_aggregate_qty) : null,
        buyer_accepted_demand: buyerAcceptedQty,
        buyer_accepted_count: buyerAcceptedCount,
        buyer_declined_demand: buyerDeclinedQty,
        buyer_declined_count: buyerDeclinedCount,
        buyer_pending_demand: buyerPendingQty,
        buyer_pending_count: buyerPendingCount,
        converted_order_demand: convertedOrderDemand,
        converted_order_count: convertedOrderCount,
        supplier_min_qty: supplierMinQty
      },
      quorum: {
        supplier_min_met: finalQuorumMet,
        deficit_to_minimum: Math.max(0, Number((supplierMinQty - buyerAcceptedQty).toFixed(4))),
        is_order_handoff_ready: finalQuorumMet && suppDecision && suppDecision.decision === 'ACCEPT'
      }
    };
  }
}

module.exports = {
  CommercialLifecycleService: new CommercialLifecycleService(),
  POOL_COMMERCIAL_STATES,
  POOL_STATE_TRANSITIONS,
  POOL_STATE_ROLE_AUTHORITY,
  RESERVATION_COMMERCIAL_STATES,
  RESERVATION_STATE_TRANSITIONS,
  ALLOCATION_COMMERCIAL_STATES,
  ALLOCATION_STATE_TRANSITIONS
};

