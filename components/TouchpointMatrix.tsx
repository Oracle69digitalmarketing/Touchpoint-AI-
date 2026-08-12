
import React, { useEffect, useState } from 'react';
import { SurfaceType, Touchpoint, AgentStatus, TouchpointPerformance } from '../types';
import { QrCode, Eye, Download, MapPin, Radio, Power, Trash2, X, ExternalLink } from 'lucide-react';
import { analyticsService } from '../services/analytics';
import QRCode from 'qrcode';

interface Props {
  touchpoints: Touchpoint[];
  onToggleActive: (tp: Touchpoint) => void;
  onDelete: (tp: Touchpoint) => void;
}

const TouchpointMatrix: React.FC<Props> = ({ touchpoints, onToggleActive, onDelete }) => {
  const [analytics, setAnalytics] = useState<Map<string, TouchpointPerformance>>(new Map());
  const [viewing, setViewing] = useState<Touchpoint | null>(null);

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

  const downloadQR = async (tp: Touchpoint) => {
    try {
      // Mirror SurfaceGenerator: derive the QR client-side from the touchpoint's
      // existing public URL and trigger a browser download. No backend endpoint.
      const url = tp.url || `${window.location.origin}/t/${tp.trackingId}`;
      const qr = await QRCode.toDataURL(url, {
        width: 600,
        margin: 2,
        color: {
          dark: '#0f172a', // slate-900
          light: '#ffffff',
        },
      });
      const link = document.createElement('a');
      link.href = qr;
      link.download = `touchpoint-${tp.name.toLowerCase().replace(/\s+/g, '-')}.png`;
      link.click();
    } catch (err: any) {
      console.error('[TouchpointMatrix] QR download failed:', err);
      alert(err.message || 'Could not generate the QR asset.');
    }
  };

  const viewPerf = viewing ? performanceOf(viewing.id) : undefined;

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
                        <div className="flex justify-end gap-1 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
                          <button
                            onClick={() => setViewing(tp)}
                            className="p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-xl shadow-sm hover:shadow transition-all"
                            title="View Analytics"
                            aria-label={`View analytics for ${tp.name}`}
                          >
                            <Eye size={18} />
                          </button>
                          <button
                            onClick={() => downloadQR(tp)}
                            className="p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-xl shadow-sm hover:shadow transition-all"
                            title="Download Assets"
                            aria-label={`Download QR asset for ${tp.name}`}
                          >
                            <Download size={18} />
                          </button>
                          <button
                            onClick={() => onToggleActive(tp)}
                            className="p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-xl shadow-sm hover:shadow transition-all"
                            title={tp.active ? 'Pause touchpoint' : 'Activate touchpoint'}
                            aria-label={tp.active ? `Pause touchpoint ${tp.name}` : `Activate touchpoint ${tp.name}`}
                          >
                            <Power size={18} />
                          </button>
                          <button
                            onClick={() => onDelete(tp)}
                            className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded-xl shadow-sm hover:shadow transition-all"
                            title="Delete touchpoint"
                            aria-label={`Delete touchpoint ${tp.name}`}
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

      {/* TOUCHPOINT DETAIL MODAL — same lightweight pattern as AgentManager's quick-stats modal. */}
      {viewing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl p-10 animate-in zoom-in duration-300 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-start mb-8">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm">
                  {viewing.type === SurfaceType.NFC_TAG ? <Radio size={22}/> : <QrCode size={22} />}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{viewing.name}</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{viewing.type}</p>
                </div>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-slate-50 rounded-full transition-colors" title="Close" aria-label="Close touchpoint details">
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Network Status</span>
                  <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest ${viewing.active ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${viewing.active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></div>
                    {viewing.active ? 'Online' : 'Paused'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Connected Agent</span>
                  <span className="text-sm font-bold text-slate-900">{viewing.agentName || 'Unlinked'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Placement</span>
                  <span className="text-sm font-bold text-slate-900 flex items-center gap-1"><MapPin size={12} className="text-slate-400" />{viewing.location}</span>
                </div>
                <div className="border-t border-slate-200/60 pt-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Tracking ID</p>
                  <p className="text-sm font-mono text-indigo-600">{viewing.trackingId}</p>
                </div>
                {viewing.url && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Public URL</p>
                    <a
                      href={viewing.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-mono truncate text-indigo-600 hover:underline flex items-center gap-1"
                    >
                      {viewing.url} <ExternalLink size={12} />
                    </a>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-5 bg-indigo-50 rounded-3xl border border-indigo-100">
                  <p className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.2em] mb-1">Total Scans</p>
                  <p className="text-2xl font-black text-indigo-600">{viewing.scans}</p>
                </div>
                <div className="p-5 bg-slate-50 rounded-3xl border border-slate-100">
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">Conversations</p>
                  <p className="text-2xl font-black text-slate-900">{viewPerf ? viewPerf.conversations : '—'}</p>
                </div>
                <div className="p-5 bg-emerald-50 rounded-3xl border border-emerald-100">
                  <p className="text-[10px] font-black uppercase text-emerald-500 tracking-[0.2em] mb-1">Leads</p>
                  <p className="text-2xl font-black text-emerald-600">{viewPerf ? viewPerf.leads : '—'}</p>
                </div>
                <div className="p-5 bg-emerald-50 rounded-3xl border border-emerald-100">
                  <p className="text-[10px] font-black uppercase text-emerald-500 tracking-[0.2em] mb-1">Qualified · Rate</p>
                  <p className="text-2xl font-black text-emerald-600">{viewPerf ? viewPerf.qualifiedLeads : '—'}</p>
                  <p className="text-[10px] font-bold text-emerald-500 mt-0.5">{viewPerf ? `${viewPerf.qualificationRate}%` : '—'}</p>
                </div>
              </div>

              {viewPerf && (
                <div className="p-6 border border-slate-100 rounded-3xl">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest mb-4">30-Day Pipeline</h4>
                  <ul className="space-y-3">
                    <li className="flex items-center justify-between text-sm font-bold">
                      <span className="text-slate-500">Scans</span>
                      <span className="text-slate-900">{viewPerf.scans}</span>
                    </li>
                    <li className="flex items-center justify-between text-sm font-bold">
                      <span className="text-slate-500">Conversations</span>
                      <span className="text-slate-900">{viewPerf.conversations}</span>
                    </li>
                    <li className="flex items-center justify-between text-sm font-bold">
                      <span className="text-slate-500">Qualified Leads</span>
                      <span className="text-emerald-500">{viewPerf.qualifiedLeads}</span>
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TouchpointMatrix;
