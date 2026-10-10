# Communications Panel ↔ Agent ↔ Client web

> Référence des flux de communication entre les trois acteurs du système.
> Les schémas Zod partagés (`@mojito/contract`) font foi : ce document décrit
> les *workflows*, pas les types exacts (voir `packages/contract/src/api.ts`).

## Acteurs

| Acteur | Rôle |
|---|---|
| **Client web** (navigateur) | React 19 + TanStack Router/Query. Ne parle JAMAIS directement au panel pour les actions serveur : il appelle des *server functions* TanStack Start (SSR-aware), ou l'agent en direct pour la console (JWT court). |
| **Panel** (`@mojito/panel`) | TanStack Start (SSR Node). Seul détenteur de la DB (Postgres/MikroORM) et des sessions (better-auth). Parle à l'agent en HTTP `Bearer <token du node>` (token chiffré AES-256-GCM au repos). |
| **Agent** (`@mojito/agent`) | Fastify, 1 par machine. Daemon générique : exécute le runner d'installation des plugins, gère les process de jeu, expose la console WS. Ne connaît ni les joueurs ni la DB. |

```mermaid
graph LR
    subgraph Navigateur
        UI[Client React<br/>TanStack Query]
    end
    subgraph Panel
        SFN[Server functions<br/>TanStack Start]
        AUTH[better-auth<br/>sessions]
        ORM[MikroORM / Postgres]
        AGENTC[Client agent<br/>Bearer + fetch]
        JWT[Signature JWT console<br/>HS256 = token du node]
    end
    subgraph "Machine de jeu (node)"
        AG[Agent Fastify]
        RUN[Runner d'installation]
        PROC[Process serveur de jeu]
        REG[(Registry d'installation)]
        STORE[(servers.json)]
    end

    UI -- "HTTP (server functions)" --> SFN
    SFN <--> AUTH
    SFN <--> ORM
    SFN <--> AGENTC
    AGENTC -- "HTTP Bearer" --> AG
    UI -- "WS direct (JWT console)" --> AG
    AG <--> RUN
    AG <--> PROC
    RUN --> REG
    AG <--> STORE
```

**Règles d'or**
- Le panel ne touche jamais aux serveurs de jeu : tout passe par l'agent.
- Le client ne parle à l'agent QUE via la console WS, avec un JWT court signé par le panel avec le token du node (secret partagé panel ↔ agent, 1 par node — style Pelican).
- Le token d'agent n'est jamais loggé, ni envoyé au navigateur.

---

## 1. Authentification (session SSR)

```mermaid
sequenceDiagram
    participant N as Navigateur
    participant P as Panel (__root beforeLoad)
    participant D as Postgres

    N->>P: GET /servers (cookie de session)
    P->>D: queryClient.fetchQuery(['auth'])
    P-->>N: session SSR (user dans le contexte du routeur)
    Note over N,P: TanStack Query cache la session 60 s (staleTime)
    N->>N: beforeLoad du layout : pas de user → redirect /login
```

- Login/register/signOut → `queryClient.invalidateQueries({ queryKey: ['auth'] })`.
- Garde d'accès : `_app` (connecté), `admin/route.tsx` (rôle admin), `servers/$serverId/route.tsx` (connecté) — la propriété du serveur est vérifiée côté **server function** (`loadOwnedServer`), pas dans le routeur.

---

## 2. Création + installation d'un serveur (async, suivi en direct)

L'installation peut durer des minutes (JDK, JAR Mojang…). Elle démarre en **arrière-plan** côté agent, et le navigateur suit la progression étape par étape.

