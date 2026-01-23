
import React, { useState, useRef } from 'react';
import { Bot, FileText, Users, Award, Mic, CheckCircle, ArrowRight, Sparkles, Upload, X, File, Loader2, Zap } from 'lucide-react';
import { AgentStatus } from '../types';

interface WizardProps {
  onComplete: (data: any) => void;
  onCancel: () => void;
}

const STEPS = [
  { id: 'basic', title: 'Basic Info', icon: Bot },
  { id: 'services', title: 'Services', icon: FileText },
  { id: 'clients', title: 'Clients', icon: Users },
  { id: 'success', title: 'Success Stories', icon: Award },
  { id: 'voice', title: 'Brand Voice', icon: Mic },
  { id: 'review', title: 'Review', icon: CheckCircle },
];

const AgentTrainingWizard: React.FC<WizardProps> = ({ onComplete, onCancel }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isTraining, setIsTraining] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    industry: 'Real Estate',
    description: '',
    serviceCatalog: '',
    clientProfiles: '',
    caseLibrary: '',
    voice: 'professional',
    guidelines: '',
    documents: [] as string[]
  });

  const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 0));

  const handleFinish = () => {
    setIsTraining(true);
    setTimeout(() => {
      onComplete({
        ...formData,
        id: Math.random().toString(36).substr(2, 9),
        status: AgentStatus.ACTIVE,
        leadsGenerated: 0,
        conversionRate: 0
      });
      setIsTraining(false);
    }, 2500);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setIsUploading(true);
      // Simulate intelligence extraction
      setTimeout(() => {
        // Fix for TypeScript error: Property 'name' does not exist on type 'unknown'
        // Added explicit type annotation to ensure the 'name' property is accessible on File objects.
        const newFileNames = Array.from(files).map((f: any) => f.name);
        setFormData(prev => ({
          ...prev,
          documents: [...prev.documents, ...newFileNames]
        }));
        setIsUploading(false);
      }, 1500);
    }
  };

  const removeDocument = (name: string) => {
    setFormData(prev => ({
      ...prev,
      documents: prev.documents.filter(d => d !== name)
    }));
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Agent Name</label>
              <input 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" 
                placeholder="e.g., Luxury Property Concierge"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Industry</label>
              <select 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                value={formData.industry}
                onChange={e => setFormData({...formData, industry: e.target.value})}
              >
                <option>Real Estate</option>
                <option>Retail</option>
                <option>Consulting</option>
                <option>Finance</option>
                <option>Technology</option>
                <option>Healthcare</option>
              </select>
            </div>
          </div>
        );
      case 1:
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
             <div>
               <div className="flex justify-between items-end mb-2">
                 <label className="block text-sm font-bold text-slate-700">Service Catalog & Knowledge Base</label>
                 <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-bold text-indigo-600 flex items-center gap-1 hover:text-indigo-700 transition-colors"
                 >
                   <Upload size={14} /> Upload Business Docs
                 </button>
                 <input 
                   type="file" 
                   ref={fileInputRef} 
                   className="hidden" 
                   multiple 
                   accept=".pdf,.doc,.docx,.txt"
                   onChange={handleFileUpload} 
                 />
               </div>
               <textarea 
                 className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none h-32 font-mono text-sm"
                 placeholder="List your products, prices, and value propositions..."
                 value={formData.serviceCatalog}
                 onChange={e => setFormData({...formData, serviceCatalog: e.target.value})}
               />
             </div>

             {/* Document Uploads Section */}
             <div className="space-y-3">
               <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                 Intelligence Sources {formData.documents.length > 0 && `(${formData.documents.length})`}
               </h4>
               {isUploading && (
                 <div className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-100 rounded-xl animate-pulse">
                   <Loader2 size={16} className="text-indigo-600 animate-spin" />
                   <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Extracting Intelligence...</span>
                 </div>
               )}
               <div className="grid grid-cols-1 gap-2">
                 {formData.documents.length === 0 && !isUploading && (
                   <p className="text-xs text-slate-400 italic">Optional: Upload PDFs or Word docs to give the agent deeper knowledge.</p>
                 )}
                 {formData.documents.map(doc => (
                   <div key={doc} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl shadow-sm">
                     <div className="flex items-center gap-2">
                       <File size={16} className="text-slate-400" />
                       <span className="text-sm font-medium text-slate-700 truncate max-w-[200px]">{doc}</span>
                     </div>
                     <button onClick={() => removeDocument(doc)} className="text-slate-300 hover:text-red-500 transition-colors">
                       <X size={16} />
                     </button>
                   </div>
                 ))}
               </div>
             </div>

             <div className="flex items-center gap-2 p-4 bg-blue-50 text-blue-700 rounded-2xl text-xs">
                <Sparkles size={16} className="flex-shrink-0" />
                <span>Tip: Agents with custom documents show 40% higher lead qualification accuracy.</span>
             </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
             <label className="block text-sm font-bold text-slate-700 mb-2">Target Client Profiles</label>
             <textarea 
               className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none h-40"
               placeholder="Who are your ideal customers? What are their pain points?"
               value={formData.clientProfiles}
               onChange={e => setFormData({...formData, clientProfiles: e.target.value})}
             />
          </div>
        );
      case 3:
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
             <label className="block text-sm font-bold text-slate-700 mb-2">Success Stories</label>
             <textarea 
               className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none h-40"
               placeholder="Share specific outcomes you've achieved for clients..."
               value={formData.caseLibrary}
               onChange={e => setFormData({...formData, caseLibrary: e.target.value})}
             />
          </div>
        );
      case 4:
        return (
          <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-4">
            {['professional', 'casual', 'technical', 'enthusiastic'].map(v => (
              <button
                key={v}
                onClick={() => setFormData({...formData, voice: v})}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  formData.voice === v ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <p className="font-bold capitalize mb-1">{v}</p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {v === 'professional' && 'Polished, authoritative tone.'}
                  {v === 'casual' && 'Friendly, conversational style.'}
                  {v === 'technical' && 'Precise and detail-oriented.'}
                  {v === 'enthusiastic' && 'Energetic and supportive.'}
                </p>
              </button>
            ))}
          </div>
        );
      case 5:
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-slate-50 p-6 rounded-[32px] border border-slate-100">
               <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Training Blueprint</h4>
               <ul className="space-y-3 text-sm text-slate-600">
                  <li className="flex justify-between border-b border-slate-200/50 pb-2"><span>Agent Name:</span> <span className="font-bold text-slate-900">{formData.name || 'Unnamed Agent'}</span></li>
                  <li className="flex justify-between border-b border-slate-200/50 pb-2"><span>Market Sector:</span> <span className="font-bold text-slate-900">{formData.industry}</span></li>
                  <li className="flex justify-between border-b border-slate-200/50 pb-2"><span>Voice Profile:</span> <span className="font-bold text-slate-900 capitalize">{formData.voice}</span></li>
                  <li className="flex justify-between"><span>Intelligence Docs:</span> <span className="font-bold text-indigo-600">{formData.documents.length} Files</span></li>
               </ul>
            </div>
            <div className="p-5 bg-emerald-50 text-emerald-700 rounded-3xl border border-emerald-100 text-sm flex gap-3">
               <Zap className="flex-shrink-0" size={20} />
               <p className="leading-relaxed font-medium">Ready to deploy. Your agent will leverage the <strong>Gemini 3 Pro</strong> reasoning engine to represent your business 24/7.</p>
            </div>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-6">
      <div className="bg-white w-full max-w-2xl rounded-[48px] overflow-hidden shadow-2xl flex flex-col h-full max-h-[85vh] animate-in zoom-in duration-300">
        <div className="p-10 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Agent Training</h2>
            <p className="text-slate-500 font-medium mt-1">Provisioning intelligence layer for your workforce</p>
          </div>
          <button onClick={onCancel} className="p-3 hover:bg-slate-50 rounded-2xl text-slate-400 hover:text-slate-900 transition-all"><X size={24} /></button>
        </div>

        <div className="flex-1 p-10 overflow-y-auto custom-scrollbar">
          <div className="flex justify-between mb-12 relative">
            <div className="absolute top-5 left-0 right-0 h-0.5 bg-slate-100 -z-10"></div>
            {STEPS.map((step, idx) => (
              <div key={step.id} className="flex flex-col items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 border-4 ${
                  idx === currentStep ? 'bg-indigo-600 text-white border-indigo-100 shadow-lg shadow-indigo-100' : 
                  idx < currentStep ? 'bg-emerald-500 text-white border-emerald-100' : 'bg-white text-slate-300 border-slate-50'
                }`}>
                  {idx < currentStep ? <CheckCircle size={18} /> : <step.icon size={18} />}
                </div>
              </div>
            ))}
          </div>

          <div className="min-h-[300px]">
            {renderStepContent()}
          </div>
        </div>

        <div className="p-10 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
          <button 
            disabled={currentStep === 0 || isTraining}
            onClick={prevStep}
            className="px-8 py-3 text-slate-500 font-bold hover:text-slate-900 disabled:opacity-30 transition-all"
          >
            Back
          </button>
          
          <div className="flex gap-4">
            {currentStep < STEPS.length - 1 ? (
              <button 
                onClick={nextStep}
                disabled={currentStep === 0 && !formData.name}
                className="flex items-center gap-2 px-10 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 disabled:opacity-50"
              >
                Continue
                <ArrowRight size={18} />
              </button>
            ) : (
              <button 
                onClick={handleFinish}
                disabled={isTraining}
                className="flex items-center gap-2 px-10 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 disabled:opacity-50"
              >
                {isTraining ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                {isTraining ? 'Deploying...' : 'Finalize & Deploy'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentTrainingWizard;
