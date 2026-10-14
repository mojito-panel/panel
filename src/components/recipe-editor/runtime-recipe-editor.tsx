import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from '@tanstack/react-form';
import { AlertTriangle, Save } from 'lucide-react';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { Button } from '~/components/ui/button';
import { TabsCard, CardSection } from '~/components/tabs-card';
import {
  findUnknownVariablesInEditorValue,
  runtimeEditorSchema,
  type RecipeEditorValue,
} from '~/validators/recipe-editor';
import { FieldShell, KvRows, TagsInput } from './fields';
import type { RecipeForm } from './recipe-editor';
import { VariablesTab } from './tab-variables';
import { InstallTab } from './tab-install';
import { pairErrors } from './tab-configuration';

/**
 * Form editor for RUNTIME recipes (v1, type "runtime"): identity, required
 * runtimes, variables, install steps and exports. Same shape and shared
 * tabs as the app editor (Variables, Installation) — a runtime simply has
 * no start/logs/backup, and gains the export section (PATH + env).
 */

/** Single runtime editor form instance — typed once, shared by the tabs. */
function useRuntimeForm(initial: RecipeEditorValue, onSubmit: (value: RecipeEditorValue) => void) {
  return useForm({
    defaultValues: initial,
    validators: { onChange: runtimeEditorSchema },
    onSubmit: ({ value }) => onSubmit(value),
  });
}

/**
 * TanStack infers the form's error-map types from the onChange schema, so
 * the runtime form type is "unrelated" to the app RecipeForm even though
 * both carry the SAME editor value and behave identically — the shared
 * tabs (Variables, Installation) receive it through a structural cast.
 */
export type RuntimeForm = ReturnType<typeof useRuntimeForm>;

export function RuntimeRecipeEditor({
  title,
  initial,
  onSubmit,
  submitPending,
  submitError,
  headerActions,
}: {
  title: string;
  initial: RecipeEditorValue;
  /** Receives the validated editor value (runtime JSON built by the caller). */
  onSubmit: (value: RecipeEditorValue) => void;
  submitPending: boolean;
  submitError: string | null;
  /** Extra header actions (delete, export… — Pelican's EditEgg header). */
  headerActions?: ReactNode;
}) {
  const form = useRuntimeForm(initial, onSubmit);
  const [attempted, setAttempted] = useState(false);

  const save = () => {
    setAttempted(true);
    void form.handleSubmit();
  };

  // Ctrl+S / Cmd+S — same key binding as the app editor
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
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-xs text-muted-foreground">
            Runtime — outil installé dans le .bin du serveur avant l'application.
          </p>
        </div>
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
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
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

      <TabsCard
        defaultValue="configuration"
        tabs={[
          { value: 'configuration', label: 'Configuration', content: <RuntimeConfigurationTab form={form} /> },
          {
            value: 'variables',
            label: 'Variables',
            content: <VariablesTab form={form as unknown as RecipeForm} />,
          },
          {
            value: 'install',
            label: 'Installation',
            content: <InstallTab form={form as unknown as RecipeForm} />,
          },
          { value: 'export', label: 'Export', content: <ExportTab form={form} /> },
        ]}
      />
    </div>
  );
}

/**
 * Tab « Configuration » of a runtime recipe — identity, features, required
 * runtimes and host requirements. No runtime host constraints / fixed env /
 * backups here: those are app-only fields of the contract.
 */
