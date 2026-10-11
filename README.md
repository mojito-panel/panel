# Mojito Panel

Game server hosting panel, native Windows, no Docker.
Pelican/Pterodactyl-style architecture: **Panel** (TanStack Start) + **external Agent** (deployed per machine) + **JSON recipes** (eggs).

## Stack

| Component | Technology |
|---|---|
| Panel front | TanStack Start + shadcn/ui + TanStack Table |
| Auth | better-auth (email/password, admin/user roles) |
| DB | Postgres 17 (docker compose) — MikroORM v7 manages all tables (including better-auth) |
| Panel ↔ agent contract | Shared Zod schemas (`src/contract`) |
| Agent | External daemon (Fastify + Bearer token), one per machine — not part of this repo |
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

# 2. Dev setup: starts Postgres (Docker) + copies the .env file
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

# Run all tests
npm test

# Typecheck
npm run typecheck

# View Docker logs
mise run docker:logs

# Stop the Docker services
mise run docker:down
```

## Project structure

```
src/
├── contract/      # Shared Zod schemas (recipe JSON + panel ↔ agent API)
├── routes/        # TanStack Router file-based routes
├── components/    # React components (shadcn/ui generated in components/ui)
├── server/        # TanStack Start server functions, agent client, JWT signing
├── db/            # MikroORM entities + config + migrations
├── lib/           # Auth, permissions, utils
├── validators/    # Zod schemas for forms
└── ...
tests/             # Vitest tests (panel + contract)
recipes/           # Recipe JSONs (eggs)
scripts/           # Dev utility scripts
docs/              # Architecture documentation
```

## Documentation

- [Panel ↔ Agent ↔ Web client communications](docs/communications.md) — detailed flows with Mermaid diagrams: authentication, live installation tracking, WS console (JWT), power actions, reinstallation, variable editing, status lifecycle.

## Configuration

The `.env.default` file is copied to `.env` by `mise run setup:dev` (or `node scripts/copy-env.mjs`).

### Panel (`.env`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://mojito:mojito@localhost:5432/mojito` | Postgres connection (shared by better-auth + MikroORM) |
| `PANEL_URL` | `http://localhost:5173` | Public panel URL |
| `BETTER_AUTH_SECRET` | — | better-auth secret (32+ characters) — **also** the at-rest encryption key for agent tokens |

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
- The JWT travels as the **first WS message** (`auth`), never in the URL; the agent checks the Origin header.
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
npm run db:migrate

# Apply migrations manually (boot already does it)
npm run db:migrate:up
```

## License

MIT
