
import { AnalyticsRange, AnalyticsOverview, TouchpointPerformance, AgentPerformance } from '../types';
import { getAuthHeaders } from './auth';

/**
 * ANALYTICS API CLIENT (authenticated)
 * Reads the business's tenant-scoped analytics. The server derives every
 * metric on demand from real persisted rows; the client never submits data,
 * only the validated `range` selector.
 */

const API_BASE = '/v1';

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export const analyticsService = {
  async overview(range: AnalyticsRange = '7d'): Promise<AnalyticsOverview> {
    const res = await fetch(`${API_BASE}/analytics/overview?range=${range}`, { headers: getAuthHeaders() });
    return handleResponse<AnalyticsOverview>(res);
  },

  async touchpoints(range: AnalyticsRange = '30d'): Promise<{ range: AnalyticsRange; touchpoints: TouchpointPerformance[] }> {
    const res = await fetch(`${API_BASE}/analytics/touchpoints?range=${range}`, { headers: getAuthHeaders() });
    return handleResponse<{ range: AnalyticsRange; touchpoints: TouchpointPerformance[] }>(res);
  },

  async agents(range: AnalyticsRange = '30d'): Promise<{ range: AnalyticsRange; agents: AgentPerformance[] }> {
    const res = await fetch(`${API_BASE}/analytics/agents?range=${range}`, { headers: getAuthHeaders() });
    return handleResponse<{ range: AnalyticsRange; agents: AgentPerformance[] }>(res);
  },
};
