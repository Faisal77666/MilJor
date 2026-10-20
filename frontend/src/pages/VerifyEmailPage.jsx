import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { Mail, CheckCircle2, AlertCircle, ArrowRight, RefreshCw, ShoppingBag } from 'lucide-react';

export const VerifyEmailPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { verifyEmail, resendOtp } = useAuth();

  const initialEmail = location.state?.email || new URLSearchParams(location.search).get('email') || '';
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleOtpChange = (e) => {
    // Only accept numeric digits, maximum 6
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setOtp(val);
  };

  const handleVerify = async (e) => {
    e.preventDefault();

    if (!email.trim()) {
      toast.error('Please enter your email address.');
      return;
    }

    if (otp.length !== 6) {
      toast.error('Please enter the full 6-digit OTP code.');
      return;
    }

    setLoading(true);
    try {
      await verifyEmail({ email: email.trim(), otp: otp.trim() });
      toast.success('Email verified successfully! Welcome to MilJor.');
      navigate('/pools', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Verification failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email.trim()) {
      toast.error('Please enter your email to resend OTP.');
      return;
    }

    setResending(true);
    try {
      const res = await resendOtp({ email: email.trim() });
      toast.success(res.message || 'New 6-digit OTP sent to your email!');
      setCooldown(60);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Failed to resend OTP';
      toast.error(msg);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-8 sm:p-10 rounded-3xl shadow-sm border border-gray-200/80">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-200 mb-4">
            <Mail className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">
            Verify Your Email
          </h2>
          <p className="mt-1.5 text-sm text-gray-500">
            Enter the 6-digit verification code sent to your email address.
          </p>
        </div>

        <form className="mt-6 space-y-5" onSubmit={handleVerify}>
          {/* Email field (readonly if prefilled, editable if not) */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                className="w-full pl-10 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
            </div>
          </div>

          {/* OTP Code Input */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                6-Digit Verification Code
              </label>
              <span className={`text-[11px] font-semibold ${otp.length === 6 ? 'text-emerald-600' : 'text-gray-400'}`}>
                {otp.length}/6 digits
              </span>
            </div>
            <input
              type="text"
              required
              maxLength={6}
              value={otp}
              onChange={handleOtpChange}
              placeholder="123456"
              className="w-full tracking-[0.5em] text-center font-mono text-2xl py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
            />
            <p className="text-[11px] text-gray-500 mt-1.5 text-center">
              Check your inbox and spam folder for the MilJor verification email.
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-xl shadow-md shadow-emerald-200 transition disabled:opacity-50"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                Verify Account
                <CheckCircle2 className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Resend OTP */}
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || cooldown > 0}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 disabled:text-gray-400 inline-flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-3 h-3 ${resending ? 'animate-spin' : ''}`} />
            {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend Verification Code'}
          </button>
        </div>

        {/* Back to sign in */}
        <div className="pt-4 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-600">
            Already verified?{' '}
            <Link to="/login" className="font-bold text-emerald-600 hover:text-emerald-700 underline">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmailPage;
