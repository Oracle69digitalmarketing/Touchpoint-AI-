
/**
 * PLAN LIMITS — single source of truth.
 *
 * Imported by both the frontend (re-exported from types.ts) and the Express
 * server (plan enforcement). Keeping the definition here prevents the client
 * and server copies from drifting apart.
 */
export const PLAN_LIMITS = {
  Free: {
    price: { NGN: 0, USD: 0 },
    agents: 1,
    touchpoints: 5,
    leads: 15,
    features: ['Basic Dashboard', 'Touchpoint Branding']
  },
  Starter: {
    price: { NGN: 7500, USD: 10 },
    agents: 1,
    touchpoints: 50,
    leads: 100,
    features: ['CRM Sync', 'Lead Export (CSV)', 'WhatsApp/Email Alerts', 'No Branding']
  },
  Growth: {
    price: { NGN: 20000, USD: 25 },
    agents: 5,
    touchpoints: 500,
    leads: 1000,
    features: ['Multi-user Access', 'Automation Engine', 'Advanced Analytics', 'Routing Rules']
  },
  Business: {
    price: { NGN: 50000, USD: 60 },
    agents: 20,
    touchpoints: 1000,
    leads: 5000,
    features: ['Role-based Permissions', 'Priority Support', 'Full Pipeline Mapping']
  },
  Enterprise: {
    price: { NGN: -1, USD: -1 },
    agents: 100,
    touchpoints: 5000,
    leads: 100000,
    features: ['White-label', 'NFC Hardware Orchestration', 'Dedicated Support']
  }
};
