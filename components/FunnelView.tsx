import React, { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, CalendarDays, Loader2, Receipt, TrendingUp, User, X,
} from 'lucide-react';
import { AnalyticsRange, AnalyticsOverview, Booking, FunnelAnalytics, Order, PaymentIntent } from '../types';
import { analyticsService } from '../services/analytics';
import { commercialService } from '../services/commercial';

const RANGE_OPTIONS: { key: AnalyticsRange; label: string }[] = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'ALL' },
];

// Ordered, commercially meaningful stages rendered as an EVENT LANDSCAPE for the
// workspace. counts come from two server endpoints: the analytics totals
// (scans/conversations/leads/qualified) and the funnel event counts. Honest
// zeros are kept; no sequential cohort math is implied.
const STAGE_ROWS: { key: string; label: string; from: 'overview' | 'events' }[] = [
  { key: 'scans', label: 'Reach / scans', from: 'overview' },
  { key: 'conversations', label: 'Conversations', from: 'overview' },
  { key: 'leads', label: 'Leads', from: 'overview' },
  { key: 'qualifiedLeads', label: 'Qualified leads', from: 'overview' },
  { key: 'recommendation_made', label: 'Recommendation made', from: 'events' },
  { key: 'buying_signal_detected', label: 'Buying signal detected', from: 'events' },
  { key: 'quote_requested', label: 'Quote requested', from: 'events' },
  { key: 'booking_started', label: 'Booking started', from: 'events' },
  { key: 'booking_reserved', label: 'Booking reserved', from: 'events' },
  { key: 'booking_confirmed', label: 'Booking confirmed', from: 'events' },
  { key: 'order_created', label: 'Order created', from: 'events' },
  { key: 'payment_started', label: 'Payment started', from: 'events' },
  { key: 'payment_verified', label: 'Payment verified', from: 'events' },
];

// Remaining funnel event types the backend may record. Shown only when their
// count is nonzero so no recorded activity is hidden; never treated as stages.
const OTHER_EVENT_LABELS: Record<string, string> = {
  lead_field_captured: 'Lead field captured',
  qualification_updated: 'Qualification updated',
  objection_detected: 'Objection detected',
  handoff_offered: 'Handoff offered',
  handoff_started: 'Handoff started',
  demo_requested: 'Demo requested',
  purchase_started: 'Purchase started',
  order_item_added: 'Order item added',
  order_fulfillment_started: 'Fulfilment started',
  order_fulfilled: 'Order fulfilled',
  order_cancelled: 'Order cancelled',
  payment_failed: 'Payment failed',
  booking_cancelled: 'Booking cancelled',
  booking_rescheduled: 'Booking rescheduled',
  booking_no_show: 'Booking no-show',
  booking_completed: 'Booking completed',
  booking_expired: 'Booking expired',
};

const ORDER_STATUS_PILL: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  pending_payment: 'bg-amber-50 text-amber-600 border-amber-100',
  paid: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  fulfillment_pending: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  fulfilled: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  cancelled: 'bg-rose-50 text-rose-600 border-rose-100',
};

const PAYMENT_STATUS_PILL: Record<string, string> = {
  unpaid: 'bg-slate-100 text-slate-600 border-slate-200',
  pending: 'bg-amber-50 text-amber-600 border-amber-100',
  failed: 'bg-rose-50 text-rose-600 border-rose-100',
  expired: 'bg-slate-100 text-slate-500 border-slate-200',
  paid: 'bg-emerald-50 text-emerald-600 border-emerald-100',
};

const BOOKING_STATUS_PILL: Record<string, string> = {
  reserved: 'bg-amber-50 text-amber-600 border-amber-100',
  confirmed: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  cancelled: 'bg-rose-50 text-rose-600 border-rose-100',
  completed: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  no_show: 'bg-slate-100 text-slate-600 border-slate-200',
  expired: 'bg-slate-100 text-slate-500 border-slate-200',
};

