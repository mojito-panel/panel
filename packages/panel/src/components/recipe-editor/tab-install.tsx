import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Switch } from '~/components/ui/switch';
import { Textarea } from '~/components/ui/textarea';
import { CollapseCard, FieldShell, ItemActions, KvRows, TagsInput } from './fields';
import type { RecipeForm } from './recipe-editor';
import { pairErrors } from './tab-configuration';
import {
  actionLabel,
  newActionValue,
  type ActionType,
  type ActionValue,
} from '~/validators/recipe-editor';

/**
 * Tab « Installation » — the declarative equivalent of Pelican's install
 * script: an ordered list of typed actions executed by the agent's runner.
 * Each action is a collapsible card; the type can be changed at any time.
 */

const ACTION_TYPES: ActionType[] = [
  'download',
  'extract',
  'write',
  'replace',
  'configFile',
  'command',
  'script',
];

/** Typed deep field names for `install[i]` (see tab-variables.tsx). */
function actionNames(index: number) {
  return {
    item: `install[${index}]` as const,
    action: `install[${index}].action` as const,
    url: `install[${index}].url` as const,
    dest: `install[${index}].dest` as const,
    checksum: `install[${index}].checksum` as const,
    headers: `install[${index}].headers` as const,
    archive: `install[${index}].archive` as const,
    stripComponents: `install[${index}].stripComponents` as const,
    file: `install[${index}].file` as const,
    content: `install[${index}].content` as const,
    find: `install[${index}].find` as const,
    replace: `install[${index}].replace` as const,
    regex: `install[${index}].regex` as const,
    parser: `install[${index}].parser` as const,
    configFind: `install[${index}].configFind` as const,
    command: `install[${index}].command` as const,
    cwd: `install[${index}].cwd` as const,
    env: `install[${index}].env` as const,
    timeoutMs: `install[${index}].timeoutMs` as const,
    successCodes: `install[${index}].successCodes` as const,
    tail: `install[${index}].tail` as const,
    tailFile: `install[${index}].tail.file` as const,
    tailFilter: `install[${index}].tail.filter` as const,
    tailIntervalMs: `install[${index}].tail.intervalMs` as const,
    shell: `install[${index}].shell` as const,
  };
}

type ActionNames = ReturnType<typeof actionNames>;

