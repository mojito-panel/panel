import { useForm, type ReactFormExtendedApi } from '@tanstack/react-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { cronToHuman } from '~/lib/cron';
import { type ScheduleEditFormDto } from '~/validators/schedules';

/**
 * The form type both pages build with `useForm<ScheduleEditFormDto>` — the
 * validator slots are invariant, so they stay `any` to accept a form
 * carrying its onChange schema (only the DATA shape matters here).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScheduleEditFormApi = ReactFormExtendedApi<ScheduleEditFormDto, any, any, any, any, any, any, any, any, any, any, any>;

/**
 * Shared schedule form (create dialog + detail page render the SAME
 * fields — Pelican parity: name, cron and the task chain in one place).
 *
 * Both forms run on `scheduleEditFormSchema` (the create dialog hides the
 * active toggle and its wire schema strips the field), so ONE form type
 * flows through. Pure presentation: it receives the TanStack Form
 * instance and renders every field.
 */

/** Curated IANA timezone list — the cron is evaluated in this zone. */
export const SCHEDULE_TIMEZONES = [
  'UTC',
  'Europe/Paris',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Casablanca',
  'Africa/Algiers',
  'Africa/Tunis',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
] as const;

/** Quick cron patterns offered next to the raw expression field. */
const CRON_PRESETS = [
  { label: 'Toutes les 30 min', cron: '*/30 * * * *' },
  { label: 'Toutes les heures', cron: '0 * * * *' },
  { label: 'Tous les jours, 4 h', cron: '0 4 * * *' },
  { label: 'Chaque lundi, 9 h', cron: '0 9 * * 1' },
] as const;

const POWER_OPTIONS = [
  { value: 'start', label: 'Démarrer' },
  { value: 'restart', label: 'Redémarrer' },
  { value: 'stop', label: 'Arrêter' },
  { value: 'kill', label: 'Forcer l’arrêt' },
] as const;

/** Field error line — TanStack Form renders Standard Schema issues as objects. */
function FieldError({ errors }: { errors: unknown[] }) {
  if (errors.length === 0) return null;
  return (
    <p className="text-sm text-destructive">
      {typeof errors[0] === 'object' && errors[0] && 'message' in errors[0]
        ? String((errors[0] as { message: unknown }).message)
        : String(errors[0])}
    </p>
  );
}

/** One task row of the chain editor (index-bound fields of the tasks array). */
function TaskRow({
  form,
  index,
  canRemove,
}: {
  form: ScheduleEditFormApi;
  index: number;
  canRemove: boolean;
}) {
  // Typed as a template literal so the derived field names below resolve to
  // TanStack Form's `tasks[${number}].payload` name union (not plain string).
  const base = `tasks[${index}]` as `tasks[${number}]`;

  return (
    <form.Subscribe selector={(s) => s.values.tasks[index]?.action}>
      {(action) => (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-start gap-3">
            <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {index + 1}
            </span>
            <form.Field name={`${base}.action`}>
              {(field) => (
                <div className="w-36 shrink-0 space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(next) => next !== null && field.handleChange(next)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Type">
                        {(current: string | null) =>
                          current === 'command' ? 'Commande' : 'Alimentation'
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="power">Alimentation</SelectItem>
                      <SelectItem value="command">Commande</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
            <div className="flex-1 space-y-2">
              <form.Field name={`${base}.payload`}>
                {(field) =>
                  action === 'power' ? (
                    <div className="space-y-2">
                      <Label>Action d’alimentation</Label>
                      <Select
                        value={field.state.value}
                        onValueChange={(next) => next !== null && field.handleChange(next)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Action">
                            {(current: string | null) =>
                              POWER_OPTIONS.find((option) => option.value === current)?.label ??
                              'Action'
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {POWER_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldError errors={field.state.meta.errors} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Commande console</Label>
                      <Input
                        placeholder="say Redémarrage dans 5 minutes…"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </div>
                  )
                }
              </form.Field>
            </div>
            {canRemove && (
              <form.Field name="tasks">
                {(field) => (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => field.removeValue(index)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </form.Field>
            )}
          </div>
          <div className="flex items-end gap-6 pl-9">
            <form.Field name={`${base}.timeOffset`}>
              {(field) => (
                <div className="w-36 space-y-2">
                  <Label>Délai (s)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={900}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(Number(e.target.value) || 0)}
                    onBlur={field.handleBlur}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name={`${base}.continueOnFailure`}>
              {(field) => (
                <div className="flex h-9 items-center">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Switch
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked === true)}
                    />
                    Continuer si échec
                  </label>
                </div>
              )}
            </form.Field>
          </div>
        </div>
      )}
    </form.Subscribe>
  );
}

/** All the fields of a schedule form — receives the caller's form instance. */
export function ScheduleFormFields({
  form,
  canDeactivate = false,
}: {
  form: ScheduleEditFormApi;
  /** Detail page only — the create form has no active toggle. */
  canDeactivate?: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* ─── Identity + cron ─── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="name">
          {(field) => (
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input
                placeholder="Redémarrage quotidien"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="cron">
          {(field) => (
            <div className="space-y-2">
              <Label>Expression cron (m h dom mon dow)</Label>
              <Input
                placeholder="0 4 * * *"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {CRON_PRESETS.map((preset) => (
                  <Button
                    key={preset.cron}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => field.handleChange(preset.cron)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{cronToHuman(field.state.value)}</p>
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="timezone">
          {(field) => (
            <div className="space-y-2">
              <Label>Fuseau horaire</Label>
              <Select
                value={field.state.value}
                onValueChange={(next) => next !== null && field.handleChange(next)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Fuseau horaire">
                    {(current: string | null) => current ?? 'Fuseau horaire'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <div className="space-y-2">
          <Label>Serveur hors ligne</Label>
          <form.Field name="onlyWhenOnline">
            {(field) => (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked === true)}
                />
                Ignorer le déclenchement si le serveur est éteint
              </label>
            )}
          </form.Field>
          {canDeactivate && (
            <form.Field name="isActive">
              {(field) => (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Switch
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked === true)}
                  />
                  Planification active
                </label>
              )}
            </form.Field>
          )}
        </div>
      </div>

      {/* ─── Task chain ─── */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Tâches</h3>
          <p className="text-xs text-muted-foreground">
            Exécutées l’une après l’autre — le délai de chaque tâche s’écoule
            après la précédente (0 à 900 s).
          </p>
        </div>

        <form.Field name="tasks">
          {(field) => (
            <div className="space-y-3">
              {field.state.value.map((_, index) => (
                <TaskRow
                  key={index}
                  form={form}
                  index={index}
                  canRemove={field.state.value.length > 1}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={field.state.value.length >= 10}
                onClick={() =>
                  field.pushValue({
                    action: 'power',
                    payload: 'restart',
                    timeOffset: 0,
                    continueOnFailure: false,
                  })
                }
              >
                <Plus />
                Ajouter une tâche
              </Button>
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
      </div>
    </div>
  );
}
