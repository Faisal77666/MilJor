import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShoppingBag, Lock, Mail, Phone, Building2, User, MapPin, AlertCircle, Check, ArrowRight } from 'lucide-react';

const LAHORE_AREAS = [
  'Gulberg',
  'DHA Phase 1–8',
  'Johar Town',
  'Model Town',
  'Faisal Town',
  'Anarkali / Old City',
  'Badami Bagh',
  'Iqbal Town',
  'Wapda Town',
  'Cavalry Ground',
  'Township',
  'Raiwind Road',
  'Other (Lahore)',
];

export const RegisterPage = () => {
  const [formData, setFormData] = useState({
    business_name: '',
    full_name: '',
    email: '',
    phone: '',
    password: '',
    area: 'Gulberg',
    address: '',
  });

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const { register } = useAuth();
  const navigate = useNavigate();

  // Password validation helpers matching backend invariants
  const isLengthValid = formData.password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(formData.password);
  const hasNumber = /[0-9]/.test(formData.password);
  const isPasswordValid = isLengthValid && hasLetter && hasNumber;

  // Phone validation: exact 11 digits
  const cleanPhone = formData.phone.replace(/\D/g, '');
  const isPhoneValid = /^[0-9]{11}$/.test(cleanPhone);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      // Restrict strictly to digits and max 11 digits
      const digitsOnly = value.replace(/\D/g, '').slice(0, 11);
      setFormData((prev) => ({ ...prev, phone: digitsOnly }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!formData.email && !formData.phone) {
      setError('Either an email address or phone number is required.');
      return;
    }

    if (formData.phone && !/^[0-9]{11}$/.test(cleanPhone)) {
      setError('Phone number must be exactly 11 digits (e.g. 03001234567).');
      return;
    }

    if (!isPasswordValid) {
      setError('Password must be at least 8 characters long and contain both letters and numbers.');
      return;
    }

    setLoading(true);
    try {
      await register(formData);
      navigate('/pools');
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl w-full space-y-8 bg-white p-8 sm:p-10 rounded-3xl shadow-sm border border-gray-200/80">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-200 mb-4">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">
            Register Food Business
          </h2>
          <p className="mt-1.5 text-sm text-gray-500">
            Join Lahore restaurants, caterers, and canteens purchasing at bulk wholesale prices
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-rose-800 text-sm">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Registration Issue</p>
              <p className="text-rose-700 text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Form */}
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                Business Name
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  name="business_name"
                  required
                  placeholder="e.g. Spice Hub Kitchen"
                  value={formData.business_name}
                  onChange={handleChange}
                  className="w-full pl-10 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  name="full_name"
                  required
                  placeholder="Your Name"
                  value={formData.full_name}
                  onChange={handleChange}
                  className="w-full pl-10 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="restaurant@miljor.com"
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full pl-10 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                  Mobile / WhatsApp (Exact 11 Digits)
                </label>
                <span className={`text-[11px] font-semibold ${isPhoneValid ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {cleanPhone.length}/11 digits
                </span>
              </div>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="tel"
                  name="phone"
                  required
                  maxLength={11}
                  placeholder="03001234567"
                  value={formData.phone}
                  onChange={handleChange}
                  className={`w-full pl-10 pr-3 py-2 text-sm bg-gray-50 border rounded-xl focus:bg-white focus:outline-none focus:ring-2 transition ${
                    cleanPhone.length > 0 && !isPhoneValid
                      ? 'border-amber-300 focus:ring-amber-500'
                      : isPhoneValid
                      ? 'border-emerald-300 focus:ring-emerald-500'
                      : 'border-gray-200 focus:ring-emerald-500'
                  }`}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                {isPhoneValid ? (
                  <span className="text-emerald-600 font-semibold inline-flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Valid 11-digit mobile number
                  </span>
                ) : cleanPhone.length > 0 ? (
                  <span className="text-amber-600 font-medium">
                    {11 - cleanPhone.length} more digit{11 - cleanPhone.length === 1 ? '' : 's'} needed (must be exactly 11)
                  </span>
                ) : (
                  <span className="text-gray-400">Must be exactly 11 digits (e.g. 03001234567)</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                Lahore Market / Area
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <select
                  name="area"
                  value={formData.area}
                  onChange={handleChange}
                  className="w-full pl-10 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                >
                  {LAHORE_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                Delivery Address
              </label>
              <input
                type="text"
                name="address"
                placeholder="Shop #, Street, Plaza"
                value={formData.address}
                onChange={handleChange}
                className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
              Create Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                name="password"
                required
                placeholder="Min. 8 characters"
                value={formData.password}
                onChange={handleChange}
                className="w-full pl-10 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
            </div>

            {/* Password Requirement Indicators */}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <span className={`inline-flex items-center gap-1 ${isLengthValid ? 'text-emerald-600 font-semibold' : 'text-gray-400'}`}>
                <Check className="w-3.5 h-3.5" /> 8+ chars
              </span>
              <span className={`inline-flex items-center gap-1 ${hasLetter ? 'text-emerald-600 font-semibold' : 'text-gray-400'}`}>
                <Check className="w-3.5 h-3.5" /> Contains letters
              </span>
              <span className={`inline-flex items-center gap-1 ${hasNumber ? 'text-emerald-600 font-semibold' : 'text-gray-400'}`}>
                <Check className="w-3.5 h-3.5" /> Contains numbers
              </span>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || !isPasswordValid || !isPhoneValid}
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-xl shadow-md shadow-emerald-200 transition disabled:opacity-50"
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Register as Verified Buyer
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Footer Link */}
        <div className="pt-4 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-600">
            Already have an account?{' '}
            <Link to="/login" className="font-bold text-emerald-600 hover:text-emerald-700 underline">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;

