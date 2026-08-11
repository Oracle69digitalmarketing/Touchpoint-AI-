
import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Agent, Touchpoint, AnalyticsRange, AnalyticsOverview } from '../types';
import { Scan, Users, Target, TrendingUp, ArrowUpRight, ArrowDownRight, BarChart3 } from 'lucide-react';
import { analyticsService } from '../services/analytics';

interface Props {
  touchpoints: Touchpoint[];
  agents: Agent[];
}

const RANGE_OPTIONS: { key: AnalyticsRange; label: string }[] = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'ALL' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatAxisLabel = (iso: string, unit: 'hour' | 'day'): string => {
  if (unit === 'hour') return iso.slice(11, 16);
  const [, month, day] = iso.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}`;
};

const TrendPill = ({ delta }: { delta: number | null }) => {
  if (delta === null || delta === undefined) {
    return (
      <div className="flex items-center gap-1 text-slate-400 font-bold text-xs bg-slate-50 px-2 py-1 rounded-full">
        —
      </div>
    );
  }
  const positive = delta >= 0;
  return (
    <div className={`flex items-center gap-1 font-bold text-xs px-2 py-1 rounded-full ${positive ? 'text-emerald-500 bg-emerald-50' : 'text-rose-500 bg-rose-50'}`}>
      {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {Math.abs(delta).toFixed(1)}%
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color, delta }: { label: string, value: string | number, icon: any, color: string, delta?: number | null }) => (
  <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm transition-all hover:shadow-xl group">
    <div className="flex justify-between items-start mb-6">
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform`}>
        <Icon size={28} />
      </div>
      <TrendPill delta={delta ?? null} />
    </div>
    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-1">{label}</p>
    <h3 className="text-3xl font-bold text-slate-900 tracking-tight">{value}</h3>
  </div>
);

const Dashboard: React.FC<Props> = ({ touchpoints, agents }) => {
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    analyticsService.overview(range)
      .then((data) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch((err) => {
        console.error('[Dashboard] Failed to load analytics:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [range]);

  const totals = analytics?.totals;
  const deltas = analytics?.deltas;
  const trends = analytics?.trends;

  const totalScans = totals?.scans ?? 0;
  const qualifiedLeads = totals?.qualifiedLeads ?? 0;
  const qualificationRate = analytics?.qualificationRate ?? 0;
  const activeAgents = agents.length;
  const totalLeads = totals?.leads ?? 0;

  const chartData = (trends?.points || []).map((p) => ({
    date: formatAxisLabel(p.date, trends.unit),
    scans: p.scans,
    leads: p.leads,
  }));

  const hasActivity = totalScans > 0 || totalLeads > 0 || (totals?.conversations ?? 0) > 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight text-gradient">Infrastructure Pulse</h1>
          <p className="text-slate-500 font-medium">Monitoring {touchpoints.length} activation nodes across {activeAgents} specialized agents.</p>
        </div>
        <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`px-4 py-2 rounded-xl text-[10px] font-bold tracking-widest transition-all ${range === opt.key ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Total Reach" value={loading ? '—' : totalScans.toLocaleString()} icon={Scan} color="bg-indigo-50 text-indigo-600" delta={deltas?.scans} />
        <StatCard label="Active Agents" value={activeAgents} icon={Users} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Qualified Leads" value={loading ? '—' : qualifiedLeads} icon={Target} color="bg-emerald-50 text-emerald-600" delta={deltas?.qualifiedLeads} />
        <StatCard label="Qualify Rate" value={loading ? '—' : `${qualificationRate}%`} icon={TrendingUp} color="bg-amber-50 text-amber-600" delta={deltas?.leads} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-10 rounded-[48px] border border-slate-100 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-10 pointer-events-none opacity-5">
            <TrendingUp size={200} className="text-indigo-600" />
          </div>
          <div className="flex items-center justify-between mb-10 relative">
            <div>
              <h3 className="text-xl font-bold text-slate-900">Engagement Velocity</h3>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Physical world activity</p>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-indigo-600 rounded-full"></div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Scans</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded-full"></div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Leads</span></div>
            </div>
          </div>
          <div className="h-[340px] relative">
            {chartData.length === 0 || !hasActivity ? (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                <BarChart3 size={56} className="mb-4 text-indigo-500" />
                <p className="text-sm font-bold uppercase tracking-widest text-slate-400">No activity recorded yet</p>
                <p className="text-xs font-bold text-slate-300 mt-1">New scans and conversations will appear here.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorScans" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}} allowDecimals={false} />
                  <Tooltip
                    cursor={{stroke: '#4f46e5', strokeWidth: 1}}
                    contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '16px' }}
                  />
                  <Area type="monotone" dataKey="scans" stroke="#4f46e5" strokeWidth={4} fillOpacity={1} fill="url(#colorScans)" />
                  <Area type="monotone" dataKey="leads" stroke="#10b981" strokeWidth={4} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white p-10 rounded-[48px] border border-slate-100 shadow-sm flex flex-col">
          <h3 className="text-xl font-bold text-slate-900 mb-8">Activation Nodes</h3>
          {touchpoints.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 opacity-30">
               <Scan size={48} className="mb-4" />
               <p className="text-sm font-bold uppercase tracking-widest">Awaiting Nodes</p>
            </div>
          ) : (
            <div className="space-y-8 flex-1 overflow-y-auto custom-scrollbar pr-2">
              {[...touchpoints].sort((a,b) => b.scans - a.scans).slice(0, 6).map((tp, i) => (
                <div key={tp.id} className="flex items-center justify-between group cursor-default">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300">
                      {i+1}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{tp.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{tp.type}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-900">{tp.scans}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Engagement</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-8 pt-8 border-t border-slate-50">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4 text-center">Global Performance Index</p>
            <div className="flex justify-around">
               <div className="text-center">
                 <p className="text-xl font-black text-indigo-600">{loading ? '—' : `${totalScans.toLocaleString()}`}</p>
                 <p className="text-[10px] font-bold text-slate-400 uppercase">Scans</p>
               </div>
               <div className="text-center">
                 <p className="text-xl font-black text-emerald-500">{loading ? '—' : `${qualificationRate.toFixed(1)}%`}</p>
                 <p className="text-[10px] font-bold text-slate-400 uppercase">Qualify Rate</p>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
