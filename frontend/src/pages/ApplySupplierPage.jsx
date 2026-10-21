import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import {
  ShieldCheck,
  Building2,
  MapPin,
  FileText,
  BadgeCheck,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Truck
} from 'lucide-react';

const LAHORE_MANDI_ZONES = [
  'Akbari Mandi (Old City)',
  'Badami Bagh Wholesale Market',
  'Ravi Zone / Shahdara Industrial',
  'Kot Lakhpat Industrial Area',
  'Multan Road Hub',
  'Ferozepur Road / Kahna',
  'Quaid-e-Azam Industrial Estate',
  'Sunder Industrial Estate',
  'Other Lahore Wholesale District',
];

export const ApplySupplierPage = () => {
  const { user, isAuthenticated, isBuyer, isSupplier, isAdmin, isPendingSupplier, applySupplier, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    business_name: user?.business_name || '',
    area: user?.area || 'Akbari Mandi (Old City)',
    address: user?.address || '',
    tax_ntn: '',
    food_license_no: '',
  });

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshUser();
    setRefreshing(false);
    toast.info('Account status refreshed.');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!formData.business_name.trim()) {
      setError('Business / Mill Name is required.');
      return;
    }

    if (!formData.address.trim()) {
      setError('Warehouse / Facility address is required.');
      return;
    }

    try {
      setLoading(true);
      const res = await applySupplier(formData);
      if (res.success) {
        toast.success('Supplier application submitted successfully! Your profile is pending review.');
      }
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message || 'Failed to submit application';
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  // Case 1: Unauthenticated
  if (!isAuthenticated) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-emerald-100">
          <Building2 className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
          Sell Wholesale on MilJor
        </h1>
        <p className="text-gray-600 max-w-xl mx-auto mt-2 text-sm sm:text-base">
          Direct mills, agricultural producers, and Mandi wholesale distributors pool inventory and sell directly to Lahore restaurants, commercial kitchens, and retail buyers.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 my-10 text-left">
          <div className="p-5 bg-white rounded-2xl border border-gray-200/80 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-gray-900 text-sm">Guaranteed Volume Orders</h3>
            <p className="text-xs text-gray-500 mt-1">
              Collective pools aggregate dozens of buyers into single high-volume shipments with zero marketing cost.
            </p>
          </div>

          <div className="p-5 bg-white rounded-2xl border border-gray-200/80 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
              <Truck className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-gray-900 text-sm">Organized Lahore Logistics</h3>
            <p className="text-xs text-gray-500 mt-1">
              Deliver to designated local zones (Gulberg, DHA, Badami Bagh) with predictable 2-day lead times.
            </p>
          </div>

          <div className="p-5 bg-white rounded-2xl border border-gray-200/80 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center mb-3">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-gray-900 text-sm">Direct B2B Settlements</h3>
            <p className="text-xs text-gray-500 mt-1">
              Locked pricing schedules and transparent order qualification protect cash flow and eliminate bad debts.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/login"
            className="w-full sm:w-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-md shadow-emerald-200 transition"
          >
            Sign In to Apply
          </Link>
          <Link
            to="/register"
            className="w-full sm:w-auto px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold text-sm rounded-xl transition"
          >
            Create an Account First
          </Link>
        </div>
      </div>
    );
  }

  // Case 2: Already a Verified Supplier
  if (isSupplier || isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-4 border border-emerald-200">
          <BadgeCheck className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-extrabold text-gray-900">You Are a Verified Supplier!</h2>
        <p className="text-sm text-gray-600 mt-2">
          Your business (<strong className="text-gray-900">{user?.business_name || 'Wholesale Supplier'}</strong>) has active verified supplier status on MilJor.
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <Link
            to="/supplier/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm transition"
          >
            Go to Supplier Dashboard
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  // Case 3: Application is Pending Review
  if (isPendingSupplier) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-3xl border border-gray-200/80 shadow-md p-6 sm:p-8">
          <div className="flex items-center justify-between pb-6 border-b border-gray-100">
            <div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                Application Pending Review
              </span>
              <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 mt-2">
                Supplier Verification in Progress
              </h2>
            </div>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-emerald-700 hover:bg-gray-100 rounded-lg border border-gray-200 transition"
              title="Refresh status"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="py-6 space-y-6">
            <p className="text-sm text-gray-600">
              Thank you for applying to sell on MilJor. Our Lahore operations team is reviewing your business credentials and warehouse facility details.
            </p>

            {/* Verification Timeline */}
            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-900">1. Application Received</h4>
                  <p className="text-xs text-gray-500">Business registration and facility details submitted.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center flex-shrink-0 mt-0.5 animate-pulse">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-900">2. Facility & Hygiene Audit</h4>
                  <p className="text-xs text-gray-500">
                    Physical Mandi warehouse verification and NTN / PFA license validation (usually 24–48 hours).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <BadgeCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-400">3. Supplier Portal Activation</h4>
                  <p className="text-xs text-gray-400">
                    Your account will automatically upgrade to Supplier status with pool creation access.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-xs text-gray-600 space-y-1">
              <p><strong>Registered Business:</strong> {user?.business_name || 'N/A'}</p>
              <p><strong>Hub Zone:</strong> {user?.area || 'Lahore'}</p>
              <p><strong>Contact Email:</strong> {user?.email}</p>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
            <Link
              to="/pools"
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              Browse Public Pools as Buyer
            </Link>

            <span className="text-[11px] text-gray-400">
              Questions? Contact verify@miljor.com
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Case 4: Eligible Buyer Applying
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm p-6 sm:p-10">
        <div className="pb-6 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Wholesale Seller Onboarding
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            Apply to Become a Verified Supplier
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Connect your warehouse or mill directly to Lahore commercial food buyers. Complete the verification profile below to start selling through collective procurement pools.
          </p>
        </div>

        {error && (
          <div className="mt-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-900 text-sm">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Application Error</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {/* Business Name */}
          <div>
            <label htmlFor="biz-name" className="block text-xs font-bold text-gray-700 mb-1">
              Wholesale Business / Mill Name *
            </label>
            <div className="relative rounded-xl border border-gray-300 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                <Building2 className="w-4 h-4" />
              </div>
              <input
                id="biz-name"
                type="text"
                name="business_name"
                value={formData.business_name}
                onChange={handleChange}
                placeholder="e.g. Al-Rehman Flour Mills, Akbari Mandi Wholesalers"
                className="w-full text-sm font-medium py-3 pl-10 pr-4 rounded-xl focus:outline-none"
                required
              />
            </div>
            <span className="text-[11px] text-gray-500 mt-1 block">
              Official trading name shown on buyer invoices and pool listings.
            </span>
          </div>

          {/* Lahore Mandi Hub Zone */}
          <div>
            <label htmlFor="area-select" className="block text-xs font-bold text-gray-700 mb-1">
              Primary Mandi / Industrial Hub (Lahore) *
            </label>
            <div className="relative rounded-xl border border-gray-300 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                <MapPin className="w-4 h-4" />
              </div>
              <select
                id="area-select"
                name="area"
                value={formData.area}
                onChange={handleChange}
                className="w-full text-sm font-medium py-3 pl-10 pr-4 rounded-xl focus:outline-none bg-white"
                required
              >
                {LAHORE_MANDI_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Warehouse Physical Address */}
          <div>
            <label htmlFor="address-text" className="block text-xs font-bold text-gray-700 mb-1">
              Warehouse / Mill Facility Physical Address *
            </label>
            <textarea
              id="address-text"
              name="address"
              rows={3}
              value={formData.address}
              onChange={handleChange}
              placeholder="e.g. Warehouse 14, Circular Road, Akbari Mandi, Lahore"
              className="w-full text-sm font-medium p-3.5 rounded-xl border border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              required
            />
            <span className="text-[11px] text-gray-500 mt-1 block">
              Location inspected by MilJor Operations for quality control and pickup readiness.
            </span>
          </div>

          {/* Tax NTN & Food License Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="tax-ntn" className="block text-xs font-bold text-gray-700 mb-1">
                FBR National Tax Number (NTN)
              </label>
              <div className="relative rounded-xl border border-gray-300 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                  <FileText className="w-4 h-4" />
                </div>
                <input
                  id="tax-ntn"
                  type="text"
                  name="tax_ntn"
                  value={formData.tax_ntn}
                  onChange={handleChange}
                  placeholder="e.g. 1234567-8"
                  className="w-full text-sm font-medium py-3 pl-10 pr-4 rounded-xl focus:outline-none"
                />
              </div>
              <span className="text-[11px] text-gray-500 mt-1 block">Recommended for corporate buyers</span>
            </div>

            <div>
              <label htmlFor="food-lic" className="block text-xs font-bold text-gray-700 mb-1">
                Punjab Food Authority (PFA) License
              </label>
              <div className="relative rounded-xl border border-gray-300 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                  <BadgeCheck className="w-4 h-4" />
                </div>
                <input
                  id="food-lic"
                  type="text"
                  name="food_license_no"
                  value={formData.food_license_no}
                  onChange={handleChange}
                  placeholder="e.g. PFA-LHR-2026-XXXX"
                  className="w-full text-sm font-medium py-3 pl-10 pr-4 rounded-xl focus:outline-none"
                />
              </div>
              <span className="text-[11px] text-gray-500 mt-1 block">Mandatory for grain and edible oil mills</span>
            </div>
          </div>

          {/* Quality Standards Guarantee Box */}
          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-start gap-3 text-xs text-gray-600">
            <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-gray-900 block mb-0.5">Affirmative Quality & Safety Standards</span>
              By submitting this application, you confirm that your facilities meet basic food safety standards, and you agree to allow physical warehouse verification by MilJor Operations.
            </div>
          </div>

          {/* Submit CTA */}
          <div className="pt-4 flex items-center justify-end gap-3">
            <Link
              to="/pools"
              className="px-5 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-7 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-sm rounded-xl shadow-md shadow-emerald-200 transition"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting Application...
                </>
              ) : (
                <>
                  Submit Supplier Application
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ApplySupplierPage;

