'use client';

import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import { format, subDays, subMonths } from 'date-fns';
import Link from 'next/link';

interface DailyStats {
  date: string;
  unique_users: number;
  total_events: number;
}

interface EventBreakdown {
  event_name: string;
  count: number;
}

interface SessionFunnel {
  state: string;
  count: number;
}

interface FeatureAdoption {
  feature: string;
  users: number;
  events: number;
  adoption_rate: number;
}

interface PlatformData {
  platform: string;
  count: number;
}

interface ResponseTypeData {
  type: string;
  count: number;
}

interface StoreHealth {
  name: string;
  products: number;
  promos: number;
}

// Darker, muted color palette
const COLORS = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777', '#0891B2', '#16A34A', '#EA580C', '#0D9488'];

const EVENT_TO_FEATURE: Record<string, string> = {
  'browse_page_viewed': 'Browse',
  'browse_lazy_load': 'Browse',
  'chat_page_viewed': 'Chat',
  'message_sent': 'Chat',
  'basket_viewed': 'Basket',
  'basket_results_displayed': 'Basket',
  'shopping_list_viewed': 'Shopping List',
  'item_added': 'Shopping List',
  'product_added_to_list': 'Shopping List',
  'multiple_products_added': 'Shopping List',
  'settings_page_viewed': 'Settings',
  'language_selected': 'Settings',
  'onboarding_started': 'Onboarding',
  'onboarding_completed': 'Onboarding',
  'comparison_started': 'Comparison',
  'product_swapped': 'Comparison',
  'quick_action_tapped': 'Quick Actions',
  'demo_list_selected': 'Demo',
  'app_launch': 'App Launch',
  'splash_load_completed': 'App Launch',
};

