const db = require('../config/db');

class LedgerRepository {
  // Split payment between Platform Owner Commission & Supplier Net Balance
  async createLedgerEntry(paymentId, grossAmount, feePercent = 2.5) {
    const platformFee = (parseFloat(grossAmount) * (parseFloat(feePercent) / 100)).toFixed(2);
    const supplierNet = (parseFloat(grossAmount) - parseFloat(platformFee)).toFixed(2);
    const ledgerCode = 'LDG-' + Math.floor(100000 + Math.random() * 900000);

    const [result] = await db.query(
      `INSERT INTO platform_ledger 
      (ledger_code, payment_id, gross_amount, platform_fee_amount, supplier_net_amount, payout_status) 
      VALUES (?, ?, ?, ?, ?, 'HELD_IN_ESCROW')`,
      [ledgerCode, paymentId, grossAmount, platformFee, supplierNet]
    );

    return {
      ledger_id: result.insertId,
      ledger_code: ledgerCode,
      gross_amount: grossAmount,
      platform_fee_amount: platformFee,
      supplier_net_amount: supplierNet
    };
  }

  // Settle & Release Supplier Payout
  async releaseSupplierPayout(paymentId) {
    const [result] = await db.query(
      `UPDATE platform_ledger 
       SET payout_status = 'PAID_TO_SUPPLIER' 
       WHERE payment_id = ? AND payout_status = 'HELD_IN_ESCROW'`,
      [paymentId]
    );
    return result.affectedRows > 0;
  }

  // Get Owner Revenue & Platform Financial Summary
  async getOwnerFinancialSummary() {
    const [rows] = await db.query(
      `SELECT 
        SUM(gross_amount) as total_volume_processed,
        SUM(platform_fee_amount) as total_owner_revenue_earned,
        SUM(CASE WHEN payout_status = 'HELD_IN_ESCROW' THEN platform_fee_amount ELSE 0 END) as escrow_held_fees,
        SUM(CASE WHEN payout_status = 'PAID_TO_SUPPLIER' THEN supplier_net_amount ELSE 0 END) as total_paid_to_suppliers
       FROM platform_ledger`
    );
    return rows[0];
  }
}

module.exports = new LedgerRepository();