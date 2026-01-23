
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

/**
 * Simulates a conversation while forcing the agent to adapt to the user's preferred language
 * regardless of the training data language.
 */
export const simulateAgentConversation = async (
  agent: { name: string; industry: string; voice: string; catalog?: string; documents?: string[] },
  history: ChatMessage[],
  userInput: string,
  targetLanguage: string = 'en'
) => {
  // Use gemini-3-pro-preview for complex reasoning tasks like agent persona simulation
  const model = 'gemini-3-pro-preview';
  
  const docContext = agent.documents && agent.documents.length > 0 
    ? `Intelligence extracted from uploaded business documents (${agent.documents.join(', ')}): Highly specific business context applied.`
    : '';

  const systemInstruction = `
    You are ${agent.name}, an intelligent digital brand ambassador for a ${agent.industry} business.
    Your voice profile is strictly ${agent.voice}. 
    
    CRITICAL: YOU MUST RESPOND ONLY IN THE LANGUAGE CODE: "${targetLanguage}".
    Even if the user speaks to you in a different language, translate your logic and respond in "${targetLanguage}".

    KNOWLEDGE BASE:
    - Primary Catalog: ${agent.catalog || 'General professional services'}
    - Specialized Intelligence: ${docContext || 'Standard business logic'}

    OBJECTIVE: 
    Act as the physical-to-digital bridge. A customer just scanned a physical touchpoint and needs assistance.
    Qualify them as a lead and guide them towards a conversion (meeting, order, or proposal).
    
    ENGAGEMENT FLOW:
    1. Warm opening acknowledging their interest.
    2. Discovery: Ask exactly ONE clarifying question about their specific needs.
    3. Value Mapping: Once needs are clear, reference the catalog/documents to provide a solution.
    4. Offer/Convert: Suggest the next logical step.

    STRICTOR RULES:
    - Max 2 sentences per response to keep the mobile experience tight.
    - DO NOT break character. 
    - Reference specific services from the catalog whenever possible.
    - If you don't know the exact translation for a business term, use the most professional equivalent in "${targetLanguage}".
  `;

  try {
    const chat = ai.chats.create({
      model,
      config: { systemInstruction, temperature: 0.7 },
    });

    // sendMessage returns GenerateContentResponse
    const response = await chat.sendMessage({ message: userInput });
    // response.text is a getter property returning the extracted string
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "I'm having a slight connectivity issue with my knowledge base. Please try again in a moment.";
  }
};

/**
 * A helper to translate static UI elements or blocks of text for "all languages" support.
 */
export const translateContent = async (text: string, targetLanguage: string) => {
  if (targetLanguage === 'en') return text;
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Translate the following UI text to the language with code "${targetLanguage}". Maintain tone and variables like {name}: "${text}"`,
    });
    return response.text?.trim() || text;
  } catch (e) {
    return text;
  }
};

export const generateAgentProposal = async (agentName: string, context: string, targetLanguage: string = 'en') => {
  try {
    const response = await ai.models.generateContent({
      // Use gemini-3-pro-preview for complex content generation like proposals
      model: 'gemini-3-pro-preview',
      contents: `Context: ${context}. Language: ${targetLanguage}. Generate a professional business proposal from ${agentName} based on our physical engagement.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            problemAnalysis: { type: Type.STRING },
            solutionMapping: { type: Type.STRING },
            roiCalculation: { type: Type.STRING },
            investmentBreakdown: { type: Type.STRING },
            cta: { type: Type.STRING }
          },
          // Follow guidelines: use propertyOrdering for objects in responseSchema
          propertyOrdering: ["title", "problemAnalysis", "solutionMapping", "roiCalculation", "investmentBreakdown", "cta"]
        }
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("Proposal Generation Error:", error);
    return null;
  }
};
