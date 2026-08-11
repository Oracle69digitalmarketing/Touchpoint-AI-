
import { Subscription, SubscriptionPlan } from '../types';
import { getAuthHeaders } from './auth';

/**
 * BILLING API CLIENT (Phase 7)
 *
 * The browser never talks to Paystack directly and never decides an amount,
 * currency, plan or reference. It only tells the server which plan it wants;
 * the server initializes the Paystack checkout and returns an access code the
 * Paystack widget opens. Entitlement is granted exclusively by the server after
 * Paystack confirms the charge.
 */

const API_BASE = '/v1';

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface InitializeResult {
  reference: string;
  accessCode: string;
  authorizationUrl: string;
  plan: SubscriptionPlan;
  currency: string;
  amount: number;
  email: string;
  subscription?: Subscription;
}

export const billingService = {
  async subscription(): Promise<Subscription> {
    const res = await fetch(`${API_BASE}/billing/subscription`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ subscription: Subscription }>(res);
    return data.subscription;
  },

  async initialize(plan: SubscriptionPlan, currency: string): Promise<InitializeResult> {
    const res = await fetch(`${API_BASE}/billing/initialize`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ plan, currency }),
    });
    const data = await handleResponse<InitializeResult>(res);
    return data;
  },

  async verify(reference: string): Promise<{ subscription: Subscription; transaction: { status: string } }> {
    const res = await fetch(`${API_BASE}/billing/verify?reference=${encodeURIComponent(reference)}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<{ subscription: Subscription; transaction: { status: string } }>(res);
  },

  async cancel(): Promise<Subscription> {
    const res = await fetch(`${API_BASE}/billing/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ subscription: Subscription }>(res);
    return data.subscription;
  },
};
