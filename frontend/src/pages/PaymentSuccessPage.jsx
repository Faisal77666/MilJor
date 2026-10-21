import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ordersApi } from '../api/orders';
import { useAuth } from '../context/AuthContext';
import { LottieAnimation } from '../components/LottieAnimation';
import animationData from '../assets/animations/success.json';
import {
  ShieldCheck,
  Package,
  ArrowRight,
  Loader2,
  FileText
} from 'lucide-react';

export const PaymentSuccessPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState(null);
  const [reconcileResult, setReconcileResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    handleVerification();
  }, [id, isAuthenticated]);

  const handleVerification = async () => {
    try {
      setLoading(true);
      setError(null);

      // Reconcile with Safepay provider
      try {
        const reconcileRes = await ordersApi.reconcilePayment(id);
        if (reconcileRes.success) {
          setReconcileResult(reconcileRes.data);
        }
      } catch (recErr) {
        // Fall back to reading authoritative order status
        console.warn('Reconcile note:', recErr.message);
      }

      // Fetch the updated authoritative order
      const orderRes = await ordersApi.getOrderById(id);
      if (orderRes.success && orderRes.data?.order) {
        setOrder(orderRes.data.order);
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Unable to verify payment status.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-4">
        <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mb-4" />
        <h2 className="text-lg font-bold text-gray-900 mb-1">Verifying Escrow Payment...</h2>
        <p className="text-sm text-gray-500">
          Confirming cryptographic transaction with Safepay Sandbox...
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-16">
      <div className="bg-white rounded-3xl p-8 border border-gray-200 shadow-xl text-center animate-in fade-in zoom-in-95 duration-200">
        {/* Lottie Animation & Success Heading */}
        <div className="flex justify-center -mt-4 -mb-2">
          <LottieAnimation animationData={animationData} width={300} height={300} loop={false} autoplay={true} />
        </div>

        <h5 className="text-center mb-10 text-[25px] font-extrabold text-[#000000a1] tracking-tight">
          Your order is successful 😍
        </h5>

        {order && (
          <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100 text-left text-xs space-y-3 mb-6">
            <div className="flex justify-between items-center border-b border-gray-200 pb-2">
              <span className="text-gray-500">Order Code:</span>
              <span className="font-mono font-bold text-gray-900">{order.order_code}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-500">Commodity:</span>
              <span className="font-bold text-gray-900">{order.product_name}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-500">Quantity:</span>
              <span className="font-bold text-gray-900">
                {Number(order.total_qty).toLocaleString()} {order.pool_unit || 'Units'}
              </span>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-gray-200 text-sm">
              <span className="font-bold text-gray-700">Total Paid:</span>
              <span className="font-black text-emerald-700">
                PKR {Number(order.total_amount).toLocaleString()}
              </span>
            </div>
          </div>
        )}

        <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 flex items-center gap-3 text-left mb-6 text-xs text-emerald-900">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>
            Payment is safeguarded. Payout to supplier is released only after you confirm delivery.
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/my-orders"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 py-3 px-6 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md shadow-emerald-200 transition"
          >
            <Package className="w-4 h-4" />
            View My Orders
            <ArrowRight className="w-4 h-4" />
          </Link>

          <Link
            to={`/orders/${id}/checkout`}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 py-3 px-5 text-sm font-semibold text-gray-700 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-xl transition"
          >
            <FileText className="w-4 h-4" />
            View Invoice
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PaymentSuccessPage;
