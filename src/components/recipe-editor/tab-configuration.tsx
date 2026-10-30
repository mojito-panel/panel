import { CardSection } from '~/components/tabs-card';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Textarea } from '~/components/ui/textarea';
import { newStartConfigValue, type StartConfigValue } from '~/validators/recipe-editor';

import { CollapseCard, FieldShell, ItemActions, KvRows, TagsInput } from './fields';
import type { RecipeForm } from './recipe-editor';

/**
 * Tab « Configuration » of a recipe — identity, type (app/runtime),
 * required runtimes, runtime export, fixed env, pre-start config files
 * and backups.
 */

/** Row-level errors of a key/value list (`prefix[i].key` from the form errorMap). */
export function pairErrors(
  prefix: string,
  fields: Record<string, readonly unknown[]>,
): Record<number, readonly unknown[]> {
  const map: Record<number, readonly unknown[]> = {};
  const pattern = new RegExp(
    `^${prefix.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}\\[(\\d+)\\]\\.key$`,
  );
  for (const [fieldName, issues] of Object.entries(fields)) {
    const match = fieldName.match(pattern);
    if (match) map[Number(match[1])] = issues;
  }
  return map;
}

export function ConfigurationTab({ form }: { form: RecipeForm }) {
  return (
    <div className="divide-y">
      <CardSection title="Identité" description="Nom, auteur et description de la recette.">
        <div className="grid gap-4 md:grid-cols-2">
          <form.Field name="recipeType">
            {(field) => (
              <FieldShell
                id="recipe-type"
                label="Type de recette"
                hint="app = serveur de jeu · runtime = outil installé dans le .bin des apps qui le requièrent (java, steamcmd…)."
                errors={field.state.meta.errors}
              >
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as 'app' | 'runtime')}
                >
                  <SelectTrigger id="recipe-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="app">Serveur de jeu (app)</SelectItem>
                    <SelectItem value="runtime">Runtime (outil)</SelectItem>
                  </SelectContent>
                </Select>
              </FieldShell>
            )}
          </form.Field>

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
        title="Runtimes requis"
        description="Runtimes (outils) installés dans le .bin du serveur avant les étapes de la recette — java, steamcmd… Le panel résout le graphe et pousse les recettes runtime à chaque installation."
      >
        <form.Field name="requires">
          {(field) => (
            <FieldShell
              id="recipe-requires"
              label="IDs des runtimes requis"
              hint="IDs (slugs) des recettes runtime, séparés par des virgules. Un runtime peut en exiger un autre."
              errors={field.state.meta.errors}
            >
              <TagsInput
                id="recipe-requires"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                placeholder="steamcmd, java"
              />
            </FieldShell>
          )}
        </form.Field>
      </CardSection>

      <form.Subscribe selector={(s) => s.values.recipeType}>
        {(recipeType) =>
          recipeType === 'runtime' && (
            <CardSection
              title="Export runtime"
              description="Ce que le runtime exporte à ses dépendants (la recette app et les autres runtimes) : PATH et variables d'environnement. RUNTIME_DIR pointe vers le dossier du runtime."
            >
              <form.Field name="exportPath">
                {(field) => (
                  <FieldShell
                    id="recipe-export-path"
                    label="Dossier ajouté au PATH"
                    hint="Dossier (relatif au dossier du runtime) dont les exécutables sont préfixés au PATH des étapes et du spawn — « bin » pour un home JRE (java.exe dans <home>\\bin), « . » pour des binaires à la racine (steamcmd). Vide = aucun ajout."
                    errors={field.state.meta.errors}
                  >
                    <Input
                      id="recipe-export-path"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="bin"
                    />
                  </FieldShell>
                )}
              </form.Field>
              <form.Field name="exportEnv">
                {(field) => (
                  <FieldShell
                    id="recipe-export-env"
                    label="Variables exportées"
                    hint="Ex : JAVA_HOME → {{RUNTIME_DIR}}."
                    errors={field.state.meta.errors}
                  >
                    <form.Subscribe
                      selector={(s) =>
                        (
                          s.errorMap.onChange as
                            | { fields?: Record<string, readonly unknown[]> }
                            | undefined
                        )?.fields ?? {}
                      }
                    >
                      {(errorFields) => (
                        <KvRows
                          pairs={field.state.value}
                          onChange={field.handleChange}
                          keyPlaceholder="JAVA_HOME"
                          valuePlaceholder="{{RUNTIME_DIR}}"
                          addLabel="Ajouter un export"
                          errors={pairErrors('exportEnv', errorFields)}
                        />
                      )}
                    </form.Subscribe>
                  </FieldShell>
                )}
              </form.Field>
            </CardSection>
          )
        }
      </form.Subscribe>

      {/* App-only sections — a runtime recipe has no fixed env (its
          exports are the export block), no pre-start config files (it is
          never started) and no backups (its .bin dir lives inside the
          app's and is always excluded). */}
      <form.Subscribe selector={(s) => s.values.recipeType}>
        {(recipeType) =>
          recipeType === 'app' && (
            <>
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
                          (
                            s.errorMap.onChange as
                              | { fields?: Record<string, readonly unknown[]> }
                              | undefined
                          )?.fields ?? {}
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
                title="Configuration au démarrage"
                description="Fichiers de configuration ré-appliqués AVANT chaque démarrage (même mécanique que les eggs Pelican) : les clés déclarées sont mises à jour, le reste du fichier est conservé, un fichier absent est créé. Les modifications de variables arrivent donc dans le jeu au prochain démarrage, sans réinstallation."
              >
                <form.Field name="start.configs" mode="array">
                  {(field) => (
                    <div className="space-y-3">
                      {field.state.value.map((_, index) => (
                        <form.Subscribe key={index} selector={(s) => s.values.start.configs[index]}>
                          {(config) => (
                            <CollapseCard
                              title={config?.file || 'Fichier de configuration'}
                              subtitle={config?.parser}
                              badge={
                                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                                  #{index + 1}
                                </span>
                              }
                              actions={
                                <ItemActions
                                  onMoveUp={
                                    index > 0 ? () => field.moveValue(index, index - 1) : undefined
                                  }
                                  onMoveDown={
                                    index < field.state.value.length - 1
                                      ? () => field.moveValue(index, index + 1)
                                      : undefined
                                  }
                                  onRemove={() => field.removeValue(index)}
                                />
                              }
                            >
                              <div className="grid gap-4 md:grid-cols-2">
                                <form.Field name={`start.configs[${index}].file`}>
                                  {(fileField) => (
                                    <FieldShell
                                      id={`start-config-${index}-file`}
                                      label="Fichier"
                                      hint="Relatif à la racine du serveur."
                                      errors={fileField.state.meta.errors}
                                    >
                                      <Input
                                        id={`start-config-${index}-file`}
                                        className="font-mono"
                                        value={fileField.state.value}
                                        onChange={(e) => fileField.handleChange(e.target.value)}
                                        onBlur={fileField.handleBlur}
                                        placeholder="server.properties"
                                      />
                                    </FieldShell>
                                  )}
                                </form.Field>

                                <form.Field name={`start.configs[${index}].parser`}>
                                  {(parserField) => (
                                    <FieldShell
                                      id={`start-config-${index}-parser`}
                                      label="Parser"
                                      errors={parserField.state.meta.errors}
                                    >
                                      <Select
                                        value={parserField.state.value}
                                        onValueChange={(parser) =>
                                          parserField.handleChange(
                                            parser as StartConfigValue['parser'],
                                          )
                                        }
                                      >
                                        <SelectTrigger
                                          id={`start-config-${index}-parser`}
                                          className="w-full"
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="properties">properties</SelectItem>
                                          <SelectItem value="ini">ini</SelectItem>
                                          <SelectItem value="yaml">yaml</SelectItem>
                                          <SelectItem value="json">json</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </FieldShell>
                                  )}
                                </form.Field>

                                <div className="md:col-span-2">
                                  <form.Field name={`start.configs[${index}].find`}>
                                    {(findField) => (
                                      <FieldShell
                                        id={`start-config-${index}-find`}
                                        label="Clés à modifier (clé → valeur)"
                                        errors={findField.state.meta.errors}
                                      >
                                        <form.Subscribe
                                          selector={(s) =>
                                            (
                                              s.errorMap.onChange as
                                                | { fields?: Record<string, readonly unknown[]> }
                                                | undefined
                                            )?.fields ?? {}
                                          }
                                        >
                                          {(errorFields) => (
                                            <KvRows
                                              pairs={findField.state.value}
                                              onChange={findField.handleChange}
                                              keyPlaceholder="server-port"
                                              valuePlaceholder="{{SERVER_PORT}}"
                                              addLabel="Ajouter une clé"
                                              errors={pairErrors(
                                                `start.configs[${index}].find`,
                                                errorFields,
                                              )}
                                            />
                                          )}
                                        </form.Subscribe>
                                      </FieldShell>
                                    )}
                                  </form.Field>
                                </div>
                              </div>
                            </CollapseCard>
                          )}
                        </form.Subscribe>
                      ))}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => field.pushValue(newStartConfigValue())}
                      >
                        + Fichier de configuration
                      </Button>
                    </div>
                  )}
                </form.Field>
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
            </>
          )
        }
      </form.Subscribe>
    </div>
  );
}
