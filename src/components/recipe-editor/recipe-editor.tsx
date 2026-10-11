import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from '@tanstack/react-form';
import { AlertTriangle, Save } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import {
  findUnknownVariablesInEditorValue,
  recipeEditorSchema,
  type RecipeEditorValue,
} from '~/validators/recipe-editor';
import { ConfigurationTab } from './tab-configuration';
import { ProcessTab } from './tab-process';
import { VariablesTab } from './tab-variables';
import { InstallTab } from './tab-install';

/**
 * Pelican-style recipe (egg) editor — one TanStack Form, 4 tabs:
 * Configuration / Démarrage / Variables / Installation.
 * The page container (max-width) is owned by AppShell; routes only
 * provide the initial value and the submit handler.
 */

/** Single editor form instance — typed once, shared by the tab components. */
function useRecipeForm(initial: RecipeEditorValue, onSubmit: (value: RecipeEditorValue) => void) {
  return useForm({
    defaultValues: initial,
    validators: { onChange: recipeEditorSchema },
    onSubmit: ({ value }) => onSubmit(value),
  });
}

export type RecipeForm = ReturnType<typeof useRecipeForm>;

export function RecipeEditor({
  title,
  initial,
  onSubmit,
  submitPending,
  submitError,
  headerActions,
}: {
  title: string;
  initial: RecipeEditorValue;
  /** Receives the validated editor value (contract-valid recipe built by the caller). */
  onSubmit: (value: RecipeEditorValue) => void;
  submitPending: boolean;
  submitError: string | null;
  /** Extra header actions (delete, export… — Pelican's EditEgg header). */
  headerActions?: ReactNode;
}) {
  const form = useRecipeForm(initial, onSubmit);
  const [attempted, setAttempted] = useState(false);

  const save = () => {
    setAttempted(true);
    void form.handleSubmit();
  };

  // Ctrl+S / Cmd+S — same key binding as Pelican's egg editor
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [form]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {headerActions}
          <Button onClick={save} disabled={submitPending}>
            <Save />
            {submitPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>

      {submitError && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {submitError}
        </p>
      )}

      {/* Validation summary — only after a save attempt (errors may live in another tab) */}
      {attempted && (
        <form.Subscribe selector={(s) => s.errorMap.onChange}>
          {(rawErrors) => {
            const fields =
              (rawErrors as { fields?: Record<string, ReadonlyArray<{ message?: string }>> } | undefined)
                ?.fields ?? {};
            const entries = Object.entries(fields).flatMap(([fieldName, issues]) =>
              issues.map((issue) => ({ fieldName, message: issue.message })),
            );
            if (entries.length === 0) return null;
            return (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="font-semibold">La recette contient des erreurs :</p>
                <ul className="mt-1 list-inside list-disc space-y-1">
                  {entries.slice(0, 20).map((entry) => (
                    <li key={`${entry.fieldName}-${entry.message}`}>
                      <span className="font-mono text-xs">{entry.fieldName}</span> :{' '}
                      {entry.message}
                    </li>
                  ))}
                </ul>
              </div>
            );
          }}
        </form.Subscribe>
      )}

      {/* Unknown {{VAR}} templates — same check the agent runs at install time */}
      <form.Subscribe selector={(s) => s.values}>
        {(values) => {
          const unknown = findUnknownVariablesInEditorValue(values);
          if (unknown.length === 0) return null;
          return (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                Variables utilisées dans les templates mais non déclarées :{' '}
                <span className="font-mono">{unknown.join(', ')}</span>. L'installation
                échouera — déclare-les dans l'onglet Variables ou l'environnement fixe.
              </p>
            </div>
          );
        }}
      </form.Subscribe>

      <Tabs defaultValue="configuration">
        <TabsList>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="process">Démarrage</TabsTrigger>
          <TabsTrigger value="variables">Variables</TabsTrigger>
          <TabsTrigger value="install">Installation</TabsTrigger>
        </TabsList>

        <TabsContent value="configuration" className="mt-4">
          <ConfigurationTab form={form} />
        </TabsContent>
        <TabsContent value="process" className="mt-4">
          <ProcessTab form={form} />
        </TabsContent>
        <TabsContent value="variables" className="mt-4">
          <VariablesTab form={form} />
        </TabsContent>
        <TabsContent value="install" className="mt-4">
          <InstallTab form={form} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
