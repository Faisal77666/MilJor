// =============================================================================
// src/services/reservationEventService.js
// MilJor Part 4C.2B: Durable Reservation Business Events Outbox
// Emits and records immutable, durable business events for reservation operations
// and milestone crossings within the caller's active database transaction.
//
// Invariants:
// 1. Transactional atomicity: Events commit or rollback with the business operation.
// 2. Deterministic event deduplication: Replaying with same idempotency_key does not duplicate events.
// 3. Threshold crossings: Only emits threshold events when a boundary is genuinely crossed.
// 4. Privacy: Zero sensitive credentials, addresses, or unneeded buyer contact details.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/db');

class ReservationEventService {

  /**
   * Generates a stable, globally collision-resistant event identifier (OBS-35)
   * Derived from canonical scoped operation identity:
   * SHA256(actor_id : mutation_type : pool_id : reservation_id : idempotency_key : event_type : event_sequence)
   * 
   * @param {Object|string} typeOrParams
   * @param {number} [poolId]
   * @param {number|null} [reservationId]
   * @param {string|null} [idempotencyKey]
   * @returns {string}
   */
  generateEventId(typeOrParams, poolId, reservationId, idempotencyKey) {
    if (typeof typeOrParams === 'object' && typeOrParams !== null) {
      const {
        event_type,
        pool_id,
        reservation_id,
        actor_id,
        mutation_type,
        idempotency_key,
        event_sequence = 1
      } = typeOrParams;

      if (idempotency_key) {
        const canonical = JSON.stringify({
          actor: Number(actor_id) || 0,
          mutation: String(mutation_type || 'MUTATION'),
          pool: Number(pool_id) || 0,
          reservation: Number(reservation_id) || 0,
          idempotency_key: String(idempotency_key).trim(),
          event_type: String(event_type).trim(),
          seq: Number(event_sequence) || 1
        });
        const hash = crypto.createHash('sha256').update(canonical).digest('hex');
        const prefix = String(event_type).replace(/[^A-Z0-9]/gi, '').substring(0, 10).toUpperCase();
        return `EVT-${prefix}-${hash.substring(0, 32)}`;
      }

      const rand = crypto.randomBytes(16).toString('hex');
      const prefix = String(event_type).replace(/[^A-Z0-9]/gi, '').substring(0, 10).toUpperCase();
      return `EVT-${prefix}-${Date.now()}-${rand.substring(0, 16)}`;
    }

    // Legacy positional signature fallback: generateEventId(type, poolId, reservationId, idempotencyKey)
    const type = String(typeOrParams);
    if (idempotencyKey) {
      const canonical = JSON.stringify({
        actor: 0,
        mutation: 'LEGACY',
        pool: Number(poolId) || 0,
        reservation: Number(reservationId) || 0,
        idempotency_key: String(idempotencyKey).trim(),
        event_type: type.trim(),
        seq: 1
      });
      const hash = crypto.createHash('sha256').update(canonical).digest('hex');
      const prefix = type.replace(/[^A-Z0-9]/gi, '').substring(0, 10).toUpperCase();
      return `EVT-${prefix}-${hash.substring(0, 32)}`;
    }
    const rand = crypto.randomBytes(8).toString('hex');
    const prefix = type.replace(/[^A-Z0-9]/gi, '').substring(0, 10).toUpperCase();
    return `EVT-${prefix}-${Date.now()}-${rand}`;
  }

  /**
   * Canonicalizes an object or value recursively by sorting keys
   * and normalizing values for authoritative semantic comparison (OBS-39).
   *
   * @param {*} val
   * @returns {*}
   */
  _canonicalizeValue(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') {
      return Object.is(val, -0) ? 0 : val;
    }
    if (typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(item => this._canonicalizeValue(item));
    const sorted = {};
    for (const key of Object.keys(val).sort()) {
      if (val[key] !== undefined) {
        sorted[key] = this._canonicalizeValue(val[key]);
      }
    }
    return sorted;
  }

  /**
   * Authoritatively compares two JSON payloads for semantic equality (OBS-39).
   */
  _arePayloadsSemanticallyEqual(payloadA, payloadB) {
    try {
      const normA = typeof payloadA === 'string' ? JSON.parse(payloadA) : (payloadA || {});
      const normB = typeof payloadB === 'string' ? JSON.parse(payloadB) : (payloadB || {});
      return JSON.stringify(this._canonicalizeValue(normA)) === JSON.stringify(this._canonicalizeValue(normB));
    } catch (_) {
      return false;
    }
  }

