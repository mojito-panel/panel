# Panel ↔ Agent ↔ Web client communications

> Reference for the communication flows between the three actors of the system.
> The shared Zod schemas (`src/contract`) are authoritative: this document describes
> the *workflows*, not the exact types (see `src/contract/api.ts`).

## Actors

| Actor | Role |
|---|---|
| **Web client** (browser) | React 19 + TanStack Router/Query. NEVER talks to game servers directly: it calls TanStack Start *server functions* (SSR-aware), or the agent directly for the console (short-lived JWT). |
| **Panel** (this repo) | TanStack Start (Node SSR). Sole owner of the DB (Postgres/MikroORM) and of sessions (better-auth). Talks to the agent over HTTP `Bearer <node token>` (token encrypted AES-256-GCM at rest). |
| **Agent** (external, one per machine) | Fastify, 1 per machine. Generic daemon: runs the recipe installation runner, manages game processes, exposes the WS console. Knows nothing about players or the DB. |

```mermaid
graph LR
    subgraph Browser
        UI[React client<br/>TanStack Query]
    end
    subgraph Panel
        SFN[Server functions<br/>TanStack Start]
        AUTH[better-auth<br/>sessions]
        ORM[MikroORM / Postgres]
        AGENTC[Agent client<br/>Bearer + fetch]
        JWT[Console JWT signing<br/>HS256 = node token]
    end
    subgraph "Game machine (node)"
        AG[Fastify agent]
        RUN[Installation runner]
        PROC[Game server process]
        REG[(Installation registry)]
        STORE[(servers.json)]
    end

    UI -- "HTTP (server functions)" --> SFN
    SFN <--> AUTH
    SFN <--> ORM
    SFN <--> AGENTC
    AGENTC -- "HTTP Bearer" --> AG
    UI -- "direct WS (console JWT)" --> AG
    AG <--> RUN
    AG <--> PROC
    RUN --> REG
    AG <--> STORE
```

**Golden rules**
- The panel never touches game servers: everything goes through the agent.
- The client talks to the agent ONLY via the WS console, with a short-lived JWT signed by the panel using the node token (panel ↔ agent shared secret, 1 per node — Pelican style).
- The agent token is never logged, nor sent to the browser.

---

## 1. Authentication (SSR session)

```mermaid
sequenceDiagram
    participant N as Browser
    participant P as Panel (__root beforeLoad)
    participant D as Postgres

    N->>P: GET /servers (session cookie)
    P->>D: queryClient.fetchQuery(['auth'])
    P-->>N: SSR session (user in the router context)
    Note over N,P: TanStack Query caches the session for 60 s (staleTime)
    N->>N: layout beforeLoad: no user → redirect /login
```

- Login/register/signOut → `queryClient.invalidateQueries({ queryKey: ['auth'] })`.
- Access guards: `_app` (logged in), `admin/route.tsx` (admin role), `servers/$serverId/route.tsx` (logged in) — server ownership is verified on the **server function** side (`loadOwnedServer`), not in the router.

---

## 2. Server creation + installation (async, live tracking)

Installation can take minutes (JDK, Mojang JAR…). It starts in the **background** on the agent side, and the browser tracks progress step by step.

