import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle, Check, CalendarClock } from 'lucide-react';
import { BOOKING_CONFIG_CONSTRAINTS, BookingConfig, defaultBookingTimezone } from '../types';
import { bookingConfigService } from '../services/products';

interface Props {
  productId: string;
  productName: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface FormState {
  timezone: string;
  slotDurationMinutes: string;
  capacity: string;
  bufferMinutes: string;
  minAdvanceHours: string;
  maxAdvanceDays: string;
  holdMinutes: string;
  autoConfirm: boolean;
  requiresPayment: boolean;
}

const toForm = (config: BookingConfig): FormState => ({
  timezone: config.timezone || defaultBookingTimezone(),
  slotDurationMinutes: String(config.slotDurationMinutes),
  capacity: String(config.capacity),
  bufferMinutes: String(config.bufferMinutes),
  minAdvanceHours: String(config.minAdvanceHours),
  maxAdvanceDays: String(config.maxAdvanceDays),
  holdMinutes: String(config.holdMinutes),
  autoConfirm: config.autoConfirm,
  requiresPayment: config.requiresPayment,
});

const emptyForm = (): FormState => ({
  timezone: defaultBookingTimezone(),
  slotDurationMinutes: '30',
  capacity: '1',
  bufferMinutes: '0',
  minAdvanceHours: '1',
  maxAdvanceDays: '90',
  holdMinutes: '15',
  autoConfirm: true,
  requiresPayment: false,
});

const BookingConfigModal: React.FC<Props> = ({ productId, productName, onClose, onSaved }) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const config = await bookingConfigService.get(productId);
        if (!cancelled) {
          if (config) setForm(toForm(config));
          else setForm(emptyForm());
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || 'Could not load the booking configuration.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [productId]);

  const intField = (value: string, min: number, max: number): { ok: boolean; n: number } => {
    const n = Number(value);
    if (value.trim() === '' || !Number.isInteger(n) || n < min || n > max) return { ok: false, n };
    return { ok: true, n };
  };

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    const c = BOOKING_CONFIG_CONSTRAINTS;
    if (!form.timezone.trim()) errs.timezone = 'Timezone is required';
    const slot = intField(form.slotDurationMinutes, c.slotDurationMinutes.min, c.slotDurationMinutes.max);
    if (!slot.ok) errs.slotDurationMinutes = `Slot duration must be an integer between ${c.slotDurationMinutes.min} and ${c.slotDurationMinutes.max} minutes`;
    const cap = intField(form.capacity, c.capacity.min, c.capacity.max);
    if (!cap.ok) errs.capacity = `Capacity must be an integer between ${c.capacity.min} and ${c.capacity.max}`;
    const buf = intField(form.bufferMinutes, c.bufferMinutes.min, c.bufferMinutes.max);
    if (!buf.ok) errs.bufferMinutes = `Buffer must be an integer between ${c.bufferMinutes.min} and ${c.bufferMinutes.max} minutes`;
    const minA = intField(form.minAdvanceHours, c.minAdvanceHours.min, c.minAdvanceHours.max);
    if (!minA.ok) errs.minAdvanceHours = `Minimum advance must be an integer between ${c.minAdvanceHours.min} and ${c.minAdvanceHours.max} hours`;
    const maxA = intField(form.maxAdvanceDays, c.maxAdvanceDays.min, c.maxAdvanceDays.max);
    if (!maxA.ok) errs.maxAdvanceDays = `Maximum advance must be an integer between ${c.maxAdvanceDays.min} and ${c.maxAdvanceDays.max} days`;
    const hold = intField(form.holdMinutes, c.holdMinutes.min, c.holdMinutes.max);
    if (!hold.ok) errs.holdMinutes = `Hold duration must be an integer between ${c.holdMinutes.min} and ${c.holdMinutes.max} minutes`;
    return errs;
  };

