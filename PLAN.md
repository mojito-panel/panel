# Panel d'hébergement de serveurs de jeux — Plan complet

> Un panel type Pelican/Pterodactyl, natif Windows, sans Docker.
> Architecture : **Panel** (TanStack Start) + **Agent** (Node pur, packagé SEA) + **Plugins JSON** (type eggs).

---

## Architecture globale

```
Panel (TanStack Start)  <--HTTPS + Bearer token / WS-->  Agent (Node + Fastify, 1 par machine)
       |                                                        |
   better-auth                                           Runner d'étapes JSON
   MikroORM v7 (SQLite)                                  node-pty (consoles)
   TanStack Query                                        (V2: Job Objects, users Windows)
```

**Principes clés :**
- Le **panel** ne touche JAMAIS directement aux serveurs de jeu. Il parle à l'agent via API.
- L'**agent** est un daemon système générique : il ne sait rien des jeux, tout est dans les JSON.
- Le **contract** panel ↔ agent est défini par des schémas Zod partagés (`@mojito/contract`).

---

## Stack technique (décisions verrouillées)

| Composant | Techno | Notes |
|---|---|---|
| Panel front | TanStack Start + shadcn/ui | TanStack Router + TanStack Query |
| Auth panel | better-auth 1.7 | `node:sqlite` (Node 24), plugin `tanstackStartCookies` |
| DB | MikroORM v7 (`defineEntity`) | SQLite, même fichier que better-auth |
| Query cache | TanStack Query | `staleTime: 60s`, passé dans le RouterContext |
| Agent | Node pur (Fastify + WS) | PAS de NestJS — c'est un daemon système |
| Packaging agent | Node SEA | `.exe` unique + addons natifs en fichiers externes (V2) |
| PTY / consoles | node-pty | Phase 1 |
| Bridage RAM/CPU | Windows Job Objects | **V2** — pas en V1 |
| Isolation FS | Users Windows locaux + ACL NTFS | **V2** — pas en V1 |
| Auth panel ↔ agent | Token statique (32 bytes random) en HTTPS | mTLS/rotation plus tard |
| Auth user → agent | JWT HS256 court (TTL ~5 min) émis par le panel | Secret partagé, payload = serverId + permissions — cf. Phase 5 |
| Logs live | WebSocket navigateur → agent (direct, type Pelican) | Remplace le polling de la phase 3 — cf. Phase 5 |

---

## Structure du repo (monorepo npm workspaces)

```
mojito-panel/
├── package.json              # npm workspaces (packages/*)
├── mise.toml                 # Node 24 + npm 11, tâches setup:dev, migrate, dev, test
├── .nvmrc                    # 24
├── docker-compose.dev.yml    # Postgres 17 (dev, optionnel — V1 utilise SQLite)
├── scripts/copy-env.mjs      # Copie .env.default → .env
└── packages/
    ├── contract/             # @mojito/contract — Schémas Zod partagés
    │   └── src/
    │       ├── plugin-schema.ts  # Schéma JSON des plugins (eggs) + templating {{var}}
    │       └── api.ts            # Routes, payloads WS panel ↔ agent
    ├── panel/                # @mojito/panel — TanStack Start
    │   └── src/
    │       ├── routes/           # TanStack Router (file-based, dossiers)
    │       │   ├── __root.tsx    # createRootRouteWithContext + beforeLoad (session SSR)
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
    │       │   ├── auth.ts       # better-auth server (node:sqlite, tanstackStartCookies)
    │       │   ├── auth-client.ts # better-auth client React
    │       │   ├── auth.types.ts # Types User/Session partagés
    │       │   └── utils.ts      # cn() shadcn
    │       ├── db/               # MikroORM v7 (defineEntity)
    │       │   ├── entities/     # User, Session, Account, Verification (better-auth)
    │       │   │                 # + Node, Plugin, Server, ServerAllocation (métier)
    │       │   └── index.ts      # initOrm / getOrm singleton
    │       ├── server/functions/ # Server functions TanStack Start
    │       │   ├── auth.ts       # getSession (SSR), signOutFn
    │       │   └── health.ts     # healthcheck DB
    │       └── router.tsx        # getRouter + RouterContext (queryClient, staleTime 60s)
    └── agent/                # @mojito/agent — Fastify daemon
        └── src/
            ├── api/index.ts      # Fastify + Bearer token (SHA-256, timing-safe) + /health
            ├── config.ts         # Config Zod (env vars)
            └── index.ts          # Entrypoint
```

