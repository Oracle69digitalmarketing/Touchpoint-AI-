
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
  documents?: string[];
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

export interface CRMConnection {
  id: 'hubspot' | 'salesforce' | 'zoho';
  name: string;
  status: 'connected' | 'disconnected' | 'connecting';
  icon: string;
  lastSync?: string;
  error?: string;
}

export type SubscriptionPlan = 'Free' | 'Professional' | 'Enterprise Pro';

export const PLAN_LIMITS = {
  'Free': { agents: 1, touchpoints: 5, features: ['Basic Analytics'] },
  'Professional': { agents: 5, touchpoints: 50, features: ['CRM Sync', 'Pro Analytics'] },
  'Enterprise Pro': { agents: 100, touchpoints: 1000, features: ['NFC Hardware', 'Global Sync'] }
};

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