const intentStatusPill = (status: string): string => {
  if (status === 'paid' || status === 'successful') return PAYMENT_STATUS_PILL.paid || 'bg-emerald-50 text-emerald-600 border-emerald-100';
  if (status === 'failed' || status === 'abandoned') return 'bg-rose-50 text-rose-600 border-rose-100';
  if (status === 'expired') return 'bg-slate-100 text-slate-500 border-slate-200';
  return 'bg-amber-50 text-amber-600 border-amber-100';
};

const pill = (map: Record<string, string>, value: string | null | undefined): string => {
  const v = (value || '').toLowerCase();
  return (map[v] || 'bg-slate-100 text-slate-600 border-slate-200');
};

const shortId = (id: string | null | undefined): string => (id ? `#${id.slice(0, 8)}` : '—');

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const PILL_BASE = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-tighter';

interface Props {
  onOpenLead: (leadId: string) => void;
}

interface DetailState {
  order: Order | null;
  intent: PaymentIntent | null;
  loading: boolean;
  error: string | null;
}

const FunnelView: React.FC<Props> = ({ onOpenLead }) => {
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [funnel, setFunnel] = useState<FunnelAnalytics | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(true);
  const [funnelError, setFunnelError] = useState<string | null>(null);

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [bookingsError, setBookingsError] = useState<string | null>(null);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>({ order: null, intent: null, loading: false, error: null });

  useEffect(() => {
    let cancelled = false;
    setFunnelLoading(true);
    setFunnelError(null);
    Promise.all([
      analyticsService.funnel(range),
      analyticsService.overview(range),
    ])
      .then(([f, o]) => {
        if (!cancelled) { setFunnel(f); setOverview(o); }
      })
      .catch((err: any) => {
        if (!cancelled) setFunnelError(err.message || 'Could not load funnel data.');
      })
      .finally(() => {
        if (!cancelled) setFunnelLoading(false);
      });
    return () => { cancelled = true; };
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    commercialService.orders()
      .then((list) => { if (!cancelled) setOrders(list); })
      .catch((err: any) => { if (!cancelled) setOrdersError(err.message || 'Could not load orders.'); });
    commercialService.bookings()
      .then((list) => { if (!cancelled) setBookings(list); })
      .catch((err: any) => { if (!cancelled) setBookingsError(err.message || 'Could not load bookings.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedOrderId) return;
    let cancelled = false;
    setDetail({ order: null, intent: null, loading: true, error: null });
    Promise.all([
      commercialService.order(selectedOrderId),
      commercialService.orderPayment(selectedOrderId),
    ])
      .then(([o, p]) => {
        if (!cancelled) setDetail({ order: o, intent: p, loading: false, error: null });
      })
      .catch((err: any) => {
        if (!cancelled) setDetail({ order: null, intent: null, loading: false, error: err.message || 'Could not load this order.' });
      });
    return () => { cancelled = true; };
  }, [selectedOrderId]);

  const stageValue = (key: string, from: 'overview' | 'events'): number => {
    if (from === 'overview' && overview) {
      return overview.totals[key as keyof typeof overview.totals] ?? 0;
    }
    if (from === 'events' && funnel) {
      return funnel.events[key] ?? 0;
    }
    return 0;
  };

  const stageCounts = STAGE_ROWS.map((row) => stageValue(row.key, row.from));
  const maxStage = Math.max(1, ...stageCounts);

  const otherEvents = funnel
    ? Object.entries(funnel.events)
        .filter(([type]) => !STAGE_ROWS.some((row) => row.from === 'events' && row.key === type))
        .filter(([, count]) => count > 0)
    : [];

  const paidCount = orders?.filter((o) => o.paymentStatus === 'paid').length ?? 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight text-gradient">Conversion Pulse</h1>
          <p className="text-slate-500 font-medium">Read-only view of the workspace's commercial pipeline.</p>
        </div>
        <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`px-4 py-2 rounded-xl text-[10px] font-bold tracking-widest transition-all ${range === opt.key ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-6 lg:p-10">
        <div className="flex items-center gap-3 mb-2">
          <Activity size={20} className="text-indigo-600" />
          <h2 className="text-xl font-bold text-slate-900">Conversion Event Funnel</h2>
        </div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
          {range === 'all' ? 'All-time event counts' : `Event counts · ${range.toUpperCase()}`}
        </p>
        <p className="text-xs text-slate-400 font-medium mb-8 max-w-3xl">
          Counts as recorded by the backend for this workspace. These are flow events, not a strict sequential cohort
          funnel — stages are not guaranteed to be mathematically ordered, and no conversion percentages are derived here.
        </p>

        {funnelLoading ? (
          <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 size={28} className="animate-spin text-indigo-500" />
            <p className="text-xs font-bold uppercase tracking-widest">Loading funnel</p>
          </div>
        ) : funnelError ? (
          <div className="py-12 px-6 flex flex-col items-center gap-3 text-center">
            <AlertTriangle size={28} className="text-amber-500" />
            <p className="text-sm font-bold text-slate-700">{funnelError}</p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              {STAGE_ROWS.map((row, i) => {
                const value = stageValue(row.key, row.from);
                return (
                  <div key={`${row.key}-${i}`} className="flex items-center gap-4 py-2.5 border-b border-slate-50 last:border-0">
                    <span className="w-6 text-[10px] font-black text-slate-300 text-center">{i + 1}</span>
                    <span className="flex-1 text-sm font-bold text-slate-700">{row.label}</span>
                    <div className="w-40 h-1.5 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: value > 0 ? `${Math.max(4, Math.round((value / maxStage) * 100))}%` : '0%' }}
                      />
                    </div>
                    <span className="w-14 text-right text-sm font-black text-slate-900 tabular-nums">{value.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
            {otherEvents.length > 0 && (
              <div className="mt-8 pt-6 border-t border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Also recorded (this range)</p>
                <div className="flex flex-wrap gap-2">
                  {otherEvents.map(([type, count]) => (
                    <span key={type} className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-full text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                      {OTHER_EVENT_LABELS[type] || type.replace(/_/g, ' ')}
                      <span className="text-slate-900 tabular-nums">{count.toLocaleString()}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-6 lg:p-8">
          <div className="flex items-center gap-3 mb-6">
            <Receipt size={20} className="text-indigo-600" />
            <div>
              <h2 className="text-xl font-bold text-slate-900">Orders</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                {orders ? `${orders.length} order${orders.length === 1 ? '' : 's'} · ${paidCount} paid` : 'Loading orders'}
              </p>
            </div>
          </div>

          {ordersError ? (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <AlertTriangle size={28} className="text-amber-500" />
              <p className="text-sm font-bold text-slate-700">{ordersError}</p>
            </div>
          ) : orders === null ? (
            <div className="py-12 flex flex-col items-center gap-3 text-slate-400">
              <Loader2 size={26} className="animate-spin text-indigo-500" />
              <p className="text-xs font-bold uppercase tracking-widest">Loading orders</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-2 text-center">
              <Receipt size={40} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-500">No orders yet</p>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Orders created in this workspace appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrderId(order.id)}
                  className="w-full text-left bg-slate-50/60 border border-slate-100 rounded-3xl p-5 hover:border-indigo-200 hover:bg-indigo-50/40 transition-all group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-black text-slate-900">{shortId(order.id)}</p>
                        <span className={`${PILL_BASE} ${pill(ORDER_STATUS_PILL, order.status)}`}>{order.status}</span>
                      </div>
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-tighter mt-1.5">
                        {order.customerName || 'No customer name'} · {fmtDate(order.createdAt)}
                      </p>
                      {order.leadId && (
                        <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-tighter mt-0.5">Lead {shortId(order.leadId)}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-black text-slate-900 tabular-nums">{order.total.toLocaleString()} {order.currency}</p>
                      <p className={`${PILL_BASE} mt-1 ${pill(PAYMENT_STATUS_PILL, order.paymentStatus)}`}>{order.paymentStatus}</p>
                      {typeof order.itemCount === 'number' && (
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter mt-1">{order.itemCount} item{order.itemCount === 1 ? '' : 's'}</p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-6 lg:p-8">
          <div className="flex items-center gap-3 mb-6">
            <CalendarDays size={20} className="text-indigo-600" />
            <div>
              <h2 className="text-xl font-bold text-slate-900">Bookings</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                {bookings ? `${bookings.length} booking${bookings.length === 1 ? '' : 's'}` : 'Loading bookings'}
              </p>
            </div>
          </div>

          {bookingsError ? (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <AlertTriangle size={28} className="text-amber-500" />
              <p className="text-sm font-bold text-slate-700">{bookingsError}</p>
            </div>
          ) : bookings === null ? (
            <div className="py-12 flex flex-col items-center gap-3 text-slate-400">
              <Loader2 size={26} className="animate-spin text-indigo-500" />
              <p className="text-xs font-bold uppercase tracking-widest">Loading bookings</p>
            </div>
          ) : bookings.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-2 text-center">
              <CalendarDays size={40} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-500">No bookings yet</p>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Bookings placed in this workspace appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {bookings.map((booking) => (
                <div key={booking.id} className="bg-slate-50/60 border border-slate-100 rounded-3xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-black text-slate-900">{shortId(booking.id)}</p>
                        <span className={`${PILL_BASE} ${pill(BOOKING_STATUS_PILL, booking.status)}`}>{booking.status}</span>
                      </div>
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-tighter mt-1.5">
                        {booking.productName || 'Product'} · {fmtDate(booking.requestedStartAt)}
                      </p>
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-tighter mt-0.5">
                        {booking.name || booking.customer?.name || 'Anonymous'} {booking.phone ? `· ${booking.phone}` : ''}
                      </p>
                      {booking.leadId && (
                        <button
                          type="button"
                          onClick={() => onOpenLead(booking.leadId)}
                          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full text-[10px] font-bold uppercase tracking-tighter hover:bg-indigo-100 transition-all"
                        >
                          <User size={11} /> Open lead {shortId(booking.leadId)}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedOrderId && (
        <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto custom-scrollbar">
          <div className="p-6 lg:p-10 max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4 duration-500 fill-mode-both">
            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setSelectedOrderId(null)}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
              >
                <ArrowRight size={15} className="rotate-180" /> Back
              </button>
              <button
                type="button"
                onClick={() => setSelectedOrderId(null)}
                className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
                title="Close"
                aria-label="Close order details"
              >
                <X size={16} />
              </button>
            </div>

            {detail.loading ? (
              <div className="py-24 flex flex-col items-center gap-3 text-slate-400">
                <Loader2 size={30} className="animate-spin text-indigo-500" />
                <p className="text-xs font-bold uppercase tracking-widest">Loading order</p>
              </div>
            ) : detail.error ? (
              <div className="py-16 px-6 flex flex-col items-center gap-3 text-center">
                <AlertTriangle size={30} className="text-amber-500" />
                <p className="text-sm font-bold text-slate-700">{detail.error}</p>
              </div>
            ) : detail.order ? (
              <>
                <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-8">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-black text-slate-900 tracking-tight">Order {shortId(detail.order.id)}</h2>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                        Created {fmtDate(detail.order.createdAt)} · channel {detail.order.channel}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</p>
                      <p className="text-3xl font-black text-slate-900 tabular-nums mt-0.5">
                        {detail.order.total.toLocaleString()} {detail.order.currency}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
                      <span className={`${PILL_BASE} ${pill(ORDER_STATUS_PILL, detail.order.status)}`}>{detail.order.status}</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Payment</p>
                      <span className={`${PILL_BASE} ${pill(PAYMENT_STATUS_PILL, detail.order.paymentStatus)}`}>{detail.order.paymentStatus}</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Fulfilment</p>
                      <span className={`${PILL_BASE} ${pill(ORDER_STATUS_PILL, detail.order.fulfillmentStatus || 'draft')}`}>
                        {detail.order.fulfillmentStatus || 'Not applicable'}
                      </span>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Subtotal</p>
                      <p className="text-sm font-black text-slate-900 tabular-nums">{detail.order.subtotal.toLocaleString()} {detail.order.currency}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8 pt-6 border-t border-slate-100">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Customer</p>
                      <p className="text-sm font-bold text-slate-800">{detail.order.customerName || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Lead linkage</p>
                      {detail.order.leadId ? (
                        <button
                          type="button"
                          onClick={() => onOpenLead(detail.order.leadId as string)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full text-[10px] font-bold uppercase tracking-tighter hover:bg-indigo-100 transition-all"
                        >
                          <User size={11} /> Open lead {shortId(detail.order.leadId)}
                        </button>
                      ) : (
                        <p className="text-sm font-bold text-slate-500">No lead linked</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-8">
                  <h3 className="text-lg font-bold text-slate-900 mb-4">Order lines</h3>
                  {(() => {
                    const items = detail.order?.items;
                    if (!items || items.length === 0) {
                      return <p className="text-sm font-bold text-slate-400">No line items returned for this order.</p>;
                    }
                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-slate-100">
                              <th className="py-3 pr-4 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Product</th>
                              <th className="py-3 pr-4 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] text-right">Qty</th>
                              <th className="py-3 pr-4 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] text-right">Unit price</th>
                              <th className="py-3 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {items.map((item) => (
                              <tr key={item.id}>
                                <td className="py-3 pr-4 text-sm font-bold text-slate-800">
                                  {item.productName}
                                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">{shortId(item.productId)}</span>
                                </td>
                                <td className="py-3 pr-4 text-right text-sm font-bold text-slate-700 tabular-nums">{item.quantity}</td>
                                <td className="py-3 pr-4 text-right text-sm font-bold text-slate-700 tabular-nums">{item.unitPrice.toLocaleString()}</td>
                                <td className="py-3 text-right text-sm font-black text-slate-900 tabular-nums">{item.total.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-4">
                    Amounts are server-authoritative {detail.order?.currency || ''} values.
                  </p>
                </div>

                <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-8">
                  <h3 className="text-lg font-bold text-slate-900 mb-4">Payment intent</h3>
                  {detail.intent ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`${PILL_BASE} ${intentStatusPill(detail.intent.status)}`}>{detail.intent.status}</span>
                        <span className={`${PILL_BASE} bg-slate-100 text-slate-600 border-slate-200`}>{detail.intent.provider}</span>
                        <span className={`${PILL_BASE} bg-slate-100 text-slate-600 border-slate-200`}>Intent {shortId(detail.intent.id)}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Authorized amount</p>
                          <p className="text-sm font-black text-slate-900 tabular-nums">{detail.intent.amountMinor} {detail.intent.currency}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">Minor units</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Provider reference</p>
                          <p className="text-sm font-mono text-indigo-600 break-all">{detail.intent.providerReference || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Verified at</p>
                          <p className="text-sm font-bold text-slate-800">{fmtDate(detail.intent.verifiedAt)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Paid amount</p>
                          <p className="text-sm font-black text-slate-900 tabular-nums">
                            {detail.intent.paidAmountMinor != null ? `${detail.intent.paidAmountMinor} ${detail.intent.currency}` : '—'}
                          </p>
                        </div>
                      </div>
                      {detail.intent.failureReason && (
                        <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-xs font-bold text-rose-600">
                          Failure reason: {detail.intent.failureReason}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm font-bold text-slate-400">No payment intent recorded for this order.</p>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default FunnelView;