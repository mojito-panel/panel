# Game server hosting panel — Complete plan

> A Pelican/Pterodactyl-style panel, native Windows, no Docker.
> Architecture: **Panel** (TanStack Start) + **Agent** (pure Node, SEA-packaged) + **JSON recipes** (egg-type).

---

## Overall architecture

```
Panel (TanStack Start)  <--HTTPS + Bearer token / WS-->  Agent (Node + Fastify, 1 per machine)
       |                                                        |
   better-auth                                           JSON step runner
   MikroORM v7 (Postgres)                                Process pipes + ring buffer
   TanStack Query                                        (V2: Job Objects, Windows users)
```

**Key principles:**
- The **panel** NEVER touches game servers directly. It talks to the agent via API.
- The **agent** is a generic system daemon: it knows nothing about games, everything lives in the JSONs.
- The panel ↔ agent **contract** is defined by shared Zod schemas (`@mojito/contract`).

---

## Tech stack (locked decisions)

| Component | Tech | Notes |
|---|---|---|
| Panel front | TanStack Start + shadcn/ui | TanStack Router + TanStack Query |
| Panel auth | better-auth 1.7 | `pg` (Postgres), `tanstackStartCookies` plugin |
| DB | MikroORM v7 (`defineEntity`) | Postgres 17 (docker dev) — MikroORM manages ALL tables (including better-auth) |
| Query cache | TanStack Query | `staleTime: 60s`, passed in the RouterContext |
| Agent | Pure Node (Fastify + WS) | NO NestJS — it's a system daemon |
| Agent packaging | Node SEA | Single `.exe` + native addons as external files (V2) |
| PTY / consoles | node-pty | Phase 1 |
| RAM/CPU throttling | Windows Job Objects | **V2** — not in V1 |
| FS isolation | Local Windows users + NTFS ACLs | **V2** — not in V1 |
| Panel ↔ agent auth | Static token (32 random bytes) over HTTPS | mTLS/rotation later |
| User → agent auth | Short-lived HS256 JWT (TTL ~5 min), signed with the node token (unique secret per node, like Pelican) | Payload = serverId + scope + permissions; transport = 1st WS message |
| Live logs | Browser → agent WebSocket (direct, Pelican-style) | Replaces phase 3 polling — see Phase 5 |

---

## Repo structure (npm workspaces monorepo)

```
mojito-panel/
├── package.json              # npm workspaces (packages/*)
├── mise.toml                 # Node 24 + npm 11, tasks setup:dev, migrate, dev, test
├── .nvmrc                    # 24
├── docker-compose.dev.yml    # Postgres 17 (dev)
├── scripts/copy-env.mjs      # Copies .env.default → .env
└── packages/
    ├── contract/             # @mojito/contract — Shared Zod schemas
    │   └── src/
    │       ├── recipe-schema.ts  # Recipe JSON schema (eggs) + {{var}} templating
    │       └── api.ts            # Routes, panel ↔ agent WS payloads
    ├── panel/                # @mojito/panel — TanStack Start
    │   └── src/
    │       ├── routes/           # TanStack Router (file-based, folders)
    │       │   ├── __root.tsx    # createRootRouteWithContext + beforeLoad (SSR session)
    │       │   ├── index.tsx     # / (home)
    │       │   ├── _auth/        # pathless layout
    │       │   │   ├── login.tsx     # /login
    │       │   │   └── register.tsx  # /register
    │       │   ├── servers/
    │       │   │   └── index.tsx     # /servers
    │       │   └── api/
    │       │       └── auth/
    │       │           └── $.ts       # /api/auth/* (catch-all)
    │       ├── components/ui/    # shadcn/ui (button, input, label, card)
    │       ├── contexts/
    │       │   └── use-auth.tsx  # AuthProvider + useAuth (user, session, useSignOut)
    │       ├── lib/
    │       │   ├── auth.ts       # better-auth server (pg, tanstackStartCookies)
    │       │   ├── auth-client.ts # better-auth React client
    │       │   ├── auth.types.ts # Shared User/Session types
    │       │   └── utils.ts      # cn() shadcn
    │       ├── db/               # MikroORM v7 (defineEntity)
    │       │   ├── entities/     # User, Session, Account, Verification (better-auth)
    │       │   │                 # + Node, Recipe, Server, Allocation (business)
    │       │   └── index.ts      # initOrm / getOrm singleton
    │       ├── server/functions/ # TanStack Start server functions
    │       │   ├── auth.ts       # getSession (SSR), signOutFn
    │       │   └── health.ts     # DB healthcheck
    │       └── router.tsx        # getRouter + RouterContext (queryClient, staleTime 60s)
    └── agent/                # @mojito/agent — Fastify daemon (architecture aligned with wings)
        └── src/
            ├── index.ts              # Entrypoint (≈ wings.go / cmd/)
            ├── config/               # Zod config (env vars)
            ├── environment/          # Process environment (≈ environment/: spawn, stdin, graceful stop, states, events)
            ├── server/               # Server domain (≈ server/)
            │   ├── server.ts          # ServerInstance: power lock, crash timestamp, console listeners
            │   ├── manager.ts          # ServerManager: instance collection + event wiring
            │   ├── power.ts           # start/stop/restart/kill actions (≈ power.go)
            │   ├── crash.ts           # Crash detection + anti-crash-loop (≈ crash.go)
            │   ├── variables.ts        # System variables (SERVER_UUID…)
            │   ├── templating.ts        # {{VAR}} resolution
            │   └── installer/          # Install steps (≈ installer/): download/write/configFile actions…
            ├── parser/               # properties/ini/yaml/json parsers (≈ parser/)
            ├── router/               # HTTP + WS (≈ router/)
            │   ├── middleware.ts       # Bearer token hook (SHA-256, timing-safe)
            │   ├── router-system.ts   # /health
            │   ├── router-server.ts   # /servers/* (install, action, logs, delete, command)
            │   ├── tokens/            # Console JWT verification (≈ tokens/parser.go + websocket.go)
            │   └── websocket/         # Browser console socket (≈ websocket/websocket.go)
            └── internal/             # Local persistence (server-store.json)
```

