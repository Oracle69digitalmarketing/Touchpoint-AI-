
import { Conversation, ConversationStage } from '../types';
import { getAuthHeaders } from './auth';

/**
 * CONVERSATIONS API CLIENT (authenticated)
 * Surfaces the business's persisted public-chat conversations in the
 * dashboard. The server scopes results to the authenticated business only.
 */

const API_BASE = '/v1';

interface RawConversation {
  id: string;
  touchpointId: string;
  touchpointName: string;
  agentId: string;
  agentName: string;
  customerName: string | null;
  targetLanguage: string;
  lastMessage: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  stage?: string;
  intent?: string;
  nextBestAction?: string;
  contactDeclined?: boolean;
}

const toConversation = (raw: RawConversation): Conversation => ({
  id: raw.id,
  agentId: raw.agentId,
  customerName: raw.customerName || 'Anonymous visitor',
  lastMessage: raw.lastMessage || '',
  stage: (raw.stage as ConversationStage) || ConversationStage.ENGAGE,
  isQualified: false,
  timestamp: raw.createdAt,
  intent: raw.intent,
  nextBestAction: raw.nextBestAction,
  contactDeclined: !!raw.contactDeclined,
});

export const conversationService = {
  async list(): Promise<Conversation[]> {
    const res = await fetch(`${API_BASE}/conversations`, { headers: getAuthHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Could not load conversations (${res.status})`);
    }
    return (data.conversations || []).map(toConversation);
  },
};
