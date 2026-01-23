
import React, { useState } from 'react';
import { MessageSquare, ShieldCheck, FileText, Bot, Loader2, Globe } from 'lucide-react';
import { Conversation, Agent, SUPPORTED_LANGUAGES, SUPPORTED_CURRENCIES } from '../types';
import { simulateAgentConversation } from '../services/gemini';

interface Props {
  conversations: Conversation[];
  agents: Agent[];
  currentLanguage: string;
  currentCurrency: string;
}

const ConversationHub: React.FC<Props> = ({ conversations, agents, currentLanguage, currentCurrency }) => {
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null);
  const [testAgentId, setTestAgentId] = useState(agents[0]?.id || '');
  const [chatLog, setChatLog] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const langObj = SUPPORTED_LANGUAGES.find(l => l.code === currentLanguage) || SUPPORTED_LANGUAGES[0];
  const currObj = SUPPORTED_CURRENCIES.find(c => c.code === currentCurrency) || SUPPORTED_CURRENCIES[0];

  const handleSendMessage = async () => {
    if (!input.trim() || !testAgentId) return;
    
    const currentAgent = agents.find(a => a.id === testAgentId);
    if (!currentAgent) return;

    const userMsg = { role: 'user' as const, text: input };
    setChatLog(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // We pass the currency symbol to help the model quote correctly
      const inputWithCurrency = `${input} (Note: Please quote values in ${currObj.code} ${currObj.symbol} if relevant)`;
      
      const response = await simulateAgentConversation(
        { 
          name: currentAgent.name, 
          industry: currentAgent.industry, 
          voice: currentAgent.voice,
          catalog: currentAgent.serviceCatalog,
          documents: currentAgent.documents
        },
        chatLog,
        inputWithCurrency,
        currentLanguage
      );
      setChatLog(prev => [...prev, { role: 'model', text: response }]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-[calc(100vh-180px)]">
      {/* Test Sandbox */}
      <div className="lg:col-span-2 flex flex-col bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden animate-in fade-in slide-in-from-left-4 duration-500">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between glass sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
              <Bot size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Agent Testing Sandbox</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded-md text-[10px] font-bold uppercase">
                  <Globe size={10} />
                  {langObj.name} Mode
                </div>
                <div className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-md text-[10px] font-bold uppercase">
                  {currObj.code}
                </div>
              </div>
            </div>
          </div>
          <select 
            className="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-600 focus:ring-2 focus:ring-indigo-500 transition-all"
            value={testAgentId}
            onChange={e => setTestAgentId(e.target.value)}
          >
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-slate-50/20">
          {chatLog.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4 opacity-30">
              <div className="w-20 h-20 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center">
                <MessageSquare size={32} />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold uppercase tracking-widest">Awaiting interaction</p>
                <p className="text-xs mt-1">Chat in {langObj.name} to see the agent adapt.</p>
              </div>
            </div>
          )}
          {chatLog.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
              <div className={`max-w-[85%] p-5 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-indigo-600 text-white rounded-br-none shadow-xl shadow-indigo-100 font-medium' 
                  : 'bg-white border border-slate-100 text-slate-800 rounded-bl-none shadow-sm font-medium'
              }`}>
                {msg.text.split(' (Note: ')[0]} {/* Hide the currency prompt from UI */}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-100 p-5 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-3">
                <Loader2 size={16} className="text-indigo-600 animate-spin" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Agent is generating response...</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 bg-white">
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-500"></div>
            <div className="relative flex gap-3">
              <input 
                className="flex-1 px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-slate-700"
                placeholder={`Speak with the agent in ${langObj.name}...`}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
              />
              <button 
                onClick={handleSendMessage}
                disabled={loading || !input.trim() || !testAgentId}
                className="px-8 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Leads & Stats */}
      <div className="space-y-6">
        <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm animate-in fade-in slide-in-from-right-4 duration-500">
          <h4 className="font-bold text-lg text-slate-900 mb-6 flex items-center gap-2">
            <ShieldCheck className="text-emerald-500" size={24} />
            Qualified Leads
          </h4>
          <div className="space-y-4">
             {conversations.length === 0 ? (
               <div className="py-12 text-center text-slate-300">
                 <p className="text-xs font-bold uppercase tracking-widest italic">No physical reach detected</p>
               </div>
             ) : (
               conversations.map(c => (
                 <div key={c.id} className="p-4 border border-slate-50 bg-slate-50/50 rounded-2xl hover:bg-white hover:border-indigo-100 hover:shadow-lg transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-sm font-bold text-slate-900">{c.customerName}</p>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-tighter">Verified</span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mb-3 leading-relaxed">{c.lastMessage}</p>
                    <button className="text-[10px] font-bold text-indigo-600 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <FileText size={12}/> Generate Smart Proposal
                    </button>
                 </div>
               ))
             )}
          </div>
        </div>

        <div className="bg-slate-900 p-8 rounded-[40px] text-white relative overflow-hidden group shadow-2xl">
          <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:scale-110 transition-transform duration-700">
            <Globe size={120} className="text-indigo-500" />
          </div>
          <div className="relative z-10">
            <h4 className="font-bold text-lg mb-2">Global Performance</h4>
            <p className="text-xs text-indigo-200/70 font-medium mb-8">Real-time engagement optimization.</p>
            <div className="space-y-5">
               <div className="space-y-2">
                 <div className="flex justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-300">
                    <span>Language Accuracy</span>
                    <span>99.2%</span>
                 </div>
                 <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                    <div className="w-[99%] h-full bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
                 </div>
               </div>
               <div className="space-y-2">
                 <div className="flex justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                    <span>Handoff Success</span>
                    <span>94%</span>
                 </div>
                 <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                    <div className="w-[94%] h-full bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                 </div>
               </div>
            </div>
            <div className="mt-8 pt-8 border-t border-white/5 grid grid-cols-2 gap-4">
               <div>
                 <p className="text-2xl font-black text-indigo-400">12</p>
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Langs Supported</p>
               </div>
               <div>
                 <p className="text-2xl font-black text-emerald-400">1.2s</p>
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Transl. Latency</p>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConversationHub;
