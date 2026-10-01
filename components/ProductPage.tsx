
import React from 'react';
import {
  QrCode,
  MessagesSquare,
  Bot,
  GraduationCap,
  ScanLine,
  UserCheck,
  Sparkles,
  ShoppingCart,
  CalendarCheck,
  CreditCard,
  HandHelping,
  BarChart3,
  ArrowRight,
  Check,
  UtensilsCrossed,
  BedDouble,
  ShoppingBag,
  School,
  Building2,
  CalendarDays,
  HeartPulse,
  Briefcase,
} from 'lucide-react';

/**
 * Public buyer-facing product page for TouchPoint AI.
 *
 * Rendered OUTSIDE <AuthGate> (see App.tsx): it must never call useAuth(),
 * never fetch authenticated APIs, and never require a session.
 */
const containerClass = 'mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10';

const SectionHeading: React.FC<{ eyebrow: string; title: string; body?: string }> = ({
  eyebrow,
  title,
  body,
}) => (
  <div className="max-w-3xl">
    <p className="text-[11px] font-black uppercase tracking-[0.3em] text-indigo-600">{eyebrow}</p>
    <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{title}</h2>
    {body && <p className="mt-3 text-sm leading-6 text-slate-500 sm:text-base sm:leading-7">{body}</p>}
  </div>
);

const CapabilityCard: React.FC<{ icon: React.ReactNode; title: string; body: string }> = ({
  icon,
  title,
  body,
}) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-lg">
    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
      {icon}
    </div>
    <h3 className="mt-4 text-base font-black text-slate-900">{title}</h3>
    <p className="mt-2 text-sm leading-6 text-slate-500">{body}</p>
  </div>
);

const INDUSTRIES: { icon: React.ReactNode; name: string; body: string }[] = [
  {
    icon: <UtensilsCrossed size={18} />,
    name: 'Restaurants & food',
    body: 'Table codes that answer menu questions, take orders, and hand dietary or catering enquiries to staff.',
  },
  {
    icon: <BedDouble size={18} />,
    name: 'Hotels & hospitality',
    body: 'Room and lobby touchpoints that answer guest questions, take service requests, and route issues to the front desk.',
  },
  {
    icon: <ShoppingBag size={18} />,
    name: 'Retail',
    body: 'Shelf and window codes that explain products, recommend options, and capture shoppers outside opening hours.',
  },
  {
    icon: <School size={18} />,
    name: 'Schools & education',
    body: 'Enquiry codes for admissions and programmes that answer common questions and qualify prospective families.',
  },
  {
    icon: <Building2 size={18} />,
    name: 'Real estate',
    body: 'Listing boards and flyers that answer property questions, book viewings, and capture interested buyers.',
  },
  {
    icon: <CalendarDays size={18} />,
    name: 'Events',
    body: 'Badges, posters, and tickets that share schedules, answer attendee questions, and collect follow-up details.',
  },
  {
    icon: <HeartPulse size={18} />,
    name: 'Healthcare',
    body: 'Reception touchpoints that explain services, handle appointment requests, and route patients to staff.',
  },
  {
    icon: <Briefcase size={18} />,
    name: 'Professional services',
    body: 'Cards, proposals, and office codes that explain services, qualify enquiries, and book consultations.',
  },
];

const ProductPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
      {/* Top navigation — public, no session required */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
        <div className={`${containerClass} flex h-16 items-center justify-between`}>
          <a href="/product" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-600 text-sm font-black text-white shadow-lg shadow-indigo-100">
              T
            </span>
            <span className="leading-none">
              <span className="block text-base font-black tracking-tight">TouchPoint AI</span>
              <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-widest text-indigo-500">
                Product
              </span>
            </span>
          </a>
          <nav className="hidden items-center gap-6 text-sm font-bold text-slate-500 lg:flex" aria-label="Product sections">
            <a className="transition-colors hover:text-slate-900" href="#how-it-works">How it works</a>
            <a className="transition-colors hover:text-slate-900" href="#capabilities">Capabilities</a>
            <a className="transition-colors hover:text-slate-900" href="#industries">Industries</a>
            <a className="transition-colors hover:text-slate-900" href="#pricing">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:border-indigo-200 hover:text-indigo-700"
            >
              Sign in
            </a>
            <a
              href="/"
              className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-xl shadow-slate-200 transition-colors hover:bg-indigo-600"
            >
              Open app
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-72 max-w-3xl rounded-full bg-gradient-to-br from-indigo-200 via-indigo-100 to-emerald-100 blur-3xl"
          />
          <div className={`${containerClass} relative pb-12 pt-12 sm:pb-16 sm:pt-16 lg:pt-20`}>
            <div className="grid items-center gap-10 lg:grid-cols-2">
              <div>
                <p className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-widest text-indigo-600 shadow-sm">
                  <Sparkles size={13} /> AI customer interaction &amp; transaction platform
                </p>
                <h1 className="mt-5 text-3xl font-black leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                  Turn QR codes, NFC, web and WhatsApp into{' '}
                  <span className="bg-gradient-to-r from-indigo-600 to-emerald-500 bg-clip-text text-transparent">
                    intelligent business touchpoints
                  </span>
                </h1>
                <p className="mt-5 max-w-xl text-sm leading-7 text-slate-500 sm:text-base">
                  TouchPoint AI is software your business configures once. Customers scan, tap, or
                  message a touchpoint, talk with an AI agent trained on your business, and move
                  from interaction to AI conversation to lead or transaction — with staff stepping
                  in exactly when a human is needed.
                </p>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <a
                    href="/"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-200 transition-colors hover:bg-indigo-700"
                  >
                    Get started <ArrowRight size={16} />
                  </a>
                  <a
                    href="#how-it-works"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-bold text-slate-700 transition-colors hover:border-indigo-200 hover:text-indigo-700"
                  >
                    See how it works
                  </a>
                </div>
                <p className="mt-4 text-xs font-bold text-slate-400">
                  For F6S readers: this page describes the software. The workspace itself lives at{' '}
                  <a href="/" className="text-indigo-600 underline underline-offset-2">/</a>.
                </p>
              </div>
              {/* Visual: interaction → conversation → outcome */}
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-200 sm:p-8">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
                  The TouchPoint AI flow
                </p>
                <ol className="mt-4 space-y-3">
                  {[
                    { step: '1', title: 'Customer interacts', body: 'Scan a QR, tap NFC, open a web link, or message on WhatsApp.' },
                    { step: '2', title: 'AI conversation', body: 'An agent trained on your business answers, recommends, and qualifies.' },
                    { step: '3', title: 'Lead or transaction', body: 'Details captured, order or booking started, or payment initiated.' },
                    { step: '4', title: 'Staff action', body: 'Your team sees the conversation and follows up where a human adds value.' },
                  ].map((row) => (
                    <li key={row.step} className="flex gap-4 rounded-2xl bg-slate-50 p-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-black text-white">
                        {row.step}
                      </span>
                      <span>
                        <span className="block text-sm font-black text-slate-900">{row.title}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{row.body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* WHAT TOUCHPOINT AI IS */}
        <section id="what-it-is" className={`${containerClass} py-12 sm:py-16`}>
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
            <SectionHeading
              eyebrow="What it is"
              title="What TouchPoint AI is"
              body="TouchPoint AI is an AI-powered customer interaction and transaction platform. It connects the physical and digital places customers already encounter your business — a table sticker, a counter card, an NFC tag, a website button, a WhatsApp number — to an AI agent that can hold a useful sales and service conversation on your behalf."
            />
            <div className="space-y-3 text-sm leading-6 text-slate-500">
              <p>
                Each touchpoint is linked to an agent you configure in the workspace: its name,
                industry, description, service catalog, client profiles, success stories, and
                guidelines. When a customer opens that touchpoint, the agent uses that material —
                and only that material — to answer questions, so replies stay grounded in what
                your business actually offers.
              </p>
              <p>
                Behind the touchpoints is an operator workspace with agents, touchpoints,
                conversations, leads, a sales funnel view, a product catalog, bookings, orders and
                payments, and interaction analytics. Customers see a simple chat; your team sees
                the pipeline that chat creates.
              </p>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="border-y border-slate-200 bg-white">
          <div className={`${containerClass} py-12 sm:py-16`}>
            <SectionHeading
              eyebrow="How it works"
              title="From interaction to staff action in four steps"
              body="The same path runs on every channel. You set up the agent and the touchpoint once; every customer interaction after that follows the same structured flow."
            />
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: <ScanLine size={18} />,
                  title: '1. Customer interacts',
                  body: 'A customer scans your QR code, taps an NFC tag, opens your web touchpoint link, or messages you on WhatsApp.',
                },
                {
                  icon: <MessagesSquare size={18} />,
                  title: '2. AI conversation',
                  body: 'Your trained agent greets them, discovers what they need, answers from your catalog, and recommends a fitting option.',
                },
                {
                  icon: <UserCheck size={18} />,
                  title: '3. Lead or transaction',
                  body: 'The agent qualifies interest, captures contact details, and moves toward an order, booking, or payment where relevant.',
                },
                {
                  icon: <HandHelping size={18} />,
                  title: '4. Staff action',
                  body: 'Conversations, leads, orders, and bookings land in your workspace so staff can follow up, confirm, or take over.',
                },
              ].map((card) => (
                <CapabilityCard key={card.title} icon={card.icon} title={card.title} body={card.body} />
              ))}
            </div>
          </div>
        </section>

        {/* CORE PLATFORM CAPABILITIES */}
        <section id="capabilities" className={`${containerClass} py-12 sm:py-16`}>
          <SectionHeading
            eyebrow="Platform"
            title="Core platform capabilities"
            body="Everything below is part of the same workspace: the agent you train, the touchpoints you deploy, and the conversations, leads, orders, bookings, and analytics they produce."
          />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CapabilityCard
              icon={<Bot size={18} />}
              title="Configurable AI agents"
              body="Create agents per business line, give each a name, industry, and voice, and activate or pause them as needed."
            />
            <CapabilityCard
              icon={<QrCode size={18} />}
              title="Deployable touchpoints"
              body="Generate QR, NFC, web, and WhatsApp entry points per agent, toggle them active, and track scans over time."
            />
            <CapabilityCard
              icon={<MessagesSquare size={18} />}
              title="Conversation workspace"
              body="Read and review customer conversations, see the agent's sales state, and open the linked lead in one click."
            />
            <CapabilityCard
              icon={<UserCheck size={18} />}
              title="Lead pipeline & funnel"
              body="Follow leads from new to qualified, inspect qualification signals, and view funnel movement across touchpoints."
            />
            <CapabilityCard
              icon={<ShoppingCart size={18} />}
              title="Catalog, orders & payments"
              body="Maintain a structured product and service catalog, take orders from conversations, and initialise payments."
            />
            <CapabilityCard
              icon={<BarChart3 size={18} />}
              title="Analytics"
              body="Review interaction, touchpoint, agent, and funnel analytics to see which entry points produce conversations."
            />
          </div>
        </section>

        {/* AI SALES & CUSTOMER SERVICE AGENT */}
        <section className="border-y border-slate-200 bg-white">
          <div className={`${containerClass} py-12 sm:py-16`}>
            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
              <SectionHeading
                eyebrow="AI agent"
                title="AI sales & customer service agent"
                body="Each agent is a digital brand ambassador for one part of your business. It talks with customers in natural language, keeps replies short and professional, asks at most one focused question at a time, and moves the conversation forward: discover, understand, recommend, handle objections, qualify, and advance."
              />
              <ul className="space-y-3">
                {[
                  'Answers product and service questions from your own catalog material.',
                  'Quotes only the prices you configured — never invented figures.',
                  'Responds to price, comparison, and trust objections using your guidelines.',
                  'Detects buying signals and moves toward contact details, a meeting, or a handoff.',
                  'Redirects off-topic messages back to the customer\u2019s needs.',
                ].map((item) => (
                  <li key={item} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <Check size={14} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* BUSINESS-SPECIFIC AI TRAINING */}
        <section className={`${containerClass} py-12 sm:py-16`}>
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
            <div>
              <SectionHeading
                eyebrow="Training"
                title="Business-specific AI training"
                body="Training in TouchPoint AI means giving the agent your business knowledge through the workspace — no code, no model work. The agent treats that material as its only source of truth about your business."
              />
              <div className="mt-6 flex items-start gap-3 rounded-3xl border border-indigo-100 bg-indigo-50/60 p-5 text-sm leading-6 text-slate-600">
                <GraduationCap size={18} className="mt-0.5 shrink-0 text-indigo-600" />
                <p>
                  If a fact is not in your materials, the agent says it does not have that
                  information and offers a next step — a call, a meeting, or capturing contact
                  details — instead of guessing.
                </p>
              </div>
            </div>
            <div className="grid content-start gap-3 sm:grid-cols-2">
              {[
                { title: 'Business description', body: 'What you do, in your own words.' },
                { title: 'Service catalog', body: 'Products, services, prices, and availability.' },
                { title: 'Client profiles', body: 'Who you serve and what they need.' },
                { title: 'Success stories', body: 'Examples the agent may reference for credibility.' },
                { title: 'Guidelines', body: 'How you want the agent to behave and what to avoid.' },
                { title: 'Reference files', body: 'Stored for human consultation; never quoted by the agent.' },
              ].map((item) => (
                <div key={item.title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-sm font-black text-slate-900">{item.title}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TOUCHPOINT CHANNELS */}
        <section className="border-y border-slate-200 bg-slate-900 text-white">
          <div className={`${containerClass} py-12 sm:py-16`}>
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-indigo-300">Touchpoints</p>
            <h2 className="mt-3 max-w-3xl text-2xl font-black tracking-tight sm:text-3xl">
              QR, NFC, web, and WhatsApp touchpoints
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              A touchpoint is any entry point you place where customers already are. Each one is
              tied to an agent and carries its own tracking link, so scans and conversations can
              be attributed to the physical or digital placement that produced them.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: <QrCode size={18} />, title: 'QR codes', body: 'Print on tables, receipts, packaging, posters, and cards. Customers scan and start chatting immediately.' },
                { icon: <ScanLine size={18} />, title: 'NFC tags', body: 'Tap-to-chat placements for counters, doors, and displays where scanning feels like friction.' },
                { icon: <MessagesSquare size={18} />, title: 'Web links', body: 'Shareable touchpoint links for websites, bios, flyers, and campaigns that open the same chat.' },
                { icon: <Bot size={18} />, title: 'WhatsApp', body: 'Meet customers in the messaging app they already use, backed by the same trained agent.' },
              ].map((card) => (
                <div key={card.title} className="rounded-3xl border border-white/10 bg-white/5 p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-200">
                    {card.icon}
                  </div>
                  <h3 className="mt-4 text-base font-black">{card.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{card.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CONVERSATION OUTCOMES */}
        <section className={`${containerClass} py-12 sm:py-16`}>
          <SectionHeading
            eyebrow="Outcomes"
            title="What conversations can lead to"
            body="The agent adapts to the customer's message — it does not follow a rigid script — but every path is designed to end in something your business can act on."
          />
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <CapabilityCard
              icon={<UserCheck size={18} />}
              title="Lead capture and qualification"
              body="When interest is genuine, the agent naturally requests a name, phone, or email, scores the lead, and files it in your pipeline for follow-up."
            />
            <CapabilityCard
              icon={<Sparkles size={18} />}
              title="Product & service recommendations"
              body="The agent matches what the customer said they need against your structured catalog and explains briefly why the option fits — or says honestly when nothing fits."
            />
            <CapabilityCard
              icon={<ShoppingCart size={18} />}
              title="Orders"
              body="Customers can build an order from catalog items inside the conversation. Orders are recorded in the workspace with their items and status."
            />
            <CapabilityCard
              icon={<CalendarCheck size={18} />}
              title="Bookings and appointments"
              body="For bookable services, the agent can check availability, hold a time slot, and create a booking your team can confirm, reschedule, or cancel."
            />
            <CapabilityCard
              icon={<CreditCard size={18} />}
              title="Payments"
              body="Where payment applies, the workspace can initialise a payment for an order through the configured provider, keeping amounts and references server-side."
            />
            <CapabilityCard
              icon={<HandHelping size={18} />}
              title="Human handoff"
              body="When a customer asks for a person — or the conversation genuinely needs one — the agent offers to pass details to your team via phone, WhatsApp, email, or a meeting."
            />
          </div>
        </section>

        {/* ANALYTICS */}
        <section className="border-y border-slate-200 bg-white">
          <div className={`${containerClass} py-12 sm:py-16`}>
            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
              <SectionHeading
                eyebrow="Analytics"
                title="Interaction and conversation analytics"
                body="Because every touchpoint carries its own tracking link, the workspace can show which placements produce scans, which produce conversations, and how those conversations move through your funnel."
              />
              <ul className="space-y-3">
                {[
                  'Touchpoint performance: scans and conversations per placement.',
                  'Agent view: how each trained agent is performing in live chats.',
                  'Funnel view: movement from interaction to qualified lead or transaction.',
                  'Lead review: qualification signals and scores attached to each lead.',
                ].map((item) => (
                  <li key={item} className="flex gap-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
                      <BarChart3 size={14} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* INDUSTRIES */}
        <section id="industries" className={`${containerClass} py-12 sm:py-16`}>
          <SectionHeading
            eyebrow="Use cases"
            title="Industries and use cases"
            body="Any business with recurring customer questions and a need to capture demand can use touchpoints. Common starting points include:"
          />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {INDUSTRIES.map((industry) => (
              <div key={industry.name} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  {industry.icon}
                </div>
                <h3 className="mt-4 text-sm font-black text-slate-900">{industry.name}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-500">{industry.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="border-y border-slate-200 bg-white">
          <div className={`${containerClass} py-12 sm:py-16`}>
            <SectionHeading
              eyebrow="Pricing"
              title="Plans that scale with your needs"
              body="Three plans cover solo operators through larger teams. Pricing is scoped to your needs — contact us from the workspace to discuss the right fit. No prices are listed here."
            />
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                {
                  name: 'Starter',
                  body: 'For a single business getting its first touchpoints live: one trained agent, everyday touchpoint placements, and lead capture.',
                  points: ['AI agent trained on your business', 'QR / NFC / web / WhatsApp touchpoints', 'Lead capture and conversation history'],
                },
                {
                  name: 'Growth',
                  body: 'For growing businesses running more placements and conversations: additional agents and deeper pipeline tooling.',
                  points: ['Multiple agents for different services', 'Orders, bookings, and funnel views', 'Team-friendly lead management'],
                  featured: true,
                },
                {
                  name: 'Business',
                  body: 'For established operations with higher volume and more staff involved in follow-up and fulfilment.',
                  points: ['Higher capacity across agents and touchpoints', 'Full pipeline and analytics coverage', 'Priority configuration support'],
                },
              ].map((plan) => (
                <div
                  key={plan.name}
                  className={`flex flex-col rounded-[32px] border p-7 shadow-sm ${
                    plan.featured
                      ? 'border-indigo-600 bg-slate-900 text-white shadow-2xl'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <h3 className={`text-lg font-black ${plan.featured ? 'text-white' : 'text-slate-900'}`}>{plan.name}</h3>
                  <p className={`mt-1 text-[11px] font-black uppercase tracking-widest ${plan.featured ? 'text-indigo-300' : 'text-indigo-600'}`}>
                    Pricing based on needs
                  </p>
                  <p className={`mt-3 text-sm leading-6 ${plan.featured ? 'text-slate-300' : 'text-slate-500'}`}>{plan.body}</p>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {plan.points.map((point) => (
                      <li key={point} className={`flex gap-2.5 text-sm leading-6 ${plan.featured ? 'text-slate-200' : 'text-slate-600'}`}>
                        <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${plan.featured ? 'bg-indigo-500/30 text-indigo-200' : 'bg-emerald-100 text-emerald-700'}`}>
                          <Check size={12} />
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                  <a
                    href="/"
                    className={`mt-6 inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-colors ${
                      plan.featured
                        ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                        : 'bg-slate-900 text-white hover:bg-indigo-600'
                    }`}
                  >
                    Choose {plan.name} <ArrowRight size={15} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className={`${containerClass} py-12 sm:py-16`}>
          <div className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-indigo-600 to-indigo-800 px-6 py-12 text-center text-white shadow-2xl shadow-indigo-200 sm:px-12">
            <h2 className="mx-auto max-w-2xl text-2xl font-black tracking-tight sm:text-3xl">
              Put an intelligent touchpoint wherever your customers already are
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-indigo-100 sm:text-base">
              Set up your agent, deploy your first QR, NFC, web, or WhatsApp touchpoint, and let
              every interaction become a conversation your team can act on.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href="/"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-indigo-700 transition-colors hover:bg-indigo-50"
              >
                Open the TouchPoint AI app <ArrowRight size={16} />
              </a>
              <a
                href="#what-it-is"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/30 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-white/10"
              >
                Re-read what it is
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-200 bg-white">
        <div className={`${containerClass} flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between`}>
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-xs font-black text-white">T</span>
            <div>
              <p className="text-sm font-black text-slate-900">TouchPoint AI</p>
              <p className="text-xs text-slate-400">Built by Oracle69 Systems</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold text-slate-400">
            <a href="/product" className="transition-colors hover:text-slate-700">Product</a>
            <a href="/" className="transition-colors hover:text-slate-700">Sign in</a>
            <a href="/" className="transition-colors hover:text-slate-700">Open app</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default ProductPage;
