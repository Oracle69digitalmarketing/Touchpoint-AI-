import { PLAN_LIMITS as PLAN_LIMITS_SOURCE } from './plan-limits.js';

export interface Business {
  id: string;
  name: string;
  slug: string;
  plan?: SubscriptionPlan;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  business: Business;
}

export enum AgentStatus {
  TRAINING = 'Training',
  ACTIVE = 'Active',
  INACTIVE = 'Inactive'
}

export enum SurfaceType {
  BUSINESS_CARD = 'Business Card',
  FLYER = 'Flyer',
  POSTER = 'Poster',
  NFC_TAG = 'NFC Tag',
  TABLE_TENT = 'Table Tent'
}

export enum ConversationStage {
  ENGAGE = 'engage',
  DISCOVER = 'discover',
  UNDERSTAND = 'understand',
  RECOMMEND = 'recommend',
  OBJECTION = 'objection',
  QUALIFY = 'qualify',
  ADVANCE = 'advance',
  CONVERT = 'convert'
}

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  industry: string;
  voice: string;
  leadsGenerated: number;
  conversionRate: number;
  description?: string;
  serviceCatalog?: string;
  clientProfiles?: string;
  caseLibrary?: string;
  guidelines?: string;
  documents?: string[];
  createdAt?: string;
}

export interface Touchpoint {
  id: string;
  name: string;
  type: SurfaceType;
  agentId: string;
  scans: number;
  active: boolean;
  location: string;
  trackingId: string;
  url?: string;
  agentName?: string;
  agentStatus?: AgentStatus;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  agentId: string;
  customerName: string;
  lastMessage: string;
  stage: ConversationStage;
  isQualified: boolean;
  timestamp: string;
  intent?: string;
  nextBestAction?: string;
  contactDeclined?: boolean;
}

export type LeadQualificationStatus = 'qualified' | 'unqualified' | 'pending';

/**
 * Operator-controlled CRM status. These exact persisted backend values are
 * fixed by the Phase 13F server contract; display labels may differ, the
 * stored values must not be renamed.
 */
export type CRMStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'opportunity'
  | 'customer'
  | 'unqualified'
  | 'lost'
  | 'do_not_contact';

export const CRM_STATUSES: CRMStatus[] = [
  'new',
  'contacted',
  'qualified',
  'opportunity',
  'customer',
  'unqualified',
  'lost',
  'do_not_contact',
];

export const CRM_STATUS_LABELS: Record<CRMStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  opportunity: 'Opportunity',
  customer: 'Customer',
  unqualified: 'Unqualified',
  lost: 'Lost',
  do_not_contact: 'Do Not Contact',
};

export interface Lead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  intent: string | null;
  qualificationScore: number;
  qualificationStatus: LeadQualificationStatus;
  source: 'auto' | 'manual';
  notified: boolean;
  touchpointId: string | null;
  touchpointName: string | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
  // Phase 13F CRM surface. Every field here mirrors what the backend returns
  // from publicCrmLead (GET /v1/leads, GET /v1/leads/:id and the mutation
  // responses). Nothing is invented client-side.
  crmStatus: CRMStatus;
  assignedUser: { id: string; name: string } | null;
  conversationCount: number;
  firstInteraction: string;
  lastInteraction: string | null;
  salesStage: string | null;
  conversationIntent: string | null;
  customerNeed: string | null;
  recommendedProduct: { id: string; name: string } | null;
  buyingSignal: boolean | null;
  objection: string | null;
  nextBestAction: string | null;
  channel: string | null;
  customerName: string | null;
}

/**
 * A CRM note on a lead. `authorUserId` is always server-assigned (the
 * authenticated user); `source` distinguishes an operator note ('human') from
 * a trusted internal/AI write ('ai') that the API never permits clients to
 * create.
 */
export interface LeadNote {
  id: string;
  leadId: string;
  authorUserId: string | null;
  body: string;
  source: 'human' | 'ai';
  createdAt: string;
  updatedAt: string;
}

/**
 * A single funnel activity event in a lead's CRM timeline. Fields mirror
 * publicCrmActivity; the frontend renders exactly what the backend returns and
 * never fabricates events.
 */
