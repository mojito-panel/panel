import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Download, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { ZodError } from 'zod';
import { parseRecipe, parseRuntimeRecipe, isRuntimeRecipeJson } from '~/contract';
import { getRecipeFn, updateRecipeFn, deleteRecipeFn } from '~/server/functions/admin';
import { Button } from '~/components/ui/button';
import { RecipeEditor } from '~/components/recipe-editor/recipe-editor';
import {
  recipeEditorValueToRecipe,
  recipeToEditorValue,
  type RecipeEditorValue,
} from '~/validators/recipe-editor';

export const Route = createFileRoute('/admin/recipes/$recipeId/')({
  component: EditRecipePage,
});

function EditRecipePage() {
  const { recipeId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const getRecipe = useServerFn(getRecipeFn);
  const updateRecipe = useServerFn(updateRecipeFn);
  const deleteRecipe = useServerFn(deleteRecipeFn);

  const query = useQuery({
    queryKey: ['recipe', recipeId],
    queryFn: () => getRecipe({ data: { recipeId } }),
  });

  const update = useMutation({
    mutationFn: async (value: RecipeEditorValue) => {
      const { recipe, issues } = recipeEditorValueToRecipe(value);
      if (!recipe) {
        throw new Error(`Recette invalide : ${(issues ?? []).join(' · ')}`);
      }
      return updateRecipe({ data: { recipeId, json: JSON.stringify(recipe, null, 2) } });
    },
    onSuccess: async () => {
      // List only — ['recipe'] is NOT invalidated so the form keeps its state
      await queryClient.invalidateQueries({ queryKey: ['recipes'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteRecipe({ data: { recipeId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['recipes'] });
      await navigate({ to: '/admin/recipes' });
    },
  });

  if (query.isPending) {
    return <p className="text-muted-foreground">Chargement de la recette…</p>;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
        <Button variant="ghost" render={<Link to="/admin/recipes" />}>
          ← Recettes
        </Button>
      </div>
    );
  }

  /** Export: downloads the stored JSON (Pelican's ExportEggAction). */
  const exportRecipe = () => {
    const blob = new Blob([query.data?.json ?? ''], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recipe-${query.data?.slug ?? 'export'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const headerActions = (
    <>
      <Button
        variant="outline"
        onClick={() => void exportRecipe()}
        title="Exporter le JSON de la recette"
      >
        <Download />
        Exporter
      </Button>
      <Button
        variant="destructive"
        disabled={remove.isPending}
        onClick={() => {
          if (confirm(`Supprimer la recette « ${query.data?.name} » ?`)) {
            remove.mutate();
          }
        }}
      >
        <Trash2 />
        Supprimer
      </Button>
    </>
  );

  // Runtime recipes (v3) have no start/backup and a runtime-specific export
  // section — the form editor is app-shaped, so they edit as raw JSON
  // (validated client-side against the runtime schema, revalidated by the
  // server on save).
  const parsed: unknown = JSON.parse(query.data.json);
  if (isRuntimeRecipeJson(parsed)) {
    return (
      <RuntimeJsonEditor
        key={`${query.data.id}-${query.dataUpdatedAt}`}
        title={query.data.name}
        initialJson={query.data.json}
        headerActions={headerActions}
        onSave={async (json: string) => {
          await updateRecipe({ data: { recipeId, json } });
          await queryClient.invalidateQueries({ queryKey: ['recipes'] });
        }}
      />
    );
  }

  // Stored JSON → contract recipe (defaults applied) → editor value.
  // The whole page remounts via `key` when the server data changes.
  const initial = recipeToEditorValue(parseRecipe(parsed));

  return (
    <RecipeEditor
      key={`${query.data.id}-${query.dataUpdatedAt}`}
      title={query.data.name}
      initial={initial}
      onSubmit={(value) => update.mutate(value)}
      submitPending={update.isPending}
      submitError={update.isError ? update.error.message : null}
      headerActions={headerActions}
    />
  );
}

/**
 * Raw-JSON editor for runtime recipes (v3): a textarea + client-side
 * validation against runtimeRecipeSchema. A runtime recipe is a technical
 * artifact authored as JSON (install steps + exports); the app-form editor
 * does not apply to it.
 */
function RuntimeJsonEditor(props: {
  title: string;
  initialJson: string;
  headerActions: ReactNode;
  onSave: (json: string) => Promise<void>;
}) {
  const [json, setJson] = useState(props.initialJson);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    try {
      // Pretty-print what the server will store — same shape as the export.
      const validated = parseRuntimeRecipe(JSON.parse(json));
      const normalized = JSON.stringify(validated, null, 2);
      setSaving(true);
      await props.onSave(normalized);
      setJson(normalized);
    } catch (err) {
      if (err instanceof Error && 'issues' in err) {
        const zerr = err as unknown as ZodError;
        setError(
          zerr.issues.map((i) => `${i.path.join('.') || 'runtime'} : ${i.message}`).join(' · '),
        );
      } else {
        setError((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{props.title}</h1>
          <p className="text-xs text-muted-foreground">
            Runtime (v3) — édition JSON brut, validation à l'enregistrement.
          </p>
        </div>
        <div className="flex gap-2">
          {props.headerActions}
          <Button type="submit" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
        className="h-[60vh] w-full rounded-md border bg-background p-3 font-mono text-xs"
      />
    </form>
  );
}
