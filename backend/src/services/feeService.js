const db = require('../config/db');

class FeeService {
  // Calculate dynamic slab-based Buyer Marketplace Fee
  async calculateBuyerFee(subtotalAmount) {
    const amount = parseFloat(subtotalAmount);

    if (amount < 1000) {
      // Below min slab fee rule
      return { percentage: 0, buyer_fee: 30.00 }; // Min fee cap
    }

    const [slabs] = await db.query(
      `SELECT * FROM buyer_fee_slabs 
       WHERE ? BETWEEN min_order_amount AND max_order_amount LIMIT 1`,
      [amount]
    );

    let feePercentage = 1.50; // Fallback default
    if (slabs.length > 0) {
      feePercentage = parseFloat(slabs[0].fee_percentage);
    }

    let calculatedFee = (amount * (feePercentage / 100)).toFixed(2);
    calculatedFee = Math.max(30.00, Math.min(300.00, parseFloat(calculatedFee))); // Min Rs. 30, Max Rs. 300 cap

    return {
      percentage: feePercentage,
      buyer_fee: calculatedFee.toFixed(2)
    };
  }

  // Calculate Supplier Transaction Fee based on Plan (Starter 2.5%, Growth 1.5%, Business 1.0%)
  async calculateSupplierFee(supplierId, subtotalAmount) {
    const amount = parseFloat(subtotalAmount);

    const [profiles] = await db.query(
      `SELECT transaction_fee_percent FROM supplier_profiles WHERE supplier_id = ?`,
      [supplierId]
    );

    const feePercent = profiles.length > 0 ? parseFloat(profiles[0].transaction_fee_percent) : 2.50;
    const supplierFee = (amount * (feePercent / 100)).toFixed(2);
    const supplierNetPayout = (amount - parseFloat(supplierFee)).toFixed(2);

    return {
      fee_percent: feePercent,
      supplier_fee: supplierFee,
      supplier_net_payout: supplierNetPayout
    };
  }
}

module.exports = new FeeService();