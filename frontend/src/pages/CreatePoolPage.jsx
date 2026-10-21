import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supplierApi } from '../api/supplier';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import {
  ArrowLeft,
  Package,
  Layers,
  Truck,
  TrendingDown,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader2,
  Info,
  Calendar,
  Sparkles,
  Send
} from 'lucide-react';

export const CreatePoolPage = () => {
  const { user, isAuthenticated, isSupplier, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Listings data
  const [listings, setListings] = useState([]);
  const [loadingListings, setLoadingListings] = useState(true);
  const [selectedListingId, setSelectedListingId] = useState('');

  // Form State
  const [targetQty, setTargetQty] = useState('');
  const [supplierMinQty, setSupplierMinQty] = useState('');
  const [buyerMinQty, setBuyerMinQty] = useState('');
  const [maxCapacity, setMaxCapacity] = useState('');
  const [purchaseIncrement, setPurchaseIncrement] = useState('1');
  const [durationDays, setDurationDays] = useState('7');
  const [leadTimeDays, setLeadTimeDays] = useState('2');
  const [deliveryType, setDeliveryType] = useState('DOORSTEP');
  const [deliveryFeePolicy, setDeliveryFeePolicy] = useState('INCLUDED_IN_PRICE');

  // Price Tiers State
  const [tiers, setTiers] = useState([]);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) {
      toast.info('Please sign in as a verified supplier.');
      navigate('/login');
      return;
    }

    if (!isSupplier && !isAdmin) {
      toast.error('Only verified suppliers can create collective pools.');
      navigate('/pools');
      return;
    }

    fetchListings();
  }, [isAuthenticated, isSupplier, isAdmin]);

  const fetchListings = async () => {
    try {
      setLoadingListings(true);
      const res = await supplierApi.getMyListings();
      if (res.success && res.data?.listings) {
        const activeListings = res.data.listings.filter((l) => l.status === 'ACTIVE' && Number(l.available_stock) > 0);
        setListings(activeListings);
        if (activeListings.length > 0) {
          selectListing(activeListings[0]);
        }
      } else {
        setListings([]);
      }
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to fetch inventory listings');
    } finally {
      setLoadingListings(false);
    }
  };

  const selectListing = (listing) => {
    setSelectedListingId(listing.id);
    const stock = Number(listing.available_stock);
    const basePrice = Number(listing.base_unit_price);
    const suppMin = Math.min(stock, Math.max(20, Number(listing.supplier_min_qty || 20)));
    const target = Math.min(stock, Math.max(suppMin * 2, 100));
    const buyerMin = Number(listing.buyer_min_qty || 5);

    setSupplierMinQty(String(suppMin));
    setTargetQty(String(target));
    setBuyerMinQty(String(buyerMin));
    setMaxCapacity(String(stock));
    setPurchaseIncrement('1');
    setLeadTimeDays(String(listing.fulfilment_lead_time_days || 2));
    setDeliveryFeePolicy(listing.delivery_fee_policy || 'INCLUDED_IN_PRICE');

    // Generate initial 3 contiguous volume tiers
    setTiers([
      {
        min_qty: 1,
        max_qty: suppMin,
        price_per_unit: basePrice,
      },
      {
        min_qty: suppMin + 1,
        max_qty: target,
        price_per_unit: Math.round(basePrice * 0.95),
      },
      {
        min_qty: target + 1,
        max_qty: stock,
        price_per_unit: Math.round(basePrice * 0.90),
      },
    ]);
  };

  const selectedListing = listings.find((l) => String(l.id) === String(selectedListingId));

  // Tier Handlers
  const handleTierChange = (index, field, value) => {
    const updated = [...tiers];
    updated[index][field] = Number(value);
    setTiers(updated);
  };

  const addTier = () => {
    const lastTier = tiers[tiers.length - 1];
    const prevMax = lastTier ? Number(lastTier.max_qty) : 0;
    const newMin = prevMax + 1;
    const newMax = newMin + 50;
    const newPrice = lastTier ? Math.max(1, Math.round(Number(lastTier.price_per_unit) * 0.95)) : 1000;

    setTiers([...tiers, { min_qty: newMin, max_qty: newMax, price_per_unit: newPrice }]);
  };

  const removeTier = (index) => {
    if (tiers.length <= 1) {
      toast.warning('A pool must have at least one pricing tier.');
      return;
    }
    const updated = tiers.filter((_, idx) => idx !== index);
    setTiers(updated);
  };

  // Submit Handler
  const handleSubmit = async (publishImmediately = false) => {
    setFormError(null);

    if (!selectedListing) {
      setFormError('Please select an inventory listing from your catalog.');
      return;
    }

    const parsedTarget = Number(targetQty);
    const parsedSuppMin = Number(supplierMinQty);
    const parsedBuyerMin = Number(buyerMinQty);
    const parsedMaxCap = Number(maxCapacity);
    const parsedIncrement = Number(purchaseIncrement);
    const parsedDuration = Number(durationDays);
    const parsedLeadTime = Number(leadTimeDays);

    // Basic Validations
    if (!parsedTarget || parsedTarget <= 0 || !parsedSuppMin || parsedSuppMin <= 0 || !parsedBuyerMin || parsedBuyerMin <= 0) {
      setFormError('Target volume, Supplier MOQ, and Buyer Min must be positive numbers.');
      return;
    }

    if (parsedSuppMin > parsedTarget) {
      setFormError('Supplier minimum MOQ cannot exceed Target volume.');
      return;
    }

    if (parsedTarget > parsedMaxCap) {
      setFormError('Target volume cannot exceed maximum pool capacity.');
      return;
    }

    if (parsedMaxCap > Number(selectedListing.available_stock)) {
      setFormError(`Maximum capacity cannot exceed available stock (${selectedListing.available_stock} ${selectedListing.pricing_unit}s).`);
      return;
    }

    // Tier validations
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      if (t.min_qty <= 0 || t.max_qty <= 0 || t.price_per_unit <= 0) {
        setFormError(`Tier ${i + 1} contains invalid zero or negative numbers.`);
        return;
      }
      if (t.min_qty >= t.max_qty) {
        setFormError(`Tier ${i + 1}: min quantity must be less than max quantity.`);
        return;
      }
      if (i > 0) {
        const prev = tiers[i - 1];
        if (t.min_qty !== prev.max_qty + 1) {
          setFormError(`Tier ${i + 1} must be contiguous with Tier ${i} (expected min_qty ${prev.max_qty + 1}).`);
          return;
        }
        if (t.price_per_unit >= prev.price_per_unit) {
          setFormError(`Tier ${i + 1} price (PKR ${t.price_per_unit}) must be lower than Tier ${i} (PKR ${prev.price_per_unit}) to reward volume!`);
          return;
        }
      }
    }

    try {
      setSubmitting(true);

      const payload = {
        product_id: selectedListing.product_id,
        product_spec_id: selectedListing.product_spec_id,
        supplier_listing_id: selectedListing.id,
        target_qty: parsedTarget,
        supplier_min_qty: parsedSuppMin,
        buyer_min_qty: parsedBuyerMin,
        max_capacity: parsedMaxCap,
        pool_unit: selectedListing.pricing_unit,
        purchase_increment: parsedIncrement,
        duration_days: parsedDuration,
        fulfilment_lead_time_days: parsedLeadTime,
        delivery_type: deliveryType,
        delivery_fee_policy: deliveryFeePolicy,
        early_close_allowed: true,
        price_tiers: tiers.map((t) => ({
          min_qty: Number(t.min_qty),
          max_qty: Number(t.max_qty),
          price_per_unit: Number(t.price_per_unit),
          pricing_unit: selectedListing.pricing_unit,
        })),
      };

      // 1. Create Pool Draft
      const createRes = await supplierApi.createPoolDraft(payload);
      if (!createRes.success || !createRes.data?.pool) {
        throw new Error(createRes.error?.message || 'Failed to create pool draft');
      }

      const poolId = createRes.data.pool.id;
      const poolCode = createRes.data.pool.pool_code;

      // 2. Publish if requested
      if (publishImmediately) {
        const pubRes = await supplierApi.publishPool(poolId);
        if (pubRes.success) {
          toast.success(`Pool ${poolCode} created and published live on the marketplace!`);
        } else {
          toast.warning(`Pool saved as draft, but publish returned: ${pubRes.error?.message}`);
        }
      } else {
        toast.success(`Pool ${poolCode} created successfully as draft.`);
      }

      navigate('/supplier/dashboard');
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message || 'Error creating pool';
      setFormError(errMsg);
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const unit = selectedListing?.pricing_unit || 'unit';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back button */}
      <div className="mb-6">
        <Link
          to="/supplier/dashboard"
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-emerald-700 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Supplier Dashboard
        </Link>
      </div>

      <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm p-6 sm:p-10">
        <div className="pb-6 border-b border-gray-100">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
            Collective Procurement
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight mt-2">
            Create Collective Volume Pool
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Aggregate orders from verified Lahore commercial buyers, hotels, and restaurants with automated volume-tier discounts.
          </p>
        </div>

        {formError && (
          <div className="mt-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-900 text-sm">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Cannot Create Pool</p>
              <p className="mt-0.5">{formError}</p>
            </div>
          </div>
        )}

        {/* Step 1: Select Listing */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
              1
            </div>
            <h2 className="text-base font-bold text-gray-900">Select Verified Inventory Listing</h2>
          </div>

          {loadingListings ? (
            <div className="py-8 flex items-center justify-center gap-2 text-gray-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              Loading your verified catalog listings...
            </div>
          ) : listings.length === 0 ? (
            <div className="p-6 bg-amber-50 border border-amber-200 rounded-2xl text-center text-xs text-amber-900">
              <AlertCircle className="w-6 h-6 text-amber-600 mx-auto mb-2" />
              <p className="font-bold text-sm">No Active Listings Available</p>
              <p className="mt-1">
                You do not have any active inventory listings with available stock. Please create or activate a listing first.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {listings.map((item) => {
                const isSelected = String(item.id) === String(selectedListingId);
                return (
                  <div
                    key={item.id}
                    onClick={() => selectListing(item)}
                    className={`cursor-pointer rounded-2xl p-5 border-2 transition ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/40 shadow-sm'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                        {item.listing_code}
                      </span>
                      {isSelected && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                          Selected
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-gray-900 mt-2 line-clamp-2">
                      {item.spec_title || item.variety || 'Commodity Listing'}
                    </h3>

                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-600">
                      <span className="bg-gray-100 px-2 py-0.5 rounded font-medium">{item.quality_grade}</span>
                      <span className="bg-gray-100 px-2 py-0.5 rounded font-medium">{item.packaging_type}</span>
                    </div>

                    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-gray-500 block">Base Price</span>
                        <strong className="text-gray-900 font-extrabold text-sm">
                          PKR {Number(item.base_unit_price).toLocaleString()}
                        </strong>
                        <span className="text-gray-500"> / {item.pricing_unit}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-gray-500 block">Stock Available</span>
                        <strong className="text-emerald-700 font-extrabold text-sm">
                          {Number(item.available_stock).toLocaleString()} {item.pricing_unit}s
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Step 2: Pool Targets & Parameters */}
        <div className="mt-10 pt-8 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
              2
            </div>
            <h2 className="text-base font-bold text-gray-900">Define Volume Targets & Parameters</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="supp-min" className="block text-xs font-bold text-gray-700 mb-1">
                Supplier Minimum MOQ ({unit}s) *
              </label>
              <input
                id="supp-min"
                type="number"
                min="1"
                value={supplierMinQty}
                onChange={(e) => setSupplierMinQty(e.target.value)}
                placeholder="e.g. 50"
                className="w-full text-sm font-semibold p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                required
              />
              <span className="text-[11px] text-gray-500 mt-1 block">Min volume for delivery confirmation</span>
            </div>

            <div>
              <label htmlFor="target-qty" className="block text-xs font-bold text-gray-700 mb-1">
                Target Volume MOQ ({unit}s) *
              </label>
              <input
                id="target-qty"
                type="number"
                min="1"
                value={targetQty}
                onChange={(e) => setTargetQty(e.target.value)}
                placeholder="e.g. 200"
                className="w-full text-sm font-semibold p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                required
              />
              <span className="text-[11px] text-gray-500 mt-1 block">Optimal volume for maximum tier</span>
            </div>

            <div>
              <label htmlFor="buyer-min" className="block text-xs font-bold text-gray-700 mb-1">
                Buyer Min Reservation ({unit}s) *
              </label>
              <input
                id="buyer-min"
                type="number"
                min="1"
                value={buyerMinQty}
                onChange={(e) => setBuyerMinQty(e.target.value)}
                placeholder="e.g. 5"
                className="w-full text-sm font-semibold p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                required
              />
              <span className="text-[11px] text-gray-500 mt-1 block">Smallest single order allowed</span>
            </div>

            <div>
              <label htmlFor="max-cap" className="block text-xs font-bold text-gray-700 mb-1">
                Max Capacity ({unit}s) *
              </label>
              <input
                id="max-cap"
                type="number"
                min="1"
                max={selectedListing?.available_stock}
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(e.target.value)}
                placeholder="e.g. 500"
                className="w-full text-sm font-semibold p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                required
              />
              <span className="text-[11px] text-gray-500 mt-1 block">Capped by listing available stock</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div>
              <label htmlFor="duration" className="block text-xs font-bold text-gray-700 mb-1">
                Pool Duration (Days) *
              </label>
              <input
                id="duration"
                type="number"
                min="1"
                max="30"
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                className="w-full text-sm font-semibold p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                required
              />
              <span className="text-[11px] text-gray-500 mt-1 block">Time allowed for buyers to join</span>
            </div>

            <div>
              <label htmlFor="lead-time" className="block text-xs font-bold text-gray-700 mb-1">
                Fulfillment Lead Time (Days) *
              </label>
              <input
                id="lead-time"
                type="number"
                min="1"
                max="14"
                value={leadTimeDays}
                onChange={(e) => setLeadTimeDays(e.target.value)}
                className="w-full text-sm font-semibold p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                required
              />
              <span className="text-[11px] text-gray-500 mt-1 block">Dispatch days after pool confirms</span>
            </div>

            <div>
              <label htmlFor="delivery-type" className="block text-xs font-bold text-gray-700 mb-1">
                Delivery Service Type
              </label>
              <select
                id="delivery-type"
                value={deliveryType}
                onChange={(e) => setDeliveryType(e.target.value)}
                className="w-full text-sm font-semibold p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
              >
                <option value="DOORSTEP">DOORSTEP (Direct to Buyer)</option>
                <option value="WAREHOUSE_PICKUP">DEPOT / Mandi Pickup</option>
              </select>
              <span className="text-[11px] text-gray-500 mt-1 block">Coverage: Lahore Zone</span>
            </div>
          </div>
        </div>

        {/* Step 3: Volume Tier Discount Schedule */}
        <div className="mt-10 pt-8 border-t border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
                3
              </div>
              <h2 className="text-base font-bold text-gray-900">Configure Volume-Tier Pricing Schedule</h2>
            </div>

            <button
              type="button"
              onClick={addTier}
              className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Tier
            </button>
          </div>

          <p className="text-xs text-gray-500 mb-4">
            Tiers must be contiguous. As collective reservations increase, lower tier prices are unlocked for all participants.
          </p>

          <div className="space-y-3">
            {tiers.map((tier, idx) => (
              <div
                key={idx}
                className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-200/80"
              >
                <span className="w-20 text-xs font-extrabold uppercase text-gray-500">
                  Tier {idx + 1}
                </span>

                <div className="flex-1 grid grid-cols-3 gap-3 w-full">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-0.5">Min Qty</label>
                    <input
                      type="number"
                      min="1"
                      value={tier.min_qty}
                      onChange={(e) => handleTierChange(idx, 'min_qty', e.target.value)}
                      className="w-full text-xs font-bold p-2.5 rounded-lg border border-gray-300 bg-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-0.5">Max Qty</label>
                    <input
                      type="number"
                      min="1"
                      value={tier.max_qty}
                      onChange={(e) => handleTierChange(idx, 'max_qty', e.target.value)}
                      className="w-full text-xs font-bold p-2.5 rounded-lg border border-gray-300 bg-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-0.5">Price / {unit} (PKR)</label>
                    <input
                      type="number"
                      min="1"
                      value={tier.price_per_unit}
                      onChange={(e) => handleTierChange(idx, 'price_per_unit', e.target.value)}
                      className="w-full text-xs font-extrabold p-2.5 rounded-lg border border-gray-300 bg-white text-emerald-800"
                      required
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeTier(idx)}
                  className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition self-end sm:self-center"
                  title="Remove tier"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-10 pt-8 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-end gap-3">
          <Link
            to="/supplier/dashboard"
            className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-xl text-center transition"
          >
            Cancel
          </Link>

          <button
            type="button"
            disabled={submitting || listings.length === 0}
            onClick={() => handleSubmit(false)}
            className="w-full sm:w-auto px-6 py-3 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-50 text-gray-800 font-bold text-sm rounded-xl transition"
          >
            {submitting ? 'Saving...' : 'Save as Draft'}
          </button>

          <button
            type="button"
            disabled={submitting || listings.length === 0}
            onClick={() => handleSubmit(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-sm rounded-xl shadow-md shadow-emerald-200 transition"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating & Publishing...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Create & Publish to Marketplace
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreatePoolPage;
