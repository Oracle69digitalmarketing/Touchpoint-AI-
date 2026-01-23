
import React, { useState } from 'react';
import { Agent, AgentStatus } from '../types';
import { Bot, Plus, Zap, Target, BarChart3, ChevronRight, X } from 'lucide-react';

interface Props {
  agents: Agent[];
  onOpenWizard: () => void;
  onNavigate: (tab: string) => void;
}

const AgentManager: React.FC<Props> = ({ agents, onOpenWizard, onNavigate }) => {
  const [selectedAgentStats, setSelectedAgentStats] = useState<Agent | null>(null);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight text-gradient">AI Sales Workforce</h1>
          <p className="text-slate-500 font-medium">Your specialized agents trained on your unique business intelligence.</p>
        </div>
        <button 
          onClick={onOpenWizard}
          className="flex items-center gap-2 px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 group"
        >
          <Plus size={20} className="group-hover:rotate-90 transition-transform" />
          Deploy New Agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-[40px] p-20 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mb-6">
            <Bot size={40} />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">No active agents deployed</h3>
          <p className="text-slate-500 max-w-sm mb-8">Train your first AI agent by providing your service catalog and business documents.</p>
          <button 
            onClick={onOpenWizard}
            className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg active:scale-95"
          >
            Start Training Wizard
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => (
            <div key={agent.id} className="group bg-white border border-slate-100 rounded-[32px] p-8 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="flex items-start justify-between mb-8">
                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl group-hover:bg-indigo-50 transition-colors">
                  {agent.voice === 'professional' ? '👔' : agent.voice === 'casual' ? '☕' : '💻'}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    agent.status === AgentStatus.ACTIVE ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {agent.status}
                  </span>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{agent.industry}</p>
                </div>
              </div>
              
              <h3 className="text-xl font-bold text-slate-900 mb-2">{agent.name}</h3>
              <p className="text-sm text-slate-500 line-clamp-2 mb-8 leading-relaxed">
                {agent.description || `Specialized in converting ${agent.industry} interest into sales.`}
              </p>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-50">
                  <div className="flex items-center gap-2 text-slate-400 mb-1">
                    <Target size={12} />
                    <span className="text-[10px] uppercase font-bold">Leads</span>
                  </div>
                  <p className="text-xl font-bold text-slate-900">{agent.leadsGenerated}</p>
                </div>
                <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-50">
                  <div className="flex items-center gap-2 text-slate-400 mb-1">
                    <Zap size={12} />
                    <span className="text-[10px] uppercase font-bold">Conv.</span>
                  </div>
                  <p className="text-xl font-bold text-slate-900">{agent.conversionRate}%</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => onNavigate('dashboard')}
                  className="flex-1 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-50 flex items-center justify-center gap-2"
                >
                  Control View <ChevronRight size={14}/>
                </button>
                <button 
                  onClick={() => setSelectedAgentStats(agent)}
                  className="px-4 py-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
                >
                  <BarChart3 size={18} />
                </button>
              </div>
            </div>
          ))}
          
          <button 
            onClick={onOpenWizard}
            className="border-2 border-dashed border-slate-200 rounded-[32px] p-8 flex flex-col items-center justify-center text-slate-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all group"
          >
            <div className="w-14 h-14 rounded-full border-2 border-current flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Plus size={24} />
            </div>
            <p className="font-bold">Add Custom Agent</p>
          </button>
        </div>
      )}

      {/* QUICK STATS MODAL */}
      {selectedAgentStats && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl p-10 animate-in zoom-in duration-300">
            <div className="flex justify-between items-start mb-8">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-2xl">
                  {selectedAgentStats.voice === 'professional' ? '👔' : '☕'}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{selectedAgentStats.name}</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{selectedAgentStats.industry} Specialist</p>
                </div>
              </div>
              <button onClick={() => setSelectedAgentStats(null)} className="p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            <div className="space-y-6">
               <div className="grid grid-cols-2 gap-4">
                 <div className="p-5 bg-slate-50 rounded-3xl border border-slate-100">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">Qual. Velocity</p>
                    <p className="text-2xl font-black text-slate-900">High</p>
                 </div>
                 <div className="p-5 bg-indigo-50 rounded-3xl border border-indigo-100">
                    <p className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.2em] mb-1">Active Nodes</p>
                    <p className="text-2xl font-black text-indigo-600">3</p>
                 </div>
               </div>
               <div className="p-6 border border-slate-100 rounded-3xl">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest mb-4">Engagement Insights</h4>
                  <ul className="space-y-3">
                    <li className="flex items-center justify-between text-sm font-bold">
                      <span className="text-slate-500">Avg. Discovery Time</span>
                      <span className="text-slate-900">1.4m</span>
                    </li>
                    <li className="flex items-center justify-between text-sm font-bold">
                      <span className="text-slate-500">Qualified Leads (24H)</span>
                      <span className="text-emerald-500">+12</span>
                    </li>
                    <li className="flex items-center justify-between text-sm font-bold">
                      <span className="text-slate-500">Error Rate</span>
                      <span className="text-slate-900">0.02%</span>
                    </li>
                  </ul>
               </div>
               <button 
                onClick={() => { setSelectedAgentStats(null); onNavigate('dashboard'); }}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl active:scale-95"
               >
                 View Full Analytics
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentManager;
