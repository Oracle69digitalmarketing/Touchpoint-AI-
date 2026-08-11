
import React, { useEffect, useState } from 'react';
import { SurfaceType, Touchpoint, AgentStatus, TouchpointPerformance } from '../types';
import { QrCode, Smartphone, Eye, Download, MapPin, Radio, Power, Trash2 } from 'lucide-react';
import { analyticsService } from '../services/analytics';

interface Props {
  touchpoints: Touchpoint[];
  onToggleActive: (tp: Touchpoint) => void;
  onDelete: (tp: Touchpoint) => void;
}

const TouchpointMatrix: React.FC<Props> = ({ touchpoints, onToggleActive, onDelete }) => {
  const [analytics, setAnalytics] = useState<Map<string, TouchpointPerformance>>(new Map());

  // Per-node pipeline metrics for the trailing 30 days, derived server-side
  // from real persisted scans / conversations / leads.
  useEffect(() => {
    let cancelled = false;
    analyticsService.touchpoints('30d')
      .then((data) => {
        if (!cancelled) setAnalytics(new Map(data.touchpoints.map((tp) => [tp.id, tp])));
      })
      .catch((err) => {
        console.error('[TouchpointMatrix] Failed to load analytics:', err);
      });
    return () => { cancelled = true; };
  }, [touchpoints.length]);

  const performanceOf = (id: string): TouchpointPerformance | undefined => analytics.get(id);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
       <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Activation Matrix</h1>
          <p className="text-slate-500 font-medium">Manage your hardware nodes and track their physical performance.</p>
        </div>
      </div>

      <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/30 border-b border-slate-100">
                <th className="px-8 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Hardware node</th>
                <th className="px-8 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Technology</th>
                <th className="px-8 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Connected Agent</th>
                <th className="px-8 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Physical reach</th>
                <th className="px-8 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Pipeline</th>
                <th className="px-8 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Network Status</th>
                <th className="px-8 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {touchpoints.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-8 py-20 text-center">
                    <p className="text-slate-400 font-medium italic">No physical touchpoints provisioned yet.</p>
                  </td>
                </tr>
              ) : (
                touchpoints.map((tp) => {
                  const perf = performanceOf(tp.id);
                  return (
                    <tr key={tp.id} className="group hover:bg-slate-50/50 transition-all">
                      <td className="px-8 py-7">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm">
                            {tp.type === SurfaceType.NFC_TAG ? <Radio size={20}/> : <QrCode size={20} />}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{tp.name}</p>
                            <div className="flex items-center gap-1 text-[11px] text-slate-400 font-bold uppercase mt-0.5">
                              <MapPin size={10} />
                              {tp.location}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-7">
                        <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-xl uppercase tracking-wider group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                          {tp.type}
                        </span>
                      </td>
                      <td className="px-8 py-7">
                        <div className="flex flex-col">
                          <p className="text-sm font-bold text-slate-900">{tp.agentName || 'Unlinked'}</p>
                          <span className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${
                            tp.agentStatus === AgentStatus.ACTIVE ? 'text-emerald-500' : 'text-amber-500'
                          }`}>
                            {tp.agentStatus || 'Unknown'}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-7">
                        <div className="flex flex-col">
                          <p className="text-base font-bold text-slate-900">{tp.scans}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase">Total scans</p>
                        </div>
                      </td>
                      <td className="px-8 py-7">
                        <div className="flex flex-col">
                          <p className="text-base font-bold text-slate-900">
                            {perf ? perf.leads : '—'}
                            <span className="text-[10px] font-bold text-slate-400 uppercase ml-2">leads</span>
                          </p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                            {perf ? `${perf.qualifiedLeads} qualified · ${perf.qualificationRate}%` : '—'}
                          </p>
                        </div>
                      </td>
                      <td className="px-8 py-7">
                        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${tp.active ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${tp.active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></div>
                          <span className="text-[10px] font-bold uppercase tracking-widest">{tp.active ? 'Online' : 'Paused'}</span>
                        </div>
                      </td>
                      <td className="px-8 py-7 text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-xl shadow-sm hover:shadow transition-all" title="View Analytics">
                            <Eye size={18} />
                          </button>
                          <button className="p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-xl shadow-sm hover:shadow transition-all" title="Download Assets">
                            <Download size={18} />
                          </button>
                          <button
                            onClick={() => onToggleActive(tp)}
                            className="p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-xl shadow-sm hover:shadow transition-all"
                            title={tp.active ? 'Pause touchpoint' : 'Activate touchpoint'}
                          >
                            <Power size={18} />
                          </button>
                          <button
                            onClick={() => onDelete(tp)}
                            className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded-xl shadow-sm hover:shadow transition-all"
                            title="Delete touchpoint"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TouchpointMatrix;
