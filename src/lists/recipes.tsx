import { Link } from '@tanstack/react-router';
import { Download, Pencil, RefreshCw } from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { defineList, expr, field } from '~/lists/define';

/**
 * /admin/recipes — every recipe imported in the panel (Pelican "Eggs").
 *
 * One definition for the whole page: the columns below are what the table
 * renders AND what the query may filter/sort on. Filtering, sorting and
 * pagination run in the database; the previous version loaded every recipe and
 * filtered the kind client-side. The recipe kind lives ONLY in the JSON payload
 * (`json->>'type'`), hence the raw fragment target.
 */

/** Row of the admin recipes list (what the server function returns). */
export interface AdminRecipeRow {
  id: string;
  name: string;
  slug: string;
  type: 'app' | 'runtime';
  variableCount: number;
  updateUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Row actions of the admin recipes list, supplied by the page. */
export interface AdminRecipesContext {
  importing: boolean;
  deleting: boolean;
  onUpdateFromUrl: (url: string) => void;
  onExport: (recipe: AdminRecipeRow) => void;
  onDelete: (recipe: AdminRecipeRow) => void;
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
          <Link
            to="/admin/recipes/$recipeId"
            params={{ recipeId: recipe.id }}
            className="font-medium hover:underline"
          >
            {recipe.name}
          </Link>
          <p className="text-xs text-muted-foreground">{recipe.slug}</p>
        </div>
      ),
    },
    type: {
      header: 'Type',
      cell: (recipe) => (
        <Badge variant={recipe.type === 'runtime' ? 'default' : 'secondary'}>
          {recipe.type === 'runtime' ? 'Runtime' : 'Application'}
        </Badge>
      ),
      // The kind lives only in the JSON payload: equality on the JSON path.
      filter: {
        control: 'choice',
        target: expr(`"r"."json"->>'type'`),
        options: [
          { value: 'app', label: 'Application' },
          { value: 'runtime', label: 'Runtime' },
        ],
      },
    },
    variables: {
      header: 'Variables',
      cell: (recipe) => <span className="text-muted-foreground">{recipe.variableCount}</span>,
    },
    updateUrl: {
      header: 'Mise à jour',
      cell: (recipe) =>
        recipe.updateUrl ? (
          <span
            className="block max-w-xs truncate text-xs text-muted-foreground"
            title={recipe.updateUrl}
          >
            {recipe.updateUrl}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    updatedAt: {
      header: 'Modifiée le',
      sort: field('updatedAt'),
      cell: (recipe) => (
        <span className="text-muted-foreground">
          {recipe.updatedAt.toLocaleDateString('fr-FR')}
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
      cell: (recipe, context) => (
        <div className="flex justify-end gap-1">
          {recipe.updateUrl && (
            <Button
              variant="ghost"
              size="sm"
              title="Re-importer depuis l'URL de mise à jour"
              disabled={context.importing}
              onClick={() => context.onUpdateFromUrl(recipe.updateUrl as string)}

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
            Supprimer
          </Button>
        </div>
      ),
    },
  },
});
