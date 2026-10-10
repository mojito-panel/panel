# AGENTS.md — Conventions du projet Mojito Panel

Panel d'hébergement de serveurs de jeux, natif Windows, sans Docker.
Monorepo npm workspaces : `contract` (Zod), `panel` (TanStack Start), `agent` (Fastify).

## Commandes

```bash
npm install                    # Dépendances (Node 24 requis)
mise run setup:dev             # Docker Postgres + copie .env.default → .env
npm run db:migrate -w @mojito/panel   # Génère une migration MikroORM (appliquée au boot par src/server.ts)
npm run dev                    # Panel — http://localhost:5173 (strictPort)
npm run dev:agent              # Agent Fastify
npm test                       # Tous les tests (workspaces)
npm run build                  # Build panel (vite, client + SSR)
```

## Architecture

- Le panel ne touche JAMAIS directement aux serveurs de jeu — il parle à l'agent via API.
- Le contrat panel ↔ agent est défini dans `@mojito/contract` (schémas Zod partagés).
- L'agent est un daemon générique — rien de spécifique aux jeux dans son code.

## Langue

- **Commentaires de code** : en ANGLAIS, dans tous les packages (`src/` comme `tests/`).
- **Tests** : en ANGLAIS — descriptions, messages d'assertion, noms de variables dans les fixtures.
- Les messages d'erreur runtime adressés à l'utilisateur final (ex : `PowerActionError('Serveur inconnu')`) restent en français.

## Stack & versions