function RuntimeConfigurationTab({ form }: { form: RuntimeForm }) {
  return (
    <div className="divide-y">
      <CardSection
        title="Identité"
        description="Nom, auteur et description de la recette runtime."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <form.Field name="id">
            {(field) => (
              <FieldShell
                id="runtime-id"
                label="ID (slug)"
                hint="Minuscules, chiffres et tirets — unique. C'est cet ID que les recettes app utilisent dans « requires »."
                errors={field.state.meta.errors}
              >
                <Input
                  id="runtime-id"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="java"
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="name">
            {(field) => (
              <FieldShell id="runtime-name" label="Nom" errors={field.state.meta.errors}>
                <Input
                  id="runtime-name"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Java (Microsoft Build of OpenJDK)"
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="author">
            {(field) => (
              <FieldShell id="runtime-author" label="Auteur" errors={field.state.meta.errors}>
                <Input
                  id="runtime-author"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="steader@example.com"
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="updateUrl">
            {(field) => (
              <FieldShell
                id="runtime-update-url"
                label="URL de mise à jour"
                hint="Permet le re-import de la recette depuis le panel."
                errors={field.state.meta.errors}
              >
                <Input
                  id="runtime-update-url"
                  type="url"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="https://…/recipe.json"
                />
              </FieldShell>
            )}
          </form.Field>

          <div className="md:col-span-2">
            <form.Field name="description">
              {(field) => (
                <FieldShell
                  id="runtime-description"
                  label="Description"
                  errors={field.state.meta.errors}
                >
                  <Textarea
                    id="runtime-description"
                    rows={2}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FieldShell>
              )}
            </form.Field>
          </div>

          <form.Field name="tags">
            {(field) => (
              <FieldShell
                id="runtime-tags"
                label="Tags"
                hint="Séparés par des virgules."
                errors={field.state.meta.errors}
              >
                <TagsInput
                  id="runtime-tags"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="java, jdk, runtime"
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="features">
            {(field) => (
              <FieldShell
                id="runtime-features"
                label="Features"
                hint="Flags à la Pelican (descriptifs — un runtime n'a pas de features d'outils)."
                errors={field.state.meta.errors}
              >
                <TagsInput
                  id="runtime-features"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="eula"
                />
              </FieldShell>
            )}
          </form.Field>
        </div>
      </CardSection>

      <CardSection
        title="Runtimes requis"
        description="Autres recettes runtime installées avant celle-ci (leurs exports sont disponibles)."
      >
        <form.Field name="requires">
          {(field) => (
            <FieldShell
              id="runtime-requires"
              label="IDs des runtimes dépendances"
              hint="Ex : java pour un runtime qui a besoin d'un JDK."
              errors={field.state.meta.errors}
            >
              <TagsInput
                id="runtime-requires"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                placeholder="java"
              />
            </FieldShell>
          )}
        </form.Field>
      </CardSection>

      <CardSection
        title="Prérequis"
        description="Refusés par l'agent si la machine ne convient pas (0 = aucun)."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <form.Field name="requirements.minRamMb">
            {(field) => (
              <FieldShell id="runtime-min-ram" label="RAM minimale (Mo)" errors={field.state.meta.errors}>
                <Input
                  id="runtime-min-ram"
                  type="number"
                  value={String(field.state.value)}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                  onBlur={field.handleBlur}
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="requirements.minDiskMb">
            {(field) => (
              <FieldShell id="runtime-min-disk" label="Disque minimal (Mo)" errors={field.state.meta.errors}>
                <Input
                  id="runtime-min-disk"
                  type="number"
                  value={String(field.state.value)}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                  onBlur={field.handleBlur}
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="requirements.minCpuPercent">
            {(field) => (
              <FieldShell id="runtime-min-cpu" label="CPU minimal (%)" errors={field.state.meta.errors}>
                <Input
                  id="runtime-min-cpu"
                  type="number"
                  value={String(field.state.value)}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                  onBlur={field.handleBlur}
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="requirements.requiredCommands">
            {(field) => (
              <FieldShell
                id="runtime-required-commands"
                label="Commandes requises"
                hint="Exécutables qui doivent exister sur l'hôte, séparés par des virgules."
                errors={field.state.meta.errors}
              >
                <TagsInput
                  id="runtime-required-commands"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="curl"
                />
              </FieldShell>
            )}
          </form.Field>
        </div>
      </CardSection>
    </div>
  );
}

/**
 * Tab « Export » — what the runtime exports to the app and the runtimes
 * that depend on it: its directory on PATH (default) and fixed env
 * (templated with its own variables — {{RUNTIME_DIR}} points at its dir).
 */
function ExportTab({ form }: { form: RuntimeForm }) {
  return (
    <div className="divide-y">
      <CardSection
        title="Export"
        description="Environnement transmis à l'application et aux runtimes dépendants."
      >
        <div className="space-y-4">
          <form.Field name="exportPath">
            {(field) => (
              <div className="flex items-center gap-3">
                <Switch
                  id="runtime-export-path"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  onBlur={field.handleBlur}
                />
                <div>
                  <Label htmlFor="runtime-export-path">Ajouter le dossier au PATH</Label>
                  <p className="text-xs text-muted-foreground">
                    Les binaires du runtime vivent à la racine de son dossier (ex : java.exe).
                  </p>
                </div>
              </div>
            )}
          </form.Field>

          <form.Field name="exportEnv">
            {(field) => (
              <FieldShell
                id="runtime-export-env"
                label="Variables exportées"
                hint="Ex : JAVA_HOME → {{RUNTIME_DIR}}. Injectées à l'installation et au démarrage du serveur."
                errors={field.state.meta.errors}
              >
                <form.Subscribe
                  selector={(s) =>
                    (s.errorMap.onChange as { fields?: Record<string, readonly unknown[]> } | undefined)
                      ?.fields ?? {}
                  }
                >
                  {(errorFields) => (
                    <KvRows
                      pairs={field.state.value}
                      onChange={field.handleChange}
                      keyPlaceholder="JAVA_HOME"
                      valuePlaceholder="{{RUNTIME_DIR}}"
                      addLabel="Ajouter une variable exportée"
                      errors={pairErrors('exportEnv', errorFields)}
                    />
                  )}
                </form.Subscribe>
              </FieldShell>
            )}
          </form.Field>
        </div>
      </CardSection>
    </div>
  );
}