---

## Schéma des plugins JSON (V2 — à parité avec les eggs Pelican)

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

**Actions du runner :** `download`, `extract`, `write`, `replace`, `configFile` (parsers properties/ini/yaml/json), `command`, `script` (fallback shell bash/powershell/cmd — pour tout le reste)

**Variables système** fournies par l'agent : `SERVER_UUID`, `SERVER_NAME`, `SERVER_MEMORY`, `SERVER_PORT`, `SERVER_IP`, `SERVER_INSTALL_DIR`

**Templating `{{ENV_VAR}}`** (UPPERCASE) appliqué partout. Résolution : variables système > variables du serveur > defaults du plugin > env fixe. Variable inconnue = erreur à l'installation.

> Format à parité de features avec les eggs Pelican (PTDL_v2) : variables env + user_viewable/user_editable + validation, config files avec parsers, ready detection avec strip, logs config, features flags, update_url. Différence clé : déclaratif et Windows-first (pas de Docker, pas de script bash obligatoire — l'action `script` sert de soupape).
---

## Entités MikroORM (v7, defineEntity)

- **User** (better-auth) : id, email, name, role (`admin` | `user`)
- **Session / Account / Verification** (better-auth, migrations gérées par `@better-auth/cli`)
- **Node** : id, name, fqdn, agentTokenHash, lastSeenAt, status
- **Plugin** : id, slug, name, schemaVersion, json (raw)
- **Server** : id, name, nodeId, pluginId, ownerId, status, variables (JSON)
- **ServerAllocation** : port, maxRamMb, maxCpuPercent

> **Note** : better-auth et MikroORM partagent le même fichier SQLite mais ont deux pipelines de migrations séparés (comme custodia avec Postgres).

---

## Auth & sécurité

### Panel (better-auth)

- Email/mot de passe V1
- `node:sqlite` (Node 24) — pas de better-sqlite3 (ne compile pas sur Windows)
- Plugin `tanstackStartCookies` pour forward les cookies dans TanStack Start
- **TanStack Query dans le RouterContext** : `staleTime: 60s`, session fetchée en SSR via `beforeLoad`
- **AuthProvider** : `useAuth()` expose `user`, `session`, `useSignOut()`
- Rôles : `admin` (gère nodes, plugins, users) / `user` (gère ses serveurs)

### Panel ↔ Agent

- Token généré côté panel : `crypto.randomBytes(32).toString('hex')`
- Panel stocke le **hash** (SHA-256), l'agent stocke le plaintext
- Toutes les requêtes en HTTPS (`Authorization: Bearer <token>`), comparaison en temps constant (`timingSafeEqual`)
- Ne JAMAIS logger le token

### User ↔ Agent (JWT, type Pelican)

- Le navigateur parle **directement** à l'agent (WS console) — le panel ne relaie plus les logs.
- Le panel émet un **JWT HS256 court** (TTL ~5 min), signé avec un secret partagé panel/agent
  (`PANEL_JWT_SECRET` / `AGENT_JWT_SECRET`, 32+ caractères, jamais loggé).
- Payload validé par l'agent à CHAQUE requête/message : `aud: 'mojito-agent'`, `serverId`,
  `sub` (userId), `permissions[]`, `exp`, `jti`.
- L'agent vérifie : signature, `aud`, `exp`, `serverId` du token === paramètre de la route,
  puis les **permissions** exigées par l'action (`console.write` pour une commande, etc.).
- Permissions V1 : liste fermée dans le contract — `console.read`, `console.write`,
  `power.start`, `power.stop`, `power.restart`, `power.kill`, `variables.read`, `variables.write`.
- Pas d'invitations/sub-owners en V1 : tout owner (et l'admin) reçoit **toutes** les permissions
  par défaut. La liste fermée existe déjà côté agent pour être prêt.
- Révocation : TTL court + déconnexion WS. Blacklist `jti` = V2.

---

## Roadmap par phases

### Phase 0 — Squelette ✅ TERMINÉE

