import React, { useState, useEffect } from 'react';
import { supplierApi } from '../api/supplier';
import { toast } from 'react-toastify';
import {
  X,
  Users,
  Package,
  TrendingDown,
  CheckCircle,
  Clock,
  ShieldCheck,
  AlertCircle,
  Loader2,
  ExternalLink
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const SupplierPoolSummaryModal = ({ poolId, isOpen, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && poolId) {
      fetchSummary();
    }
  }, [isOpen, poolId]);

  const fetchSummary = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await supplierApi.getPoolSupplierSummary(poolId);
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError('Failed to load reservation summary.');
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to fetch pool summary');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-800">
                {data?.pool?.pool_code || `POOL-${poolId}`}
              </span>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                {data?.pool?.status || 'ACTIVE'}
              </span>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mt-1">
              {data?.specification?.product_title || 'Collective Demand Summary'}
            </h2>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mb-3" />
            <p className="text-sm text-gray-500 font-medium">Aggregating live demand data...</p>
          </div>
        ) : error ? (
          <div className="py-12 text-center">
            <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-rose-800">{error}</p>
            <button
              onClick={fetchSummary}
              className="mt-4 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-xl text-center">
                <span className="text-[11px] font-bold uppercase text-emerald-700 block">Total Reserved</span>
                <span className="text-2xl font-black text-emerald-950 mt-0.5 block">
                  {data.demand_summary?.total_reserved_quantity || 0}
                </span>
                <span className="text-xs text-emerald-700">{data.pool?.pool_unit || 'unit'}s</span>
              </div>

              <div className="p-4 bg-blue-50/70 border border-blue-100 rounded-xl text-center">
                <span className="text-[11px] font-bold uppercase text-blue-700 block">Active Buyers</span>
                <span className="text-2xl font-black text-blue-950 mt-0.5 block">
                  {data.demand_summary?.active_reservation_count || 0}
                </span>
                <span className="text-xs text-blue-700">Procuring</span>
              </div>

              <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl text-center col-span-2 sm:col-span-1">
                <span className="text-[11px] font-bold uppercase text-gray-500 block">Remaining Stock</span>
                <span className="text-2xl font-black text-gray-900 mt-0.5 block">
                  {data.demand_summary?.remaining_capacity || 0}
                </span>
                <span className="text-xs text-gray-500">{data.pool?.pool_unit || 'unit'}s</span>
              </div>
            </div>

            {/* Target Progress Bar */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200/70">
              <div className="flex justify-between items-center text-xs font-medium text-gray-600 mb-2">
                <span>Progress toward Target ({data.pool?.target_qty} {data.pool?.pool_unit}s)</span>
                <span className="font-bold text-gray-900">{data.demand_summary?.progress_toward_target_pct || 0}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, data.demand_summary?.progress_toward_target_pct || 0)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-500 mt-2">
                <span>
                  Supplier MOQ ({data.pool?.supplier_min_qty} {data.pool?.pool_unit}s):{' '}
                  <strong className={data.demand_summary?.supplier_min_met ? 'text-emerald-700' : 'text-amber-700'}>
                    {data.demand_summary?.supplier_min_met ? 'Met ✓' : 'Pending'}
                  </strong>
                </span>
                <span>
                  Target MOQ ({data.pool?.target_qty} {data.pool?.pool_unit}s):{' '}
                  <strong className={data.demand_summary?.target_met ? 'text-emerald-700' : 'text-gray-700'}>
                    {data.demand_summary?.target_met ? 'Met ✓' : 'In Progress'}
                  </strong>
                </span>
              </div>
            </div>

            {/* Demand Breakdown Table */}
            <div>
              <h4 className="text-xs font-bold uppercase text-gray-500 tracking-wider mb-2">
                Reservations Status Breakdown
              </h4>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-xs text-left">
                  <thead className="bg-gray-50 text-gray-600 font-semibold uppercase border-b border-gray-200">
                    <tr>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-center">Buyer Count</th>
                      <th className="py-2.5 px-3 text-right">Committed Volume</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.demand_summary?.status_breakdown &&
                      Object.entries(data.demand_summary.status_breakdown).map(([status, item]) => (
                        <tr key={status} className="hover:bg-gray-50/50">
                          <td className="py-2.5 px-3 font-semibold text-gray-800">
                            {status === 'RESERVED' ? 'Active Reservations' : status}
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold text-gray-900">
                            {item.count}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-gray-900">
                            {item.quantity} {data.pool?.pool_unit || 'unit'}s
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Live Pricing Tier Snapshot */}
            <div className="p-4 bg-teal-50/60 rounded-xl border border-teal-100 flex items-center justify-between text-xs">
              <div>
                <span className="text-[11px] font-bold uppercase text-teal-800 block">Current Pool Price</span>
                <span className="text-xl font-black text-gray-900 mt-0.5 block">
                  PKR {Number(data.pricing_summary?.current_price_per_unit || 0).toLocaleString()}
                  <span className="text-xs text-gray-500 font-normal"> / {data.pool?.pool_unit}</span>
                </span>
              </div>

              {data.pricing_summary?.next_tier && (
                <div className="text-right">
                  <span className="text-[11px] font-semibold text-teal-700 block">Next Tier Milestone</span>
                  <span className="text-sm font-bold text-emerald-800 mt-0.5 block">
                    PKR {Number(data.pricing_summary.next_tier.price_per_unit).toLocaleString()}
                  </span>
                  <span className="text-[11px] text-teal-600">
                    Needs {data.pricing_summary.next_tier.additional_qty_needed} more {data.pool?.pool_unit}s
                  </span>
                </div>
              )}
            </div>

            {/* Buyer Privacy Notice */}
            <div className="flex items-start gap-2 p-3 bg-gray-50 rounded-xl text-[11px] text-gray-500 border border-gray-200/60">
              <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Buyer Privacy Protected (Part 4C.2B Invariant):</strong> MilJor aggregates buyer demand collectively. Individual buyer details and billing identifiers remain confidential until pool qualification and order dispatch.
              </span>
            </div>

            {/* Footer Actions */}
            <div className="pt-2 flex items-center justify-between border-t border-gray-100">
              <Link
                to={`/pools/${poolId}`}
                target="_blank"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
              >
                View Public Marketplace Page
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold rounded-xl transition"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierPoolSummaryModal;