```mermaid
sequenceDiagram
    participant N as Navigateur (/servers/new)
    participant P as Panel (installServerFn)
    participant D as Postgres
    participant A as Agent (POST /servers/install)
    participant R as Runner + Registry

    N->>P: POST installServerFn {name, nodeId, pluginId, port, memoryMb, variables}
    P->>D: INSERT server (status: installing) + allocation
    P->>A: POST /servers/install {serverId, plugin, variables, installDir, allocation}
    A->>A: Validation synchrone (Zod : requête, plugin, variables)
    alt requête/plugin invalide
        A-->>P: 400 / 422 (détail)
        P->>D: DELETE server + allocation (rollback)
        P-->>N: erreur HttpError
    else accepté
        A-->>P: 202 { status: "installing" }
        P-->>N: { id } → redirect /servers/$serverId/console
        A->>R: startTrackedInstall (arrière-plan)
        R->>R: étape 1..N : téléchargements, scripts, écritures…
        R->>R: Registry : chaque étape + sortie des commandes STREAMÉE ligne par ligne
        Note over N,A: L'installation streame sur la console WS<br/>(mêmes socket/JWT que les logs runtime)
        loop WS direct (console)
            A-->>N: { type: "install-status", step, percent, error } (bannière)
            A-->>N: { type: "install-log", lines[] } (étapes=jaune, sortie=gris, erreurs=rouge)
        end
        R->>A: store.save(servers.json) si succès
        R-->>A: Registry: status "installed" (+ "failed", erreur à l'étape X sinon)
        N->>N: install-status terminal → getInstallStatusFn UNE FOIS (sync DB)<br/>→ invalidate ['server'] → console normale
        Note over N: en cas d'échec : bannière rouge + bouton « Réessayer »<br/>(retryInstallFn relance le même serverId)
    end
```

**Points clés**
- Le panel persiste **avant** d'appeler l'agent : l'utilisateur est redirigé immédiatement vers la console du serveur.
- La validation rapide (variables inconnues/invalides) est refusée **avant** le 202 → le formulaire affiche l'erreur et les lignes DB sont retirées.
- Un échec du runner (téléchargement 404, script en erreur…) n'est PAS une erreur HTTP : il apparaît dans le statut d'installation (`failed` + `error`), le store n'est pas modifié, la DB passe `install_failed`.
- **Pas de polling** en chemin nominal : les étapes et la sortie des commandes sont poussées par l'agent sur le socket console (`install-status` + `install-log`). `getInstallStatusFn` n'est appelé qu'**une fois** à la fin (statut terminal) pour synchroniser la DB (`installing → stopped / install_failed`).
- **Fallback** : si le WS n'est pas utilisable (proxy sans WS, origine refusée…), la page retombe sur le polling `GET /servers/:serverId/install` (panneau d'installation dédié).
- Logs d'installation (registry, en mémoire côté agent) : niveaux `step` (jaune), `info` (gris), `error` (rouge) ; la sortie des commandes est streamée **au fil de l'eau** — les réécritures `\r` (barres de progression type steamcmd) remplacent la ligne précédente au lieu de s'empiler, les lignes identiques consécutives sont fusionnées ; plafond 2000 lignes (dernières conservées).
- **Outils muets sur un pipe** : certains programmes console (steamcmd) n'impriment leur progression que sur un vrai terminal — sur un pipe ils restent silencieux. Une action `command` peut déclarer `tail` (`file` + `filter` regex + `intervalMs`) : l'agent tail le log écrit pendant l'exécution (ex : `logs/content_log.txt` de steamcmd) et streame les nouvelles lignes en direct.
- Une action `command` peut déclarer `successCodes` (codes de sortie traités comme succès) — steamcmd sort avec le code 7 après son auto-update (`Update complete, launching...`) alors que le job a réussi.
- Les logs d'installation vivent dans la mémoire de l'agent (registry) : perdus si l'agent redémarre, le statut DB reste `install_failed` avec bouton *Réessayer*. À la (re)connexion WS, une installation **en cours ou échouée** est rejouée (`install-log` + `reset`), une installation terminée ne l'est pas.

---

## 3. Console temps réel (navigateur ↔ agent en direct)

