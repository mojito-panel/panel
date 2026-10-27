import { CardSection } from '~/components/tabs-card';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Switch } from '~/components/ui/switch';
import { STOP_SIGNALS, type StopSignal } from '~/contract';
import { FieldShell } from './fields';
import type { RecipeForm } from './recipe-editor';

/**
 * Tab « Démarrage » — Pelican's Process Management tab: startup command,
 * graceful stop, readiness detection (config.startup) and log config.
 */

export function ProcessTab({ form }: { form: RecipeForm }) {
  return (
    <div className="divide-y">
      <CardSection
        title="Commande de démarrage"
        description={
          <>
            Templating {'{{VAR}}'} : variables système &gt; variables du serveur &gt;{' '}
            defaults de la recette &gt; environnement fixe.
          </>
        }
      >
        <div className="space-y-4">
          <form.Field name="start.command">
            {(field) => (
              <FieldShell
                id="start-command"
                label="Commande"
                errors={field.state.meta.errors}
              >
                <textarea
                  id="start-command"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder={'{{SERVER_INSTALL_DIR}}/.bin/java -jar server.jar'}
                />
              </FieldShell>
            )}
          </form.Field>

          <form.Field name="start.workingDirectory">
            {(field) => (
              <FieldShell
                id="start-cwd"
                label="Dossier de travail"
                hint="Vide = dossier d'installation du serveur."
                errors={field.state.meta.errors}
              >
                <Input
                  id="start-cwd"
                  className="font-mono"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FieldShell>
            )}
          </form.Field>
        </div>
      </CardSection>

      <CardSection
        title="Arrêt gracieux"
        description="Envoyé avant un kill forcé après le délai : commande écrite sur le stdin du serveur, ou signal (SIGINT/SIGTERM/SIGKILL) envoyé au process."
      >
        <div className="space-y-4">
          <form.Field name="start.stop">
            {(field) => {
              const stop = field.state.value;
              return (
                <>
                  <FieldShell id="stop-mode" label="Mode d'arrêt">
                    <Select
                      value={stop === null ? 'none' : stop.type}
                      onValueChange={(mode) => {
                        if (mode === 'none') {
                          field.handleChange(null);
                        } else {
                          field.handleChange({
                            type: mode as 'command' | 'signal',
                            value: mode === 'signal' ? 'SIGTERM' : '',
                            timeoutMs: 30000,
                          });
                        }
                      }}
                    >
                      <SelectTrigger id="stop-mode" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Aucun (kill direct)</SelectItem>
                        <SelectItem value="command">Commande (ex : stop)</SelectItem>
                        <SelectItem value="signal">Signal (SIGINT/SIGTERM/SIGKILL)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldShell>

                  {stop !== null && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <form.Field name="start.stop.value">
                        {(valueField) => (
                          <FieldShell
                            id="stop-value"
                            label={stop.type === 'command' ? 'Commande d\u2019arrêt' : 'Signal'}
                            hint={
                              stop.type === 'signal'
                                ? 'SIGINT : Ctrl+C gracieux (serveurs à console) — SIGTERM : arrêt du process — SIGKILL : kill immédiat de l\u2019arbre.'
                                : undefined
                            }
                            errors={valueField.state.meta.errors}
                          >
                            {stop.type === 'signal' ? (
                              <Select
                                value={valueField.state.value as StopSignal}
                                onValueChange={(signal) => valueField.handleChange(signal)}
                              >
                                <SelectTrigger id="stop-value" className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {STOP_SIGNALS.map((signal) => (
                                    <SelectItem key={signal} value={signal}>
                                      {signal}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                id="stop-value"
                                className="font-mono"
                                value={valueField.state.value ?? ''}
                                onChange={(e) => valueField.handleChange(e.target.value)}
                                onBlur={valueField.handleBlur}
                                placeholder="stop"
                              />
                            )}
                          </FieldShell>
                        )}
                      </form.Field>

                      <form.Field name="start.stop.timeoutMs">
                        {(timeoutField) => (
                          <FieldShell
                            id="stop-timeout"
                            label="Délai avant kill forcé (ms)"
                            errors={timeoutField.state.meta.errors}
                          >
                            <Input
                              id="stop-timeout"
                              type="number"
                              value={String(timeoutField.state.value ?? 30000)}
                              onChange={(e) => timeoutField.handleChange(Number(e.target.value))}
                              onBlur={timeoutField.handleBlur}
                            />
                          </FieldShell>
                        )}
                      </form.Field>
                    </div>
                  )}
                </>
              );
            }}
          </form.Field>
        </div>
      </CardSection>

      <CardSection
        title="Détection de démarrage"
        description="Le serveur passe « running » quand une ligne de log correspond au pattern (équivalent du config.startup de Pelican)."
      >
        <div className="space-y-4">
          <form.Field name="start.ready">
            {(field) => (
              <>
                <div className="flex items-center gap-3">
                  <Switch
                    id="ready-enabled"
                    checked={field.state.value !== null}
                    onCheckedChange={(checked) =>
                      field.handleChange(checked ? { pattern: '', strip: '' } : null)
                    }
                  />
                  <label htmlFor="ready-enabled" className="text-sm font-medium">
                    Détecter quand le serveur est prêt
                  </label>
                </div>

                {field.state.value !== null && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <form.Field name="start.ready.pattern">
                      {(patternField) => (
                        <FieldShell
                          id="ready-pattern"
                          label="Pattern (regex)"
                          errors={patternField.state.meta.errors}
                        >
                          <Input
                            id="ready-pattern"
                            className="font-mono"
                            value={patternField.state.value ?? ''}
                            onChange={(e) => patternField.handleChange(e.target.value)}
                            onBlur={patternField.handleBlur}
                            placeholder="Done \\([0-9.]+s\\)! For help"
                          />
                        </FieldShell>
                      )}
                    </form.Field>

                    <form.Field name="start.ready.strip">
                      {(stripField) => (
                        <FieldShell
                          id="ready-strip"
                          label="À retirer avant matching (regex)"
                          hint="Couleurs ANSI, timestamps…"
                          errors={stripField.state.meta.errors}
                        >
                          <Input
                            id="ready-strip"
                            className="font-mono"
                            value={stripField.state.value ?? ''}
                            onChange={(e) => stripField.handleChange(e.target.value)}
                            onBlur={stripField.handleBlur}
                          />
                        </FieldShell>
                      )}
                    </form.Field>
                  </div>
                )}
              </>
            )}
          </form.Field>
        </div>
      </CardSection>

      <CardSection
        title="Logs"
        description="Source des logs affichés dans la console."
      >
        <div className="space-y-4">
          <form.Field name="logs.mode">
            {(field) => (
              <FieldShell id="logs-mode" label="Source" errors={field.state.meta.errors}>
                <Select
                  value={field.state.value}
                  onValueChange={(mode) => field.handleChange(mode as 'stdout' | 'file')}
                >
                  <SelectTrigger id="logs-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdout">Sortie standard (stdout)</SelectItem>
                    <SelectItem value="file">Fichier de log</SelectItem>
                  </SelectContent>
                </Select>
              </FieldShell>
            )}
          </form.Field>

          <form.Subscribe selector={(s) => s.values.logs.mode}>
            {(mode) =>
              mode === 'file' && (
                <form.Field name="logs.file">
                  {(field) => (
                    <FieldShell
                      id="logs-file"
                      label="Fichier de log"
                      hint="Relatif au dossier du serveur, templating possible."
                      errors={field.state.meta.errors}
                    >
                      <Input
                        id="logs-file"
                        className="font-mono"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="logs/latest.log"
                      />
                    </FieldShell>
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>

          <form.Field name="logs.stripAnsi">
            {(field) => (
              <div className="flex items-center gap-3">
                <Switch
                  id="logs-strip-ansi"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                />
                <label htmlFor="logs-strip-ansi" className="text-sm font-medium">
                  Retirer les codes ANSI avant affichage
                </label>
              </div>
            )}
          </form.Field>
        </div>
      </CardSection>
    </div>
  );
}
