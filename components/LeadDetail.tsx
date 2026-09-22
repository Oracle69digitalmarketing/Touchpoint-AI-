import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, Loader2, Phone, Mail, Target, User as UserIcon, RefreshCw, Send, History,
  Briefcase, Activity as ActivityIcon, AlertTriangle, UserCog, PenLine, Sparkles, CheckCircle2,
} from 'lucide-react';
import { Lead, LeadNote, LeadActivityEvent, CRMStatus, CRM_STATUSES, CRM_STATUS_LABELS } from '../types';
import { leadService } from '../services/leads';
import { useAuth } from './AuthGate';
import { crmStatusStyles, qualificationStatusStyles, formatLeadDate } from './LeadPipeline';

const ACTIVITY_LABELS: Record<string, string> = {
  lead_field_captured: 'Lead field captured',
  qualification_updated: 'Qualification updated',
  recommendation_made: 'Recommendation made',
  objection_detected: 'Objection detected',
  buying_signal_detected: 'Buying signal detected',
  handoff_offered: 'Handoff offered',
  handoff_started: 'Handoff started',
  quote_requested: 'Quote requested',
  booking_started: 'Booking started',
  demo_requested: 'Demo requested',
  purchase_started: 'Purchase started',
  order_created: 'Order created',
  order_item_added: 'Order item added',
  payment_started: 'Payment started',
  payment_verified: 'Payment verified',
  payment_failed: 'Payment failed',
  order_fulfillment_started: 'Fulfilment started',
  order_fulfilled: 'Order fulfilled',
  order_cancelled: 'Order cancelled',
  booking_reserved: 'Booking reserved',
  booking_confirmed: 'Booking confirmed',
  booking_cancelled: 'Booking cancelled',
  booking_rescheduled: 'Booking rescheduled',
  booking_no_show: 'Booking no-show',
  booking_completed: 'Booking completed',
  booking_expired: 'Booking expired',
};

const activityLabel = (type: string): string =>
  ACTIVITY_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const shortId = (id: string | null | undefined): string | null =>
  id ? `#${id.slice(0, 8)}` : null;

interface Props {
  leadId: string;
  onClose: () => void;
  onLeadUpdated: (lead: Lead) => void;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
    <div className="text-sm font-medium text-slate-800">{children}</div>
  </div>
);

