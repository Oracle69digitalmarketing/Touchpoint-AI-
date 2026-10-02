
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
    products: 5,
    features: ['Basic Dashboard', 'Up to 1 AI agent', 'Up to 5 touchpoints', 'Up to 5 products', 'Up to 15 leads']
  },
  Starter: {
    price: { NGN: 7500, USD: 10 },
    agents: 1,
    touchpoints: 50,
    leads: 100,
    products: 50,
    features: ['CRM Sync', 'Up to 1 AI agent', 'Up to 50 touchpoints', 'Up to 50 products', 'Up to 100 leads']
  },
  Growth: {
    price: { NGN: 20000, USD: 25 },
    agents: 5,
    touchpoints: 500,
    leads: 1000,
    products: 200,
    features: ['Up to 5 AI agents', 'Up to 500 touchpoints', 'Up to 200 products', 'Up to 1,000 leads']
  },
  Business: {
    price: { NGN: 50000, USD: 60 },
    agents: 20,
    touchpoints: 1000,
    leads: 5000,
    products: 500,
    features: ['Up to 20 AI agents', 'Up to 1,000 touchpoints', 'Up to 500 products', 'Up to 5,000 leads']
  },
  Enterprise: {
    price: { NGN: -1, USD: -1 },
    agents: 100,
    touchpoints: 5000,
    leads: 100000,
    products: 1000,
    features: ['Up to 100 AI agents', 'Up to 5,000 touchpoints', 'Up to 1,000 products', 'Up to 100,000 leads']
  }
};
