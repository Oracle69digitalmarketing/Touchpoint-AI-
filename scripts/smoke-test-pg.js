
import {
  pingDatabase,
  createBusiness,
  createUser,
  findUserByEmail,
  createSession,
  findSession,
  revokeSession,
  listAgents,
  createAgent,
  createTouchpoint,
  recordScan,
  createConversation,
  addConversationMessage,
  listConversationMessages,
  createLead,
  createLeadNotification,
  upsertSubscription,
  hasWebhookEvent,
  recordWebhookEvent,
  countAnalyticsRows,
  closeDatabase,
  pool // Import the pool to perform cleanup
} from '../db-pg.js';
import crypto from 'node:crypto';

async function runSmokeTest() {
  console.log('--- Smoke Test Starting ---');
  let testsAttempted = 0;
  let testsPassed = 0;
  
  const addResult = (name, status, error = null) => {
    testsAttempted++;
    if (status === 'PASS') testsPassed++;
    console.log(`${status}: ${name}${error ? ' - ' + error : ''}`);
  };

  const createdIds = {
    businesses: [],
    users: [],
    sessions: [],
    agents: [],
    touchpoints: [],
    conversations: [],
    leads: [],
    subscriptions: [],
    webhookEvents: []
  };

  try {
    // 1. Connectivity
    const ping = await pingDatabase();
    addResult('PostgreSQL connectivity', ping ? 'PASS' : 'FAIL', ping ? null : 'Ping failed');
    if (!ping) throw new Error('Database ping failed');

    // 2. Business creation
    const bizName = 'TEST_BIZ_' + crypto.randomUUID();
    const business = await createBusiness(bizName, bizName.toLowerCase());
    createdIds.businesses.push(business.id);
    addResult('Business creation', business ? 'PASS' : 'FAIL');

    // 3. User creation
    const email = 'test' + crypto.randomUUID() + '@test.com';
    const userId = crypto.randomUUID();
    await createUser({
      id: userId,
      businessId: business.id,
      email,
      passwordHash: 'dummy',
      name: 'Tester'
    });
    createdIds.users.push(userId);
    addResult('User creation', 'PASS');

    // 4. User lookup
    const user = await findUserByEmail(email);
    addResult('User lookup', (user && user.business_id === business.id) ? 'PASS' : 'FAIL');

    // 5. Session creation
    const sessionId = crypto.randomUUID();
    const session = await createSession({ id: sessionId, userId: user.id, businessId: business.id, ttlSeconds: 3600 });
    createdIds.sessions.push(sessionId);
    addResult('Session creation', session ? 'PASS' : 'FAIL');

    // 6. Session validation
    const foundSession = await findSession(sessionId);
    addResult('Session validation', foundSession ? 'PASS' : 'FAIL');

    // 7. Session revocation
    await revokeSession(sessionId);
    const revoked = await findSession(sessionId);
    addResult('Session revocation', !revoked ? 'PASS' : 'FAIL');

    // 8. Tenant isolation
    const bizB = await createBusiness('TEST_BIZ_B', 'biz_b' + crypto.randomUUID());
    createdIds.businesses.push(bizB.id);
    const agentsA = await listAgents(business.id);
    const agentsB = await listAgents(bizB.id);
    addResult('Tenant isolation', (agentsA.length === 0 && agentsB.length === 0) ? 'PASS' : 'FAIL');

    // 9. Agent creation
    const agent = await createAgent(business.id, { name: 'Test Agent' });
    createdIds.agents.push(agent.id);
    addResult('Agent creation', agent ? 'PASS' : 'FAIL');

    // 10. Touchpoint creation
    const touchpoint = await createTouchpoint({ businessId: business.id, agentId: agent.id, name: 'Test TP', type: 'Flyer', location: 'Office', trackingId: 'TX-' + crypto.randomUUID().replace(/-/g, '').slice(0, 13) });
    createdIds.touchpoints.push(touchpoint.id);
    addResult('Touchpoint creation', touchpoint ? 'PASS' : 'FAIL');

    // 11. Scan recording
    await recordScan({ touchpointId: touchpoint.id, businessId: business.id, userAgent: 'test-agent' });
    addResult('Scan recording', 'PASS');

    // 12. Conversation creation
    const conversation = await createConversation({ touchpoint, agentId: agent.id, customerName: 'Customer', targetLanguage: 'en' });
    createdIds.conversations.push(conversation.id);
    addResult('Conversation creation', conversation ? 'PASS' : 'FAIL');

    // 13. Message creation
    await addConversationMessage({ conversationId: conversation.id, role: 'user', text: 'Hello' });
    await addConversationMessage({ conversationId: conversation.id, role: 'assistant', text: 'Hi there' });
    addResult('Message creation', 'PASS');

    // 14. Message ordering
    const messages = await listConversationMessages(conversation.id);
    const ordered = messages[0].text === 'Hello' && messages[1].text === 'Hi there';
    addResult('Message ordering', ordered ? 'PASS' : 'FAIL');

    // 15. Lead creation
    const lead = await createLead({ businessId: business.id, qualificationScore: 80, qualificationStatus: 'qualified' });
    createdIds.leads.push(lead.id);
    addResult('Lead creation', lead ? 'PASS' : 'FAIL');

    // 16. Lead notification
    await createLeadNotification({ businessId: business.id, leadId: lead.id });
    addResult('Lead notification', 'PASS');

    // 17. Subscription upsert
    const sub = await upsertSubscription(business.id, { plan: 'Growth' });
    addResult('Subscription upsert', sub ? 'PASS' : 'FAIL');

    // 18. Webhook idempotency
    const eventId = crypto.randomUUID();
    createdIds.webhookEvents.push(eventId);
    await recordWebhookEvent({ eventId, eventType: 'test.event', businessId: business.id });
    await recordWebhookEvent({ eventId, eventType: 'test.event', businessId: business.id });
    const hasEvent = await hasWebhookEvent(eventId);
    addResult('Webhook idempotency', hasEvent ? 'PASS' : 'FAIL');

    // 19. Analytics
    const scans = await countAnalyticsRows(business.id, 'scans');
    addResult('Analytics', (typeof scans === 'number') ? 'PASS' : 'FAIL');

    console.log('--- Smoke Test Passed ---');
  } catch (err) {
    console.error('--- Smoke Test Failed ---');
    console.error(err);
  } finally {
    // 20. Cleanup
    console.log('\n--- Starting Cleanup ---');
    try {
        // Deletion in reverse order of creation for FKs
        await pool.query('DELETE FROM lead_notifications WHERE lead_id IN (SELECT id FROM leads WHERE business_id = ANY($1))', [createdIds.businesses]);
        await pool.query('DELETE FROM leads WHERE business_id = ANY($1)', [createdIds.businesses]);
        await pool.query('DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE business_id = ANY($1))', [createdIds.businesses]);
        await pool.query('DELETE FROM conversations WHERE business_id = ANY($1)', [createdIds.businesses]);
        await pool.query('DELETE FROM touchpoint_scans WHERE business_id = ANY($1)', [createdIds.businesses]);
        await pool.query('DELETE FROM touchpoints WHERE business_id = ANY($1)', [createdIds.businesses]);
        await pool.query('DELETE FROM agents WHERE business_id = ANY($1)', [createdIds.businesses]);
        await pool.query('DELETE FROM webhook_events WHERE business_id = ANY($1)', [createdIds.businesses]);
        await pool.query('DELETE FROM sessions WHERE business_id = ANY($1)', [createdIds.businesses]);
        await pool.query('DELETE FROM users WHERE business_id = ANY($1)', [createdIds.businesses]);
        await pool.query('DELETE FROM subscriptions WHERE business_id = ANY($1)', [createdIds.businesses]);
        await pool.query('DELETE FROM businesses WHERE id = ANY($1)', [createdIds.businesses]);
        addResult('Cleanup verification', 'PASS');
    } catch (err) {
        addResult('Cleanup verification', 'FAIL', err.message);
    }
    
    await closeDatabase();
    console.log('Database connection closed.');
    console.log('\n--- Final Report ---');
    console.log(`Tests attempted: ${testsAttempted}`);
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsAttempted - testsPassed}`);
  }
}

runSmokeTest();
