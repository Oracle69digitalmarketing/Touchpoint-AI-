
import React, { useEffect, useState } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import AgentManager from './components/AgentManager';
import TouchpointMatrix from './components/TouchpointMatrix';
import SurfaceGenerator from './components/SurfaceGenerator';
import AgentTrainingWizard from './components/AgentTrainingWizard';
import ConversationHub from './components/ConversationHub';
import Settings from './components/Settings';
import OnboardingGuide from './components/OnboardingGuide';
import { Agent, Touchpoint, Conversation, CRMConnection, SubscriptionPlan, PLAN_LIMITS, AgentStatus, Lead, LeadNotification } from './types';
import { crmService } from './services/crm';
import { agentService, touchpointService, AgentInput, TouchpointInput } from './services/workspace';
import { conversationService } from './services/conversations';
import { leadService } from './services/leads';
import { billingService } from './services/billing';
import AuthGate, { useAuth } from './components/AuthGate';

const App: React.FC = () => {
  return (
    <AuthGate>
      <Workspace />
    </AuthGate>
  );
};

const Workspace: React.FC = () => {
  const { business, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [language, setLanguage] = useState('en');
  const [currency, setCurrency] = useState('NGN');
  
  // Persistence States
  const [subscription, setSubscription] = useState<SubscriptionPlan>(business.plan || 'Free');
  const [crms, setCrms] = useState<CRMConnection[]>([
    { id: 'hubspot', name: 'HubSpot', status: 'disconnected', icon: '🟠' },
    { id: 'salesforce', name: 'Salesforce', status: 'disconnected', icon: '☁️' },
    { id: 'zoho', name: 'Zoho CRM', status: 'disconnected', icon: '🔴' }
  ]);

  // Data states — persisted server-side under the authenticated business.
  const [agents, setAgents] = useState<Agent[]>([]);
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [notifications, setNotifications] = useState<LeadNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  // Load the authenticated business's persisted data.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [agentList, tpList, convoList, leadList, notifData] = await Promise.all([
          agentService.list(),
          touchpointService.list(),
          conversationService.list(),
          leadService.list(),
          leadService.listNotifications(),
        ]);
        if (!cancelled) {
          setAgents(agentList);
          setTouchpoints(tpList);
          setConversations(convoList);
          setLeads(leadList);
          setNotifications(notifData.notifications);
          setUnreadNotifications(notifData.unread);
        }
      } catch (err) {
        console.error('[Workspace] Failed to load persisted data:', err);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync the plan with the server's authoritative subscription. The client
  // initial guess comes from the session, but expiry/cancellation happen
  // server-side, so this fetch keeps the enforced plan honest.
  useEffect(() => {
    let cancelled = false;
    billingService.subscription()
      .then((sub) => { if (!cancelled) setSubscription(sub.plan); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Poll for newly qualified leads so the in-app bell stays fresh without any
  // external services — the simplest reliable notification mechanism here.
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await leadService.listNotifications();
        setNotifications(data.notifications);
        setUnreadNotifications(data.unread);
      } catch (err) {
        // Transient polling failure is fine; next tick retries.
      }
    };
    const interval = window.setInterval(poll, 30000);
    return () => window.clearInterval(interval);
  }, []);

  const handleReadNotifications = async () => {
    try {
      await leadService.markNotificationsRead();
      setUnreadNotifications(0);
      setNotifications(prev => prev.map(n => ({ ...n, readAt: new Date().toISOString() })));
    } catch (err) {
      console.error('[Workspace] Failed to mark notifications read:', err);
    }
  };

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

  const handleOpenWizard = (agent?: Agent | null) => {
    if (!agent) {
      const limits = PLAN_LIMITS[subscription];
      if (agents.length >= limits.agents) {
        alert(`Limit Reached: Your ${subscription} plan supports up to ${limits.agents} agent(s).`);
        return;
      }
    }
    setEditingAgent(agent || null);
    setIsWizardOpen(true);
  };

  const handleWizardComplete = async (data: AgentInput) => {
    try {
      if (editingAgent) {
        const updated = await agentService.update(editingAgent.id, data);
        setAgents(prev => prev.map(a => a.id === updated.id ? updated : a));
      } else {
        const created = await agentService.create(data);
        setAgents(prev => [created, ...prev]);
      }
      setIsWizardOpen(false);
      setEditingAgent(null);
      setActiveTab('agents');
    } catch (err: any) {
      alert(err.message || 'Could not save agent.');
    }
  };

  const handleDeleteAgent = async (agent: Agent) => {
    if (!confirm(`Delete "${agent.name}"? Its touchpoints will be removed too.`)) return;
    try {
      await agentService.remove(agent.id);
      setAgents(prev => prev.filter(a => a.id !== agent.id));
      const remaining = await touchpointService.list();
      setTouchpoints(remaining);
    } catch (err: any) {
      alert(err.message || 'Could not delete agent.');
    }
  };

  const handleToggleAgentStatus = async (agent: Agent) => {
    try {
      const updated = await agentService.update(agent.id, {
        status: agent.status === AgentStatus.ACTIVE ? AgentStatus.INACTIVE : AgentStatus.ACTIVE,
      });
      setAgents(prev => prev.map(a => a.id === updated.id ? updated : a));
    } catch (err: any) {
      alert(err.message || 'Could not update agent status.');
    }
  };

  const handleDeployTouchpoint = async (input: TouchpointInput): Promise<Touchpoint> => {
    const created = await touchpointService.create(input);
    setTouchpoints(prev => [created, ...prev]);
    return created;
  };

  const handleToggleTouchpoint = async (tp: Touchpoint) => {
    try {
      const updated = await touchpointService.update(tp.id, { active: !tp.active });
      setTouchpoints(prev => prev.map(t => t.id === updated.id ? updated : t));
    } catch (err: any) {
      alert(err.message || 'Could not update touchpoint.');
    }
  };

  const handleDeleteTouchpoint = async (tp: Touchpoint) => {
    if (!confirm(`Delete touchpoint "${tp.name}"?`)) return;
    try {
      await touchpointService.remove(tp.id);
      setTouchpoints(prev => prev.filter(t => t.id !== tp.id));
    } catch (err: any) {
      alert(err.message || 'Could not delete touchpoint.');
    }
  };

  const renderContent = () => {
    const contentClass = "animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both";
    switch (activeTab) {
      case 'dashboard':
        return <div className={contentClass}><Dashboard touchpoints={touchpoints} agents={agents} /></div>;
      case 'agents':
        return (
          <div className={`space-y-6 ${contentClass}`}>
            <AgentManager
              agents={agents}
              onOpenWizard={() => handleOpenWizard()}
              onEditAgent={handleOpenWizard}
              onDeleteAgent={handleDeleteAgent}
              onToggleStatus={handleToggleAgentStatus}
              onNavigate={setActiveTab}
            />
            {isWizardOpen && (
              <AgentTrainingWizard
                agent={editingAgent}
                onComplete={handleWizardComplete}
                onCancel={() => { setIsWizardOpen(false); setEditingAgent(null); }}
              />
            )}
          </div>
        );
      case 'touchpoints':
        return (
          <div className={`space-y-8 ${contentClass}`}>
            <TouchpointMatrix
              touchpoints={touchpoints}
              onToggleActive={handleToggleTouchpoint}
              onDelete={handleDeleteTouchpoint}
            />
            <SurfaceGenerator
              agents={agents}
              onDeploy={handleDeployTouchpoint}
              onNavigate={setActiveTab}
            />
          </div>
        );
      case 'conversations':
        return <div className={contentClass}><ConversationHub conversations={conversations} leads={leads} agents={agents} currentLanguage={language} currentCurrency={currency} /></div>;
      case 'settings':
        return <div className={contentClass}><Settings 
          currentLanguage={language} onLanguageChange={setLanguage} currentCurrency={currency} onCurrencyChange={setCurrency}
          crms={crms} onConnectCRM={handleConnectCRM} onDisconnectCRM={handleDisconnectCRM}
          subscription={subscription} setSubscription={setSubscription}
        /></div>;
      case 'onboarding':
        return <div className={contentClass}><OnboardingGuide /></div>;
      default:
        return <div className={contentClass}><Dashboard touchpoints={touchpoints} agents={agents} /></div>;
    }
  };

  return (
    <Layout 
      activeTab={activeTab} setActiveTab={setActiveTab} 
      currentLanguage={language} onLanguageChange={setLanguage}
      currentCurrency={currency} onCurrencyChange={setCurrency}
      subscription={subscription}
      usage={{ agents: agents.length, touchpoints: touchpoints.length }}
      notifications={notifications}
      unreadNotifications={unreadNotifications}
      onReadNotifications={handleReadNotifications}
      businessName={business.name}
      onLogout={logout}
    >
      <div className="max-w-7xl mx-auto">{renderContent()}</div>
    </Layout>
  );
};

export default App;
