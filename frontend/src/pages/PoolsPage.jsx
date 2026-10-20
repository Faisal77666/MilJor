import React, { useState, useEffect } from 'react';
import { poolsApi } from '../api/pools';
import { PoolCard } from '../components/PoolCard';
import { Search, Filter, RefreshCw, AlertCircle, Sparkles, TrendingDown, ShieldCheck, Truck } from 'lucide-react';

const CATEGORIES = [
  'All Commodities',
  'Rice & Grains',
  'Edible Oils & Ghee',
  'Pulses & Lentils',
  'Sugar & Sweeteners',
  'Flour & Atta',
];

export const PoolsPage = () => {
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('All Commodities');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchPools = async () => {
    setLoading(true);
    setError(null);
    try {
      const categoryParam = selectedCategory === 'All Commodities' ? undefined : selectedCategory;
      const res = await poolsApi.getActivePools({ category: categoryParam });
      if (res.success && res.data?.pools) {
        setPools(res.data.pools);
      } else {
        setPools([]);
      }
    } catch (err) {
      console.warn('Could not fetch active pools:', err.message);
      setError(err.response?.data?.error?.message || 'Unable to connect to MilJor backend service.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPools();
  }, [selectedCategory]);

  const filteredPools = pools.filter((p) => {
    const titleMatch = (p.product_name || p.title || '').toLowerCase().includes(searchQuery.toLowerCase());
    const varietyMatch = (p.variety || '').toLowerCase().includes(searchQuery.toLowerCase());
    return titleMatch || varietyMatch;
  });

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Hero Section */}
      <section className="bg-gradient-to-b from-emerald-900 via-emerald-800 to-teal-900 text-white py-14 px-4 sm:px-6 lg:px-8 shadow-inner">
        <div className="max-w-7xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-700/60 text-emerald-200 border border-emerald-500/30 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            Lahore's Collective Wholesale Food Market
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight max-w-3xl leading-tight">
            Pool Demand with Lahore Food Businesses for Factory-Direct Prices.
          </h1>

          <p className="mt-4 text-emerald-100 max-w-2xl text-base sm:text-lg leading-relaxed">
            Restaurants, caterers, and canteens unite their orders to unlock bulk tier discounts on high-turnover commodities directly from verified millers and suppliers.
          </p>

          {/* Value Pillars */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 max-w-3xl">
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm p-3 rounded-xl border border-white/10">
              <TrendingDown className="w-5 h-5 text-amber-300 flex-shrink-0" />
              <span className="text-xs sm:text-sm font-medium">10%–25% Lower Than Akbari Mandi</span>
            </div>
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm p-3 rounded-xl border border-white/10">
              <ShieldCheck className="w-5 h-5 text-emerald-300 flex-shrink-0" />
              <span className="text-xs sm:text-sm font-medium">100% Lab-Verified Quality Grades</span>
            </div>
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm p-3 rounded-xl border border-white/10">
              <Truck className="w-5 h-5 text-teal-300 flex-shrink-0" />
              <span className="text-xs sm:text-sm font-medium">Scheduled Direct Kitchen Delivery</span>
            </div>
          </div>
        </div>
      </section>

      {/* Filter and Content Controls */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-6">
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200/80 flex flex-col md:flex-row gap-4 justify-between items-center">
          {/* Search Bar */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search Basmati, Palm Oil, Daal..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
            />
          </div>

          {/* Category Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 scrollbar-none">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl whitespace-nowrap transition ${
                  selectedCategory === cat
                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchPools}
            disabled={loading}
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:text-emerald-700 hover:bg-gray-50 rounded-xl border border-gray-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Pools Grid Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="bg-white rounded-2xl p-5 border border-gray-200/80 animate-pulse space-y-4"
              >
                <div className="flex justify-between">
                  <div className="h-5 w-24 bg-gray-200 rounded-full" />
                  <div className="h-4 w-16 bg-gray-200 rounded-full" />
                </div>
                <div className="h-6 w-3/4 bg-gray-200 rounded" />
                <div className="h-4 w-1/2 bg-gray-200 rounded" />
                <div className="h-16 w-full bg-gray-100 rounded-xl" />
                <div className="h-12 w-full bg-gray-200 rounded-xl" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center max-w-xl mx-auto my-12">
            <AlertCircle className="w-10 h-10 text-amber-600 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-gray-900">Backend Connection Notice</h3>
            <p className="text-sm text-gray-600 mt-2">{error}</p>
            <p className="text-xs text-gray-500 mt-3">
              Ensure the backend is running via <code>npm run dev:backend</code> on port 5000.
            </p>
            <button
              onClick={fetchPools}
              className="mt-5 px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-sm transition"
            >
              Retry Connection
            </button>
          </div>
        ) : filteredPools.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPools.map((pool) => (
              <PoolCard key={pool.id} pool={pool} />
            ))}
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center max-w-xl mx-auto my-12">
            <Filter className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-gray-900">No Active Pools Matching Filters</h3>
            <p className="text-sm text-gray-600 mt-2">
              No published active pools found for "{selectedCategory}". Check back as verified suppliers publish new collective lots regularly.
            </p>
            <button
              onClick={() => {
                setSelectedCategory('All Commodities');
                setSearchQuery('');
              }}
              className="mt-4 px-4 py-2 text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition"
            >
              Reset Filters
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default PoolsPage;