---

## JSON recipe schema (V2 — feature parity with Pelican eggs)

```json
{
  "schemaVersion": 2,
  "id": "minecraft-paper",
  "name": "Paper",
  "author": "papermc",
  "description": "High performance Spigot fork.",
  "tags": ["minecraft", "java"],
  "features": ["eula", "java_version"],
  "runtime": { "java": ">=21" },
  "requirements": { "minRamMb": 512, "requiredCommands": ["java"] },
  "variables": [
    {
      "env": "MINECRAFT_VERSION",
      "name": "Minecraft Version",
      "type": "string",
      "defaultValue": "latest",
      "userViewable": true,
      "userEditable": true,
      "sort": 0,
      "required": true
    },
    {
      "env": "SERVER_JARFILE",
      "name": "Server Jar File",
      "type": "string",
      "defaultValue": "server.jar",
      "userViewable": true,
      "userEditable": true,
      "sort": 1,
      "pattern": "^([\\w\\d._-]+)(\\.jar)$"
    }
  ],
  "install": [
    {
      "action": "download",
      "url": "https://api.papermc.io/v2/.../server.jar",
      "dest": "{{SERVER_JARFILE}}",
      "checksum": "sha256..."
    },
    { "action": "write", "file": "eula.txt", "content": "eula=true" },
    {
      "action": "configFile",
      "file": "server.properties",
      "parser": "properties",
      "find": { "server-port": "{{SERVER_PORT}}", "server-ip": "{{SERVER_IP}}" }
    }
  ],
  "start": {
    "command": "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}",
    "stop": { "type": "command", "value": "stop", "timeoutMs": 30000 },
    "ready": { "pattern": "Done \\([0-9.]+s\\)! For help", "strip": "\\[.*?\\] " }
  },
  "logs": { "mode": "stdout", "stripAnsi": true },
  "env": { "JAVA_OPTS": "-XX:+UseG1GC" }
}
```

**Runner actions:** `download`, `extract`, `write`, `replace`, `configFile` (properties/ini/yaml/json parsers), `command`, `script` (bash/powershell/cmd shell fallback — for everything else)

**System variables** provided by the agent: `SERVER_UUID`, `SERVER_NAME`, `SERVER_MEMORY`, `SERVER_PORT`, `SERVER_IP`, `SERVER_INSTALL_DIR`

**`{{ENV_VAR}}` templating** (UPPERCASE) applied everywhere. Resolution: system variables > server variables > recipe defaults > fixed env. Unknown variable = error at install.

> Format at feature parity with Pelican eggs (PTDL_v2): env variables + user_viewable/user_editable + validation, config files with parsers, ready detection with strip, logs config, features flags, update_url. Key difference: declarative and Windows-first (no Docker, no mandatory bash script — the `script` action acts as an escape hatch).
---