export interface LeadActivityEvent {
  id: string;
  eventType: string;
  conversationId: string | null;
  orderId: string | null;
  leadId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Bounded, filtered lead listing page as returned by GET /v1/leads.
 */
export interface LeadPage {
  leads: Lead[];
  total: number;
  limit: number;
  offset: number;
}

export interface LeadNotification {
  id: string;
  leadId: string;
  leadName: string | null;
  phone: string | null;
  email: string | null;
  qualificationScore: number;
  qualificationStatus: LeadQualificationStatus;
  readAt: string | null;
  createdAt: string;
}

export interface CRMConnection {
  id: 'hubspot' | 'salesforce' | 'zoho';
  name: string;
  status: 'connected' | 'disconnected' | 'connecting';
  icon: string;
  lastSync?: string;
  error?: string;
}

export type SubscriptionPlan = 'Free' | 'Starter' | 'Growth' | 'Business' | 'Enterprise';

export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'not_renewing';

/**
 * The tenant's server-authoritative billing state, as exposed by
 * GET /v1/billing/subscription. The effective plan/status is derived
 * server-side (resolveSubscription); the client only ever displays it.
 */
export interface Subscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  paystackCustomerCode: string | null;
  paystackSubscriptionCode: string | null;
  paystackPlanCode: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  expiresAt: string | null;
  lastReference: string | null;
}

export type PlanLimits = {
  price: { NGN: number; USD: number };
  agents: number;
  touchpoints: number;
  leads: number;
  products: number;
  features: string[];
};

/**
 * PLAN_LIMITS is owned by plan-limits.js (shared with the server so the same
 * numbers are enforced both client-side for UX and server-side as the source
 * of truth). Re-exported here for the existing frontend consumers.
 */
export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = PLAN_LIMITS_SOURCE;

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export interface Currency {
  code: string;
  symbol: string;
  name: string;
  rate: number;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', flag: '🇰🇪' },
  { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá', flag: '🇳🇬' }
];

export const SUPPORTED_CURRENCIES: Currency[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar', rate: 1 },
  { code: 'EUR', symbol: '€', name: 'Euro', rate: 0.92 },
  { code: 'GBP', symbol: '£', name: 'British Pound', rate: 0.79 },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', rate: 151 },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', rate: 1450 },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', rate: 83 }
];

export type AnalyticsRange = '24h' | '7d' | '30d' | 'all';

export type AnalyticsTrendUnit = 'hour' | 'day';

export interface AnalyticsTrendPoint {
  date: string;
  scans: number;
  conversations: number;
  leads: number;
  qualifiedLeads: number;
}

export interface AnalyticsTrend {
  unit: AnalyticsTrendUnit;
  start: string | null;
  end: string | null;
  points: AnalyticsTrendPoint[];
}

export interface AnalyticsOverview {
  range: AnalyticsRange;
  totals: {
    scans: number;
    conversations: number;
    leads: number;
    qualifiedLeads: number;
  };
  deltas: {
    scans: number | null;
    conversations: number | null;
    leads: number | null;
    qualifiedLeads: number | null;
  };
  qualificationRate: number;
  trends: AnalyticsTrend | null;
}

export interface TouchpointPerformance {
  id: string;
  name: string;
  type: string;
  location: string;
  active: boolean;
  trackingId: string;
  agentId: string;
  agentName: string;
  scans: number;
  conversations: number;
  leads: number;
  qualifiedLeads: number;
  qualificationRate: number;
}

export interface AgentPerformance {
  id: string;
  name: string;
  status: string;
  conversations: number;
  leads: number;
  qualifiedLeads: number;
  qualificationRate: number;
}

// Phase 13G: Conversion Pulse — exact server-returned shapes for the tenant's
// commercial pipeline. These mirror the backend's public serializers
// (publicOrder / publicBooking / publicIntent / /v1/analytics/funnel) so the
// operator UI never computes or assumes financial figures.

export interface FunnelEvents {
  [eventType: string]: number;
}

export interface FunnelAnalytics {
  range: AnalyticsRange;
  events: FunnelEvents;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Order {
  id: string;
  businessId: string;
  conversationId: string | null;
  leadId: string | null;
  channel: string;
  customerName: string | null;
  status: string;
  currency: string;
  subtotal: number;
  total: number;
  paymentStatus: string;
  fulfillmentStatus: string | null;
  metadata: Record<string, unknown>;
  items?: OrderItem[];
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentIntent {
  id: string;
  orderId: string;
  provider: string;
  status: string;
  providerReference: string | null;
  amountMinor: number;
  currency: string;
  checkout: Record<string, unknown>;
  failureReason: string | null;
  paidAmountMinor: number | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Booking {
  id: string;
  productId: string;
  productName: string | null;
  conversationId: string | null;
  leadId: string | null;
  customer: { name: string | null; phone: string | null; email: string | null };
  name: string | null;
  phone: string | null;
  email: string | null;
  timezone: string | null;
  durationMinutes: number | null;
  requestedStartAt: string;
  endAt: string;
  status: string;
  holdUntil: string | null;
  configVersion: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Phase 13H-2: Operator Configuration UI — Product Catalog / Business & Handoff
// / Booking Configuration. Node shapes below mirror the exact public
// serializers already served by the backend (publicProduct, publicHandoff,
// publicBookingConfig). Nothing is invented client-side.

export const PRODUCT_CURRENCIES = ['NGN', 'USD', 'EUR', 'GBP', 'JPY', 'INR'] as const;
export type ProductCurrency = (typeof PRODUCT_CURRENCIES)[number];

export const PRODUCT_STATUSES = ['active', 'inactive'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * A structured catalog item as returned by GET /v1/products. `price` is the
 * backend's NUMERIC(14,2) value coerced to a JS number by the server — the
 * frontend never re-calculates money and submits it back verbatim.
 */
export interface Product {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  currency: ProductCurrency;
  status: ProductStatus;
  bookable: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name: string;
  description?: string | null;
  category?: string | null;
  price: number;
  currency?: ProductCurrency;
  status?: ProductStatus;
  bookable?: boolean;
}

/**
 * Business handoff channels returned by GET /v1/business/handoff. Every field
 * is nullable: the backend permits each channel to be empty.
 */
export interface HandoffSettings {
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  bookingUrl: string | null;
}

export interface HandoffInput {
  whatsapp?: string | null;
  phone?: string | null;
  email?: string | null;
  bookingUrl?: string | null;
}

/**
 * Booking policy as returned by GET /v1/booking/configs (camelCase). The PUT
 * request body is snake_case; the service adapts between the two.
 */
export interface BookingConfig {
  productId: string;
  productName: string | null;
  productBookable: boolean;
  timezone: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  capacity: number;
  operatingHours: Record<string, string>;
  blackoutDates: string[];
  minAdvanceHours: number;
  maxAdvanceDays: number;
  autoConfirm: boolean;
  holdMinutes: number;
  allowReschedule: boolean;
  requiresPayment: boolean;
  configVersion: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The operator-editable booking policy fields. The remaining published fields
 * (operatingHours, blackoutDates, allowReschedule) are preserved unchanged on
 * a merged full-config save.
 */
export interface BookingConfigInput {
  timezone: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  capacity: number;
  minAdvanceHours: number;
  maxAdvanceDays: number;
  holdMinutes: number;
  autoConfirm: boolean;
  requiresPayment: boolean;
}

/**
 * Request-side constraint ranges the backend enforces (booking-time.js /
 * booking-provider.js). Mirrored for inline form hints only; the server remains
 * the source of truth.
 */
export const BOOKING_CONFIG_CONSTRAINTS = {
  slotDurationMinutes: { min: 5, max: 480 },
  bufferMinutes: { min: 0, max: 1440 },
  capacity: { min: 1, max: 100 },
  minAdvanceHours: { min: 0, max: 720 },
  maxAdvanceDays: { min: 1, max: 365 },
  holdMinutes: { min: 1, max: 1440 },
} as const;

/**
 * Booking timezone default: the operator's local zone when it resolves,
 * otherwise the lock-in fallback. Always left editable in the UI.
 */
export const defaultBookingTimezone = (): string => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz && tz.trim() ? tz : 'Africa/Lagos';
};