Deux modes : WS direct (chemin nominal) ou polling via le panel (fallback si WS impossible).

```mermaid
sequenceDiagram
    participant N as Navigateur (XtermConsole)
    participant P as Panel (createConsoleTokenFn)
    participant A as Agent (WS /servers/:id/ws)

    N->>P: POST createConsoleTokenFn(serverId)
    P->>P: signConsoleToken (JWT HS256, clé = token du node, TTL 300 s)
    P-->>N: { token, wsUrl }
    N->>A: WebSocket ouvert (SANS auth dans l'URL)
    N->>A: { type: "auth", token }
    A->>A: vérifie signature, aud, scope, exp, serverId, permissions
    A-->>N: { type: "auth-ok" }
    A-->>N: { type: "log", lines[] } (streaming live)
    A-->>N: { type: "status", status } (running/stopped/crashed)
    opt installation en cours ou échouée (dernière connue)
        A-->>N: { type: "install-status", ... } + { type: "install-log", lines[], reset: true } (rejeu du trail)
    end

    Note over N,A: Commandes et actions power en direct
    N->>A: { type: "command", command: "stop" } (stdin du process)
    N->>A: { type: "power", action: "restart" }

    Note over N,A: Installation = même socket : étapes et sortie poussées en direct
    A-->>N: { type: "install-status", status, step, percent, error } (bannière)
    A-->>N: { type: "install-log", lines[], replace } (logs, progress \r en place)

    Note over N,A: Refresh du token AVANT expiration (re-auth sans reconnexion)
    N->>P: POST createConsoleTokenFn (nouveau JWT)
    N->>A: { type: "auth", token }
    A-->>N: { type: "auth-ok" }
```

**Fallback polling** (WS indisponible : proxy sans WS, agent vieux, origine refusée — 3 tentatives max) :

```mermaid
sequenceDiagram
    participant N as Navigateur
    participant P as Panel (getServerLogsFn)
    participant A as Agent

    loop polling incrémental
        N->>P: GET getServerLogsFn(serverId, after=N)
        P->>A: GET /servers/:serverId/logs?after=N (Bearer)
        A-->>P: { lines[], next, status }
        P-->>N: lignes ajoutées au terminal (curseur next)
    end
```

En mode dégradé, une installation en cours bascule aussi sur le polling : le panneau d'installation dédié (`getInstallStatusFn` → `GET /servers/:serverId/install`) remplace la console.

**Sécurité console**
- JWT court (300 s), rafraîchi par re-`auth` — jamais de token dans l'URL/query string.
- `scope: websocket`, `serverId` verrouillé sur le paramètre de route WS.
- Chaque message est re-vérifié (permissions + expiration) ; l'agent peut rate-limiter (`error: rate-limited`).
- L'origine du navigateur est vérifiée par l'agent (`allowedOrigins`).

---

## 4. Actions power & commandes (chemin panel)

Quand le WS direct n'est pas actif, les actions passent par des server functions (même validation de propriétaire côté panel, même Bearer côté agent) :

```mermaid
sequenceDiagram
    participant N as Navigateur
    participant P as Panel (serverActionFn / sendCommandFn)
    participant A as Agent

    N->>P: POST serverActionFn { serverId, action: start|stop|restart|kill }
    P->>P: loadOwnedServer (propriétaire ou admin)
    P->>A: POST /servers/:serverId/action { action } (Bearer)
    A-->>P: { status } (sync DB)
    P-->>N: { action, status }
    N->>N: invalidate ['server', serverId]
```

`kill` force-passe le verrou du serveur (un process coincé reste tuable, comme wings). Les erreurs agent sont mappées : `not_found` → 404, conflit d'état → 409.

---

## 5. Réinstallation (Paramètres → console)

Même runner que l'installation, mais **en place** : arrêt du serveur, dossier et allocation conservés, plugin **à jour** envoyé par le panel.

