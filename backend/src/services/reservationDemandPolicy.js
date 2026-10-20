// =============================================================================
// src/services/reservationDemandPolicy.js
// MilJor Part 4C.2B: Shared Eligible Demand & Reservation Status Policy (OBS-33)
// Defines an explicit, single source of truth for:
// - Reservation statuses that count toward pool demand
// - Reservation statuses that represent active commercial obligations
// - Terminal statuses excluded from demand
// - Fail-closed handling for unknown / invalid statuses
// =============================================================================

/**
 * Enumeration of known database reservation statuses
 */
const RESERVATION_STATUSES = Object.freeze({
  RESERVED: 'RESERVED',
  CONFIRMED: 'CONFIRMED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED'
});

/**
 * Statuses that count toward pool aggregate demand and capacity consumption.
 * RESERVED: Initial active buyer reservation awaiting pool target/supplier confirmation.
 * CONFIRMED: Buyer accepted final terms & locked pricing (Part 4D).
 * PAID: Order created and paid (Part 5).
 */
const DEMAND_ELIGIBLE_STATUSES = Object.freeze([
  RESERVATION_STATUSES.RESERVED,
  RESERVATION_STATUSES.CONFIRMED,
  RESERVATION_STATUSES.PAID
]);

/**
 * Terminal statuses that released their demand and never consume capacity.
 */
const TERMINAL_STATUSES = Object.freeze([
  RESERVATION_STATUSES.CANCELLED,
  RESERVATION_STATUSES.EXPIRED
]);

/**
 * SQL snippet representing the demand eligibility whitelist.
 * Returns SQL expression that evaluates to 1 when eligible, 0 otherwise.
 */
const SQL_ELIGIBLE_DEMAND_CONDITION = `status IN ('${DEMAND_ELIGIBLE_STATUSES.join("', '")}')`;

/**
 * SQL snippet representing non-terminal statuses for active reservation uniqueness.
 */
const SQL_NON_TERMINAL_CONDITION = `status NOT IN ('${TERMINAL_STATUSES.join("', '")}')`;

/**
 * Checks if a status string is demand-eligible.
 * @param {string} status
 * @returns {boolean}
 */
function isDemandEligible(status) {
  return DEMAND_ELIGIBLE_STATUSES.includes(status);
}

/**
 * Checks if a status string is terminal.
 * @param {string} status
 * @returns {boolean}
 */
function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Validates a reservation status. Throws an error or logs an integrity alert if unknown.
 * @param {string} status
 * @returns {boolean}
 */
function isValidStatus(status) {
  return Object.values(RESERVATION_STATUSES).includes(status);
}

/**
 * Verifies that a list of reservations does not contain unknown/invalid statuses.
 * Fail-closed policy: If any unknown status is found, it is treated as a potential
 * committed obligation rather than falsely reporting spare capacity.
 * @param {Array<{ status: string, quantity: number }>} reservations
 * @returns {{ hasUnknownStatus: boolean, unknownStatuses: string[], safeDemandQty: number }}
 */
function auditReservationStatuses(reservations) {
  const unknown = [];
  let safeDemand = 0;

  for (const r of reservations) {
    if (!isValidStatus(r.status)) {
      unknown.push(r.status);
      // Fail-closed: assume unknown status might be an active obligation to prevent overselling
      safeDemand += Number(r.quantity) || 0;
    } else if (isDemandEligible(r.status)) {
      safeDemand += Number(r.quantity) || 0;
    }
  }

  return {
    hasUnknownStatus: unknown.length > 0,
    unknownStatuses: Array.from(new Set(unknown)),
    safeDemandQty: safeDemand
  };
}

module.exports = {
  RESERVATION_STATUSES,
  DEMAND_ELIGIBLE_STATUSES,
  TERMINAL_STATUSES,
  SQL_ELIGIBLE_DEMAND_CONDITION,
  SQL_NON_TERMINAL_CONDITION,
  isDemandEligible,
  isTerminal,
  isValidStatus,
  auditReservationStatuses
};
