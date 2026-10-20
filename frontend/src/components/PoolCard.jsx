import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, TrendingDown, CheckCircle, Package, Truck, ArrowRight } from 'lucide-react';

export const PoolCard = ({ pool }) => {
  // Safe progress percentage capped between 0 and 100
  const progressPercent = Math.min(
    100,
    Math.max(0, parseFloat(pool.fill_percentage || pool.progress_percentage || 0))
  );

  const isMinReached = Boolean(pool.minimum_reached || progressPercent >= 50);
  const isTargetReached = Boolean(pool.target_reached || progressPercent >= 100);

  // Formatting date/countdown
  const formatTimeLeft = (expiresAt) => {
    if (!expiresAt) return 'Open';
    const diffMs = new Date(expiresAt) - new Date();
    if (diffMs <= 0) return 'Closed';
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h left`;
    return `${hours}h left`;
  };

  const currentPrice = pool.estimated_unit_price || pool.current_unit_price || pool.base_unit_price;
  const unit = pool.pack_unit || pool.pool_unit || 'unit';

  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-md transition flex flex-col overflow-hidden group">
      {/* Top Banner: Category & Verification */}
      <div className="p-5 pb-3 flex items-start justify-between gap-2">
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/50">
          {pool.category || 'Commodity'}
        </span>

        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500">
          <Clock className="w-3.5 h-3.5 text-amber-500" />
          {formatTimeLeft(pool.expires_at)}
        </span>
      </div>

      {/* Title & Specs */}
      <div className="px-5 flex-1">
        <h3 className="text-lg font-bold text-gray-900 group-hover:text-emerald-700 transition">
          {pool.product_name || pool.title || 'Wholesale Commodity'}
        </h3>
        {pool.variety && (
          <p className="text-sm font-medium text-gray-600 mt-0.5">
            Variety: <span className="text-gray-900 font-semibold">{pool.variety}</span>
          </p>
        )}

        {/* Commodity Badges */}
        <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-gray-600">
          {pool.pack_size && (
            <span className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded-md font-medium">
              <Package className="w-3.5 h-3.5 text-gray-500" />
              {pool.pack_size} {pool.pack_unit || 'kg'}
            </span>
          )}
          {pool.grade && (
            <span className="bg-gray-100 px-2 py-0.5 rounded-md font-medium text-gray-700">
              Grade {pool.grade}
            </span>
          )}
          <span className="inline-flex items-center gap-1 bg-teal-50 text-teal-800 px-2 py-0.5 rounded-md font-medium">
            <Truck className="w-3.5 h-3.5 text-teal-600" />
            Lahore Delivery
          </span>
        </div>

        {/* Progress Toward Target Volume */}
        <div className="mt-5 bg-gray-50 p-3.5 rounded-xl border border-gray-100">
          <div className="flex justify-between items-center text-xs mb-1.5 font-medium">
            <span className="text-gray-600">Collective Demand Progress</span>
            <span className="font-bold text-gray-900">{progressPercent.toFixed(1)}%</span>
          </div>

          <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isTargetReached
                  ? 'bg-emerald-500'
                  : isMinReached
                  ? 'bg-teal-500'
                  : 'bg-amber-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-[11px] text-gray-500 mt-2">
            <span>
              Committed:{' '}
              <strong className="text-gray-800">
                {pool.eligible_quantity || pool.current_qty || 0}
              </strong>{' '}
              {unit}s
            </span>
            <span>
              Target:{' '}
              <strong className="text-gray-800">{pool.target_qty || 1000}</strong> {unit}s
            </span>
          </div>
        </div>

        {/* Milestone Badge */}
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          {isTargetReached ? (
            <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
              Maximum Tier Discount Attained!
            </span>
          ) : isMinReached ? (
            <span className="text-teal-700 font-medium inline-flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5 text-teal-600" />
              MOQ Met — Pool Confirmed
            </span>
          ) : (
            <span className="text-amber-700 font-medium inline-flex items-center gap-1">
              Pooling buyers across Lahore for minimum MOQ
            </span>
          )}
        </div>
      </div>

      {/* Pricing & Join Action */}
      <div className="p-5 mt-4 bg-gray-50/70 border-t border-gray-100 flex items-center justify-between">
        <div>
          <span className="text-[11px] uppercase font-semibold text-gray-500 block">
            Collective Price
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-xs font-bold text-gray-500">PKR</span>
            <span className="text-2xl font-black text-gray-900">
              {currentPrice ? Number(currentPrice).toLocaleString() : '—'}
            </span>
            <span className="text-xs text-gray-500">/{unit}</span>
          </div>
        </div>

        <Link
          to={`/pools/${pool.id || 1}`}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm shadow-emerald-200 transition"
        >
          View Pool
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
};

export default PoolCard;

