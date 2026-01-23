
import React, { useState } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import AgentManager from './components/AgentManager';
import TouchpointMatrix from './components/TouchpointMatrix';
import SurfaceGenerator from './components/SurfaceGenerator';
import AgentTrainingWizard from './components/AgentTrainingWizard';
import ConversationHub from './components/ConversationHub';
import Settings from './components/Settings';
import { Agent, Touchpoint, Conversation, CRMConnection, SubscriptionPlan, PLAN_LIMITS } from './types';
import { crmService } from './services/crm';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [language, setLanguage] = useState('en');
  const [currency, setCurrency] = useState('USD');
  
  // Persistence States
  const [subscription, setSubscription] = useState<SubscriptionPlan>('Free');
  const [crms, setCrms] = useState<CRMConnection[]>([
    { id: 'hubspot', name: 'HubSpot', status: 'disconnected', icon: '🟠' },
    { id: 'salesforce', name: 'Salesforce', status: 'disconnected', icon: '☁️' },
    { id: 'zoho', name: 'Zoho CRM', status: 'disconnected', icon: '🔴' }
  ]);

  // Data states
  const [agents, setAgents] = useState<Agent[]>([]);
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  /**
   * REFACTORED: Now uses isolated crmService.
   * To connect to a real backend, simply update crmService.ts
   */
  const handleConnectCRM = async (id: string) => {
    if (subscription === 'Free') {
      alert('CRM Sync is a Professional feature. Please upgrade your plan.');
      setActiveTab('settings');
      return;
    }

    // Update UI to connecting state
    setCrms(prev => prev.map(c => c.id === id ? { ...c, status: 'connecting', error: undefined } : c));
    
    // Call the service layer
    const result = await crmService.connect(id);

    if (result.success) {
      setCrms(prev => prev.map(c => c.id === id ? { ...c, status: 'connected', lastSync: result.lastSync } : c));
    } else {
      setCrms(prev => prev.map(c => c.id === id ? { ...c, status: 'disconnected', error: result.error } : c));
      alert(`Integration Error: ${result.error}`);
    }
  };

  const handleDisconnectCRM = async (id: string) => {
    const confirmed = await crmService.disconnect(id);
    if (confirmed) {
      setCrms(prev => prev.map(c => c.id === id ? { ...c, status: 'disconnected', lastSync: undefined } : c));
    }
  };

  const handleOpenWizard = () => {
    const limits = PLAN_LIMITS[subscription];
    if (agents.length >= limits.agents) {
      alert(`Limit Reached: Your ${subscription} plan supports up to ${limits.agents} agent(s).`);
      return;
    }
    setIsWizardOpen(true);
  };

  const handleCreateAgent = (newAgent: Agent) => {
    setAgents(prev => [newAgent, ...prev]);
    setIsWizardOpen(false);
    setActiveTab('agents');
  };

  const handleCreateTouchpoint = (tp: Touchpoint) => {
    const limits = PLAN_LIMITS[subscription];
    if (touchpoints.length >= limits.touchpoints) {
      alert(`Limit Reached: Your ${subscription} plan supports up to ${limits.touchpoints} touchpoint(s).`);
      return;
    }
    setTouchpoints(prev => [tp, ...prev]);
    setActiveTab('touchpoints');
  };

  const renderContent = () => {
    const contentClass = "animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both";
    switch (activeTab) {
      case 'dashboard':
        return <div className={contentClass}><Dashboard touchpoints={touchpoints} agents={agents} currentCurrency={currency} /></div>;
      case 'agents':
        return (
          <div className={`space-y-6 ${contentClass}`}>
            <AgentManager agents={agents} onOpenWizard={handleOpenWizard} onNavigate={setActiveTab} />
            {isWizardOpen && <AgentTrainingWizard onComplete={handleCreateAgent} onCancel={() => setIsWizardOpen(false)} />}
          </div>
        );
      case 'touchpoints':
        return (
          <div className={`space-y-8 ${contentClass}`}>
            <TouchpointMatrix touchpoints={touchpoints} />
            <SurfaceGenerator agents={agents} onDeploy={handleCreateTouchpoint} />
          </div>
        );
      case 'conversations':
        return <div className={contentClass}><ConversationHub conversations={conversations} agents={agents} currentLanguage={language} currentCurrency={currency} /></div>;
      case 'settings':
        return <div className={contentClass}><Settings 
          currentLanguage={language} onLanguageChange={setLanguage} currentCurrency={currency} onCurrencyChange={setCurrency}
          crms={crms} onConnectCRM={handleConnectCRM} onDisconnectCRM={handleDisconnectCRM}
          subscription={subscription} setSubscription={setSubscription}
        /></div>;
      default:
        return <div className={contentClass}><Dashboard touchpoints={touchpoints} agents={agents} currentCurrency={currency} /></div>;
    }
  };

  return (
    <Layout 
      activeTab={activeTab} setActiveTab={setActiveTab} 
      currentLanguage={language} onLanguageChange={setLanguage}
      currentCurrency={currency} onCurrencyChange={setCurrency}
      subscription={subscription}
      usage={{ agents: agents.length, touchpoints: touchpoints.length }}
    >
      <div className="max-w-7xl mx-auto">{renderContent()}</div>
    </Layout>
  );
};

export default App;
