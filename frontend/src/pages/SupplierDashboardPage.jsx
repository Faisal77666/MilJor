import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supplierApi } from '../api/supplier';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { SupplierPoolSummaryModal } from '../components/SupplierPoolSummaryModal';
import {
  Layers,
  PlusCircle,
  Package,
  TrendingDown,
  Clock,
  CheckCircle,
  AlertCircle,
  ShieldCheck,
  Send,
  Loader2,
  ExternalLink,
  Users,
  Eye,
  FileEdit
} from 'lucide-react';

export const SupplierDashboardPage = () => {
  const { user, isAuthenticated, isSupplier, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('ALL');

  // Summary Modal state
  const [selectedPoolId, setSelectedPoolId] = useState(null);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);

  // Publishing state
  const [publishingId, setPublishingId] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) {
      toast.info('Please sign in as a supplier.');
      navigate('/login');
      return;
    }

    if (!isSupplier && !isAdmin) {
      toast.error('Access restricted to verified suppliers.');
      navigate('/pools');
      return;
    }

    fetchSupplierPools();
  }, [isAuthenticated, isSupplier, isAdmin]);

  const fetchSupplierPools = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await supplierApi.getMyPools();
      if (res.success && res.data?.pools) {
        setPools(res.data.pools);
      } else {
        setPools([]);
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load supplier pools');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSummary = (poolId) => {
    setSelectedPoolId(poolId);
    setSummaryModalOpen(true);
  };

  const handlePublish = async (poolId) => {
    try {
      setPublishingId(poolId);
      const res = await supplierApi.publishPool(poolId);
      if (res.success) {
        toast.success(`Pool ${res.data?.pool?.pool_code || ''} published successfully to the marketplace!`);
        fetchSupplierPools();
      }
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to publish pool');
    } finally {
      setPublishingId(null);
    }
  };

  // Filter pools based on activeTab
  const filteredPools = pools.filter((p) => {
    if (activeTab === 'ACTIVE') return p.status === 'ACTIVE';
    if (activeTab === 'DRAFT') return p.status === 'DRAFT';
    if (activeTab === 'CLOSED') return ['CONFIRMED', 'CLOSED', 'CANCELLED'].includes(p.status);
    return true;
  });

  // Calculate Metrics
  const totalCommitted = pools.reduce((acc, p) => acc + (Number(p.current_qty) || 0), 0);
  const activeCount = pools.filter((p) => p.status === 'ACTIVE').length;
  const draftCount = pools.filter((p) => p.status === 'DRAFT').length;

  const getStatusBadge = (status) => {
    switch (status) {
      case 'DRAFT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-700 border border-gray-300">
            <Clock className="w-3 h-3 text-gray-500" />
            Draft
          </span>
        );
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle className="w-3 h-3 text-emerald-600" />
            Live Marketplace
          </span>
        );
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-50 text-teal-800 border border-teal-200">
            <CheckCircle className="w-3 h-3 text-teal-600" />
            Confirmed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-800 to-teal-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-white/20 backdrop-blur-md text-emerald-100 border border-white/20">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
              Verified Wholesale Supplier
            </span>
            <span className="text-xs text-emerald-200">{user?.area || 'Lahore'}</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            {user?.business_name || 'Supplier Procurement Portal'}
          </h1>
          <p className="text-emerald-100/90 text-sm mt-1 max-w-xl">
            Create collective volume pools directly from your verified listings. Aggregate Lahore buyers and guarantee large wholesale orders.
          </p>
        </div>

        <Link
          to="/supplier/pools/new"
          className="inline-flex items-center gap-2 px-5 py-3 bg-white text-emerald-900 hover:bg-emerald-50 active:bg-gray-100 font-extrabold text-sm rounded-xl shadow-lg transition"
        >
          <PlusCircle className="w-5 h-5 text-emerald-700" />
          Create New Collective Pool
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm">
          <span className="text-[11px] font-bold uppercase text-gray-500 block">Total Pools</span>
          <span className="text-2xl font-black text-gray-900 mt-1 block">{pools.length}</span>
          <span className="text-[11px] text-gray-500 mt-0.5 block">Managed</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm">
          <span className="text-[11px] font-bold uppercase text-emerald-700 block">Active Pools</span>
          <span className="text-2xl font-black text-emerald-800 mt-1 block">{activeCount}</span>
          <span className="text-[11px] text-emerald-600 mt-0.5 block">Live on Marketplace</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm">
          <span className="text-[11px] font-bold uppercase text-amber-700 block">Draft Pools</span>
          <span className="text-2xl font-black text-amber-800 mt-1 block">{draftCount}</span>
          <span className="text-[11px] text-amber-600 mt-0.5 block">Ready to publish</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm">
          <span className="text-[11px] font-bold uppercase text-gray-500 block">Total Committed Volume</span>
          <span className="text-2xl font-black text-teal-800 mt-1 block">{totalCommitted}</span>
          <span className="text-[11px] text-gray-500 mt-0.5 block">Units across Lahore</span>
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
          All Pools ({pools.length})
        </button>
        <button
          onClick={() => setActiveTab('ACTIVE')}
          className={`pb-3 px-3 text-sm font-bold border-b-2 transition whitespace-nowrap ${
            activeTab === 'ACTIVE'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Live Marketplace ({activeCount})
        </button>
        <button
          onClick={() => setActiveTab('DRAFT')}
          className={`pb-3 px-3 text-sm font-bold border-b-2 transition whitespace-nowrap ${
            activeTab === 'DRAFT'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Drafts ({draftCount})
        </button>
        <button
          onClick={() => setActiveTab('CLOSED')}
          className={`pb-3 px-3 text-sm font-bold border-b-2 transition whitespace-nowrap ${
            activeTab === 'CLOSED'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Closed & Confirmed
        </button>
      </div>

      {/* Pools List */}
      {loading ? (
        <div className="min-h-[40vh] flex flex-col items-center justify-center p-8">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mb-3" />
          <p className="text-gray-500 text-sm">Loading your pools...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center max-w-lg mx-auto">
          <AlertCircle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-rose-900">{error}</p>
          <button
            onClick={fetchSupplierPools}
            className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-lg transition"
          >
            Retry
          </button>
        </div>
      ) : filteredPools.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-2xl border border-gray-200/80 shadow-sm">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Layers className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-gray-900">No pools found</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mt-1 mb-6">
            {activeTab === 'ALL'
              ? 'You have not created any collective pools yet. Select one of your active listings to start aggregating buyer orders.'
              : `No pools found in the ${activeTab.toLowerCase()} status.`}
          </p>
          <Link
            to="/supplier/pools/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm transition"
          >
            <PlusCircle className="w-4 h-4" />
            Create First Pool
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPools.map((pool) => {
            const fillPct = Math.min(100, Math.max(0, parseFloat(pool.fill_percentage || 0)));
            const isDraft = pool.status === 'DRAFT';
            const isActive = pool.status === 'ACTIVE';

            return (
              <div
                key={pool.id}
                className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 sm:p-6 hover:border-emerald-300 transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold bg-gray-100 px-2.5 py-1 rounded-md text-gray-800">
                      {pool.pool_code}
                    </span>
                    <span className="text-xs text-gray-400">•</span>
                    <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                      {pool.category || 'Commodity'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {getStatusBadge(pool.status)}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 py-4 items-center">
                  {/* Column 1: Commodity Title & Specs */}
                  <div className="md:col-span-2">
                    <h3 className="text-base font-extrabold text-gray-900">
                      {pool.product_title || 'Commodity Pool'}
                    </h3>

                    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-600">
                      <span>
                        Target: <strong className="text-gray-900">{pool.target_qty} {pool.pool_unit}s</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Supplier MOQ: <strong className="text-gray-900">{pool.supplier_min_qty} {pool.pool_unit}s</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Buyer Min: <strong className="text-gray-900">{pool.buyer_min_qty} {pool.pool_unit}s</strong>
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-3">
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="text-gray-500">Collective Demand</span>
                        <span className="font-bold text-gray-800">{fillPct.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden border border-gray-200">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${fillPct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Column 2: Current Stats */}
                  <div className="text-left md:text-center">
                    <span className="text-xs text-gray-500 block uppercase font-semibold">Committed Volume</span>
                    <span className="text-xl font-black text-gray-900 mt-0.5 block">
                      {pool.current_qty || 0} {pool.pool_unit}s
                    </span>
                    <span className="text-xs text-gray-500 block mt-0.5">
                      {pool.reservation_count || 0} Buyer Reservations
                    </span>
                  </div>

                  {/* Column 3: Current Unit Price */}
                  <div className="text-left md:text-right">
                    <span className="text-xs text-gray-500 block uppercase font-semibold">Current Price</span>
                    <div className="flex items-baseline md:justify-end gap-1 mt-0.5">
                      <span className="text-xs font-bold text-gray-500">PKR</span>
                      <span className="text-xl font-black text-gray-900">
                        {Number(pool.current_price_per_unit).toLocaleString()}
                      </span>
                      <span className="text-xs text-gray-500">/ {pool.pool_unit}</span>
                    </div>
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="pt-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="text-gray-500">
                    Lead time: <strong>{pool.fulfilment_lead_time_days || 2} days</strong> • Doorstep delivery in Lahore
                  </div>

                  <div className="flex items-center gap-2">
                    {/* If Draft: Show Publish Button */}
                    {isDraft && (
                      <button
                        type="button"
                        onClick={() => handlePublish(pool.id)}
                        disabled={publishingId === pool.id}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition"
                      >
                        {publishingId === pool.id ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Publishing...
                          </>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            Publish to Marketplace
                          </>
                        )}
                      </button>
                    )}

                    {/* View Demand Summary */}
                    {isActive && (
                      <button
                        type="button"
                        onClick={() => handleOpenSummary(pool.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 font-bold rounded-xl transition"
                      >
                        <Users className="w-3.5 h-3.5 text-teal-700" />
                        Demand Summary
                      </button>
                    )}

                    {/* Public Pool Link */}
                    {isActive && (
                      <Link
                        to={`/pools/${pool.id}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-gray-600 hover:text-emerald-700 hover:bg-gray-100 border border-gray-200 font-semibold rounded-xl transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View Live
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Supplier Pool Summary Modal */}
      <SupplierPoolSummaryModal
        poolId={selectedPoolId}
        isOpen={summaryModalOpen}
        onClose={() => {
          setSummaryModalOpen(false);
          setSelectedPoolId(null);
        }}
      />
    </div>
  );
};

export default SupplierDashboardPage;