- [x] Monorepo npm workspaces, packages `contract`, `panel`, `agent`
- [x] Panel : TanStack Start + shadcn + MikroORM v7 + better-auth branchés et testés ensemble
- [x] TanStack Query dans le RouterContext (staleTime 60s) + AuthProvider/useAuth
- [x] Session SSR via `beforeLoad` + `queryClient.fetchQuery(['auth'])`
- [x] Pages login/register avec formulaires fonctionnels
- [x] Schéma Zod du plugin JSON (`plugin-schema.ts`) + contrat API (`api.ts`)
- [x] Agent : Fastify qui démarre + auth token (timing-safe) + healthcheck
- [x] Tests vitest : 54 tests (contract 36, panel 7, agent 11)
- [x] `mise.toml` (Node 24, tâches setup:dev/migrate/dev/test)
- [x] `docker-compose.dev.yml` (Postgres, optionnel)
- [x] `.env.default` + `scripts/copy-env.mjs`
- [x] README.md

### Phase 1 — Cœur de l'agent (2–4 semaines)

- [x] Runner d'étapes : `download`, `write`, `extract`, `command`, `replace`, `configFile`, `script` + templating `{{ENV_VAR}}`
- [x] Route `POST /servers/install` (API agent) branchée sur le runner
- [x] Process manager + registry (spec alignée wings)
- [x] Console : envoi de commandes, buffer de logs (ring buffer)
- [x] Stop gracieux (command/signal + timeout → poll → kill)
- [x] Crash detection minimale + anti-crash-loop
- [x] Cleanup : suppression dossier à la suppression du serveur (`DELETE /servers/:serverId`)

#### Spec process manager (alignée sur wings — server/power.go, environment/docker/power.go)

