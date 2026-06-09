
/**
 * BACKEND PROXY FOR AI SERVICES
 * Keeps API keys hidden on the server.
 */
const API_BASE = window.location.origin.includes('localhost:3000') 
? 'http://localhost:3001/v1' 
: '/v1';

export const simulateAgentConversation = async (
  agent: { name: string; industry: string; voice: string; catalog?: string; documents?: string[] },
  history: { role: 'user' | 'model', text: string }[],
  userInput: string,
  targetLanguage: string = 'en'
) => {
  try {
    const response = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, history, userInput, targetLanguage })
    });

    if (!response.ok) throw new Error("AI Backend error");
    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error("AI Proxy Error:", error);
    return "I'm having a slight connectivity issue with my knowledge base. Please try again in a moment.";
  }
};

export const translateContent = async (text: string, targetLanguage: string) => {
  // Use chat endpoint for translation as well for simplicity
  return simulateAgentConversation(
    { name: 'Translator', industry: 'Linguistics', voice: 'Neutral' },
    [],
    `Translate this UI text to ${targetLanguage}: "${text}"`,
    targetLanguage
  );
};

export const generateAgentProposal = async (agentName: string, context: string, targetLanguage: string = 'en') => {
  try {
    const response = await fetch(`${API_BASE}/ai/proposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName, context, targetLanguage })
    });

    if (!response.ok) throw new Error("Proposal Backend error");
    return await response.json();
  } catch (error) {
    console.error("Proposal Proxy Error:", error);
    return null;
  }
};
