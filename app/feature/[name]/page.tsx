'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { format, subDays, subMonths } from 'date-fns';
import Link from 'next/link';

const COLORS = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777', '#0891B2', '#16A34A', '#EA580C', '#0D9488'];

const FEATURE_EVENTS: Record<string, { events: string[]; label: string; description: string }> = {
  'browse': {
    events: ['browse_page_viewed', 'browse_lazy_load', 'browse_product_viewed', 'browse_product_added'],
    label: 'Browse',
    description: 'Product browsing and discovery',
  },
  'chat': {
    events: ['chat_page_viewed', 'message_sent', 'chat_cleared'],
    label: 'Chat',
    description: 'AI chat assistant interactions',
  },
  'basket': {
    events: ['basket_viewed', 'basket_results_displayed'],
    label: 'Basket',
    description: 'Shopping basket comparisons',
  },
  'shopping-list': {
    events: ['shopping_list_viewed', 'item_added', 'product_added_to_list', 'multiple_products_added', 'shopping_list_saved', 'item_quantity_changed'],
    label: 'Shopping List',
    description: 'List management and items',
  },
  'settings': {
    events: ['settings_page_viewed', 'language_selected', 'personalization_page_viewed'],
    label: 'Settings',
    description: 'App settings and preferences',
  },
  'onboarding': {
    events: ['onboarding_started', 'onboarding_completed', 'onboarding_list_input_viewed', 'onboarding_processing_viewed'],
    label: 'Onboarding',
    description: 'New user onboarding flow',
  },
  'comparison': {
    events: ['comparison_started', 'comparison_results_viewed', 'product_swapped'],
    label: 'Comparison',
    description: 'Price comparison features',
  },
  'quick-actions': {
    events: ['quick_action_tapped'],
    label: 'Quick Actions',
    description: 'Quick action shortcuts',
  },
  'demo': {
    events: ['demo_list_selected'],
    label: 'Demo',
    description: 'Demo list usage',
  },
  'app-launch': {
    events: ['app_launch', 'splash_load_completed'],
    label: 'App Launch',
    description: 'App startup and splash screen',
  },
  'auth': {
    events: ['auth_signin_started', 'auth_signin_success', 'auth_signin_failed', 'auth_signup_started', 'auth_signup_success', 'auth_signup_failed'],
    label: 'Authentication',
    description: 'Sign in and sign up flows',
  },
  'savings': {
    events: ['savings_page_viewed', 'savings_store_filtered'],
    label: 'Savings',
    description: 'Savings tracking features',
  },
  'other': {
    events: ['receipt_scan_started'],
    label: 'Other',
    description: 'Miscellaneous events',
  },
};

interface DailyData {
  date: string;
  events: number;
  users: number;
}

interface EventData {
  name: string;
  count: number;
  users: number;
}

interface UserData {
  user: string;
  events: number;
  lastSeen: string;
}