| Techno | Contraintes |
|---|---|
| Node.js 24 | `pg` (Postgres) — PAS de better-sqlite3 (ne compile pas sur Windows) |
| TypeScript | `erasableSyntaxOnly: true` partout — PAS de parameter properties, enums, namespaces |
| Visibilité | Champs/méthodes privés avec `#` (syntaxe JS native) — JAMAIS `private`/`public`/`protected` |
| React 19.3 | PAS de `useCallback`/`useMemo`/`forwardRef` — React Compiler activé |
| MikroORM v7 | `defineEntity`/`p` (decorator-less) — PAS de EntitySchema ni de décorateurs |
| better-auth | `pg` Pool + mapping snake_case (`user.fields` etc.), plugin `tanstackStartCookies` — tables gérées par MikroORM |
| Zod 4 | Standard Schema — validateur natif de TanStack Form (pas d'adapter) |

## Conventions panel (packages/panel)

### Structure

```
src/
├── routes/            # TanStack Router file-based, en DOSSIERS (pas de flat names)
│   ├── __root.tsx     # createRootRouteWithContext + beforeLoad (session SSR)
│   ├── index.tsx      # / → redirect (connecté → /servers, sinon /login)
│   ├── _auth/         # pathless layout → /login, /register (PAS de sidebar)
│   ├── _app.tsx       # layout protégé : SidebarProvider + AppSidebar + guard
│   ├── _app/servers/  # /servers, /servers/new, /servers/$serverId
│   ├── _app/admin/    # /admin/nodes, /admin/plugins
│   └── api/auth/$.ts  # catch-all better-auth
├── components/ui/     # shadcn/ui (généré par le CLI — ne pas éditer à la main)
├── components/app-sidebar.tsx  # Sidebar de l'app (menu + footer user/logout)
├── contexts/          # React contexts (AuthProvider, useAuth)
├── lib/               # auth.ts (better-auth), auth-client.ts, utils.ts
├── db/
│   ├── entities.ts    # TOUTES les entités MikroORM dans UN fichier
│   ├── types.ts       # Types inférés : `interface IUser extends InferEntity<typeof User> {}`
│   └── index.ts       # Config MikroORM + singleton (initOrm/getOrm)
├── validators/        # Schémas Zod des formulaires (loginSchema, registerSchema, Dto)
├── server/functions/  # Server functions TanStack Start (getSession, signOutFn)
└── router.tsx         # RouterContext { queryClient } + staleTime 60s
```

### Règles

- **Formulaires** : TanStack Form + Zod (`useForm` + `validators: { onChange: schema }`), mutations via `useMutation`. JAMAIS de `useState` pour les champs de formulaire. Schémas dans `src/validators/`, types `XxxDto = z.infer<...>`. Lecture réactive d'une valeur du form : `<form.Subscribe selector={(s) => s.values.x}>`, écriture : `form.setFieldValue`. Pas de `z.coerce`/`z.default()` dans les schémas de formulaires (incompatibles avec le typage Standard Schema de TanStack Form).
- **Server functions** : dans `src/server/functions/`. Auth via `requireUser()`/`requireAdmin()` (`src/server/session.ts`), erreurs via `HttpError(status, message)`. Le client agent : `src/server/agent/client.ts` (fetch Bearer, erreurs `AgentError`). L'ORM s'obtient par `initOrm()` (lazy, sync le schéma métier au premier appel — ne touche JAMAIS les tables better-auth).
- **Console** : xterm.js (`@xterm/xterm` + `@xterm/addon-fit`), imports dynamiques dans useEffect (SSR-safe), polling des logs incrémentaux de l'agent (cursor `after=N`).
- **Types** : inférés des entités via `InferEntity` dans `db/types.ts` (préfixe `I` : `IUser`, `ISession`). PAS de types dupliqués à la main.
- **Entités** : toutes dans `db/entities.ts` avec `defineEntity` + `p`. Champs snake_case en DB via `.fieldName()`, camelCase en TS.
- **Session** : fetchée en SSR dans `beforeLoad` de `__root.tsx` via `queryClient.fetchQuery({ queryKey: ['auth'] })`. Après login/register/signOut : `queryClient.invalidateQueries({ queryKey: ['auth'] })`.
- **Composants shadcn** : `ref` en prop (React 19), pas de `React.forwardRef`.
- **Routes** : en dossiers. Une page = un dossier avec `index.tsx`. Regroupements via pathless layouts (`_auth/`).
- **DB** : Postgres — MikroORM gère TOUTES les tables (y compris better-auth). Migrations au boot via `src/server.ts` (`orm.migrator.up()`). JAMAIS de `schema.update()` (MikroORM v7 drop les tables inconnues par défaut). Le mapping snake_case better-auth est dans `src/lib/auth.ts` (`user.fields` etc.).
- **better-auth** : `baseURL: process.env.BETTER_AUTH_URL` — PAS de `trustedOrigins` custom. Le port du dev server est fixé dans `vite.config.ts` (`strictPort: true`).

## Conventions agent (packages/agent)

- Fastify + Bearer token (hash SHA-256, comparaison `timingSafeEqual`).
- `/health` public, tout le reste derrière l'auth.
- Config Zod depuis les variables d'environnement (`AGENT_TOKEN` requis, 32+ caractères).
- NE JAMAIS logger le token.
- **Redémarrage de l'agent** (≈ wings cmd/root.go) : état runtime + PID persistés dans `states.json` (dataDir, écrit à chaque transition d'état via `ServerManager`). Au boot, `restoreServers` (hook `onReady`) : état running/starting + PID vivant → « adopted » (marqué running SANS console live, le process n'est jamais tué juste pour plaire à l'agent) ; PID mort → start rejoué (`handlePowerAction('start')`). Un serveur adopté : `sendCommand` refuse, stop/kill → `taskkill /T /F` sur le PID, mort inattendue → détection de crash normale. PAS de persistance de l'historique console : le ring buffer repart vide à chaque boot de l'agent (l'historique figé serait perturbant). La suppression d'un serveur efface aussi son entrée `states.json`.

## Conventions contract (packages/contract)

- **Plugin format v2** — à parité de features avec les eggs Pelican (PTDL_v2), mais déclaratif et Windows-first (pas de Docker, pas de script bash obligatoire).
- **Variables** : `env` UPPERCASE (`MINECRAFT_VERSION`) + templating `{{ENV_VAR}}` partout. Champs : `name`, `type` (string/number/boolean), `defaultValue`, `userViewable`, `userEditable`, `sort`, `required`, `min`/`max`, `pattern` (validation regex, équivalent des `rules` Laravel de Pelican), `options`.
- **Variables système réservées** (fournies par l'agent, non déclarables) : `SERVER_UUID`, `SERVER_NAME`, `SERVER_MEMORY`, `SERVER_PORT`, `SERVER_IP`, `SERVER_INSTALL_DIR`.
- **Actions runner** : `download`, `extract`, `write`, `replace`, `configFile` (parsers `properties`/`ini`/`yaml`/`json` — équivalent `config.files` Pelican), `command`, `script` (fallback ouvert : shell `bash`/`powershell`/`cmd`).
- **Codes de sortie** : une action `command` peut déclarer `successCodes` (codes de sortie acceptés comme succès, défaut `[0]`). Ex : steamcmd sort avec 7 après son auto-update alors que le job a réussi.
- **Progression en direct** : une action `command` peut déclarer `tail` (`file`, `filter` regex optionnel, `intervalMs`) — l'agent suit le fichier et streame les nouvelles lignes pendant l'exécution. Requis pour les outils console (steamcmd) qui n'impriment leur progression que sur un vrai terminal, jamais sur un pipe.
- **Features outils** (interprétées par l'agent, les autres features restent des flags descriptifs) : `java` → JDK Microsoft Build of OpenJDK préchargé par l'agent dans le `.bin/` DU SERVEUR (isolé par serveur), version depuis la variable `JAVA_VERSION` (requise, surchargeable par serveur) ; `steamcmd` → SteamCMD préchargé dans `.bin/steamcmd` +, si la variable `STEAM_APP_ID` est déclarée, installation automatique du contenu (`+login anonymous`, `+app_update` puis passe `validate`, `STEAM_MOD` optionnel pour `+app_set_config`). Les bin dirs sont injectés en tête du `PATH` (`JAVA_HOME` inclus) pour les actions d'installation ET au spawn. Validation amont : `findToolFeatureErrors` (contract) — feature sans variable requise = erreur avant installation.
- **start** : `command`, `stop` (command/signal + `timeoutMs` → kill), `ready` (`pattern` + `strip` — équivalent `config.startup` Pelican), `workingDirectory`.
- **Autres** : `logs` (mode stdout/file + stripAnsi), `runtime` (contraintes hôte, remplace `docker_images`, ex: `{ "java": ">=21" }`), `features` (flags Pelican-style ; `java` et `steamcmd` sont interprétés — voir ci-dessus), `updateUrl`.
- Résolution du templating : variables système > variables du serveur > defaults du plugin > env fixe.
- Variable inconnue dans un template = erreur à l'installation (`findUnknownVariables`).
- Schémas Zod pour : requêtes/réponses API panel ↔ agent, messages WS.
- `schemaVersion` obligatoire dans chaque plugin JSON (v2 uniquement).

## Tests

- Vitest dans chaque package (`tests/` à côté de `src/`).
- Après tout changement : `npm test` doit passer (319 tests actuellement).

## V2 reporté (ne PAS faire en V1)

- Job Objects Windows (bridage RAM/CPU)
- Users Windows locaux + ACL NTFS (isolation FS)
- SEA packaging de l'agent
