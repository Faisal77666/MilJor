// =============================================================================
// src/middlewares/idempotencyGuard.js
// MilJor Transactional Idempotency & Reconciliation Guard
// Implements Atomic Key Reservation, Payload Fingerprinting, Actor Scoping,
// Business State Reconciliation, Crash Recovery, and Heartbeat Liveness.
// =============================================================================
const crypto = require('crypto');
const db = require('../config/db');

function calculateRequestHash(req) {
  const content = {
    method: req.method,
    url: req.originalUrl || req.url,
    body: req.body || {}
  };
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * Reconciles whether an uncompleted mutation already committed in the database.
 * Used during crash recovery to prevent duplicate business execution.
 *
 * @param {Object} record - The idempotency_records row
 * @param {Object} req - The incoming request
 * @returns {Promise<Object|null>} - Returns cached response object if found, or null
 */
async function reconcileCommittedBusinessOperation(record, req) {
  if (record.idempotency_key) {
    // Check payment_attempts for initiated checkout sessions
    const [attRows] = await db.query(
      `SELECT pa.*, o.order_code FROM payment_attempts pa
       JOIN orders o ON pa.order_id = o.id
       WHERE pa.idempotency_key = ? ORDER BY pa.id DESC LIMIT 1`,
      [record.idempotency_key]
    );
    if (attRows.length > 0) {
      const att = attRows[0];
      return {
        status: 200,
        body: {
          success: true,
          message: 'Checkout session retrieved (idempotent replay)',
          data: {
            attempt_code: att.attempt_code,
            order_id: att.order_id,
            order_code: att.order_code,
            amount: Number(att.amount),
            currency: att.currency,
            provider: att.provider,
            environment: att.environment,
            status: att.status,
            provider_tracker_token: att.provider_tracker_token,
            checkout_url: att.checkout_url,
            created_at: att.created_at
          }
        }
      };
    }

    const [mutRows] = await db.query(
      `SELECT response_payload, mutation_type FROM reservation_mutation_history 
       WHERE idempotency_key = ? ORDER BY id DESC LIMIT 1`,
      [record.idempotency_key]
    );
    if (mutRows.length > 0) {
      const payload = typeof mutRows[0].response_payload === 'string' 
        ? JSON.parse(mutRows[0].response_payload) 
        : mutRows[0].response_payload;
      return {
        status: 200,
        body: payload
      };
    }
  }

    // If record already has linked resource_id and resource_type
  if (record.resource_type === 'orders' && record.resource_id) {
    const [orderRows] = await db.query(
      `SELECT * FROM orders WHERE id = ?`,
      [record.resource_id]
    );
    if (orderRows.length > 0) {
      const order = orderRows[0];
      return {
        status: 200,
        body: {
          success: true,
          message: 'Existing order retrieved successfully for this commitment',
          data: {
            order: {
              id: order.id,
              order_code: order.order_code,
              reservation_id: order.reservation_id,
              pool_id: order.pool_id,
              buyer_id: order.buyer_id,
              supplier_id: order.supplier_id,
              snapshot_id: order.snapshot_id,
              buyer_decision_id: order.buyer_decision_id,
              total_qty: Number(order.total_qty),
              unit_price: Number(order.unit_price),
              subtotal_amount: Number(order.subtotal_amount),
              delivery_fee: Number(order.delivery_fee),
              buyer_platform_fee: Number(order.buyer_platform_fee),
              total_amount: Number(order.total_amount),
              currency: order.currency,
              delivery_type: order.delivery_type,
              delivery_address: order.delivery_address,
              cluster_zone: order.cluster_zone,
              payment_status: order.payment_status,
              order_status: order.order_status,
              financial_breakdown: {
                total_qty: Number(order.total_qty),
                unit_price: Number(order.unit_price),
                subtotal_amount: Number(order.subtotal_amount),
                delivery_fee: Number(order.delivery_fee),
                buyer_platform_fee: Number(order.buyer_platform_fee),
                tax_amount: 0.00,
                tax_status: 'EXEMPT_OR_NOT_APPLICABLE',
                total_payable_amount: Number(order.total_amount),
                currency: 'PKR'
              },
              created_at: order.created_at
            },
            is_replay: true
          }
        }
      };
    }
  }

  if (record.resource_type === 'reservations' && record.resource_id) {
    const [resRows] = await db.query(
      `SELECT r.*, p.pool_code, p.status AS pool_status, p.pool_unit, p.supplier_id, p.buyer_min_qty,
              p.purchase_increment, p.target_qty, p.supplier_min_qty, p.max_capacity, p.expires_at,
              pr.title AS product_title, pr.category AS product_category,
              ps.id AS spec_id, ps.quality_grade, ps.spec_hash AS canonical_spec_hash,
              u.business_name AS supplier_business_name, u.verification_status AS supplier_verification_status
       FROM reservations r
       JOIN pools p ON r.pool_id = p.id
       JOIN products pr ON p.product_id = pr.id
       LEFT JOIN product_specifications ps ON p.product_spec_id = ps.id
       JOIN users u ON p.supplier_id = u.id
       WHERE r.id = ?`,
      [record.resource_id]
    );

    if (resRows.length > 0) {
      const reservation = resRows[0];
      if (req.originalUrl && req.originalUrl.includes('/order')) {
        const [orders] = await db.query(
          `SELECT * FROM orders WHERE reservation_id = ? ORDER BY id DESC LIMIT 1`,
          [reservation.id]
        );
        if (orders.length > 0) {
          const order = orders[0];
          return {
            status: 200,
            body: {
              success: true,
              message: 'Existing order retrieved successfully for this commitment',
              data: {
                order: {
                  id: order.id,
                  order_code: order.order_code,
                  reservation_id: order.reservation_id,
                  pool_id: order.pool_id,
                  buyer_id: order.buyer_id,
                  supplier_id: order.supplier_id,
                  snapshot_id: order.snapshot_id,
                  buyer_decision_id: order.buyer_decision_id,
                  total_qty: Number(order.total_qty),
                  unit_price: Number(order.unit_price),
                  subtotal_amount: Number(order.subtotal_amount),
                  delivery_fee: Number(order.delivery_fee),
                  buyer_platform_fee: Number(order.buyer_platform_fee),
                  total_amount: Number(order.total_amount),
                  currency: order.currency,
                  delivery_type: order.delivery_type,
                  delivery_address: order.delivery_address,
                  cluster_zone: order.cluster_zone,
                  payment_status: order.payment_status,
                  order_status: order.order_status,
                  created_at: order.created_at
                },
                is_replay: true
              }
            }
          };
        }
      }
      if (req.originalUrl && req.originalUrl.includes('/final-decision')) {
        const [decisions] = await db.query(
          `SELECT * FROM pool_buyer_commercial_decisions WHERE reservation_id = ? ORDER BY id DESC LIMIT 1`,
          [reservation.id]
        );
        if (decisions.length > 0) {
          const dec = decisions[0];
          return {
            status: 200,
            body: {
              success: true,
              message: dec.decision === 'ACCEPT'
                ? 'Buyer successfully accepted the qualified pool offer. Contractual unit price is locked.'
                : 'Buyer declined the qualified pool offer.',
              data: {
                decision_code: dec.decision_code,
                reservation_id: reservation.id,
                pool_id: reservation.pool_id,
                decision: dec.decision,
                accepted_quantity: Number(dec.accepted_quantity),
                agreed_unit_price: Number(dec.agreed_unit_price),
                currency: dec.currency,
                price_lock_status: dec.price_lock_status,
                locked_total_price: dec.decision === 'ACCEPT' ? Number((Number(dec.accepted_quantity) * Number(dec.agreed_unit_price)).toFixed(2)) : null,
                decision_timestamp: dec.decision_timestamp
              }
            }
          };
        }
      }

      const [tiers] = await db.query(
        'SELECT id, min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
        [reservation.pool_id]
      );
      const tierPricingService = require('../services/tierPricingService');
      const pricingEval = tierPricingService.calculateApplicablePrice(tiers, Number(reservation.quantity), Number(reservation.supplier_min_qty));

      const [aggRows] = await db.query(
        `SELECT COALESCE(SUM(quantity), 0) AS aggregate_qty
         FROM reservations
         WHERE pool_id = ? AND status NOT IN ('CANCELLED', 'EXPIRED')`,
        [reservation.pool_id]
      );
      const currentAggregateQty = Number(aggRows[0].aggregate_qty);
      const maxCap = reservation.max_capacity !== null ? Number(reservation.max_capacity) : null;
      const targetQty = Number(reservation.target_qty);
      const suppMinQty = Number(reservation.supplier_min_qty);
      const effectiveCap = maxCap !== null ? maxCap : targetQty;
      const remainingCapacity = Math.max(0, Number((effectiveCap - currentAggregateQty).toFixed(4)));

      return {
        status: 201,
        body: {
          success: true,
          message: 'Quantity reserved successfully in pool',
          data: {
            reservation: {
              id: reservation.id,
              reservation_code: reservation.reservation_code,
              pool_id: reservation.pool_id,
              pool_code: reservation.pool_code,
              buyer_id: reservation.buyer_id,
              quantity: Number(reservation.quantity),
              unit_price: Number(reservation.unit_price),
              total_price: Number(reservation.total_price),
              status: reservation.status,
              created_at: reservation.created_at
            },
            pool: {
              id: reservation.pool_id,
              pool_code: reservation.pool_code,
              status: reservation.pool_status,
              pool_unit: reservation.pool_unit,
              expires_at: reservation.expires_at,
              cancellation_terms: 'Buyer cancellation permitted while pool is open (RESERVED state). Once pool qualifies and supplier confirms, commitment and price lock apply.'
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
            aggregate_progress: {
              current_aggregate_qty: currentAggregateQty,
              remaining_pool_capacity: remainingCapacity,
              supplier_min_qty: suppMinQty,
              target_qty: targetQty,
              max_capacity: maxCap,
              progress_toward_supplier_min_pct: Number(Math.min(100, (currentAggregateQty / suppMinQty) * 100).toFixed(1)),
              progress_toward_target_pct: Number(Math.min(100, (currentAggregateQty / targetQty) * 100).toFixed(1)),
              supplier_min_met: currentAggregateQty >= suppMinQty,
              target_met: currentAggregateQty >= targetQty
            },
            pricing: {
              estimated_unit_price: Number(reservation.unit_price),
              estimated_subtotal: Number(reservation.total_price),
              pricing_mode: currentAggregateQty >= suppMinQty ? 'ESTIMATED_TIER_CONFIRMABLE' : 'ESTIMATED_PRE_MINIMUM',
              current_tier_index: pricingEval.tierIndex,
              next_tier: pricingEval.nextTier ? {
                min_qty: Number(pricingEval.nextTier.min_qty),
                max_qty: Number(pricingEval.nextTier.max_qty),
                price_per_unit: Number(pricingEval.nextTier.price_per_unit),
                additional_qty_needed: Number(Math.max(0, Number(pricingEval.nextTier.min_qty) - currentAggregateQty).toFixed(4))
              } : null
            }
          }
        }
      };
    }
  }

  // If record already has linked resource_id and resource_type (pools)
  if (record.resource_type === 'pools' && record.resource_id) {
    const [pools] = await db.query('SELECT * FROM pools WHERE id = ?', [record.resource_id]);
    if (pools.length > 0) {
      const pool = pools[0];
      const [tiers] = await db.query(
        'SELECT id, min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
        [pool.id]
      );
      const fullPool = { ...pool, price_tiers: tiers };

      if (req.originalUrl.includes('/supplier-decision')) {
        const [decisions] = await db.query(
          `SELECT * FROM pool_supplier_commercial_decisions WHERE pool_id = ? ORDER BY id DESC LIMIT 1`,
          [pool.id]
        );
        if (decisions.length > 0) {
          const dec = decisions[0];
          const [allocs] = await db.query(
            `SELECT * FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL' AND status = 'COMMITTED'`,
            [pool.id]
          );
          return {
            status: 200,
            body: {
              success: true,
              message: dec.decision === 'ACCEPT'
                ? 'Supplier successfully confirmed and committed to the qualified pool offer'
                : 'Supplier declined the qualified pool offer. Pool transitioned to SUPPLIER_FAILED.',
              data: {
                decision_code: dec.decision_code,
                pool_id: pool.id,
                pool_status: pool.status,
                snapshot_id: dec.snapshot_id,
                decision: dec.decision,
                rejection_reason_code: dec.rejection_reason_code,
                agreed_aggregate_qty: Number(dec.agreed_aggregate_qty),
                agreed_unit_price: Number(dec.agreed_unit_price),
                allocation_status: allocs[0] ? allocs[0].status : 'COMMITTED',
                decision_timestamp: dec.decision_timestamp
              }
            }
          };
        }
      } else if (req.originalUrl.includes('/qualify')) {
        const [snapshots] = await db.query(
          `SELECT * FROM pool_commercial_snapshots WHERE pool_id = ? ORDER BY snapshot_version DESC LIMIT 1`,
          [pool.id]
        );
        if (snapshots.length > 0) {
          const snap = snapshots[0];
          return {
            status: 200,
            body: {
              success: true,
              message: pool.status === 'AWAITING_SUPPLIER_CONFIRMATION'
                ? 'Pool successfully qualified and advanced to AWAITING_SUPPLIER_CONFIRMATION'
                : 'Pool evaluated as unqualified (demand below supplier minimum) and closed as EXPIRED',
              data: {
                pool_id: pool.id,
                status: pool.status,
                qualification_status: snap.qualification_status,
                qualified: snap.qualification_status !== 'UNQUALIFIED',
                snapshot_id: snap.id,
                snapshot_code: snap.snapshot_code,
                snapshot_version: snap.snapshot_version,
                eligible_aggregate_qty: Number(snap.eligible_aggregate_qty),
                supplier_min_qty: Number(snap.supplier_min_qty),
                target_qty: Number(snap.target_qty),
                max_capacity: Number(snap.max_capacity),
                candidate_unit_price: Number(snap.candidate_unit_price),
                participating_reservations_count: snap.participating_reservations_count
              }
            }
          };
        }
      } else if (req.originalUrl.includes('/publish')) {
        const [allocs] = await db.query(
          `SELECT * FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL' AND status = 'COMMITTED'`,
          [pool.id]
        );
        return {
          status: 200,
          body: {
            success: true,
            message: 'Regular pool published successfully. Commercial terms are locked and inventory is allocated.',
            data: {
              pool: fullPool,
              inventory_allocation: allocs[0] ? {
                allocated_qty: Number(allocs[0].allocated_qty),
                allocation_unit: allocs[0].unit,
                status: allocs[0].status
              } : null
            }
          }
        };
      } else {
        // Pool creation
        return {
          status: 201,
          body: {
            success: true,
            message: 'Regular Pool draft created successfully',
            data: { pool: fullPool }
          }
        };
      }
    }
  }

  // Fallback: If resource_id was not yet stamped onto record, inspect system_audit_logs for this actor & key
  const [auditRows] = await db.query(
    `SELECT entity_id, new_value, action FROM system_audit_logs 
     WHERE actor_id = ? AND action IN ('REGULAR_POOL_DRAFT_CREATED', 'REGULAR_POOL_PUBLISHED', 'RESERVATION_CREATED')
       AND (
         JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.idempotency_key')) = ?
         OR (created_at >= ? AND created_at <= DATE_ADD(?, INTERVAL 30 SECOND))
       )
     ORDER BY id DESC LIMIT 1`,
    [record.user_id, record.idempotency_key, record.created_at, record.created_at]
  );

  if (auditRows.length > 0) {
    const audit = auditRows[0];
    if (audit.action === 'RESERVATION_CREATED') {
      const reservationId = audit.entity_id;
      const [resRows] = await db.query('SELECT id FROM reservations WHERE id = ?', [reservationId]);
      if (resRows.length > 0) {
        return reconcileCommittedBusinessOperation({ ...record, resource_type: 'reservations', resource_id: reservationId }, req);
      }
    } else {
      const poolId = audit.entity_id;
      const [pools] = await db.query('SELECT * FROM pools WHERE id = ?', [poolId]);
      if (pools.length > 0) {
        const pool = pools[0];
        const [tiers] = await db.query(
          'SELECT id, min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
          [pool.id]
        );
        const fullPool = { ...pool, price_tiers: tiers };

        if (audit.action === 'REGULAR_POOL_PUBLISHED') {
          const [allocs] = await db.query(
            `SELECT * FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL' AND status = 'COMMITTED'`,
            [pool.id]
          );
          return {
            status: 200,
            body: {
              success: true,
              message: 'Regular pool published successfully. Commercial terms are locked and inventory is allocated.',
              data: {
                pool: fullPool,
                inventory_allocation: allocs[0] ? {
                  allocated_qty: Number(allocs[0].allocated_qty),
                  allocation_unit: allocs[0].unit,
                  status: allocs[0].status
                } : null
              }
            }
          };
        } else {
          return {
            status: 201,
            body: {
              success: true,
              message: 'Regular Pool draft created successfully',
              data: { pool: fullPool }
            }
          };
        }
      }
    }
  }

  return null;
}

/**
 * Creates an idempotency middleware.
 * @param {Object} options
 * @param {boolean} options.required - If true, requests without X-Idempotency-Key return 400
 */
function createIdempotencyGuard(options = { required: false }) {
  return async function idempotencyGuard(req, res, next) {
    const idempotencyKey = req.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      if (options.required) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_IDEMPOTENCY_KEY',
            message: 'X-Idempotency-Key header is required for this mutation endpoint'
          }
        });
      }
      return next();
    }

    const userId = req.user ? req.user.id : null;
    const requestPath = `${req.method}:${req.originalUrl || req.url}`;
    const requestHash = calculateRequestHash(req);

    try {
      // 1. Check for existing record and calculate inactivity duration in seconds directly in MySQL
      const [existing] = await db.query(
        `SELECT *, TIMESTAMPDIFF(SECOND, COALESCE(last_heartbeat_at, created_at), NOW()) AS inactive_seconds 
         FROM idempotency_records 
         WHERE idempotency_key = ?`,
        [idempotencyKey]
      );

      if (existing.length > 0) {
        const record = existing[0];

        // Actor scoping: Key cannot be shared or stolen across different users
        if (record.user_id !== null && userId !== null && Number(record.user_id) !== Number(userId)) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'IDEMPOTENCY_ACTOR_MISMATCH',
              message: 'This idempotency key belongs to another authenticated user'
            }
          });
        }

        // If COMPLETED, check payload conflict and return cached response directly
        if (record.status === 'COMPLETED') {
          if (record.request_hash && record.request_hash !== requestHash) {
            return res.status(409).json({
              success: false,
              error: {
                code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
                message: 'This idempotency key has already been used with a different request payload or endpoint'
              }
            });
          }
          if (record.response_status > 0) {
            return res.status(record.response_status).json(JSON.parse(record.response_body));
          }
        }

        // If FAILED, return the terminal failure response or allow retry
        if (record.status === 'FAILED') {
          if (record.response_status > 0 && record.response_body) {
            return res.status(record.response_status).json(JSON.parse(record.response_body));
          }
          // Conclusive establishment of failure allows clean retry
          await db.query(`DELETE FROM idempotency_records WHERE id = ?`, [record.id]);
        } else if (record.status === 'PENDING' || record.status === 'UNKNOWN') {
          // Record is in PENDING or UNKNOWN state
          // Check heartbeat to determine if worker is genuinely active or crashed
          const inactiveDurationSec = Number(record.inactive_seconds) || 0;
          const HEARTBEAT_TIMEOUT_SEC = 60; // 60 seconds of zero activity indicates worker crash

          if (inactiveDurationSec < HEARTBEAT_TIMEOUT_SEC) {
            // Worker is genuinely active and sending heartbeats. Check payload conflict first:
            if (record.request_hash && record.request_hash !== requestHash) {
              return res.status(409).json({
                success: false,
                error: {
                  code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
                  message: 'This idempotency key has already been used with a different request payload or endpoint'
                }
              });
            }
            return res.status(409).json({
              success: false,
              error: {
                code: 'CONCURRENT_REQUEST',
                message: 'A request with this idempotency key is currently being processed. Please wait.'
              }
            });
          }

          // Worker appears inactive / crashed (> 60s without heartbeat).
          // NEVER blindly delete and rerun! Reconcile underlying business state first.
          const reconciledResponse = await reconcileCommittedBusinessOperation(record, req);

          if (reconciledResponse) {
            // Business mutation committed before crash!
            if (record.request_hash && record.request_hash !== requestHash) {
              return res.status(409).json({
                success: false,
                error: {
                  code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
                  message: 'This idempotency key has already been used with a different request payload or endpoint'
                }
              });
            }
            // Update idempotency record to COMPLETED and return existing result
            await db.query(
              `UPDATE idempotency_records 
               SET status = 'COMPLETED', response_status = ?, response_body = ?
               WHERE id = ?`,
              [reconciledResponse.status, JSON.stringify(reconciledResponse.body), record.id]
            );
            return res.status(reconciledResponse.status).json(reconciledResponse.body);
          }

          // Business mutation did NOT commit. Check if request was UNKNOWN or crashed before commit.
          if (record.status === 'UNKNOWN') {
            return res.status(409).json({
              success: false,
              error: {
                code: 'IDEMPOTENCY_OUTCOME_UNKNOWN',
                message: 'Previous operation terminated in an indeterminate state. Manual or administrative reconciliation required.'
              }
            });
          }

          // Conclusively established that business operation did not commit: Safe to clean crashed placeholder and allow retry
          await db.query(`DELETE FROM idempotency_records WHERE id = ?`, [record.id]);
        }
      }

      // 2. Atomically reserve key using MySQL UNIQUE constraint with status = 'PENDING'
      try {
        await db.query(
          `INSERT INTO idempotency_records 
            (idempotency_key, user_id, request_path, request_hash, status, response_status, response_body, last_heartbeat_at)
           VALUES (?, ?, ?, ?, 'PENDING', 0, '', NOW())`,
          [idempotencyKey, userId, requestPath, requestHash]
        );
      } catch (insertErr) {
        if (insertErr.code === 'ER_DUP_ENTRY') {
          // Another thread just inserted this key concurrently
          const [concurrentRecord] = await db.query(
            `SELECT * FROM idempotency_records WHERE idempotency_key = ?`,
            [idempotencyKey]
          );
          if (concurrentRecord[0] && concurrentRecord[0].status === 'COMPLETED' && concurrentRecord[0].response_status > 0) {
            return res.status(concurrentRecord[0].response_status).json(JSON.parse(concurrentRecord[0].response_body));
          }
          return res.status(409).json({
            success: false,
            error: {
              code: 'CONCURRENT_REQUEST',
              message: 'A request with this idempotency key is currently being processed.'
            }
          });
        }
        throw insertErr;
      }

      // 3. Heartbeat maintenance: update last_heartbeat_at periodically for long-running operations (>60s)
      const heartbeatInterval = setInterval(() => {
        db.query(
          `UPDATE idempotency_records SET last_heartbeat_at = NOW() WHERE idempotency_key = ? AND status = 'PENDING'`,
          [idempotencyKey]
        ).catch(() => {});
      }, 15000); // 15-second heartbeat ensures active requests remain protected past 60s

      // 4. Attach helper to request so controllers can stamp resource_id and resource_type atomically
      req.idempotency = {
        key: idempotencyKey,
        setResource: async (type, id, connection = null) => {
          const executor = connection || db;
          await executor.query(
            `UPDATE idempotency_records 
             SET resource_type = ?, resource_id = ? 
             WHERE idempotency_key = ?`,
            [type, id, idempotencyKey]
          );
        }
      };

      // Guaranteed cleanup of heartbeat interval on finish or client disconnect
      const cleanupHeartbeat = () => {
        clearInterval(heartbeatInterval);
      };
      res.once('finish', cleanupHeartbeat);
      res.once('close', cleanupHeartbeat);

      // 5. Intercept res.json to store completed response synchronously
      const originalJson = res.json;
      let responseStored = false;

      res.json = function (body) {
        cleanupHeartbeat();

        if (!responseStored) {
          responseStored = true;
          const finalStatus = res.statusCode >= 400 && res.statusCode !== 409 ? 'FAILED' : 'COMPLETED';

          db.query(
            `UPDATE idempotency_records 
             SET status = ?, response_status = ?, response_body = ?, last_heartbeat_at = NOW()
             WHERE idempotency_key = ?`,
            [finalStatus, res.statusCode, JSON.stringify(body), idempotencyKey]
          ).then(() => {
            originalJson.call(this, body);
          }).catch(err => {
            console.error('[Idempotency] Storage Error:', err.message);
            // If storage fails after business commit, mark UNKNOWN rather than deleting
            db.query(
              `UPDATE idempotency_records SET status = 'UNKNOWN' WHERE idempotency_key = ?`,
              [idempotencyKey]
            ).catch(() => {});
            originalJson.call(this, body);
          });
          return this;
        }

        return originalJson.call(this, body);
      };

      next();
    } catch (error) {
      // If unhandled error thrown before or in handler, mark FAILED or clean in-flight reservation
      try {
        await db.query(
          `UPDATE idempotency_records SET status = 'FAILED' WHERE idempotency_key = ? AND status = 'PENDING'`,
          [idempotencyKey]
        );
      } catch (cleanErr) {}
      next(error);
    }
  };
}

// Default export is middleware with optional key (backward compatibility)
const defaultGuard = createIdempotencyGuard({ required: false });
defaultGuard.required = createIdempotencyGuard({ required: true });
defaultGuard.optional = defaultGuard;

module.exports = defaultGuard;