```mermaid
sequenceDiagram
    participant N as Browser (/servers/new)
    participant P as Panel (installServerFn)
    participant D as Postgres
    participant A as Agent (POST /servers/install)
    participant R as Runner + Registry

    N->>P: POST installServerFn {name, nodeId, recipeId, allocationId, memoryMb, variables}
    P->>D: INSERT server (status: installing) + allocation
    P->>A: POST /servers/install {serverId, recipe, variables, installDir, allocation}
    A->>A: Synchronous validation (Zod: request, recipe, variables)
    alt invalid request/recipe
        A-->>P: 400 / 422 (detail)
        P->>D: DELETE server + allocation (rollback)
        P-->>N: HttpError
    else accepted
        A-->>P: 202 { status: "installing" }
        P-->>N: { id } → redirect /servers/$serverId/console
        A->>R: startTrackedInstall (background)
        R->>R: step 1..N: downloads, scripts, writes…
        R->>R: Registry: each step + command output STREAMED line by line
        Note over N,A: Installation streams on the WS console<br/>(same socket/JWT as runtime logs)
        loop direct WS (console)
            A-->>N: { type: "install-status", step, percent, error } (banner)
            A-->>N: { type: "install-log", lines[] } (steps=yellow, output=gray, errors=red)
        end
        R->>A: store.save(servers.json) on success
        R-->>A: Registry: status "installed" (+ "failed", error at step X otherwise)
        N->>N: terminal install-status → getInstallStatusFn ONCE (DB sync)<br/>→ invalidate ['server'] → normal console
        Note over N: on failure: red banner + « Réessayer » button<br/>(retryInstallFn relaunches the same serverId)
    end
```

