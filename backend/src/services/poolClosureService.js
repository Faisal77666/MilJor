// =============================================================================
// src/services/poolClosureService.js
// FIXES:
//   BUG-01: Was updating 'escrow_payments' — now correctly updates 'payments'
//   BUG-09: Full state machine — handles TARGET_REACHED → AWAITING_SUPPLIER_CONFIRMATION
//   BUG-14: This service is called by schedulerService.js on a cron schedule
// =============================================================================
const db = require('../config/db');

class PoolClosureService {

  // ---------------------------------------------------------------------------
  // processExpiredPools — Called by scheduler every 10 minutes
  // Handles pools that have passed their expires_at without being closed
  // ---------------------------------------------------------------------------
  // processExpiredPools — Called by scheduler every 10 minutes
  // OBS-41 CONTAINMENT: Regular Pool qualification, supplier confirmation,
  // buyer confirmation, cancellation, and refund workflows belong to Part 4D and Part 5.
  // To prevent unsafe legacy mass-cancellations, unauthorized inventory release, or
  // invalid payment/ledger mutations in production or development before Part 4D,
  // this function enforces fail-closed containment.
  // ---------------------------------------------------------------------------
  async processExpiredPools() {
    // OBS-41: Check if Part 4D qualification & closure workflow is enabled.
    // By default, this remains strictly disabled (false) until Part 4D implementation.
    const isPart4DClosureEnabled = process.env.ENABLE_PART4D_POOL_CLOSURE === 'true';

    if (!isPart4DClosureEnabled) {
      console.log(
        '[Scheduler] OBS-41 Containment Active: Regular Pool automated qualification and closure ' +
        'is guarded pending Part 4D implementation. No reservations cancelled, no inventory released, ' +
        'no payment/ledger records modified.'
      );
      return {
        processed: 0,
        awaiting_confirmation: 0,
        expired_with_refunds: 0,
        contained: true,
        reason: 'PART_4D_CLOSURE_WORKFLOW_PENDING'
      };
    }

    // OBS-45 PERMANENT DECOMMISSION:
    // Even if ENABLE_PART4D_POOL_CLOSURE is set to true, legacy mass cancellation of reservations,
    // uncoordinated refunds on payments, and direct platform_ledger mutations are permanently decommissioned.
    // In Part 4D.1, commercial qualification and snapshot generation are governed by CommercialLifecycleService.
    // Live automated closure transitions remain guarded until Part 4D.2.
    console.log(
      '[Scheduler] OBS-45 Enforced: Legacy destructive Regular Pool closure is permanently decommissioned. ' +
      'Commercial lifecycle is governed by CommercialLifecycleService. Zero reservations cancelled, ' +
      'zero refunds issued, zero inventory released, zero ledger records modified.'
    );
    return {
      processed: 0,
      awaiting_confirmation: 0,
      expired_with_refunds: 0,
      contained: true,
      legacy_decommissioned: true,
      reason: 'LEGACY_CLOSURE_PERMANENTLY_DECOMMISSIONED'
    };
  }

  // ---------------------------------------------------------------------------
  // processExpiredFlashPools — Mark flash pools EXPIRED after expiry_time
  // ---------------------------------------------------------------------------
  async processExpiredFlashPools() {
    try {
      const [result] = await db.query(
        "UPDATE flash_pools SET status = 'EXPIRED', updated_at = NOW() WHERE status = 'ACTIVE' AND expiry_time <= NOW()"
      );
      if (result.affectedRows > 0) {
        console.log(`[Scheduler] ${result.affectedRows} flash pool(s) expired`);
      }
      return result.affectedRows;
    } catch (error) {
      console.error('[Scheduler] Error processing flash pool expiry:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // cleanOldIdempotencyRecords — OBS-63 Safe Idempotency Retention Policy
  // Preserves active operations, active heartbeats, UNKNOWN outcomes, and
  // commercial qualification / reservation mutation records required for durable recovery.
  // Cleans only terminal FAILED or non-commercial COMPLETED records in bounded batches.
  // ---------------------------------------------------------------------------
  async cleanOldIdempotencyRecords() {
    try {
      const [result] = await db.query(
        `DELETE FROM idempotency_records 
         WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
           AND status IN ('FAILED', 'COMPLETED')
           AND status NOT IN ('PENDING', 'UNKNOWN')
           AND (last_heartbeat_at IS NULL OR last_heartbeat_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
           AND (resource_type IS NULL OR resource_type NOT IN ('pools', 'reservations', 'orders', 'payments'))
           AND request_path NOT LIKE '%/qualify%'
           AND request_path NOT LIKE '%/publish%'
           AND request_path NOT LIKE '%/reservations%'
         LIMIT 500`
      );
      if (result.affectedRows > 0) {
        console.log(`[Scheduler] Cleaned ${result.affectedRows} expired non-critical idempotency records`);
      }
      return result.affectedRows;
    } catch (error) {
      console.error('[Scheduler] Error cleaning idempotency records:', error);
      throw error;
    }
  }
}

module.exports = new PoolClosureService();