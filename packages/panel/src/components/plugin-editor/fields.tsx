import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import type { KvPair } from '~/validators/plugin-editor';

/**
 * Presentational building blocks for the plugin editor (Pelican-style).
 * All form wiring (TanStack Form fields) lives in the tab components —
 * these only render from props.
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

/** Field shell: label + control + first validation error. */
export function FieldShell({
  id,
  label,
  hint,
  errors,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  /** TanStack Form field errors (`field.state.meta.errors`). */
  errors?: readonly unknown[];
  children: ReactNode;
}) {
  const error = firstErrorMessage(errors);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Comma-separated tags input — value is an array in the form state. */
export function TagsInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
}: {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  onBlur?: () => void;
  placeholder?: string;
}) {
  return (
    <Input
      id={id}
      value={value.join(', ')}
      onChange={(e) => onChange(e.target.value.split(',').map((tag) => tag.trim()))}
      onBlur={onBlur}
      placeholder={placeholder}
    />
  );
}

/**
 * Key/value rows editor (records in the contract, pairs in the form state).
 * Mirrors Filament's KeyValue field used by Pelican for docker_images etc.
 */
export function KvRows({
  pairs,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  errors,
}: {
  pairs: KvPair[];
  onChange: (pairs: KvPair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel: string;
  /** Row errors (`pairs[i].key`), keyed by row index. */
  errors?: Record<number, readonly unknown[]>;
}) {
  const set = (index: number, field: 'key' | 'value', raw: string) => {
    const next = pairs.map((pair, i) => (i === index ? { ...pair, [field]: raw } : pair));
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {pairs.map((pair, index) => {
        const error = firstErrorMessage(errors?.[index]);
        return (
          <div key={index} className="space-y-1">
            <div className="flex gap-2">
              <Input
                aria-label="Clé"
                value={pair.key}
                onChange={(e) => set(index, 'key', e.target.value)}
                placeholder={keyPlaceholder}
                className={error ? 'border-destructive' : undefined}
              />
              <Input
                aria-label="Valeur"
                value={pair.value}
                onChange={(e) => set(index, 'value', e.target.value)}
                placeholder={valuePlaceholder}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Supprimer la ligne"
                onClick={() => onChange(pairs.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...pairs, { key: '', value: '' }])}
      >
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

/**
 * Collapsible card — one variable / one install action
 * (Pelican's Repeater: collapsible, collapsed by default, item label in
 * the header, actions on the right).
 */
export function CollapseCard({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  actions,
  children,
}: {
  /** Shown in the header; falls back to a placeholder while empty. */
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  /** Right side of the header (move up/down, delete…). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          {badge}
          <span className="truncate font-medium">{title}</span>
          {subtitle && (
            <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
          )}
        </button>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {open && <div className="space-y-4 border-t p-4">{children}</div>}
    </div>
  );
}

/** Card-based section used inside tabs. */
export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="font-semibold">{title}</p>
      {description && (
        <p className="mb-4 mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/** Action buttons for repeater items (move up/down, delete). */
export function ItemActions({
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      {onMoveUp && (
        <Button type="button" variant="ghost" size="icon" aria-label="Monter" onClick={onMoveUp}>
          ↑
        </Button>
      )}
      {onMoveDown && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Descendre"
          onClick={onMoveDown}
        >
          ↓
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Supprimer"
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </>
  );
}
