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
- Logs live : l'agent ouvre une connexion WS **sortante** vers le panel (phase 3)
- Ne JAMAIS logger le token

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
  — (remplace le WS + react-virtual initialement prévus)
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

---

## Critères de réussite V1

1. Installer un serveur Minecraft Vanilla depuis le panel, en 3 clics, sur une machine Windows fraîche
2. Le serveur est bridé à la RAM configurée (vérifiable : `java -Xmx` + Job Object) — V2
3. Impossible (via ACL) d'accéder au dossier d'un autre serveur — V2
4. Console live + `stop` gracieux depuis le panel
5. Suppression propre : dossier, process, tout part
