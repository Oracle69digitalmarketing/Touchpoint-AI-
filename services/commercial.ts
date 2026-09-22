import { Booking, Order, PaymentIntent } from '../types';
import { getAuthHeaders } from './auth';

/**
 * COMMERCIAL API CLIENT (Phase 13G — READ-ONLY)
 *
 * Surfaces the business's server-authoritative commercial pipeline (orders,
 * payment intents, bookings) inside the operator dashboard. Every call is a
 * GET through the authenticated session; the server scopes results to the
 * authenticated business only, and the client never sends a tenant identifier.
 * This client creates, settles, confirms or changes nothing.
 */

const API_BASE = '/v1';

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export const commercialService = {
  async orders(): Promise<Order[]> {
    const res = await fetch(`${API_BASE}/orders`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ orders: Order[] }>(res);
    return data.orders || [];
  },

  async order(id: string): Promise<Order> {
    const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(id)}`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ order: Order }>(res);
    return data.order;
  },

  async orderPayment(id: string): Promise<PaymentIntent | null> {
    const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(id)}/payment`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ intent: PaymentIntent | null }>(res);
    return data.intent || null;
  },

  async bookings(): Promise<Booking[]> {
    const res = await fetch(`${API_BASE}/bookings`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ bookings: Booking[] }>(res);
    return data.bookings || [];
  },
};