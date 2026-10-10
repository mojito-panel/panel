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

## Schéma des plugins JSON (V1)

```json
{
  "schemaVersion": 1,
  "id": "minecraft-vanilla",
  "name": "Minecraft Vanilla",
  "author": "moi",
  "tags": ["minecraft", "java"],
  "requirements": { "minRamMb": 512 },
  "variables": [
    { "id": "ram_mb", "type": "number", "default": 2048, "label": "RAM (Mo)", "min": 512, "max": 16384 },
    { "id": "motd",   "type": "string", "default": "Mon serveur", "label": "MOTD" },
    { "id": "version","type": "string", "default": "1.21.4", "label": "Version" }
  ],
  "install": [
    { "action": "download", "url": "https://.../server-{{version}}.jar", "dest": "server.jar" },
    { "action": "write", "file": "eula.txt", "content": "eula=true" },
    { "action": "replace", "file": "server.properties", "find": "motd=", "replace": "motd={{motd}}" }
  ],
  "start": {
    "command": "java -Xms{{ram_mb}}M -Xmx{{ram_mb}}M -jar server.jar nogui",
    "stop": { "type": "command", "value": "stop" },
    "readyPattern": "Done \([0-9.]+s\)! For help"
  },
  "env": { "JAVA_OPTS": "-XX:+UseG1GC" }
}
```

**Actions du runner V1 :** `download`, `extract`, `write`, `replace`, `command`

**Templating `{{variable}}`** appliqué partout. Validation stricte : variable inconnue = erreur à l'installation.

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

- [ ] Runner d'étapes : `download`, `write`, `extract`, `command`, `replace` + templating
- [ ] node-pty : spawn + attach console, envoi de commandes, buffer de logs
- [ ] Stop gracieux (command/signal + timeout → kill)
- [ ] Cleanup : suppression dossier à la suppression du serveur

### Phase 2 — Bridage (V2 — pas en V1)

- [ ] Bindings Job Objects (RAM + CPU rate)
- [ ] Assignation au spawn (avant les enfants !)
- [ ] Métriques : lecture conso RAM/CPU par serveur
- [ ] Crash detection + auto-restart configurable

### Phase 3 — Panel & liaison (2–4 semaines)

- [ ] CRUD nodes (génération token), plugins (upload JSON), serveurs
- [ ] Installation d'un serveur : panel → agent (étapes + progression temps réel)
- [ ] Console live dans le panel (WS, logs virtualisés avec @tanstack/react-virtual)
- [ ] Start/stop/restart + envoi de commandes
- [ ] Gestion des variables par serveur (formulaires auto-générés depuis le plugin)
- [ ] MikroORM migrations pour les entités métier (node, plugin, server, server_allocation)

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
