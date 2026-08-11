
import { Agent, AgentStatus, Touchpoint, SurfaceType } from '../types';
import { getAuthHeaders } from './auth';

/**
 * WORKSPACE API CLIENT (agents + touchpoints)
 * All persistence happens through the authenticated backend. The server is the
 * source of truth for ids, tracking ids, tenant scoping and plan limits; the
 * client only ever submits business data, never a business_id.
 */

const API_BASE = '/v1';

export interface AgentInput {
  name: string;
  industry?: string;
  voice?: string;
  status?: AgentStatus;
  description?: string;
  serviceCatalog?: string;
  clientProfiles?: string;
  caseLibrary?: string;
  guidelines?: string;
  documents?: string[];
}

export interface TouchpointInput {
  name: string;
  type: SurfaceType;
  agentId: string;
  location?: string;
  active?: boolean;
}

interface RawAgent {
  id: string;
  name: string;
  status: string;
  industry: string;
  voice: string;
  description: string | null;
  serviceCatalog: string | null;
  clientProfiles: string | null;
  caseLibrary: string | null;
  guidelines: string | null;
  documents: string[];
  leadsGenerated: number;
  conversionRate: number;
  createdAt: string;
}

interface RawTouchpoint {
  id: string;
  name: string;
  type: string;
  agentId: string;
  agentName: string;
  agentStatus: string;
  scans: number;
  active: boolean;
  location: string;
  trackingId: string;
  url: string;
  createdAt: string;
}

const toAgent = (raw: RawAgent): Agent => ({
  id: raw.id,
  name: raw.name,
  status: raw.status as AgentStatus,
  industry: raw.industry,
  voice: raw.voice,
  description: raw.description ?? undefined,
  serviceCatalog: raw.serviceCatalog ?? undefined,
  clientProfiles: raw.clientProfiles ?? undefined,
  caseLibrary: raw.caseLibrary ?? undefined,
  guidelines: raw.guidelines ?? undefined,
  documents: raw.documents ?? [],
  leadsGenerated: raw.leadsGenerated,
  conversionRate: raw.conversionRate,
  createdAt: raw.createdAt,
});

const toTouchpoint = (raw: RawTouchpoint): Touchpoint => ({
  id: raw.id,
  name: raw.name,
  type: raw.type as SurfaceType,
  agentId: raw.agentId,
  agentName: raw.agentName,
  agentStatus: raw.agentStatus as AgentStatus,
  scans: raw.scans,
  active: raw.active,
  location: raw.location,
  trackingId: raw.trackingId,
  url: raw.url,
  createdAt: raw.createdAt,
});

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export const agentService = {
  async list(): Promise<Agent[]> {
    const res = await fetch(`${API_BASE}/agents`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ agents: RawAgent[] }>(res);
    return (data.agents || []).map(toAgent);
  },

  async create(input: AgentInput): Promise<Agent> {
    const res = await fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ agent: RawAgent }>(res);
    return toAgent(data.agent);
  },

  async update(id: string, input: Partial<AgentInput>): Promise<Agent> {
    const res = await fetch(`${API_BASE}/agents/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ agent: RawAgent }>(res);
    return toAgent(data.agent);
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/agents/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    await handleResponse<{ success: boolean }>(res);
  },
};

export const touchpointService = {
  async list(): Promise<Touchpoint[]> {
    const res = await fetch(`${API_BASE}/touchpoints`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ touchpoints: RawTouchpoint[] }>(res);
    return (data.touchpoints || []).map(toTouchpoint);
  },

  async create(input: TouchpointInput): Promise<Touchpoint> {
    const res = await fetch(`${API_BASE}/touchpoints`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ touchpoint: RawTouchpoint }>(res);
    return toTouchpoint(data.touchpoint);
  },

  async update(id: string, input: Partial<TouchpointInput>): Promise<Touchpoint> {
    const res = await fetch(`${API_BASE}/touchpoints/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ touchpoint: RawTouchpoint }>(res);
    return toTouchpoint(data.touchpoint);
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/touchpoints/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    await handleResponse<{ success: boolean }>(res);
  },
};
