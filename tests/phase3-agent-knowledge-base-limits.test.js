/**
 * KNOWLEDGE-BASE LENGTH LIMIT REGRESSION TESTS
 *
 * Covers the production-safe fix that raises the per-field agent
 * knowledge-base limit (serviceCatalog, clientProfiles, caseLibrary,
 * guidelines, description) from 4000 to 20000 characters while preserving
 * name/industry limits, the validation error shape, and the required-field
 * checks. Also verifies the frontend wizard carries matching maxLength and
 * character-counter constraints.
 *
 * Run with: NODE_ENV=test node --test tests/phase3-agent-knowledge-base-limits.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret-for-knowledge-base-limits';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';

const testPool = await setupTestDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { default: app } = await import(path.join(__dirname, '..', 'server.js'));

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.close();
  await cleanupTestDb(testPool);
});

const request = async (url, { method = 'GET', body, token } = {}) => {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const register = (payload) =>
  request('/v1/auth/register', { method: 'POST', body: payload });

const login = (payload) =>
  request('/v1/auth/login', { method: 'POST', body: payload });

const agentPayload = (overrides = {}) => ({
  name: 'Knowledge Base Agent',
  industry: 'Real Estate',
  voice: 'professional',
  description: 'Descriptive',
  serviceCatalog: 'Tours, valuations, financing',
  clientProfiles: 'First-time buyers',
  caseLibrary: 'Closed 40+ deals',
  guidelines: 'Always quote NGN',
  documents: ['pricing.pdf'],
  ...overrides,
});

const newOwner = async (email) =>
  (await register({
    email,
    password: 'password123',
    name: 'Owner',
    businessName: 'Knowledge Base Co',
  })).body;

test('4001-character serviceCatalog is accepted on create', async () => {
  const owner = await newOwner('kb4001@limits.test');
  const catalog = 'x'.repeat(4001);

  const create = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload({ serviceCatalog: catalog }),
    token: owner.token,
  });
  assert.equal(create.status, 201);
  assert.equal(create.body.agent.serviceCatalog, catalog);
});

test('20000-character serviceCatalog is accepted on update', async () => {
  const owner = await newOwner('kb20000@limits.test');
  const created = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload({ serviceCatalog: 'Tours' }),
    token: owner.token,
  });
  assert.equal(created.status, 201);
  const target = created.body.agent.id;

  const catalog = 'y'.repeat(20000);
  const updated = await request(`/v1/agents/${target}`, {
    method: 'PUT',
    body: { serviceCatalog: catalog },
    token: owner.token,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.agent.serviceCatalog, catalog);
});

test('20001-character serviceCatalog is rejected with the existing validation error', async () => {
  const owner = await newOwner('kb20001@limits.test');
  const created = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload({ serviceCatalog: 'Tours' }),
    token: owner.token,
  });
  assert.equal(created.status, 201);
  const target = created.body.agent.id;

  const tooLong = await request(`/v1/agents/${target}`, {
    method: 'PUT',
    body: { serviceCatalog: 'z'.repeat(20001) },
    token: owner.token,
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error, 'Validation failed');
  assert.equal(tooLong.body.fields.serviceCatalog, 'serviceCatalog must be 20000 characters or fewer');

  const reloaded = await request(`/v1/agents/${target}`, { token: owner.token });
  assert.equal(reloaded.body.agent.serviceCatalog, 'Tours', 'rejected value is not persisted');
});

test('other knowledge-base fields share the raised limit; industry keeps its existing limit', async () => {
  const owner = await newOwner('kb-fields@limits.test');
  const created = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload({
      description: 'd'.repeat(20000),
      clientProfiles: 'p'.repeat(4001),
      caseLibrary: 'c'.repeat(20000),
      guidelines: 'g'.repeat(20000),
    }),
    token: owner.token,
  });
  assert.equal(created.status, 201, 'description/clientProfiles/caseLibrary/guidelines accept values above 4000');
  const target = created.body.agent.id;

  const industryTooLong = await request(`/v1/agents/${target}`, {
    method: 'PUT',
    body: { industry: 'i'.repeat(4001) },
    token: owner.token,
  });
  assert.equal(industryTooLong.status, 400);
  assert.equal(industryTooLong.body.fields.industry, 'industry must be 4000 characters or fewer');
});

test('existing required-field validation remains intact', async () => {
  const owner = await newOwner('kb-required@limits.test');

  const noName = await request('/v1/agents', { method: 'POST', body: { industry: 'Retail' }, token: owner.token });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.error, 'Validation failed');
  assert.equal(noName.body.fields.name, 'Agent name is required');

  const nameTooLong = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload({ name: 'n'.repeat(81) }),
    token: owner.token,
  });
  assert.equal(nameTooLong.status, 400);
  assert.equal(nameTooLong.body.fields.name, 'Agent name must be 80 characters or fewer');
});

test('frontend wizard carries the matching maxLength and character counter', () => {
  const wizardPath = path.join(__dirname, '..', 'components', 'AgentTrainingWizard.tsx');
  const source = fs.readFileSync(wizardPath, 'utf8');

  assert.match(source, /KNOWLEDGE_BASE_LIMIT\s*=\s*20000/, 'defines the 20000 limit once');
  const maxLengthMatches = source.match(/maxLength=\{KNOWLEDGE_BASE_LIMIT\}/g) || [];
  assert.equal(maxLengthMatches.length, 3, 'maxLength applied to serviceCatalog, clientProfiles, caseLibrary');

  assert.match(source, /toLocaleString/, 'character counter formats counts with thousands separators');
  assert.match(source, /CharacterCounter/, 'a reusable character counter component exists');
  const counterUsages = source.match(/<CharacterCounter value=\{formData\.(\w+)\} max=\{KNOWLEDGE_BASE_LIMIT\} \/>/g) || [];
  assert.equal(counterUsages.length, 3, 'counter rendered under each knowledge-base textarea');
});
