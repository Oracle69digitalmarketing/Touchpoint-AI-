
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * MIDDLEWARE
 */
app.use(cors()); // In production, restrict this to your specific frontend URL
app.use(bodyParser.json());

/**
 * DATA STORE (MOCK)
 * In a real production app, replace this with MongoDB, PostgreSQL, or Redis.
 */
let connectedCRMs = new Map();

/**
 * CRM ENDPOINTS
 */

// Health Check
app.get('/v1/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Connect CRM
app.post('/v1/crm/connect', async (req, res) => {
  const { providerId } = req.body;

  if (!providerId) {
    return res.status(400).json({ success: false, message: "Missing providerId" });
  }

  console.log(`[Backend] Processing connection for: ${providerId}`);

  try {
    // --- PRODUCTION LOGIC ---
    // This is where you would use your SECRET keys stored in environment variables.
    // Example: 
    // const clientSecret = process.env[`${providerId.toUpperCase()}_CLIENT_SECRET`];
    // const authResponse = await someCrmSdk.authenticate(clientSecret);

    // Simulate network delay to the 3rd party CRM
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Store the connection (In production, save to DB with encrypted tokens)
    const syncTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    connectedCRMs.set(providerId, { status: 'connected', lastSync: syncTime });

    res.status(200).json({
      success: true,
      provider: providerId,
      lastSync: `${syncTime} ago`
    });

  } catch (error) {
    console.error(`[CRM Error]`, error);
    res.status(500).json({ success: false, message: "Internal server error during handshake." });
  }
});

// Disconnect CRM
app.delete('/v1/crm/disconnect/:providerId', (req, res) => {
  const { providerId } = req.params;
  
  if (connectedCRMs.has(providerId)) {
    connectedCRMs.delete(providerId);
    console.log(`[Backend] Disconnected: ${providerId}`);
    return res.status(200).json({ success: true });
  }

  res.status(404).json({ success: false, message: "Provider not found" });
});

/**
 * START SERVER
 */
app.listen(PORT, () => {
  console.log(`
  🚀 Touchpoint AI Backend is running!
  ------------------------------------
  Local Endpoint: http://localhost:${PORT}/v1
  Health Check:   http://localhost:${PORT}/v1/health
  ------------------------------------
  To test from the frontend, update services/crm.ts to point here.
  `);
});
