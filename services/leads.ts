import { Lead, LeadNotification, LeadQualificationStatus, CRMStatus, LeadNote, LeadActivityEvent, LeadPage } from '../types';
import { getAuthHeaders } from './auth';

/**
 * LEADS API CLIENT (authenticated)
 * Surfaces the business's persisted leads and in-app notifications. The server
 * is the source of truth for extraction, qualification, CRM status, assignment,
 * notes, activity, tenant scoping and plan limits; the client only submits
 * business data and operator actions — never a business_id, never an
 * authorUserId, never an AI note.
 */

const API_BASE = '/v1';

export interface LeadInput {
  name?: string;
  phone?: string;
  email?: string;
  intent?: string;
  qualificationScore?: number;
  qualificationStatus?: LeadQualificationStatus;
  conversationId?: string;
  touchpointId?: string;
}

/**
 * Filter/pagination parameters for the bounded lead listing. Every value is
 * validated server-side against a fixed enum or bounded string; an empty or
 * undefined value contributes no filter.
 */
export interface LeadListParams {
  crmStatus?: CRMStatus | '';
  assignedUserId?: string | '';
  qualificationStatus?: LeadQualificationStatus | '';
  source?: 'auto' | 'manual' | '';
  search?: string;
  limit?: number;
  offset?: number;
}

interface RawLead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  intent: string | null;
  qualificationScore: number;
  qualificationStatus: string;
  source: string;
  notified: boolean;
  touchpointId: string | null;
  touchpointName: string | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

// The enriched CRM response (publicCrmLead) extends the base lead payload with
// operator CRM state and derived conversation intelligence.
interface RawCrmLead extends RawLead {
  crmStatus?: string;
  assignedUser?: { id: string; name: string } | null;
  conversationCount?: number;
  firstInteraction?: string;
  lastInteraction?: string | null;
  salesStage?: string | null;
  conversationIntent?: string | null;
  customerNeed?: string | null;
  recommendedProduct?: { id: string; name: string } | null;
  buyingSignal?: boolean | null;
  objection?: string | null;
  nextBestAction?: string | null;
  channel?: string | null;
  customerName?: string | null;
}

