import { Link } from '@tanstack/react-router';
import { Download, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { RecipeSourceStatusBadge } from '~/components/recipe-source-status';
import { defineList, field } from '~/lists/define';
import { parseRecipeSource, type RecipeSourceStatus } from '~/lib/recipe-source';

/**
 * /admin/recipes — every recipe imported in the panel (Pelican "Eggs").
 *
 * One definition for the whole page: the columns below are what the table
 * renders AND what the query may filter/sort on. Filtering, sorting and
 * pagination run in the database.
 */

/** Row of the admin recipes list (what the server function returns). */
export interface AdminRecipeRow {
  id: string;
  name: string;
  slug: string;
  /** Recipe type — 'runtime' badges the row, null = a regular app recipe. */
  type: string | null;
  variableCount: number;
  /** Provenance — the stored source URL, or the recipe's own update_url. */
  sourceUrl: string | null;
  /** Update status relative to the source (~/lib/recipe-source). */
  sourceStatus: RecipeSourceStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Row actions of the admin recipes list, supplied by the page. */
export interface AdminRecipesContext {
  importing: boolean;
  deleting: boolean;
  updating: boolean;
  onUpdateFromSource: (recipe: AdminRecipeRow) => void;
  onExport: (recipe: AdminRecipeRow) => void;
  onDelete: (recipe: AdminRecipeRow) => void;
}

/** Compact display of a source URL — git fragments read as repo + path. */
function sourceLabel(sourceUrl: string): string {
  const source = parseRecipeSource(sourceUrl);
  if (!source) return sourceUrl;
  if (source.kind === 'direct') return source.url;
  return `${source.repoUrl} · ${source.path}`;
}

export const adminRecipesList = defineList<AdminRecipeRow, AdminRecipesContext>({
  name: 'admin-recipes',
  alias: 'r',
  defaultSort: { column: 'name', desc: false },
  searchTargets: ['name', 'slug'],
  columns: {
    name: {
      header: 'Recette',
      sort: field('name'),
      cell: (recipe) => (
        <div>
          <div className="flex items-center gap-2">
            <Link
              to="/admin/recipes/$recipeId"
              params={{ recipeId: recipe.id }}
              className="font-medium hover:underline"
            >
              {recipe.name}
            </Link>
            {recipe.type === 'runtime' && (
              <Badge variant="secondary" title="Recette d’exécution requise par d’autres recettes">
                Runtime
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{recipe.slug}</p>
        </div>
      ),
    },
    variables: {
      header: 'Variables',
      cell: (recipe) => <span className="text-muted-foreground">{recipe.variableCount}</span>,
    },
    source: {
      header: 'Source',
      cell: (recipe) =>
        recipe.sourceUrl ? (
          <span
            className="block max-w-xs truncate text-xs text-muted-foreground"
            title={recipe.sourceUrl}
          >
            {sourceLabel(recipe.sourceUrl)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    sourceStatus: {
      header: 'Mise à jour',
      // Display-only: the status is computed from the source columns at read
      // time (canonical hashes), so it has no SQL path to filter or sort on.
      cell: (recipe) => <RecipeSourceStatusBadge status={recipe.sourceStatus} />,
    },
    updatedAt: {
      header: 'Modifiée le',
      sort: field('updatedAt'),
      cell: (recipe) => (
        <span className="text-muted-foreground">
          {recipe.updatedAt.toLocaleString('fr-FR')}
        </span>
      ),
    },
    createdAt: {
      header: 'Créée le',
      sort: field('createdAt'),
      cell: (recipe) => (
        <span className="text-muted-foreground">
          {recipe.createdAt.toLocaleDateString('fr-FR')}
        </span>
      ),
    },
    actions: {
      header: '',
      pinned: true,
      cell: (recipe, context) =>
        // A picker renders this list without a page — nothing to act on.
        context === undefined ? null : (
        <div className="flex justify-end gap-1">
          {recipe.sourceUrl && (
            <Button
              variant="ghost"
              size="sm"
              title="Re-importer depuis la source"
              disabled={context.importing || context.updating}
              onClick={() => context.onUpdateFromSource(recipe)}
            >
              <RefreshCw />
              Mettre à jour
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/admin/recipes/$recipeId" params={{ recipeId: recipe.id }} />}
          >
            <Pencil />
            Éditer
          </Button>
          <Button variant="ghost" size="sm" onClick={() => context.onExport(recipe)}>
            <Download />
            Exporter
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={context.deleting}
            onClick={() => context.onDelete(recipe)}
          >
            <Trash2 />
            Supprimer
          </Button>
        </div>
      ),
    },
  },
});
