
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

export type SubscriptionPlan = 'Free' | 'Starter' | 'Growth' | 'Business' | 'Enterprise';

export const PLAN_LIMITS = {
  'Free': { 
    price: { NGN: 0, USD: 0 }, 
    agents: 1, 
    touchpoints: 5, 
    leads: 15, 
    features: ['Basic Dashboard', 'Touchpoint Branding'] 
  },
  'Starter': { 
    price: { NGN: 7500, USD: 10 }, 
    agents: 1, 
    touchpoints: 50, 
    leads: 100, 
    features: ['CRM Sync', 'Lead Export (CSV)', 'WhatsApp/Email Alerts', 'No Branding'] 
  },
  'Growth': { 
    price: { NGN: 20000, USD: 25 }, 
    agents: 5, 
    touchpoints: 500, 
    leads: 1000, 
    features: ['Multi-user Access', 'Automation Engine', 'Advanced Analytics', 'Routing Rules'] 
  },
  'Business': { 
    price: { NGN: 50000, USD: 60 }, 
    agents: 20, 
    touchpoints: 1000, 
    leads: 5000, 
    features: ['Role-based Permissions', 'Priority Support', 'Full Pipeline Mapping'] 
  },
  'Enterprise': { 
    price: { NGN: -1, USD: -1 }, 
    agents: 100, 
    touchpoints: 5000, 
    leads: 100000, 
    features: ['White-label', 'NFC Hardware Orchestration', 'Dedicated Support'] 
  }
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
