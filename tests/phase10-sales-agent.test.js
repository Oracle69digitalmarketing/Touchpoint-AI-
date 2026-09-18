/**
 * PHASE 10 SALES AGENT KNOWLEDGE + PROMPT LAYER TESTS (Batch 1)
 *
 * Batch 1 makes the agent behave like a real salesperson without touching the
 * database schema. It passes all configured business context into the LLM
 * prompt (description, service catalog, client profiles, case library,
 * guidelines), and layers the prompt into: identity/role, authoritative
 * knowledge, customer context, sales behavior, conversation rules, lead
 * capture/handoff, and accuracy/safety boundaries.
 *
 * These tests confirm:
 *   - every configured business-knowledge field reaches the system prompt,
 *   - sales behavior, objection handling, buying-signal, and no-invention
 *     guidance are present,
 *   - uploaded documents are described honestly as unread references and the
 *     false "intelligence extracted" claim is gone,
 *   - the one-question / no-repeat rules are present,
 *   - the public touchpoint chat still drives the same layered prompt with the
 *     agent loaded from the database,
 *   - tenant isolation is unaffected.
 *
 * The Groq client is swapped for a deterministic fake that records the system
 * prompts, so this suite needs no live API key.
 *
 * Run with: NODE_ENV=test node --test tests/
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret-for-phase10-sales-agent';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';

const testPool = await setupTestDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The /t/:trackingId route renders dist/t.html with an injected payload.
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

/**
 * Deterministic fake Groq. Records every sales-chat system prompt so tests can
 * assert the exact layered instructions; extraction completions return a
 * canned (unqualified) lead JSON so public chat keeps its normal flow.
 */
