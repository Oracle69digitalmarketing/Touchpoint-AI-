# Touchpoint AI — Conversational Infrastructure for Physical Commerce

> Made with ❤️ in Nigeria | Building the future of physical commerce

🚀 Transform Physical Marketing into AI-Driven Revenue

Touchpoint AI converts any physical marketing surface — business cards, flyers,
posters, signage, NFC tags — into intelligent, 24/7 conversational sales
channels. Embed custom AI agents behind QR codes/NFC chips to engage prospects,
qualify leads, and track conversions per surface.

## ✨ Key Features

- **Custom AI Agents** — business-specific agents with your services, pricing, and brand voice
- **Smart Physical Touchpoints** — QR/NFC surfaces with server-generated tracking links
- **Public Conversational Chat** — customers scan a code and chat without an account
- **Automatic Lead Capture & Qualification** — server-side deterministic scoring
- **Lead Notifications** — in-app alerts for newly qualified leads
- **Analytics Dashboard** — real scans, conversations, leads, and qualification rates per touchpoint/agent
- **Paystack Billing** — server-authoritative subscriptions, one-time or recurring
- **Identity Verification** — Paystack-backed account/BVN/bank resolution
- **CRM Connections** — tenant-scoped CRM handshake scaffolding

## 🏗️ Architecture

A **single Express monolith**: one Node.js process serves the API, the
authenticated owner dashboard, and the public customer chat. The frontend is
Vite + React (two entry points), and all data lives in one SQLite database.

```
┌──────────────────────────────────────────────────────────────┐
│                 Express.js server (server.js)                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Serves dist/ (Vite build) — dashboard + public chat   │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  API (/v1) — auth, agents, touchpoints, conversations, │  │
│  │  leads, analytics, billing, identity, crm, ai          │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  SQLite (better-sqlite3, WAL) — all tenant data        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

- Frontend build: `index.html` (owner dashboard) + `t.html` (public chat)
- Vite dev server (port 3000) proxies `/v1` and `/t` to Express
- Production: `yarn build` then `node server.js` — Express serves both the API and the built UI

## 🛠️ Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js ≥ 20 |
| Server | Express 4 |
| Frontend | Vite + React 18 + Tailwind |
| Database | SQLite via better-sqlite3 (WAL mode) |
| AI | Groq (server-side only) |
| Payments | Paystack (server-authoritative) |
| Auth | JWT + server-side sessions + bcrypt |

No Redis, no PostgreSQL, no Docker requirement, no microservices — the
application is intentionally a single deployable process with a single file
database.

## 🚀 Quick Start

Prerequisites: Node.js ≥ 20, yarn.

```bash
yarn install
cp .env.example .env        # then fill in JWT_SECRET, GROQ_API_KEY, PAYSTACK_SECRET_KEY
yarn dev                     # Vite on http://localhost:3000, Express on :3001
```

Run the server + full test suite:

```bash
yarn server                  # Express alone on :3001
yarn test                    # all phase smoke tests (isolated temp DBs)
yarn build                   # typecheck + production build into dist/
```

## 🌐 Environment Variables

See `.env.example` for the complete annotated list. Key variables:

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | always | ≥32 chars and non-placeholder in production |
| `GROQ_API_KEY` | production | server-side only |
| `PAYSTACK_SECRET_KEY` | production | server-side only; webhook signatures |
| `APP_URL` | production | http(s) URL, used for touchpoint links + callback |
| `CORS_ORIGIN` | production | browser origin(s); localhost rejected in prod |
| `PORT` | no | default 3001 |
| `DATA_DIR` | no | SQLite location, default `./data` |
| `TRUST_PROXY` | no | set only behind a reverse proxy |
| `VITE_PAYSTACK_PUBLIC_KEY` | client | the only key that ships to the browser |

## 🚚 Production Deployment

The application deploys as one process. The recommended flow:

```bash
# 1. Validate the environment (fails fast on missing/misconfigured vars)
node scripts/check-env.js

# 2. Install, then build the frontend and verify no secrets leak into dist/
yarn install
yarn build:prod

