
import React, { useState } from 'react';
import { LayoutDashboard, Bot, QrCode, MessageSquare, Settings as SettingsIcon, Bell, ChevronDown, Coins, HelpCircle, LogOut, CheckCheck, User } from 'lucide-react';
import { SUPPORTED_LANGUAGES, SUPPORTED_CURRENCIES, SubscriptionPlan, PLAN_LIMITS, LeadNotification } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentLanguage: string;
  onLanguageChange: (lang: string) => void;
  currentCurrency: string;
  onCurrencyChange: (currency: string) => void;
  subscription: SubscriptionPlan;
  usage: { agents: number; touchpoints: number };
  notifications: LeadNotification[];
  unreadNotifications: number;
  onReadNotifications: () => void;
  businessName: string;
  onLogout: () => void;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  activeTab, 
  setActiveTab, 
  currentLanguage, 
  onLanguageChange,
  currentCurrency,
  onCurrencyChange,
  subscription,
  usage,
  notifications = [],
  unreadNotifications = 0,
  onReadNotifications,
  businessName,
  onLogout
}) => {
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [isCurrencyMenuOpen, setIsCurrencyMenuOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  
  const navItems = [
    { id: 'dashboard', label: 'Pulse', icon: LayoutDashboard },
    { id: 'agents', label: 'Agents', icon: Bot },
    { id: 'touchpoints', label: 'Matrix', icon: QrCode },
    { id: 'conversations', label: 'Sales', icon: MessageSquare },
    { id: 'onboarding', label: 'Guide', icon: HelpCircle },
    { id: 'settings', label: 'Config', icon: SettingsIcon },
  ];

  const currentLangObj = SUPPORTED_LANGUAGES.find(l => l.code === currentLanguage) || SUPPORTED_LANGUAGES[0];
  const currentCurrObj = SUPPORTED_CURRENCIES.find(c => c.code === currentCurrency) || SUPPORTED_CURRENCIES[0];

  const limits = PLAN_LIMITS[subscription];
  const agentUsagePercent = (usage.agents / limits.agents) * 100;

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans">
      {/* DESKTOP SIDEBAR */}
      <aside className="w-64 bg-white border-r border-slate-200 hidden lg:flex flex-col sticky top-0 h-screen z-40">
        <div className="p-8 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-100">T</div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Touchpoint</h1>
            <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mt-1">Infrastructure</p>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto custom-scrollbar pt-8">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-sm font-bold transition-all duration-300 relative group ${
                activeTab === item.id
                  ? 'bg-slate-900 text-white shadow-xl shadow-slate-200'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <item.icon size={20} className={activeTab === item.id ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-600'} />
              {item.label}
              {activeTab === item.id && (
                <div className="absolute right-3 w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></div>
              )}
            </button>
          ))}
        </nav>

        <div className="p-6 border-t border-slate-100">
          <div className="p-5 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-3xl text-white shadow-2xl shadow-indigo-100 relative overflow-hidden group cursor-pointer" onClick={() => setActiveTab('settings')}>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-1">Scale Tier</p>
            <p className="text-sm font-bold mb-4">{subscription}</p>
            <div className="w-full bg-white/20 h-1.5 rounded-full mb-2">
              <div 
                className="bg-white h-full rounded-full transition-all duration-1000" 
                style={{ width: `${Math.min(agentUsagePercent, 100)}%` }}
              ></div>
            </div>
            <p className="text-[10px] font-medium opacity-90">{usage.agents} / {limits.agents} Active Agents</p>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 pb-24 lg:pb-0">
        <header className="h-20 bg-white/80 backdrop-blur-xl border-b border-slate-200 px-6 lg:px-10 flex items-center justify-between sticky top-0 z-30">
          <div className="lg:hidden flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-xs font-bold">T</div>
            <span className="font-black text-slate-900 tracking-tight">Touchpoint AI</span>
          </div>
          
          <div className="hidden lg:block">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">
              Node Control & Logic Plane
            </h2>
            <p className="text-sm font-black text-slate-900 tracking-tight mt-0.5">{businessName}</p>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {/* In-app notifications for newly qualified leads */}
            <div className="relative">
              <button
                onClick={() => { setIsNotifOpen(!isNotifOpen); setIsCurrencyMenuOpen(false); setIsLangMenuOpen(false); }}
                title="New qualified leads"
                className="relative w-10 h-10 rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all flex items-center justify-center"
              >
                <Bell size={16} />
                {unreadNotifications > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-white">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </button>
              {isNotifOpen && (
                <div className="absolute right-0 mt-3 w-80 bg-white border border-slate-100 rounded-[32px] shadow-2xl py-3 z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">New Qualified Leads</p>
                    <button
                      onClick={() => { onReadNotifications(); setIsNotifOpen(false); }}
                      disabled={unreadNotifications === 0}
                      className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <CheckCheck size={12} /> Mark read
                    </button>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="px-5 py-8 text-center text-xs font-bold text-slate-300 italic">No qualified leads yet</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto custom-scrollbar">
                      {notifications.slice(0, 20).map(n => (
                        <button
                          key={n.id}
                          onClick={() => setActiveTab('conversations')}
                          className={`w-full text-left px-5 py-3 hover:bg-slate-50 transition-colors border-t border-slate-50 ${n.readAt ? 'opacity-50' : ''}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                              <User size={14} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-900 truncate">{n.leadName || 'Anonymous lead'}</p>
                              <p className="text-[10px] font-bold text-slate-400 truncate">
                                {n.phone || n.email || 'No contact'} · Score {n.qualificationScore}
                              </p>
                            </div>
                            {!n.readAt && <span className="w-2 h-2 bg-emerald-500 rounded-full shrink-0"></span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => { setIsCurrencyMenuOpen(!isCurrencyMenuOpen); setIsLangMenuOpen(false); }}
                className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-2xl">
                <Coins size={16} className="text-slate-400" />
                <span className="text-xs font-bold text-slate-700">{currentCurrObj.symbol} {currentCurrObj.code}</span>
              </button>
              {isCurrencyMenuOpen && (
                <div className="absolute right-0 mt-3 w-56 bg-white border border-slate-100 rounded-[32px] shadow-2xl py-3 z-50">
                  {SUPPORTED_CURRENCIES.map(curr => (
                    <button key={curr.code} onClick={() => { onCurrencyChange(curr.code); setIsCurrencyMenuOpen(false); }}
                      className="w-full px-4 py-3 text-left text-xs font-bold hover:bg-slate-50 transition-colors">
                      {curr.name} ({curr.symbol})
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="w-10 h-10 bg-indigo-50 rounded-2xl overflow-hidden shadow-sm border-2 border-white">
              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=Oracle`} alt="Avatar" />
            </div>
            <button
              onClick={onLogout}
              title="Sign out"
              className="w-10 h-10 rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 hover:text-rose-600 hover:border-rose-200 transition-all flex items-center justify-center"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <div className="p-6 lg:p-12 max-w-[1600px] mx-auto w-full">{children}</div>
      </main>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-2xl border-t border-slate-200 px-4 py-3 flex justify-around items-center z-50 pb-safe">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center gap-1 transition-all duration-300 ${
              activeTab === item.id ? 'text-indigo-600' : 'text-slate-400'
            }`}
          >
            <item.icon size={20} className={activeTab === item.id ? 'animate-bounce' : ''} />
            <span className="text-[10px] font-black uppercase tracking-tighter">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

export default Layout;