## MikroORM entities (v7, defineEntity)

- **User** (better-auth): id, email, name, role (`admin` | `user`)
- **Session / Account / Verification** (better-auth, migrations managed by `@better-auth/cli`)
- **Node**: id, name, fqdn, agentTokenHash, lastSeenAt, status
- **Recipe**: id, slug, name, schemaVersion, json (raw)
- **Server**: id, name, nodeId, recipeId, ownerId, status, memoryMb, variables (JSON)
- **Allocation**: nodeId, ip, port, alias, serverId (nullable = free in the node pool), isPrimary

> **Note**: better-auth and MikroORM share the same Postgres database; MikroORM manages all tables (better-auth snake_case mapping in `src/lib/auth.ts`), migrations applied at boot (`src/server.ts`).

---

## Auth & security

### Panel (better-auth)

- Email/password in V1
- `pg` (Postgres) — no better-sqlite3 (doesn't compile on Windows)
- `tanstackStartCookies` plugin to forward cookies in TanStack Start
- **TanStack Query in the RouterContext**: `staleTime: 60s`, session fetched in SSR via `beforeLoad`
- **AuthProvider**: `useAuth()` exposes `user`, `session`, `useSignOut()`
- Roles: `admin` (manages nodes, recipes, users) / `user` (manages their own servers)

### Panel ↔ Agent

- Token generated panel-side: `crypto.randomBytes(32).toString('hex')`
- The panel stores the **hash** (SHA-256), the agent stores the plaintext
- All requests over HTTPS (`Authorization: Bearer <token>`), constant-time comparison (`timingSafeEqual`)
- NEVER log the token

### User ↔ Agent (JWT, Pelican-style)

- The browser talks **directly** to the agent (console WS) — the panel no longer relays logs.
- The panel issues a **short-lived HS256 JWT** (TTL ~5 min), signed with the **node's agent token** —
  the same one as the panel ↔ agent Bearer (unique secret per node, like Pelican's daemon_token).
  No separate JWT secret. The agent token is encrypted at rest in the panel DB (AES-256-GCM,
  key derived from `BETTER_AUTH_SECRET`) because it also becomes a signing key. Never logged.
- Payload validated by the agent on EVERY request/message: `aud: 'mojito-agent'`, `serverId`,
  `sub` (userId), `permissions[]`, `exp`, `jti`.
- The agent checks: signature, `aud`, `exp`, token's `serverId` === route parameter,
  then the **permissions** required by the action (`console.write` for a command, etc.).
- V1 permissions: closed list in the contract — `console.read`, `console.write`,
  `power.start`, `power.stop`, `power.restart`, `power.kill`, `variables.read`, `variables.write`.
- No invitations/sub-owners in V1: every owner (and the admin) receives **all** permissions
  by default. The closed list already exists agent-side to be ready.
- Revocation: short TTL + WS disconnect. `jti` blacklist = V2.

---

## Roadmap by phases

### Phase 0 — Skeleton ✅ DONE

- [x] npm workspaces monorepo, `contract`, `panel`, `agent` packages
- [x] Panel: TanStack Start + shadcn + MikroORM v7 + better-auth wired and tested together
- [x] TanStack Query in the RouterContext (staleTime 60s) + AuthProvider/useAuth
- [x] SSR session via `beforeLoad` + `queryClient.fetchQuery(['auth'])`
- [x] Login/register pages with working forms
- [x] Zod schema of the recipe JSON (`recipe-schema.ts`) + API contract (`api.ts`)
- [x] Agent: Fastify that boots + token auth (timing-safe) + healthcheck
- [x] Vitest tests: 54 tests (contract 36, panel 7, agent 11)
- [x] `mise.toml` (Node 24, setup:dev/migrate/dev/test tasks)
- [x] `docker-compose.dev.yml` (Postgres, optional)
- [x] `.env.default` + `scripts/copy-env.mjs`
- [x] README.md

### Phase 1 — Agent core (2–4 weeks)

- [x] Step runner: `download`, `write`, `extract`, `command`, `replace`, `configFile`, `script` + `{{ENV_VAR}}` templating
- [x] `POST /servers/install` route (agent API) wired to the runner
- [x] Process manager + registry (spec aligned with wings)
- [x] Console: command sending, log buffer (ring buffer)
- [x] Graceful stop (command/signal + timeout → poll → kill)
- [x] Minimal crash detection + anti-crash-loop
- [x] Cleanup: folder deletion when a server is deleted (`DELETE /servers/:serverId`)

#### Process manager spec (aligned with wings — server/power.go, environment/docker/power.go)

- **Power actions**: `start` / `stop` / `restart` / `kill` (same as `serverActionSchema`).
- **Power lock per server**: sequential action queue per serverId (no double start, no restart during a stop). `kill` bypasses the lock (a stuck process must always be killable). Refused if `installing`.
- **Runtime states** (in the agent, distinct from panel states): `offline` / `starting` / `running` / `stopping`.
  - `starting` → `running` right at spawn (like wings — `ready.pattern` emits a separate `ready` event, used for install progress).
  - Go through `stopping` BEFORE `offline` on a stop → don't trigger crash detection.
- **Stop sequence** (like wings):
  1. state → `stopping`
  2. `command` → written to the process stdin; `signal` → direct kill
  3. wait for exit during `stop.timeoutMs` (default 30s; wings waits up to 10 min)
  4. still alive → forced kill (process-tree kill on Windows: `taskkill /T /F`)
- **Minimal crash detection** (like wings crash.go): non-zero exit code AND state ≠ `stopping` → `crashed`. Anti-crash-loop: if last crash < N seconds (default 60s), no auto restart. Auto restart → goes through the power lock again.
- **Console output**: stdout/stderr piped → in-memory ring buffer (~1000-line limit) + callbacks for WS streaming (phase 3).
- **Local persistence**: JSON registry in `AGENT_DATA_DIR` (serverId → recipe, variables, installDir, allocation) filled at install — start only needs the serverId.
- **Divergence note vs wings**: wings re-applies `config.files` on every boot (`UpdateConfigurationFiles` in onBeforeStart). For us the `configFile` actions are install-only: **variable editing exists** (Variables page — changes the value + env at next start) but does NOT rewrite already-generated config files (e.g.: changing the port on the page does not update `server.properties`). Full parity = re-running the `configFile` actions at start or on variable save — still to be decided.

### Phase 2 — Throttling (V2 — not in V1)

- [ ] Job Object bindings (RAM + CPU rate)
- [ ] Assignment at spawn (before the children!)
- [ ] Metrics: per-server RAM/CPU usage reading
- [ ] Crash detection + configurable auto-restart

### Phase 3 — Panel & wiring ✅ (V1)

- [x] Node CRUD (token generation, shown only once at creation)
- [x] Recipe CRUD (JSON import validated by `parseRecipe` v2, refused if active servers exist)
- [x] Server CRUD (creation → agent install → DB; deletion → agent + DB)
- [x] Server installation: panel → agent (`installDir` relative to the agent's dataDir)
  — ⚠️ V1 synchronous without live progress (WS: later if needed)
- [x] Live console: **xterm.js** fed by polling the agent's incremental logs
  (`GET /servers/:id/logs?after=N`, every 2 s) + stdin command sending
  — (replaces the initially planned WS + react-virtual; the direct WS arrives in Phase 5,
  polling stays as a fallback)
- [x] Start/stop/restart/kill + command sending
- [x] Per-server variable management: forms auto-generated from the
  recipe definitions (number/boolean/options type → adapted field)
- [x] Post-install variable editing (`/servers/$serverId/variables` page,
  formerly "Startup"): 3-layer validation (form / server function / agent)
  reusing the contract rules (required, min/max, pattern, options), only
  `userEditable` variables modifiable, startup command resolved read-only.
  Panel DB = source of truth; agent sync via push (`POST /servers/:serverId/variables`,
  see docs/communications.md §6) — applied at next start (WS starts included).
  sonner toasts (richColors) for mutation feedback.
- [x] Boot migrations (`src/server.ts` → `orm.migrator.up()`) — MikroORM manages
  all tables (including better-auth); NEVER `schema.update()`
  (v7 drops unknown tables by default)

Implementation notes:
- The agent token is stored **encrypted at rest** in the node table (AES-256-GCM, key
  derived from `BETTER_AUTH_SECRET` — the token is also the signing key for console JWTs).
- Server status: DB sync ← agent runtime status on every consultation.
- Ownership: a user sees/manages their own servers; the admin sees everything and manages nodes/recipes.

### Phase 4 — SEA & distribution (1–2 weeks)

- [ ] Agent SEA build + external addons
- [ ] Windows installer (auto service)
- [ ] Installation docs for an end user

### Phase 5 — Direct user ↔ agent WS console + JWT + permissions ✅ DONE (V1)

> Big change: the browser streams logs directly from the agent (Pelican-style),
> authenticated with a short-lived JWT issued by the panel. Split into independent edits,
> each testable/mergeable on its own. Order = dependencies.

#### E1 — Contract: permissions, JWT payload, WS messages (`packages/contract/src/api.ts` + tests)

- [x] `permissionSchema`: closed enum `console.read`, `console.write`, `power.start`,
  `power.stop`, `power.restart`, `power.kill`, `variables.read`, `variables.write`
  (Pelican subset; files/backups = V2+)
- [x] `consoleTokenPayloadSchema`: `{ iss: 'mojito-panel', aud: 'mojito-agent', sub, serverId, permissions, iat, exp, jti }`
- [x] `consoleTokenResponseSchema` (panel → browser): `{ token, wsUrl }`
- [x] WS messages: browser → agent `{ type: 'command', command } | { type: 'power', action }`;
  agent → browser `{ type: 'auth-ok' } | { type: 'log', lines[] } | { type: 'status', status } | { type: 'error', code }`
- [x] Contract tests (enum rejected outside the list, required payload)

#### E2 — Agent: JWT secret in the config (`packages/agent/src/config.ts` + tests)

- [x] ~~`AGENT_JWT_SECRET` required~~ — **superseded**: the agent verifies with its own `AGENT_TOKEN`
- [x] NEVER log it (redacted logger, like for the token)

#### E3 — Agent: JWT verification (`packages/agent/src/api/jwt.ts` + tests)

- [x] HS256 via `node:crypto` (HMAC-SHA256 + base64url, WITHOUT a jwt/jsonwebtoken dependency)
- [x] Checks signature, `aud === 'mojito-agent'`, `exp` (5 s clock skew margin)
- [x] Returns the typed payload; distinct errors: `invalid`/`expired` (→ 401) vs
  insufficient permissions (→ 403, separate check, per action)

#### E4 — Agent: console WS endpoint (`packages/agent/src/api/index.ts`, `process/registry.ts`)

- [x] `@fastify/websocket` + `ws` dependency
- [x] `GET /servers/:serverId/ws` — UNauthenticated socket, JWT in the 1st WS message (`auth`, never in a query string).
- [x] Handshake: JWT check + token's `serverId` === route parameter → `auth-ok`,
  initial ring buffer batch, current status; refusal → close code 4001/4003 (no leak)
- [x] Streaming: subscribe to the registry log callback (already in place for polling)
- [x] Incoming messages: `command` gated on `console.write`, `power` gated on `power.<action>`
- [x] Clean unsubscribe on disconnect; multiple sockets per server OK (no broadcast needed, each one subscribes)
- [x] The token is validated at connection; permissions re-validated on EVERY incoming message (payload in memory, not re-signed)

#### E5 — Panel: JWT issuance (`packages/panel/src/server/functions/servers.ts` + `.env.default` + tests)

- [x] ~~`PANEL_JWT_SECRET`~~ — **superseded by the Pelican alignment**: the JWT is signed with the node's token (encrypted at rest via `BETTER_AUTH_SECRET`)
- [x] `createConsoleToken(serverId)` server function: `requireUser()` + ownership check
  (or admin), then HS256 sign (`node:crypto`, same base code as E3 shared via a
  small `signJwt` function — no dependency)
- [x] 5 min TTL, permissions = **all** in V1 (no invitations; default = full owner)
- [x] Returns `{ token, wsUrl }` (node fqdn/agentPort) — validated by the E1 contract
- [x] NEVER log the token

#### E6 — Panel: WS console front (`packages/panel/src/routes/_app/servers/$serverId.tsx`)

- [x] `createConsoleToken` call → native WS opened in useEffect (SSR-safe, xterm already dynamic)
- [x] Reconnection with backoff → re-issue a fresh token on every attempt (short TTL)
- [x] `command`/`power` sent over WS when connected; otherwise 401 → refresh token
- [x] Polling fallback kept: if the WS fails to open (proxy without WS, old agent),
  fall back to the existing `GET /logs?after=N` polling — graceful degradation, not an error
- [x] Remove polling once the WS is stable? Not in V1: keep both (documented fallback)

#### E7 — Security hardening

- [x] 5 min max TTL, `jti` present (ready for a V2 blacklist)
- [x] Basic rate limiting of `command` per socket (in-memory, e.g. 10/s) against console flooding
- [x] Immediate close without details if the JWT is invalid (no error distinction client-side)

#### E8 — End-to-end tests + docs

- [x] Agent: WS auth success/failure, expired token, `serverId` mismatch, refused permissions
  (missing `console.write` → command rejected), streaming received, unsubscribe
- [x] Panel: payload conforms to the contract + sign/verify symmetry with the agent (cross test) — ⚠️ the non-owner refusal goes through the shared loadOwnedServer, no dedicated test (would require session/DB infra)
- [x] `npm test` green (54 tests + the new ones)
- [x] README (JWT flow diagram) + update of this plan (check the boxes)

#### Pelican alignment (post-E8, applied)

After reading the actual pelican/panel + pelican/wings code, alignment with their model:
- Unique secret per node: the console JWT is signed/verified with the agent token (their `daemon_token`) — no more `PANEL_JWT_SECRET`/`AGENT_JWT_SECRET`.
- Token encrypted at rest on the panel side (AES-256-GCM from `BETTER_AUTH_SECRET`, their equivalent = cast `encrypted`).
- Handshake: the socket opens UNauthenticated, the JWT travels in the 1st WS message (`auth`) — never in a query string. Re-`auth` = refresh without reconnecting.
- Origin check before the upgrade (their `CheckOrigin`): `PANEL_URL` + `AGENT_ALLOWED_ORIGINS`.
- `scope: websocket` claim checked in addition to permissions (their node JWT scopes).
- Expiry re-checked on EVERY incoming message (their `TokenValid`).
- Assumed divergence: no JTI denylist / panel→agent deauthorize in V1 (5 min TTL + refresh in place suffice).

#### Target flow

```
Browser ──POST createConsoleToken──▶ Panel (requireUser + ownership)
Browser ◀──{ token, wsUrl }────────── Panel (HS256 JWT, TTL 5 min, permissions: all in V1)
Browser ──WS wsUrl (without token)────▶ Agent (origin check + auth message = 1st WS message)
Browser ◀──auth-ok + logs stream───── Agent (every incoming message re-validated against permissions)
```

#### Assumed divergences vs Pelican/wings

- Pelican has per-sub-user permissions + invitations → V2 for us (closed list ready in E1)
- wings revalidates the token with the panel internally → no: we trust the signed JWT
  (shared secret), no panel call per message
- No SENTRY/apteryx events (stats) in V1 — the WS only carries logs/commands/status

### V2+ (ideas, do NOT do in V1)

- mTLS or panel ↔ agent token rotation
- Disk quotas (fsutil, Windows Server)
- SFTP/file manager in the panel
- Scheduled backups
- AppContainer / network isolation
- Multi-node with a placement scheduler
- Per-user billing/quotas
- **Shared runtime cache**: global .bin (java, steamcmd…) — contract extension (new `runtime` action + system var `{{AGENT_BIN_DIR}}`); V1 = per-server .bin (minecraft recipe already done)
- **Local Windows users + NTFS ACLs** (per-server FS isolation)

---

## Pitfalls not to forget (checklist)

- [ ] Job Object assigned BEFORE child processes (escape) — V2
- [ ] Native addons never bundled in the SEA → files alongside — V2
- [ ] SEA = CommonJS (esbuild build if ESM code) — V2
- [ ] Local users: never Administrators, dedicated `PanelServers` group — V2
- [x] better-auth and MikroORM: same Postgres DB, all tables managed by MikroORM, migrations at boot
- [x] `schemaVersion` in every recipe JSON
- [x] Unknown variables = error at install, not at runtime
- [ ] Graceful stop timeout before forced kill
- [ ] Log console: virtualization mandatory (Minecraft spams)
- [ ] SteamCmd in a global cache, not per server
- [x] Console JWT: never in the URL or logs — transport = 1st WS message (`auth`); origin check on the upgrade
- [x] Console WS: JWT permissions re-validated on EVERY message, not just at opening

---

## V1 success criteria

1. Install a Vanilla Minecraft server from the panel, in 3 clicks, on a fresh Windows machine
2. The server is throttled to the configured RAM (verifiable: `java -Xmx` + Job Object) — V2
3. Impossible (via ACL) to access another server's folder — V2
4. Live console + graceful `stop` from the panel
5. Clean deletion: folder, process, everything goes away