export default function FeaturePage() {
  const params = useParams();
  const featureName = params.name as string;
  const feature = FEATURE_EVENTS[featureName];

  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [eventBreakdown, setEventBreakdown] = useState<EventData[]>([]);
  const [topUsers, setTopUsers] = useState<UserData[]>([]);
  const [stats, setStats] = useState({ totalEvents: 0, uniqueUsers: 0, avgPerUser: 0, todayEvents: 0 });
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (!feature) return;

    const fetchData = async () => {
      setLoading(true);
      const dateFilter = getDateFilter(timeRange);
      const today = format(new Date(), 'yyyy-MM-dd');

      const { data: events } = await supabase
        .from('analytics_events')
        .select('received_at, firebase_uid, event_name')
        .in('event_name', feature.events)
        .gte('received_at', dateFilter)
        .order('received_at', { ascending: true });

      if (!events) {
        setLoading(false);
        return;
      }

      // Daily breakdown
      const dailyMap = new Map<string, { events: number; users: Set<string> }>();
      events.forEach(e => {
        const date = e.received_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { events: 0, users: new Set() });
        }
        const day = dailyMap.get(date)!;
        day.events++;
        day.users.add(e.firebase_uid);
      });

      const daily = Array.from(dailyMap.entries())
        .map(([date, data]) => ({
          date: format(new Date(date), 'MMM dd'),
          events: data.events,
          users: data.users.size,
        }))
        .slice(-14);
      setDailyData(daily);

      // Event breakdown
      const eventMap = new Map<string, { count: number; users: Set<string> }>();
      events.forEach(e => {
        if (!eventMap.has(e.event_name)) {
          eventMap.set(e.event_name, { count: 0, users: new Set() });
        }
        const ev = eventMap.get(e.event_name)!;
        ev.count++;
        ev.users.add(e.firebase_uid);
      });

      const breakdown = Array.from(eventMap.entries())
        .map(([name, data]) => ({
          name: name.replace(/_/g, ' '),
          count: data.count,
          users: data.users.size,
        }))
        .sort((a, b) => b.count - a.count);
      setEventBreakdown(breakdown);

      // Top users
      const userMap = new Map<string, { events: number; lastSeen: string }>();
      events.forEach(e => {
        if (!userMap.has(e.firebase_uid)) {
          userMap.set(e.firebase_uid, { events: 0, lastSeen: e.received_at });
        }
        const user = userMap.get(e.firebase_uid)!;
        user.events++;
        if (e.received_at > user.lastSeen) {
          user.lastSeen = e.received_at;
        }
      });

      const users = Array.from(userMap.entries())
        .map(([user, data]) => ({
          user: user.slice(0, 8) + '...',
          events: data.events,
          lastSeen: format(new Date(data.lastSeen), 'MMM dd HH:mm'),
        }))
        .sort((a, b) => b.events - a.events)
        .slice(0, 10);
      setTopUsers(users);

      // Stats
      const uniqueUsers = new Set(events.map(e => e.firebase_uid)).size;
      const todayEvents = events.filter(e => e.received_at.startsWith(today)).length;
      setStats({
        totalEvents: events.length,
        uniqueUsers,
        avgPerUser: uniqueUsers > 0 ? Math.round(events.length / uniqueUsers) : 0,
        todayEvents,
      });

      setLoading(false);
    };

    fetchData();
  }, [feature, timeRange]);

  if (!feature) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Feature not found</h1>
          <Link href="/" className="text-blue-700 hover:underline">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

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
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-500 hover:text-gray-900">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-lg sm:text-xl font-semibold">{feature.label}</h1>
          </div>
          <span className="text-xs sm:text-sm text-gray-500">{feature.description}</span>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-4 sm:py-8">
        {/* Time Range Selector */}
        <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg mb-6 w-fit">
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
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition ${
                timeRange === option.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-8">
          <StatCard label="Total Events" value={stats.totalEvents.toLocaleString()} color="text-blue-700" />
          <StatCard label="Unique Users" value={stats.uniqueUsers} color="text-emerald-700" />
          <StatCard label="Avg per User" value={stats.avgPerUser} color="text-violet-700" />
          <StatCard label="Today" value={stats.todayEvents} color="text-amber-700" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6 mb-4 sm:mb-6">
          <Card title="Daily Activity">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="date" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <YAxis stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} />
                  <Area type="monotone" dataKey="events" stroke="#2563EB" fill="#2563EB" fillOpacity={0.15} strokeWidth={2} name="Events" />
                  <Area type="monotone" dataKey="users" stroke="#059669" fill="#059669" fillOpacity={0.15} strokeWidth={2} name="Users" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Event Breakdown">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={eventBreakdown} margin={{ top: 5, right: 5, bottom: 50, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="name" stroke="#374151" fontSize={9} fontWeight={500} angle={-35} textAnchor="end" height={50} interval={0} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <YAxis stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {eventBreakdown.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6">
          <Card title="Event Details">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left py-3 font-medium">Event</th>
                    <th className="text-right py-3 font-medium">Count</th>
                    <th className="text-right py-3 font-medium">Users</th>
                  </tr>
                </thead>
                <tbody>
                  {eventBreakdown.map((e, i) => (
                    <tr key={e.name} className="border-b border-gray-100">
                      <td className="py-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="capitalize">{e.name}</span>
                      </td>
                      <td className="text-right py-3 text-gray-600">{e.count.toLocaleString()}</td>
                      <td className="text-right py-3 text-blue-700 font-medium">{e.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Top Users">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left py-3 font-medium">User ID</th>
                    <th className="text-right py-3 font-medium">Events</th>
                    <th className="text-right py-3 font-medium">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {topUsers.map((u, i) => (
                    <tr key={u.user} className="border-b border-gray-100">
                      <td className="py-3 font-mono text-xs text-gray-600">{u.user}</td>
                      <td className="text-right py-3 text-emerald-700 font-medium">{u.events}</td>
                      <td className="text-right py-3 text-gray-500 text-xs">{u.lastSeen}</td>
                    </tr>
                  ))}
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