```mermaid
sequenceDiagram
    participant N as Navigateur (Paramètres)
    participant P as Panel (reinstallServerFn)
    participant D as Postgres
    participant A as Agent
    participant R as Runner + Registry

    N->>N: confirm() (« fichiers peuvent être supprimés… »)
    N->>P: POST reinstallServerFn(serverId)
    P->>D: SELECT server, plugin (JSON à jour), variables
    P->>A: POST /servers/:serverId/reinstall { plugin, variables }
    A->>A: validation Zod + serveur connu + pas d'install en cours
    A-->>P: 202 { status: "installing" }
    P->>D: UPDATE server.status = installing
    P-->>N: redirect → console (panneau d'installation)
    A->>R: arrière-plan : STOP du process si running, puis runner
    Note over N,R: Le suivi est identique au flux d'installation<br/>(console WS : install-status + install-log, cf. §2)
    R->>A: store.save (plugin/variables mis à jour) si succès
```

**Serveur inconnu côté agent** — le store de l'agent (`servers.json`) n'est écrit qu'en cas de **succès** d'installation. Une installation échouée (ou un dataDir agent perdu) laisse donc la DB panel et le store agent désynchronisés, et `/reinstall` répond 404. Le panel gère ce cas : sur 404, `reinstallServerFn` retombe sur une **installation complète** (`POST /servers/install`) reconstruite depuis la DB (plugin courant, variables, allocation, `installDir` = `servers/<uuid>`).

---

## 6. Édition des variables (page Variables)

La page `/servers/$serverId/variables` (ex-« Démarrage ») édite les variables du plugin
après l'installation. La **DB panel est la source de vérité** (colonne `server.variables`) ;
l'agent ne garde qu'un **cache** (`servers.json`) utilisé au start. Comme wings tire sa
config du panel à chaque démarrage alors que l'agent mojito ne peut pas appeler le panel
(pas de credentials), c'est le panel qui **pousse** la sync au moment de la sauvegarde —
indispensable aussi parce qu'un start peut être déclenché directement par le navigateur
via le WS console, sans passer par le panel.

```mermaid
sequenceDiagram
    participant N as Navigateur (Variables)
    participant P as Panel (updateServerVariablesFn)
    participant D as Postgres
    participant A as Agent (POST /variables)

    N->>P: POST updateServerVariablesFn { serverId, variables (record complet) }
    P->>P: loadOwnedServer + merge : seules les variables userEditable<br/>acceptent les nouvelles valeurs (les autres gardent leur valeur)
    P->>P: re-validation des règles du plugin (validateVariableValue du contract :<br/>required, min/max, pattern, options) → 422 sinon
    P->>A: POST /servers/:serverId/variables { variables } (Bearer)
    alt agent ne connaît pas le serveur (404)
        P->>D: UPDATE server.variables (l'agent rattrapera à la prochaine install complète)
    else agent injoignable / erreur
        P-->>N: 502 — rien n'est écrit (pas de divergence DB ↔ cache)
    else OK
        A->>A: re-validation (règles du plugin stocké) + refus si install en cours (409)
        A->>A: fusion + store.save(servers.json)
        P->>D: UPDATE server.variables
        P-->>N: toast succès — « appliquées au prochain démarrage »
    end
```

**Points clés**
- Validation en **trois couches** qui partagent la même fonction du contract :
  schéma de formulaire (TanStack Form, messages mappés par champ), server function (422),
  agent (422). Aucune divergence possible entre les règles.
- Les nouvelles valeurs s'appliquent au **prochain start** (résolution du templating,
  env au spawn, provisioning des outils `java`/`steamcmd`) — un process en cours garde
  son environnement d'origine.
- Les variables `userViewable && !userEditable` s'affichent en lecture seule ;
  les non-viewables restent dans le record mais ne sont pas éditables.