  /**
   * Compares decimal values with exact numerical precision (OBS-39).
   */
  _areDecimalsEqual(d1, d2, precision = 4) {
    const isD1Null = d1 === null || d1 === undefined;
    const isD2Null = d2 === null || d2 === undefined;
    if (isD1Null && isD2Null) return true;
    if (isD1Null !== isD2Null) return false;
    const n1 = Number(Number(d1).toFixed(precision));
    const n2 = Number(Number(d2).toFixed(precision));
    return n1 === n2;
  }

  /**
   * Persists a single business event to reservation_business_events table (OBS-36 & OBS-39).
   * Employs explicit INSERT instead of INSERT IGNORE to prevent silent error suppression.
   * On ER_DUP_ENTRY duplicate-key errors, affirmatively verifies complete authoritative
   * semantic identity (type, pool, reservation, actor, role, idempotency_key, quantities,
   * aggregate demands, pricing, and canonical payload).
   * If any semantic attribute differs, throws EVENT_ID_COLLISION to rollback caller transaction.
   * Unexpected SQL errors are always propagated to force transaction rollback.
   *
   * @param {Object} eventData
   * @param {Object} connection - Mandatory active MySQL transaction connection
   */
  async recordEvent(eventData, connection) {
    const conn = connection || eventData.connection;
    if (!conn) {
      throw new Error('reservationEventService.recordEvent requires an active transaction connection');
    }

    const {
      event_id,
      event_type,
      pool_id,
      reservation_id,
      actor_id,
      actor_role,
      idempotency_key,
      previous_quantity,
      new_quantity,
      previous_aggregate_demand,
      new_aggregate_demand,
      previous_unit_price,
      new_unit_price,
      event_payload
    } = eventData;

    try {
      await conn.query(
        `INSERT INTO reservation_business_events (
          event_id, event_type, pool_id, reservation_id, actor_id, actor_role,
          idempotency_key, previous_quantity, new_quantity,
          previous_aggregate_demand, new_aggregate_demand,
          previous_unit_price, new_unit_price, event_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event_id,
          event_type,
          pool_id,
          reservation_id || null,
          actor_id,
          actor_role || 'BUYER',
          idempotency_key || null,
          previous_quantity !== undefined ? previous_quantity : null,
          new_quantity !== undefined ? new_quantity : null,
          previous_aggregate_demand !== undefined ? previous_aggregate_demand : null,
          new_aggregate_demand !== undefined ? new_aggregate_demand : null,
          previous_unit_price !== undefined ? previous_unit_price : null,
          new_unit_price !== undefined ? new_unit_price : null,
          JSON.stringify(event_payload || {})
        ]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        // Targeted duplicate handling: verify complete authoritative semantic identity (OBS-39)
        const [existing] = await conn.query(
          `SELECT id, event_id, event_type, pool_id, reservation_id, actor_id, actor_role,
                  idempotency_key, previous_quantity, new_quantity,
                  previous_aggregate_demand, new_aggregate_demand,
                  previous_unit_price, new_unit_price, event_payload
           FROM reservation_business_events
           WHERE event_id = ?`,
          [event_id]
        );

        if (existing.length > 0) {
          const row = existing[0];

          const typeMatches = String(row.event_type).trim() === String(event_type).trim();
          const poolMatches = Number(row.pool_id) === Number(pool_id);
          const actorMatches = Number(row.actor_id) === Number(actor_id);
          const roleMatches = String(row.actor_role || 'BUYER').trim() === String(actor_role || 'BUYER').trim();
          const resMatches = (Number(row.reservation_id) || null) === (Number(reservation_id) || null);
          const idempMatches = (row.idempotency_key ? String(row.idempotency_key).trim() : null) === 
                               (idempotency_key ? String(idempotency_key).trim() : null);

          // Decimal snapshot comparisons (4 decimal places for quantities, 2 for prices)
          const prevQtyMatches = this._areDecimalsEqual(row.previous_quantity, previous_quantity, 4);
          const newQtyMatches = this._areDecimalsEqual(row.new_quantity, new_quantity, 4);
          const prevAggMatches = this._areDecimalsEqual(row.previous_aggregate_demand, previous_aggregate_demand, 4);
          const newAggMatches = this._areDecimalsEqual(row.new_aggregate_demand, new_aggregate_demand, 4);
          const prevPriceMatches = this._areDecimalsEqual(row.previous_unit_price, previous_unit_price, 2);
          const newPriceMatches = this._areDecimalsEqual(row.new_unit_price, new_unit_price, 2);

          // Authoritative normalized payload comparison (OBS-39)
          const payloadMatches = this._arePayloadsSemanticallyEqual(row.event_payload, event_payload);

          const isAuthoritativelyIdentical = (
            typeMatches &&
            poolMatches &&
            actorMatches &&
            roleMatches &&
            resMatches &&
            idempMatches &&
            prevQtyMatches &&
            newQtyMatches &&
            prevAggMatches &&
            newAggMatches &&
            prevPriceMatches &&
            newPriceMatches &&
            payloadMatches
          );

          if (isAuthoritativelyIdentical) {
            // Legitimate idempotent replay of the exact same committed operation: safe to reuse
            return;
          }

          // Conflicting duplicate: same event_id but altered business content
          const diffReasons = [];
          if (!typeMatches) diffReasons.push(`type(${row.event_type} != ${event_type})`);
          if (!poolMatches) diffReasons.push(`pool(${row.pool_id} != ${pool_id})`);
          if (!actorMatches) diffReasons.push(`actor(${row.actor_id} != ${actor_id})`);
          if (!roleMatches) diffReasons.push(`role(${row.actor_role} != ${actor_role})`);
          if (!resMatches) diffReasons.push(`reservation(${row.reservation_id} != ${reservation_id})`);
          if (!idempMatches) diffReasons.push(`idempotency_key`);
          if (!prevQtyMatches || !newQtyMatches) diffReasons.push(`quantities(prev: ${row.previous_quantity} vs ${previous_quantity}, new: ${row.new_quantity} vs ${new_quantity})`);
          if (!prevAggMatches || !newAggMatches) diffReasons.push(`aggregate_demand`);
          if (!prevPriceMatches || !newPriceMatches) diffReasons.push(`pricing`);
          if (!payloadMatches) diffReasons.push(`payload_snapshot`);

          const conflictErr = new Error(
            `EVENT_ID_COLLISION: Event ID '${event_id}' already exists with differing semantic business content: [${diffReasons.join(', ')}]`
          );
          conflictErr.code = 'EVENT_ID_COLLISION';
          conflictErr.status = 409;
          throw conflictErr;
        }
      }

      // Unexpected SQL errors (foreign key failures, table locks, invalid types, etc.):
      // Propagate immediately so caller's transaction rolls back!
      throw err;
    }
  }

  /**
   * Records a complete mutation transaction including reservation event, demand change,
   * tier change, and milestone crossing events (SUPPLIER_MINIMUM_REACHED/LOST, TARGET_REACHED/LOST).
   *
   * @param {Object} params
   * @param {Object} connection - Mandatory transaction connection
   */
  async recordReservationMutationEvents(params, connection) {
    const conn = connection || params.connection;
    if (!conn) {
      throw new Error('reservationEventService.recordReservationMutationEvents requires an active transaction connection');
    }

    const pool_id = params.pool_id !== undefined ? params.pool_id : params.poolId;
    const reservation_id = params.reservation_id !== undefined ? params.reservation_id : params.reservationId;
    const actor_id = params.actor_id !== undefined ? params.actor_id : (params.actorId || params.buyerId || params.buyer_id);
    const actor_role = params.actor_role || params.actorRole || 'BUYER';
    const idempotency_key = params.idempotency_key !== undefined ? params.idempotency_key : params.idempotencyKey;
    const mutation_type = params.mutation_type || params.mutationType;

    const oldQty = Number(params.old_quantity !== undefined ? params.old_quantity : (params.previousQty !== undefined ? params.previousQty : 0)) || 0;
    const newQty = Number(params.new_quantity !== undefined ? params.new_quantity : (params.newQty !== undefined ? params.newQty : 0)) || 0;
    const oldAgg = Number(params.old_aggregate_demand !== undefined ? params.old_aggregate_demand : (params.previousAggregateQty !== undefined ? params.previousAggregateQty : 0)) || 0;
    const newAgg = Number(params.new_aggregate_demand !== undefined ? params.new_aggregate_demand : (params.newAggregateQty !== undefined ? params.newAggregateQty : 0)) || 0;
    const old_unit_price = params.old_unit_price !== undefined ? params.old_unit_price : params.previousUnitPrice;
    const new_unit_price = params.new_unit_price !== undefined ? params.new_unit_price : params.newUnitPrice;
    const suppMin = Number(params.supplier_min_qty !== undefined ? params.supplier_min_qty : params.supplierMinQty);
    const target = Number(params.target_qty !== undefined ? params.target_qty : params.targetQty);
    const old_tier_index = params.old_tier_index !== undefined ? params.old_tier_index : params.previousTierIndex;
    const new_tier_index = params.new_tier_index !== undefined ? params.new_tier_index : params.newTierIndex;
    const extra_payload = params.extra_payload || params.metadata || {};

    // 1. Primary reservation event (sequence = 1)
    let primaryEventType = 'RESERVATION_CREATED';
    if (mutation_type === 'CREATE') {
      primaryEventType = 'RESERVATION_CREATED';
    } else if (mutation_type === 'CANCEL') {
      primaryEventType = 'RESERVATION_CANCELLED';
    } else if (mutation_type === 'UPDATE' || mutation_type === 'QUANTITY_INCREASED' || mutation_type === 'QUANTITY_DECREASED') {
      if (newQty > oldQty) {
        primaryEventType = 'RESERVATION_QUANTITY_INCREASED';
      } else if (newQty < oldQty) {
        primaryEventType = 'RESERVATION_QUANTITY_DECREASED';
      } else {
        return; // No-op, no events emitted
      }
    }

    const primaryEventId = this.generateEventId({
      event_type: primaryEventType,
      pool_id,
      reservation_id,
      actor_id,
      mutation_type,
      idempotency_key,
      event_sequence: 1
    });

    await this.recordEvent({
      event_id: primaryEventId,
      event_type: primaryEventType,
      pool_id,
      reservation_id,
      actor_id,
      actor_role,
      idempotency_key,
      previous_quantity: oldQty,
      new_quantity: newQty,
      previous_aggregate_demand: oldAgg,
      new_aggregate_demand: newAgg,
      previous_unit_price: old_unit_price,
      new_unit_price: new_unit_price,
      event_payload: {
        mutation_type,
        pool_id,
        reservation_id,
        event_sequence: 1,
        delta_quantity: Number((newQty - oldQty).toFixed(4)),
        ...(extra_payload || {})
      }
    }, conn);

    // 2. Pool demand changed event (sequence = 2)
    if (Math.abs(newAgg - oldAgg) > 0.00001) {
      const demandEventId = this.generateEventId({
        event_type: 'POOL_DEMAND_CHANGED',
        pool_id,
        reservation_id,
        actor_id,
        mutation_type,
        idempotency_key,
        event_sequence: 2
      });

      await this.recordEvent({
        event_id: demandEventId,
        event_type: 'POOL_DEMAND_CHANGED',
        pool_id,
        reservation_id,
        actor_id,
        actor_role,
        idempotency_key,
        previous_aggregate_demand: oldAgg,
        new_aggregate_demand: newAgg,
        event_payload: {
          mutation_type,
          event_sequence: 2,
          previous_demand: oldAgg,
          new_demand: newAgg,
          delta_demand: Number((newAgg - oldAgg).toFixed(4))
        }
      }, conn);
    }

    // 3. Milestone crossings: Supplier Minimum (sequence = 3)
    const oldSuppMinMet = oldAgg >= suppMin;
    const newSuppMinMet = newAgg >= suppMin;
    if (!oldSuppMinMet && newSuppMinMet) {
      const minReachedId = this.generateEventId({
        event_type: 'SUPPLIER_MINIMUM_REACHED',
        pool_id,
        reservation_id,
        actor_id,
        mutation_type,
        idempotency_key,
        event_sequence: 3
      });

      await this.recordEvent({
        event_id: minReachedId,
        event_type: 'SUPPLIER_MINIMUM_REACHED',
        pool_id,
        reservation_id,
        actor_id,
        actor_role,
        idempotency_key,
        previous_aggregate_demand: oldAgg,
        new_aggregate_demand: newAgg,
        event_payload: {
          mutation_type,
          event_sequence: 3,
          supplier_min_qty: suppMin,
          aggregate_demand: newAgg
        }
      }, conn);
    } else if (oldSuppMinMet && !newSuppMinMet) {
      const minLostId = this.generateEventId({
        event_type: 'SUPPLIER_MINIMUM_LOST',
        pool_id,
        reservation_id,
        actor_id,
        mutation_type,
        idempotency_key,
        event_sequence: 3
      });

      await this.recordEvent({
        event_id: minLostId,
        event_type: 'SUPPLIER_MINIMUM_LOST',
        pool_id,
        reservation_id,
        actor_id,
        actor_role,
        idempotency_key,
        previous_aggregate_demand: oldAgg,
        new_aggregate_demand: newAgg,
        event_payload: {
          mutation_type,
          event_sequence: 3,
          supplier_min_qty: suppMin,
          aggregate_demand: newAgg
        }
      }, conn);
    }

    // 4. Milestone crossings: Target Demand (sequence = 4)
    const oldTargetMet = oldAgg >= target;
    const newTargetMet = newAgg >= target;
    if (!oldTargetMet && newTargetMet) {
      const targetReachedId = this.generateEventId({
        event_type: 'TARGET_REACHED',
        pool_id,
        reservation_id,
        actor_id,
        mutation_type,
        idempotency_key,
        event_sequence: 4
      });

      await this.recordEvent({
        event_id: targetReachedId,
        event_type: 'TARGET_REACHED',
        pool_id,
        reservation_id,
        actor_id,
        actor_role,
        idempotency_key,
        previous_aggregate_demand: oldAgg,
        new_aggregate_demand: newAgg,
        event_payload: {
          mutation_type,
          event_sequence: 4,
          target_qty: target,
          aggregate_demand: newAgg
        }
      }, conn);
    } else if (oldTargetMet && !newTargetMet) {
      const targetLostId = this.generateEventId({
        event_type: 'TARGET_LOST',
        pool_id,
        reservation_id,
        actor_id,
        mutation_type,
        idempotency_key,
        event_sequence: 4
      });

      await this.recordEvent({
        event_id: targetLostId,
        event_type: 'TARGET_LOST',
        pool_id,
        reservation_id,
        actor_id,
        actor_role,
        idempotency_key,
        previous_aggregate_demand: oldAgg,
        new_aggregate_demand: newAgg,
        event_payload: {
          mutation_type,
          event_sequence: 4,
          target_qty: target,
          aggregate_demand: newAgg
        }
      }, conn);
    }

    // 5. Tier changes: POOL_TIER_CHANGED (sequence = 5)
    if (old_tier_index !== undefined && new_tier_index !== undefined && old_tier_index !== new_tier_index) {
      const tierEventId = this.generateEventId({
        event_type: 'POOL_TIER_CHANGED',
        pool_id,
        reservation_id,
        actor_id,
        mutation_type,
        idempotency_key,
        event_sequence: 5
      });

      await this.recordEvent({
        event_id: tierEventId,
        event_type: 'POOL_TIER_CHANGED',
        pool_id,
        reservation_id,
        actor_id,
        actor_role,
        idempotency_key,
        previous_unit_price: old_unit_price,
        new_unit_price: new_unit_price,
        event_payload: {
          mutation_type,
          event_sequence: 5,
          previous_tier_index: old_tier_index,
          new_tier_index: new_tier_index,
          previous_unit_price: old_unit_price,
          new_unit_price: new_unit_price,
          is_tier_upgrade: new_tier_index > old_tier_index
        }
      }, conn);
    }
  }

  /**
   * Retrieves durable business events for a pool (e.g. for audits, supplier event stream)
   * @param {number} poolId
   * @param {Object} options - { limit?: number, offset?: number }
   * @returns {Promise<Array>}
   */
  async getPoolEvents(poolId, options = {}) {
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));
    const offset = Math.max(0, parseInt(options.offset, 10) || 0);

    const [rows] = await db.query(
      `SELECT id, event_id, event_type, pool_id, reservation_id, actor_role,
              previous_quantity, new_quantity, previous_aggregate_demand, new_aggregate_demand,
              previous_unit_price, new_unit_price, event_payload, created_at
       FROM reservation_business_events
       WHERE pool_id = ?
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [poolId, limit, offset]
    );

    return rows.map(r => ({
      ...r,
      event_payload: typeof r.event_payload === 'string' ? JSON.parse(r.event_payload) : r.event_payload
    }));
  }
}

module.exports = new ReservationEventService();