const LeadDetail: React.FC<Props> = ({ leadId, onClose, onLeadUpdated }) => {
  const { user } = useAuth();

  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<LeadNote[] | null>(null);
  const [activity, setActivity] = useState<LeadActivityEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [freshLead, freshNotes, freshActivity] = await Promise.all([
        leadService.get(leadId),
        leadService.listNotes(leadId),
        leadService.listActivity(leadId),
      ]);
      setLead(freshLead);
      setNotes(freshNotes);
      setActivity(freshActivity);
    } catch (err: any) {
      setLoadError(err.message || 'Could not load this lead. It may have been removed.');
      setLead(null);
      setNotes(null);
      setActivity(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const changeCrmStatus = async (next: CRMStatus) => {
    if (!lead || next === lead.crmStatus) return;
    setStatusSaving(true);
    setStatusError(null);
    try {
      const updated = await leadService.updateCrmStatus(leadId, next);
      setLead(updated);
      onLeadUpdated(updated);
    } catch (err: any) {
      setStatusError(err.message || 'Could not update CRM status.');
    } finally {
      setStatusSaving(false);
    }
  };

  const changeAssignment = async (value: string) => {
    if (!lead) return;
    setAssignmentSaving(true);
    setAssignmentError(null);
    try {
      const updated = await leadService.updateAssignment(leadId, value === '' ? null : value);
      setLead(updated);
      onLeadUpdated(updated);
    } catch (err: any) {
      setAssignmentError(err.message || 'Could not update assignment.');
    } finally {
      setAssignmentSaving(false);
    }
  };

  const addNote = async () => {
    const body = noteText.trim();
    if (!body) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const note = await leadService.createNote(leadId, body);
      setNotes((prev) => [note, ...(prev || [])]);
      setNoteText('');
    } catch (err: any) {
      setNoteError(err.message || 'Could not save the note.');
    } finally {
      setNoteSaving(false);
    }
  };

  const authorLabel = (note: LeadNote): string => {
    if (note.authorUserId === null) return 'AI / System';
    if (note.authorUserId === user.id) return user.name;
    return 'Team member';
  };

  // Assignment options come from the authenticated session user (the only
  // same-workspace identity the existing auth infrastructure exposes), plus the
  // lead's current assignee when it differs so the control never shows a
  // phantom value. The backend rejects any user outside this workspace.
  const assignedUserOptions = React.useMemo(() => {
    const options: { id: string; label: string }[] = [{ id: user.id, label: `${user.name} (me)` }];
    const current = lead?.assignedUser;
    if (current && current.id !== user.id) {
      options.push({ id: current.id, label: `${current.name} (current)` });
    }
    return options;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.assignedUser, user.id, user.name]);

  if (loading && !lead) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto custom-scrollbar">
        <div className="min-h-full flex flex-col items-center justify-center gap-4 text-slate-400">
          <Loader2 size={28} className="text-indigo-600 animate-spin" />
          <p className="text-xs font-bold uppercase tracking-widest">Loading lead…</p>
        </div>
      </div>
    );
  }

  if (loadError && !lead) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto custom-scrollbar">
        <div className="min-h-full flex flex-col items-center justify-center gap-5 px-6">
          <div className="w-16 h-16 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center">
            <AlertTriangle size={28} />
          </div>
          <div className="text-center max-w-md">
            <p className="text-sm font-bold text-slate-700">{loadError}</p>
            <p className="text-xs font-bold text-slate-400 mt-2 uppercase tracking-widest">
              The lead may have been removed, or your session may have expired.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all"
            >
              <RefreshCw size={14} /> Retry
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all"
            >
              <ArrowLeft size={14} /> Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!lead) return null;

  const cs = crmStatusStyles[lead.crmStatus] || crmStatusStyles.new;
  const qs = qualificationStatusStyles[lead.qualificationStatus] || qualificationStatusStyles.pending;

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto custom-scrollbar">
      <div className="p-6 lg:p-10 max-w-6xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4 duration-500 fill-mode-both">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
          >
            <ArrowLeft size={15} /> Back
          </button>
          <div className="flex items-center gap-3">
            {lead.assignedUser && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full text-[10px] font-bold uppercase tracking-tighter">
                <UserIcon size={12} /> {lead.assignedUser.name}
              </span>
            )}
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-tighter ${cs.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cs.dot}`}></span>
              {CRM_STATUS_LABELS[lead.crmStatus] || lead.crmStatus}
            </span>
          </div>
        </div>

        {/* Identity hero */}
        <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">{lead.name || 'Anonymous lead'}</h2>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                {lead.source === 'auto' ? 'Conversation extraction' : 'Manual entry'}
                {lead.customerName ? ` · customer: ${lead.customerName}` : ''}
                {lead.channel ? ` · channel: ${lead.channel}` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Captured</p>
              <p className="text-sm font-bold text-slate-700 mt-0.5">{formatLeadDate(lead.createdAt)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-6 pt-6 border-t border-slate-100">
            <Field label="Phone">
              <span className="inline-flex items-center gap-1.5">
                <Phone size={13} className="text-indigo-400" /> {lead.phone || '—'}
              </span>
            </Field>
            <Field label="Email">
              <span className="inline-flex items-center gap-1.5 break-all">
                <Mail size={13} className="text-indigo-400" /> {lead.email || '—'}
              </span>
            </Field>
            <Field label="Source">
              <span className="inline-flex items-center gap-1.5">
                <Target size={13} className="text-indigo-400" />
                {lead.source === 'auto' ? 'Auto' : 'Manual'}
              </span>
            </Field>
            <Field label="Touchpoint">
              {lead.touchpointName || '—'}{lead.agentName ? <span className="text-slate-400"> · {lead.agentName}</span> : ''}
            </Field>
            <Field label="Conversations">{lead.conversationCount}</Field>
            <Field label="Last interaction">{formatLeadDate(lead.lastInteraction)}</Field>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: sales context */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-8">
              <div className="flex items-center gap-2 mb-6">
                <Sparkles size={18} className="text-indigo-500" />
                <h3 className="font-black text-slate-900">Sales Context</h3>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-auto">AI-derived · read-only</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Field label="Qualification">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-tighter flex items-center gap-1 ${qs.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${qs.dot}`}></span>
                      {qs.label}
                    </span>
                    <span className="text-xs font-black text-slate-500">Score {lead.qualificationScore}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2">
                    <div className={`h-full rounded-full ${qs.bar}`} style={{ width: `${Math.max(2, Math.min(100, lead.qualificationScore))}%` }}></div>
                  </div>
                </Field>
                <Field label="Sales stage">
                  {lead.salesStage ? (
                    <span className="inline-flex items-center gap-1.5 capitalize">
                      <Briefcase size={13} className="text-indigo-400" /> {lead.salesStage.replace(/_/g, ' ')}
                    </span>
                  ) : '—'}
                </Field>
                <Field label="Intent">
                  <p className="leading-relaxed">{lead.conversationIntent || lead.intent || '—'}</p>
                </Field>
                <Field label="Customer need">
                  <p className="leading-relaxed">{lead.customerNeed || '—'}</p>
                </Field>
                <Field label="Recommended product">
                  {lead.recommendedProduct ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Target size={13} className="text-emerald-500" /> {lead.recommendedProduct.name}
                    </span>
                  ) : '—'}
                </Field>
                <Field label="Buying signal">
                  {lead.buyingSignal === null || lead.buyingSignal === undefined ? (
                    '—'
                  ) : lead.buyingSignal ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-600">
                      <CheckCircle2 size={13} /> Yes
                    </span>
                  ) : (
                    <span className="text-slate-400">No</span>
                  )}
                </Field>
                <Field label="Objection">
                  <p className="leading-relaxed">{lead.objection || '—'}</p>
                </Field>
                <Field label="Next best action">
                  <p className="leading-relaxed">{lead.nextBestAction || '—'}</p>
                </Field>
              </div>
            </div>
          </div>

          {/* Right: CRM controls */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-8">
              <div className="flex items-center gap-2 mb-6">
                <UserCog size={18} className="text-indigo-500" />
                <h3 className="font-black text-slate-900">CRM Controls</h3>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    CRM status
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      className="flex-1 text-sm px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
                      value={lead.crmStatus}
                      disabled={statusSaving}
                      onChange={(e) => changeCrmStatus(e.target.value as CRMStatus)}
                    >
                      {CRM_STATUSES.map((s) => (
                        <option key={s} value={s}>{CRM_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                    {statusSaving && <Loader2 size={16} className="text-indigo-500 animate-spin shrink-0" />}
                  </div>
                  {statusError && <p className="text-[10px] font-bold text-rose-500 mt-2">{statusError}</p>}
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    Assigned user
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      className="flex-1 text-sm px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
                      value={lead.assignedUser?.id ?? ''}
                      disabled={assignmentSaving}
                      onChange={(e) => changeAssignment(e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {assignedUserOptions.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                    {assignmentSaving && <Loader2 size={16} className="text-indigo-500 animate-spin shrink-0" />}
                  </div>
                  {assignmentError && <p className="text-[10px] font-bold text-rose-500 mt-2">{assignmentError}</p>}
                  <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest">
                    Assignment is validated server-side against this workspace.
                  </p>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-8">
              <div className="flex items-center gap-2 mb-5">
                <PenLine size={18} className="text-indigo-500" />
                <h3 className="font-black text-slate-900">Notes</h3>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-auto">Newest first</span>
              </div>

              <div className="flex gap-2 mb-5">
                <textarea
                  className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-slate-700 resize-none"
                  placeholder="Add a follow-up note… (created as a human note by you)"
                  rows={3}
                  value={noteText}
                  maxLength={5000}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <button
                  type="button"
                  onClick={addNote}
                  disabled={noteSaving || !noteText.trim()}
                  className="self-end inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {noteSaving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Save
                </button>
              </div>
              {noteError && <p className="text-[10px] font-bold text-rose-500 mb-3">{noteError}</p>}

              <div className="space-y-3 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                {notes === null ? (
                  <Loader2 size={16} className="text-indigo-500 animate-spin" />
                ) : notes.length === 0 ? (
                  <p className="text-center py-8 text-xs font-bold text-slate-300 italic uppercase tracking-widest">No notes yet</p>
                ) : (
                  notes.map((note) => (
                    <div key={note.id} className="p-4 bg-slate-50/60 border border-slate-50 rounded-2xl">
                      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{note.body}</p>
                      <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-slate-100/70">
                        <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-tighter">{authorLabel(note)}</span>
                        <span className="text-[10px] font-bold text-slate-400">{formatLeadDate(note.createdAt)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Activity timeline */}
        <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-8">
          <div className="flex items-center gap-2 mb-6">
            <ActivityIcon size={18} className="text-indigo-500" />
            <h3 className="font-black text-slate-900">CRM Activity</h3>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-auto">From the backend funnel timeline</span>
          </div>

          {activity === null ? (
            <Loader2 size={16} className="text-indigo-500 animate-spin" />
          ) : activity.length === 0 ? (
            <div className="text-center py-10">
              <History size={32} className="mx-auto text-slate-200 mb-3" />
              <p className="text-xs font-bold text-slate-300 italic uppercase tracking-widest">No CRM activity recorded yet</p>
            </div>
          ) : (
            <div className="space-y-1">
              {[...activity]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((event) => {
                  const linked = [shortId(event.conversationId), shortId(event.orderId), shortId(event.leadId)]
                    .map((v) => (v ? `${v}` : ''))
                    .filter(Boolean);
                  const meta = event.meta && typeof event.meta === 'object' ? event.meta : null;
                  return (
                    <div key={event.id} className="relative pl-10 py-3">
                      <span className="absolute left-3 top-4 w-2.5 h-2.5 rounded-full bg-indigo-400 ring-4 ring-indigo-50"></span>
                      <span className="absolute left-[17px] top-[30px] bottom-[-12px] w-px bg-slate-100"></span>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <p className="text-sm font-bold text-slate-800">{activityLabel(event.eventType)}</p>
                        <p className="text-[10px] font-bold text-slate-400">{formatLeadDate(event.createdAt)}</p>
                      </div>
                      {meta && Object.keys(meta).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {Object.entries(meta).map(([k, v]) => (
                            <span key={k} className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded-full px-2 py-0.5">
                              {k}: {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                      {linked.length > 0 && (
                        <p className="text-[10px] font-bold text-slate-400 mt-1">
                          Linked: {linked.join(' · ')}
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeadDetail;