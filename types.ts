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
  DIAGNOSE = 'diagnose',
  VALUE_MAP = 'value',
  OFFER = 'offer',
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
}

export type LeadQualificationStatus = 'qualified' | 'unqualified' | 'pending';

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
