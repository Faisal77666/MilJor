import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { poolsApi } from '../api/pools';
import { reservationsApi } from '../api/reservations';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import {
  Clock,
  CheckCircle,
  AlertTriangle,
  ArrowLeft,
  Package,
  Truck,
  ShieldCheck,
  TrendingDown,
  Layers,
  Info,
  Calendar,
  Lock,
  Loader2,
  Users
} from 'lucide-react';

export const PoolDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, isBuyer } = useAuth();

  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Reservation form state
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [alreadyReserved, setAlreadyReserved] = useState(false);

  useEffect(() => {
    fetchPoolDetails();
  }, [id]);

  const fetchPoolDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await poolsApi.getPoolById(id);
      if (res.success && res.data?.pool) {
        const poolData = res.data.pool;
        setPool(poolData);
        // Default quantity to buyer_min_qty or 1
        const initialQty = poolData.buyer_min_qty || poolData.purchase_increment || 1;
        setQuantity(initialQty);
      } else {
        setError('Pool details could not be found.');
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load pool details');
    } finally {
      setLoading(false);
    }
  };

  // Quantity Stepper handlers
  const handleQuantityChange = (val) => {
    const num = Number(val);
    if (isNaN(num)) return;
    setQuantity(num);
  };

  const incrementQty = () => {
    const step = pool?.purchase_increment || 1;
    const current = Number(quantity) || 0;
    const max = pool?.remaining_capacity || pool?.target_qty || 999999;
    setQuantity(Math.min(max, current + step));
  };

  const decrementQty = () => {
    const step = pool?.purchase_increment || 1;
    const min = pool?.buyer_min_qty || 1;
    const current = Number(quantity) || min;
    setQuantity(Math.max(min, current - step));
  };

  // Submit Reservation
  const handleReserve = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) {
      toast.info('Please sign in or register to join this pool.');
      navigate('/login');
      return;
    }

    if (!isBuyer) {
      toast.error('Only registered Buyer accounts can reserve volume.');
      return;
    }

    const qtyNum = Number(quantity);
    const minQty = pool?.buyer_min_qty || 1;
    const remainingCap = pool?.remaining_capacity || 0;

    if (!qtyNum || qtyNum < minQty) {
      toast.error(`Minimum reservation is ${minQty} ${pool?.pool_unit || 'unit'}s.`);
      return;
    }

    if (qtyNum > remainingCap) {
      toast.error(`Requested quantity exceeds available capacity (${remainingCap} ${pool?.pool_unit || 'unit'}s remaining).`);
      return;
    }

    try {
      setSubmitting(true);
      const res = await reservationsApi.createReservation({
        pool_id: pool.id,
        quantity: qtyNum,
      });

      if (res.success) {
        toast.success(`Successfully reserved ${qtyNum} ${pool.pool_unit || 'unit'}s!`);
        navigate('/my-reservations');
      }
    } catch (err) {
      const errCode = err.response?.data?.error?.code;
      const errMsg = err.response?.data?.error?.message || 'Failed to submit reservation';

      if (errCode === 'ALREADY_RESERVED' || errCode === 'CONCURRENT_RESERVATION_CONFLICT') {
        setAlreadyReserved(true);
        toast.warning('You already have an active reservation in this pool.');
      } else {
        toast.error(errMsg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-8">
        <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
        <p className="text-gray-600 font-medium">Loading pool details & live tiers...</p>
      </div>
    );
  }

  if (error || !pool) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Pool Not Found</h2>
        <p className="text-gray-600 mb-6">{error || 'The requested pool could not be found.'}</p>
        <Link
          to="/pools"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Active Pools
        </Link>
      </div>
    );
  }

  const unit = pool.pack_unit || pool.pool_unit || 'unit';
  const unitPrice = pool.estimated_unit_price || pool.current_price_per_unit || 0;
  const totalPrice = Number(quantity || 0) * Number(unitPrice);
  const progressPercent = Math.min(
    100,
    Math.max(0, parseFloat(pool.fill_percentage || pool.target_progress_percent || 0))
  );

  const formatCountdown = (expiresAt) => {
    if (!expiresAt) return 'Open Pool';
    const diffMs = new Date(expiresAt) - new Date();
    if (diffMs <= 0) return 'Expired / Closed';
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days} days ${hours % 24} hours left`;
    return `${hours} hours left`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb / Back button */}
      <div className="mb-6">
        <Link
          to="/pools"
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-emerald-700 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Active Pools
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Columns: Pool Details, Tiers, & Specs */}
        <div className="lg:col-span-2 space-y-8">
          {/* Main Header Card */}
          <div className="bg-white rounded-2xl border border-gray-200/80 p-6 sm:p-8 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/60 uppercase tracking-wide">
                  {pool.category || 'Commodity'}
                </span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 font-mono">
                  {pool.pool_code}
                </span>
              </div>

              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                <Clock className="w-3.5 h-3.5" />
                {formatCountdown(pool.expires_at)}
              </div>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              {pool.product_title || pool.product_name || 'Wholesale Commodity'}
            </h1>
            {pool.variety && (
              <p className="text-base font-semibold text-gray-600 mt-1">
                Variety: <span className="text-gray-900">{pool.variety}</span>
                {pool.brand && <span className="text-gray-400 font-normal"> • Brand: {pool.brand}</span>}
              </p>
            )}

            {/* Supplier Information Bar */}
            <div className="mt-6 pt-6 border-t border-gray-100 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 font-bold">
                  {(pool.supplier_name || 'S')[0]}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-gray-900 text-sm">
                      {pool.supplier_name || pool.supplier?.business_name || 'Direct Wholesale Supplier'}
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      Verified
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    Mandi / Hub: {pool.supplier_area || 'Lahore Wholesale District'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs font-medium text-gray-600 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                <Truck className="w-4 h-4 text-emerald-600" />
                <span>Lahore Doorstep Delivery ({pool.fulfilment_lead_time_days || 2} Days Lead Time)</span>
              </div>
            </div>
          </div>

          {/* Collective Volume Progress Card */}
          <div className="bg-white rounded-2xl border border-gray-200/80 p-6 sm:p-8 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Collective Demand Progress</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Orders from Lahore restaurants, caterers & grocers aggregate here to unlock bulk volume pricing.
                </p>
              </div>
              <span className="text-2xl font-black text-emerald-700">{progressPercent.toFixed(1)}%</span>
            </div>

            {/* Progress Bar with Milestones */}
            <div className="relative mt-2">
              <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden p-0.5 border border-gray-200">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    pool.target_reached
                      ? 'bg-emerald-500'
                      : pool.minimum_reached
                      ? 'bg-teal-500'
                      : 'bg-gradient-to-r from-amber-400 to-emerald-500'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Progress Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100 text-center">
              <div className="p-3 bg-gray-50 rounded-xl">
                <span className="text-[11px] uppercase font-semibold text-gray-500 block">Committed</span>
                <span className="text-lg font-black text-gray-900">
                  {pool.current_qty || pool.eligible_quantity || 0}
                </span>
                <span className="text-[11px] text-gray-500 block">{unit}s</span>
              </div>

              <div className="p-3 bg-gray-50 rounded-xl">
                <span className="text-[11px] uppercase font-semibold text-gray-500 block">Supplier MOQ</span>
                <span className="text-lg font-black text-gray-900">{pool.supplier_min_qty || 0}</span>
                <span className="text-[11px] text-gray-500 block">{unit}s</span>
              </div>

              <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl">
                <span className="text-[11px] uppercase font-semibold text-emerald-700 block">Target Volume</span>
                <span className="text-lg font-black text-emerald-900">{pool.target_qty}</span>
                <span className="text-[11px] text-emerald-700 block">{unit}s</span>
              </div>

              <div className="p-3 bg-gray-50 rounded-xl">
                <span className="text-[11px] uppercase font-semibold text-gray-500 block">Active Buyers</span>
                <span className="text-lg font-black text-gray-900 flex items-center justify-center gap-1">
                  <Users className="w-4 h-4 text-gray-400" />
                  {pool.active_reservations_count || 0}
                </span>
                <span className="text-[11px] text-gray-500 block">Procuring</span>
              </div>
            </div>

            {/* Pool Status Alert Note */}
            <div className="mt-4 flex items-center gap-2 p-3 bg-teal-50/70 border border-teal-100 rounded-xl text-xs text-teal-800">
              <Info className="w-4 h-4 text-teal-600 flex-shrink-0" />
              <span>
                {pool.target_reached
                  ? 'Target volume reached! All buyers have unlocked the maximum wholesale discount tier.'
                  : pool.minimum_reached
                  ? 'Supplier MOQ achieved! This pool is confirmed for delivery. More volume will unlock additional discounts.'
                  : `Pooling orders across Lahore. Needs ${pool.minimum_remaining || Math.max(0, pool.supplier_min_qty - pool.current_qty)} more ${unit}s to reach Supplier Minimum.`}
              </span>
            </div>
          </div>

          {/* Volume Tier Pricing Schedule */}
          <div className="bg-white rounded-2xl border border-gray-200/80 p-6 sm:p-8 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-emerald-600" />
                Volume-Tier Pricing Schedule
              </h2>
            </div>
            <p className="text-xs text-gray-500 mb-6">
              Unlike individual spot purchasing, your final price drops as the entire pool grows. Every participant gets the same low tier price!
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">
                    <th className="pb-3 px-3">Tier Range</th>
                    <th className="pb-3 px-3">Price Per {unit}</th>
                    <th className="pb-3 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pool.price_tiers && pool.price_tiers.length > 0 ? (
                    pool.price_tiers.map((tier, idx) => {
                      const isCurrent =
                        pool.current_price_per_unit === tier.price_per_unit ||
                        pool.estimated_unit_price === tier.price_per_unit;
                      return (
                        <tr
                          key={tier.id || idx}
                          className={`transition ${
                            isCurrent
                              ? 'bg-emerald-50/80 font-semibold text-emerald-950'
                              : 'hover:bg-gray-50 text-gray-700'
                          }`}
                        >
                          <td className="py-3.5 px-3">
                            <span className="font-mono text-xs">
                              {tier.min_qty} – {tier.max_qty >= 90000 ? 'No Limit' : `${tier.max_qty} ${unit}s`}
                            </span>
                          </td>
                          <td className="py-3.5 px-3">
                            <span className="text-base font-bold text-gray-900">
                              PKR {Number(tier.price_per_unit).toLocaleString()}
                            </span>
                            <span className="text-xs text-gray-500"> / {unit}</span>
                          </td>
                          <td className="py-3.5 px-3 text-right">
                            {isCurrent ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Active Tier
                              </span>
                            ) : tier.min_qty > (pool.current_qty || 0) ? (
                              <span className="text-xs text-gray-500 font-medium">Unlock Next</span>
                            ) : (
                              <span className="text-xs text-gray-400">Achieved</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="3" className="py-4 text-center text-gray-500 text-sm">
                        Standard fixed volume pricing applies.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Next Tier Banner */}
            {pool.additional_quantity_for_next_tier > 0 && pool.next_tier_price && (
              <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-200 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-bold uppercase text-emerald-800 tracking-wider">Next Price Drop:</span>
                  <p className="text-sm text-gray-800 font-medium mt-0.5">
                    Just <strong className="text-emerald-700 font-bold">{pool.additional_quantity_for_next_tier} more {unit}s</strong> needed to drop the price to{' '}
                    <strong className="text-gray-900 font-bold">PKR {Number(pool.next_tier_price).toLocaleString()}</strong>!
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Commodity Specifications Card */}
          <div className="bg-white rounded-2xl border border-gray-200/80 p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-600" />
              Verified Commodity & Delivery Specifications
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                <span className="text-xs text-gray-500 font-medium block">Quality Grade</span>
                <span className="text-base font-bold text-gray-900 mt-0.5 block">
                  {pool.specification?.quality_grade || pool.grade || 'Export Grade Standard'}
                </span>
                <span className="text-xs text-gray-500 mt-1 block">Laboratory inspected for moisture & purity</span>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                <span className="text-xs text-gray-500 font-medium block">Packaging & Bag Size</span>
                <span className="text-base font-bold text-gray-900 mt-0.5 block">
                  {pool.specification?.packaging_type || pool.packaging_type || 'Standard Bag'} • {pool.pack_size || '50kg'}
                </span>
                <span className="text-xs text-gray-500 mt-1 block">Factory sealed food-grade packaging</span>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                <span className="text-xs text-gray-500 font-medium block">Delivery Service</span>
                <span className="text-base font-bold text-gray-900 mt-0.5 block">
                  {pool.delivery_type || 'DOORSTEP'} to Lahore
                </span>
                <span className="text-xs text-gray-500 mt-1 block">Delivered directly to your kitchen / warehouse</span>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                <span className="text-xs text-gray-500 font-medium block">Delivery Fee Policy</span>
                <span className="text-base font-bold text-gray-900 mt-0.5 block">
                  {pool.delivery_fee_policy === 'INCLUDED_IN_PRICE' ? 'Included in Price' : pool.delivery_fee_policy || 'Standard Flat Rate'}
                </span>
                <span className="text-xs text-gray-500 mt-1 block">No hidden surcharge at delivery</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Sticky Join Pool Card */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 bg-white rounded-2xl border border-gray-200/80 shadow-md p-6 overflow-hidden">
            <div className="pb-4 mb-4 border-b border-gray-100">
              <span className="text-xs uppercase font-bold text-emerald-700 tracking-wider">Current Collective Price</span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-sm font-bold text-gray-500">PKR</span>
                <span className="text-3xl font-black text-gray-900">
                  {unitPrice ? Number(unitPrice).toLocaleString() : '—'}
                </span>
                <span className="text-xs text-gray-500">/ {unit}</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                * Final invoice price will be the lowest tier reached when pool closes.
              </p>
            </div>

            {/* Check if already reserved in this pool */}
            {alreadyReserved ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mb-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-900">
                    <p className="font-bold">Active Reservation Exists</p>
                    <p className="mt-0.5">
                      You already have an active reservation for this pool.
                    </p>
                  </div>
                </div>
                <Link
                  to="/my-reservations"
                  className="mt-3 block text-center w-full py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg transition"
                >
                  View My Reservation
                </Link>
              </div>
            ) : !pool.can_join ? (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl mb-4 text-xs text-gray-600">
                <div className="flex items-center gap-2 font-bold text-gray-800 mb-1">
                  <Lock className="w-4 h-4 text-gray-500" />
                  Reservations Closed
                </div>
                <p>{pool.participation_reason || 'This pool is no longer accepting new reservations.'}</p>
              </div>
            ) : !isAuthenticated ? (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-xl text-xs text-emerald-900">
                  <span className="font-bold block mb-1">B2B Verified Procurement</span>
                  Sign in or register a buyer account to join wholesale collective pools with Lahore businesses.
                </div>
                <Link
                  to="/login"
                  className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm transition"
                >
                  Sign In to Join Pool
                </Link>
                <Link
                  to="/register"
                  className="w-full flex items-center justify-center py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold text-sm rounded-xl transition"
                >
                  Register as Buyer
                </Link>
              </div>
            ) : !isBuyer ? (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600">
                <p className="font-bold text-gray-800 mb-1">Supplier / Admin Account</p>
                Pool reservations are exclusive to registered Buyer accounts.
              </div>
            ) : (
              <form onSubmit={handleReserve} className="space-y-5">
                {/* Quantity Stepper */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                    <label htmlFor="qty" className="text-gray-700">Quantity to Reserve ({unit}s)</label>
                    <span className="text-gray-500">Min: {pool.buyer_min_qty || 1} {unit}s</span>
                  </div>

                  <div className="flex items-center rounded-xl border border-gray-300 overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
                    <button
                      type="button"
                      onClick={decrementQty}
                      className="px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold border-r border-gray-300 text-base transition"
                    >
                      –
                    </button>
                    <input
                      id="qty"
                      type="number"
                      min={pool.buyer_min_qty || 1}
                      max={pool.remaining_capacity || 999999}
                      step={pool.purchase_increment || 1}
                      value={quantity}
                      onChange={(e) => handleQuantityChange(e.target.value)}
                      className="w-full text-center py-2.5 font-bold text-lg text-gray-900 focus:outline-none"
                      required
                    />
                    <button
                      type="button"
                      onClick={incrementQty}
                      className="px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold border-l border-gray-300 text-base transition"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[11px] text-gray-500 mt-1 block">
                    Remaining capacity: {pool.remaining_capacity} {unit}s
                  </span>
                </div>

                {/* Live Real-time Price Calculator */}
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-2 text-xs">
                  <div className="flex justify-between text-gray-600">
                    <span>Estimated Unit Price:</span>
                    <span className="font-semibold text-gray-900">PKR {Number(unitPrice).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Reserved Quantity:</span>
                    <span className="font-semibold text-gray-900">{quantity || 0} {unit}s</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Estimated Delivery:</span>
                    <span className="font-semibold text-emerald-700">Free / Included</span>
                  </div>
                  <div className="pt-2 border-t border-gray-200 flex justify-between items-baseline">
                    <span className="font-bold text-gray-900 text-sm">Estimated Total:</span>
                    <div className="text-right">
                      <span className="text-xs font-bold text-emerald-600">PKR </span>
                      <span className="text-xl font-black text-emerald-700">
                        {totalPrice ? Number(totalPrice).toLocaleString() : 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Risk-free Guarantee */}
                <div className="flex items-start gap-2 text-[11px] text-gray-500">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Zero Upfront Payment:</strong> Reserve your spot now. Payment is only initiated when pool reaches confirmation deadline at final volume tier.
                  </span>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={submitting || Number(quantity) < (pool.buyer_min_qty || 1)}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-sm rounded-xl shadow-md shadow-emerald-200 transition"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Reserving Volume...
                    </>
                  ) : (
                    `Join Pool (${quantity || 0} ${unit}s)`
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PoolDetailPage;
