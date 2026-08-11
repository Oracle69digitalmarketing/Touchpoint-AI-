
import { Lead, LeadNotification, LeadQualificationStatus } from '../types';
import { getAuthHeaders } from './auth';

/**
 * LEADS API CLIENT (authenticated)
 * Surfaces the business's persisted leads and in-app notifications. The server
 * is the source of truth for extraction, qualification, tenant scoping and
 * plan limits; the client only submits business data.
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

const toLead = (raw: RawLead): Lead => ({
  ...raw,
  qualificationStatus: raw.qualificationStatus as LeadQualificationStatus,
  source: raw.source as Lead['source'],
});

const toNotification = (raw: RawNotification): LeadNotification => ({
  ...raw,
  qualificationStatus: raw.qualificationStatus as LeadQualificationStatus,
});

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export const leadService = {
  async list(): Promise<Lead[]> {
    const res = await fetch(`${API_BASE}/leads`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ leads: RawLead[] }>(res);
    return (data.leads || []).map(toLead);
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
