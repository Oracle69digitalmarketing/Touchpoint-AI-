
import React, { useState } from 'react';
import { Smartphone, Download, Copy, QrCode, Rocket, Info, Loader2 } from 'lucide-react';
import { SurfaceType, Agent, Touchpoint } from '../types';
import QRCode from 'qrcode';

interface Props {
  agents: Agent[];
  onDeploy: (tp: Touchpoint) => void;
}

const SurfaceGenerator: React.FC<Props> = ({ agents, onDeploy }) => {
  const [type, setType] = useState<SurfaceType>(SurfaceType.BUSINESS_CARD);
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id || '');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<{qr: string, url: string} | null>(null);

  const generate = async () => {
    if (!selectedAgentId || !name) return;
    setIsGenerating(true);
    
    try {
      const trackingId = `TX-${Math.floor(Math.random() * 9000) + 1000}`;
      const url = `https://touchpoint.ai/active/${trackingId}`;
      
      // LOCAL GENERATION: No tracking URL ever leaves the client.
      // Generates a high-quality Base64 Data URI.
      const qrBase64 = await QRCode.toDataURL(url, {
        width: 600,
        margin: 2,
        color: {
          dark: '#0f172a', // slate-900
          light: '#ffffff',
        },
      });

      setResult({
        qr: qrBase64,
        url: url
      });
    } catch (err) {
      console.error("QR Generation Error:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeploy = () => {
    if (!result) return;
    const newTp: Touchpoint = {
      id: Math.random().toString(36).substr(2, 9),
      name: name || 'New Surface',
      type,
      agentId: selectedAgentId,
      scans: 0,
      active: true,
      location: location || 'Unknown',
      trackingId: result.url.split('/').pop() || ''
    };
    onDeploy(newTp);
  };

  const downloadQR = () => {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.qr;
    link.download = `touchpoint-${name.toLowerCase().replace(/\s+/g, '-')}.png`;
    link.click();
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-indigo-100 text-indigo-600 rounded-2xl">
          <QrCode size={24} />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Surface Generator</h2>
          <p className="text-sm text-slate-500">Provision smart triggers for your physical environments.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm space-y-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">1. Name & Placement</label>
              <div className="grid grid-cols-2 gap-4">
                <input 
                  className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm" 
                  placeholder="Surface Name (e.g. Lobby Sign)" 
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
                <input 
                  className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm" 
                  placeholder="Location (City/Building)" 
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">2. Touchpoint Hardware</label>
              <select 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                value={type}
                onChange={e => setType(e.target.value as SurfaceType)}
              >
                {Object.values(SurfaceType).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">3. Assign Intelligence</label>
              <select 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                value={selectedAgentId}
                onChange={e => setSelectedAgentId(e.target.value)}
              >
                {agents.length === 0 ? <option disabled>No trained agents available</option> : agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          <button 
            onClick={generate}
            disabled={isGenerating || !name || agents.length === 0}
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 disabled:opacity-30 flex items-center justify-center gap-2"
          >
            {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Rocket size={18} />}
            {isGenerating ? 'Compiling Local Asset...' : 'Generate Touchpoint Assets'}
          </button>
        </div>

        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm flex flex-col items-center justify-center min-h-[440px]">
          {result ? (
            <div className="w-full space-y-8 animate-in zoom-in duration-300">
               <div className="relative group">
                 <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-3xl blur opacity-25 group-hover:opacity-40 transition duration-1000"></div>
                 <div className="relative p-6 bg-white border border-slate-100 rounded-3xl shadow-inner mx-auto w-fit">
                    <img src={result.qr} alt="QR Result" className="w-48 h-48" />
                 </div>
               </div>

               <div className="space-y-4">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                      <Info size={10} /> Privacy-Locked Tracking Link
                    </p>
                    <p className="text-sm font-mono truncate text-indigo-600">{result.url}</p>
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={downloadQR}
                      className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-all"
                    >
                      <Download size={16}/> PNG
                    </button>
                    <button 
                      onClick={handleDeploy}
                      className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-all"
                    >
                      <Rocket size={16}/> Activate Live
                    </button>
                  </div>
               </div>
            </div>
          ) : (
            <div className="text-center text-slate-300 max-w-xs">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-slate-100">
                <Smartphone size={40} className="opacity-20" />
              </div>
              <p className="font-bold text-slate-500 mb-2">Asset Preview Ready</p>
              <p className="text-sm font-medium">Link an AI agent to a physical surface to generate your conversion triggers.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SurfaceGenerator;
