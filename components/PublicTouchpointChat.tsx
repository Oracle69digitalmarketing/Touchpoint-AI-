
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Send, Loader2, ShieldCheck, MapPin, User, Globe, MessageSquare, XCircle } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '../types';

/**
 * PUBLIC CUSTOMER-FACING TOUCHPOINT CHAT
 *
 * Rendered by t.tsx inside dist/t.html. The Express server resolves the
 * tracking id, records the scan, and injects a __TOUCHPOINT_DATA__ payload
 * into the #touchpoint-data script tag before serving the page — so no
 * authentication is needed and the payload never leaks to a different tenant.
 */

interface PublicTouchpointInfo {
  status: 'active' | 'inactive' | 'not_found';
  trackingId?: string;
  touchpoint?: { name: string; type: string; location: string };
  agent?: { name: string; status: string; industry: string; voice: string };
  business?: { name: string };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  createdAt?: string;
}

const readEmbeddedData = (): PublicTouchpointInfo | null => {
  const node = document.getElementById('touchpoint-data');
  if (!node) return null;
  try {
    const parsed = JSON.parse(node.textContent || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
};

const trackingIdFromPath = (): string => {
  const match = window.location.pathname.match(/^\/t\/([^/]+)$/);
  return match ? match[1] : '';
};

const PublicTouchpointChat: React.FC = () => {
  const trackingId = trackingIdFromPath();
  const initial = useRef<PublicTouchpointInfo | null>(readEmbeddedData());

  const [customerName, setCustomerName] = useState(() =>
    localStorage.getItem(`touchpoint.name.${trackingId}`) || ''
  );
  const [targetLanguage, setTargetLanguage] = useState(() =>
    localStorage.getItem(`touchpoint.lang.${trackingId}`) || 'en'
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(() =>
    localStorage.getItem(`touchpoint.conversation.${trackingId}`)
  );
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const info = initial.current;
  const active = !!info && info.status === 'active';

  const persistKey = (value: string | null) => {
    if (value) localStorage.setItem(`touchpoint.conversation.${trackingId}`, value);
    else localStorage.removeItem(`touchpoint.conversation.${trackingId}`);
  };

  // Restore a prior conversation so a returning customer can resume.
  useEffect(() => {
    if (!active || !trackingId) return;
    let cancelled = false;
    const restore = async () => {
      setLoading(true);
      const storedId = localStorage.getItem(`touchpoint.conversation.${trackingId}`);
      if (!storedId) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/v1/t/${encodeURIComponent(trackingId)}/messages?conversationId=${encodeURIComponent(storedId)}`);
        if (res.status === 404) {
          persistKey(null);
          setConversationId(null);
        } else if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setMessages((data.messages || []).map((m: ChatMessage) => m));
            setConversationId(data.conversationId);
          }
        }
      } catch (err) {
        console.error('[Touchpoint Chat] Failed to restore conversation:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    restore();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, trackingId]);

  // Keep the message list pinned to the latest bubble.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !active) return;

    const optimistic: ChatMessage = { role: 'user', text };
    setMessages(prev => [...prev, optimistic]);
    setInput('');
    setSending(true);
    setError(null);

    if (customerName.trim()) {
      localStorage.setItem(`touchpoint.name.${trackingId}`, customerName.trim());
    }
    localStorage.setItem(`touchpoint.lang.${trackingId}`, targetLanguage);

    try {
      const res = await fetch(`/v1/t/${encodeURIComponent(trackingId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          customerName: customerName.trim() || undefined,
          targetLanguage,
          conversationId: conversationId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not send your message.');
        setMessages(prev => prev.filter(m => m !== optimistic));
        return;
      }
      persistKey(data.conversationId);
      setConversationId(data.conversationId);
      setMessages((data.messages || []).map((m: ChatMessage) => m));
    } catch (err) {
      console.error('[Touchpoint Chat] Send failed:', err);
      setError('Could not reach the agent. Please try again.');
      setMessages(prev => prev.filter(m => m !== optimistic));
    } finally {
      setSending(false);
    }
  }, [input, sending, active, customerName, targetLanguage, conversationId, trackingId]);

  const langObj = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage) || SUPPORTED_LANGUAGES[0];

  if (!info) {
    return (
      <Shell>
        <MessageScreen icon={<XCircle size={40} className="text-rose-400" />} title="Touchpoint unavailable" subtitle="This page could not be loaded. Please try again." />
      </Shell>
    );
  }

  if (info.status === 'not_found') {
    return (
      <Shell>
        <MessageScreen icon={<MessageSquare size={40} className="text-slate-300" />} title="Link not recognized" subtitle="This touchpoint does not exist or has been removed." />
      </Shell>
    );
  }

  if (info.status === 'inactive' || !info.touchpoint || !info.agent || !info.business) {
    return (
      <Shell>
        <MessageScreen icon={<ShieldCheck size={40} className="text-amber-400" />} title="No longer active" subtitle="This touchpoint has been deactivated by its owner." />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="w-full max-w-2xl mx-auto h-[100dvh] flex flex-col bg-white border border-slate-100 shadow-xl shadow-slate-200/60">
        {/* Header */}
        <header className="p-5 border-b border-slate-100 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-t-2xl">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-900/40">
                <Bot size={22} />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 border-2 border-slate-900 rounded-full"></span>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-black text-lg tracking-tight truncate">{info.agent.name}</h1>
              <p className="text-[11px] text-slate-300 font-semibold flex items-center gap-1.5">
                {info.business.name} · {info.touchpoint.type}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Online</span>
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-300">
                <Globe size={11} />
                <select
                  value={targetLanguage}
                  onChange={e => setTargetLanguage(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-1.5 py-0.5 text-[10px] font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.code.toUpperCase()}</option>)}
                </select>
              </div>
            </div>
          </div>
          {info.touchpoint.location && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400 font-semibold">
              <MapPin size={12} /> {info.touchpoint.location}
            </div>
          )}
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4 bg-slate-50/60">
          {!customerName.trim() && (
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <User size={16} className="text-slate-400 shrink-0" />
              <input
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="Your name (optional)"
                maxLength={120}
                className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-700 placeholder:text-slate-400"
              />
            </div>
          )}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-100 p-5 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-3">
                <Loader2 size={16} className="text-indigo-600 animate-spin" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading conversation...</span>
              </div>
            </div>
          )}

          {!loading && messages.length === 0 && (
            <div className="py-10 flex flex-col items-center justify-center text-center text-slate-400 space-y-3 opacity-70">
              <div className="w-16 h-16 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                <MessageSquare size={26} className="text-indigo-500" />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-widest">How can I help?</p>
                <p className="text-xs font-semibold mt-1">Say hello to {info.agent.name} — I respond instantly.</p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
              <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-none shadow-lg shadow-indigo-100 font-medium'
                  : 'bg-white border border-slate-100 text-slate-800 rounded-bl-none shadow-sm font-medium'
              }`}>
                {msg.text}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-100 p-5 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-3">
                <Loader2 size={16} className="text-indigo-600 animate-spin" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{info.agent.name} is typing...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-bold">
              {error}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="p-4 border-t border-slate-100 bg-white rounded-b-2xl">
          <div className="flex gap-3 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder={`Message in ${langObj.name}...`}
              className="flex-1 resize-none px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-slate-700"
            />
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 disabled:opacity-40 shrink-0"
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-400 font-semibold flex items-center gap-1.5">
            <ShieldCheck size={11} /> Secure · Powered by {info.business.name} · Responding in {langObj.nativeName}
          </p>
        </div>
      </div>
    </Shell>
  );
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-[100dvh] bg-slate-50 flex items-stretch justify-center p-0 sm:p-6">
    {children}
  </div>
);

const MessageScreen: React.FC<{ icon: React.ReactNode; title: string; subtitle: string }> = ({ icon, title, subtitle }) => (
  <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/60 p-12 flex flex-col items-center justify-center text-center gap-4">
    {icon}
    <div>
      <h1 className="text-lg font-black text-slate-900">{title}</h1>
      <p className="text-sm font-medium text-slate-500 mt-1">{subtitle}</p>
    </div>
  </div>
);

export default PublicTouchpointChat;
