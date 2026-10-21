import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ordersApi } from '../api/orders';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import {
  Package,
  Layers,
  Clock,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Truck,
  Building2,
  ArrowRight,
  Loader2,
  ShieldCheck,
  FileText
} from 'lucide-react';

export const MyOrdersPage = () => {
  const { user, isAuthenticated, isBuyer } = useAuth();
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('ALL');

  useEffect(() => {
    if (!isAuthenticated) {
      toast.info('Please sign in to view your orders.');
      navigate('/login');
      return;
    }

    if (!isBuyer) {
      toast.error('Only buyers can view orders.');
      navigate('/pools');
      return;
    }

    fetchOrders();
  }, [isAuthenticated, isBuyer]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await ordersApi.getMyOrders();
      if (res.success && res.data?.orders) {
        setOrders(res.data.orders);
      } else {
        setOrders([]);
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to fetch your orders');
    } finally {
      setLoading(false);
    }
  };

  const getPaymentStatusBadge = (status) => {
    switch (status) {
      case 'PAID':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Paid (In Escrow)
          </span>
        );
      case 'PAYMENT_INITIATED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            Payment In Progress
          </span>
        );
      case 'AWAITING_PAYMENT':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            Awaiting Payment
          </span>
        );
    }
  };

  const filteredOrders = orders.filter((order) => {
    if (activeTab === 'AWAITING_PAYMENT') {
      return order.payment_status === 'AWAITING_PAYMENT' || order.payment_status === 'PAYMENT_INITIATED';
    }
    if (activeTab === 'PAID') {
      return order.payment_status === 'PAID';
    }
    return true;
  });

  // Calculate Metrics
  const pendingCount = orders.filter(
    (o) => o.payment_status === 'AWAITING_PAYMENT' || o.payment_status === 'PAYMENT_INITIATED'
  ).length;

  const totalPaidAmount = orders
    .filter((o) => o.payment_status === 'PAID')
    .reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Title & Browse Link */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            My Wholesale Orders
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Track confirmed wholesale orders, Safepay escrow payments, and Lahore delivery progress.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/my-reservations"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl shadow-sm transition"
          >
            <Clock className="w-4 h-4 text-gray-400" />
            My Reservations
          </Link>

          <Link
            to="/pools"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm shadow-emerald-200 transition"
          >
            <Layers className="w-4 h-4" />
            Browse Pools
          </Link>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">
            Total Orders Placed
          </span>
          <span className="text-2xl font-black text-gray-900">{orders.length}</span>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <span className="text-xs font-bold text-rose-600 uppercase tracking-wider block mb-1">
            Orders Awaiting Payment
          </span>
          <span className="text-2xl font-black text-rose-700">{pendingCount}</span>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider block mb-1">
            Total Paid in Escrow
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-xs font-bold text-emerald-700">PKR</span>
            <span className="text-2xl font-black text-emerald-800">
              {totalPaidAmount.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex border-b border-gray-200 mb-6 space-x-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('ALL')}
          className={`pb-3 relative transition ${
            activeTab === 'ALL'
              ? 'text-emerald-700 border-b-2 border-emerald-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          All Orders ({orders.length})
        </button>
        <button
          onClick={() => setActiveTab('AWAITING_PAYMENT')}
          className={`pb-3 relative transition ${
            activeTab === 'AWAITING_PAYMENT'
              ? 'text-emerald-700 border-b-2 border-emerald-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Awaiting Payment ({pendingCount})
        </button>
        <button
          onClick={() => setActiveTab('PAID')}
          className={`pb-3 relative transition ${
            activeTab === 'PAID'
              ? 'text-emerald-700 border-b-2 border-emerald-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Paid & Held in Escrow ({orders.length - pendingCount})
        </button>
      </div>

      {/* Main Content List */}
      {loading ? (
        <div className="min-h-[40vh] flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mb-3" />
          <p className="text-sm text-gray-500">Loading your wholesale orders...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-sm">
          {error}
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-gray-200 shadow-sm max-w-xl mx-auto my-8">
          <div className="w-14 h-14 bg-gray-100 text-gray-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Package className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">No Orders Found</h3>
          <p className="text-sm text-gray-500 mb-6">
            {activeTab === 'ALL'
              ? "You haven't converted any confirmed reservations into orders yet."
              : `No orders currently matching the "${activeTab.toLowerCase().replace('_', ' ')}" filter.`}
          </p>
          <Link
            to="/my-reservations"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md shadow-emerald-200 transition"
          >
            Check My Reservations
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const isAwaiting =
              order.payment_status === 'AWAITING_PAYMENT' || order.payment_status === 'PAYMENT_INITIATED';

            return (
              <div
                key={order.id}
                className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm hover:border-emerald-200 hover:shadow-md transition"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4 mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-mono text-sm font-black text-gray-900">
                        {order.order_code}
                      </span>
                      {getPaymentStatusBadge(order.payment_status)}
                    </div>
                    <p className="text-xs text-gray-500">
                      Created on {new Date(order.created_at).toLocaleDateString('en-PK', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      to={`/orders/${order.id}/checkout`}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl shadow-sm transition ${
                        isAwaiting
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                      }`}
                    >
                      {isAwaiting ? (
                        <>
                          <CreditCard className="w-3.5 h-3.5" />
                          Complete Checkout & Pay
                        </>
                      ) : (
                        <>
                          <FileText className="w-3.5 h-3.5" />
                          View Invoice & Escrow
                        </>
                      )}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-gray-400 font-medium block uppercase text-[10px] mb-1">
                      Commodity
                    </span>
                    <p className="text-sm font-bold text-gray-900">
                      {order.product_name || 'Commodity'}
                    </p>
                    <p className="text-emerald-700 font-semibold mt-0.5">
                      {order.quality_grade || 'Grade-A Standard'}
                    </p>
                  </div>

                  <div>
                    <span className="text-gray-400 font-medium block uppercase text-[10px] mb-1">
                      Committed Volume
                    </span>
                    <p className="text-sm font-bold text-gray-900">
                      {Number(order.total_qty).toLocaleString()} {order.pool_unit || 'Units'}
                    </p>
                    <p className="text-gray-500 mt-0.5">
                      @ PKR {Number(order.unit_price).toLocaleString()} / unit
                    </p>
                  </div>

                  <div className="md:text-right">
                    <span className="text-gray-400 font-medium block uppercase text-[10px] mb-1">
                      Total Invoice Amount
                    </span>
                    <div className="flex items-baseline md:justify-end gap-1">
                      <span className="text-xs font-bold text-emerald-700">PKR</span>
                      <span className="text-xl font-black text-gray-900">
                        {Number(order.total_amount).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 block mt-0.5">
                      (Includes platform & delivery fee)
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-gray-400" />
                    Deliver to: {order.delivery_address || 'Lahore'}
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Safepay Escrow Protected
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MyOrdersPage;
