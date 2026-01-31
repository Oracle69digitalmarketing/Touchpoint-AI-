Touchpoint AI - Conversational Infrastructure for Physical Commerce

https://img.shields.io/badge/Node.js-18+-green.svg
https://img.shields.io/badge/TypeScript-5.0-blue.svg
https://img.shields.io/badge/Next.js-14-black.svg
https://img.shields.io/badge/PostgreSQL-15-blue.svg
https://img.shields.io/badge/Redis-7-red.svg
https://img.shields.io/badge/Prisma-5-purple.svg
https://img.shields.io/badge/OpenAI-GPT--4-green.svg
https://img.shields.io/badge/License-MIT-yellow.svg

🚀 Transform Physical Marketing into AI-Driven Revenue

Touchpoint AI converts any physical marketing surface—business cards, flyers, signage, packaging—into intelligent, 24/7 conversational sales channels. Embed custom AI agents behind QR codes/NFC chips to engage prospects, qualify leads, and book meetings automatically.

✨ Key Features

· 🤖 Custom AI Agents: Train business-specific AI that knows your services, pricing, and brand voice
· 🔗 Multi-Channel Activation: WhatsApp, SMS, USSD, Web Chat, NFC - one agent adapts to any device
· 📱 Smart Routing: Automatically detects device capabilities and serves optimal interface
· 🎯 Conversational Sales Flow: Full-cycle AI conversations from engagement to conversion
· 📊 Analytics Dashboard: Track scans, conversations, qualified leads, and ROI per surface
· 🔄 CRM Integration: Native sync with HubSpot, Salesforce, Zoho, and custom webhooks
· 🖨️ Production Network: Order physical surfaces (cards, flyers, NFC) directly from platform
· 💰 Proposal Generation: AI-powered professional proposals based on conversation context

🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 14)                │
├─────────────────────────────────────────────────────────┤
│          API Gateway (Express.js/Next.js API)           │
├─────────────────────────────────────────────────────────┤
│     Services Layer (Microservices Architecture)         │
│  ├────────────┬────────────┬────────────┬─────────────┤
│  │   AI Service│  Channel   │ Analytics  │   Payment   │
│  │            │   Service   │  Service   │   Service   │
│  └────────────┴────────────┴────────────┴─────────────┤
├─────────────────────────────────────────────────────────┤
│         Database Layer (PostgreSQL + Redis)            │
└─────────────────────────────────────────────────────────┘
```

🛠️ Tech Stack

Backend:

· Node.js 18+ with Express.js/TypeScript
· PostgreSQL 15+ with Prisma ORM
· Redis 7+ for caching and queues
· OpenAI GPT-4 API + LangChain
· Twilio API (WhatsApp/SMS)
· Paystack/Stripe for payments
· Docker & Docker Compose

Frontend:

· Next.js 14 with App Router
· TypeScript
· Tailwind CSS + Shadcn/ui
· React Query + Zustand
· Recharts for visualizations
· React Hook Form + Zod validation

🚀 Quick Start

Prerequisites

· Node.js 18+
· PostgreSQL 15+
· Redis 7+
· Docker (optional)
· OpenAI API key
· Twilio account (for WhatsApp/SMS)

Installation

1. Clone the repository

```bash
git clone https://github.com/touchpoint-ai/touchpoint-ai.git
cd touchpoint-ai
```

1. Set up environment variables

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
# Edit both files with your API keys
```

1. Start with Docker (recommended)

```bash
docker-compose up -d
```

1. Or run manually

```bash
# Backend
cd backend
npm install
npx prisma migrate dev
npx prisma generate
npm run dev

# Frontend (in new terminal)
cd frontend
npm install
npm run dev
```

1. Access the application

· Frontend: http://localhost:3000
· Backend API: http://localhost:5000
· API Documentation: http://localhost:5000/api/docs
· Prisma Studio: http://localhost:5555

📁 Project Structure

