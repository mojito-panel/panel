import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { FieldShell, KvRows, TagsInput } from './fields';
import type { PluginForm } from './plugin-editor';

/**
 * Tab « Configuration » — identity, features and host requirements.
 * `runtime` (KeyValue) replaces Pelican's `docker_images`: no Docker here,
 * the constraints are checked by the agent on the host (e.g. java → >=21).
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

export function ConfigurationTab({ form }: { form: PluginForm }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identité</CardTitle>
          <CardDescription>Nom, auteur et description du plugin.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <form.Field name="id">
            {(field) => (
              <FieldShell
                id="plugin-id"
                label="ID (slug)"
                hint="Minuscules, chiffres et tirets — unique."
                errors={field.state.meta.errors}
              >
                <Input
                  id="plugin-id"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="mon-plugin"
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="name">
            {(field) => (
              <FieldShell id="plugin-name" label="Nom" errors={field.state.meta.errors}>
                <Input
                  id="plugin-name"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Mon super plugin"
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="author">
            {(field) => (
              <FieldShell id="plugin-author" label="Auteur" errors={field.state.meta.errors}>
                <Input
                  id="plugin-author"
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
                id="plugin-update-url"
                label="URL de mise à jour"
                hint="Permet le re-import du plugin depuis le panel."
                errors={field.state.meta.errors}
              >
                <Input
                  id="plugin-update-url"
                  type="url"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="https://…/plugin.json"
                />
              </FieldShell>
            )}
          </form.Field>

          <div className="md:col-span-2">
            <form.Field name="description">
              {(field) => (
                <FieldShell
                  id="plugin-description"
                  label="Description"
                  errors={field.state.meta.errors}
                >
                  <Textarea
                    id="plugin-description"
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
                id="plugin-tags"
                label="Tags"
                hint="Séparés par des virgules."
                errors={field.state.meta.errors}
              >
                <TagsInput
                  id="plugin-tags"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="minecraft, java"
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="features">
            {(field) => (
              <FieldShell
                id="plugin-features"
                label="Features"
                hint="Flags à la Pelican (eula, java_version…), séparés par des virgules."
                errors={field.state.meta.errors}
              >
                <TagsInput
                  id="plugin-features"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="eula, java_version"
                />
              </FieldShell>
            )}
          </form.Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runtime hôte</CardTitle>
          <CardDescription>
            Contraintes vérifiées par l'agent avant installation/démarrage
            (équivalent des images Docker de Pelican).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form.Field name="runtime">
            {(field) => (
              <FieldShell
                id="plugin-runtime"
                label="Outils requis (outil → contrainte)"
                hint="Ex : java → « >=21 ». Les outils embarqués (.bin/java) comptent aussi."
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
                      keyPlaceholder="java"
                      valuePlaceholder=">=21"
                      addLabel="Ajouter un outil"
                      errors={pairErrors('runtime', errorFields)}
                    />
                  )}
                </form.Subscribe>
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="env">
            {(field) => (
              <FieldShell
                id="plugin-env"
                label="Environnement fixe"
                hint="Variables injectées au spawn — utilisables dans les templates {{VAR}}."
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prérequis</CardTitle>
          <CardDescription>
            Refusés par l'agent si la machine ne convient pas (0 = aucun).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <form.Field name="requirements.minRamMb">
            {(field) => (
              <FieldShell id="plugin-min-ram" label="RAM minimale (Mo)" errors={field.state.meta.errors}>
                <Input
                  id="plugin-min-ram"
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
              <FieldShell id="plugin-min-disk" label="Disque minimal (Mo)" errors={field.state.meta.errors}>
                <Input
                  id="plugin-min-disk"
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
              <FieldShell id="plugin-min-cpu" label="CPU minimal (%)" errors={field.state.meta.errors}>
                <Input
                  id="plugin-min-cpu"
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
                id="plugin-required-commands"
                label="Commandes requises"
                hint="Exécutables qui doivent exister sur l'hôte, séparés par des virgules."
                errors={field.state.meta.errors}
              >
                <TagsInput
                  id="plugin-required-commands"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="java, curl"
                />
              </FieldShell>
            )}
          </form.Field>
        </CardContent>
      </Card>
    </div>
  );
}