export function InstallTab({ form }: { form: RecipeForm }) {
  return (
    <form.Field name="install">
      {(field) => (
        <div className="space-y-3">
          {field.state.value.map((action, index) => (
            <ActionCard
              key={index}
              form={form}
              index={index}
              onMoveUp={index > 0 ? () => field.moveValue(index, index - 1) : undefined}
              onMoveDown={
                index < field.state.value.length - 1
                  ? () => field.moveValue(index, index + 1)
                  : undefined
              }
              onRemove={() => field.removeValue(index)}
            />
          ))}

          <div className="flex flex-wrap gap-2 pt-2">
            {ACTION_TYPES.map((type) => (
              <Button
                key={type}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => field.pushValue(newActionValue(type))}
              >
                + {actionLabel(type)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </form.Field>
  );
}

function ActionCard({
  form,
  index,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  form: RecipeForm;
  index: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
}) {
  const a = actionNames(index);

  return (
    <form.Subscribe selector={(s) => s.values.install[index]}>
      {(action) => (
        <CollapseCard
          title={action ? actionLabel(action.action) : 'Action'}
          subtitle={action?.file || action?.command || action?.url || undefined}
          badge={
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              #{index + 1}
            </span>
          }
          actions={
            <ItemActions onMoveUp={onMoveUp} onMoveDown={onMoveDown} onRemove={onRemove} />
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FieldShell id={`action-${index}-type`} label="Type d'action">
              <form.Field name={a.action}>
                {(typeField) => (
                  <Select
                    value={typeField.state.value}
                    onValueChange={(type) => {
                      // Switching the type resets the action's fields
                      const nextType = type as ActionType;
                      typeField.handleChange(nextType);
                      form.setFieldValue(a.item, newActionValue(nextType));
                    }}
                  >
                    <SelectTrigger id={`action-${index}-type`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTION_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {actionLabel(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </form.Field>
            </FieldShell>

            {action?.action === 'download' && (
              <>
                <form.Field name={a.url}>
                  {(urlField) => (
                    <FieldShell
                      id={`action-${index}-url`}
                      label="URL"
                      hint="Templating possible : {{MINECRAFT_VERSION}}."
                      errors={urlField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-url`}
                        className="font-mono"
                        value={urlField.state.value}
                        onChange={(e) => urlField.handleChange(e.target.value)}
                        onBlur={urlField.handleBlur}
                        placeholder="https://…/server-{{MC_VERSION}}.jar"
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <form.Field name={a.dest}>
                  {(destField) => (
                    <FieldShell
                      id={`action-${index}-dest`}
                      label="Destination"
                      errors={destField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-dest`}
                        className="font-mono"
                        value={destField.state.value}
                        onChange={(e) => destField.handleChange(e.target.value)}
                        onBlur={destField.handleBlur}
                        placeholder="server.jar"
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <form.Field name={a.checksum}>
                  {(checksumField) => (
                    <FieldShell
                      id={`action-${index}-checksum`}
                      label="SHA-256 (optionnel)"
                      hint="Vérifie l'intégrité du fichier téléchargé."
                      errors={checksumField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-checksum`}
                        className="font-mono"
                        value={checksumField.state.value}
                        onChange={(e) => checksumField.handleChange(e.target.value)}
                        onBlur={checksumField.handleBlur}
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <div className="md:col-span-2">
                  <KvSection
                    form={form}
                    name={a.headers}
                    label="En-têtes HTTP (optionnel)"
                    keyPlaceholder="Authorization"
                    valuePlaceholder="Bearer …"
                    addLabel="Ajouter un en-tête"
                  />
                </div>
              </>
            )}

            {action?.action === 'extract' && (
              <>
                <form.Field name={a.archive}>
                  {(archiveField) => (
                    <FieldShell
                      id={`action-${index}-archive`}
                      label="Archive"
                      errors={archiveField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-archive`}
                        className="font-mono"
                        value={archiveField.state.value}
                        onChange={(e) => archiveField.handleChange(e.target.value)}
                        onBlur={archiveField.handleBlur}
                        placeholder="pack.zip"
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <form.Field name={a.dest}>
                  {(destField) => (
                    <FieldShell
                      id={`action-${index}-dest`}
                      label="Destination"
                      errors={destField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-dest`}
                        className="font-mono"
                        value={destField.state.value}
                        onChange={(e) => destField.handleChange(e.target.value)}
                        onBlur={destField.handleBlur}
                        placeholder="."
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <form.Field name={a.stripComponents}>
                  {(stripField) => (
                    <FieldShell
                      id={`action-${index}-strip`}
                      label="Composants à retirer (0 = aucun)"
                      hint="Comme tar --strip-components."
                      errors={stripField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-strip`}
                        type="number"
                        value={String(stripField.state.value)}
                        onChange={(e) => stripField.handleChange(Number(e.target.value))}
                        onBlur={stripField.handleBlur}
                      />
                    </FieldShell>
                  )}
                </form.Field>
              </>
            )}

            {action?.action === 'write' && (
              <>
                <form.Field name={a.file}>
                  {(fileField) => (
                    <FieldShell
                      id={`action-${index}-file`}
                      label="Fichier"
                      errors={fileField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-file`}
                        className="font-mono"
                        value={fileField.state.value}
                        onChange={(e) => fileField.handleChange(e.target.value)}
                        onBlur={fileField.handleBlur}
                        placeholder="eula.txt"
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <div className="md:col-span-2">
                  <form.Field name={a.content}>
                    {(contentField) => (
                      <FieldShell
                        id={`action-${index}-content`}
                        label="Contenu"
                        hint="Templating possible : {{SERVER_NAME}}, {{SERVER_PORT}}…"
                        errors={contentField.state.meta.errors}
                      >
                        <Textarea
                          id={`action-${index}-content`}
                          rows={5}
                          className="font-mono"
                          value={contentField.state.value}
                          onChange={(e) => contentField.handleChange(e.target.value)}
                          onBlur={contentField.handleBlur}
                        />
                      </FieldShell>
                    )}
                  </form.Field>
                </div>
              </>
            )}

            {action?.action === 'replace' && (
              <>
                <form.Field name={a.file}>
                  {(fileField) => (
                    <FieldShell
                      id={`action-${index}-file`}
                      label="Fichier"
                      errors={fileField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-file`}
                        className="font-mono"
                        value={fileField.state.value}
                        onChange={(e) => fileField.handleChange(e.target.value)}
                        onBlur={fileField.handleBlur}
                        placeholder="server.properties"
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <form.Field name={a.find}>
                  {(findField) => (
                    <FieldShell
                      id={`action-${index}-find`}
                      label="À trouver"
                      errors={findField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-find`}
                        className="font-mono"
                        value={findField.state.value}
                        onChange={(e) => findField.handleChange(e.target.value)}
                        onBlur={findField.handleBlur}
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <form.Field name={a.replace}>
                  {(replaceField) => (
                    <FieldShell
                      id={`action-${index}-replace`}
                      label="Remplacer par"
                      errors={replaceField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-replace`}
                        className="font-mono"
                        value={replaceField.state.value}
                        onChange={(e) => replaceField.handleChange(e.target.value)}
                        onBlur={replaceField.handleBlur}
                        placeholder="{{SERVER_PORT}}"
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <form.Field name={a.regex}>
                  {(regexField) => (
                    <div className="flex items-center gap-3">
                      <Switch
                        id={`action-${index}-regex`}
                        checked={regexField.state.value}
                        onCheckedChange={(checked) => regexField.handleChange(checked)}
                      />
                      <Label htmlFor={`action-${index}-regex`}>À trouver = regex</Label>
                    </div>
                  )}
                </form.Field>
              </>
            )}

            {action?.action === 'configFile' && (
              <>
                <form.Field name={a.file}>
                  {(fileField) => (
                    <FieldShell
                      id={`action-${index}-file`}
                      label="Fichier"
                      errors={fileField.state.meta.errors}
                    >
                      <Input
                        id={`action-${index}-file`}
                        className="font-mono"
                        value={fileField.state.value}
                        onChange={(e) => fileField.handleChange(e.target.value)}
                        onBlur={fileField.handleBlur}
                        placeholder="server.properties"
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <form.Field name={a.parser}>
                  {(parserField) => (
                    <FieldShell
                      id={`action-${index}-parser`}
                      label="Parser"
                      errors={parserField.state.meta.errors}
                    >
                      <Select
                        value={parserField.state.value}
                        onValueChange={(parser) =>
                          parserField.handleChange(parser as ActionValue['parser'])
                        }
                      >
                        <SelectTrigger id={`action-${index}-parser`} className="w-full">
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
                  <KvSection
                    form={form}
                    name={a.configFind}
                    label="Clés à modifier (clé → valeur)"
                    keyPlaceholder="server-port"
                    valuePlaceholder="{{SERVER_PORT}}"
                    addLabel="Ajouter une clé"
                  />
                </div>
              </>
            )}

            {(action?.action === 'command' || action?.action === 'script') && (
              <>
                {action.action === 'command' ? (
                  <div className="md:col-span-2">
                    <form.Field name={a.command}>
                      {(commandField) => (
                        <FieldShell
                          id={`action-${index}-command`}
                          label="Commande"
                          hint="Exécutée sur le node, dans le dossier d'installation."
                          errors={commandField.state.meta.errors}
                        >
                          <Textarea
                            id={`action-${index}-command`}
                            rows={2}
                            className="font-mono"
                            value={commandField.state.value}
                            onChange={(e) => commandField.handleChange(e.target.value)}
                            onBlur={commandField.handleBlur}
                            placeholder=".bin/steamcmd/steamcmd.exe +force_install_dir . +login anonymous +app_update 2450700 validate"
                          />
                        </FieldShell>
                      )}
                    </form.Field>
                  </div>
                ) : (
                  <>
                    <form.Field name={a.shell}>
                      {(shellField) => (
                        <FieldShell
                          id={`action-${index}-shell`}
                          label="Shell"
                          errors={shellField.state.meta.errors}
                        >
                          <Select
                            value={shellField.state.value}
                            onValueChange={(shell) =>
                              shellField.handleChange(shell as ActionValue['shell'])
                            }
                          >
                            <SelectTrigger id={`action-${index}-shell`} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="powershell">powershell</SelectItem>
                              <SelectItem value="cmd">cmd</SelectItem>
                              <SelectItem value="bash">bash</SelectItem>
                            </SelectContent>
                          </Select>
                        </FieldShell>
                      )}
                    </form.Field>

                    <div className="md:col-span-2">
                      <form.Field name={a.content}>
                        {(contentField) => (
                          <FieldShell
                            id={`action-${index}-content`}
                            label="Script"
                            hint="Fallback ouvert pour tout ce que les actions déclaratives ne couvrent pas."
                            errors={contentField.state.meta.errors}
                          >
                            <Textarea
                              id={`action-${index}-content`}
                              rows={8}
                              className="font-mono"
                              value={contentField.state.value}
                              onChange={(e) => contentField.handleChange(e.target.value)}
                              onBlur={contentField.handleBlur}
                            />
                          </FieldShell>
                        )}
                      </form.Field>
                    </div>
                  </>
                )}

                {action.action === 'command' && (
                  <>
                    <form.Field name={a.cwd}>
                      {(cwdField) => (
                        <FieldShell
                          id={`action-${index}-cwd`}
                          label="Dossier de travail"
                          hint="Vide = dossier d'installation."
                          errors={cwdField.state.meta.errors}
                        >
                          <Input
                            id={`action-${index}-cwd`}
                            className="font-mono"
                            value={cwdField.state.value}
                            onChange={(e) => cwdField.handleChange(e.target.value)}
                            onBlur={cwdField.handleBlur}
                          />
                        </FieldShell>
                      )}
                    </form.Field>

                    <KvSection
                      form={form}
                      name={a.env}
                      label="Environnement supplémentaire"
                      keyPlaceholder="HOME"
                      valuePlaceholder="C:\\servers"
                      addLabel="Ajouter une variable"
                    />

                    <form.Field name={a.timeoutMs}>
                      {(timeoutField) => (
                        <FieldShell
                          id={`action-${index}-timeout`}
                          label="Timeout (ms)"
                          hint="0 = aucun timeout."
                          errors={timeoutField.state.meta.errors}
                        >
                          <Input
                            id={`action-${index}-timeout`}
                            type="number"
                            value={String(timeoutField.state.value)}
                            onChange={(e) => timeoutField.handleChange(Number(e.target.value))}
                            onBlur={timeoutField.handleBlur}
                          />
                        </FieldShell>
                      )}
                    </form.Field>

                    <form.Field name={a.successCodes}>
                      {(codesField) => (
                        <FieldShell
                          id={`action-${index}-success-codes`}
                          label="Codes de sortie acceptés"
                          hint="Ex : 7 pour steamcmd (auto-update réussi). Vide = 0."
                          errors={codesField.state.meta.errors}
                        >
                          <TagsInput
                            id={`action-${index}-success-codes`}
                            value={codesField.state.value}
                            onChange={codesField.handleChange}
                            onBlur={codesField.handleBlur}
                            placeholder="0, 7"
                          />
                        </FieldShell>
                      )}
                    </form.Field>

                    <div className="md:col-span-2">
                      <TailSection form={form} names={a} index={index} />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </CollapseCard>
      )}
    </form.Subscribe>
  );
}

/** Progression en direct : l'agent suit un fichier de log pendant la commande. */
function TailSection({
  form,
  names,
  index,
}: {
  form: RecipeForm;
  names: ActionNames;
  index: number;
}) {
  return (
    <form.Field name={names.tail}>
      {(tailField) => (
        <div className="space-y-3 rounded-md border p-4">
          <div className="flex items-center gap-3">
            <Switch
              id={`action-${index}-tail-enabled`}
              checked={tailField.state.value !== null}
              onCheckedChange={(checked) =>
                tailField.handleChange(
                  checked ? { file: '', filter: '', intervalMs: 0 } : null,
                )
              }
            />
            <Label htmlFor={`action-${index}-tail-enabled`} className="text-sm font-medium">
              Progression en direct (suivi d'un fichier de log)
            </Label>
          </div>

          {tailField.state.value !== null && (
            <div className="grid gap-4 md:grid-cols-3">
              <form.Field name={names.tailFile}>
                {(fileField) => (
                  <FieldShell
                    id={`action-${index}-tail-file`}
                    label="Fichier de log"
                    hint="Relatif au dossier d'installation."
                    errors={fileField.state.meta.errors}
                  >
                    <Input
                      id={`action-${index}-tail-file`}
                      className="font-mono"
                      value={fileField.state.value ?? ''}
                      onChange={(e) => fileField.handleChange(e.target.value)}
                      onBlur={fileField.handleBlur}
                    />
                  </FieldShell>
                )}
              </form.Field>

              <form.Field name={names.tailFilter}>
                {(filterField) => (
                  <FieldShell
                    id={`action-${index}-tail-filter`}
                    label="Filtre (regex)"
                    hint="Vide = toutes les lignes."
                    errors={filterField.state.meta.errors}
                  >
                    <Input
                      id={`action-${index}-tail-filter`}
                      className="font-mono"
                      value={filterField.state.value ?? ''}
                      onChange={(e) => filterField.handleChange(e.target.value)}
                      onBlur={filterField.handleBlur}
                    />
                  </FieldShell>
                )}
              </form.Field>

              <form.Field name={names.tailIntervalMs}>
                {(intervalField) => (
                  <FieldShell
                    id={`action-${index}-tail-interval`}
                    label="Intervalle de poll (ms)"
                    hint="0 = défaut (1000)."
                    errors={intervalField.state.meta.errors}
                  >
                    <Input
                      id={`action-${index}-tail-interval`}
                      type="number"
                      value={String(intervalField.state.value ?? 0)}
                      onChange={(e) => intervalField.handleChange(Number(e.target.value))}
                      onBlur={intervalField.handleBlur}
                    />
                  </FieldShell>
                )}
              </form.Field>
            </div>
          )}
        </div>
      )}
    </form.Field>
  );
}

/** Key/value rows with row-level error mapping (headers, config keys, env…). */
function KvSection({
  form,
  name,
  label,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  form: RecipeForm;
  name: `install[${number}].headers` | `install[${number}].configFind` | `install[${number}].env`;
  label: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
}) {
  return (
    <form.Field name={name}>
      {(field) => (
        <FieldShell id={`kv-${label}`} label={label} errors={field.state.meta.errors}>
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
                keyPlaceholder={keyPlaceholder}
                valuePlaceholder={valuePlaceholder}
                addLabel={addLabel}
                errors={pairErrors(name, errorFields)}
              />
            )}
          </form.Subscribe>
        </FieldShell>
      )}
    </form.Field>
  );
}
