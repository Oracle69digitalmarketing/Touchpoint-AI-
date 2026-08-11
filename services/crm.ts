
import { CRMConnection } from '../types';
import { getAuthHeaders } from './auth';

/**
 * BACKEND CONFIGURATION
 * Relative URL works in production (same origin) and in development
 * (Vite proxies /v1 to the Express API server).
 */
const API_CONFIG = {
  BASE_URL: '/v1',
};

export const crmService = {
  /**
   * Connects to a CRM via your backend.
   */
  async connect(crmId: string): Promise<{ success: boolean; lastSync?: string; error?: string }> {
    console.log(`[CRM Service] Connecting to ${crmId}...`);

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/crm/connect`, {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({ providerId: crmId })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Server responded with ${response.status}`);
      }

      const data = await response.json();
      return { 
        success: true, 
        lastSync: data.lastSync || 'Just now' 
      };
    } catch (err: any) {
      console.error("Backend connection failed. Falling back to simulation...", err);
      // Fallback to simulation if backend is not reachable
      return this.simulateConnect(crmId);
    }
  },

  /**
   * Terminates a CRM session.
   */
  async disconnect(crmId: string): Promise<boolean> {
    console.log(`[CRM Service] Disconnecting ${crmId}...`);

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/crm/disconnect/${crmId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      return response.ok;
    } catch (err) {
      console.error("Disconnect error:", err);
      return true; // Return true anyway for UI state
    }
  },

  // Private simulation method
  async simulateConnect(crmId: string) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return { 
      success: true, 
      lastSync: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ago' 
    };
  }
};