- **Power actions** : `start` / `stop` / `restart` / `kill` (identique `serverActionSchema`).
- **Power lock par serveur** : file d'actions séquentielle par serverId (pas de double start, pas de restart pendant un stop). `kill` force-passe le verrou (un process coincé doit toujours être tuable). Refus si `installing`.
- **États runtime** (dans l'agent, distincts des états panel) : `offline` / `starting` / `running` / `stopping`.
  - `starting` → `running` dès le spawn (comme wings — le `ready.pattern` émet un event `ready` séparé, utilisé pour la progression d'install).
  - Passer par `stopping` AVANT `offline` lors d'un stop → ne pas déclencher la crash detection.
- **Séquence stop** (comme wings) :
  1. état → `stopping`
  2. `command` → écrit sur stdin du process ; `signal` → kill direct
  3. attente de sortie pendant `stop.timeoutMs` (défaut 30s ; wings attend jusqu'à 10 min)
  4. toujours vivant → kill forcé (kill de l'arbre de process sous Windows : `taskkill /T /F`)
- **Crash detection minimale** (comme wings crash.go) : exit code non-nul ET état ≠ `stopping` → `crashed`. Anti-crash-loop : si dernier crash < N secondes (défaut 60s), pas de restart auto. Restart auto → repasse par le power lock.
- **Sortie console** : stdout/stderr pipés → ring buffer en mémoire (limite ~1000 lignes) + callbacks pour le streaming WS (phase 3).
- **Persistance locale** : registre JSON dans `AGENT_DATA_DIR` (serverId → plugin, variables, installDir, allocation) rempli à l'install — le start n'a besoin que du serverId.
- **Note écart wings** : wings re-applique `config.files` à chaque boot (`UpdateConfigurationFiles` dans onBeforeStart). Chez nous les actions `configFile` sont install-only pour l'instant — à reconsidérer en phase 3 (édition des variables sans réinstall).

### Phase 2 — Bridage (V2 — pas en V1)

- [ ] Bindings Job Objects (RAM + CPU rate)
- [ ] Assignation au spawn (avant les enfants !)
- [ ] Métriques : lecture conso RAM/CPU par serveur
- [ ] Crash detection + auto-restart configurable

### Phase 3 — Panel & liaison ✅ (V1)

- [x] CRUD nodes (génération token, affiché une seule fois à la création)
- [x] CRUD plugins (import JSON validé par `parsePlugin` v2, refus si serveurs actifs)
- [x] CRUD serveurs (création → install agent → DB ; suppression → agent + DB)
- [x] Installation d'un serveur : panel → agent (`installDir` relatif au dataDir de l'agent)
  — ⚠️ V1 synchrone sans progression live (WS : plus tard si besoin)
- [x] Console live : **xterm.js** alimenté par polling des logs incrémentaux de l'agent
  (`GET /servers/:id/logs?after=N`, toutes les 2 s) + envoi de commandes stdin
  — (remplace le WS + react-virtual initialement prévus ; le WS direct arrive en Phase 5,
  le polling restera en fallback)
- [x] Start/stop/restart/kill + envoi de commandes
- [x] Gestion des variables par serveur : formulaires auto-générés depuis les
  définitions du plugin (type number/boolean/options → champ adapté)
- [x] Sync schéma des entités métier au boot (`orm.schema.update()`) — better-auth
  migre ses tables séparément via son CLI (jamais sync MikroORM sur les tables auth)

Notes d'implémentation :
- Le panel stocke le token agent en clair dans la table node (nécessaire pour
  appeler l'agent ; encryption au repos = plus tard).
- Statut serveur : sync DB ← statut runtime de l'agent à chaque consultation.
- Ownership : un user voit/gère ses serveurs ; l'admin voit tout et gère nodes/plugins.

### Phase 4 — SEA & distribution (1–2 semaines)

- [ ] Build SEA de l'agent + addons externes
- [ ] Installeur Windows (service auto)
- [ ] Docs d'installation pour un utilisateur final

### Phase 5 — Console WS directe user ↔ agent + JWT + permissions (découpée en edits)

> Grosse mutation : le navigateur stream les logs directement depuis l'agent (type Pelican),
> authentifié par un JWT court émis par le panel. Découpée en edits indépendants,
> chacun testable/mergeable seul. Ordre = dépendances.

#### E1 — Contract : permissions, payload JWT, messages WS (`packages/contract/src/api.ts` + tests)

- [ ] `permissionSchema` : enum fermé `console.read`, `console.write`, `power.start`,
  `power.stop`, `power.restart`, `power.kill`, `variables.read`, `variables.write`
  (subset Pelican ; files/backups = V2+)
- [ ] `consoleTokenPayloadSchema` : `{ iss: 'mojito-panel', aud: 'mojito-agent', sub, serverId, permissions, iat, exp, jti }`
- [ ] `consoleTokenResponseSchema` (panel → navigateur) : `{ token, wsUrl }`
- [ ] Messages WS : navigateur → agent `{ type: 'command', command } | { type: 'power', action }` ;
  agent → navigateur `{ type: 'auth-ok' } | { type: 'log', lines[] } | { type: 'status', status } | { type: 'error', code }`
- [ ] Tests contract (enum refusée hors liste, payload obligatoire)

#### E2 — Agent : secret JWT dans la config (`packages/agent/src/config.ts` + tests)

- [ ] `AGENT_JWT_SECRET` requis (32+ caractères), à côté du token statique panel
- [ ] Ne JAMAIS le logger (logger redacted comme pour le token)

#### E3 — Agent : vérification JWT (`packages/agent/src/api/jwt.ts` + tests)

- [ ] HS256 via `node:crypto` (HMAC-SHA256 + base64url, SANS dépendance jwt/jsonwebtoken)
- [ ] Vérifie signature, `aud === 'mojito-agent'`, `exp` (marge d'horloge 5 s)
- [ ] Retourne le payload typé ; erreurs distinctes : `invalid`/`expired` (→ 401) vs
  permissions insuffisantes (→ 403, check à part, par action)

#### E4 — Agent : endpoint WS console (`packages/agent/src/api/index.ts`, `process/registry.ts`)

- [ ] Dépendance `@fastify/websocket` + `ws`
- [ ] `GET /servers/:serverId/ws?token=<jwt>` — token en query param (le navigateur
  ne peut pas poser de header sur un WS). Token NEVER loggé (attention logger fastify).
- [ ] Handshake : vérif JWT + `serverId` du token === paramètre de route → `auth-ok`,
  batch initial du ring buffer, statut courant ; refus → close code 4001/4003 (pas de leak)
- [ ] Streaming : subscribe au callback de logs du registry (déjà en place pour le polling)
- [ ] Messages entrants : `command` gate `console.write`, `power` gate `power.<action>`
- [ ] Unsubscribe propre à la déconnexion ; plusieurs sockets par serveur OK (pas de broadcast à faire, chacun s'abonne)
- [ ] Le token est validé à la connexion ; les permissions re-validées à CHAQUE message entrant (payload en mémoire, pas re-signé)

#### E5 — Panel : émission du JWT (`packages/panel/src/server/functions/servers.ts` + `.env.default` + tests)

- [ ] `PANEL_JWT_SECRET` (même secret que l'agent) dans `.env.default`
- [ ] Server function `createConsoleToken(serverId)` : `requireUser()` + check ownership
  (ou admin), puis signe HS256 (`node:crypto`, même code de base que E3 partagé via une
  petite fonction `signJwt` — pas de dépendance)
- [ ] TTL 5 min, permissions = **toutes** en V1 (pas d'invitations ; défaut = full owner)
- [ ] Retourne `{ token, wsUrl }` (fqdn/agentPort du node) — validé par le contract E1
- [ ] Ne JAMAIS logger le token

#### E6 — Panel : console front en WS (`packages/panel/src/routes/_app/servers/$serverId.tsx`)

- [ ] Appel `createConsoleToken` → ouverture WS natif dans useEffect (SSR-safe, xterm déjà dynamique)
- [ ] Reconnexion avec backoff → ré-émettre un token frais à chaque tentative (TTL court)
- [ ] `command`/`power` envoyés via WS quand connecté ; sinon 401 → refresh token
- [ ] Fallback polling conservé : si le WS échoue à l'ouverture (proxy sans WS, agent vieux),
  retomber sur le polling `GET /logs?after=N` existant — dégradation, pas d'erreur
- [ ] Supprimer le polling une fois le WS stable ? Non en V1 : garder les deux (fallback documenté)

#### E7 — Hardening sécurité

- [ ] TTL 5 min max, `jti` présent (prêt pour blacklist V2)
- [ ] Rate-limit basique des `command` par socket (mémoire, ex. 10/s) anti-flood console
- [ ] Close immédiate sans détail si JWT invalide (pas de distinction d'erreur côté client)

#### E8 — Tests de bout en bout + docs

- [ ] Agent : WS auth OK/ko, token expiré, `serverId` mismatch, permissions refusées
  (`console.write` absente → commande rejetée), streaming reçu, unsubscribe
- [ ] Panel : émission refusée pour non-owner, payload conforme au contract
- [ ] `npm test` vert (54 tests + les nouveaux)
- [ ] README (schéma du flux JWT) + mise à jour de ce plan (cocher les cases)

#### Flux cible

```
Navigateur ──POST createConsoleToken──▶ Panel (requireUser + ownership)
Navigateur ◀──{ token, wsUrl }────────── Panel (JWT HS256, TTL 5 min, permissions: all en V1)
Navigateur ──WS wsUrl?token=jwt────────▶ Agent (vérif signature/aud/exp/serverId)
Navigateur ◀──auth-ok + logs stream───── Agent (chaque message entrant re-validé par permissions)
```

#### Écarts assumés vs Pelican/wings

- Pelican a des permissions par sub-user + invitations → V2 chez nous (liste fermée prête en E1)
- wings revalide le token auprès du panel en interne → non : nous faisons confiance au JWT
  signé (secret partagé), pas de call panel par message
- Pas de events SENTRY/apteryx (stats) en V1 — le WS ne transporte que logs/commandes/statut

### V2+ (idées, ne PAS faire en V1)

- mTLS ou rotation de tokens panel ↔ agent
- Quotas disque (fsutil, Windows Server)
- SFTP/file manager dans le panel
- Backups planifiés
- AppContainer / isolation réseau
- Multi-nodes avec scheduler de placement
- Facturation/quotas par user
- **Users Windows locaux + ACL NTFS** (isolation FS par serveur)

---

## Pièges à ne pas oublier (checklist)

- [ ] Job Object assigné AVANT les process enfants (évasion) — V2
- [ ] Addons natifs jamais bundle-és dans le SEA → fichiers à côté — V2
- [ ] SEA = CommonJS (build esbuild si code ESM) — V2
- [ ] Users locaux : jamais Administrateurs, groupe `PanelServers` dédié — V2
- [x] better-auth et MikroORM : deux pipelines de migrations séparés, même fichier SQLite
- [x] `schemaVersion` dans chaque JSON de plugin
- [x] Variables inconnues = erreur à l'installation, pas au runtime
- [ ] Timeout de stop gracieux avant kill forcé
- [ ] Console de logs : virtualisation obligatoire (Minecraft spamme)
- [ ] SteamCmd en cache global, pas par serveur
- [ ] JWT console : jamais dans les logs (query string visible dans le logger fastify)
- [ ] WS console : permissions du JWT re-validées à CHAQUE message, pas seulement à l'ouverture

---

## Critères de réussite V1

1. Installer un serveur Minecraft Vanilla depuis le panel, en 3 clics, sur une machine Windows fraîche
2. Le serveur est bridé à la RAM configurée (vérifiable : `java -Xmx` + Job Object) — V2
3. Impossible (via ACL) d'accéder au dossier d'un autre serveur — V2
4. Console live + `stop` gracieux depuis le panel
5. Suppression propre : dossier, process, tout part
