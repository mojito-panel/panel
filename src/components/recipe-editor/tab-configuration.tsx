import { CardSection } from '~/components/tabs-card';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { FieldShell, KvRows, TagsInput } from './fields';
import type { RecipeForm } from './recipe-editor';

/**
 * Tab « Configuration » of a recipe — identity, container image and
 * host requirements.
 */

/** Row-level errors of a key/value list (`prefix[i].key` from the form errorMap). */
export function pairErrors(
  prefix: string,
  fields: Record<string, readonly unknown[]>,
): Record<number, readonly unknown[]> {
  const map: Record<number, readonly unknown[]> = {};
  const pattern = new RegExp(`^${prefix.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}\\[(\\d+)\\]\\.key$`);
  for (const [fieldName, issues] of Object.entries(fields)) {
    const match = fieldName.match(pattern);
    if (match) map[Number(match[1])] = issues;
  }
  return map;
}

export function ConfigurationTab({ form }: { form: RecipeForm }) {
  return (
    <div className="divide-y">
      <CardSection
        title="Identité"
        description="Nom, auteur et description de la recette."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <form.Field name="id">
            {(field) => (
              <FieldShell
                id="recipe-id"
                label="ID (slug)"
                hint="Minuscules, chiffres et tirets — unique."
                errors={field.state.meta.errors}
              >
                <Input
                  id="recipe-id"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="ma-recette"
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="name">
            {(field) => (
              <FieldShell id="recipe-name" label="Nom" errors={field.state.meta.errors}>
                <Input
                  id="recipe-name"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Ma super recette"
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="author">
            {(field) => (
              <FieldShell id="recipe-author" label="Auteur" errors={field.state.meta.errors}>
                <Input
                  id="recipe-author"
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
                id="recipe-update-url"
                label="URL de mise à jour"
                hint="Permet le re-import de la recette depuis le panel."
                errors={field.state.meta.errors}
              >
                <Input
                  id="recipe-update-url"
                  type="url"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="https://…/recipe.json"
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="dockerImage">
            {(field) => (
              <FieldShell
                id="recipe-docker-image"
                label="Image Docker"
                hint="Image Windows (servercore) du conteneur du serveur — elle embarque les runtimes (java, steamcmd…)."
                errors={field.state.meta.errors}
              >
                <Input
                  id="recipe-docker-image"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="ghcr.io/mojito/servercore-java:latest"
                />
              </FieldShell>
            )}
          </form.Field>

          <div className="md:col-span-2">
            <form.Field name="description">
              {(field) => (
                <FieldShell
                  id="recipe-description"
                  label="Description"
                  errors={field.state.meta.errors}
                >
                  <Textarea
                    id="recipe-description"
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
                id="recipe-tags"
                label="Tags"
                hint="Séparés par des virgules."
                errors={field.state.meta.errors}
              >
                <TagsInput
                  id="recipe-tags"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="minecraft, java"
                />
              </FieldShell>
            )}
          </form.Field>
        </div>
      </CardSection>

      <CardSection
        title="Environnement fixe"
        description="Variables injectées au spawn du serveur — utilisables dans les templates {{VAR}}."
      >
        <form.Field name="env">
          {(field) => (
            <FieldShell
              id="recipe-env"
              label="Variables d'environnement"
              hint="Ex : SERVER_JARFILE → server.jar."
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
                    keyPlaceholder="SERVER_JARFILE"
                    valuePlaceholder="server.jar"
                    addLabel="Ajouter une variable"
                    errors={pairErrors('env', errorFields)}
                  />
                )}
              </form.Subscribe>
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
              <FieldShell id="recipe-min-ram" label="RAM minimale (Mo)" errors={field.state.meta.errors}>
                <Input
                  id="recipe-min-ram"
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
              <FieldShell id="recipe-min-disk" label="Disque minimal (Mo)" errors={field.state.meta.errors}>
                <Input
                  id="recipe-min-disk"
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
              <FieldShell id="recipe-min-cpu" label="CPU minimal (%)" errors={field.state.meta.errors}>
                <Input
                  id="recipe-min-cpu"
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
                id="recipe-required-commands"
                label="Commandes requises"
                hint="Exécutables qui doivent exister sur l'hôte, séparés par des virgules."
                errors={field.state.meta.errors}
              >
                <TagsInput
                  id="recipe-required-commands"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="java, curl"
                />
              </FieldShell>
            )}
          </form.Field>
        </div>
      </CardSection>

      <CardSection
        title="Sauvegardes"
        description="Motifs d'inclusion (globs relatifs à la racine du serveur) du contenu des sauvegardes. Vide = tout le serveur ; le dossier .bin de l'agent est toujours exclu."
      >
        <form.Field name="backup.include">
            {(field) => (
              <FieldShell
                id="recipe-backup-include"
                label="Contenu inclus"
                hint="Ex : world, plugins/*, *.properties — pas de « .. », pas de chemin absolu."
                errors={field.state.meta.errors}
              >
                <TagsInput
                  id="recipe-backup-include"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="world, plugins, server.properties"
                />
              </FieldShell>
            )}
          </form.Field>
      </CardSection>
    </div>
  );
}
