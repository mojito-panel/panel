# Mojito Panel

Game server hosting panel, native Windows, no Docker.
Pelican/Pterodactyl-style architecture: **Panel** (TanStack Start) + **shard** (external Go agent, one per machine) + **JSON recipes** (eggs).

## Stack

| Component | Technology |
|---|---|
| Panel front | TanStack Start + shadcn/ui + TanStack Table |
| Auth | better-auth (email/password, admin/user roles) |
| DB | Postgres 17 (docker compose) — MikroORM v7 manages all tables (including better-auth) |
| Panel ↔ agent contract | Shared Zod schemas (`src/contract`) |
| Agent | **shard** — external Go daemon (Bearer token, one per machine): servers run as native Windows processes under Job Objects + dedicated local users — separate repository |
| Tests | Vitest |

## Prerequisites

- **Node.js 24** (pinned via `.nvmrc` and `mise.toml`)
- **npm 12** (pinned to 12.2.0 via `mise.toml`)
- **Git** (the recipe marketplace clones its registries with `git clone`)
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
recipes/           # → separate repository (mojito-panel/recipes), imported via /admin/recipes
scripts/           # Dev utility scripts
docs/              # Architecture documentation
```

## Documentation

- [Panel ↔ Agent ↔ Web client communications](docs/communications.md) — detailed flows with Mermaid diagrams: authentication, live installation tracking, WS console (JWT), power actions, reinstallation, variable editing, status lifecycle.
- **Recipe marketplace** (`/admin/marketplace`) — any git repository can be added
  as a registry: public **https** (GitHub, GitLab, Gitea, self-hosted…) or
  **ssh** (`ssh://…` or `git@host:path`). Every clone goes through the system
  `git clone --depth 1` binary — it inherits the panel host's git/ssh
  configuration (keys, `~/.ssh/config`, agent, credential helpers), so private
  repositories work with zero auth code in the panel; **Git must be installed
  on the panel host** (Git for Windows). Syncs are durable pg-boss jobs: a
  scheduled sweep (interval in `/admin/settings`, default 6 h, 0 = manual)
  clones each registry depth 1, caches the catalog (`recipe-*.json` and
  nested `<id>.json` files, their validation state and optional vertical
  cover images as base64) and
  stamps the upstream hashes; the "Mettre à jour" actions compare canonical
  content hashes (formatting-independent). Recipes keep a source URL
  (`<repo>#<branch>:<path>` for registry files, a direct URL otherwise) so
  update checks work whatever the origin — the Pelican-style `update_url`
  seeds the source of legacy recipes.

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
Browser ◀──{ token, wsUrl }───────── Panel (HS256 JWT, 5 min TTL, permissions = the user's granted agent permissions via `toConsolePermissions`)
Browser ──WS wsUrl (no token)────▶ Agent (origin check, then auth message = first WS message)
Browser ◀──auth-ok + log stream─── Agent (permissions re-validated on EVERY message)
```

- **Unique secret per node** (like Pelican): the console JWT is signed by the panel with the node's agent token; the agent verifies with its own token — no extra shared secret to keep in sync.
- The agent token is encrypted at rest in the panel DB (AES-256-GCM, key derived from `BETTER_AUTH_SECRET`) — it is both a credential and a signing key.
- The JWT travels as the **first WS message** (`auth`), never in the URL; the agent checks the Origin header.
- The token is refreshed **in place** (re-`auth`) before expiry — no reconnection.
- Fallback: if the WS fails to open, the console falls back to log polling (`GET /logs?after=N`).
- The agent token is NEVER logged.

### SFTP

Wings parity: the AGENT hosts the SFTP server (default port 2022, opt-in via
`sftp.enabled` in the generated shard.yml), the PANEL validates the
credentials. shard's password callback calls `POST /api/sftp/auth` with the
node Bearer token; the username is `{username}.{serverId}` and the password is
the user's panel account password. The panel answers with the user's
`server.files.*` grants mapped to the agent's `file.*` permission list
(`*` for owners/admins) — the agent gates every SFTP operation on them and
sandboxes the session to the server's installDir. Users see the connection
details on the server Files page. Full flow: [docs/communications.md](docs/communications.md) §8.

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
