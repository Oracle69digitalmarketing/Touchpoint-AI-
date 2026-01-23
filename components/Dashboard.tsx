
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Agent, Touchpoint, SUPPORTED_CURRENCIES } from '../types';
import { Scan, Users, Target, CircleDollarSign, TrendingUp, ArrowUpRight } from 'lucide-react';

interface Props {
  touchpoints: Touchpoint[];
  agents: Agent[];
  currentCurrency: string;
}

// Chart data would typically come from an analytics API. 
const generateChartData = (scansCount: number) => [
  { date: 'Mon', scans: Math.floor(scansCount * 0.1), leads: 5 },
  { date: 'Tue', scans: Math.floor(scansCount * 0.15), leads: 8 },
  { date: 'Wed', scans: Math.floor(scansCount * 0.2), leads: 12 },
  { date: 'Thu', scans: Math.floor(scansCount * 0.12), leads: 7 },
  { date: 'Fri', scans: Math.floor(scansCount * 0.25), leads: 15 },
  { date: 'Sat', scans: Math.floor(scansCount * 0.3), leads: 22 },
  { date: 'Sun', scans: Math.floor(scansCount * 0.2), leads: 18 },
];

const StatCard = ({ label, value, icon: Icon, color, trend }: { label: string, value: string | number, icon: any, color: string, trend?: string }) => (
  <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm transition-all hover:shadow-xl group">
    <div className="flex justify-between items-start mb-6">
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform`}>
        <Icon size={28} />
      </div>
      {trend && (
        <div className="flex items-center gap-1 text-emerald-500 font-bold text-xs bg-emerald-50 px-2 py-1 rounded-full">
          <ArrowUpRight size={14} />
          {trend}
        </div>
      )}
    </div>
    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-1">{label}</p>
    <h3 className="text-3xl font-bold text-slate-900 tracking-tight">{value}</h3>
  </div>
);

const Dashboard: React.FC<Props> = ({ touchpoints, agents, currentCurrency }) => {
  const totalScans = touchpoints.reduce((acc, curr) => acc + curr.scans, 0);
  const activeAgents = agents.length;
  const avgConvRate = agents.length > 0 
    ? (agents.reduce((acc, curr) => acc + curr.conversionRate, 0) / agents.length).toFixed(1) 
    : '0';
  
  const currencyObj = SUPPORTED_CURRENCIES.find(c => c.code === currentCurrency) || SUPPORTED_CURRENCIES[0];
  const conversionBase = 240; // Simulated base value per scan in USD cents or units
  const totalAttributed = (totalScans * conversionBase * currencyObj.rate);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyObj.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  };
  
  const chartData = generateChartData(totalScans || 100);

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight text-gradient">Infrastructure Pulse</h1>
          <p className="text-slate-500 font-medium">Monitoring {touchpoints.length} activation nodes across {activeAgents} specialized agents.</p>
        </div>
        <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-1">
          {['24H', '7D', '30D', 'ALL'].map(t => (
            <button key={t} className={`px-4 py-2 rounded-xl text-[10px] font-bold tracking-widest transition-all ${t === '7D' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Total Reach" value={totalScans.toLocaleString()} icon={Scan} color="bg-indigo-50 text-indigo-600" trend="+12%" />
        <StatCard label="Active Agents" value={activeAgents} icon={Users} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Pipeline Conv." value={`${avgConvRate}%`} icon={TrendingUp} color="bg-amber-50 text-amber-600" trend="+2.4%" />
        <StatCard label="Attributed Sales" value={formatCurrency(totalAttributed)} icon={CircleDollarSign} color="bg-rose-50 text-rose-600" />
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
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}} />
                <Tooltip 
                  cursor={{stroke: '#4f46e5', strokeWidth: 1}}
                  contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '16px' }}
                />
                <Area type="monotone" dataKey="scans" stroke="#4f46e5" strokeWidth={4} fillOpacity={1} fill="url(#colorScans)" />
                <Area type="monotone" dataKey="leads" stroke="#10b981" strokeWidth={4} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
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
              {touchpoints.sort((a,b) => b.scans - a.scans).slice(0, 6).map((tp, i) => (
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
                 <p className="text-xl font-black text-indigo-600">98.2%</p>
                 <p className="text-[10px] font-bold text-slate-400 uppercase">Uptime</p>
               </div>
               <div className="text-center">
                 <p className="text-xl font-black text-emerald-500">1.2s</p>
                 <p className="text-[10px] font-bold text-slate-400 uppercase">Latency</p>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
