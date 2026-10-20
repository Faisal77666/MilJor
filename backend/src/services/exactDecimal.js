// =============================================================================
// src/services/exactDecimal.js
// MilJor Authoritative Exact Decimal Arithmetic & Comparison Module
// (Part 4E.1.1: OBS-75, OBS-76)
//
// Implements exact BigInt scaled-integer arithmetic and canonical formatting
// for currency and quantity operations conforming to MySQL DECIMAL(12,4)
// and DECIMAL(12,2) specifications.
//
// Invariants:
// 1. Never passes monetary quantities or prices through IEEE-754 binary floating-point.
// 2. Strict decimal format and range validation.
// 3. Contractual half-up rounding at calculation boundaries (matching MySQL ROUND(x, scale)).
// 4. Exact canonical string equality (eliminates arbitrary tolerances like Math.abs(x - y) <= 0.01).
// =============================================================================

/**
 * Validates and normalizes an input value into an exact decimal string.
 * @param {string|number|BigInt} val - Raw input value
 * @param {Object} options - Validation options { maxPrecision, maxScale, allowNegative }
 * @returns {string} Sanitized exact decimal string
 */
function toDecimalString(val, options = {}) {
  if (val === null || val === undefined) {
    throw new Error('Decimal value cannot be null or undefined');
  }

  const str = String(val).trim();
  if (str === '' || str === 'NaN' || str === 'Infinity' || str === '-Infinity') {
    throw new Error(`Invalid decimal value: '${str}'`);
  }

  // Regex strictly allows optional minus sign, digits, optional decimal point and digits
  const match = str.match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Malformed decimal syntax: '${str}'`);
  }

  const isNeg = Boolean(match[1]);
  if (isNeg && options.allowNegative === false) {
    throw new Error(`Negative decimal not allowed: '${str}'`);
  }

  const intPart = match[2].replace(/^0+(?=\d)/, ''); // strip leading zeros except single '0'
  const fracPart = match[3] || '';

  const totalDigits = intPart.length + fracPart.length;
  const maxPrecision = options.maxPrecision || 18;
  const maxScale = options.maxScale !== undefined ? options.maxScale : 8;

  if (totalDigits > maxPrecision) {
    throw new Error(`Decimal precision overflow: total digits ${totalDigits} exceeds maximum ${maxPrecision}`);
  }

  if (fracPart.length > maxScale) {
    throw new Error(`Decimal scale overflow: fraction digits ${fracPart.length} exceeds maximum scale ${maxScale}`);
  }

  const sign = isNeg && (intPart !== '0' || /[^0]/.test(fracPart)) ? '-' : '';
  return fracPart.length > 0 ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

/**
 * Formats a decimal string to a canonical fixed scale with trailing zeros,
 * safely trimming trailing zeros if the precision exceeds target scale.
 * If non-zero fractional digits exceed scale, throws scale overflow.
 *
 * @param {string|number} val - Decimal value
 * @param {number} scale - Target scale (e.g. 2 for currency, 4 for quantity)
 * @returns {string} Canonical fixed scale representation (e.g. '4800.00')
 */
function toCanonical(val, scale = 2) {
  const s = toDecimalString(val);
  const isNeg = s.startsWith('-');
  const clean = isNeg ? s.slice(1) : s;
  const [intPart, rawFrac = ''] = clean.split('.');

  // If fractional part has more digits than scale, check if excess digits are all zeros
  let fracPart = rawFrac;
  if (fracPart.length > scale) {
    const excess = fracPart.slice(scale);
    if (/[^0]/.test(excess)) {
      throw new Error(`Canonical scale overflow: '${s}' has non-zero fraction beyond scale ${scale}`);
    }
    fracPart = fracPart.slice(0, scale);
  }

  const paddedFrac = (fracPart + '0'.repeat(scale)).slice(0, scale);
  const sign = isNeg && (intPart !== '0' || /[^0]/.test(paddedFrac)) ? '-' : '';
  return `${sign}${intPart}.${paddedFrac}`;
}

/**
 * Exact half-up multiplication of quantity and price.
 * Computes exact Product = Quantity * Price, then rounds half-up to target scale.
 * Matches MySQL ROUND(quantity * unit_price, scale).
 *
 * @param {string|number} qty - Decimal quantity (e.g. DECIMAL(12,4))
 * @param {string|number} price - Decimal price per unit (e.g. DECIMAL(12,2))
 * @param {number} scale - Target scale for subtotal (default 2)
 * @returns {string} Exact rounded decimal string
 */
function exactMultiplyRound(qty, price, scale = 2) {
  const qStr = toDecimalString(qty, { maxPrecision: 16, maxScale: 6 });
  const pStr = toDecimalString(price, { maxPrecision: 16, maxScale: 4 });

  const qNeg = qStr.startsWith('-');
  const pNeg = pStr.startsWith('-');
  const resultNeg = qNeg !== pNeg;

  const qClean = qNeg ? qStr.slice(1) : qStr;
  const pClean = pNeg ? pStr.slice(1) : pStr;

  const [qInt, qFrac = ''] = qClean.split('.');
  const [pInt, pFrac = ''] = pClean.split('.');

  const totalFracScale = qFrac.length + pFrac.length;
  const qBig = BigInt(qInt + qFrac);
  const pBig = BigInt(pInt + pFrac);

  const product = qBig * pBig;
  if (product === 0n) {
    return `0.${'0'.repeat(scale)}`;
  }

  let roundedBig;
  const diff = totalFracScale - scale;
  if (diff <= 0) {
    // Fewer fractional digits than target scale: scale up
    const factor = 10n ** BigInt(-diff);
    roundedBig = product * factor;
  } else {
    // More fractional digits than target scale: divide with half-up rounding
    const divisor = 10n ** BigInt(diff);
    const half = divisor / 2n;
    roundedBig = (product + half) / divisor;
  }

  const scaleFactor = 10n ** BigInt(scale);
  const intPart = roundedBig / scaleFactor;
  const fracPart = (roundedBig % scaleFactor).toString().padStart(scale, '0');
  const sign = resultNeg && (intPart !== 0n || /[^0]/.test(fracPart)) ? '-' : '';

  return `${sign}${intPart.toString()}.${fracPart}`;
}

/**
 * Exact decimal equality check between two values at a given scale.
 * Completely eliminates arbitrary tolerance intervals (e.g. Math.abs(a - b) <= 0.01).
 *
 * @param {string|number} valA
 * @param {string|number} valB
 * @param {number} scale - Comparison scale (default 2)
 * @returns {boolean} True if exactly equal in canonical representation
 */
function exactDecimalEquals(valA, valB, scale = 2) {
  try {
    const normA = toCanonical(valA, scale);
    const normB = toCanonical(valB, scale);
    return normA === normB;
  } catch (e) {
    return false;
  }
}

/**
 * Exact decimal greater-than-or-equal check (A >= B).
 * @param {string|number} valA
 * @param {string|number} valB
 * @param {number} scale
 * @returns {boolean}
 */
function exactDecimalGte(valA, valB, scale = 4) {
  const sA = toDecimalString(valA);
  const sB = toDecimalString(valB);

  const [aInt, aFrac = ''] = sA.split('.');
  const [bInt, bFrac = ''] = sB.split('.');

  const maxFrac = Math.max(aFrac.length, bFrac.length, scale);
  const normA = BigInt(aInt + (aFrac + '0'.repeat(maxFrac)).slice(0, maxFrac));
  const normB = BigInt(bInt + (bFrac + '0'.repeat(maxFrac)).slice(0, maxFrac));

  return normA >= normB;
}

/**
 * Exact decimal sum of an array of decimal numbers/strings.
 * @param {Array<string|number>} values
 * @param {number} scale
 * @returns {string}
 */
function exactDecimalSum(values, scale = 4) {
  if (!Array.isArray(values) || values.length === 0) {
    return `0.${'0'.repeat(scale)}`;
  }

  let totalScaled = 0n;
  const scaleFactor = 10n ** BigInt(scale);

  for (const v of values) {
    const s = toDecimalString(v);
    const isNeg = s.startsWith('-');
    const clean = isNeg ? s.slice(1) : s;
    const [intPart, fracPart = ''] = clean.split('.');
    const paddedFrac = (fracPart + '0'.repeat(scale)).slice(0, scale);
    const valBig = BigInt(intPart + paddedFrac);
    totalScaled += isNeg ? -valBig : valBig;
  }

  const isNeg = totalScaled < 0n;
  const absTotal = isNeg ? -totalScaled : totalScaled;
  const intPart = absTotal / scaleFactor;
  const fracPart = (absTotal % scaleFactor).toString().padStart(scale, '0');
  const sign = isNeg && (intPart !== 0n || /[^0]/.test(fracPart)) ? '-' : '';

  return `${sign}${intPart.toString()}.${fracPart}`;
}

module.exports = {
  toDecimalString,
  toCanonical,
  toCanonicalString: toCanonical,
  exactMultiplyRound,
  exactDecimalEquals,
  exactDecimalGte,
  exactDecimalSum
};