interface RawLeadNote {
  id: string;
  leadId: string;
  authorUserId: string | null;
  body: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface RawActivityEvent {
  id: string;
  eventType: string;
  conversationId: string | null;
  orderId: string | null;
  leadId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

interface RawNotification {
  id: string;
  leadId: string;
  leadName: string | null;
  phone: string | null;
  email: string | null;
  qualificationScore: number;
  qualificationStatus: string;
  readAt: string | null;
  createdAt: string;
}

/**
 * Maps a raw backend lead row. Non-CRM responses (lead create/update) do not
 * carry the enriched fields; those default to the database's deterministic
 * values (crm_status defaults to 'new', unassigned, no derived intelligence),
 * mirroring exactly what the backend would return — nothing is invented.
 */
const toLead = (raw: RawLead): Lead => {
  const r = raw as RawCrmLead;
  return {
    ...raw,
    qualificationStatus: raw.qualificationStatus as LeadQualificationStatus,
    source: raw.source as Lead['source'],
    crmStatus: (r.crmStatus || 'new') as CRMStatus,
    assignedUser: r.assignedUser ?? null,
    conversationCount: r.conversationCount ?? 0,
    firstInteraction: r.firstInteraction || raw.createdAt,
    lastInteraction: r.lastInteraction ?? null,
    salesStage: r.salesStage ?? null,
    conversationIntent: r.conversationIntent ?? null,
    customerNeed: r.customerNeed ?? null,
    recommendedProduct: r.recommendedProduct ?? null,
    buyingSignal: r.buyingSignal ?? null,
    objection: r.objection ?? null,
    nextBestAction: r.nextBestAction ?? null,
    channel: r.channel ?? null,
    customerName: r.customerName ?? null,
  };
};

const toNotification = (raw: RawNotification): LeadNotification => ({
  ...raw,
  qualificationStatus: raw.qualificationStatus as LeadQualificationStatus,
});

const toNote = (raw: RawLeadNote): LeadNote => ({
  id: raw.id,
  leadId: raw.leadId,
  authorUserId: raw.authorUserId,
  body: raw.body,
  source: raw.source as LeadNote['source'],
  createdAt: raw.createdAt,
  updatedAt: raw.updatedAt,
});

const toActivity = (raw: RawActivityEvent): LeadActivityEvent => ({
  id: raw.id,
  eventType: raw.eventType,
  conversationId: raw.conversationId,
  orderId: raw.orderId,
  leadId: raw.leadId,
  meta: raw.meta,
  createdAt: raw.createdAt,
});

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

/**
 * Builds a bounded query string. Filters whose value is empty/undefined are
 * omitted so the server applies its own defaults (never an unbounded scan).
 */
const buildQuery = (params: LeadListParams = {}): string => {
  const parts: string[] = [];
  const push = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  };
  push('crmStatus', params.crmStatus as string);
  push('assignedUserId', params.assignedUserId as string);
  push('qualificationStatus', params.qualificationStatus as string);
  push('source', params.source as string);
  push('search', params.search);
  push('limit', params.limit);
  push('offset', params.offset);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
};

export const leadService = {
  /**
   * Lists the business's leads (bounded, server-defaulted to 50). Retained for
   * the existing dashboard/notification surfaces; the CRM pipeline uses page().
   */
  async list(params: LeadListParams = {}): Promise<Lead[]> {
    const page = await this.page(params);
    return page.leads;
  },

  /**
   * Bounded, filtered + paginated CRM lead listing. Always sends an explicit
   * server-capped limit; never fetches an unbounded list.
   */
  async page(params: LeadListParams = {}): Promise<LeadPage> {
    const res = await fetch(`${API_BASE}/leads${buildQuery({ ...params, limit: params.limit ?? 50 })}`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ leads: RawLead[]; total: number; limit: number; offset: number }>(res);
    return {
      leads: (data.leads || []).map(toLead),
      total: data.total || 0,
      limit: data.limit ?? params.limit ?? 50,
      offset: data.offset ?? params.offset ?? 0,
    };
  },

  /**
   * Fetches a single lead's full CRM context (scoped to the authenticated
   * business by the server).
   */
  async get(id: string): Promise<Lead> {
    const res = await fetch(`${API_BASE}/leads/${id}`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ lead: RawLead }>(res);
    return toLead(data.lead);
  },

  /**
   * Changes ONLY the operator-controlled CRM status. Qualification status and
   * conversation sales stage are separate systems and are never touched.
   */
  async updateCrmStatus(id: string, crmStatus: CRMStatus): Promise<Lead> {
    const res = await fetch(`${API_BASE}/leads/${id}/crm-status`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ crmStatus }),
    });
    const data = await handleResponse<{ lead: RawLead }>(res);
    return toLead(data.lead);
  },

  /**
   * Assigns (or, with null, unassigns) a workspace user. Only the authenticated
   * session is sent; the server validates that the user belongs to the tenant.
   */
  async updateAssignment(id: string, assignedUserId: string | null): Promise<Lead> {
    const res = await fetch(`${API_BASE}/leads/${id}/assignment`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ assignedUserId }),
    });
    const data = await handleResponse<{ lead: RawLead }>(res);
    return toLead(data.lead);
  },

  /**
   * Lists a lead's CRM notes (newest first), tenant-scoped by the server.
   */
  async listNotes(id: string): Promise<LeadNote[]> {
    const res = await fetch(`${API_BASE}/leads/${id}/notes`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ notes: RawLeadNote[] }>(res);
    return (data.notes || []).map(toNote);
  },

  /**
   * Creates a HUMAN note. The source is always 'human' (AI source is reserved
   * for trusted internal writes and never offered), and the author is always
   * the authenticated user — the client never supplies authorUserId.
   */
  async createNote(id: string, body: string): Promise<LeadNote> {
    const res = await fetch(`${API_BASE}/leads/${id}/notes`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ body, source: 'human' }),
    });
    const data = await handleResponse<{ note: RawLeadNote }>(res);
    return toNote(data.note);
  },

  /**
   * Reads the lead's CRM activity timeline exactly as the backend derives it
   * (events anchored by the lead and/or its 1:1 conversation).
   */
  async listActivity(id: string): Promise<LeadActivityEvent[]> {
    const res = await fetch(`${API_BASE}/leads/${id}/activity`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ activity: RawActivityEvent[] }>(res);
    return (data.activity || []).map(toActivity);
  },

  async create(input: LeadInput): Promise<Lead> {
    const res = await fetch(`${API_BASE}/leads`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ lead: RawLead }>(res);
    return toLead(data.lead);
  },

  async update(id: string, input: Partial<LeadInput>): Promise<Lead> {
    const res = await fetch(`${API_BASE}/leads/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ lead: RawLead }>(res);
    return toLead(data.lead);
  },

  async listNotifications(): Promise<{ notifications: LeadNotification[]; unread: number }> {
    const res = await fetch(`${API_BASE}/leads/notifications`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ notifications: RawNotification[]; unread: number }>(res);
    return {
      notifications: (data.notifications || []).map(toNotification),
      unread: data.unread || 0,
    };
  },

  async markNotificationsRead(): Promise<void> {
    const res = await fetch(`${API_BASE}/leads/notifications/read`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    await handleResponse<{ success: boolean }>(res);
  },
};