export default function Dashboard() {
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [eventBreakdown, setEventBreakdown] = useState<EventBreakdown[]>([]);
  const [sessionFunnel, setSessionFunnel] = useState<SessionFunnel[]>([]);
  const [featureAdoption, setFeatureAdoption] = useState<FeatureAdoption[]>([]);
  const [platformData, setPlatformData] = useState<PlatformData[]>([]);
  const [responseTypes, setResponseTypes] = useState<ResponseTypeData[]>([]);
  const [storeHealth, setStoreHealth] = useState<StoreHealth[]>([]);
  const [onboardingRate, setOnboardingRate] = useState(0);
  const [todayStats, setTodayStats] = useState({ users: 0, events: 0, sessions: 0, messages: 0 });
  const [totalUsers, setTotalUsers] = useState(0);
  const [newUsers, setNewUsers] = useState(0);
  const [avgProcessingMs, setAvgProcessingMs] = useState(0);
  const [totalSavings, setTotalSavings] = useState(0);
  const [basketsGenerated, setBasketsGenerated] = useState(0);
  const [listStats, setListStats] = useState<{action: string; count: number; users: number}[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d' | '3m' | '6m' | '9m' | '1y'>('30d');

  const getDateFilter = (range: typeof timeRange) => {
    switch (range) {
      case '24h': return subDays(new Date(), 1).toISOString();
      case '7d': return subDays(new Date(), 7).toISOString();
      case '30d': return subDays(new Date(), 30).toISOString();
      case '3m': return subMonths(new Date(), 3).toISOString();
      case '6m': return subMonths(new Date(), 6).toISOString();
      case '9m': return subMonths(new Date(), 9).toISOString();
      case '1y': return subMonths(new Date(), 12).toISOString();
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const dateFilter = getDateFilter(timeRange);
      const today = format(new Date(), 'yyyy-MM-dd');

      const { data: events, error: eventsError } = await supabase
        .from('analytics_events')
        .select('received_at, firebase_uid, event_name, platform, props')
        .gte('received_at', dateFilter)
        .order('received_at', { ascending: false });

      const { data: sessions, error: sessionsError } = await supabase
        .from('chat_sessions')
        .select('created_at, user_id, state')
        .gte('created_at', dateFilter);

      const { data: messages, error: messagesError } = await supabase
        .from('chat_messages')
        .select('created_at, role, response_type, processing_ms, scenario')
        .gte('created_at', dateFilter);

      // Fetch live store data instead of stale daily_observability snapshot
      const { data: stores } = await supabase
        .from('stores')
        .select('id, store_name')
        .eq('is_active', true);

      // Get live promotion counts per store
      const { data: promoCounts } = await supabase
        .from('promotions')
        .select('store_id')
        .eq('is_active', true);

      // Get live product counts per store
      const { data: productCounts } = await supabase
        .from('store_offerings')
        .select('store_id');

      // Get all users' first event dates to calculate new users
      const { data: allEvents } = await supabase
        .from('analytics_events')
        .select('firebase_uid, received_at')
        .order('received_at', { ascending: true });

      // Find first event date for each user
      const userFirstEvent = new Map<string, string>();
      allEvents?.forEach((e) => {
        if (!userFirstEvent.has(e.firebase_uid)) {
          userFirstEvent.set(e.firebase_uid, e.received_at);
        }
      });

      // Count users whose first event is within the selected time range
      const newUsersCount = Array.from(userFirstEvent.values()).filter(
        (firstEvent) => firstEvent >= dateFilter
      ).length;
      setNewUsers(newUsersCount);

      const allUsers = new Set(events?.map((e) => e.firebase_uid) || []);
      setTotalUsers(allUsers.size);

      const dailyMap = new Map<string, { users: Set<string>; events: number }>();
      events?.forEach((e) => {
        const date = e.received_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { users: new Set(), events: 0 });
        }
        const day = dailyMap.get(date)!;
        day.users.add(e.firebase_uid);
        day.events++;
      });

      const dailyStatsArray = Array.from(dailyMap.entries())
        .map(([date, data]) => ({
          date: format(new Date(date), 'MMM dd'),
          unique_users: data.users.size,
          total_events: data.events,
        }))
        .reverse()
        .slice(-14);

      setDailyStats(dailyStatsArray);

      const eventMap = new Map<string, number>();
      events?.forEach((e) => {
        eventMap.set(e.event_name, (eventMap.get(e.event_name) || 0) + 1);
      });

      const eventArray = Array.from(eventMap.entries())
        .map(([name, count]) => ({ event_name: name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      setEventBreakdown(eventArray);

      const stateMap = new Map<string, number>();
      sessions?.forEach((s) => {
        stateMap.set(s.state, (stateMap.get(s.state) || 0) + 1);
      });

      const funnelArray = Array.from(stateMap.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count);

      setSessionFunnel(funnelArray);

      const featureMap = new Map<string, { users: Set<string>; events: number }>();
      events?.forEach((e) => {
        const feature = EVENT_TO_FEATURE[e.event_name] || 'Other';
        if (!featureMap.has(feature)) {
          featureMap.set(feature, { users: new Set(), events: 0 });
        }
        const f = featureMap.get(feature)!;
        f.users.add(e.firebase_uid);
        f.events++;
      });

      const featureArray = Array.from(featureMap.entries())
        .map(([feature, data]) => ({
          feature,
          users: data.users.size,
          events: data.events,
          adoption_rate: Math.round((data.users.size / allUsers.size) * 100),
        }))
        .sort((a, b) => b.users - a.users);

      setFeatureAdoption(featureArray);

      const platformMap = new Map<string, number>();
      events?.forEach((e) => {
        const p = e.platform || 'unknown';
        platformMap.set(p, (platformMap.get(p) || 0) + 1);
      });
      setPlatformData(
        Array.from(platformMap.entries())
          .map(([platform, count]) => ({ platform, count }))
          .sort((a, b) => b.count - a.count)
      );

      const responseMap = new Map<string, number>();
      messages?.filter(m => m.role === 'assistant' && m.response_type).forEach((m) => {
        responseMap.set(m.response_type, (responseMap.get(m.response_type) || 0) + 1);
      });
      setResponseTypes(
        Array.from(responseMap.entries())
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count)
      );

      const processingTimes = messages?.filter(m => m.processing_ms).map(m => m.processing_ms) || [];
      if (processingTimes.length > 0) {
        setAvgProcessingMs(Math.round(processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length));
      }

      let savings = 0;
      let baskets = 0;
      events?.forEach((e) => {
        if (e.props?.savings_cents) {
          savings += e.props.savings_cents;
        }
        if (e.event_name === 'basket_results_displayed') {
          baskets++;
        }
      });
      setTotalSavings(savings);
      setBasketsGenerated(baskets);

      // Calculate list activity stats
      const listActions = [
        { key: 'shopping_list_viewed', label: 'Lists Viewed' },
        { key: 'product_added_to_list', label: 'Products Added' },
        { key: 'multiple_products_added', label: 'Bulk Adds' },
        { key: 'shopping_list_saved', label: 'Lists Saved' },
        { key: 'item_added', label: 'Items Added' },
      ];
      const listStatsData = listActions.map(action => {
        const actionEvents = events?.filter(e => e.event_name === action.key) || [];
        const uniqueUsers = new Set(actionEvents.map(e => e.firebase_uid));
        return {
          action: action.label,
          count: actionEvents.length,
          users: uniqueUsers.size,
        };
      }).filter(s => s.count > 0);
      setListStats(listStatsData);

      // Calculate live store health from promotions and offerings data
      if (stores && promoCounts && productCounts) {
        const promoMap = new Map<number, number>();
        promoCounts.forEach((p) => {
          promoMap.set(p.store_id, (promoMap.get(p.store_id) || 0) + 1);
        });

        const productMap = new Map<number, number>();
        productCounts.forEach((p) => {
          productMap.set(p.store_id, (productMap.get(p.store_id) || 0) + 1);
        });

        const storeHealthData: StoreHealth[] = stores.map((s) => ({
          name: s.store_name,
          products: productMap.get(s.id) || 0,
          promos: promoMap.get(s.id) || 0,
        }));

        setStoreHealth(storeHealthData.sort((a, b) => b.products - a.products).slice(0, 10));
      }

      // Calculate onboarding rate by unique users, not event count
      const usersWhoStarted = new Set<string>();
      const usersWhoCompleted = new Set<string>();
      events?.forEach((e) => {
        if (e.event_name === 'onboarding_started') usersWhoStarted.add(e.firebase_uid);
        if (e.event_name === 'onboarding_completed') usersWhoCompleted.add(e.firebase_uid);
      });
      setOnboardingRate(usersWhoStarted.size > 0 ? Math.round((usersWhoCompleted.size / usersWhoStarted.size) * 100) : 0);

      const todayEvents = events?.filter((e) => e.received_at.startsWith(today)) || [];
      const todayUsers = new Set(todayEvents.map((e) => e.firebase_uid));
      const todaySessions = sessions?.filter((s) => s.created_at.startsWith(today)) || [];
      const todayMessages = messages?.filter((m) => m.created_at.startsWith(today)) || [];

      setTodayStats({
        users: todayUsers.size,
        events: todayEvents.length,
        sessions: todaySessions.length,
        messages: todayMessages.length,
      });

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [timeRange]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center">
        <div className="text-gray-500 text-lg font-medium">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-gray-900">
      {/* Navigation */}
      <nav className="bg-white/80 backdrop-blur-xl border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-3 sm:py-4 flex items-center justify-between">
          <h1 className="text-lg sm:text-xl font-semibold">Spaartje</h1>
          <div className="flex items-center gap-3 sm:gap-6">
            <Link href="/" className="text-xs sm:text-sm font-medium text-blue-700">Overview</Link>
            <Link href="/users" className="text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-900 transition">Users</Link>
            <Link href="/onboarding" className="text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-900 transition">Onboarding</Link>
            <span className="text-[10px] sm:text-xs text-gray-400 hidden sm:inline">
              {lastUpdated ? format(lastUpdated, 'HH:mm') : '-'}
            </span>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-4 sm:py-8">
        {/* Time Range Selector */}
        <div className="flex flex-wrap items-center gap-2 mb-4 sm:mb-6">
          <span className="text-sm text-gray-500 font-medium">Time Range:</span>
          <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg">
            {[
              { value: '24h', label: '24h' },
              { value: '7d', label: '7d' },
              { value: '30d', label: '30d' },
              { value: '3m', label: '3m' },
              { value: '6m', label: '6m' },
              { value: '9m', label: '9m' },
              { value: '1y', label: '1y' },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeRange(option.value as typeof timeRange)}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md transition ${
                  timeRange === option.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {loading && <span className="text-xs text-gray-400 ml-2">Loading...</span>}
        </div>

        {/* Stats Row 1 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-2 sm:mb-4">
          <StatCard label="Today's Users" value={todayStats.users} color="text-blue-700" />
          <StatCard label="Today's Events" value={todayStats.events} color="text-emerald-700" />
          <StatCard label="New Users" value={newUsers} color="text-violet-700" />
          <StatCard label="Onboarding" value={`${onboardingRate}%`} color="text-amber-700" />
        </div>

        {/* Stats Row 2 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-8">
          <StatCard label="Avg Response" value={`${avgProcessingMs}ms`} color="text-cyan-700" />
          <StatCard label="Baskets" value={basketsGenerated} color="text-pink-700" />
          <StatCard label="Savings" value={`€${(totalSavings / 100).toFixed(0)}`} color="text-teal-700" />
          <StatCard label="Messages" value={todayStats.messages} color="text-orange-700" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6">
          <Card title="Daily Active Users">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyStats} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="date" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <YAxis stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} tickFormatter={(v) => v.toLocaleString()} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} formatter={(value) => [Number(value).toLocaleString(), 'Users']} />
                  <Area type="monotone" dataKey="unique_users" stroke="#2563EB" fill="#2563EB" fillOpacity={0.15} strokeWidth={2} name="Users" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Daily Events">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyStats} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="date" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <YAxis stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} tickFormatter={(v) => v.toLocaleString()} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} formatter={(value) => [Number(value).toLocaleString(), 'Events']} />
                  <Area type="monotone" dataKey="total_events" stroke="#059669" fill="#059669" fillOpacity={0.15} strokeWidth={2} name="Events" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Platform">
            <div className="h-48 sm:h-64 flex items-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={platformData}
                    dataKey="count"
                    nameKey="platform"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#6B7280', strokeWidth: 1 }}
                    fontSize={12}
                    fontWeight={600}
                  >
                    {platformData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} formatter={(value) => [Number(value).toLocaleString(), 'Events']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Chat Response Types">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={responseTypes} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis type="number" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <YAxis dataKey="type" type="category" stroke="#374151" fontSize={11} fontWeight={500} width={100} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} formatter={(value) => [Number(value).toLocaleString(), 'Count']} />
                  <Bar dataKey="count" fill="#D97706" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Feature Adoption">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={featureAdoption} margin={{ top: 5, right: 5, bottom: 50, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="feature" stroke="#374151" fontSize={10} fontWeight={500} angle={-35} textAnchor="end" height={50} interval={0} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <YAxis stroke="#374151" fontSize={11} fontWeight={500} domain={[0, 100]} unit="%" tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} formatter={(value) => [`${value}%`, 'Adoption Rate']} />
                  <Bar dataKey="adoption_rate" radius={[6, 6, 0, 0]}>
                    {featureAdoption.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Top Events">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={eventBreakdown} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis type="number" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <YAxis dataKey="event_name" type="category" stroke="#374151" fontSize={10} fontWeight={500} width={110} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} tickFormatter={(v) => v.replace(/_/g, ' ').slice(0, 16)} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} formatter={(value) => [Number(value).toLocaleString(), 'Events']} />
                  <Bar dataKey="count" fill="#7C3AED" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Store Coverage (Products)">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={storeHealth} margin={{ top: 5, right: 5, bottom: 50, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="name" stroke="#374151" fontSize={10} fontWeight={500} angle={-35} textAnchor="end" height={50} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <YAxis stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} formatter={(value) => [Number(value).toLocaleString(), 'Products']} />
                  <Bar dataKey="products" fill="#2563EB" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Chat Sessions">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sessionFunnel} dataKey="count" nameKey="state" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`} labelLine={{ stroke: '#6B7280', strokeWidth: 1 }} fontSize={12} fontWeight={600}>
                    {sessionFunnel.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} formatter={(value) => [Number(value).toLocaleString(), 'Sessions']} />
                  <Legend wrapperStyle={{ fontSize: 12, fontWeight: 500 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Tables */}
        <div className="mt-3 sm:mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6">
          <Card title="Feature Details">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left py-3 font-medium">Feature</th>
                    <th className="text-right py-3 font-medium">Users</th>
                    <th className="text-right py-3 font-medium">Events</th>
                    <th className="text-right py-3 font-medium">Adoption</th>
                  </tr>
                </thead>
                <tbody>
                  {featureAdoption.map((f, i) => {
                    const slug = f.feature.toLowerCase().replace(/ /g, '-');
                    return (
                      <tr key={f.feature} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href = `/feature/${slug}`}>
                        <td className="py-3 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="text-blue-700 hover:underline">{f.feature}</span>
                        </td>
                        <td className="text-right py-3 text-gray-600">{f.users}</td>
                        <td className="text-right py-3 text-gray-600">{f.events.toLocaleString()}</td>
                        <td className="text-right py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: COLORS[i % COLORS.length] + '20', color: COLORS[i % COLORS.length] }}>
                            {f.adoption_rate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Store Promotions">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left py-3 font-medium">Store</th>
                    <th className="text-right py-3 font-medium">Products</th>
                    <th className="text-right py-3 font-medium">Promos</th>
                  </tr>
                </thead>
                <tbody>
                  {storeHealth.map((s, i) => (
                    <tr key={s.name} className="border-b border-gray-100">
                      <td className="py-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        {s.name}
                      </td>
                      <td className="text-right py-3 text-gray-600">{s.products.toLocaleString()}</td>
                      <td className="text-right py-3 text-emerald-700 font-medium">{s.promos.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="List Activity">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left py-3 font-medium">Action</th>
                    <th className="text-right py-3 font-medium">Count</th>
                    <th className="text-right py-3 font-medium">Users</th>
                  </tr>
                </thead>
                <tbody>
                  {listStats.length > 0 ? listStats.map((s, i) => (
                    <tr key={s.action} className="border-b border-gray-100">
                      <td className="py-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[(i + 5) % COLORS.length] }} />
                        {s.action}
                      </td>
                      <td className="text-right py-3 text-gray-600">{s.count.toLocaleString()}</td>
                      <td className="text-right py-3 text-blue-700 font-medium">{s.users}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-gray-400">No list activity yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-5 shadow-sm">
      <p className="text-gray-600 text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1">{label}</p>
      <p className={`text-xl sm:text-2xl md:text-3xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-sm">
      <h2 className="text-base sm:text-lg font-semibold mb-2 sm:mb-4 text-gray-900">{title}</h2>
      {children}
    </div>
  );
}
