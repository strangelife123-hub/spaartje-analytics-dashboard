'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { format, subDays, subMonths, startOfWeek, differenceInDays } from 'date-fns';
import Link from 'next/link';

const COLORS = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777', '#0891B2', '#16A34A'];

interface DailyUsers {
  date: string;
  dau: number;
  events: number;
}

interface WeeklyUsers {
  week: string;
  wau: number;
  baskets: number;
  basketsPerUser: number;
}

interface RetentionData {
  cohort: string;
  users: number;
  w1: number;
  w2: number;
  w4: number;
}

interface UserSegment {
  segment: string;
  users: number;
  avgEvents: number;
  avgSavings: number;
}

export default function UsersPage() {
  const [dailyUsers, setDailyUsers] = useState<DailyUsers[]>([]);
  const [weeklyUsers, setWeeklyUsers] = useState<WeeklyUsers[]>([]);
  const [retentionData, setRetentionData] = useState<RetentionData[]>([]);
  const [userSegments, setUserSegments] = useState<UserSegment[]>([]);
  const [latencyData, setLatencyData] = useState<{type: string; count: number; avg: number; p50: number; p95: number}[]>([]);
  const [latencyTimeRange, setLatencyTimeRange] = useState<'24h' | '7d' | '30d' | 'all'>('30d');
  const [latencyLoading, setLatencyLoading] = useState(false);
  const [stats, setStats] = useState({
    dau: 0,
    wau: 0,
    mau: 0,
    dauWauRatio: 0,
    avgBasketsPerUser: 0,
    avgSavingsPerBasket: 0,
    actionRate: 0,
    w1Retention: 0,
    avgProcessingMs: 0,
    basketSuccessRate: 0,
  });
  const [activationMetrics, setActivationMetrics] = useState({
    onboardingCompletionRate: 0,
    firstBasketRate: 0,
    ahaEventRate: 0,
  });
  const [acquisitionMetrics, setAcquisitionMetrics] = useState({
    trulyNewUsers: 0,
    returningDeviceUsers: 0,
    newUserConversionRate: 0, // % of new users who generate a basket
  });
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

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const dateFilter = getDateFilter(timeRange);
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();
      const today = format(new Date(), 'yyyy-MM-dd');

      // Fetch all events
      const { data: events } = await supabase
        .from('analytics_events')
        .select('received_at, firebase_uid, event_name, props')
        .gte('received_at', dateFilter)
        .order('received_at', { ascending: true });

      // Fetch chat messages for processing times
      const { data: messages } = await supabase
        .from('chat_messages')
        .select('processing_ms, response_type')
        .not('processing_ms', 'is', null)
        .not('response_type', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (!events) {
        setLoading(false);
        return;
      }

      // === DAU / WAU / MAU ===
      const todayUsers = new Set(events.filter(e => e.received_at.startsWith(today)).map(e => e.firebase_uid));
      const weekUsers = new Set(events.filter(e => e.received_at >= sevenDaysAgo).map(e => e.firebase_uid));
      const monthUsers = new Set(events.map(e => e.firebase_uid));

      const dau = todayUsers.size;
      const wau = weekUsers.size;
      const mau = monthUsers.size;
      const dauWauRatio = wau > 0 ? Math.round((dau / wau) * 100) : 0;

      // === Daily Users Chart ===
      const dailyMap = new Map<string, { users: Set<string>; events: number }>();
      events.forEach(e => {
        const date = e.received_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { users: new Set(), events: 0 });
        }
        const day = dailyMap.get(date)!;
        day.users.add(e.firebase_uid);
        day.events++;
      });

      const daily = Array.from(dailyMap.entries())
        .map(([date, data]) => ({
          date: format(new Date(date), 'MMM dd'),
          dau: data.users.size,
          events: data.events,
        }))
        .slice(-14);
      setDailyUsers(daily);

      // === Weekly Users Chart ===
      const weeklyMap = new Map<string, { users: Set<string>; baskets: number }>();
      events.forEach(e => {
        const weekStart = format(startOfWeek(new Date(e.received_at), { weekStartsOn: 1 }), 'MMM dd');
        if (!weeklyMap.has(weekStart)) {
          weeklyMap.set(weekStart, { users: new Set(), baskets: 0 });
        }
        const week = weeklyMap.get(weekStart)!;
        week.users.add(e.firebase_uid);
        if (e.event_name === 'basket_results_displayed') {
          week.baskets++;
        }
      });

      const weekly = Array.from(weeklyMap.entries())
        .map(([week, data]) => ({
          week,
          wau: data.users.size,
          baskets: data.baskets,
          basketsPerUser: data.users.size > 0 ? Math.round((data.baskets / data.users.size) * 10) / 10 : 0,
        }))
        .slice(-6);
      setWeeklyUsers(weekly);

      // === Baskets & Savings ===
      const basketEvents = events.filter(e => e.event_name === 'basket_results_displayed');
      const totalBaskets = basketEvents.length;
      const avgBasketsPerUser = mau > 0 ? Math.round((totalBaskets / mau) * 10) / 10 : 0;

      let totalSavings = 0;
      let basketsWithSavings = 0;
      basketEvents.forEach(e => {
        if (e.props?.savings_cents) {
          totalSavings += e.props.savings_cents;
          basketsWithSavings++;
        }
      });
      const avgSavingsPerBasket = basketsWithSavings > 0 ? Math.round(totalSavings / basketsWithSavings) : 0;

      // === Action Rate (swaps, store selections) ===
      const actionEvents = events.filter(e =>
        e.event_name === 'product_swapped' ||
        e.event_name === 'comparison_started' ||
        e.event_name === 'shopping_list_saved'
      );
      const basketsWithAction = new Set(actionEvents.map(e => e.firebase_uid)).size;
      const basketUsers = new Set(basketEvents.map(e => e.firebase_uid)).size;
      const actionRate = basketUsers > 0 ? Math.round((basketsWithAction / basketUsers) * 100) : 0;

      // === Retention (W1) ===
      // Users from 2 weeks ago who came back last week
      const twoWeeksAgo = subDays(new Date(), 14).toISOString();
      const oneWeekAgo = subDays(new Date(), 7).toISOString();

      const usersWeek1 = new Set(
        events.filter(e => e.received_at >= twoWeeksAgo && e.received_at < oneWeekAgo)
          .map(e => e.firebase_uid)
      );
      const usersWeek2 = new Set(
        events.filter(e => e.received_at >= oneWeekAgo)
          .map(e => e.firebase_uid)
      );
      const retained = [...usersWeek1].filter(u => usersWeek2.has(u)).length;
      const w1Retention = usersWeek1.size > 0 ? Math.round((retained / usersWeek1.size) * 100) : 0;

      // === Cohort Retention ===
      const cohorts: RetentionData[] = [];
      for (let weeksAgo = 4; weeksAgo >= 1; weeksAgo--) {
        const cohortStart = subDays(new Date(), weeksAgo * 7);
        const cohortEnd = subDays(new Date(), (weeksAgo - 1) * 7);

        const cohortUsers = new Set(
          events.filter(e => {
            const date = new Date(e.received_at);
            return date >= cohortStart && date < cohortEnd;
          }).map(e => e.firebase_uid)
        );

        if (cohortUsers.size === 0) continue;

        // Check retention for each subsequent week
        const checkRetention = (weeksLater: number) => {
          if (weeksAgo - weeksLater < 0) return 0;
          const checkStart = subDays(new Date(), (weeksAgo - weeksLater) * 7);
          const checkEnd = subDays(new Date(), Math.max(0, (weeksAgo - weeksLater - 1) * 7));

          const returnedUsers = events.filter(e => {
            const date = new Date(e.received_at);
            return date >= checkStart && date < checkEnd && cohortUsers.has(e.firebase_uid);
          });

          return new Set(returnedUsers.map(e => e.firebase_uid)).size;
        };

        cohorts.push({
          cohort: format(cohortStart, 'MMM dd'),
          users: cohortUsers.size,
          w1: cohortUsers.size > 0 ? Math.round((checkRetention(1) / cohortUsers.size) * 100) : 0,
          w2: cohortUsers.size > 0 ? Math.round((checkRetention(2) / cohortUsers.size) * 100) : 0,
          w4: cohortUsers.size > 0 ? Math.round((checkRetention(4) / cohortUsers.size) * 100) : 0,
        });
      }
      setRetentionData(cohorts);

      // === User Segments by Activity Level ===
      const userActivity = new Map<string, { events: number; savings: number }>();
      events.forEach(e => {
        if (!userActivity.has(e.firebase_uid)) {
          userActivity.set(e.firebase_uid, { events: 0, savings: 0 });
        }
        const user = userActivity.get(e.firebase_uid)!;
        user.events++;
        if (e.props?.savings_cents) {
          user.savings += e.props.savings_cents;
        }
      });

      const segments: UserSegment[] = [
        { segment: 'Power (50+ events)', users: 0, avgEvents: 0, avgSavings: 0 },
        { segment: 'Active (20-49)', users: 0, avgEvents: 0, avgSavings: 0 },
        { segment: 'Casual (5-19)', users: 0, avgEvents: 0, avgSavings: 0 },
        { segment: 'New (1-4)', users: 0, avgEvents: 0, avgSavings: 0 },
      ];

      userActivity.forEach((data) => {
        let segment: number;
        if (data.events >= 50) segment = 0;
        else if (data.events >= 20) segment = 1;
        else if (data.events >= 5) segment = 2;
        else segment = 3;

        segments[segment].users++;
        segments[segment].avgEvents += data.events;
        segments[segment].avgSavings += data.savings;
      });

      segments.forEach(s => {
        if (s.users > 0) {
          s.avgEvents = Math.round(s.avgEvents / s.users);
          s.avgSavings = Math.round(s.avgSavings / s.users);
        }
      });
      setUserSegments(segments);

      // === Activation Metrics ===
      const onboardingStarted = new Set(events.filter(e => e.event_name === 'onboarding_started').map(e => e.firebase_uid)).size;
      const onboardingCompleted = new Set(events.filter(e => e.event_name === 'onboarding_completed').map(e => e.firebase_uid)).size;
      const onboardingCompletionRate = onboardingStarted > 0 ? Math.round((onboardingCompleted / onboardingStarted) * 100) : 0;

      const firstBasketUsers = new Set(events.filter(e => e.event_name === 'basket_results_displayed').map(e => e.firebase_uid)).size;
      const firstBasketRate = mau > 0 ? Math.round((firstBasketUsers / mau) * 100) : 0;

      // "Aha" event: basket with >= €3 savings
      const ahaUsers = new Set(
        events.filter(e => e.event_name === 'basket_results_displayed' && e.props?.savings_cents >= 300)
          .map(e => e.firebase_uid)
      ).size;
      const ahaEventRate = firstBasketUsers > 0 ? Math.round((ahaUsers / firstBasketUsers) * 100) : 0;

      setActivationMetrics({
        onboardingCompletionRate,
        firstBasketRate,
        ahaEventRate,
      });

      // === Acquisition Metrics (True New vs Returning) ===
      const trulyNewUsers = new Set<string>();
      const returningDeviceUsers = new Set<string>();

      events.filter(e => e.event_name === 'auth_anonymous_selected').forEach(e => {
        if (e.props?.is_new_user === true) {
          trulyNewUsers.add(e.firebase_uid);
        } else if (e.props?.is_returning_device === true) {
          returningDeviceUsers.add(e.firebase_uid);
        }
      });

      // New user conversion: % of truly new users who generate a basket
      const newUsersWithBasket = events.filter(e =>
        e.event_name === 'basket_results_displayed' &&
        trulyNewUsers.has(e.firebase_uid)
      );
      const newUserConversionRate = trulyNewUsers.size > 0
        ? Math.round((new Set(newUsersWithBasket.map(e => e.firebase_uid)).size / trulyNewUsers.size) * 100)
        : 0;

      setAcquisitionMetrics({
        trulyNewUsers: trulyNewUsers.size,
        returningDeviceUsers: returningDeviceUsers.size,
        newUserConversionRate,
      });

      // === Performance ===
      const processingTimes = messages?.filter(m => m.processing_ms).map(m => m.processing_ms) || [];
      const avgProcessingMs = processingTimes.length > 0
        ? Math.round(processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length)
        : 0;

      // Basket success rate (baskets shown / baskets attempted)
      const basketAttempts = events.filter(e => e.event_name === 'comparison_started').length;
      const basketSuccesses = events.filter(e => e.event_name === 'basket_results_displayed').length;
      const basketSuccessRate = basketAttempts > 0 ? Math.round((basketSuccesses / basketAttempts) * 100) : 0;

      // === Latency per Response Type ===
      const latencyMap = new Map<string, number[]>();
      if (messages && messages.length > 0) {
        messages.forEach(m => {
          if (m.processing_ms && m.response_type) {
            if (!latencyMap.has(m.response_type)) {
              latencyMap.set(m.response_type, []);
            }
            latencyMap.get(m.response_type)!.push(m.processing_ms);
          }
        });
      }

      const latencies = Array.from(latencyMap.entries()).map(([type, times]) => {
        const sorted = [...times].sort((a, b) => a - b);
        const p50Index = Math.floor(sorted.length * 0.5);
        const p95Index = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
        return {
          type: type.replace(/_/g, ' '),
          count: times.length,
          avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
          p50: sorted[p50Index] || 0,
          p95: sorted[p95Index] || 0,
        };
      }).sort((a, b) => b.count - a.count);
      setLatencyData(latencies);

      setStats({
        dau,
        wau,
        mau,
        dauWauRatio,
        avgBasketsPerUser,
        avgSavingsPerBasket,
        actionRate,
        w1Retention,
        avgProcessingMs,
        basketSuccessRate,
      });

      setLastUpdated(new Date());
      setLoading(false);
    };

    fetchData();
  }, [timeRange]);

  // Fetch latency data when time range changes
  useEffect(() => {
    const fetchLatency = async () => {
      setLatencyLoading(true);

      let dateFilter: string | null = null;
      if (latencyTimeRange === '24h') {
        dateFilter = subDays(new Date(), 1).toISOString();
      } else if (latencyTimeRange === '7d') {
        dateFilter = subDays(new Date(), 7).toISOString();
      } else if (latencyTimeRange === '30d') {
        dateFilter = subDays(new Date(), 30).toISOString();
      }

      let query = supabase
        .from('chat_messages')
        .select('processing_ms, response_type')
        .not('processing_ms', 'is', null)
        .not('response_type', 'is', null);

      if (dateFilter) {
        query = query.gte('created_at', dateFilter);
      }

      const { data: messages } = await query.order('created_at', { ascending: false }).limit(1000);

      const latencyMap = new Map<string, number[]>();
      if (messages && messages.length > 0) {
        messages.forEach(m => {
          if (m.processing_ms && m.response_type) {
            if (!latencyMap.has(m.response_type)) {
              latencyMap.set(m.response_type, []);
            }
            latencyMap.get(m.response_type)!.push(m.processing_ms);
          }
        });
      }

      const latencies = Array.from(latencyMap.entries()).map(([type, times]) => {
        const sorted = [...times].sort((a, b) => a - b);
        const p50Index = Math.floor(sorted.length * 0.5);
        const p95Index = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
        return {
          type: type.replace(/_/g, ' '),
          count: times.length,
          avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
          p50: sorted[p50Index] || 0,
          p95: sorted[p95Index] || 0,
        };
      }).sort((a, b) => b.count - a.count);

      setLatencyData(latencies);
      setLatencyLoading(false);
    };

    fetchLatency();
  }, [latencyTimeRange]);

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
            <h1 className="text-lg sm:text-xl font-semibold">Users & PMF Metrics</h1>
          </div>
          <span className="text-[10px] sm:text-xs text-gray-400">
            Updated {lastUpdated ? format(lastUpdated, 'HH:mm') : '-'}
          </span>
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

        {/* North Star Metrics */}
        <h2 className="text-lg font-semibold mb-3 text-gray-700">North Star</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-6">
          <StatCard label="DAU" value={stats.dau} color="text-blue-700" />
          <StatCard label="WAU" value={stats.wau} color="text-emerald-700" />
          <StatCard label="MAU (30d)" value={stats.mau} color="text-violet-700" />
          <StatCard label="DAU/WAU" value={`${stats.dauWauRatio}%`} color="text-amber-700" subtitle="Stickiness" />
        </div>

        {/* Engagement Metrics */}
        <h2 className="text-lg font-semibold mb-3 text-gray-700">Engagement</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-6">
          <StatCard label="Baskets/User" value={stats.avgBasketsPerUser} color="text-blue-700" />
          <StatCard label="Avg Savings" value={`€${(stats.avgSavingsPerBasket / 100).toFixed(2)}`} color="text-emerald-700" subtitle="per basket" />
          <StatCard label="Action Rate" value={`${stats.actionRate}%`} color="text-violet-700" subtitle="swaps/saves" />
          <StatCard label="W1 Retention" value={`${stats.w1Retention}%`} color="text-amber-700" />
        </div>

        {/* Activation Metrics */}
        <h2 className="text-lg font-semibold mb-3 text-gray-700">Activation</h2>
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
          <StatCard label="Onboarding" value={`${activationMetrics.onboardingCompletionRate}%`} color="text-blue-700" subtitle="completion" />
          <StatCard label="First Basket" value={`${activationMetrics.firstBasketRate}%`} color="text-emerald-700" subtitle="of users" />
          <StatCard label="Aha! (€3+)" value={`${activationMetrics.ahaEventRate}%`} color="text-violet-700" subtitle="found savings" />
        </div>

        {/* Acquisition Metrics */}
        <h2 className="text-lg font-semibold mb-3 text-gray-700">Acquisition (True New vs Returning)</h2>
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
          <StatCard label="Truly New" value={acquisitionMetrics.trulyNewUsers} color="text-emerald-700" subtitle="new devices" />
          <StatCard label="Returning Device" value={acquisitionMetrics.returningDeviceUsers} color="text-amber-700" subtitle="same device, new UID" />
          <StatCard label="New→Basket" value={`${acquisitionMetrics.newUserConversionRate}%`} color="text-blue-700" subtitle="conversion rate" />
        </div>

        {/* Performance */}
        <h2 className="text-lg font-semibold mb-3 text-gray-700">Performance</h2>
        <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-4">
          <StatCard label="Avg Response" value={`${stats.avgProcessingMs}ms`} color="text-cyan-700" />
          <StatCard label="Basket Success" value={`${stats.basketSuccessRate}%`} color="text-pink-700" subtitle="results shown" />
        </div>

        {/* Latency by Response Type */}
        <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">Latency by Response Type</h2>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
              {[
                { value: '24h', label: '24h' },
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
                { value: 'all', label: 'All time' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setLatencyTimeRange(option.value as typeof latencyTimeRange)}
                  className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition ${
                    latencyTimeRange === option.value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            {latencyLoading ? (
              <p className="text-gray-400 text-center py-8">Loading...</p>
            ) : latencyData.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left py-3 font-medium">Response Type</th>
                    <th className="text-right py-3 font-medium">Requests</th>
                    <th className="text-right py-3 font-medium">Average</th>
                    <th className="text-right py-3 font-medium">Median</th>
                    <th className="text-right py-3 font-medium">Slowest 5%</th>
                  </tr>
                </thead>
                <tbody>
                  {latencyData.map((l, i) => (
                    <tr key={l.type} className="border-b border-gray-100">
                      <td className="py-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="capitalize">{l.type}</span>
                      </td>
                      <td className="text-right py-3 text-gray-600">{l.count}</td>
                      <td className="text-right py-3">
                        <span className={`font-medium ${l.avg < 500 ? 'text-emerald-700' : l.avg < 1000 ? 'text-amber-700' : 'text-red-600'}`}>
                          {l.avg}ms
                        </span>
                      </td>
                      <td className="text-right py-3">
                        <span className={`${l.p50 < 500 ? 'text-emerald-700' : l.p50 < 1000 ? 'text-amber-700' : 'text-red-600'}`}>
                          {l.p50}ms
                        </span>
                      </td>
                      <td className="text-right py-3">
                        <span className={`${l.p95 < 1000 ? 'text-emerald-700' : l.p95 < 2000 ? 'text-amber-700' : 'text-red-600'}`}>
                          {l.p95}ms
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-gray-400 text-center py-8">No latency data available</p>
            )}
          </div>
        </div>

        <div className="mb-6"></div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6 mb-6">
          <Card title="Daily Active Users (DAU)">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyUsers} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="date" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} />
                  <YAxis stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} />
                  <Area type="monotone" dataKey="dau" stroke="#2563EB" fill="#2563EB" fillOpacity={0.15} strokeWidth={2} name="Users" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Weekly Active Users (WAU)">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyUsers} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="week" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} />
                  <YAxis stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} />
                  <Bar dataKey="wau" fill="#059669" radius={[6, 6, 0, 0]} name="Users" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Baskets per WAU">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyUsers} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="week" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} />
                  <YAxis stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} />
                  <Line type="monotone" dataKey="basketsPerUser" stroke="#7C3AED" strokeWidth={2} dot={{ fill: '#7C3AED', r: 4 }} name="Baskets/User" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="User Segments">
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={userSegments} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis type="number" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} />
                  <YAxis dataKey="segment" type="category" stroke="#374151" fontSize={10} fontWeight={500} width={100} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} />
                  <Bar dataKey="users" radius={[0, 6, 6, 0]}>
                    {userSegments.map((_, index) => (
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
          <Card title="Cohort Retention">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left py-3 font-medium">Cohort</th>
                    <th className="text-right py-3 font-medium">Users</th>
                    <th className="text-right py-3 font-medium">W1</th>
                    <th className="text-right py-3 font-medium">W2</th>
                    <th className="text-right py-3 font-medium">W4</th>
                  </tr>
                </thead>
                <tbody>
                  {retentionData.map((r, i) => (
                    <tr key={r.cohort} className="border-b border-gray-100">
                      <td className="py-3 font-medium">{r.cohort}</td>
                      <td className="text-right py-3 text-gray-600">{r.users}</td>
                      <td className="text-right py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${r.w1 >= 30 ? 'bg-emerald-100 text-emerald-700' : r.w1 >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {r.w1}%
                        </span>
                      </td>
                      <td className="text-right py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${r.w2 >= 20 ? 'bg-emerald-100 text-emerald-700' : r.w2 >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {r.w2}%
                        </span>
                      </td>
                      <td className="text-right py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${r.w4 >= 10 ? 'bg-emerald-100 text-emerald-700' : r.w4 >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {r.w4}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="User Segments Detail">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left py-3 font-medium">Segment</th>
                    <th className="text-right py-3 font-medium">Users</th>
                    <th className="text-right py-3 font-medium">Avg Events</th>
                    <th className="text-right py-3 font-medium">Avg Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {userSegments.map((s, i) => (
                    <tr key={s.segment} className="border-b border-gray-100">
                      <td className="py-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        {s.segment}
                      </td>
                      <td className="text-right py-3 text-gray-600">{s.users}</td>
                      <td className="text-right py-3 text-gray-600">{s.avgEvents}</td>
                      <td className="text-right py-3 text-emerald-700 font-medium">€{(s.avgSavings / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* PMF Checklist */}
        <div className="mt-6">
          <Card title="PMF Health Check">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <PMFIndicator
                label="Stickiness (DAU/WAU)"
                value={stats.dauWauRatio}
                target={20}
                unit="%"
                good={stats.dauWauRatio >= 20}
                description="How often users return. Higher = more habit-forming."
              />
              <PMFIndicator
                label="W1 Retention"
                value={stats.w1Retention}
                target={25}
                unit="%"
                good={stats.w1Retention >= 25}
                description="Users who return in week 2 after first use."
              />
              <PMFIndicator
                label="Action Rate"
                value={stats.actionRate}
                target={30}
                unit="%"
                good={stats.actionRate >= 30}
                description="Users who take action (swap, save basket)."
              />
              <PMFIndicator
                label="Aha! Rate"
                value={activationMetrics.ahaEventRate}
                target={40}
                unit="%"
                good={activationMetrics.ahaEventRate >= 40}
                description="Users who found €3+ savings (the aha moment)."
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, subtitle }: { label: string; value: string | number; color: string; subtitle?: string }) {
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-5 shadow-sm">
      <p className="text-gray-600 text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1">{label}</p>
      <p className={`text-xl sm:text-2xl md:text-3xl font-semibold ${color}`}>{value}</p>
      {subtitle && <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{subtitle}</p>}
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

function PMFIndicator({ label, value, target, unit, good, description }: { label: string; value: number; target: number; unit: string; good: boolean; description: string }) {
  return (
    <div className={`p-4 rounded-xl border-2 ${good ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        {good ? (
          <svg className="w-5 h-5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-2xl font-bold ${good ? 'text-emerald-700' : 'text-amber-700'}`}>{value}{unit}</span>
        <span className="text-xs text-gray-400">/ {target}{unit} target</span>
      </div>
      <p className="text-[10px] text-gray-500 mt-2 leading-tight">{description}</p>
    </div>
  );
}