const capturedSystemPrompts = [];
_setGroqClient({
  chat: {
    completions: {
      create: async ({ messages }) => {
        const system = (messages.find((m) => m.role === 'system') || {}).content || '';
        if (system.includes('lead qualification engine')) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  name: 'Ada Obi',
                  phone: null,
                  email: null,
                  intent: 'Enquiry',
                  qualificationScore: 0,
                }),
              },
            }],
          };
        }
        capturedSystemPrompts.push(system);
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        return { choices: [{ message: { content: `Mock reply to: ${lastUser ? lastUser.content : ''}` } }] };
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
  if (raw) {
    return { status: res.status, text: await res.text() };
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const register = (payload) =>
  request('/v1/auth/register', { method: 'POST', body: payload });

const login = (payload) =>
  request('/v1/auth/login', { method: 'POST', body: payload });

// Distinctive markers for each knowledge field so prompt/absence is unambiguous.
const KNOWLEDGE = {
  description: 'Uniquely handcrafted consulting for rooftop gardens',
  serviceCatalog: 'Deluxe Garden Consult (Service D9K) available at 45000 Naira per visit',
  clientProfiles: 'Ideal client: boutique hotel owners with rooftop terraces',
  caseLibrary: 'Helped a Lagos hotel cut cooling costs with green roofing',
  guidelines: 'Internal rule: always offer a free 15-minute scoping call',
  documents: ['garden-price-list.pdf', 'one-page-brochure.docx'],
};

const fullAgentPayload = {
  name: 'Rooftop Haven Concierge',
  industry: 'Landscaping',
  voice: 'enthusiastic',
  description: KNOWLEDGE.description,
  serviceCatalog: KNOWLEDGE.serviceCatalog,
  clientProfiles: KNOWLEDGE.clientProfiles,
  caseLibrary: KNOWLEDGE.caseLibrary,
  guidelines: KNOWLEDGE.guidelines,
  documents: KNOWLEDGE.documents,
};

const touchpointPayload = (overrides = {}) => ({
  name: 'Lobby Sign',
  type: 'Business Card',
  location: 'Lagos HQ',
  ...overrides,
});

// Shared fixtures created by the first test and reused across the suite.
let acme;
let acmeAgentId;
let acmeTrackingId;

const loginAsAcme = async () =>
  (await login({ email: 'acme@phase10.test', password: 'password123' })).body;

test('setup: register a business, an agent with full knowledge, and a touchpoint', async () => {
  acme = (await register({
    email: 'acme@phase10.test',
    password: 'password123',
    name: 'Acme Owner',
    businessName: 'Acme Landscaping',
  })).body;

  const agent = (await request('/v1/agents', {
    method: 'POST',
    body: fullAgentPayload,
    token: acme.token,
  })).body.agent;
  acmeAgentId = agent.id;

  // The server persists every knowledge field.
  assert.equal(agent.description, KNOWLEDGE.description);
  assert.equal(agent.serviceCatalog, KNOWLEDGE.serviceCatalog);
  assert.equal(agent.clientProfiles, KNOWLEDGE.clientProfiles);
  assert.equal(agent.caseLibrary, KNOWLEDGE.caseLibrary);
  assert.equal(agent.guidelines, KNOWLEDGE.guidelines);
  assert.deepEqual(agent.documents, KNOWLEDGE.documents);

  const tp = (await request('/v1/touchpoints', {
    method: 'POST',
    body: touchpointPayload({ agentId: agent.id }),
    token: acme.token,
  })).body.touchpoint;
  acmeTrackingId = tp.trackingId;
});

test('sandbox chat passes every configured business-knowledge field into the prompt', async () => {
  capturedSystemPrompts.length = 0;

  const res = await request('/v1/ai/chat', {
    method: 'POST',
    token: acme.token,
    body: {
      agent: fullAgentPayload,
      history: [],
      userInput: 'Hello there',
      targetLanguage: 'en',
      currencyCode: 'NGN',
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.text, 'Mock reply to: Hello there');

  const prompt = latestSalesPrompt();
  assert.ok(prompt, 'a sales system prompt was produced');

  assert.ok(prompt.includes(KNOWLEDGE.description), 'description reaches the prompt');
  assert.ok(prompt.includes('Deluxe Garden Consult (Service D9K)'), 'service catalog reaches the prompt');
  assert.ok(prompt.includes(KNOWLEDGE.clientProfiles), 'client profiles reach the prompt');
  assert.ok(prompt.includes('cut cooling costs with green roofing'), 'case library reaches the prompt');
  assert.ok(prompt.includes(KNOWLEDGE.guidelines), 'guidelines reach the prompt');
  assert.ok(prompt.includes('rooftop gardens'), 'business description section is present');

  // Currency hint is applied when provided.
  assert.ok(prompt.includes('present it in NGN'), 'currency hint reaches the prompt');
});

test('sales behavior, objection handling, and buying-signal guidance are present', async () => {
  const prompt = latestSalesPrompt();
  assert.ok(prompt.includes('DISCOVER'), 'DISCOVER stage is present');
  assert.ok(prompt.includes('UNDERSTAND'), 'UNDERSTAND stage is present');
  assert.ok(prompt.includes('RECOMMEND'), 'RECOMMEND stage is present');
  assert.ok(prompt.includes('HANDLE OBJECTION'), 'HANDLE OBJECTION stage is present');
  assert.ok(prompt.includes('QUALIFY'), 'QUALIFY stage is present');
  assert.ok(prompt.includes('ADVANCE'), 'ADVANCE stage is present');

  assert.ok(prompt.includes('Price enquiry'), 'price enquiry behavior is present');
  assert.ok(prompt.includes('Price objection'), 'price objection behavior is present');
  assert.ok(prompt.includes('Comparison question'), 'comparison behavior is present');
  assert.ok(prompt.includes('Trust/credibility objection'), 'trust objection behavior is present');
  assert.ok(prompt.includes('think about it'), 'deferral behavior is present');
  assert.ok(prompt.includes('Buying signal'), 'buying-signal behavior is present');
  assert.ok(prompt.includes('Request for human assistance'), 'human-assistance behavior is present');
  assert.ok(prompt.includes('Off-topic or irrelevant'), 'off-topic behavior is present');
});

test('no-invention, one-question, and no-repeat rules remain present', async () => {
  const prompt = latestSalesPrompt();
  assert.ok(prompt.includes('Never invent prices'), 'no-invent-prices rule is present');
  assert.ok(prompt.includes('never repeat a question already asked'), 'no-repeat rule is present');
  assert.ok(prompt.includes('AT MOST ONE meaningful question'), 'one-question rule is present');
  assert.ok(prompt.includes('never ask for something the customer already provided'), 'no-re-ask rule is present');
  assert.ok(prompt.includes('REFERENCE FILES'), 'reference-files section is present');
  assert.ok(prompt.includes('have NOT been read'), 'documents are described as unread references');
});

test('documents are no longer described as extracted intelligence', async () => {
  const prompt = latestSalesPrompt();
  assert.ok(!/intelligence extracted/i.test(prompt), 'false "intelligence extracted" claim is gone');
  assert.ok(!/Use it when relevant/i.test(prompt), 'old knowledge-base preamble is gone');
  assert.ok(prompt.includes('garden-price-list.pdf'), 'document names are listed as references');
});

test('the public touchpoint chat loads the full agent from the database and layers the same prompt', async () => {
  capturedSystemPrompts.length = 0;

  const first = await request(`/v1/t/${acmeTrackingId}/messages`, {
    method: 'POST',
    body: { message: 'What can you offer my hotel?', customerName: 'Ada', targetLanguage: 'en' },
  });
  assert.equal(first.status, 200);
  assert.ok(first.body.conversationId, 'conversation is created');
  assert.equal(first.body.agent.name, fullAgentPayload.name);
  assert.equal(first.body.messages.length, 2, 'user + assistant messages persisted');
  assert.match(first.body.messages[1].text, /Mock reply/);

  const prompt = latestSalesPrompt();
  assert.ok(prompt, 'public chat produced a sales prompt');
  assert.ok(prompt.includes(KNOWLEDGE.description), 'public prompt includes the DB description');
  assert.ok(prompt.includes('Deluxe Garden Consult (Service D9K)'), 'public prompt includes the DB catalog');
  assert.ok(prompt.includes(KNOWLEDGE.clientProfiles), 'public prompt includes the DB client profiles');
  assert.ok(prompt.includes('cut cooling costs with green roofing'), 'public prompt includes the DB case library');
  assert.ok(prompt.includes(KNOWLEDGE.guidelines), 'public prompt includes the DB guidelines');
});

test('the public payload never leaks the business catalog to the browser', async () => {
  const resolved = await request(`/v1/t/${acmeTrackingId}`);
  assert.equal(resolved.status, 200);
  const json = JSON.stringify(resolved.body);
  assert.equal(resolved.body.trackingId, acmeTrackingId);
  assert.ok(!json.includes('Deluxe Garden Consult'), 'catalog stays server-side');
  assert.ok(!json.includes('boutique hotel owners'), 'client profiles stay server-side');
});

test('tenant isolation remains intact with the new prompt', async () => {
  const beta = (await register({
    email: 'beta@phase10.test',
    password: 'password123',
    name: 'Beta Owner',
    businessName: 'Beta Gardens',
  })).body;

  const betaAgent = (await request('/v1/agents', {
    method: 'POST',
    body: fullAgentPayload,
    token: beta.token,
  })).body.agent;

  const betaTp = (await request('/v1/touchpoints', {
    method: 'POST',
    body: touchpointPayload({ name: 'Beta Flyer', agentId: betaAgent.id }),
    token: beta.token,
  })).body.touchpoint;

  const acmeList = (await request('/v1/conversations', { token: (await loginAsAcme()).token })).body;
  const acmeConversationId = acmeList.conversations[0].id;

  // Beta cannot address Acme's conversation through Beta's tracking id.
  const stolen = await request(`/v1/t/${betaTp.trackingId}/messages`, {
    method: 'POST',
    body: { message: 'exfiltrate', conversationId: acmeConversationId },
  });
  assert.equal(stolen.status, 404, 'cross-touchpoint conversation id is rejected');

  const stolenHistory = await request(`/v1/t/${betaTp.trackingId}/messages?conversationId=${acmeConversationId}`);
  assert.equal(stolenHistory.status, 404, 'cross-touchpoint history is rejected');

  const betaList = (await request('/v1/conversations', { token: beta.token })).body;
  assert.equal(betaList.conversations.length, 0, 'beta sees no acme conversations');
});