- La commande de démarrage résolue est affichée en lecture seule : les variables du
  plugin sont substituées en direct (valeur courante > default), les variables système
  (`{{SERVER_…}}`) restent littérales — seul l'agent peut les résoudre.

---

## 7. Cycle de vie d'un serveur (statuts)

```mermaid
stateDiagram-v2
    [*] --> installing : création / réinstallation
    installing --> stopped : runner terminé
    installing --> install_failed : échec du runner
    install_failed --> installing : « Réessayer » (retryInstallFn)
    stopped --> running : start
    running --> stopped : stop/restart
    running --> crashed : exit non propre
    crashed --> running : auto-restart (anti crash-loop 60 s)
    crashed --> stopped : arrêt manuel
```

- Le statut **DB** est synchronisé par les server functions (`getServerFn` interroge l'agent et corrige la DB ; `getInstallStatusFn` suit l'installation).
- L'agent connaît un état runtime plus fin (`offline/starting/running/stopping`) mappé vers les 5 statuts panel.

---

## 8. Référence des routes

### Panel ↔ Agent (Bearer token du node — `AGENT_ROUTES`)

| Route | Usage |
|---|---|
| `GET /health` | Public — healthcheck (version, uptime) |
| `POST /servers/install` | Démarre une installation (202) — validation sync 400/422 |
| `POST /servers/:serverId/reinstall` | Réinstalle en place (202, arrête le serveur d'abord) |
| `GET /servers/:serverId/install` | Statut d'installation + logs (sync fin d'install + fallback polling) |
| `POST /servers/:serverId/variables` | Sync du cache de variables (fusion + re-validation, refus si install en cours) — cf. §6 |
| `GET /servers` | Liste des serveurs de l'agent |
| `GET /servers/:serverId` | Info runtime (statut, logs récents) |
| `GET /servers/:serverId/logs?after=N` | Logs incrémentaux (fallback console) |
| `POST /servers/:serverId/action` | start / stop / restart / kill |
| `POST /servers/:serverId/command` | Commande stdin |
| `DELETE /servers/:serverId` | Suppression (refus si install ou process actif) |
| `GET /servers/:serverId/ws` | Console navigateur — JWT console (voir §3) |

### Navigateur ↔ Agent (WS console, JWT)

| Message (→ agent) | Message (← agent) |
|---|---|
| `{ type: "auth", token }` | `{ type: "auth-ok" }` |
| `{ type: "command", command }` | `{ type: "log", lines[] }` (runtime) |
| `{ type: "power", action }` | `{ type: "status", status }` |
| | `{ type: "install-status", status, step, totalSteps, percent, message, error }` |
| | `{ type: "install-log", lines[], reset, replace }` — `reset` = rejeu complet (effacer la console), `replace` = réécriture `\r` (progress), niveaux `step`/`info`/`error` |
| | `{ type: "error", code }` |

### Server functions exposées au navigateur (`packages/panel/src/server/functions/`)

| Fonction | Méthode | Rôle |
|---|---|---|
| `installServerFn` | POST | Créer + démarrer l'installation |
| `getInstallStatusFn` | GET | Statut/logs d'installation (sync fin d'install + fallback polling) |
| `retryInstallFn` | POST | Relancer une installation échouée |
| `listServersFn` | GET | Liste (admin : tout, sinon les siens) |
| `getServerFn` | GET | Détail + sync runtime + logs |
| `getServerLogsFn` | GET | Logs incrémentaux (fallback console) |
| `createConsoleTokenFn` | POST | JWT console + wsUrl |
| `serverActionFn` | POST | start/stop/restart/kill |
| `sendCommandFn` | POST | Commande stdin via panel |
| `reinstallServerFn` | POST | Réinstallation en place |
| `updateServerVariablesFn` | POST | Édition des variables (merge userEditable + sync agent) — cf. §6 |
| `deleteServerFn` | POST | Suppression (agent + DB) |
