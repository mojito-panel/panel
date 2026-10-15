import { Columns3, PlusCircle, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Input } from '~/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Separator } from '~/components/ui/separator';
import { cn } from '~/lib/utils';
import type { DefinedList, ListChoiceOption, ListFilter } from '~/lists/define';

/**
 * Filter toolbar of every list — built from the list definition, so a filter is
 * declared once (column + control + values) and renders identically everywhere:
 *
 * - `text`   → debounced input;
 * - `choice` → select (single) or toggle chips (multiple);
 * - `boolean`→ Oui / Non chips.
 *
 * Values are always the STRING wire form of the query (`'running'`, `'a,b'`,
 * `'true'`) whether the table is filtered by the server or in the browser.
 */

const ALL = '__all__';
const SEARCH_DEBOUNCE_MS = 300;

export interface DataTableColumnOption {
  id: string;
  label: ReactNode;
  visible: boolean;
  toggle: () => void;
}

export interface DataTableFiltersProps<TData, TContext = void> {
  list: DefinedList<TData, TContext>;
  /** Active filter values keyed by column id. */
  values: Record<string, string>;
  onChange: (column: string, value: string | undefined) => void;
  /** Clears every column filter (leaves the search field alone). */
  onClear: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  /** Options of the `dynamic` choice filters (ids coming from another list). */
  filterOptions?: Record<string, readonly ListChoiceOption[]>;
  /** Column visibility entries (label + toggle), empty to hide the menu. */
  columnOptions: DataTableColumnOption[];
}

/** Input that commits after a pause — typing must not spam the query/URL. */
function DebouncedInput({
  value,
  placeholder,
  className,
  onCommit,
}: {
  value: string;
  placeholder: string;
  className?: string;
  onCommit: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (local === value) return;
    const timer = setTimeout(() => onCommit(local), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [local, value, onCommit]);

  return (
    <Input
      value={local}
      placeholder={placeholder}
      className={className}
      onChange={(event) => setLocal(event.target.value)}
    />
  );
}

/** Active filter chips of a multiple-choice filter (empty = no filter). */
function ChoiceChips({
  options,
  selected,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <Button
            key={option.value}
            type="button"
            size="xs"
            variant={active ? 'secondary' : 'outline'}
            onClick={() =>
              onChange(
                active
                  ? selected.filter((value) => value !== option.value)
                  : [...selected, option.value],
              )
            }
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

/** The control rendered inside a filter popover (exported for its regression test). */
export function FilterControl({
  filter,
  options,
  value,
  onChange,
}: {
  filter: ListFilter;
  options: readonly ListChoiceOption[];
  value: string;
  onChange: (value: string | undefined) => void;
}) {
  switch (filter.control) {
    case 'text':
      return (
        <DebouncedInput
          value={value}
          placeholder="Rechercher…"
          onCommit={(next) => onChange(next.trim() === '' ? undefined : next.trim())}
        />
      );

    case 'boolean':
      return (
        <ChoiceChips
          options={[
            { value: 'true', label: 'Oui' },
            { value: 'false', label: 'Non' },
          ]}
          selected={value === '' ? [] : [value]}
          onChange={(values) => onChange(values[0])}
        />
      );

    case 'nullable': {
      const [missing, present] = filter.labels ?? ['Non défini', 'Défini'];
      return (
        <ChoiceChips
          options={[
            { value: 'true', label: missing },
            { value: 'false', label: present },
          ]}
          selected={value === '' ? [] : [value]}
          onChange={(values) => onChange(values[0])}
        />
      );
    }

    case 'choice':
      if (filter.multiple) {
        return (
          <ChoiceChips
            options={options}
            selected={value === '' ? [] : value.split(',')}
            onChange={(values) => onChange(values.length > 0 ? values.join(',') : undefined)}
          />
        );
      }

      return (
        <Select
          value={value === '' ? ALL : value}
          onValueChange={(next) => onChange(next === null || next === ALL ? undefined : next)}
        >
          <SelectTrigger className="w-full">
            {/* base-ui only resolves an item's LABEL once that item is mounted
                (i.e. after the popup opened) — a closed trigger would show the
                raw value, so the label is resolved here. */}
            <SelectValue placeholder="Toutes les valeurs">
              {(current: string | null) => {
                if (!current || current === ALL) return 'Toutes les valeurs';
                return options.find((option) => option.value === current)?.label ?? current;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toutes les valeurs</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
  }
}

/** Short text shown next to the filter label once the filter is active. */
function filterSummary(filter: ListFilter, options: readonly ListChoiceOption[], value: string): string {
  switch (filter.control) {
    case 'text':
      return value;

    case 'boolean':
      return value === 'true' ? 'Oui' : 'Non';

    case 'nullable': {
      const [missing, present] = filter.labels ?? ['Non défini', 'Défini'];
      return value === 'true' ? missing : present;
    }

    case 'choice': {
      const picked = value.split(',');
      if (filter.multiple && picked.length > 2) return `${picked.length} valeurs`;
      return picked
        .map((token) => options.find((option) => option.value === token)?.label ?? token)
        .join(', ');
    }
  }
}

/** One column filter: a popover button showing the active value as a badge. */
function ColumnFilter({
  label,
  filter,
  options,
  value,
  onChange,
}: {
  label: ReactNode;
  filter: ListFilter;
  options: readonly ListChoiceOption[];
  value: string;
  onChange: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = value !== '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'border-dashed',
              active && 'border-primary bg-primary/10 hover:bg-primary/15',
            )}
          />
        }
      >
        {!active && <PlusCircle />}
        {label}
        {active && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <Badge variant="secondary">{filterSummary(filter, options, value)}</Badge>
            <X
              className="size-3.5 opacity-60 hover:opacity-100"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onChange(undefined);
              }}
            />
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 gap-3 p-3" align="start">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Filtrer : {label}
        </p>
        <FilterControl
          filter={filter}
          options={options}
          value={value}
          onChange={(next) => {
            onChange(next);
            if (next === undefined) setOpen(false);
          }}
        />
        <Separator />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            onChange(undefined);
            setOpen(false);
          }}
        >
          <RotateCcw />
          Réinitialiser
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Column visibility menu. */
function ViewOptions({ options }: { options: DataTableColumnOption[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3 />
        Colonnes
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Colonnes affichées</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={option.visible}
              onCheckedChange={() => option.toggle()}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Search field + one popover per filterable column + column visibility. */
export function DataTableFilters<TData, TContext = void>({
  list,
  values,
  onChange,
  onClear,
  search,
  onSearchChange,
  filterOptions = {},
  columnOptions,
}: DataTableFiltersProps<TData, TContext>) {
  const activeFilters = list.spec.filters.filter(({ column }) => (values[column] ?? '') !== '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {list.spec.searchTargets.length > 0 && (
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <DebouncedInput
            value={search}
            placeholder="Rechercher…"
            className="pl-8"
            onCommit={(value) => onSearchChange(value.trim())}
          />
        </div>
      )}

      {list.spec.filters.map(({ column, filter }) => (
        <ColumnFilter
          key={column}
          label={list.columns[column].header}
          filter={filter}
          options={filter.control === 'choice' ? (filter.options ?? filterOptions[column] ?? []) : []}
          value={values[column] ?? ''}
          onChange={(value) => onChange(column, value)}
        />
      ))}

      {activeFilters.length > 0 && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <RotateCcw />
          Effacer les filtres
        </Button>
      )}

      <div className="ms-auto">
        {columnOptions.length > 0 && <ViewOptions options={columnOptions} />}
      </div>
    </div>
  );
}
