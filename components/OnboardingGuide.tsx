
import React from 'react';
import { Bot, QrCode, MessageSquare, Zap, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';

const OnboardingGuide: React.FC = () => {
  const steps = [
    {
      title: "1. Provision Your Agent",
      description: "Define your agent's persona, industry, and knowledge base. This is the 'brain' that will handle your physical-world conversations.",
      icon: Bot,
      color: "bg-indigo-50 text-indigo-600",
      tab: "agents"
    },
    {
      title: "2. Generate Activation Nodes",
      description: "Create QR codes or NFC triggers for your physical assets—business cards, signs, or flyers. Link them to your trained agent.",
      icon: QrCode,
      color: "bg-emerald-50 text-emerald-600",
      tab: "touchpoints"
    },
    {
      title: "3. Real-World Engagement",
      description: "When a customer scans your touchpoint, the agent engages them instantly using Llama 3 AI. It qualifies them and captures their intent.",
      icon: MessageSquare,
      color: "bg-amber-50 text-amber-600",
      tab: "conversations"
    },
    {
      title: "4. Conversion & CRM Sync",
      description: "Qualified leads are automatically funneled into your CRM (HubSpot, etc.). You get notified, and the revenue cycle begins.",
      icon: Zap,
      color: "bg-rose-50 text-rose-600",
      tab: "settings"
    }
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-20">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 rounded-full text-indigo-600 text-xs font-bold uppercase tracking-widest">
          <Sparkles size={14} /> Getting Started
        </div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">Master the Logic Plane</h1>
        <p className="text-slate-500 font-medium max-w-xl mx-auto">
          Touchpoint AI converts physical surfaces into intelligent sales channels. Follow these steps to activate your infrastructure.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {steps.map((step, i) => (
          <div key={i} className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-xl transition-all group">
            <div className="flex items-start justify-between mb-6">
              <div className={`w-14 h-14 ${step.color} rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform`}>
                <step.icon size={28} />
              </div>
              <span className="text-4xl font-black text-slate-50 opacity-10 group-hover:opacity-20 transition-opacity">0{i+1}</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">{step.title}</h3>
            <p className="text-sm text-slate-500 leading-relaxed font-medium mb-6">{step.description}</p>
            <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-widest cursor-pointer hover:gap-3 transition-all">
              Go to Section <ArrowRight size={14} />
            </div>
          </div>
        ))}
      </div>

      <div className="bg-slate-900 p-10 rounded-[48px] text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 p-10 opacity-10 pointer-events-none">
          <ShieldCheck size={200} />
        </div>
        <div className="relative z-10 space-y-6">
          <h3 className="text-2xl font-bold">Pro-Tip: Multi-Node Strategy</h3>
          <p className="text-slate-400 text-sm leading-relaxed max-w-2xl font-medium">
            Don't just use one QR code. Deploy unique touchpoints for different locations (e.g., "Front Window" vs "Checkout Counter") to track exactly where your most valuable customers are coming from.
          </p>
          <div className="flex flex-wrap gap-4 pt-4">
            <div className="bg-white/10 px-6 py-3 rounded-2xl border border-white/10 text-xs font-bold">
               Groq Llama 3 Active
            </div>
            <div className="bg-white/10 px-6 py-3 rounded-2xl border border-white/10 text-xs font-bold">
               Paystack Ready
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingGuide;
