# Mojito Panel

Game server hosting panel, native Windows, no Docker.
Pelican/Pterodactyl-style architecture: **Panel** (TanStack Start) + **Agent** (pure Node) + **JSON recipes** (eggs).

## Stack

| Component | Technology |
|---|---|
| Panel front | TanStack Start + shadcn/ui + TanStack Table |
| Auth | better-auth (email/password, admin/user roles) |
| DB | Postgres 17 (docker compose) — MikroORM v7 manages all tables (including better-auth) |
| Panel ↔ agent contract | Shared Zod schemas (`@mojito/contract`) |
| Agent | Pure Node (Fastify + Bearer token) |
| Tests | Vitest |

## Prerequisites

- **Node.js 24** (pinned via `.nvmrc` and `mise.toml`)
- **npm 11** (bundled with Node 24)
- **Docker** (for Postgres in dev, optional)
- **mise** (recommended to manage versions)

```bash
# With mise (recommended)
mise install
```

## Installation

```bash
# 1. Install dependencies
npm install

# 2. Dev setup: starts Postgres (Docker) + copies the .env files
mise run setup:dev
# or manually:
#   docker compose -f docker-compose.dev.yml up -d
#   node scripts/copy-env.mjs

# 3. Nothing to do — MikroORM migrations apply at server boot (src/server.ts)
```

## Development

```bash
# Start the panel (TanStack Start) — http://localhost:5173
npm run dev
# or: mise run dev

# Start the agent
npm run dev:agent
# or: mise run dev:agent

# Run all tests
npm test

# Typecheck
npm run typecheck

# View Docker logs
mise run docker:logs

# Stop the Docker services
mise run docker:down
```

## Monorepo structure

```
packages/
├── contract/     # Shared Zod schemas (recipe JSON + panel ↔ agent API)
├── panel/        # Web panel (TanStack Start + MikroORM + better-auth)
└── agent/        # Agent daemon (Fastify, 1 per Windows machine)
```

## Documentation

- [Panel ↔ Agent ↔ Web client communications](docs/communications.md) — detailed flows with Mermaid diagrams: authentication, live installation tracking, WS console (JWT), power actions, reinstallation, variable editing, status lifecycle.

## Configuration

The `.env.default` files are copied to `.env` by `mise run setup:dev` (or `node scripts/copy-env.mjs`).

### Panel (`packages/panel/.env`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://mojito:mojito@localhost:5432/mojito` | Postgres connection (shared by better-auth + MikroORM) |
| `PANEL_URL` | `http://localhost:3000` | Public panel URL |
| `BETTER_AUTH_SECRET` | — | better-auth secret (32+ characters) — **also** the at-rest encryption key for agent tokens |

### Agent (`packages/agent/.env`)

| Variable | Default | Description |
|---|---|---|
| `AGENT_TOKEN` | — | **Required** — Bearer token (32+ characters). **Also** the HS256 key for console JWTs (unique secret per node, like Pelican) |
| `AGENT_PORT` | `8080` | Listen port |
| `AGENT_HOST` | `0.0.0.0` | Listen interface |
| `AGENT_DATA_DIR` | `C:\PanelData` | Server data directory |
| `PANEL_URL` | — | Panel URL — **allowed origin** for the WS console |
| `AGENT_ALLOWED_ORIGINS` | — | Additional allowed origins (comma-separated) |

### Live console & JWT (browser ↔ direct agent)

The console streams logs **directly from the agent** (Pelican-style) — the panel
no longer relays logs. The browser obtains a short-lived JWT from the panel,
the agent validates that JWT and gates each action on the payload's permissions:

```
Browser ──POST createConsoleToken──▶ Panel (requireUser + ownership)
Browser ◀──{ token, wsUrl }───────── Panel (HS256 JWT, 5 min TTL, V1 permissions = all)
Browser ──WS wsUrl (no token)────▶ Agent (origin check, then auth message = first WS message)
Browser ◀──auth-ok + log stream─── Agent (permissions re-validated on EVERY message)
```

- **Unique secret per node** (like Pelican): the console JWT is signed by the panel with the node's agent token; the agent verifies with its own token — no extra shared secret to keep in sync.
- The agent token is encrypted at rest in the panel DB (AES-256-GCM, key derived from `BETTER_AUTH_SECRET`) — it is both a credential and a signing key.
- The JWT travels as the **first WS message** (`auth`), never in the URL; the agent checks the Origin header (panel URL or `AGENT_ALLOWED_ORIGINS`).
- The token is refreshed **in place** (re-`auth`) before expiry — no reconnection.
- Fallback: if the WS fails to open, the console falls back to log polling (`GET /logs?after=N`).
- The agent token is NEVER logged.

### Database (Docker)

`docker-compose.dev.yml` starts a Postgres 17 for dev:

| Service | Port | Credentials |
|---|---|---|
| Postgres | `5432` | `mojito` / `mojito` / db `mojito` |

## Migrations

MikroORM manages **all** tables (better-auth + business). Migrations apply
automatically at server startup (`src/server.ts` → `orm.migrator.up()`):

```bash
# Generate a migration after an entity schema change
npm run db:migrate -w @mojito/panel

# Apply migrations manually (boot already does it)
npm run db:migrate:up -w @mojito/panel
```

## Roadmap

- **Phase 0** — Skeleton ✅: monorepo, panel, agent, contract, tests
- **Phase 1** — Agent core ✅: step runner, process manager, graceful stop, crash detection, boot restore
- **Phase 2** — Throttling: Job Objects (RAM/CPU) — *V2*
- **Phase 3** — Panel & wiring ✅: servers/nodes/recipes CRUD, live installation tracking, live console, Variables page (editing + validation + agent sync)
- **Phase 4** — SEA & distribution: agent packaging as an `.exe`
- **Phase 5** — Direct WS console browser ↔ agent + JWT + permissions ✅

> Job Objects and Windows user isolation are deliberately deferred to V2.

## License

MIT