```
touchpoint-ai/
├── backend/                 # Express.js API server
│   ├── src/
│   │   ├── config/         # Configuration files
│   │   ├── controllers/    # Route controllers
│   │   ├── middleware/     # Custom middleware
│   │   ├── models/         # Database models (Prisma)
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   └── utils/          # Utility functions
│   ├── prisma/             # Prisma schema and migrations
│   └── tests/              # Test files
├── frontend/               # Next.js 14 application
│   ├── app/                # Next.js app router pages
│   ├── components/         # React components
│   │   ├── ui/            # Reusable UI components
│   │   ├── dashboard/     # Dashboard components
│   │   └── forms/         # Form components
│   ├── lib/               # Utility libraries
│   └── types/             # TypeScript definitions
├── shared/                 # Shared types and utilities
├── infrastructure/         # Deployment configurations
├── docker-compose.yml      # Docker orchestration
└── README.md               # This file
```

🎯 Usage Examples

1. Create an AI Agent

```javascript
const agent = await api.trainAgent({
  name: "Real Estate Assistant",
  brandVoice: "professional",
  serviceCatalog: "Property tours, financing assistance...",
  clientProfiles: "First-time buyers, ages 25-40...",
  conversionWorkflows: "Tour booking → Qualification → Proposal"
});
```

2. Generate Marketing Surface

```javascript
const surface = await api.generateSurface({
  type: "business-card",
  design: { logo: "...", colors: "#2563eb" },
  agentId: "agent_123",
  quantity: 100
});
```

3. Handle Conversation

```javascript
// Webhook handler for WhatsApp
app.post('/webhooks/whatsapp', async (req, res) => {
  const { From, Body } = req.body;
  const response = await aiService.handleConversation(agentId, Body);
  await channelService.sendWhatsAppMessage(From, response.message);
});
```

📊 API Reference

Authentication

```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
```

Agents

```http
POST /api/agents          # Create agent
GET  /api/agents          # List agents
POST /api/agents/{id}/train  # Train agent
POST /api/agents/{id}/test   # Test agent
```

Surfaces

```http
POST /api/surfaces        # Create surface
GET  /api/surfaces        # List surfaces
POST /api/surfaces/{id}/order  # Order physical
```

Webhooks

```http
POST /api/webhooks/whatsapp  # WhatsApp messages
POST /api/webhooks/sms       # SMS messages
POST /api/webhooks/payment   # Payment notifications
```

Complete API documentation available at /api/docs when running locally.

🧪 Testing

```bash
# Run backend tests
cd backend
npm test

# Run frontend tests
cd frontend
npm test

# Run E2E tests
npm run test:e2e
```

🐳 Docker Deployment

```bash
# Build and run
docker-compose up -d --build

# View logs
docker-compose logs -f

# Run migrations
docker-compose exec backend npx prisma migrate deploy

# Access services
# App: http://localhost:3000
# API: http://localhost:5000
# DB: localhost:5432
# Redis: localhost:6379
```

🌐 Environment Variables

Key environment variables:

```env
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/touchpoint"
REDIS_URL="redis://localhost:6379"

# Authentication
JWT_SECRET="your-jwt-secret"

# AI Services
OPENAI_API_KEY="sk-..."

# Communication
TWILIO_ACCOUNT_SID="AC..."
TWILIO_AUTH_TOKEN="..."

# Payments
PAYSTACK_PUBLIC_KEY="pk_..."
PAYSTACK_SECRET_KEY="sk_..."
```

See .env.example files for complete list.

🤝 Contributing

We welcome contributions! Please see our Contributing Guidelines for details.

1. Fork the repository
2. Create a feature branch (git checkout -b feature/amazing-feature)
3. Commit changes (git commit -m 'Add amazing feature')
4. Push to branch (git push origin feature/amazing-feature)
5. Open a Pull Request

📈 Roadmap

· MVP: WhatsApp + QR Code integration
· Multi-agent support
· USSD channel integration (Q1 2026)
· NFC support (Q1 2026)
· Mobile app (Q2 2026)
· White-label platform (Q3 2026)
· International expansion (Q4 2026)

📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

📞 Contact & Support

· Website: https://touchpoint.ai
· Email: support@touchpoint.ai
· LinkedIn: Touchpoint AI
· Twitter: @touchpoint_ai

🙏 Acknowledgments

· OpenAI for GPT-4 API
· Twilio for WhatsApp/SMS infrastructure
· Prisma for amazing ORM
· Next.js team for incredible React framework
· All our beta customers for valuable feedback

---

Made with ❤️ in Nigeria | Building the future of physical commerce
