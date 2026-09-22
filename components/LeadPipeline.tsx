import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, Filter, X, RefreshCw, Loader2, Phone, Mail, User as UserIcon, Users, Target,
  ChevronLeft, ChevronRight, Inbox, Clock, Sparkles,
} from 'lucide-react';
import { Lead, LeadPage, CRMStatus, CRM_STATUSES, CRM_STATUS_LABELS, LeadQualificationStatus } from '../types';
import { leadService } from '../services/leads';
import { useAuth } from './AuthGate';

const PAGE_SIZE = 50;

/**
 * Display styling for operator CRM statuses. Persisted backend values are
 * untouched (see CRM_STATUSES); these classes are presentation only.
 */
export const crmStatusStyles: Record<CRMStatus, { badge: string; dot: string; bar: string; panel: string }> = {
  new: { badge: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500', bar: 'bg-emerald-500', panel: 'border-emerald-100' },
  contacted: { badge: 'bg-sky-50 text-sky-600 border-sky-100', dot: 'bg-sky-500', bar: 'bg-sky-500', panel: 'border-sky-100' },
  qualified: { badge: 'bg-violet-50 text-violet-600 border-violet-100', dot: 'bg-violet-500', bar: 'bg-violet-500', panel: 'border-violet-100' },
  opportunity: { badge: 'bg-indigo-50 text-indigo-600 border-indigo-100', dot: 'bg-indigo-500', bar: 'bg-indigo-500', panel: 'border-indigo-100' },
  customer: { badge: 'bg-amber-50 text-amber-600 border-amber-100', dot: 'bg-amber-500', bar: 'bg-amber-500', panel: 'border-amber-100' },
  unqualified: { badge: 'bg-slate-100 text-slate-500 border-slate-100', dot: 'bg-slate-400', bar: 'bg-slate-400', panel: 'border-slate-100' },
  lost: { badge: 'bg-rose-50 text-rose-500 border-rose-100', dot: 'bg-rose-400', bar: 'bg-rose-400', panel: 'border-rose-100' },
  do_not_contact: { badge: 'bg-slate-100 text-slate-400 border-slate-100', dot: 'bg-slate-400', bar: 'bg-slate-400', panel: 'border-slate-100' },
};

export const qualificationStatusStyles: Record<LeadQualificationStatus, { badge: string; dot: string; bar: string; label: string }> = {
  qualified: { badge: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500', bar: 'bg-emerald-500', label: 'Qualified' },
  pending: { badge: 'bg-amber-50 text-amber-600 border-amber-100', dot: 'bg-amber-400', bar: 'bg-amber-400', label: 'Pending' },
  unqualified: { badge: 'bg-slate-50 text-slate-400 border-slate-100', dot: 'bg-slate-300', bar: 'bg-slate-300', label: 'Unqualified' },
};

export const formatLeadDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

interface Props {
  onOpenLead: (leadId: string) => void;
  refreshKey?: number;
}

const LeadCard: React.FC<{ lead: Lead; onOpen: () => void }> = ({ lead, onOpen }) => {
  const cs = crmStatusStyles[lead.crmStatus] || crmStatusStyles.new;
  const qs = qualificationStatusStyles[lead.qualificationStatus] || qualificationStatusStyles.pending;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left p-4 bg-slate-50/60 border border-slate-50 rounded-2xl hover:bg-white hover:border-indigo-100 hover:shadow-lg transition-all group cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-bold text-slate-900 truncate">{lead.name || 'Anonymous lead'}</p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-tighter shrink-0 ${cs.badge}`}>
          {CRM_STATUS_LABELS[lead.crmStatus] || lead.crmStatus}
        </span>
      </div>
      {(lead.phone || lead.email) && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {lead.phone && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-white border border-slate-100 rounded-full px-2 py-0.5">
              <Phone size={10} className="text-indigo-400" /> {lead.phone}
            </span>
          )}
          {lead.email && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-white border border-slate-100 rounded-full px-2 py-0.5">
              <Mail size={10} className="text-indigo-400" /> {lead.email}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${qs.bar}`}
            style={{ width: `${Math.max(2, Math.min(100, lead.qualificationScore))}%` }}
          ></div>
        </div>
        <span className="text-[10px] font-black text-slate-500">{qs.label} · {lead.qualificationScore}</span>
      </div>
      {lead.intent && (
        <p className="text-xs text-slate-500 leading-relaxed mb-2 line-clamp-2">{lead.intent}</p>
      )}
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter flex items-center gap-1 truncate">
          <Target size={10} className="text-indigo-300 shrink-0" />
          {lead.touchpointName || '—'}{lead.agentName ? ` · ${lead.agentName}` : ''}
        </span>
        {lead.assignedUser ? (
          <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1 shrink-0">
            <UserIcon size={10} className="text-emerald-400" /> {lead.assignedUser.name}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100/70">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
          {lead.source === 'auto' ? 'Auto' : 'Manual'}
        </span>
        <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
          <Clock size={10} /> {formatLeadDate(lead.lastInteraction || lead.createdAt)}
        </span>
      </div>
    </button>
  );
};

const LeadPipeline: React.FC<Props> = ({ onOpenLead, refreshKey = 0 }) => {
  const { user } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [crmStatus, setCrmStatus] = useState<CRMStatus | ''>('');
  const [assigned, setAssigned] = useState<string | ''>('');
  const [qualification, setQualification] = useState<LeadQualificationStatus | ''>('');
  const [source, setSource] = useState<'auto' | 'manual' | ''>('');
  const [pageNo, setPageNo] = useState(0);

  const [page, setPage] = useState<LeadPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [statusCounts, setStatusCounts] = useState<Record<CRMStatus, number | null> | null>(null);

  const hasActiveFilters = appliedSearch !== '' || crmStatus !== '' || assigned !== '' || qualification !== '' || source !== '';

  // Debounced search so a partial keystroke never triggers a query.
  useEffect(() => {
    const t = window.setTimeout(() => setAppliedSearch(searchQuery.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const updateFilters = (next: {
    crmStatus?: CRMStatus | '';
    assigned?: string;
    qualification?: LeadQualificationStatus | '';
    source?: 'auto' | 'manual' | '';
  }) => {
    if (next.crmStatus !== undefined) setCrmStatus(next.crmStatus);
    if (next.assigned !== undefined) setAssigned(next.assigned);
    if (next.qualification !== undefined) setQualification(next.qualification);
    if (next.source !== undefined) setSource(next.source);
    setPageNo(0);
  };

  const selectedAssignedFilter = assigned !== '' ? assigned : undefined;
  const selectedQualificationFilter = qualification !== '' ? qualification : undefined;
  const selectedSourceFilter = source !== '' ? source : undefined;

  // Bounded + filtered page fetch. The server caps limit and offset; the client
  // only paginates with explicit params (never an unbounded list).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await leadService.page({
          crmStatus: crmStatus || undefined,
          assignedUserId: selectedAssignedFilter,
          qualificationStatus: selectedQualificationFilter,
          source: selectedSourceFilter,
          search: appliedSearch || undefined,
          limit: PAGE_SIZE,
          offset: pageNo * PAGE_SIZE,
        });
        if (!cancelled) setPage(result);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Could not load leads.');
          setPage(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [appliedSearch, crmStatus, assigned, qualification, source, pageNo, refreshKey, reloadTick]);

  // Per-status funnel counts for the current non-status filters. Each count is
  // a bounded query (limit 1, only the total is read); never an unbounded scan.
  useEffect(() => {
    let cancelled = false;
    const base = {
      assignedUserId: selectedAssignedFilter,
      qualificationStatus: selectedQualificationFilter,
      source: selectedSourceFilter,
      search: appliedSearch || undefined,
    };
    Promise.all(
      CRM_STATUSES.map((s) =>
        leadService.page({ ...base, crmStatus: s, limit: 1, offset: 0 })
          .then((p) => ({ status: s, total: p.total }))
          .catch(() => ({ status: s, total: null as number | null }))
      )
    ).then((results) => {
      if (cancelled) return;
      const map = {} as Record<CRMStatus, number | null>;
      for (const r of results) map[r.status] = r.total;
      setStatusCounts(map);
    });
    return () => { cancelled = true; };
  }, [appliedSearch, assigned, qualification, source, refreshKey]);

  const columns = useMemo(() => {
    const leads = page?.leads || [];
    return CRM_STATUSES.map((s) => ({ status: s, leads: leads.filter((l) => l.crmStatus === s) }));
  }, [page]);

  const totalCount = page?.total ?? 0;
  const pageOffset = pageNo * PAGE_SIZE;
  const shownStart = page && page.leads.length > 0 ? pageOffset + 1 : 0;
  const shownEnd = page ? pageOffset + page.leads.length : 0;
  const allCount = statusCounts
    ? CRM_STATUSES.reduce((sum, s) => sum + (statusCounts[s] ?? 0), 0)
    : null;

  const clearFilters = () => {
    setSearchQuery('');
    setAppliedSearch('');
    setCrmStatus('');
    setAssigned('');
    setQualification('');
    setSource('');
    setPageNo(0);
  };

  const selectClass =
    'text-sm px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-600 focus:ring-2 focus:ring-indigo-500 transition-all';

  const retry = () => setReloadTick((t) => t + 1);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="text-indigo-600" size={26} /> Leads Pipeline
          </h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Server-authoritative CRM workflow · one lead model
          </p>
        </div>
        {page && (
          <div className="bg-white border border-slate-100 rounded-2xl px-4 py-3 shadow-sm">
            <p className="text-lg font-black text-slate-900 leading-none">{totalCount}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              lead{totalCount === 1 ? '' : 's'} match{totalCount === 1 ? 'es' : ''} current filters
            </p>
          </div>
        )}
      </div>

      {/* Filters + funnel strip */}
      <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm p-6">
        <div className="flex flex-col xl:flex-row gap-4">
          <div className="flex-1 relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
              <Search size={16} />
            </div>
            <input
              className="w-full pl-11 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-slate-700"
              placeholder="Search name, phone or email…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery !== '' && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setAppliedSearch(''); setPageNo(0); }}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <select
              className={selectClass}
              value={crmStatus}
              onChange={(e) => updateFilters({ crmStatus: e.target.value as CRMStatus | '' })}
              aria-label="CRM status filter"
            >
              <option value="">All CRM status</option>
              {CRM_STATUSES.map((s) => (
                <option key={s} value={s}>{CRM_STATUS_LABELS[s]}</option>
              ))}
            </select>

            <select
              className={selectClass}
              value={assigned}
              onChange={(e) => updateFilters({ assigned: e.target.value })}
              aria-label="Assignment filter"
            >
              <option value="">All assignments</option>
              <option value={user.id}>{user.name} (me)</option>
            </select>

            <select
              className={selectClass}
              value={qualification}
              onChange={(e) => updateFilters({ qualification: e.target.value as LeadQualificationStatus | '' })}
              aria-label="Qualification status filter"
            >
              <option value="">All qualifications</option>
              <option value="qualified">Qualified</option>
              <option value="pending">Pending</option>
              <option value="unqualified">Unqualified</option>
            </select>

            <select
              className={selectClass}
              value={source}
              onChange={(e) => updateFilters({ source: e.target.value as 'auto' | 'manual' | '' })}
              aria-label="Source filter"
            >
              <option value="">All sources</option>
              <option value="auto">Auto (conversation)</option>
              <option value="manual">Manual (manual entry)</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all shrink-0"
            >
              <X size={14} /> Clear filters
            </button>
          )}
        </div>

        {/* Funnel status strip */}
        <div className="mt-5 pt-5 border-t border-slate-100 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => { setCrmStatus(''); setPageNo(0); }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              crmStatus === '' ? 'bg-slate-900 text-white shadow-lg' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            All · {loading && !statusCounts ? '…' : allCount ?? '—'}
          </button>
          {CRM_STATUSES.map((s) => {
            const active = crmStatus === s;
            const cs = crmStatusStyles[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setCrmStatus(active ? '' : s)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all border ${
                  active ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : `bg-white ${cs.badge}`
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-indigo-400' : cs.dot}`}></span>
                {CRM_STATUS_LABELS[s]}
                <span className={active ? 'text-indigo-300' : 'opacity-60'}>
                  {statusCounts ? (statusCounts[s] ?? '—') : '…'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {error && !page ? (
        <div className="bg-rose-50 border border-rose-100 rounded-[32px] p-10 text-center">
          <p className="text-sm font-bold text-rose-600">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-bold hover:bg-rose-700 transition-all"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : loading && !page ? (
        <div className="bg-white rounded-[32px] border border-slate-100 p-16 flex flex-col items-center justify-center gap-4 text-slate-400">
          <Loader2 size={28} className="text-indigo-600 animate-spin" />
          <p className="text-xs font-bold uppercase tracking-widest">Loading leads…</p>
        </div>
      ) : page && page.leads.length === 0 ? (
        <div className="bg-white rounded-[32px] border border-slate-100 p-16 flex flex-col items-center justify-center gap-4 text-slate-400">
          <Inbox size={36} className="opacity-40" />
          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">No leads match the current filters</p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all"
            >
              <Filter size={14} /> Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {columns.map((col) => {
              const cs = crmStatusStyles[col.status];
              return (
                <div key={col.status} className={`bg-white rounded-[32px] border ${cs.panel} border-slate-100 shadow-sm overflow-hidden`}>
                  <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${cs.dot}`}></span>
                      <p className="text-xs font-black text-slate-900 uppercase tracking-wider">
                        {CRM_STATUS_LABELS[col.status]}
                      </p>
                    </div>
                    <span className="text-[10px] font-black text-slate-400 bg-slate-50 rounded-full px-2 py-0.5">
                      {col.leads.length}
                    </span>
                  </div>
                  <div className="p-3 space-y-3 custom-scrollbar max-h-[65vh] overflow-y-auto">
                    {col.leads.length === 0 ? (
                      <p className="text-center text-[10px] font-bold text-slate-300 italic py-6 uppercase tracking-widest">
                        {crmStatus !== '' && crmStatus !== col.status ? 'Filtered out' : 'No leads'}
                      </p>
                    ) : (
                      col.leads.map((l) => <LeadCard key={l.id} lead={l} onOpen={() => onOpenLead(l.id)} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bounded pagination */}
          <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pageNo === 0 || loading}
                onClick={() => setPageNo((n) => Math.max(0, n - 1))}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <button
                type="button"
                disabled={(pageOffset + (page?.leads.length ?? 0)) >= totalCount || totalCount === 0 || loading}
                onClick={() => setPageNo((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
            <p className="text-xs font-bold text-slate-400">
              {page && page.leads.length > 0 ? `Showing ${shownStart}–${shownEnd} of ${totalCount}` : `0 of ${totalCount}`}
              {' · '}Page {pageNo + 1}
            </p>
          </div>
        </>
      )}

      <p className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        <Sparkles size={12} className="text-indigo-400" />
        CRM status, assignment, qualification state and sales stage are separate systems; status pages are capped and server-confirmed.
      </p>
    </div>
  );
};

export default LeadPipeline;