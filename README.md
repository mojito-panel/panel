# Mojito Panel

Panel d'hébergement de serveurs de jeux, natif Windows, sans Docker.
Architecture type Pelican/Pterodactyl : **Panel** (TanStack Start) + **Agent** (Node pur) + **Plugins JSON** (eggs).

## Stack

| Composant | Techno |
|---|---|
| Panel front | TanStack Start + shadcn/ui + TanStack Table |
| Auth | better-auth (email/mot de passe, rôles admin/user) |
| DB | SQLite (`node:sqlite`) — better-auth + MikroORM v7 partagent le même fichier |
| Contrat panel ↔ agent | Schémas Zod partagés (`@mojito/contract`) |
| Agent | Node pur (Fastify + Bearer token) |
| Tests | Vitest |

## Prérequis

- **Node.js 24** (fixé via `.nvmrc` et `mise.toml`) — `node:sqlite` est requis
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

# 3. Migrations better-auth (tables user/session/account/verification)
mise run migrate
# ou: npm run auth:migrate -w @mojito/panel
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
| `DATABASE_PATH` | `./data/mojito.db` | Chemin de la base SQLite (partagée better-auth + MikroORM) |
| `PANEL_URL` | `http://localhost:3000` | URL publique du panel |
| `BETTER_AUTH_SECRET` | — | Secret better-auth (32+ caractères) |

### Agent (`packages/agent/.env`)

| Variable | Défaut | Description |
|---|---|---|
| `AGENT_TOKEN` | — | **Requis** — token Bearer (32+ caractères) |
| `AGENT_PORT` | `8080` | Port d'écoute |
| `AGENT_HOST` | `0.0.0.0` | Interface d'écoute |
| `AGENT_DATA_DIR` | `C:\PanelData` | Dossier de données des serveurs |
| `PANEL_URL` | — | URL du panel (pour connexion WS sortante) |

### Base de données (Docker)

`docker-compose.dev.yml` démarre un Postgres 17 pour le dev (optionnel, V1 utilise SQLite) :

| Service | Port | Credentials |
|---|---|---|
| Postgres | `5432` | `mojito` / `mojito` / db `mojito` |

## Migrations

Deux systèmes de migrations cohabitent (même fichier SQLite) :

```bash
# Tables better-auth (user, session, account, verification)
npm run auth:migrate -w @mojito/panel

# Tables métier MikroORM (node, plugin, server, server_allocation)
# via mikro-orm CLI (à venir en phase 3)
```

## Roadmap

- **Phase 0** — Squelette (en cours) : monorepo, panel, agent, contract, tests
- **Phase 1** — Cœur de l'agent : runner d'étapes, node-pty, stop gracieux
- **Phase 2** — Bridage : Job Objects (RAM/CPU) — *V2*
- **Phase 3** — Panel & liaison : CRUD, console live, WS
- **Phase 4** — SEA & distribution : packaging agent en `.exe`

> Les Job Objects et l'isolation des users Windows sont volontairement reportés en V2.

## Licence

MIT