  const handleSave = async () => {
    if (saving) return;
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      await bookingConfigService.save(productId, {
        timezone: form.timezone.trim(),
        slotDurationMinutes: Number(form.slotDurationMinutes),
        capacity: Number(form.capacity),
        bufferMinutes: Number(form.bufferMinutes),
        minAdvanceHours: Number(form.minAdvanceHours),
        maxAdvanceDays: Number(form.maxAdvanceDays),
        holdMinutes: Number(form.holdMinutes),
        autoConfirm: form.autoConfirm,
        requiresPayment: form.requiresPayment,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      if (onSaved) onSaved();
    } catch (err: any) {
      if (err instanceof Error && 'fields' in err && (err as any).fields) {
        setFieldErrors((err as any).fields);
      }
      setSaveError(err?.message || 'Could not save the booking configuration.');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof FormState) =>
    fieldErrors[key] ? <p className="px-1 text-xs font-bold text-rose-600">{fieldErrors[key]}</p> : null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="p-8 pb-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Booking Configuration</h2>
              <p className="text-sm text-slate-500 font-medium mt-1">{productName}</p>
            </div>
            <button onClick={onClose} className="p-3 hover:bg-slate-50 rounded-full transition-colors">
              <X size={22} className="text-slate-400" />
            </button>
          </div>
        </div>

        <div className="p-8 overflow-y-auto custom-scrollbar space-y-5">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-center">
              <Loader2 size={28} className="animate-spin text-indigo-600 mb-4" />
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading booking policy…</p>
            </div>
          ) : loadError ? (
            <div className="px-6 py-14 flex flex-col items-center justify-center text-center">
              <AlertTriangle size={28} className="text-rose-500 mb-4" />
              <p className="text-sm font-bold text-rose-600 mb-6">{loadError}</p>
              <button onClick={onClose} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all">
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs font-bold text-indigo-700 flex items-start gap-2">
                <CalendarClock size={16} className="shrink-0 mt-0.5" />
                Controls the slot grid, capacity, advance windows, hold time, payment requirement and auto-confirmation.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Timezone *</label>
                  <input
                    value={form.timezone}
                    onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                    placeholder="Africa/Lagos"
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                  />
                  {field('timezone')}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Slot Duration (minutes)</label>
                  <input
                    inputMode="numeric"
                    value={form.slotDurationMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, slotDurationMinutes: e.target.value }))}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                  />
                  {field('slotDurationMinutes')}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Capacity per slot</label>
                  <input
                    inputMode="numeric"
                    value={form.capacity}
                    onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                  />
                  {field('capacity')}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Buffer between slots (minutes)</label>
                  <input
                    inputMode="numeric"
                    value={form.bufferMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, bufferMinutes: e.target.value }))}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                  />
                  {field('bufferMinutes')}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Minimum advance (hours)</label>
                  <input
                    inputMode="numeric"
                    value={form.minAdvanceHours}
                    onChange={(e) => setForm((f) => ({ ...f, minAdvanceHours: e.target.value }))}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                  />
                  {field('minAdvanceHours')}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Maximum advance (days)</label>
                  <input
                    inputMode="numeric"
                    value={form.maxAdvanceDays}
                    onChange={(e) => setForm((f) => ({ ...f, maxAdvanceDays: e.target.value }))}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                  />
                  {field('maxAdvanceDays')}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Hold duration (minutes)</label>
                  <input
                    inputMode="numeric"
                    value={form.holdMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, holdMinutes: e.target.value }))}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                  />
                  {field('holdMinutes')}
                </div>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, autoConfirm: !f.autoConfirm }))}
                  className="w-full flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100"
                >
                  <div className="text-left">
                    <p className="text-sm font-bold text-slate-700">Auto-confirm</p>
                    <p className="text-xs text-slate-400 font-medium">Confirm reservations immediately.</p>
                  </div>
                  <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${form.autoConfirm ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.autoConfirm ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, requiresPayment: !f.requiresPayment }))}
                  className="w-full flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100"
                >
                  <div className="text-left">
                    <p className="text-sm font-bold text-slate-700">Require payment</p>
                    <p className="text-xs text-slate-400 font-medium">Require payment for the booking to be honored.</p>
                  </div>
                  <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${form.requiresPayment ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.requiresPayment ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </span>
                </button>
              </div>

              {saveError && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-700 text-xs font-bold flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {saveError}
                </div>
              )}
              {saved && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-700 text-xs font-bold flex items-center gap-2">
                  <Check size={14} /> Booking configuration saved.
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-2">
                <button onClick={onClose} disabled={saving} className="py-4 bg-slate-100 rounded-2xl font-bold text-slate-600 hover:bg-slate-200 transition-all disabled:opacity-50">
                  Close
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving && <Loader2 size={16} className="animate-spin" />}
                  Save Configuration
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookingConfigModal;