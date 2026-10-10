# Mojito Panel

Panel d'hébergement de serveurs de jeux, natif Windows, sans Docker.
Architecture type Pelican/Pterodactyl : **Panel** (TanStack Start) + **Agent** (Node pur) + **Plugins JSON** (eggs).

## Stack

| Composant | Techno |
|---|---|
| Panel front | TanStack Start + shadcn/ui + TanStack Table |
| Auth | better-auth (email/mot de passe, rôles admin/user) |
| DB | Postgres 17 (docker compose) — MikroORM v7 gère toutes les tables (y compris better-auth) |
| Contrat panel ↔ agent | Schémas Zod partagés (`@mojito/contract`) |
| Agent | Node pur (Fastify + Bearer token) |
| Tests | Vitest |

## Prérequis

- **Node.js 24** (fixé via `.nvmrc` et `mise.toml`)
- **npm 11** (inclus avec Node 24)
- **Docker** (pour Postgres en dev, optionnel)
- **mise** (recommandé pour gérer les versions)

```bash
# Avec mise (recommandé)
mise install
```

## Installation

```bash
# 1. Installer les dépendances
npm install

# 2. Setup dev : démarre Postgres (Docker) + copie les .env
mise run setup:dev
# ou manuellement :
#   docker compose -f docker-compose.dev.yml up -d
#   node scripts/copy-env.mjs

# 3. Rien à faire — les migrations MikroORM s'appliquent au boot du serveur (src/server.ts)
```

## Développement

```bash
# Lancer le panel (TanStack Start) — http://localhost:5173
npm run dev
# ou: mise run dev

# Lancer l'agent
npm run dev:agent
# ou: mise run dev:agent

# Lancer tous les tests
npm test

# Typecheck
npm run typecheck

# Voir les logs Docker
mise run docker:logs

# Arrêter les services Docker
mise run docker:down
```

## Structure du monorepo

```
packages/
├── contract/     # Schémas Zod partagés (plugin JSON + API panel ↔ agent)
├── panel/        # Panel web (TanStack Start + MikroORM + better-auth)
└── agent/        # Agent daemon (Fastify, 1 par machine Windows)
```

## Configuration

Les fichiers `.env.default` sont copiés en `.env` par `mise run setup:dev` (ou `node scripts/copy-env.mjs`).

### Panel (`packages/panel/.env`)

| Variable | Défaut | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://mojito:mojito@localhost:5432/mojito` | Connexion Postgres (partagée better-auth + MikroORM) |
| `PANEL_URL` | `http://localhost:3000` | URL publique du panel |
| `BETTER_AUTH_SECRET` | — | Secret better-auth (32+ caractères) |

### Agent (`packages/agent/.env`)

| Variable | Défaut | Description |
|---|---|---|
| `AGENT_TOKEN` | — | **Requis** — token Bearer (32+ caractères) |
| `AGENT_JWT_SECRET` | — | **Requis** — identique à `PANEL_JWT_SECRET`, vérifie les JWT console |
| `AGENT_PORT` | `8080` | Port d'écoute |
| `AGENT_HOST` | `0.0.0.0` | Interface d'écoute |
| `AGENT_DATA_DIR` | `C:\PanelData` | Dossier de données des serveurs |
| `PANEL_URL` | — | URL du panel (pour connexion WS sortante) |

### Console live & JWT (navigateur ↔ agent direct)

La console streame les logs **directement depuis l'agent** (type Pelican) — le panel
ne relaie plus les logs. Le navigateur obtient un JWT court auprès du panel,
l'agent valide ce JWT et gate chaque action sur les permissions du payload :

```
Navigateur ──POST createConsoleToken──▶ Panel (requireUser + ownership)
Navigateur ◀──{ token, wsUrl }───────── Panel (JWT HS256, TTL 5 min, permissions V1 = toutes)
Navigateur ──WS wsUrl?token=jwt───────▶ Agent (vérifie signature/aud/exp/serverId)
Navigateur ◀──auth-ok + logs stream──── Agent (permissions re-validées à CHAQUE message)
```

- `PANEL_JWT_SECRET` (panel) et `AGENT_JWT_SECRET` (agent) doivent être **identiques**.
- Fallback : si le WS échoue à l'ouverture, la console retombe sur le polling des logs (`GET /logs?after=N`).
- Le JWT (query string) et le token agent ne sont JAMAIS loggés (redaction du logger agent).

### Base de données (Docker)

`docker-compose.dev.yml` démarre un Postgres 17 pour le dev :

| Service | Port | Credentials |
|---|---|---|
| Postgres | `5432` | `mojito` / `mojito` / db `mojito` |

## Migrations

MikroORM gère **toutes** les tables (better-auth + métier). Les migrations
s'appliquent automatiquement au démarrage du serveur (`src/server.ts` →
`orm.migrator.up()`) :

```bash
# Générer une migration après une évolution du schéma des entités
npm run db:migrate -w @mojito/panel

# Appliquer les migrations manuellement (le boot le fait déjà)
npm run db:migrate:up -w @mojito/panel
```

## Roadmap

- **Phase 0** — Squelette (en cours) : monorepo, panel, agent, contract, tests
- **Phase 1** — Cœur de l'agent : runner d'étapes, node-pty, stop gracieux
- **Phase 2** — Bridage : Job Objects (RAM/CPU) — *V2*
- **Phase 3** — Panel & liaison : CRUD, console live, WS
- **Phase 4** — SEA & distribution : packaging agent en `.exe`
- **Phase 5** — Console WS directe navigateur ↔ agent + JWT + permissions (terminée)

> Les Job Objects et l'isolation des users Windows sont volontairement reportés en V2.

## Licence

MIT
