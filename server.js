
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import Groq from 'groq-sdk';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const groq = new Groq({ 
  apiKey: process.env.GROQ_API_KEY 
});

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

/**
 * MIDDLEWARE
 */
app.use(cors()); 
app.use(bodyParser.json());

// Serve static files from the Vite build directory
app.use(express.static(path.join(__dirname, 'dist')));

/**
 * DATA STORE (MOCK)
 * In a real production app, replace this with MongoDB, PostgreSQL, or Redis.
 */
let connectedCRMs = new Map();

/**
 * AI ENDPOINTS
 */

app.post('/v1/ai/chat', async (req, res) => {
  const { agent, history, userInput, targetLanguage } = req.body;
  const model = 'llama3-70b-8192';

  const docContext = agent.documents && agent.documents.length > 0 
    ? `Intelligence extracted from uploaded business documents (${agent.documents.join(', ')}): Highly specific business context applied.`
    : '';

  const systemInstruction = `
    You are ${agent.name}, an intelligent digital brand ambassador for a ${agent.industry} business.
    Your voice profile is strictly ${agent.voice}. 
    
    CRITICAL: YOU MUST RESPOND ONLY IN THE LANGUAGE CODE: "${targetLanguage}".

    KNOWLEDGE BASE:
    - Primary Catalog: ${agent.catalog || 'General professional services'}
    - Specialized Intelligence: ${docContext || 'Standard business logic'}

    OBJECTIVE: 
    Act as the physical-to-digital bridge. A customer just scanned a physical touchpoint and needs assistance.
    Qualify them as a lead and guide them towards a conversion (meeting, order, or proposal).
  `;

  try {
    const messages = [
      { role: 'system', content: systemInstruction },
      ...history.map(m => ({ 
        role: m.role === 'model' ? 'assistant' : 'user', 
        content: m.text 
      })),
      { role: 'user', content: userInput }
    ];

    const completion = await groq.chat.completions.create({
      messages,
      model,
      temperature: 0.7,
      max_tokens: 150,
    });

    res.json({ text: completion.choices[0]?.message?.content });
  } catch (error) {
    console.error("Groq Error:", error);
    res.status(500).json({ error: "AI logic error" });
  }
});

app.post('/v1/ai/proposal', async (req, res) => {
  const { agentName, context, targetLanguage } = req.body;
  
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: `You are a professional proposal generator. Output ONLY valid JSON.` },
        { role: 'user', content: `Context: ${context}. Language: ${targetLanguage}. Generate a proposal from ${agentName}.` }
      ],
      model: 'llama3-70b-8192',
      response_format: { type: "json_object" }
    });
    res.json(JSON.parse(completion.choices[0]?.message?.content || '{}'));
  } catch (error) {
    res.status(500).json({ error: "Proposal error" });
  }
});

/**
 * IDENTITY MANAGEMENT (PAYSTACK)
 */

// Resolve Account Number
app.get('/v1/identity/resolve-account', async (req, res) => {
  const { account_number, bank_code } = req.query;

  try {
    const response = await axios.get(`https://api.paystack.co/bank/resolve`, {
      params: { account_number, bank_code },
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: "Identity resolution failed" });
  }
});

// BVN Resolution
app.get('/v1/identity/resolve-bvn/:bvn', async (req, res) => {
  try {
    const response = await axios.get(`https://api.paystack.co/bank/resolve_bvn/${req.params.bvn}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: "BVN resolution failed" });
  }
});

// Fetch Bank List
app.get('/v1/identity/banks', async (req, res) => {
  try {
    const response = await axios.get(`https://api.paystack.co/bank`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Could not fetch banks" });
  }
});

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

// SPA Catch-all: Serve index.html for any unknown routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

/**
 * START SERVER
 */
app.listen(PORT, () => {
  console.log(`
  🚀 Touchpoint AI (Monolith) is running!
  ------------------------------------
  App URL:        http://localhost:${PORT}
  API Endpoint:   http://localhost:${PORT}/v1
  Health Check:   http://localhost:${PORT}/v1/health
  ------------------------------------
  `);
});
