/**
 * PHASE 13F-B CRM PERSISTENCE tests
 *
 * Exercises the approved Phase 13F persistence model directly against the
 * db-pg.js layer (no HTTP, no AI): CRM status, same-business assignment,
 * tenant-scoped notes with human/ai source, and the optional funnel-event lead
 * anchor. Covers the 15 required verifications.
 *
 * Runs serially (`--test-concurrency=1`) on the isolated `touchpoint_test`
 * schema. No local PostgreSQL, no `public` schema, no production data.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

const testPool = await setupTestDb();

// db-pg.js builds its pool from process.env.DATABASE_URL at import time; the
// helper above has already set DATABASE_URL + PGOPTIONS, so import after setup.
const db = await import('../db-pg.js');

const {
  createBusiness,
  createUser,
  createLead,
  getLeadById,
  setLeadCrmStatus,
  assignLeadUser,
  createCrmNote,
  listCrmNotes,
  createFunnelEvent,
  CRM_STATUSES,
} = db;

after(async () => {
  await db.closeDatabase();
  await cleanupTestDb(testPool);
});

// ---- Fixtures ---------------------------------------------------------------
let bizA;   // tenant A
let userA1; // a staff user in tenant A (assignee / note author)
let leadA1; // a lead in tenant A
let bizB;   // tenant B
let userB1; // a staff user in tenant B
let leadB1; // a lead in tenant B

test('setup: two tenant businesses with staff users and leads', async () => {
  bizA = await createBusiness('CRM Tenant A', `crm-a-${crypto.randomUUID().slice(0, 8)}`);
  userA1 = { id: crypto.randomUUID() };
  await createUser({
    id: userA1.id,
    businessId: bizA.id,
    email: 'staffa@phase13f.test',
    passwordHash: 'not-a-real-hash',
    name: 'Staff A',
  });
  leadA1 = await createLead({ businessId: bizA.id, name: 'Alice A', phone: '+2341000000001', email: 'alice@a.test' });

  bizB = await createBusiness('CRM Tenant B', `crm-b-${crypto.randomUUID().slice(0, 8)}`);
  userB1 = { id: crypto.randomUUID() };
  await createUser({
    id: userB1.id,
    businessId: bizB.id,
    email: 'staffb@phase13f.test',
    passwordHash: 'not-a-real-hash',
    name: 'Staff B',
  });
  leadB1 = await createLead({ businessId: bizB.id, name: 'Bob B', phone: '+2342000000002', email: 'bob@b.test' });

  assert.ok(bizA.id && bizB.id && userA1.id && userB1.id && leadA1.id && leadB1.id);
});

// 1. Existing leads remain readable after the CRM schema is present.
test('1. leads created without CRM columns remain readable', async () => {
  const lead = await getLeadById(bizA.id, leadA1.id);
  assert.ok(lead, 'leadA1 is still readable');
  assert.equal(lead.id, leadA1.id);
});

// 2. Existing leads default to crm_status = 'new'.
test('2. existing leads default to crm_status = new', () => {
  return getLeadById(bizA.id, leadA1.id).then((lead) => {
    assert.equal(lead.crm_status, 'new');
    assert.equal(lead.assigned_user_id, null);
  });
});

// 3. CRM status accepts the approved values.
test('3. CRM status accepts only the approved values', async () => {
  assert.deepEqual(CRM_STATUSES, [
    'new', 'contacted', 'qualified', 'opportunity',
    'customer', 'unqualified', 'lost', 'do_not_contact',
  ]);
  for (const status of CRM_STATUSES) {
    const updated = await setLeadCrmStatus(bizA.id, leadA1.id, status);
    assert.equal(updated.crm_status, status, `accepted ${status}`);
  }
  const final = await setLeadCrmStatus(bizA.id, leadA1.id, 'qualified');
  assert.equal(final.qualification_status, 'pending', 'qualification state untouched');
});

// 4. Invalid CRM status is rejected (app layer + DB CHECK).
test('4. invalid CRM status is rejected', async () => {
  await assert.rejects(setLeadCrmStatus(bizA.id, leadA1.id, 'hot'), /crmStatus must be one of/);
  await assert.rejects(
    testPool.query(
      `UPDATE leads SET crm_status = 'bogus' WHERE id = $1`,
      [leadA1.id]
    ),
    /violates check constraint|check constraint/
  );
});

// 5. Assignment to a user in the same business succeeds.
test('5. same-business assignment succeeds', async () => {
  const lead = await assignLeadUser(bizA.id, leadA1.id, userA1.id);
  assert.equal(lead.assigned_user_id, userA1.id);
  assert.equal((await testPool.query('SELECT assigned_user_id FROM leads WHERE id = $1', [leadA1.id])).rows[0].assigned_user_id, userA1.id);
});

// 6. Assignment to a user belonging to another business is rejected.
test('6. cross-business assignment is rejected', async () => {
  await assert.rejects(assignLeadUser(bizA.id, leadA1.id, userB1.id), /does not belong to this business/);
  const still = await getLeadById(bizA.id, leadA1.id);
  assert.equal(still.assigned_user_id, userA1.id, 'assignment unchanged after the rejection');
});

// 7. Clearing assignment works.
test('7. clearing assignment works', async () => {
  const lead = await assignLeadUser(bizA.id, leadA1.id, null);
  assert.equal(lead.assigned_user_id, null);
});

// 8. CRM notes can be created for a lead in the same tenant.
test('8. same-tenant note creation succeeds', async () => {
  const note = await createCrmNote({
    businessId: bizA.id,
    leadId: leadA1.id,
    authorUserId: userA1.id,
    body: 'Called customer; interested in the standard plan.',
    source: 'human',
  });
  assert.ok(note.id);
  assert.equal(note.business_id, bizA.id);
  assert.equal(note.lead_id, leadA1.id);
  assert.equal(note.author_user_id, userA1.id);
  assert.equal(note.source, 'human');
});

// 9. Cross-tenant note creation is rejected.
test('9. cross-tenant note creation is rejected', async () => {
  await assert.rejects(
    createCrmNote({ businessId: bizA.id, leadId: leadB1.id, body: 'leak', source: 'human' }),
    /does not belong to this business/
  );
  await assert.rejects(
    createCrmNote({ businessId: bizA.id, leadId: leadA1.id, authorUserId: userB1.id, body: 'leak via author', source: 'human' }),
    /does not belong to this business/
  );
});

// 10. Cross-tenant lead access is rejected.
test('10. cross-tenant lead access is rejected', async () => {
  assert.equal(await getLeadById(bizA.id, leadB1.id), null, 'getLeadById leaks nothing');
  assert.equal(await setLeadCrmStatus(bizA.id, leadB1.id, 'contacted'), null, 'cannot mutate another tenant lead');
  assert.equal(await assignLeadUser(bizA.id, leadB1.id, null), null, 'cannot assign another tenant lead');
  assert.deepEqual(await listCrmNotes(bizA.id, leadB1.id), [], 'no notes leak across tenants');
});

// 11. Human and AI note sources are distinguished.
test('11. human and AI note sources are distinct', async () => {
  await createCrmNote({ businessId: bizA.id, leadId: leadA1.id, authorUserId: userA1.id, body: 'Human follow-up', source: 'human' });
  await createCrmNote({ businessId: bizA.id, leadId: leadA1.id, body: 'AI draft (model only)', source: 'ai' });
  const notes = await listCrmNotes(bizA.id, leadA1.id);
  assert.equal(notes.length, 3);
  const sources = notes.map((n) => n.source).sort();
  assert.deepEqual(sources, ['ai', 'human', 'human']);
  const aiNote = notes.find((n) => n.source === 'ai');
  assert.equal(aiNote.author_user_id, null, 'AI note has no human author');
  assert.match(aiNote.body, /AI draft/);
});

// 12. funnel_events.lead_id accepts a valid lead.
test('12. funnel_events.lead_id accepts a valid lead', async () => {
  const eventId = await createFunnelEvent({
    businessId: bizA.id,
    conversationId: null,
    leadId: leadA1.id,
    eventType: 'lead_field_captured',
    meta: { field: 'phone' },
  });
  const row = (await testPool.query('SELECT * FROM funnel_events WHERE id = $1', [eventId])).rows[0];
  assert.equal(row.lead_id, leadA1.id);
  assert.equal(row.event_type, 'lead_field_captured');
});

// 13. funnel_events.lead_id may remain NULL.
test('13. funnel_events.lead_id may remain NULL', async () => {
  const eventId = await createFunnelEvent({
    businessId: bizA.id,
    eventType: 'recommendation_made',
  });
  const row = (await testPool.query('SELECT * FROM funnel_events WHERE id = $1', [eventId])).rows[0];
  assert.equal(row.lead_id, null);
  assert.equal(row.conversation_id, null);
});

// 14. Cross-tenant lead references cannot be attached to a business funnel event.
test('14. cross-tenant lead reference on a funnel event is rejected', async () => {
  await assert.rejects(
    createFunnelEvent({ businessId: bizA.id, leadId: leadB1.id, eventType: 'buying_signal_detected' }),
    /does not belong to this business/
  );
});

// 15. Existing funnel-event behaviour remains intact.
test('15. existing funnel-event behaviour remains intact', async () => {
  const eventId = await createFunnelEvent({
    businessId: bizA.id,
    conversationId: null,
    eventType: 'handoff_offered',
    meta: { channel: 'whatsapp', key: 'dedupe-probe' },
  });
  const row = (await testPool.query('SELECT * FROM funnel_events WHERE id = $1', [eventId])).rows[0];
  assert.equal(row.business_id, bizA.id);
  assert.equal(row.conversation_id, null);
  assert.equal(row.event_type, 'handoff_offered');
  assert.equal(row.meta.key, 'dedupe-probe');
  assert.equal(row.lead_id, null);
});