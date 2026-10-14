import { useState, type FormEvent, type ReactNode } from 'react';
import type { ZodError } from 'zod';
import { parseRuntimeRecipe } from '~/contract';
import { Button } from '~/components/ui/button';

/**
 * Raw-JSON editor for runtime recipes: a textarea + client-side
 * validation against runtimeRecipeSchema. A runtime recipe is a technical
 * artifact authored as JSON (install steps + exports); the app-form editor
 * does not apply to it. Used by the edit page AND the creation page.
 */

/** Skeleton of a new runtime recipe — the required fields are filled in as JSON. */
export function emptyRuntimeRecipeJson(): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      type: 'runtime',
      id: '',
      name: '',
      author: '',
      tags: [],
      features: [],
      requires: [],
      variables: [],
      install: [],
    },
    null,
    2,
  );
}

export function RuntimeJsonEditor({
  title,
  initialJson,
  headerActions,
  onSave,
}: {
  title: string;
  initialJson: string;
  /** Extra header actions (export, delete… — the edit page's header). */
  headerActions?: ReactNode;
  /** Receives the normalized, validated runtime JSON. */
  onSave: (json: string) => Promise<void>;
}) {
  const [json, setJson] = useState(initialJson);
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
      await onSave(normalized);
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
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-xs text-muted-foreground">
            Runtime (v1) — édition JSON brut, validation à l'enregistrement.
          </p>
        </div>
        <div className="flex gap-2">
          {headerActions}
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
