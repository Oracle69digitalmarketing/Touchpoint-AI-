
import { getAuthHeaders } from './auth';

/**
 * PLATFORM ADMIN API CLIENT (Phase 4)
 *
 * Read-only reporting client for the operator control center. Every endpoint
 * is server-gated by requireAuth + requirePlatformOwner; the client never
 * decides authorization — it only surfaces the server's 200 / 401 / 403.
 * No platform-owner flag is stored, cached, or sent by this module.
 */

const API_BASE = '/v1/admin';

export interface AdminOverview {
  businessCount: number;
  userCount: number;
  agentCount: number;
  touchpointCount: number;
  productCount: number;
  leadCount: number;
  orderCount: number;
  bookingCount: number;
}

export type AdminPlan = 'Free' | 'Starter' | 'Growth' | 'Business' | 'Enterprise';

export interface AdminBusiness {
  businessId: string;
  businessName: string;
  slug: string;
  plan: string;
  subscriptionStatus: string;
  registrationDate: string;
  lastActivity: string | null;
  userCount: number;
  agentCount: number;
  touchpointCount: number;
  productCount: number;
  leadCount: number;
}

export interface AdminAccountUser {
  id: string;
  name: string;
  email: string;
  role: string;
  businessId: string;
  businessName: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface AdminSubscription {
  businessId: string;
  businessName: string;
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
}

export interface AdminAdoptionRow {
  businessId: string;
  businessName: string;
  registrationDate: string;
  plan: string;
  userCount: number;
  agentCount: number;
  touchpointCount: number;
  productCount: number;
  leadCount: number;
  orderCount: number;
  bookingCount: number;
}

interface AdminResult<T> {
  status: number;
  data: T | null;
  error: string | null;
}

async function adminFetch<T>(path: string): Promise<AdminResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() });
  } catch (err: any) {
    return { status: 0, data: null, error: err?.message || 'Network request failed' };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { status: res.status, data: null, error: body?.error || `Request failed (${res.status})` };
  }
  return { status: res.status, data: body as T, error: null };
}

const toQuery = (params: Record<string, string | number | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const adminService = {
  overview(): Promise<AdminResult<{ success: boolean; overview: AdminOverview; plans: Record<AdminPlan, number> }>> {
    return adminFetch('/overview');
  },

  businesses(opts: { limit?: number; offset?: number; search?: string; plan?: string } = {}): Promise<
    AdminResult<{ businesses: AdminBusiness[]; total: number; limit: number; offset: number }>
  > {
    return adminFetch(`/businesses${toQuery({ limit: opts.limit ?? 25, offset: opts.offset ?? 0, search: opts.search, plan: opts.plan })}`);
  },

  businessDetail(id: string): Promise<AdminResult<{ business: AdminBusiness; users: { id: string; name: string; email: string; role: string; createdAt: string }[] }>> {
    return adminFetch(`/businesses/${encodeURIComponent(id)}`);
  },

  users(opts: { limit?: number; offset?: number; search?: string } = {}): Promise<
    AdminResult<{ users: AdminAccountUser[]; total: number; limit: number; offset: number }>
  > {
    return adminFetch(`/users${toQuery({ limit: opts.limit ?? 25, offset: opts.offset ?? 0, search: opts.search })}`);
  },

  subscriptions(opts: { limit?: number; offset?: number } = {}): Promise<
    AdminResult<{ subscriptions: AdminSubscription[]; total: number; limit: number; offset: number }>
  > {
    return adminFetch(`/subscriptions${toQuery({ limit: opts.limit ?? 25, offset: opts.offset ?? 0 })}`);
  },

  adoption(opts: { limit?: number; offset?: number } = {}): Promise<
    AdminResult<{ report: AdminAdoptionRow[]; total: number; limit: number; offset: number }>
  > {
    return adminFetch(`/reports/adoption${toQuery({ limit: opts.limit ?? 25, offset: opts.offset ?? 0 })}`);
  },
};
