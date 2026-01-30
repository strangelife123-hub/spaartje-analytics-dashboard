'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { format, subDays, subMonths } from 'date-fns';
import Link from 'next/link';

interface FunnelStep {
  name: string;
  shortName: string;
  value: number;
  users: number;
  fill: string;
  dropoff?: number;
  dropoffPct?: string;
}

interface DailyOnboarding {
  date: string;
  started: number;
  completed: number;
  rate: number;
}

// Updated flow based on actual Flutter app - darker colors
const ONBOARDING_STEPS = [
  { event: 'app_launch', label: 'App Launch', shortName: 'Launch', color: '#2563EB' },
  { event: 'splash_load_completed', label: 'Splash Loaded', shortName: 'Splash', color: '#0891B2' },
  { event: 'onboarding_started', label: 'Onboarding Started', shortName: 'Started', color: '#059669' },
  { event: 'demo_list_selected', label: 'Demo List / Input', shortName: 'Input', color: '#D97706' },
  { event: 'comparison_started', label: 'Comparison Started', shortName: 'Compare', color: '#7C3AED' },
  { event: 'onboarding_completed', label: 'Completed', shortName: 'Done', color: '#DB2777' },
];

export default function OnboardingPage() {
  const [funnelData, setFunnelData] = useState<FunnelStep[]>([]);
  const [dailyData, setDailyData] = useState<DailyOnboarding[]>([]);
  const [demoListStats, setDemoListStats] = useState<{list: string; count: number}[]>([]);
  const [stats, setStats] = useState({
    totalStarted: 0,
    totalCompleted: 0,
    overallRate: 0,
    biggestDropoff: '',
    biggestDropoffPct: 0,
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

  const fetchData = async () => {
    try {
      setLoading(true);
      const dateFilter = getDateFilter(timeRange);

      const { data: events } = await supabase
        .from('analytics_events')
        .select('received_at, firebase_uid, event_name, props')
        .gte('received_at', dateFilter)
        .order('received_at', { ascending: true });

      // Build funnel data
      const eventCounts = new Map<string, { count: number; users: Set<string> }>();
      ONBOARDING_STEPS.forEach(step => {
        eventCounts.set(step.event, { count: 0, users: new Set() });
      });

      // Also track demo list selections
      const demoLists = new Map<string, number>();

      events?.forEach(e => {
        const step = eventCounts.get(e.event_name);
        if (step) {
          step.count++;
          step.users.add(e.firebase_uid);
        }

        // Track demo list usage
        if (e.event_name === 'demo_list_selected' && e.props?.list_key) {
          const key = e.props.list_key as string;
          demoLists.set(key, (demoLists.get(key) || 0) + 1);
        }
      });

      // Demo list stats
      setDemoListStats(
        Array.from(demoLists.entries())
          .map(([list, count]) => ({ list, count }))
          .sort((a, b) => b.count - a.count)
      );

      const funnel: FunnelStep[] = ONBOARDING_STEPS.map((step, index) => {
        const data = eventCounts.get(step.event)!;
        const prevData = index > 0 ? eventCounts.get(ONBOARDING_STEPS[index - 1].event)! : null;
        const dropoff = prevData ? prevData.users.size - data.users.size : 0;
        const dropoffPct = prevData && prevData.users.size > 0
          ? ((dropoff / prevData.users.size) * 100).toFixed(0) + '%'
          : '';

        return {
          name: step.label,
          shortName: step.shortName,
          value: data.count,
          users: data.users.size,
          fill: step.color,
          dropoff,
          dropoffPct,
        };
      });

      setFunnelData(funnel);

      // Find biggest dropoff
      let biggestDropoff = '';
      let biggestDropoffPct = 0;
      funnel.forEach((step, i) => {
        if (i > 0 && step.dropoff && funnel[i-1].users > 0) {
          const pct = (step.dropoff / funnel[i-1].users) * 100;
          if (pct > biggestDropoffPct) {
            biggestDropoffPct = pct;
            biggestDropoff = `${funnel[i-1].shortName} → ${step.shortName}`;
          }
        }
      });

      // Daily onboarding data
      const dailyMap = new Map<string, { started: Set<string>; completed: Set<string> }>();
      events?.forEach(e => {
        const date = e.received_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { started: new Set(), completed: new Set() });
        }
        const day = dailyMap.get(date)!;
        if (e.event_name === 'onboarding_started') {
          day.started.add(e.firebase_uid);
        }
        if (e.event_name === 'onboarding_completed') {
          day.completed.add(e.firebase_uid);
        }
      });

      const daily = Array.from(dailyMap.entries())
        .map(([date, data]) => ({
          date: format(new Date(date), 'MMM dd'),
          started: data.started.size,
          completed: data.completed.size,
          rate: data.started.size > 0 ? Math.round((data.completed.size / data.started.size) * 100) : 0,
        }))
        .slice(-14);

      setDailyData(daily);

      // Overall stats
      const totalStarted = eventCounts.get('onboarding_started')?.users.size || 0;
      const totalCompleted = eventCounts.get('onboarding_completed')?.users.size || 0;
      const overallRate = totalStarted > 0 ? Math.round((totalCompleted / totalStarted) * 100) : 0;

      setStats({
        totalStarted,
        totalCompleted,
        overallRate,
        biggestDropoff,
        biggestDropoffPct: Math.round(biggestDropoffPct),
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
            <Link href="/" className="text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-900 transition">Overview</Link>
            <Link href="/users" className="text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-900 transition">Users</Link>
            <Link href="/onboarding" className="text-xs sm:text-sm font-medium text-blue-700">Onboarding</Link>
            <span className="text-[10px] sm:text-xs text-gray-400 hidden sm:inline">
              {lastUpdated ? format(lastUpdated, 'HH:mm') : '-'}
            </span>
          </div>
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

        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Onboarding Funnel</h2>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-8">
          <StatCard label="Started" value={stats.totalStarted} color="text-blue-700" />
          <StatCard label="Completed" value={stats.totalCompleted} color="text-emerald-700" />
          <StatCard label="Rate" value={`${stats.overallRate}%`} color="text-violet-700" />
          <StatCard label="Drop-off" value={`${stats.biggestDropoffPct}%`} subtitle={stats.biggestDropoff} color="text-red-600" />
        </div>

        {/* Funnel Visualization */}
        <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-sm mb-3 sm:mb-6">
          <h3 className="text-base sm:text-lg font-semibold mb-4 sm:mb-6">User Journey</h3>
          <div className="space-y-3">
            {funnelData.map((step, index) => {
              const maxUsers = funnelData[0]?.users || 1;
              const widthPct = (step.users / maxUsers) * 100;

              return (
                <div key={step.name} className="relative">
                  <div className="flex items-center gap-2 sm:gap-4">
                    <div className="w-20 sm:w-28 md:w-36 text-xs sm:text-sm font-medium text-gray-700 text-right">
                      {step.shortName}
                      <span className="hidden sm:inline"> - {step.name.split(' ').slice(-1)}</span>
                    </div>
                    <div className="flex-1 relative">
                      <div
                        className="h-10 sm:h-12 rounded-lg flex items-center justify-between px-2 sm:px-4 transition-all"
                        style={{
                          width: `${Math.max(widthPct, 15)}%`,
                          backgroundColor: step.fill + '20',
                          borderLeft: `4px solid ${step.fill}`,
                        }}
                      >
                        <span className="font-semibold text-xs sm:text-sm" style={{ color: step.fill }}>
                          {step.users}
                        </span>
                        <span className="text-gray-500 text-xs hidden sm:inline">
                          {step.value} events
                        </span>
                      </div>
                    </div>
                    <div className="w-12 sm:w-16 text-right">
                      {index > 0 && step.dropoffPct && (
                        <span className="text-red-600 text-xs sm:text-sm font-medium">
                          -{step.dropoffPct}
                        </span>
                      )}
                    </div>
                  </div>
                  {index < funnelData.length - 1 && (
                    <div className="ml-20 sm:ml-28 md:ml-36 pl-2 sm:pl-4 py-0.5 sm:py-1">
                      <div className="w-0.5 h-2 sm:h-3 bg-gray-200 ml-4"></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Drop-off Analysis */}
        <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-sm mb-3 sm:mb-6">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Step-by-Step Conversion</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4">
            {funnelData.slice(1).map((step, index) => {
              const prevStep = funnelData[index];
              const dropoffPct = prevStep.users > 0
                ? Math.round((step.dropoff! / prevStep.users) * 100)
                : 0;
              const conversionPct = 100 - dropoffPct;

              return (
                <div key={step.name} className="border border-gray-100 rounded-lg sm:rounded-xl p-2 sm:p-4">
                  <div className="text-[10px] sm:text-xs text-gray-500 mb-1 sm:mb-2 truncate">
                    {prevStep.shortName} → {step.shortName}
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-lg sm:text-xl font-bold text-emerald-700">{conversionPct}%</div>
                      <div className="text-[10px] sm:text-xs text-gray-400">converted</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs sm:text-sm font-semibold text-red-600">{step.dropoff}</div>
                      <div className="text-[10px] sm:text-xs text-gray-400">dropped</div>
                    </div>
                  </div>
                  <div className="mt-1.5 sm:mt-2 h-1 sm:h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${conversionPct}%`, backgroundColor: step.fill }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Demo Lists & Daily Trends */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6 mb-3 sm:mb-6">
          <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-sm">
            <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Demo List Usage</h3>
            {demoListStats.length > 0 ? (
              <div className="space-y-3">
                {demoListStats.map((item, i) => (
                  <div key={item.list} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {item.list === 'voorbeeld' ? '📋' : item.list === 'ontbijt' ? '🍳' : '🍝'}
                      </span>
                      <span className="text-sm font-medium capitalize">{item.list}</span>
                    </div>
                    <span className="text-sm text-gray-500">{item.count}x</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">No demo list data</p>
            )}
          </div>

          <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-sm lg:col-span-2">
            <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Daily Onboarding</h3>
            <div className="h-40 sm:h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="date" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <YAxis stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }} />
                  <Legend wrapperStyle={{ fontSize: 12, fontWeight: 500 }} />
                  <Bar dataKey="started" fill="#2563EB" name="Started" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" fill="#059669" name="Completed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Completion Rate Trend */}
        <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-sm mb-3 sm:mb-6">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Completion Rate Over Time</h3>
          <div className="h-40 sm:h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                <XAxis dataKey="date" stroke="#374151" fontSize={11} fontWeight={500} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                <YAxis stroke="#374151" fontSize={11} fontWeight={500} domain={[0, 100]} unit="%" tickLine={false} axisLine={{ stroke: '#D1D5DB' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, fontWeight: 500 }}
                  formatter={(value) => [`${value}%`, 'Completion Rate']}
                />
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke="#7C3AED"
                  strokeWidth={2}
                  dot={{ fill: '#7C3AED', strokeWidth: 2, r: 3 }}
                  name="Rate"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Insights */}
        <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-sm">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Insights</h3>
          <div className="space-y-3">
            {stats.biggestDropoffPct > 40 && (
              <InsightCard
                type="warning"
                title={`High drop-off: ${stats.biggestDropoff}`}
                description={`${stats.biggestDropoffPct}% of users drop off at this step. Consider simplifying or adding guidance.`}
              />
            )}
            {stats.overallRate < 50 && (
              <InsightCard
                type="warning"
                title="Low completion rate"
                description={`Only ${stats.overallRate}% complete onboarding. Consider shortening the flow.`}
              />
            )}
            {stats.overallRate >= 60 && (
              <InsightCard
                type="success"
                title="Healthy completion rate"
                description={`${stats.overallRate}% completion rate is good for a value-first onboarding flow.`}
              />
            )}
            <InsightCard
              type="info"
              title="Flow summary"
              description={`${funnelData[0]?.users || 0} app launches → ${stats.totalStarted} started onboarding → ${stats.totalCompleted} completed (30 days)`}
            />
          </div>
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
      {subtitle && <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1 truncate">{subtitle}</p>}
    </div>
  );
}

function InsightCard({ type, title, description }: { type: 'warning' | 'success' | 'info'; title: string; description: string }) {
  const colors = {
    warning: 'bg-orange-50 border-orange-200 text-orange-800',
    success: 'bg-green-50 border-green-200 text-green-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };

  return (
    <div className={`${colors[type]} border rounded-xl p-4`}>
      <div className="font-medium">{title}</div>
      <div className="text-sm opacity-80 mt-1">{description}</div>
    </div>
  );
}
