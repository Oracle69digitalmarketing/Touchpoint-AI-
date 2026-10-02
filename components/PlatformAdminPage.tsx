
import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, LogOut, ArrowLeft, Download, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from './AuthGate';
import {
  adminService,
  AdminOverview,
  AdminBusiness,
  AdminAccountUser,
  AdminSubscription,
  AdminAdoptionRow,
} from '../services/admin';

/**
 * PLATFORM OWNER CONTROL CENTER (Phase 4B)
 *
 * Deliberate route: /admin (wired in App.tsx, inside <AuthGate>).
 * The server is authoritative: this page renders the dashboard only after
 * GET /v1/admin/overview returns 200. A 401 returns to the auth flow, a 403
 * renders "Platform owner access required". No platform-owner flag is kept in
 * localStorage, URLs, query params, or component state used as authorization
 * — every section revalidates against the live API status.
 */

type Gate = 'checking' | 'authorized' | 'denied' | 'signed-out';
type Section = 'overview' | 'businesses' | 'users' | 'subscriptions' | 'reports';

const PLANS = ['Free', 'Starter', 'Growth', 'Business', 'Enterprise'];
const PAGE_SIZE = 25;

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

const formatDateTime = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const csvEscape = (value: unknown): string => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const GateMessage: React.FC<{ title: string; detail: string; action: React.ReactNode }> = ({ title, detail, action }) => (
  <div className="min-h-screen bg-slate-50 font-sans flex items-center justify-center p-6">
    <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center space-y-4">
      <div className="w-12 h-12 mx-auto bg-slate-900 rounded-2xl flex items-center justify-center text-white">
        <ShieldAlert size={22} />
      </div>
      <h1 className="text-lg font-black text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500">{detail}</p>
      <div className="pt-2">{action}</div>
    </div>
  </div>
);

