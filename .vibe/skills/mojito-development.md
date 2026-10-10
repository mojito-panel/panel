# Mojito Panel Development SKILL

Patterns, conventions et best practices pour développer dans le monorepo Mojito Panel.
Inspiré du skill custodia (même stack : TanStack Start + MikroORM + better-auth + Postgres).

## Table of Contents

1. [Project Structure](#project-structure)
2. [Database Patterns (Postgres + MikroORM + better-auth)](#database-patterns)
3. [Backend Layer Patterns](#backend-layer-patterns)
4. [Frontend Layer Patterns](#frontend-layer-patterns)
5. [Feature Implementation Checklist](#feature-implementation-checklist)
6. [Common Pitfalls & Solutions](#common-pitfalls--solutions)

---

## Project Structure

```
packages/panel/
├── src/
│   ├── server.ts          # Entrypoint serveur custom (TanStack Start) — migrations au boot
│   ├── db/
│   │   ├── entities.ts    # TOUTES les entités MikroORM (better-auth + métier)
│   │   ├── types.ts       # Types inférés (IUser, INode, ...)
│   │   ├── index.ts       # Config MikroORM + migrations bundlées (import.meta.glob)
│   │   └── migrations/    # Migrations MikroORM (générées par le CLI)
│   ├── lib/
│   │   ├── auth.ts        # better-auth (pg Pool + mapping snake_case)
│   │   └── auth-client.ts # Client better-auth (navigateur)
│   ├── validators/        # Schémas Zod (loginSchema, registerSchema, ...)
│   ├── server/functions/  # Server functions TanStack Start (getSession, servers, ...)
│   ├── server/session.ts  # requireUser() / requireAdmin() / HttpError
│   ├── components/        # UI (shadcn) + app-sidebar.tsx
│   ├── contexts/          # AuthProvider, useAuth
│   └── routes/            # TanStack Router file-based (dossiers)
├── scripts/
│   └── promote-admin.mjs  # Passe un user en admin (pg)
├── mikro-orm.config.ts    # Config CLI MikroORM (migration:create)
└── tests/                 # Vitest
```

---

## Database Patterns

**MikroORM gère TOUTES les tables** — y compris les tables better-auth
(`user`, `session`, `account`, `verification`). Il n'y a PAS de CLI better-auth
(`auth:migrate` n'existe plus).

### Schéma partagé better-auth ↔ MikroORM

- Les entités better-auth sont définies dans `src/db/entities.ts` (comme custodia).
- better-auth est configuré avec un **DATABASE MAPPING** snake_case dans
  `src/lib/auth.ts` (`user.fields`, `session.fields`, `account.fields`,
  `verification.fields`) pour écrire dans les mêmes colonnes que MikroORM.
- MikroORM v7 convertit camelCase → snake_case par défaut (naming strategy) ;
  le mapping better-auth doit couvrir **tous** les champs, y compris `idToken`
  (`idToken: 'id_token'`), sinon better-auth crie "Missing columns".

### Migrations au démarrage

- `src/server.ts` (entrypoint custom TanStack Start, détecté automatiquement) :
  `initOrm()` puis `orm.migrator.up()` au boot.
- Les migrations sont **bundlées** via `import.meta.glob('../migrations/Migration*')`
  + `migrationsList` dans `src/db/index.ts` (marche en dev et en build).
- `snapshot: false` — pas de snapshot MikroORM (évite les migrations "up-to-date"
  fantômes après une purge de la base).

### Ajouter un champ à une entité

1. Modifier l'entité dans `src/db/entities.ts`.
2. Si c'est une entité better-auth : ajouter le mapping dans `src/lib/auth.ts`.
3. Générer la migration : `npm run db:migrate -w @mojito/panel`
   (purger la base + supprimer `src/migrations/` si besoin d'une migration initiale propre).
4. Redémarrer le serveur — `migrator.up()` applique la migration au boot.

### Naming Conventions

- **Entités** : PascalCase, singulier (`Node`, `Plugin`, `Server`)
- **Champs** : camelCase en TS, snake_case en DB (via `.fieldName()` ou le naming strategy)
- **Tables** : snake_case (`server_allocation`)

---

## Backend Layer Patterns

### Server functions (`src/server/functions/*.ts`)

```typescript
import { createServerFn } from '@tanstack/react-start';
import { requireUser } from '~/server/session';
import { getOrm } from '~/db';

export const listServers = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser();
  const orm = getOrm();
  return orm.em.find(Server, { ownerId: user.id });
});
```

**Best Practices** :
- Auth via `requireUser()` / `requireAdmin()` (`src/server/session.ts`), jamais de check manuel
- Erreurs via `HttpError(status, message)`
- L'ORM s'obtient via `getOrm()` (initialisé au boot par `src/server.ts`)
- Valider les entrées avec les schémas Zod de `src/validators/`

### Validators (`src/validators/*.ts`)

```typescript
import { z } from 'zod';

export const createServerSchema = z.strictObject({
  name: z.string().min(2),
  nodeId: z.string(),
  pluginId: z.string(),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type CreateServerDto = z.infer<typeof createServerSchema>;
```

**Best Practices** :
- `z.strictObject()` pour refuser les champs inconnus
- Toujours exporter le type inféré avec le suffixe `Dto`
- Pas de `z.coerce`/`z.default()` dans les schémas de formulaires (incompatibles TanStack Form)

---

## Frontend Layer Patterns

### Formulaires (TanStack Form + Zod)

```typescript
const form = useForm({
  validators: { onChange: createServerSchema },
  defaultValues: { name: '', nodeId: '', pluginId: '', variables: {} },
  onSubmit: ({ value }) => mutation.mutate(value),
});
```

**Best Practices** :
- JAMAIS de `useState` pour les champs de formulaire
- Toujours fournir des `defaultValues` (handle `undefined`)
- Mutations via `useMutation`, invalider le cache query après succès
- `queryClient.invalidateQueries({ queryKey: ['auth'] })` après login/register/signOut

### Session

- Fetchée en SSR dans `beforeLoad` de `__root.tsx` via `queryClient.fetchQuery({ queryKey: ['auth'] })`
- Layout protégé `_app.tsx` : `SidebarProvider` + `AppSidebar` + guard redirect `/login`

---

## Feature Implementation Checklist

### Database & Types
- [ ] Ajouter le champ dans `src/db/entities.ts`
- [ ] Si entité better-auth : ajouter le mapping dans `src/lib/auth.ts`
- [ ] Générer la migration (`npm run db:migrate -w @mojito/panel`)
- [ ] Redémarrer le serveur (migrations au boot)

### Backend
- [ ] Schéma Zod dans `src/validators/`
- [ ] Server function dans `src/server/functions/`
- [ ] Auth via `requireUser()`/`requireAdmin()`

### Frontend
- [ ] Formulaire TanStack Form + mutation
- [ ] Route dans `src/routes/` (dossiers)
- [ ] Invalidation du cache query

### Testing
- [ ] `npm test` passe
- [ ] `npm run typecheck -w @mojito/panel` (0 erreur nouvelle)

---

## Common Pitfalls & Solutions

### 1. `orm.schema.update()` supprime les tables better-auth

**Problem** : MikroORM v7 drop par défaut les tables qu'il ne connaît pas.

**Solution** : Ne JAMAIS utiliser `schema.update()`. MikroORM gère toutes les
tables (y compris better-auth) via les migrations (`orm.migrator.up()` au boot).

### 2. Migration "No changes required, schema is up-to-date" sur une base vide

**Problem** : le snapshot MikroORM (`src/migrations/.snapshot-*.json`) fait croire
au CLI que le schéma est à jour.

**Solution** : Supprimer `src/migrations/` (migration + snapshot) et purger la
base avant de générer une migration initiale.

### 3. better-auth "Missing columns: account.idToken"

**Problem** : MikroORM nomme la colonne `id_token` (snake_case), better-auth
cherche `idToken`.

**Solution** : Le mapping `account.fields` dans `src/lib/auth.ts` doit couvrir
**tous** les champs, y compris `idToken: 'id_token'`.

### 4. Le migrator ne trouve pas les migrations au boot

**Problem** : le path par défaut diffère entre le CLI et le runtime.

**Solution** : Les migrations sont bundlées via `import.meta.glob` +
`migrationsList` dans `src/db/index.ts` — pas de path à résoudre.

### 5. `field.state.value is undefined` dans les formulaires

**Solution** : Toujours fournir des `defaultValues` et utiliser le optional chaining :
`field.state.value?.includes(x) || false`

### 6. Circular imports

- Validators n'importent pas depuis services
- Services n'importent pas depuis functions
- Components importent depuis functions, pas depuis services

---

## Code Style Guidelines

1. **Naming** : descriptif, domaine métier
2. **Imports** : groupés par source (react, tanstack, local `~/`)
3. **Messages utilisateur** : français (comme le codebase)
4. **Commentaires** : uniquement pour les invariants non évidents
5. **TypeScript** : `erasableSyntaxOnly` — pas de parameter properties, enums, namespaces
6. **Visibilité** : champs privés avec `#`, jamais `private`/`public`/`protected`
7. **React 19** : pas de `useCallback`/`useMemo`/`forwardRef` (React Compiler)

---

## Useful Commands

```bash
# Démarrer Postgres (docker)
docker compose -f docker-compose.dev.yml up -d

# Panel (dev) — migrations MikroORM au boot (src/server.ts)
npm run dev -w @mojito/panel

# Générer une migration MikroORM
npm run db:migrate -w @mojito/panel

# Appliquer les migrations (manuel, le boot le fait déjà)
npm run db:migrate:up -w @mojito/panel

# Passer un user en admin
node packages/panel/scripts/promote-admin.mjs contact@ste4d.net

# Tests + typecheck
npm test
npm run typecheck -w @mojito/panel
```
