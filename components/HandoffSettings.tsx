import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertTriangle, Check, RefreshCw, MessageCircle, Phone, Mail, Link2 } from 'lucide-react';
import { HandoffSettings } from '../types';
import { handoffService } from '../services/products';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const empty: HandoffSettings = { whatsapp: '', phone: '', email: '', bookingUrl: '' };

const HandoffSettingsSection: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<HandoffSettings>(empty);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const current = await handoffService.get();
      setForm({
        whatsapp: current.whatsapp ?? '',
        phone: current.phone ?? '',
        email: current.email ?? '',
        bookingUrl: current.bookingUrl ?? '',
      });
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load handoff settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (form.whatsapp.trim() && form.whatsapp.trim().length > 60) errs.whatsapp = 'WhatsApp destination must be 60 characters or fewer';
    if (form.phone.trim() && form.phone.trim().length > 60) errs.phone = 'Phone must be 60 characters or fewer';
    if (form.email.trim() && form.email.trim().length > 254) errs.email = 'Email must be 254 characters or fewer';
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) errs.email = 'Email must be a valid email address';
    if (form.bookingUrl.trim() && form.bookingUrl.trim().length > 1000) errs.bookingUrl = 'Booking URL must be 1000 characters or fewer';
    return errs;
  };

  const handleSave = async () => {
    if (saving || loadError) return;
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      const result = await handoffService.update({
        whatsapp: form.whatsapp.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim().toLowerCase() || null,
        bookingUrl: form.bookingUrl.trim() || null,
      });
      setForm({
        whatsapp: result.whatsapp ?? '',
        phone: result.phone ?? '',
        email: result.email ?? '',
        bookingUrl: result.bookingUrl ?? '',
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      if (err instanceof Error && 'fields' in err && (err as any).fields) {
        setFieldErrors((err as any).fields);
      }
      setSaveError(err?.message || 'Could not save handoff settings.');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof HandoffSettings) =>
    fieldErrors[key] ? <p className="px-1 text-xs font-bold text-rose-600">{fieldErrors[key]}</p> : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Business & Handoff</h2>
          <p className="text-sm text-slate-500 font-medium">The only channels your AI workforce may offer as a real next step.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || loading || !!loadError}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          Save Handoff Settings
        </button>
      </div>

      {loadError && (
        <div className="p-5 bg-rose-50 border border-rose-100 rounded-[24px] text-rose-700 text-sm font-bold flex items-start gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}
      {saveError && (
        <div className="p-5 bg-rose-50 border border-rose-100 rounded-[24px] text-rose-700 text-sm font-bold flex items-start gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>{saveError}</span>
        </div>
      )}
      {saved && (
        <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-[24px] text-emerald-700 text-sm font-bold flex items-center gap-3">
          <Check size={18} className="shrink-0" />
          <span>Handoff settings saved.</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-100 rounded-[40px] p-16 flex flex-col items-center justify-center text-center">
          <Loader2 size={32} className="animate-spin text-indigo-600 mb-4" />
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading handoff settings…</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-[40px] p-8 space-y-6">
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold text-slate-500 flex items-start gap-2">
            <RefreshCw size={16} className="shrink-0 mt-0.5" />
            Leave a field empty to hide that channel from customers entirely.
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-1.5">
              <MessageCircle size={12} /> WhatsApp Destination
            </label>
            <input
              value={form.whatsapp}
              onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
              disabled={!!loadError}
              placeholder="e.g. 234 812 3456 789 or https://wa.me/2348123456789"
              className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 disabled:opacity-50"
            />
            {field('whatsapp')}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-1.5">
              <Phone size={12} /> Phone
            </label>
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              disabled={!!loadError}
              placeholder="e.g. +234 812 3456 789"
              className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 disabled:opacity-50"
            />
            {field('phone')}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-1.5">
              <Mail size={12} /> Email
            </label>
            <input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              disabled={!!loadError}
              placeholder="e.g. hello@yourbusiness.com"
              className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 disabled:opacity-50"
            />
            {field('email')}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-1.5">
              <Link2 size={12} /> Booking URL
            </label>
            <input
              value={form.bookingUrl}
              onChange={(e) => setForm((f) => ({ ...f, bookingUrl: e.target.value }))}
              disabled={!!loadError}
              placeholder="https://cal.com/your-business"
              className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 disabled:opacity-50"
            />
            {field('bookingUrl')}
          </div>
        </div>
      )}
    </div>
  );
};

export default HandoffSettingsSection;