**Key points**
- The panel persists **before** calling the agent: the user is immediately redirected to the server console.
- Fast validation (unknown/invalid variables) is rejected **before** the 202 → the form displays the error and the DB rows are removed.
- A runner failure (404 download, failing script…) is NOT an HTTP error: it shows up in the installation status (`failed` + `error`), the store is not modified, the DB switches to `install_failed`.
- **No polling** on the happy path: steps and command output are pushed by the agent on the console socket (`install-status` + `install-log`). `getInstallStatusFn` is called only **once** at the end (terminal status) to synchronize the DB (`installing → stopped / install_failed`).
- **Fallback**: if WS is not usable (proxy without WS, refused origin…), the page falls back to polling `GET /servers/:serverId/install` (dedicated installation panel).
- Installation logs (registry, in memory on the agent side): levels `step` (yellow), `info` (gray), `error` (red); command output is streamed **as it comes** — `\r` rewrites (progress bars like steamcmd's) replace the previous line instead of stacking up, consecutive identical lines are merged; 2000-line cap (latest kept).
- **Tools silent on a pipe**: some console programs (steamcmd) print their progress only on a real terminal — on a pipe they stay silent. A `command` action can declare `tail` (`file` + regex `filter` + `intervalMs`): the agent tails the log file written during execution (e.g. steamcmd's `logs/content_log.txt`) and streams the new lines live.
- A `command` action can declare `successCodes` (exit codes treated as success) — steamcmd exits with code 7 after its self-update (`Update complete, launching...`) even though the job succeeded.
- Installation logs live in the agent's memory (registry): lost if the agent restarts, the DB status stays `install_failed` with the *Réessayer* button. On WS (re)connection, an **in-progress or failed** installation is replayed (`install-log` + `reset`), a finished installation is not.

---

## 3. Real-time console (browser ↔ agent direct)

Two modes: direct WS (happy path) or polling via the panel (fallback if WS impossible).

```mermaid
sequenceDiagram
    participant N as Browser (XtermConsole)
    participant P as Panel (createConsoleTokenFn)
    participant A as Agent (WS /servers/:id/ws)

    N->>P: POST createConsoleTokenFn(serverId)
    P->>P: signConsoleToken (HS256 JWT, key = node token, TTL 300 s)
    P-->>N: { token, wsUrl }
    N->>A: WebSocket open (NO auth in the URL)
    N->>A: { type: "auth", token }
    A->>A: checks signature, aud, scope, exp, serverId, permissions
    A-->>N: { type: "auth-ok" }
    A-->>N: { type: "log", lines[] } (live streaming)
    A-->>N: { type: "status", status } (running/stopped/crashed)
    opt installation in progress or failed (last known)
        A-->>N: { type: "install-status", ... } + { type: "install-log", lines[], reset: true } (trail replay)
    end

    Note over N,A: Commands and power actions in real time
    N->>A: { type: "command", command: "stop" } (process stdin)
    N->>A: { type: "power", action: "restart" }

    Note over N,A: Installation = same socket: steps and output pushed live
    A-->>N: { type: "install-status", status, step, percent, error } (banner)
    A-->>N: { type: "install-log", lines[], replace } (logs, in-place \r progress)

    Note over N,A: Token refresh BEFORE expiry (re-auth without reconnecting)
    N->>P: POST createConsoleTokenFn (new JWT)
    N->>A: { type: "auth", token }
    A-->>N: { type: "auth-ok" }
```

**Polling fallback** (WS unavailable: proxy without WS, old agent, refused origin — 3 attempts max):

```mermaid
sequenceDiagram
    participant N as Browser
    participant P as Panel (getServerLogsFn)
    participant A as Agent

    loop incremental polling
        N->>P: GET getServerLogsFn(serverId, after=N)
        P->>A: GET /servers/:serverId/logs?after=N (Bearer)
        A-->>P: { lines[], next, status }
        P-->>N: lines appended to the terminal (cursor next)
    end
```

In degraded mode, an in-progress installation also switches to polling: the dedicated installation panel (`getInstallStatusFn` → `GET /servers/:serverId/install`) replaces the console.

**Console security**
- Short-lived JWT (300 s), refreshed via re-`auth` — never a token in the URL/query string.
- `scope: websocket`, `serverId` locked to the WS route parameter.
- Every message is re-checked (permissions + expiry); the agent can rate-limit (`error: rate-limited`).
- The browser origin is checked by the agent (`allowedOrigins`).

---

## 4. Power actions & commands (panel path)

When direct WS is not active, actions go through server functions (same owner validation on the panel side, same Bearer on the agent side):

```mermaid
sequenceDiagram
    participant N as Browser
    participant P as Panel (serverActionFn / sendCommandFn)
    participant A as Agent

    N->>P: POST serverActionFn { serverId, action: start|stop|restart|kill }
    P->>P: loadOwnedServer (owner or admin)
    P->>A: POST /servers/:serverId/action { action } (Bearer)
    A-->>P: { status } (DB sync)
    P-->>N: { action, status }
    N->>N: invalidate ['server', serverId]
```

`kill` force-bypasses the server lock (a stuck process stays killable, like wings). Agent errors are mapped: `not_found` → 404, state conflict → 409.

---

## 5. Reinstallation (Settings → console)

Same runner as installation, but **in place**: server stopped, directory and allocation kept, **up-to-date** recipe sent by the panel.

```mermaid
sequenceDiagram
    participant N as Browser (Settings)
    participant P as Panel (reinstallServerFn)
    participant D as Postgres
    participant A as Agent
    participant R as Runner + Registry

    N->>N: confirm() (« fichiers peuvent être supprimés… »)
    N->>P: POST reinstallServerFn(serverId)
    P->>D: SELECT server, recipe (up-to-date JSON), variables
    P->>A: POST /servers/:serverId/reinstall { recipe, variables }
    A->>A: Zod validation + known server + no install in progress
    A-->>P: 202 { status: "installing" }
    P->>D: UPDATE server.status = installing
    P-->>N: redirect → console (installation panel)
    A->>R: background: STOP the process if running, then runner
    Note over N,R: Tracking is identical to the installation flow<br/>(WS console: install-status + install-log, see §2)
    R->>A: store.save (recipe/variables updated) on success
```

**Unknown server on the agent side** — the agent's store (`servers.json`) is written only on installation **success**. A failed installation (or a lost agent dataDir) therefore leaves the panel DB and the agent store out of sync, and `/reinstall` answers 404. The panel handles this case: on 404, `reinstallServerFn` falls back to a **full installation** (`POST /servers/install`) rebuilt from the DB (current recipe, variables, allocation, `installDir` = `servers/<uuid>`).

---

## 6. Variable editing (Variables page)

The `/servers/$serverId/variables` page (formerly "Startup") edits the recipe variables
after installation. The **panel DB is the source of truth** (`server.variables` column);
the agent only keeps a **cache** (`servers.json`) used at start. While wings pulls its
config from the panel on every boot, the mojito agent cannot call the panel
(no credentials), so the panel **pushes** the sync at save time — this is also
essential because a start can be triggered directly by the browser
via the WS console, without going through the panel.

```mermaid
sequenceDiagram
    participant N as Browser (Variables)
    participant P as Panel (updateServerVariablesFn)
    participant D as Postgres
    participant A as Agent (POST /variables)

    N->>P: POST updateServerVariablesFn { serverId, variables (full record) }
    P->>P: loadOwnedServer + merge: only userEditable variables<br/>accept the new values (the others keep their value)
    P->>P: re-validation of the recipe rules (validateVariableValue from the contract:<br/>required, min/max, pattern, options) → 422 otherwise
    P->>A: POST /servers/:serverId/variables { variables } (Bearer)
    alt agent does not know the server (404)
        P->>D: UPDATE server.variables (the agent will catch up on the next full install)
    else agent unreachable / error
        P-->>N: 502 — nothing is written (no DB ↔ cache divergence)
    else OK
        A->>A: re-validation (rules of the stored recipe) + refusal if an install is in progress (409)
        A->>A: merge + store.save(servers.json)
        P->>D: UPDATE server.variables
        P-->>N: success toast — « appliquées au prochain démarrage »
    end
```

**Key points**
- Validation in **three layers** sharing the same contract function:
  form schema (TanStack Form, messages mapped per field), server function (422),
  agent (422). No divergence possible between the rules.
- New values apply on the **next start** (templating resolution,
  env at spawn, `java`/`steamcmd` tool provisioning) — a running process keeps
  its original environment.
- `userViewable && !userEditable` variables display as read-only;
  non-viewable ones stay in the record but are not editable.
- The resolved startup command is displayed read-only: recipe variables are
  substituted live (current value > default), system variables
  (`{{SERVER_…}}`) stay literal — only the agent can resolve them.

---

## 7. Server lifecycle (statuses)

```mermaid
stateDiagram-v2
    [*] --> installing : creation / reinstall
    installing --> stopped : runner finished
    installing --> install_failed : runner failure
    install_failed --> installing : « Réessayer » (retryInstallFn)
    stopped --> running : start
    running --> stopped : stop/restart
    running --> crashed : unclean exit
    crashed --> running : auto-restart (60 s anti crash-loop)
    crashed --> stopped : manual stop
```

- The **DB** status is synchronized by server functions (`getServerFn` queries the agent and corrects the DB; `getInstallStatusFn` tracks the installation).
- The agent knows a finer runtime state (`offline/starting/running/stopping`) mapped to the 5 panel statuses.

---

## 8. SFTP (agent hosts the server, panel validates the credentials)

The SFTP subsystem is the ONE flow where the agent calls the panel (wings
model): shard hosts the SFTP server (`crypto/ssh` + `pkg/sftp`, default
port 2022, opt-in via `sftp.enabled` in shard.yml — the panel generates the
section), but never stores a credential itself. The SFTP username is
`{email}.{serverId}` and the password is the user's PANEL account password
(Pelican reuses the account password the same way).

```mermaid
sequenceDiagram
    participant C as SFTP client (FileZilla…)
    participant A as shard :2022
    participant P as Panel
    C->>A: SSH handshake, user `{email}.{serverId}` + panel password
    A->>A: username format gate (regex, anti bot flood)
    A->>P: POST /api/sftp/auth (Bearer = agent token)
    P->>P: node by token (constant-time compare of the decrypted tokens)
    P->>P: user by email, verifyPassword vs account row (better-auth)
    P->>P: server belongs to the node? per-server grants?
    P-->>A: { user, server, permissions } — "*" for owner/admin
    A-->>C: SSH auth OK → pkg/sftp session rooted at the server installDir
```

- Permissions: the panel maps `server.files.*` grants onto the agent's
  closed list (`file.read`, `file.read-content`, `file.create`,
  `file.update`, `file.delete`); owners/admins get `*`. The agent gates
  EVERY operation on them (`internal/sftp/handler.go`).
- All failures answer the same 403 — the panel never distinguishes
  unknown node/user, bad password or missing grant (no user enumeration).
- Filesystem sandboxing is the SAME gate as the file API
  (`files.ResolveServerPath`): traversal, drive letters and
  Windows-forbidden characters are refused.
- The Files page shows the connection details (host `fqdn:sftpPort`,
  username, "password = panel password") to users holding any
  `server.files.*` grant.

---

## 9. Route reference

### Panel ↔ Agent (node Bearer token — `AGENT_ROUTES`)

| Route | Usage |
|---|---|
| `GET /health` | Public — healthcheck (version, uptime) || `POST /servers/install` | Start an installation (202) — sync validation 400/422 |
| `POST /servers/:serverId/reinstall` | Reinstall in place (202, stops the server first) |
| `GET /servers/:serverId/install` | Installation status + logs (end-of-install sync + polling fallback) |
| `POST /servers/:serverId/variables` | Variable cache sync (merge + re-validation, refused if an install is in progress) — see §6 |
| `POST /servers/:serverId/allocation` | Primary allocation sync (port/ip of the next start, refused if an install is in progress) — see §6 |
| `GET /servers` | List of the agent's servers |
| `GET /servers/:serverId` | Runtime info (status, recent logs) |
| `GET /servers/:serverId/logs?after=N` | Incremental logs (console fallback) |
| `POST /servers/:serverId/action` | start / stop / restart / kill |
| `POST /servers/:serverId/command` | stdin command |
| `DELETE /servers/:serverId` | Deletion (refused if an install or a process is active) |
| `GET /servers/:serverId/ws` | Browser console — console JWT (see §3) |

### Agent → Panel (node Bearer token — `PANEL_ROUTES`)

| Route | Usage |
|---|---|
| `POST /api/sftp/auth` | SFTP credential validation (see §8) — the only agent → panel call |

### Browser ↔ Agent (WS console, JWT)

| Message (→ agent) | Message (← agent) |
|---|---|
| `{ type: "auth", token }` | `{ type: "auth-ok" }` |
| `{ type: "command", command }` | `{ type: "log", lines[] }` (runtime) |
| `{ type: "power", action }` | `{ type: "status", status }` |
| | `{ type: "install-status", status, step, totalSteps, percent, message, error }` |
| | `{ type: "install-log", lines[], reset, replace }` — `reset` = full replay (clear the console), `replace` = `\r` rewrite (progress), levels `step`/`info`/`error` |
| | `{ type: "error", code }` |

### Server functions exposed to the browser (`src/server/functions/`)

| Function | Method | Role |
|---|---|---|
| `installServerFn` | POST | Create + start the installation |
| `getInstallStatusFn` | GET | Installation status/logs (end-of-install sync + polling fallback) |
| `retryInstallFn` | POST | Relaunch a failed installation |
| `listServersFn` | GET | List (admin: everything, otherwise own servers) |
| `getServerFn` | GET | Detail + runtime sync + logs |
| `getServerLogsFn` | GET | Incremental logs (console fallback) |
| `createConsoleTokenFn` | POST | Console JWT + wsUrl |
| `serverActionFn` | POST | start/stop/restart/kill |
| `sendCommandFn` | POST | stdin command via panel |
| `reinstallServerFn` | POST | In-place reinstallation |
| `updateServerVariablesFn` | POST | Variable editing (userEditable merge + agent sync) — see §6 |
| `getServerNetworkFn` | GET | Server allocations + free ones on the node (Network page) |
| `addServerAllocationFn` | POST | Claim a free allocation on the node |
| `removeServerAllocationFn` | POST | Release a non-primary allocation |
| `setPrimaryServerAllocationFn` | POST | Set the primary allocation + agent sync (next start) |
| `deleteServerFn` | POST | Deletion (agent + DB, allocations returned to the node pool) |