const Pagination: React.FC<{ total: number; limit: number; offset: number; onPage: (offset: number) => void }> = ({ total, limit, offset, onPage }) => {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between pt-4">
      <p className="text-xs text-slate-500">
        Page {page} of {pages} · {total} total
      </p>
      <div className="flex gap-2">
        <button
          disabled={offset <= 0}
          onClick={() => onPage(Math.max(0, offset - limit))}
          className="p-2 rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          disabled={offset + limit >= total}
          onClick={() => onPage(offset + limit)}
          className="p-2 rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50"
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

const BusinessesSection: React.FC = () => {
  const [rows, setRows] = useState<AdminBusiness[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [plan, setPlan] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ business: AdminBusiness; users: { id: string; name: string; email: string; role: string; createdAt: string }[] } | null>(null);
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async (nextOffset: number, nextSearch: string, nextPlan: string) => {
    setLoading(true);
    setError('');
    const res = await adminService.businesses({ limit: PAGE_SIZE, offset: nextOffset, search: nextSearch || undefined, plan: nextPlan || undefined });
    if (res.status === 200 && res.data) {
      setRows(res.data.businesses);
      setTotal(res.data.total);
      setOffset(res.data.offset);
    } else {
      setError(res.error || 'Could not load businesses.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load(0, '', '');
  }, [load]);

  const applyFilters = () => {
    setSelectedId(null);
    setDetail(null);
    load(0, draft.trim(), plan);
    setSearch(draft.trim());
  };

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError('');
    const res = await adminService.businessDetail(id);
    if (res.status === 200 && res.data) {
      setDetail(res.data);
    } else {
      setDetailError(res.error || 'Could not load business detail.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-2.5">
          <Search size={16} className="text-slate-400" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
            placeholder="Search name or slug…"
            className="flex-1 outline-none text-sm text-slate-800 bg-transparent"
          />
        </div>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm text-slate-700"
        >
          <option value="">All plans</option>
          {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={applyFilters} className="px-5 py-2.5 rounded-2xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800">
          Apply
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-black">Business</th>
                <th className="px-5 py-3 font-black">Plan</th>
                <th className="px-5 py-3 font-black">Users</th>
                <th className="px-5 py-3 font-black">Agents</th>
                <th className="px-5 py-3 font-black">Touchpoints</th>
                <th className="px-5 py-3 font-black">Products</th>
                <th className="px-5 py-3 font-black">Leads</th>
                <th className="px-5 py-3 font-black">Registered</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">Loading businesses…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">No businesses match.</td></tr>
              ) : rows.map((b) => (
                <tr
                  key={b.businessId}
                  onClick={() => openDetail(b.businessId)}
                  className={`border-b border-slate-50 cursor-pointer hover:bg-indigo-50/40 ${selectedId === b.businessId ? 'bg-indigo-50/60' : ''}`}
                >
                  <td className="px-5 py-3 font-bold text-slate-800">{b.businessName}<span className="block text-xs font-normal text-slate-400">{b.slug}</span></td>
                  <td className="px-5 py-3"><span className="text-xs font-bold bg-slate-100 rounded-full px-2.5 py-1">{b.plan}</span></td>
                  <td className="px-5 py-3 text-slate-600">{b.userCount}</td>
                  <td className="px-5 py-3 text-slate-600">{b.agentCount}</td>
                  <td className="px-5 py-3 text-slate-600">{b.touchpointCount}</td>
                  <td className="px-5 py-3 text-slate-600">{b.productCount}</td>
                  <td className="px-5 py-3 text-slate-600">{b.leadCount}</td>
                  <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{formatDate(b.registrationDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          <Pagination total={total} limit={PAGE_SIZE} offset={offset} onPage={(o) => load(o, search, plan)} />
        </div>
      </div>

      {selectedId && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4">
          {detailError && <p className="text-sm text-red-600">{detailError}</p>}
          {!detail && !detailError && <p className="text-sm text-slate-400">Loading business detail…</p>}
          {detail && (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-black text-slate-900">{detail.business.businessName}</h3>
                  <p className="text-xs text-slate-400">{detail.business.slug} · {detail.business.plan} · {detail.business.subscriptionStatus}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Registered {formatDate(detail.business.registrationDate)} · Last activity {formatDateTime(detail.business.lastActivity)}
                  </p>
                </div>
                <button onClick={() => { setSelectedId(null); setDetail(null); }} className="text-xs font-bold text-slate-500 hover:text-slate-900">Close</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[['Users', detail.business.userCount], ['Agents', detail.business.agentCount], ['Touchpoints', detail.business.touchpointCount], ['Products', detail.business.productCount], ['Leads', detail.business.leadCount]].map(([label, n]) => (
                  <div key={label} className="bg-slate-50 rounded-2xl px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                    <p className="text-xl font-black text-slate-900">{n}</p>
                  </div>
                ))}
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Registered application users</h4>
                {detail.users.length === 0 ? (
                  <p className="text-sm text-slate-400">No users on this workspace.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {detail.users.map((u) => (
                      <li key={u.id} className="py-2.5 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-800">{u.name}</p>
                          <p className="text-xs text-slate-400">{u.email}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-slate-600">{u.role}</p>
                          <p className="text-xs text-slate-400">{formatDate(u.createdAt)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const UsersSection: React.FC = () => {
  const [rows, setRows] = useState<AdminAccountUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextOffset: number, nextSearch: string) => {
    setLoading(true);
    setError('');
    const res = await adminService.users({ limit: PAGE_SIZE, offset: nextOffset, search: nextSearch || undefined });
    if (res.status === 200 && res.data) {
      setRows(res.data.users);
      setTotal(res.data.total);
      setOffset(res.data.offset);
    } else {
      setError(res.error || 'Could not load users.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(0, ''); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-2.5">
          <Search size={16} className="text-slate-400" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(draft.trim()); load(0, draft.trim()); } }}
            placeholder="Search name or email…"
            className="flex-1 outline-none text-sm text-slate-800 bg-transparent"
          />
        </div>
        <button onClick={() => { setSearch(draft.trim()); load(0, draft.trim()); }} className="px-5 py-2.5 rounded-2xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800">
          Search
        </button>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">{error}</p>}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-black">Name</th>
                <th className="px-5 py-3 font-black">Email</th>
                <th className="px-5 py-3 font-black">Business</th>
                <th className="px-5 py-3 font-black">Role</th>
                <th className="px-5 py-3 font-black">Registered</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Loading users…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No users match.</td></tr>
              ) : rows.map((u) => (
                <tr key={u.id} className="border-b border-slate-50">
                  <td className="px-5 py-3 font-bold text-slate-800">{u.name}</td>
                  <td className="px-5 py-3 text-slate-600">{u.email}</td>
                  <td className="px-5 py-3 text-slate-600">{u.businessName}</td>
                  <td className="px-5 py-3 text-slate-600">{u.role}</td>
                  <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{formatDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          <Pagination total={total} limit={PAGE_SIZE} offset={offset} onPage={(o) => load(o, search)} />
        </div>
      </div>
    </div>
  );
};

const SubscriptionsSection: React.FC = () => {
  const [rows, setRows] = useState<AdminSubscription[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError('');
    const res = await adminService.subscriptions({ limit: PAGE_SIZE, offset: nextOffset });
    if (res.status === 200 && res.data) {
      setRows(res.data.subscriptions);
      setTotal(res.data.total);
      setOffset(res.data.offset);
    } else {
      setError(res.error || 'Could not load subscriptions.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(0); }, [load]);

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">{error}</p>}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-black">Business</th>
                <th className="px-5 py-3 font-black">Plan</th>
                <th className="px-5 py-3 font-black">Status</th>
                <th className="px-5 py-3 font-black">Period End</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">Loading subscriptions…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">No subscriptions found.</td></tr>
              ) : rows.map((s) => (
                <tr key={s.businessId} className="border-b border-slate-50">
                  <td className="px-5 py-3 font-bold text-slate-800">{s.businessName}</td>
                  <td className="px-5 py-3"><span className="text-xs font-bold bg-slate-100 rounded-full px-2.5 py-1">{s.plan}</span></td>
                  <td className="px-5 py-3 text-slate-600">{s.status}</td>
                  <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{formatDate(s.currentPeriodEnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          <Pagination total={total} limit={PAGE_SIZE} offset={offset} onPage={load} />
        </div>
      </div>
    </div>
  );
};

const ReportsSection: React.FC = () => {
  const [rows, setRows] = useState<AdminAdoptionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError('');
    const res = await adminService.adoption({ limit: PAGE_SIZE, offset: nextOffset });
    if (res.status === 200 && res.data) {
      setRows(res.data.report);
      setTotal(res.data.total);
      setOffset(res.data.offset);
    } else {
      setError(res.error || 'Could not load adoption report.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(0); }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: AdminAdoptionRow[] = [];
      let next = 0;
      for (;;) {
        const res = await adminService.adoption({ limit: 100, offset: next });
        if (res.status !== 200 || !res.data) throw new Error(res.error || 'Export failed.');
        all.push(...res.data.report);
        if (all.length >= res.data.total || res.data.report.length === 0) break;
        next += res.data.report.length;
      }
      const header = ['business_id', 'business_name', 'registration_date', 'plan', 'user_count', 'agent_count', 'touchpoint_count', 'product_count', 'lead_count', 'order_count', 'booking_count'];
      const lines = [header.join(',')];
      for (const r of all) {
        lines.push([r.businessId, r.businessName, r.registrationDate, r.plan, r.userCount, r.agentCount, r.touchpointCount, r.productCount, r.leadCount, r.orderCount, r.bookingCount].map(csvEscape).join(','));
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `adoption-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Privacy-safe per-business adoption evidence. No customer records, no PII.</p>
        <button
          onClick={exportCsv}
          disabled={exporting}
          className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
        >
          <Download size={16} /> {exporting ? 'Exporting…' : 'Export Adoption CSV'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">{error}</p>}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-black">Business</th>
                <th className="px-5 py-3 font-black">Plan</th>
                <th className="px-5 py-3 font-black">Users</th>
                <th className="px-5 py-3 font-black">Agents</th>
                <th className="px-5 py-3 font-black">Touchpoints</th>
                <th className="px-5 py-3 font-black">Products</th>
                <th className="px-5 py-3 font-black">Leads</th>
                <th className="px-5 py-3 font-black">Orders</th>
                <th className="px-5 py-3 font-black">Bookings</th>
                <th className="px-5 py-3 font-black">Registered</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-5 py-8 text-center text-slate-400">Loading report…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-5 py-8 text-center text-slate-400">No businesses to report.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.businessId} className="border-b border-slate-50">
                  <td className="px-5 py-3 font-bold text-slate-800">{r.businessName}</td>
                  <td className="px-5 py-3 text-slate-600">{r.plan}</td>
                  <td className="px-5 py-3 text-slate-600">{r.userCount}</td>
                  <td className="px-5 py-3 text-slate-600">{r.agentCount}</td>
                  <td className="px-5 py-3 text-slate-600">{r.touchpointCount}</td>
                  <td className="px-5 py-3 text-slate-600">{r.productCount}</td>
                  <td className="px-5 py-3 text-slate-600">{r.leadCount}</td>
                  <td className="px-5 py-3 text-slate-600">{r.orderCount}</td>
                  <td className="px-5 py-3 text-slate-600">{r.bookingCount}</td>
                  <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{formatDate(r.registrationDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          <Pagination total={total} limit={PAGE_SIZE} offset={offset} onPage={load} />
        </div>
      </div>
    </div>
  );
};

const PlatformAdminPage: React.FC = () => {
  const { user, business, logout } = useAuth();
  const [gate, setGate] = useState<Gate>('checking');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [plans, setPlans] = useState<Record<string, number> | null>(null);
  const [section, setSection] = useState<Section>('overview');

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const res = await adminService.overview();
      if (cancelled) return;
      if (res.status === 200 && res.data) {
        setOverview(res.data.overview);
        setPlans(res.data.plans);
        setGate('authorized');
      } else if (res.status === 403) {
        setGate('denied');
      } else if (res.status === 401) {
        setGate('signed-out');
      } else {
        setGate('denied');
      }
    };
    boot();
    return () => { cancelled = true; };
  }, []);

  if (gate === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 font-sans flex items-center justify-center">
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] animate-pulse">Verifying platform access</p>
      </div>
    );
  }

  if (gate === 'denied') {
    return (
      <GateMessage
        title="Platform owner access required"
        detail="This control center is restricted to the TouchPoint AI platform operator. Your workspace session is valid, but it is not a platform-owner session."
        action={
          <div className="flex gap-3 justify-center">
            <a href="/" className="px-5 py-2.5 rounded-2xl bg-slate-900 text-white text-sm font-bold">Back to workspace</a>
            <button onClick={() => logout()} className="px-5 py-2.5 rounded-2xl border border-slate-200 text-sm font-bold text-slate-600">Sign out</button>
          </div>
        }
      />
    );
  }

  if (gate === 'signed-out') {
    return (
      <GateMessage
        title="Authentication required"
        detail="Your session has expired. Sign in again to access the platform control center."
        action={
          <a href="/" className="px-5 py-2.5 rounded-2xl bg-slate-900 text-white text-sm font-bold">Go to sign in</a>
        }
      />
    );
  }

  const cards: [string, number][] = overview ? [
    ['Businesses', overview.businessCount],
    ['Users', overview.userCount],
    ['AI Agents', overview.agentCount],
    ['Touchpoints', overview.touchpointCount],
    ['Products', overview.productCount],
    ['Leads', overview.leadCount],
    ['Orders', overview.orderCount],
    ['Bookings', overview.bookingCount],
  ] : [];

  const maxPlan = Math.max(1, ...PLANS.map((p) => plans?.[p] ?? 0));

  const tabs: { id: Section; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'businesses', label: 'Businesses' },
    { id: 'users', label: 'Users' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'reports', label: 'Reports' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black">T</div>
            <div>
              <h1 className="text-base font-black text-slate-900 leading-none">TouchPoint AI · Platform Control Center</h1>
              <p className="text-[11px] text-slate-400 mt-1">
                Operator {user.name} · {user.email} · {business.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className="flex items-center gap-1.5 px-4 py-2 rounded-2xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50">
              <ArrowLeft size={15} /> Workspace
            </a>
            <button onClick={() => logout()} className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-6 pb-3 flex gap-2 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setSection(t.id)}
              className={`px-4 py-2 rounded-2xl text-sm font-bold whitespace-nowrap ${section === t.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {section === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {cards.map(([label, n]) => (
                <div key={label} className="bg-white border border-slate-200 rounded-3xl px-5 py-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                  <p className="text-3xl font-black text-slate-900 mt-1">{n}</p>
                </div>
              ))}
            </div>
            <div className="bg-white border border-slate-200 rounded-3xl p-6">
              <h2 className="text-sm font-black text-slate-900 mb-4">Plan distribution</h2>
              <div className="space-y-3">
                {PLANS.map((p) => {
                  const n = plans?.[p] ?? 0;
                  return (
                    <div key={p} className="flex items-center gap-4">
                      <span className="w-24 text-sm font-bold text-slate-600">{p}</span>
                      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-slate-900 rounded-full" style={{ width: `${Math.round((n / maxPlan) * 100)}%` }} />
                      </div>
                      <span className="w-10 text-right text-sm font-black text-slate-900">{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {section === 'businesses' && <BusinessesSection />}
        {section === 'users' && <UsersSection />}
        {section === 'subscriptions' && <SubscriptionsSection />}
        {section === 'reports' && <ReportsSection />}
      </main>
    </div>
  );
};

export default PlatformAdminPage;
