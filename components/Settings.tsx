
import React, { useState } from 'react';
import { Globe, Shield, CreditCard, Trash2, Check, Loader2, X, AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';
import { SUPPORTED_LANGUAGES, CRMConnection, SubscriptionPlan, PLAN_LIMITS } from '../types';

interface Props {
  currentLanguage: string;
  onLanguageChange: (lang: string) => void;
  currentCurrency: string;
  onCurrencyChange: (currency: string) => void;
  crms: CRMConnection[];
  onConnectCRM: (id: string) => void;
  onDisconnectCRM: (id: string) => void;
  subscription: SubscriptionPlan;
  setSubscription: (plan: SubscriptionPlan) => void;
}

const Settings: React.FC<Props> = ({ 
  currentLanguage, 
  onLanguageChange,
  currentCurrency,
  onCurrencyChange,
  crms,
  onConnectCRM,
  onDisconnectCRM,
  subscription,
  setSubscription
}) => {
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteKeyword, setDeleteKeyword] = useState('');

  // Identity Verification State
  const [banks, setBanks] = useState<{name: string, code: string}[]>([]);
  const [accountNumber, setAccountNumber] = useState('');
  const [selectedBank, setSelectedBank] = useState('');
  const [resolvingAccount, setResolvingAccount] = useState(false);
  const [verifiedData, setVerifiedData] = useState<{account_name: string} | null>(null);

  const fetchBanks = async () => {
    try {
      const res = await fetch(`${window.location.origin.includes('localhost:3000') ? 'http://localhost:3001/v1' : '/v1'}/identity/banks`);
      const data = await res.json();
      if (data.status) setBanks(data.data);
    } catch (e) { console.error("Bank fetch failed"); }
  };

  const handleVerifyAccount = async () => {
    if (!accountNumber || !selectedBank) return;
    setResolvingAccount(true);
    setVerifiedData(null);
    try {
      const res = await fetch(`${window.location.origin.includes('localhost:3000') ? 'http://localhost:3001/v1' : '/v1'}/identity/resolve-account?account_number=${accountNumber}&bank_code=${selectedBank}`);
      const data = await res.json();
      if (data.status) setVerifiedData(data.data);
      else alert(data.message || "Could not verify account");
    } catch (e) { alert("Verification failed"); }
    setResolvingAccount(false);
  };

  const plans = Object.keys(PLAN_LIMITS).map(key => {
    const planKey = key as SubscriptionPlan;
    const plan = PLAN_LIMITS[planKey];
    const isUSD = currentCurrency === 'USD';
    const priceValue = isUSD ? plan.price.USD : plan.price.NGN;
    const priceLabel = priceValue === -1 ? 'Custom' : isUSD ? `$${priceValue}` : `₦${priceValue.toLocaleString()}`;

    return {
      name: planKey,
      price: priceLabel,
      amount: priceValue,
      features: plan.features
    };
  });

  const handlePaystackPayment = (planName: SubscriptionPlan, amount: number) => {
    if (amount === -1) {
      // Redirect to WhatsApp for Enterprise leads
      const phoneNumber = "2348000000000"; // REPLACE WITH YOUR REAL NUMBER
      const message = `Hi, I am interested in the Enterprise plan for Touchpoint AI. Please provide more details on White-label and NFC orchestration.`;
      window.open(`https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`, '_blank');
      return;
    }

    if (amount <= 0) {
      setSubscription(planName);
      setIsSubModalOpen(false);
      return;
    }

    const handler = (window as any).PaystackPop.setup({
      key: (import.meta as any).env.VITE_PAYSTACK_PUBLIC_KEY || process.env.PAYSTACK_PUBLIC_KEY,
      email: 'customer@example.com', // In a real app, use the logged-in user's email
      amount: amount * 100, // Paystack expects amount in kobo or cents
      currency: currentCurrency === 'NGN' ? 'NGN' : 'USD',
      callback: (response: any) => {
        console.log('Payment successful', response);
        setSubscription(planName);
        setIsSubModalOpen(false);
        alert(`Success! You have been upgraded to the ${planName} tier.`);
      },
      onClose: () => {
        console.log('Window closed');
      }
    });
    handler.openIframe();
  };

  const handleCrmClick = (crm: CRMConnection) => {
    if (crm.status === 'connected') {
      if (confirm(`Disconnect from ${crm.name}?`)) {
        onDisconnectCRM(crm.id);
      }
    } else {
      onConnectCRM(crm.id);
    }
  };

  const handleDeleteOrganization = () => {
    if (deleteKeyword === 'DELETE') {
      alert('System purge initiated. Redirecting to home.');
      window.location.reload();
    }
  };

  return (
    <div className="max-w-5xl space-y-10 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight text-gradient">System Configuration</h1>
        <p className="text-slate-500 font-medium">Provision nodes and manage global representation logic.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-8">
          {/* CRM Section */}
          <section className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                <Shield size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Active CRM Connectors</h3>
                <p className="text-sm text-slate-500 font-medium">Sync leads from the physical world to your digital stack.</p>
              </div>
            </div>
            
            <div className="space-y-3">
              {subscription === 'Free' && (
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-amber-700 text-xs font-bold mb-4 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  CRM Sync requires a Professional or Enterprise subscription.
                </div>
              )}
              {crms.map((crm) => (
                <div key={crm.id} className="flex items-center justify-between p-5 border border-slate-50 rounded-[24px] hover:bg-slate-50 transition-colors group">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-white border border-slate-100 rounded-xl flex items-center justify-center text-xl shadow-sm">
                      {crm.icon}
                    </div>
                    <div>
                      <span className="font-bold text-slate-800 text-sm block">{crm.name}</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {crm.status === 'connected' ? `Authenticated • ${crm.lastSync}` : 'Cloud Integration'}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCrmClick(crm)}
                    disabled={crm.status === 'connecting'}
                    className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                      crm.status === 'connected' 
                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                        : crm.status === 'connecting'
                        ? 'bg-slate-100 text-slate-400 cursor-wait'
                        : 'bg-slate-900 text-white shadow-xl shadow-slate-200 hover:scale-105 active:scale-95'
                    }`}
                  >
                    {crm.status === 'connecting' && <Loader2 size={12} className="animate-spin" />}
                    {crm.status === 'connected' ? 'Link Active' : crm.status === 'connecting' ? 'Handshaking...' : 'Configure Link'}
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Identity Verification Section */}
          <section className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                <ShieldCheck size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Trust & Identity</h3>
                <p className="text-sm text-slate-500 font-medium">Verify your business identity to unlock higher infrastructure limits.</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Select Institution</label>
                  <select 
                    onFocus={fetchBanks}
                    onChange={(e) => setSelectedBank(e.target.value)}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 appearance-none"
                  >
                    <option value="">Choose Bank...</option>
                    {banks.map(bank => (
                      <option key={bank.code} value={bank.code}>{bank.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Account Number</label>
                  <input 
                    type="text" 
                    maxLength={10}
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="0123456789"
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                  />
                </div>
              </div>

              {verifiedData ? (
                <div className="p-6 bg-emerald-50 border border-emerald-100 rounded-[32px] flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-lg">
                      <Check size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Identity Verified</p>
                      <p className="text-sm font-black text-slate-900">{verifiedData.account_name}</p>
                    </div>
                  </div>
                  <button onClick={() => setVerifiedData(null)} className="text-[10px] font-bold text-slate-400 uppercase hover:text-slate-600 transition-colors">Reset</button>
                </div>
              ) : (
                <button 
                  onClick={handleVerifyAccount}
                  disabled={resolvingAccount || !accountNumber || !selectedBank}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {resolvingAccount ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                  Verify Business Identity
                </button>
              )}
            </div>
          </section>

          {/* Regional Section */}
          <section className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
              <Globe size={180} />
            </div>
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                <Globe size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Global Localization</h3>
                <p className="text-sm text-slate-500 font-medium">Control the core reasoning language of your workforce.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {SUPPORTED_LANGUAGES.slice(0, 9).map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => onLanguageChange(lang.code)}
                  className={`flex items-center gap-3 p-4 rounded-2xl border transition-all ${
                    currentLanguage === lang.code 
                    ? 'border-indigo-600 bg-indigo-50/50 shadow-sm ring-2 ring-indigo-100' 
                    : 'border-slate-100 hover:border-indigo-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-xl">{lang.flag}</span>
                  <span className={`font-bold text-xs ${currentLanguage === lang.code ? 'text-indigo-600' : 'text-slate-600'}`}>
                    {lang.name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
               <CreditCard size={20} className="text-slate-400" />
               <h3 className="text-sm font-bold text-slate-900 uppercase tracking-[0.2em]">Subscription</h3>
            </div>
            <div className="p-6 bg-slate-900 rounded-3xl text-white mb-6">
               <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Active Tier</p>
               <h4 className="text-2xl font-black mb-4">{subscription}</h4>
               <ul className="space-y-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <li className="flex justify-between"><span>Agents</span> <span className="text-white">{PLAN_LIMITS[subscription].agents}</span></li>
                  <li className="flex justify-between"><span>Nodes</span> <span className="text-white">{PLAN_LIMITS[subscription].touchpoints}</span></li>
               </ul>
            </div>
            <button 
              onClick={() => setIsSubModalOpen(true)}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-95"
            >
               Manage Plan
            </button>
          </section>

          <section className="bg-rose-50/30 p-8 rounded-[40px] border border-rose-100">
            <div className="flex items-center gap-3 mb-4 text-rose-600">
               <Trash2 size={20} />
               <h3 className="text-sm font-bold uppercase tracking-[0.2em]">Danger Zone</h3>
            </div>
            <button 
              onClick={() => setIsDeleteConfirmOpen(true)}
              className="w-full py-3 bg-white text-rose-600 rounded-xl font-bold border border-rose-100 hover:bg-rose-600 hover:text-white transition-all active:scale-95"
            >
               Purge Data
            </button>
          </section>
        </div>
      </div>

      {/* MODALS */}
      {isSubModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-4xl rounded-[48px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Infrastructure Pricing</h2>
                <p className="text-sm text-slate-500 font-medium">Select a plan to increase your node and agent capacity.</p>
              </div>
              <button onClick={() => setIsSubModalOpen(false)} className="p-3 hover:bg-slate-50 rounded-full transition-colors">
                <X size={24} className="text-slate-400" />
              </button>
            </div>
            <div className="p-10 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {plans.map((plan) => (
                  <div key={plan.name} className={`p-8 rounded-[32px] border transition-all flex flex-col ${
                    subscription === plan.name 
                      ? 'border-indigo-600 bg-indigo-50/50 ring-4 ring-indigo-50 shadow-xl' 
                      : 'border-slate-100 bg-slate-50 hover:border-indigo-200'
                  }`}>
                    <div className="mb-6 text-center">
                      <h4 className="text-xl font-bold text-slate-900">{plan.name}</h4>
                      <p className="text-2xl font-black text-indigo-600 mt-2">{plan.price}</p>
                    </div>
                    <ul className="space-y-3 flex-1 mb-8">
                      {plan.features.map(f => (
                        <li key={f} className="text-xs font-medium text-slate-600 flex items-center gap-2">
                          <Check size={14} className="text-emerald-500" /> {f}
                        </li>
                      ))}
                    </ul>
                    <button 
                      onClick={() => handlePaystackPayment(plan.name, plan.amount)}
                      disabled={subscription === plan.name}
                      className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
                        subscription === plan.name 
                          ? 'bg-indigo-600 text-white shadow-lg' 
                          : 'bg-white border border-slate-200 text-slate-900 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      {subscription === plan.name ? 'Current Active Plan' : plan.amount === -1 ? 'Contact Sales' : `Upgrade to ${plan.name}`}
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-10 p-6 bg-slate-50 rounded-[32px] border border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400">
                    <CreditCard size={24} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Secure Billing via Paystack</p>
                    <p className="text-xs text-slate-400">Payment methods are encrypted and handled securely in Nigeria.</p>
                  </div>
                </div>
                <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-xs font-bold text-indigo-600 flex items-center gap-1 hover:underline">
                  Billing Docs <ExternalLink size={14} />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[40px] shadow-2xl p-10 animate-in zoom-in duration-300">
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-rose-50 text-rose-600 rounded-3xl flex items-center justify-center mb-6">
                <AlertTriangle size={40} />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-2">Purge Infrastructure?</h3>
              <p className="text-sm text-slate-500 font-medium mb-8 leading-relaxed">
                Type "DELETE" to confirm the removal of all agents, touchpoints, and lead data.
              </p>
              <input 
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-rose-500 text-center font-black tracking-[0.5em] mb-8"
                placeholder="••••••"
                value={deleteKeyword}
                onChange={e => setDeleteKeyword(e.target.value.toUpperCase())}
              />
              <div className="grid grid-cols-2 gap-4 w-full">
                <button onClick={() => setIsDeleteConfirmOpen(false)} className="py-4 bg-slate-100 rounded-2xl font-bold text-slate-600">Cancel</button>
                <button onClick={handleDeleteOrganization} disabled={deleteKeyword !== 'DELETE'}
                  className="py-4 bg-rose-600 text-white rounded-2xl font-bold disabled:opacity-30">
                  Confirm Purge
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
