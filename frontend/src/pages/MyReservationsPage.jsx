import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { reservationsApi } from '../api/reservations';
import { ordersApi } from '../api/orders';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import {
  Package,
  Layers,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  TrendingDown,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Loader2,
  Truck,
  CreditCard
} from 'lucide-react';

export const MyReservationsPage = () => {
  const { user, isAuthenticated, isBuyer } = useAuth();
  const navigate = useNavigate();

  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('ALL');

  // Cancel confirmation modal state
  const [cancellingResId, setCancellingResId] = useState(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      toast.info('Please sign in to view your reservations.');
      navigate('/login');
      return;
    }
    fetchReservations();
  }, [isAuthenticated]);

  const fetchReservations = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await reservationsApi.getMyReservations();
      if (res.success && res.data?.reservations) {
        setReservations(res.data.reservations);
      } else {
        setReservations([]);
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to fetch your reservations');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCancelModal = (resId) => {
    setCancellingResId(resId);
    setCancelReason('');
    setCancelModalOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!cancellingResId) return;

    try {
      setActionLoading(true);
      const res = await reservationsApi.cancelReservation(cancellingResId, cancelReason);
      if (res.success) {
        toast.success('Reservation cancelled successfully.');
        setCancelModalOpen(false);
        setCancellingResId(null);
        fetchReservations();
      }
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || 'Failed to cancel reservation';
      toast.error(errMsg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateOrderAndCheckout = async (resId) => {
    try {
      setActionLoading(true);
      const res = await ordersApi.createOrder({ reservation_id: resId });
      if (res.success && res.data?.order) {
        toast.success('Order created! Navigating to checkout...');
        navigate(`/orders/${res.data.order.id}/checkout`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to initialize order checkout');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status, isPriceLocked) => {
    switch (status) {
      case 'RESERVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            Pool Active (Pricing Dynamic)
          </span>
        );
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
            Confirmed (Price Locked)
          </span>
        );
      case 'PAID':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-teal-50 text-teal-800 border border-teal-200">
            <CheckCircle className="w-3.5 h-3.5 text-teal-600" />
            Paid & In Fulfillment
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
            <XCircle className="w-3.5 h-3.5 text-gray-400" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            {status}
          </span>
        );
    }
  };

  // Filter reservations based on activeTab
  const filteredReservations = reservations.filter((r) => {
    if (activeTab === 'ACTIVE') return r.status === 'RESERVED';
    if (activeTab === 'CONFIRMED') return ['CONFIRMED', 'PAID'].includes(r.status);
    if (activeTab === 'CANCELLED') return r.status === 'CANCELLED';
    return true;
  });

  // Summary Metrics
  const activeCount = reservations.filter((r) => r.status === 'RESERVED').length;
  const totalSpend = reservations
    .filter((r) => ['RESERVED', 'CONFIRMED', 'PAID'].includes(r.status))
    .reduce((sum, r) => sum + (Number(r.locked_total_price || r.total_price) || 0), 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Title & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            My Wholesale Reservations
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Track and manage your committed pool volumes, locked pricing, and fulfillment status across Lahore.
          </p>
        </div>

        <Link
          to="/pools"
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm shadow-emerald-200 transition"
        >
          <Layers className="w-4 h-4" />
          Browse Active Pools
        </Link>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Reservations</span>
            <span className="text-2xl font-black text-gray-900 mt-1 block">{activeCount}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Reservations</span>
            <span className="text-2xl font-black text-gray-900 mt-1 block">{reservations.length}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Package className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Estimated Procurement Value</span>
            <span className="text-2xl font-black text-emerald-700 mt-1 block">
              PKR {totalSpend.toLocaleString()}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <TrendingDown className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex border-b border-gray-200 mb-6 space-x-2 sm:space-x-4 overflow-x-auto">
        <button
          onClick={() => setActiveTab('ALL')}
          className={`pb-3 px-3 text-sm font-bold border-b-2 transition whitespace-nowrap ${
            activeTab === 'ALL'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          All ({reservations.length})
        </button>
        <button
          onClick={() => setActiveTab('ACTIVE')}
          className={`pb-3 px-3 text-sm font-bold border-b-2 transition whitespace-nowrap ${
            activeTab === 'ACTIVE'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Active Pooling ({activeCount})
        </button>
        <button
          onClick={() => setActiveTab('CONFIRMED')}
          className={`pb-3 px-3 text-sm font-bold border-b-2 transition whitespace-nowrap ${
            activeTab === 'CONFIRMED'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Confirmed & Delivered
        </button>
        <button
          onClick={() => setActiveTab('CANCELLED')}
          className={`pb-3 px-3 text-sm font-bold border-b-2 transition whitespace-nowrap ${
            activeTab === 'CANCELLED'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Cancelled
        </button>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="min-h-[40vh] flex flex-col items-center justify-center p-8">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mb-3" />
          <p className="text-gray-500 text-sm">Fetching your reservations...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center max-w-lg mx-auto">
          <AlertCircle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-rose-900">{error}</p>
          <button
            onClick={fetchReservations}
            className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-lg transition"
          >
            Retry
          </button>
        </div>
      ) : filteredReservations.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-2xl border border-gray-200/80 shadow-sm">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-gray-900">No reservations found</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mt-1 mb-6">
            {activeTab === 'ALL'
              ? "You haven't joined any collective procurement pools yet. Join fellow Lahore buyers to unlock volume pricing."
              : `No reservations found under the ${activeTab.toLowerCase()} status.`}
          </p>
          <Link
            to="/pools"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm transition"
          >
            Explore Active Pools
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredReservations.map((res) => {
            const isPriceLocked = res.locked_unit_price !== null;
            const effectiveUnitPrice = res.locked_unit_price || res.unit_price;
            const effectiveTotal = res.locked_total_price || res.total_price;
            const unit = res.pool_unit || 'unit';

            return (
              <div
                key={res.id}
                className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 sm:p-6 hover:border-emerald-300 transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold bg-gray-100 px-2.5 py-1 rounded-md text-gray-800">
                      {res.reservation_code || `RES-${res.id}`}
                    </span>
                    <span className="text-xs text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      {new Date(res.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {getStatusBadge(res.status, isPriceLocked)}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 py-4 items-center">
                  {/* Column 1: Commodity Title & Specs */}
                  <div className="md:col-span-2">
                    <Link
                      to={`/pools/${res.pool_id}`}
                      className="text-base font-extrabold text-gray-900 hover:text-emerald-700 transition flex items-center gap-1.5 group"
                    >
                      {res.specification?.product_title || res.product_title || 'Commodity'}
                      <ExternalLink className="w-3.5 h-3.5 text-gray-400 group-hover:text-emerald-600 transition" />
                    </Link>

                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-600">
                      {res.specification?.quality_grade && (
                        <span className="bg-gray-100 px-2 py-0.5 rounded font-medium">
                          {res.specification.quality_grade}
                        </span>
                      )}
                      <span className="text-gray-500 font-medium">
                        Supplier: <strong className="text-gray-800">{res.supplier?.business_name || res.supplier_name || 'Verified Supplier'}</strong>
                      </span>
                    </div>

                    {res.pool_progress && (
                      <div className="mt-3 text-xs text-gray-500 flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                        <span>
                          Pool Demand: <strong>{res.pool_progress.current_aggregate_qty} {unit}s</strong> committed across Lahore
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Column 2: Reserved Quantity */}
                  <div className="text-left md:text-center">
                    <span className="text-xs text-gray-500 block uppercase font-semibold">Reserved Volume</span>
                    <span className="text-xl font-black text-gray-900 mt-0.5 block">
                      {res.quantity} {unit}s
                    </span>
                  </div>

                  {/* Column 3: Pricing & Spend */}
                  <div className="text-left md:text-right">
                    <span className="text-xs text-gray-500 block uppercase font-semibold">
                      {isPriceLocked ? 'Locked Total' : 'Estimated Total'}
                    </span>
                    <div className="flex items-baseline md:justify-end gap-1 mt-0.5">
                      <span className="text-xs font-bold text-emerald-700">PKR</span>
                      <span className="text-xl font-black text-gray-900">
                        {Number(effectiveTotal).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 block mt-0.5">
                      @ PKR {Number(effectiveUnitPrice).toLocaleString()} / {unit}
                    </span>
                  </div>
                </div>

                {/* Footer Actions: Cancel reservation if allowed */}
                {res.permissions?.can_cancel && (
                  <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-xs">
                    <span className="text-gray-500">
                      Need to adjust or cancel? You can cancel before the pool deadline free of penalty.
                    </span>

                    <button
                      type="button"
                      onClick={() => handleOpenCancelModal(res.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg border border-rose-200 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Cancel Reservation
                    </button>
                  </div>
                )}

                {/* Footer Action: Order Checkout if Confirmed */}
                {res.status === 'CONFIRMED' && (
                  <div className="pt-4 border-t border-emerald-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs bg-emerald-50/40 -mx-6 -mb-6 p-4 rounded-b-2xl">
                    <span className="text-emerald-900 font-semibold flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                      Commercial terms locked! Proceed to checkout to secure wholesale delivery.
                    </span>

                    <button
                      type="button"
                      onClick={() => handleCreateOrderAndCheckout(res.id)}
                      disabled={actionLoading}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm shadow-emerald-200 transition shrink-0 disabled:opacity-50"
                    >
                      {actionLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Preparing Checkout...
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-3.5 h-3.5" />
                          Proceed to Checkout
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {cancelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-gray-900 mb-2">Cancel Reservation?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to cancel this reservation? Your volume will be released back into the collective pool.
            </p>

            <div className="mb-5">
              <label htmlFor="cancel-reason" className="block text-xs font-medium text-gray-700 mb-1">
                Reason for cancellation (optional):
              </label>
              <textarea
                id="cancel-reason"
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Schedule changed, order size adjusted..."
                className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition"
              >
                Keep Reservation
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'Yes, Cancel'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyReservationsPage;
