import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { ordersApi } from '../api/orders';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import {
  ShieldCheck,
  CreditCard,
  Lock,
  ArrowRight,
  Truck,
  Building2,
  Package,
  Layers,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  RotateCcw,
  Check
} from 'lucide-react';

export const OrderCheckoutPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isBuyer } = useAuth();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [reconcileLoading, setReconcileLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      toast.info('Please sign in to proceed with checkout.');
      navigate('/login');
      return;
    }

    if (!isBuyer) {
      toast.error('Only buyers can view order checkout.');
      navigate('/pools');
      return;
    }

    fetchOrderDetails();
  }, [id, isAuthenticated, isBuyer]);

  const fetchOrderDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await ordersApi.getOrderById(id);
      if (res.success && res.data?.order) {
        setOrder(res.data.order);
      } else {
        setError('Order not found.');
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load order details');
    } finally {
      setLoading(false);
    }
  };

  const handleInitiateSafepayCheckout = async () => {
    if (!order) return;

    try {
      setCheckoutLoading(true);
      const redirectUrl = `${window.location.origin}/orders/${order.id}/payment-success`;
      const cancelUrl = window.location.href;

      const res = await ordersApi.initiateCheckout(order.id, {
        redirect_url: redirectUrl,
        cancel_url: cancelUrl,
      });

      if (res.success && res.data?.checkout_url) {
        toast.info('Redirecting to Safepay Secure Sandbox Gateway...');
        // Safely redirect to Safepay hosted checkout
        window.location.href = res.data.checkout_url;
      } else {
        toast.error('Could not retrieve Safepay checkout URL. Please try again.');
        fetchOrderDetails();
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Checkout initiation failed';
      toast.error(msg);
      fetchOrderDetails();
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleReconcilePayment = async () => {
    if (!order) return;

    try {
      setReconcileLoading(true);
      const res = await ordersApi.reconcilePayment(order.id);
      if (res.success) {
        toast.success('Payment verified and confirmed successfully!');
        fetchOrderDetails();
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Payment not yet confirmed by gateway';
      toast.info(msg);
    } finally {
      setReconcileLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PAID':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Paid & Held in Escrow
          </span>
        );
      case 'PAYMENT_INITIATED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <Clock className="w-4 h-4 text-amber-600" />
            Payment In Progress
          </span>
        );
      case 'AWAITING_PAYMENT':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            Awaiting Payment
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-4">
        <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
        <p className="text-gray-500 text-sm font-medium">Loading authoritative order invoice...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-xl mx-auto my-12 p-6 bg-white rounded-2xl shadow-sm border border-gray-200 text-center">
        <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Order Not Available</h2>
        <p className="text-sm text-gray-600 mb-6">{error || 'Unable to retrieve order details.'}</p>
        <Link
          to="/my-orders"
          className="inline-flex items-center justify-center px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition"
        >
          View My Orders
        </Link>
      </div>
    );
  }

  const isPaid = order.payment_status === 'PAID';
  const isInitiated = order.payment_status === 'PAYMENT_INITIATED';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Breadcrumb & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
            <Link to="/my-orders" className="hover:text-emerald-600 transition">
              My Orders
            </Link>
            <span>/</span>
            <span className="font-mono text-gray-700 font-semibold">{order.order_code}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            Wholesale Order Checkout
          </h1>
        </div>

        <div>{getStatusBadge(order.payment_status)}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Order Invoice & Delivery Address */}
        <div className="lg:col-span-7 space-y-6">
          {/* Commodity Details Card */}
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-emerald-600" />
                <h2 className="text-base font-bold text-gray-900">Commodity Specification</h2>
              </div>
              <span className="text-xs font-mono font-medium text-gray-500">
                Pool: {order.pool_code}
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="text-lg font-black text-gray-900">{order.product_name || 'Standard Commodity'}</h3>
                <p className="text-xs text-emerald-700 font-semibold mt-0.5">
                  Quality Grade: {order.quality_grade || 'Grade-A Standard'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2 text-xs">
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                  <span className="text-gray-500 block uppercase text-[10px] font-bold">Committed Quantity</span>
                  <span className="text-sm font-black text-gray-900">
                    {Number(order.total_qty).toLocaleString()} {order.pool_unit || 'Units'}
                  </span>
                </div>

                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                  <span className="text-gray-500 block uppercase text-[10px] font-bold">Locked Unit Price</span>
                  <span className="text-sm font-black text-gray-900">
                    PKR {Number(order.unit_price).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2 text-xs text-gray-600">
                <Building2 className="w-4 h-4 text-gray-400" />
                <span>Verified Supplier: </span>
                <span className="font-bold text-gray-900">{order.supplier_name || 'Verified Wholesale Mill'}</span>
              </div>
            </div>
          </div>

          {/* Delivery Destination Card */}
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-4 mb-4">
              <Truck className="w-5 h-5 text-emerald-600" />
              <h2 className="text-base font-bold text-gray-900">Delivery Destination</h2>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-baseline justify-between">
                <span className="text-gray-500 font-medium">Delivery Mode:</span>
                <span className="font-bold text-gray-900">{order.delivery_type} (Doorstep Fulfillment)</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-gray-500 font-medium">Cluster Zone:</span>
                <span className="font-bold text-gray-900">{order.cluster_zone || 'Lahore Metro'}</span>
              </div>
              <div className="pt-2 border-t border-gray-100">
                <span className="text-gray-500 block mb-1">Destination Address:</span>
                <p className="text-sm font-medium text-gray-900 bg-gray-50 p-3 rounded-xl border border-gray-100">
                  {order.delivery_address || 'Registered Business Address, Lahore'}
                </p>
              </div>
            </div>
          </div>

          {/* Safepay Escrow Guarantee Card */}
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-emerald-200">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-emerald-950">
                  100% Escrow Protection via Safepay
                </h4>
                <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
                  Your payment is securely held in Safepay escrow. The supplier is paid only after
                  your order is delivered in Lahore and you inspect the goods for Grade-A standard conformance.
                </p>
                <div className="mt-3 flex items-center gap-4 text-[11px] font-semibold text-emerald-700">
                  <span className="inline-flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-emerald-600" /> Zero Upfront Supplier Payout
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-emerald-600" /> 48-Hour Inspection Window
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Invoice Summary & Payment Action */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm sticky top-6">
            <h2 className="text-base font-bold text-gray-900 border-b border-gray-100 pb-3 mb-4">
              Invoice Summary
            </h2>

            {/* Line items */}
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center text-gray-600">
                <span>Commodity Subtotal</span>
                <span className="font-semibold text-gray-900">
                  PKR {Number(order.subtotal_amount).toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between items-center text-gray-600">
                <span>Platform Service Fee</span>
                <span className="font-semibold text-gray-900">
                  PKR {Number(order.buyer_platform_fee).toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between items-center text-gray-600">
                <span>Lahore Delivery & Logistics</span>
                <span className="font-semibold text-gray-900">
                  PKR {Number(order.delivery_fee).toLocaleString()}
                </span>
              </div>

              <div className="pt-3 border-t border-gray-200 flex justify-between items-baseline">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500 block">
                    Total Payable
                  </span>
                  <span className="text-[10px] text-gray-400">All taxes included</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-emerald-700 mr-1">PKR</span>
                  <span className="text-2xl font-black text-gray-900">
                    {Number(order.total_amount).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Button / Status Actions */}
            <div className="mt-6 pt-5 border-t border-gray-100">
              {isPaid ? (
                <div className="space-y-3 text-center">
                  <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-800 text-xs font-semibold">
                    <CheckCircle2 className="w-5 h-5 mx-auto text-emerald-600 mb-1" />
                    Payment is confirmed. Your order is now queued for supplier dispatch.
                  </div>
                  <Link
                    to="/my-orders"
                    className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md shadow-emerald-200 transition"
                  >
                    View in My Orders
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={handleInitiateSafepayCheckout}
                    disabled={checkoutLoading}
                    className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-xl shadow-md shadow-emerald-200 transition disabled:opacity-50"
                  >
                    {checkoutLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Connecting to Safepay...
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4" />
                        {isInitiated ? 'Resume Safepay Checkout' : 'Pay with Safepay Escrow'}
                      </>
                    )}
                  </button>

                  {isInitiated && (
                    <button
                      type="button"
                      onClick={handleReconcilePayment}
                      disabled={reconcileLoading}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-bold text-gray-700 hover:text-emerald-700 bg-gray-50 hover:bg-emerald-50/50 rounded-xl border border-gray-200 transition disabled:opacity-50"
                    >
                      {reconcileLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                          Checking Gateway...
                        </>
                      ) : (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          Verify / Reconcile Payment Now
                        </>
                      )}
                    </button>
                  )}

                  <div className="pt-2 flex items-center justify-center gap-3 text-[10px] text-gray-400">
                    <span className="flex items-center gap-1">
                      <Lock className="w-3 h-3 text-gray-400" /> 256-bit SSL Encrypted
                    </span>
                    <span>•</span>
                    <span>Safepay Sandbox Partner</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderCheckoutPage;
