import { BookingConfig, BookingConfigInput, HandoffInput, HandoffSettings, Product, ProductInput } from '../types';
import { getAuthHeaders } from './auth';

/**
 * PHASE 13H-2 — OPERATOR CONFIGURATION API CLIENT
 *
 * Product Catalog, Business & Handoff and Booking Configuration all persist
 * through the authenticated backend. The server is the source of truth for
 * tenant scoping; the client attaches the session token via getAuthHeaders()
 * and never sends a business identifier.
 *
 * Endpoints used (all pre-existing):
 *   GET    /v1/products                      list the tenant's products
 *   POST   /v1/products                      create a product
 *   PUT    /v1/products/:id                  update a product (partial)
 *   DELETE /v1/products/:id                  delete a product (409 when in order)
 *   GET    /v1/business/handoff              read handoff channels
 *   PUT    /v1/business/handoff              persist handoff channels
 *   GET    /v1/booking/configs               list booking policies (camelCase)
 *   PUT    /v1/products/:id/booking-config   save a booking policy (snake_case)
 */

const API_BASE = '/v1';

/**
 * Error carrying the useful server response details so callers can show the
 * real backend problem (status, error/message, machine code and field-level
 * validation) instead of a generic message.
 */
export class ApiError extends Error {
  status: number | null;
  code: string | null;
  fields: Record<string, string> | null;

  constructor(message: string, options: { status?: number | null; code?: string | null; fields?: Record<string, string> | null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.fields = options.fields ?? null;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fields = data && typeof data.fields === 'object' && data.fields !== null ? (data.fields as Record<string, string>) : null;
    throw new ApiError(data.error || data.message || `Request failed (${res.status})`, {
      status: res.status,
      code: typeof data.code === 'string' ? data.code : null,
      fields,
    });
  }
  return data as T;
}

interface RawProduct {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  currency: string;
  status: string;
  bookable: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const toProduct = (raw: RawProduct): Product => ({
  id: raw.id,
  name: raw.name,
  description: raw.description,
  category: raw.category,
  price: raw.price,
  currency: raw.currency as Product['currency'],
  status: raw.status as Product['status'],
  bookable: raw.bookable,
  metadata: raw.metadata || {},
  createdAt: raw.createdAt,
  updatedAt: raw.updatedAt,
});

const toHandoff = (raw: HandoffSettings): HandoffSettings => ({
  whatsapp: raw.whatsapp ?? null,
  phone: raw.phone ?? null,
  email: raw.email ?? null,
  bookingUrl: raw.bookingUrl ?? null,
});

const toBookingConfig = (raw: BookingConfig): BookingConfig => ({
  productId: raw.productId,
  productName: raw.productName ?? null,
  productBookable: raw.productBookable,
  timezone: raw.timezone,
  slotDurationMinutes: Number(raw.slotDurationMinutes),
  bufferMinutes: Number(raw.bufferMinutes),
  capacity: Number(raw.capacity),
  operatingHours: raw.operatingHours || {},
  blackoutDates: raw.blackoutDates || [],
  minAdvanceHours: Number(raw.minAdvanceHours),
  maxAdvanceDays: Number(raw.maxAdvanceDays),
  autoConfirm: raw.autoConfirm,
  holdMinutes: Number(raw.holdMinutes),
  allowReschedule: raw.allowReschedule,
  requiresPayment: raw.requiresPayment,
  configVersion: Number(raw.configVersion),
  createdAt: raw.createdAt,
  updatedAt: raw.updatedAt,
});

export const productService = {
  async list(): Promise<Product[]> {
    const res = await fetch(`${API_BASE}/products`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ products: RawProduct[] }>(res);
    return (data.products || []).map(toProduct);
  },

  async create(input: ProductInput): Promise<Product> {
    const res = await fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ product: RawProduct }>(res);
    return toProduct(data.product);
  },

  async update(id: string, input: Partial<ProductInput>): Promise<Product> {
    const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ product: RawProduct }>(res);
    return toProduct(data.product);
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    await handleResponse<{ success: boolean }>(res);
  },
};

export const handoffService = {
  async get(): Promise<HandoffSettings> {
    const res = await fetch(`${API_BASE}/business/handoff`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ handoff: HandoffSettings }>(res);
    return toHandoff(data.handoff);
  },

  async update(input: HandoffInput): Promise<HandoffSettings> {
    const res = await fetch(`${API_BASE}/business/handoff`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ handoff: HandoffSettings }>(res);
    return toHandoff(data.handoff);
  },
};

/**
 * Booking Configuration.
 *
 * The backend has no per-product config GET; the tenant's full list is
 * available at GET /v1/booking/configs and each row is tenant-scoped, so the
 * load is that list filtered to the target product.
 *
 * PUT /v1/products/:id/booking-config accepts a snake_case body and the
 * server normalizes missing fields to defaults. To avoid silently resetting
 * fields the operator UI does not edit (operating_hours, blackout_dates,
 * allow_reschedule), the save is a merged full-config save: read the existing
 * policy, merge the edited fields over it, then submit the whole config.
 */
export const bookingConfigService = {
  async get(productId: string): Promise<BookingConfig | null> {
    const res = await fetch(`${API_BASE}/booking/configs`, { headers: getAuthHeaders() });
    const data = await handleResponse<{ configs: BookingConfig[] }>(res);
    const match = (data.configs || []).find((c) => c.productId === productId);
    return match ? toBookingConfig(match) : null;
  },

  async save(productId: string, input: BookingConfigInput): Promise<BookingConfig> {
    const existing = await this.get(productId);
    const merged = existing ?? {
      productId,
      productName: null,
      productBookable: true,
      timezone: input.timezone,
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      capacity: 1,
      operatingHours: {},
      blackoutDates: [],
      minAdvanceHours: 1,
      maxAdvanceDays: 90,
      autoConfirm: true,
      holdMinutes: 15,
      allowReschedule: true,
      requiresPayment: false,
      configVersion: 0,
      createdAt: '',
      updatedAt: '',
    };
    const payload = {
      timezone: input.timezone,
      slot_duration_minutes: input.slotDurationMinutes,
      buffer_minutes: input.bufferMinutes,
      capacity: input.capacity,
      min_advance_hours: input.minAdvanceHours,
      max_advance_days: input.maxAdvanceDays,
      hold_minutes: input.holdMinutes,
      auto_confirm: input.autoConfirm,
      requires_payment: input.requiresPayment,
      allow_reschedule: merged.allowReschedule,
      operating_hours: merged.operatingHours,
      blackout_dates: merged.blackoutDates,
    };

    const res = await fetch(`${API_BASE}/products/${encodeURIComponent(productId)}/booking-config`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload),
    });
    const data = await handleResponse<{ config: BookingConfig }>(res);
    return toBookingConfig(data.config);
  },
};