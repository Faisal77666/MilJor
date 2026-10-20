// =============================================================================
// src/services/specificationService.js
// MilJor Product Specification Service
// Canonical normalization, attribute validation, hashing and deduplication
// =============================================================================
const crypto = require('crypto');

class SpecificationService {
  // Normalize structured attributes object with deterministic key order and normalized values
  normalizeAttributes(attrs) {
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return null;
    const sorted = {};
    for (const key of Object.keys(attrs).sort()) {
      let val = attrs[key];
      if (typeof val === 'string') {
        val = val.trim().toLowerCase().replace(/\s+/g, ' ');
      } else if (typeof val === 'number') {
        val = Number(val.toFixed(4));
      }
      sorted[key.trim().toLowerCase()] = val;
    }
    return sorted;
  }

  // Compute canonical deterministic hash representing all commercially significant physical attributes
  computeSpecHash({
    productId,
    brand,
    variety,
    cropYear,
    processingMethod,
    qualityGrade,
    packagingType,
    packSize,
    packUnit,
    purchasingUnit,
    specAttributes
  }) {
    const normAttrs = this.normalizeAttributes(specAttributes);
    const attrString = normAttrs ? JSON.stringify(normAttrs) : '';

    const norm = [
      Number(productId),
      (brand || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (variety || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (cropYear || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (processingMethod || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (qualityGrade || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (packagingType || '').trim().toLowerCase().replace(/\s+/g, ' '),
      Number(packSize).toFixed(2),
      (packUnit || '').trim().toLowerCase(),
      (purchasingUnit || '').trim().toLowerCase(),
      attrString
    ].join('|');

    return crypto.createHash('sha256').update(norm).digest('hex');
  }

  // Generate readable specification code
  generateSpecCode(category, variety, idHint = null) {
    const catPrefix = (category || 'GEN')
      .split(/\s+/)
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .substring(0, 4);

    const varPrefix = (variety || 'ITEM')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .substring(0, 3);

    const rand = idHint || Math.floor(100 + Math.random() * 900);
    return `SPEC-${catPrefix}-${varPrefix}-${rand}`;
  }

  // Validate category-specific attributes
  validateSpecificationInput(data, categoryName = '') {
    const {
      product_id,
      brand,
      variety,
      crop_year,
      processing_method,
      quality_grade,
      packaging_type,
      pack_size,
      pack_unit,
      purchasing_unit
    } = data;

    if (!product_id) {
      return { valid: false, message: 'Base product ID (product_id) is required' };
    }
    if (!brand || !brand.trim()) {
      return { valid: false, message: 'Brand is required' };
    }
    if (!variety || !variety.trim()) {
      return { valid: false, message: 'Variety is required' };
    }
    if (!processing_method || !processing_method.trim()) {
      return { valid: false, message: 'Processing method is required' };
    }
    if (!quality_grade || !quality_grade.trim()) {
      return { valid: false, message: 'Quality grade is required' };
    }
    if (!packaging_type || !packaging_type.trim()) {
      return { valid: false, message: 'Packaging type is required' };
    }
    if (!pack_size || Number(pack_size) <= 0) {
      return { valid: false, message: 'Pack size must be a positive number greater than 0' };
    }
    if (!pack_unit || !pack_unit.trim()) {
      return { valid: false, message: 'Pack unit (e.g. kg, L) is required' };
    }

    const cat = (categoryName || '').toLowerCase();

    // Category-specific rules
    if (cat.includes('rice') || cat.includes('grain')) {
      if (!processing_method) {
        return { valid: false, message: 'Rice specification requires processing method (e.g. Steam, Sella, Raw)' };
      }
    } else if (cat.includes('oil') || cat.includes('fat')) {
      const unit = pack_unit.trim().toLowerCase();
      if (!['l', 'litre', 'liter', 'kg', 'tin'].includes(unit)) {
        return { valid: false, message: 'Edible oil pack unit must be L, litre, kg, or tin' };
      }
    }

    return { valid: true };
  }
}

module.exports = new SpecificationService();
