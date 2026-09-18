/**
 * PHASE 11 SALES STATE + STRUCTURED CATALOG tests (Batch 2)
 *
 * Batch 2 makes the server the source of truth for a minimum viable sales
 * foundation:
 *
 *   A. structured product/service catalog (authoritative when present, with
 *      the legacy free-text agents.service_catalog kept as a compatibility
 *      fallback),
 *   B. per-business handoff channels (only persisted channels may be offered),
 *   C. persistent conversational sales state (stage/intent/need/recommendation/
 *      buying signal/objection/questions/lead fields/next best action) owned
 *      and progressed by the server,
 *   D. deterministic state derivation (intent normalization + forward-only
 *      stage progression),
 *   E. question memory across resumed conversations,
 *   F. server-derived next best action,
 *   H. sandbox/public parity (agent resolved from the authenticated
 *      business/agent relationship, same state logic),
 *   J. the 18 required coverage points.
 *
 * The Groq client is swapped for a deterministic fake via the _setGroqClient
 * seam, so no live API key is needed. PostgreSQL-backed.
 *
 * Run with: NODE_ENV=test node --test tests/ (requires a local test database).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret-for-phase11-sales-state';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';

const testPool = await setupTestDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const serverDistDir = path.join(__dirname, '..', 'dist');
fs.mkdirSync(serverDistDir, { recursive: true });
const tHtmlPath = path.join(serverDistDir, 't.html');
if (!fs.existsSync(tHtmlPath)) {
  fs.writeFileSync(
    tHtmlPath,
    '<!DOCTYPE html><html><head><title>Touchpoint Chat</title></head><body><div id="root"></div><script type="application/json" id="touchpoint-data">__TOUCHPOINT_DATA__</script></body></html>'
  );
}

const { default: app, _setGroqClient } = await import(path.join(__dirname, '..', 'server.js'));

const capturedSystemPrompts = [];
let fakeExtraction = { name: null, phone: null, email: null, intent: null, qualificationScore: 0 };
let replyOverride = null;

_setGroqClient({
  chat: {
    completions: {
      create: async ({ messages }) => {
        const system = (messages.find((m) => m.role === 'system') || {}).content || '';
        if (system.includes('lead qualification engine')) {
          return {
            choices: [{ message: { content: JSON.stringify(fakeExtraction) } }],
          };
        }
        capturedSystemPrompts.push(system);
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (replyOverride) {
          return { choices: [{ message: { content: replyOverride } }] };
        }
        return {
          choices: [{
            message: { content: `Mock reply to: ${lastUser ? lastUser.content : ''}` },
          }],
        };
      },
    },
  },
});

const latestSalesPrompt = () => {
  const prompts = capturedSystemPrompts.filter((p) => p.includes('IDENTITY AND ROLE'));
  return prompts[prompts.length - 1] || '';
};

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.close();
  await cleanupTestDb(testPool);
  const { closeDatabase } = await import('../db-pg.js');
  await closeDatabase();
});

const request = async (url, { method = 'GET', body, token, raw = false } = {}) => {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text() };
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const register = (payload) => request('/v1/auth/register', { method: 'POST', body: payload });

const createAgent = async (token, payload) =>
  (await request('/v1/agents', { method: 'POST', body: payload, token })).body.agent;

const createTouchpoint = async (token, payload) =>
  (await request('/v1/touchpoints', { method: 'POST', body: payload, token })).body.touchpoint;

const sendPublic = (trackingId, message, conversationId) =>
  request(`/v1/t/${trackingId}/messages`, {
    method: 'POST',
    body: { message, customerName: 'Ada', targetLanguage: 'en', conversationId },
  });

// The public chat endpoint does NOT return internal sales state (Batch 2.1):
// the authoritative state is read back through the authenticated dashboard.
const salesStateFor = async (token, conversationId) => {
  const dash = (await request('/v1/conversations', { token })).body.conversations;
  return dash.find((c) => c.id === conversationId) || null;
};

const createProduct = (token, payload) =>
  request('/v1/products', { method: 'POST', body: payload, token });

// Shared fixtures
let acme;
let acmeAgentId;
let acmeTrackingId;
let acmeProductId;
let beta;
let betaAgentId;
let betaTrackingId;
let zeta;
let zetaAgentId;
let zetaTrackingId;

test('setup: register businesses, agents, touchpoints and structured products', async () => {
  acme = (await register({
    email: 'acme@phase11.test',
    password: 'password123',
    name: 'Acme Owner',
    businessName: 'Acme Gardens',
  })).body;

  acmeAgentId = (await createAgent(acme.token, {
    name: 'Acme Garden Bot',
    industry: 'Landscaping',
    voice: 'professional',
    description: 'Rooftop and garden consulting',
    serviceCatalog: 'Legacy free-text catalog that must NOT win once structured products exist.',
  })).id;

  const acmeTp = await createTouchpoint(acme.token, {
    name: 'Acme Planter',
    type: 'Business Card',
    location: 'Lagos HQ',
    agentId: acmeAgentId,
  });
  acmeTrackingId = acmeTp.trackingId;

  // Structured product — authoritative for the prompt once present.
  const product = (await createProduct(acme.token, {
    name: 'Rooftop Garden Setup',
    description: 'Complete rooftop garden design, soil, and installation',
    category: 'Landscaping',
    price: 45000,
    currency: 'NGN',
    status: 'active',
  })).body.product;
  acmeProductId = product.id;

  beta = (await register({
    email: 'beta@phase11.test',
    password: 'password123',
    name: 'Beta Owner',
    businessName: 'Beta Designs',
  })).body;

  betaAgentId = (await createAgent(beta.token, {
    name: 'Beta Bot',
    industry: 'Design',
    voice: 'professional',
    description: 'Design studio',
  })).id;

  const betaTp = await createTouchpoint(beta.token, {
    name: 'Beta Flyer',
    type: 'Flyer',
    location: 'Abuja',
    agentId: betaAgentId,
  });
  betaTrackingId = betaTp.trackingId;

  zeta = (await register({
    email: 'zeta@phase11.test',
    password: 'password123',
    name: 'Zeta Owner',
    businessName: 'Zeta Cleaners',
  })).body;

  zetaAgentId = (await createAgent(zeta.token, {
    name: 'Zeta Bot',
    industry: 'Cleaning',
    voice: 'professional',
    description: 'Cleaning services',
    serviceCatalog: 'Canopy Cleaning (Service CA-1) available at 25000 Naira per session',
  })).id;

  const zetaTp = await createTouchpoint(zeta.token, {
    name: 'Zeta Card',
    type: 'Business Card',
    location: 'Ibadan',
    agentId: zetaAgentId,
  });
  zetaTrackingId = zetaTp.trackingId;
});

// --- 1. Product/service CRUD ownership -------------------------------------

test('product CRUD is scoped to the owning business', async () => {
  const listAcme = (await request('/v1/products', { token: acme.token })).body.products;
  assert.ok(listAcme.some((p) => p.id === acmeProductId), 'owner sees the product');

  const updated = (await request(`/v1/products/${acmeProductId}`, {
    method: 'PUT',
    token: acme.token,
    body: { price: 48000 },
  })).body.product;
  assert.equal(Number(updated.price), 48000);

  // Beta cannot update or delete Acme's product.
  const betaUpdate = await request(`/v1/products/${acmeProductId}`, {
    method: 'PUT',
    token: beta.token,
    body: { price: 1 },
  });
  assert.equal(betaUpdate.status, 404);

  const betaDelete = await request(`/v1/products/${acmeProductId}`, {
    method: 'DELETE',
    token: beta.token,
  });
  assert.equal(betaDelete.status, 404);

  // Owner can delete.
  const del = await request(`/v1/products/${acmeProductId}`, {
    method: 'DELETE',
    token: acme.token,
  });
  assert.equal(del.status, 200);
  const afterDelete = (await request('/v1/products', { token: acme.token })).body.products;
  assert.ok(!afterDelete.some((p) => p.id === acmeProductId), 'product removed');
});

// --- 2. Cross-tenant catalog isolation -------------------------------------

test('catalogs are fully isolated between tenants', async () => {
  const betaProducts = (await request('/v1/products', { token: beta.token })).body.products;
  assert.equal(betaProducts.length, 0, 'beta sees no acme products');

  // Recreate acme's product for the downstream prompt tests. Deletion gave it a
  // fresh id, so the fixture must re-bind acmeProductId to the recreated row.
  const recreated = (await createProduct(acme.token, {
    name: 'Rooftop Garden Setup',
    description: 'Complete rooftop garden design, soil, and installation',
    category: 'Landscaping',
    price: 45000,
    currency: 'NGN',
  })).body.product;
  assert.ok(recreated && typeof recreated.id === 'string', 'owned product recreated');
  acmeProductId = recreated.id;

  const betaRead = await request('/v1/products', { token: beta.token });
  assert.ok(!JSON.stringify(betaRead.body).includes('Rooftop Garden Setup'), 'catalog never leaks');
});

// --- 3. Structured catalog plan limits -------------------------------------

test('structured catalog respects the plan product limit', async () => {
  const lite = (await register({
    email: 'lite@phase11.test',
    password: 'password123',
    name: 'Lite Owner',
    businessName: 'Lite Goods',
  })).body;

  const FREE_PRODUCT_LIMIT = 5;
  for (let i = 1; i <= FREE_PRODUCT_LIMIT; i++) {
    const res = await createProduct(lite.token, { name: `Item ${i}`, price: 100 + i });
    assert.equal(res.status, 201, `product ${i} fits the Free limit`);
  }

  const over = await createProduct(lite.token, { name: 'Item 6', price: 999 });
  assert.equal(over.status, 403);
  assert.equal(over.body.code, 'PLAN_LIMIT_EXCEEDED');

  const list = (await request('/v1/products', { token: lite.token })).body.products;
  assert.equal(list.length, FREE_PRODUCT_LIMIT);
});

// --- 4. Existing free-text catalog compatibility ---------------------------

test('legacy free-text catalog remains usable and reaches the prompt without structured products', async () => {
  capturedSystemPrompts.length = 0;
  const res = await sendPublic(zetaTrackingId, 'What do you offer?');
  assert.equal(res.status, 200);

  const prompt = latestSalesPrompt();
  assert.ok(prompt.includes('Canopy Cleaning (Service CA-1)'), 'free-text catalog still supplies the prompt');
  assert.ok(prompt.includes('25000 Naira'), 'free-text price reaches the prompt');
});

// --- 5. Authoritative price passed to the prompt ---------------------------

test('structured catalog is authoritative and its price reaches the prompt', async () => {
  capturedSystemPrompts.length = 0;
  const res = await sendPublic(acmeTrackingId, 'I need rooftop gardening for my hotel');
  assert.equal(res.status, 200);

  const prompt = latestSalesPrompt();
  assert.ok(prompt.includes('Rooftop Garden Setup'), 'structured product name reaches the prompt');
  assert.ok(prompt.includes('NGN 45000'), 'authoritative price reaches the prompt');
  assert.ok(!prompt.includes('Legacy free-text catalog that must NOT win'), 'structured catalog takes precedence');
  const state = await salesStateFor(acme.token, res.body.conversationId);
  assert.ok(state.recommendedProductId, 'server recommended the matching product');
  assert.equal(state.recommendedProductId, acmeProductId);
});

// --- 6. No catalog leakage through the public bootstrap --------------------

test('the public bootstrap payload never exposes the structured catalog', async () => {
  const resolved = await request(`/v1/t/${acmeTrackingId}`);
  const json = JSON.stringify(resolved.body);
  assert.ok(!json.includes('Rooftop Garden Setup'), 'catalog absent from the JSON bootstrap');

  const html = await request(`/t/${acmeTrackingId}`, { raw: true });
  assert.ok(!html.text.includes('Rooftop Garden Setup'), 'catalog absent from the HTML payload');
  assert.ok(html.text.includes('Acme Garden Bot'), 'agent identity still present');
});

test('public chat responses never expose internal sales-state fields', async () => {
  capturedSystemPrompts.length = 0;
  const res = await sendPublic(acmeTrackingId, 'I need rooftop gardening for my hotel');
  assert.equal(res.status, 200);

  assert.equal(res.body.sales, undefined, 'no sales block in the public response');
  const body = JSON.stringify(res.body);
  assert.ok(!body.includes('nextBestAction'), 'next best action not exposed');
  assert.ok(!body.includes('recommendedProductId'), 'recommended product not exposed');
  assert.ok(!body.includes('capturedLeadFields'), 'captured lead fields not exposed');
  assert.ok(!body.includes('questionsAsked'), 'question memory not exposed');
  assert.ok(!body.includes('buying_signal'), 'buying signal not exposed');
  assert.ok(!body.includes('customer_need'), 'customer need not exposed');

  // Customer-facing contract is preserved: the exchange itself, the id, and
  // the agent identity are still returned.
  assert.ok(res.body.conversationId, 'conversationId present');
  assert.ok(Array.isArray(res.body.messages), 'messages present');
  assert.equal(res.body.messages.length, 2, 'customer + agent messages returned');
});

// --- 7. Handoff channels are tenant-scoped ---------------------------------

test('handoff channels persist per business and are tenant-scoped', async () => {
  const put = await request('/v1/business/handoff', {
    method: 'PUT',
    token: acme.token,
    body: {
      whatsapp: '+2348012345678',
      phone: '+2348098765432',
      email: 'sales@acme.test',
      bookingUrl: 'https://acme.test/book',
    },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.handoff.whatsapp, '+2348012345678');
  assert.equal(put.body.handoff.bookingUrl, 'https://acme.test/book');

  const acmeHandoff = (await request('/v1/business/handoff', { token: acme.token })).body.handoff;
  assert.equal(acmeHandoff.email, 'sales@acme.test');

  // Beta never sees acme's channels.
  const betaHandoff = (await request('/v1/business/handoff', { token: beta.token })).body.handoff;
  assert.equal(betaHandoff.whatsapp, null);
  assert.equal(betaHandoff.email, null);
  assert.equal(betaHandoff.phone, null);
  assert.equal(betaHandoff.bookingUrl, null);
});

test('configured handoff channels reach the prompt; unconfigured businesses get none', async () => {
  capturedSystemPrompts.length = 0;
  const res = await sendPublic(acmeTrackingId, 'How can I reach someone directly?');
  assert.equal(res.status, 200);

  const acmePrompt = latestSalesPrompt();
  assert.ok(acmePrompt.includes('AUTHORITATIVE HANDOFF CHANNELS'), 'handoff block present when configured');
  assert.ok(acmePrompt.includes('+2348012345678'), 'configured WhatsApp is offered');
  assert.ok(acmePrompt.includes('sales@acme.test'), 'configured email is offered');

  capturedSystemPrompts.length = 0;
  await sendPublic(zetaTrackingId, 'How can I reach someone directly?');
  const zetaPrompt = latestSalesPrompt();
  assert.ok(!zetaPrompt.includes('AUTHORITATIVE HANDOFF CHANNELS (server database)'), 'no handoff block when nothing is configured');
});

// --- 8. Conversation state persistence + 10. stage progression -------------

test('stage progression is persisted server-side across messages', async () => {
  let conversationId;
  const expected = [
    { message: 'Hello there', stage: 'discover' },
    { message: 'I need rooftop gardening for my hotel', stage: 'understand' },
    { message: 'Which of your packages do you recommend?', stage: 'recommend' },
    { message: 'That package is too expensive for my budget', stage: 'objection' },
    { message: 'I am ready to buy, here is my number 08012345678', stage: 'convert' },
  ];

  for (const step of expected) {
    const res = await sendPublic(acmeTrackingId, step.message, conversationId);
    assert.equal(res.status, 200, `message "${step.message}" accepted`);
    conversationId = res.body.conversationId;
    const state = await salesStateFor(acme.token, conversationId);
    assert.equal(state.stage, step.stage, `stage after "${step.message}"`);
    assert.equal(state.buyingSignal, step.stage === 'convert', 'buying signal latched on');
  }

  // The authenticated dashboard agrees with the persisted state.
  const dash = (await request('/v1/conversations', { token: acme.token })).body.conversations;
  const mine = dash.find((c) => c.id === conversationId);
  assert.ok(mine, 'conversation visible to owner');
  assert.equal(mine.stage, 'convert');
  assert.equal(mine.intent, 'buying_signal');
  assert.equal(mine.capturedLeadFields.phone, '08012345678');
  assert.equal(mine.objection, null, 'objection cleared once a buying signal resolves it');
});

// --- 9. State survives conversation resumption ------------------------------

test('sales state and question memory survive resumption', async () => {
  capturedSystemPrompts.length = 0;
  replyOverride = 'To recommend the best fit, may I ask what your monthly budget is?';
  let first;
  try {
    first = await sendPublic(acmeTrackingId, 'I need rooftop gardening for my hotel');
  } finally {
    replyOverride = null;
  }
  assert.equal(first.status, 200);
  const firstState = await salesStateFor(acme.token, first.body.conversationId);
  assert.ok(
    firstState.questionsAsked.some((q) => q.includes('monthly budget')),
    'agent question remembered after the first exchange'
  );

  // Second exchange — a new day, same conversation id.
  const resumed = await sendPublic(acmeTrackingId, 'It is about 50000 naira', first.body.conversationId);
  assert.equal(resumed.status, 200);
  const resumedState = await salesStateFor(acme.token, resumed.body.conversationId);
  assert.ok(
    resumedState.questionsAsked.some((q) => q.includes('monthly budget')),
    'question memory persists across resumption'
  );

  const prompt = latestSalesPrompt();
  assert.ok(prompt.includes('monthly budget'), 'resumed prompt is told the question was already asked');
  assert.ok(prompt.includes('QUESTIONS ALREADY ASKED'), 'question memory block present');
});

// --- 11. Intent normalization ----------------------------------------------

test('customer intents are normalized to the canonical set', async () => {
  let conversationId;
  const cases = [
    { message: 'What do you offer?', intent: 'product_inquiry' },
    { message: 'How much is the rooftop garden service?', intent: 'price_inquiry' },
    { message: 'That sounds too expensive', intent: 'price_objection' },
    { message: 'Do you have proof this is legit?', intent: 'trust_objection' },
    { message: "I'll think about it", intent: 'think_about_it' },
    { message: 'Can I talk to a human representative?', intent: 'human_assistance' },
  ];

  for (const c of cases) {
    const res = await sendPublic(acmeTrackingId, c.message, conversationId);
    assert.equal(res.status, 200);
    conversationId = res.body.conversationId;
    const state = await salesStateFor(acme.token, conversationId);
    assert.equal(state.intent, c.intent, `intent for "${c.message}"`);
  }
});

test('ambiguous input retains validated prior intent and never regresses stage', async () => {
  // Fresh conversation: anchor a clear intent and stage first.
  const first = await sendPublic(acmeTrackingId, 'How much is the rooftop garden service?');
  assert.equal(first.status, 200);
  const conversationId = first.body.conversationId;
  let state = await salesStateFor(acme.token, conversationId);
  assert.equal(state.intent, 'price_inquiry');
  assert.equal(state.stage, 'discover');

  // A message with no recognizable signal must not jump stage or clobber intent.
  const ambiguous = await sendPublic(acmeTrackingId, 'hmm okay, that is cute', conversationId);
  assert.equal(ambiguous.status, 200);
  state = await salesStateFor(acme.token, conversationId);
  assert.equal(state.intent, 'price_inquiry', 'unknown intent falls back to validated prior intent');
  assert.equal(state.stage, 'discover', 'ambiguous message does not force a stage transition');
});

// --- 14. Next-best-action derivation ----------------------------------------

test('next-best-action is derived deterministically by the server', async () => {
  let conversationId;
  const cases = [
    { message: 'I need a rooftop garden for my hotel', action: 'recommend_product' },
    { message: 'How much is it?', action: 'explain_price' },
    { message: "That's too expensive", action: 'handle_price_objection' },
    { message: "I'm ready to buy", action: 'request_contact' },
    { message: 'my number is 08112233445', action: 'close' },
  ];

  for (const c of cases) {
    const res = await sendPublic(acmeTrackingId, c.message, conversationId);
    assert.equal(res.status, 200);
    conversationId = res.body.conversationId;
    const state = await salesStateFor(acme.token, conversationId);
    assert.equal(state.nextBestAction, c.action, `action after "${c.message}"`);
  }
});

// --- 15. Recommended product ownership --------------------------------------

test('recommended product belongs to the owning business', async () => {
  // The earlier stage-progression conversation already recommended the product.
  const dash = (await request('/v1/conversations', { token: acme.token })).body.conversations;
  const withRecommendation = dash.find((c) => c.recommendedProductId);
  assert.ok(withRecommendation, 'a conversation carries a recommendation');

  const acmeProducts = (await request('/v1/products', { token: acme.token })).body.products;
  assert.ok(
    acmeProducts.some((p) => p.id === withRecommendation.recommendedProductId),
    'recommended product is owned by the same business'
  );

  // Beta cannot reach acme's recommended product at all.
  const betaList = (await request('/v1/products', { token: beta.token })).body.products;
  assert.ok(!betaList.some((p) => p.id === withRecommendation.recommendedProductId));
});

// --- 16. Sandbox/public agent parity ----------------------------------------

test('sandbox resolves the agent from the authenticated business and uses authoritative state', async () => {
  capturedSystemPrompts.length = 0;

  const res = await request('/v1/ai/chat', {
    method: 'POST',
    token: acme.token,
    body: {
      agentId: acmeAgentId,
      agent: { name: 'Fake Impostor', industry: 'XYZ', voice: 'technical', serviceCatalog: 'Fake data' },
      history: [],
      userInput: 'What do you offer?',
      targetLanguage: 'en',
      currencyCode: 'NGN',
    },
  });
  assert.equal(res.status, 200);

  const prompt = latestSalesPrompt();
  assert.ok(prompt.includes('Acme Garden Bot'), 'database agent identity is authoritative');
  assert.ok(!prompt.includes('Fake Impostor'), 'client-supplied agent is ignored when agentId is present');
  assert.ok(prompt.includes('Rooftop Garden Setup'), 'structured catalog reaches the sandbox prompt');
  assert.ok(prompt.includes('SALES STATE (server-authoritative'), 'same sales-state block as public chats');
  assert.ok(prompt.includes('CURRENT INTENT: Product/service inquiry'), 'intent normalized identically');

  // Cross-tenant agent id is rejected.
  const stolen = await request('/v1/ai/chat', {
    method: 'POST',
    token: beta.token,
    body: { agentId: acmeAgentId, history: [], userInput: 'hi', targetLanguage: 'en' },
  });
  assert.equal(stolen.status, 404, 'sandbox cannot use another tenant agent');
});

// --- 17. Existing lead qualification remains intact -------------------------

test('lead extraction and qualification still work alongside sales state', async () => {
  const previous = fakeExtraction;
  fakeExtraction = {
    name: 'Ada Obi',
    phone: '08012345678',
    email: 'ada@phase11.test',
    intent: 'Buying rooftop garden',
    qualificationScore: 80,
  };
  try {
    const res = await sendPublic(acmeTrackingId, "I'm ready to buy, my email is ada@phase11.test", null);
    assert.equal(res.status, 200);
  } finally {
    fakeExtraction = previous;
  }

  const leads = (await request('/v1/leads', { token: acme.token })).body.leads;
  const ada = leads.find((l) => l.email === 'ada@phase11.test');
  assert.ok(ada, 'lead persisted');
  assert.equal(ada.name, 'Ada Obi');
  assert.equal(ada.qualificationScore, 80);
  assert.equal(ada.qualificationStatus, 'qualified');

  const notifs = (await request('/v1/leads/notifications', { token: acme.token })).body;
  assert.ok(notifs.unread >= 1, 'qualified lead produced an in-app notification');
});

// --- 18. Existing tenant isolation remains intact ---------------------------

test('cross-tenant isolation is preserved end to end', async () => {
  const acmeDash = (await request('/v1/conversations', { token: acme.token })).body.conversations;
  const acmeConversationId = acmeDash[0].id;

  // Beta's tracking id cannot reach acme's conversation.
  const stolen = await request(`/v1/t/${betaTrackingId}/messages`, {
    method: 'POST',
    body: { message: 'exfiltrate', conversationId: acmeConversationId },
  });
  assert.equal(stolen.status, 404);

  const stolenHistory = await request(`/v1/t/${betaTrackingId}/messages?conversationId=${acmeConversationId}`);
  assert.equal(stolenHistory.status, 404);

  // Beta can also not resume acme's conversation through the sandbox.
  const sandboxStolen = await request('/v1/ai/chat', {
    method: 'POST',
    token: beta.token,
    body: { agentId: betaAgentId, conversationId: acmeConversationId, history: [], userInput: 'hi', targetLanguage: 'en' },
  });
  assert.equal(sandboxStolen.status, 403);

  const betaDash = (await request('/v1/conversations', { token: beta.token })).body.conversations;
  assert.equal(betaDash.length, 0, 'beta sees no acme conversations');
});