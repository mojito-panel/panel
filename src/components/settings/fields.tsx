import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';

/**
 * Presentational building blocks for the admin settings page (Pelican-style,
 * same layout as recipe-editor/fields.tsx). All form wiring (TanStack Form
 * fields) lives in the card components — these only render from props.
 */

/**
 * First message of a TanStack Form error list (`field.state.meta.errors` —
 * a mix of Standard Schema issues and internal error shapes).
 */
export function firstErrorMessage(errors: readonly unknown[] | undefined): string | undefined {
  for (const error of errors ?? []) {
    if (typeof error === 'string' && error) return error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message) return message;
    }
  }
  return undefined;
}

/**
 * Env-override note of a locked field — shown when the setting's key is
 * forced by a MOJITO_* environment variable (see ~/lib/settings).
 */
export function ForcedHint({ env }: { env: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Lock className="size-3 shrink-0" />
      Forcé par la variable d’environnement <code>{env}</code>
    </p>
  );
}

/**
 * Field shell of the settings forms: label + control + optional hint, env
 * lock note and validation error.
 */
export function SettingFieldShell({
  id,
  label,
  hint,
  forced,
  errors,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  /** Env var name when the field's key is forced (locks the input). */
  forced?: string;
  /** TanStack Form field errors (`field.state.meta.errors`). */
  errors?: readonly unknown[];
  children: ReactNode;
}) {
  const error = firstErrorMessage(errors);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {forced && <ForcedHint env={forced} />}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/**
 * One toggle row (label + description + Switch) — Gravatar, registration…
 * The switch is disabled while the key is env-forced.
 */
export function SettingSwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
  forced,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  forced?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
        {forced && <ForcedHint env={forced} />}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={forced !== undefined}
        className="mt-1"
      />
    </div>
  );
}