# 3. Start
NODE_ENV=production yarn start
```

Suggested architecture behind a TLS-terminating reverse proxy:

```
Internet → nginx/Caddy (TLS) → localhost:3001 (this app)
```

Set `TRUST_PROXY=1` so rate limiting and redirects see the real client IP.
Point your load balancer's health check at `/v1/health` — it performs a live
SQLite round-trip and returns `503` when the database is unreachable. The
health endpoint is exempt from the general API rate limit so health checks can
never be throttled.

### Render deployment (recommended)

A `render.yaml` blueprint is included in the repository. It deploys the exact
same Express monolith — no new architecture, no Docker, no external database.

**One-time setup on Render:**

1. **Create a Web Service** from this repository (or use the Blueprint via
   "New → Blueprint" pointing at `render.yaml`). The blueprint configures:
   - **Build command:** `npm run build:prod` (typecheck → Vite build → secret-leak scan)
   - **Start command:** `npm run start:prod` (`NODE_ENV=production node server.js`)
   - **Health check path:** `/v1/health`
   - **Persistent Disk:** mounted at `/data` (SQLite lives at `/data/touchpoint.db`)
2. **Add a Persistent Disk** (mount path `/data`, ≥ 1 GB) so the database
   survives restarts and redeploys. The database initializes itself on first
   boot against the empty disk — no manual migration step.
3. **Set environment variables** (never in `render.yaml`, never in git):

| Variable | Required | Value |
|---|---|---|
| `GROQ_API_KEY` | yes | from https://console.groq.com/ |
| `PAYSTACK_SECRET_KEY` | yes | Paystack dashboard; also verifies webhooks |
| `APP_URL` | yes | `https://<your-app>.onrender.com` (no trailing slash) |
| `CORS_ORIGIN` | yes | same origin as `APP_URL` (comma-separate extras) |
| `VITE_PAYSTACK_PUBLIC_KEY` | yes | must exist at **build** time |
| `JWT_SECRET` | auto | Render generates it via `generateValue` |

   `PORT` is injected by Render — do not set it. `NODE_ENV=production`,
   `DATA_DIR=/data` and `TRUST_PROXY=1` are set by the blueprint.

4. **Paystack webhook:** set the endpoint in the Paystack dashboard to
   `https://<your-app>.onrender.com/v1/billing/webhook`. It is HMAC-verified
   with `PAYSTACK_SECRET_KEY` and does not require a user session.
5. **Backups:** the same disk is used by `node scripts/backup.js`, which writes
   consistent copies to `<DATA_DIR>/backups` (14-backup retention). Run it on a
   schedule (e.g. Render Cron Job: `node scripts/backup.js`).

### Graceful shutdown

`SIGTERM`/`SIGINT` stop accepting connections, checkpoint the SQLite WAL, and
close the database cleanly before exiting. Safe to restart on every deploy.

### SQLite production data handling

- WAL + `synchronous=NORMAL`, `busy_timeout`, and a memory page cache are set at startup
- Startup integrity check in production (disable with `DB_SKIP_INTEGRITY_CHECK=1`)
- `./data` is locked to `0700`, the database file to `0600`
- Online backups while the server runs, with 14-backup retention:

```bash
yarn backup                       # writes ./data/backups/touchpoint-<timestamp>.db
BACKUP_DIR=/secure/path yarn backup   # or anywhere you like
```

## 🛡️ Security Hardening

- Server-authoritative Paystack billing: the client never sets an amount, currency,
  plan, or reference, and entitlement is granted only by the signed webhook or a
  server-side verification against recorded values
- Webhook signature verification (HMAC-SHA512 over the raw body, constant-time)
- Server-side sessions — logout revokes immediately
- Per-IP rate limiting (API, AI, auth, public chat)
- Helmet headers, `Permissions-Policy`, `X-Powered-By` disabled
- Tenant isolation everywhere — the business id always comes from the session
- Secrets never enter the client bundle; `build:prod` fails if secret-shaped
  material appears in `dist/` (`node scripts/verify-dist.js` to re-check)

## 🧪 Testing

All suites are smoke tests over the real Express app with isolated temp
databases and faked Groq/Paystack clients — no live API keys or network needed.

```bash
yarn test            # phase2..phase8 + deployment smoke tests
NODE_ENV=test node --test tests/phase7-billing.test.js   # single suite
```

Coverage includes auth/session/timing, tenant isolation, agent & touchpoint
CRUD, public chat + scan recording, lead qualification + limits, analytics
accuracy, Paystack billing + webhook idempotency, and Phase 8 production
hardening (env validation, DB pragmas, security headers, secret-leak scan). The
deployment smoke suite (`tests/phase8-deploy.test.js`) exercises the exact
behaviors a Render deployment depends on: health endpoint, SPA serving, public
`/t/:trackingId`, unauthenticated 401s, webhook reachability, CORS, request
size/parse errors, fresh-disk database initialization and the dist secret scan.

## 📄 License

MIT — see the LICENSE file.
