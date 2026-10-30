import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import type { RecipeVariable } from '~/contract';

/** Type sent by the recipe vs value kept in the form state. */
export type VariableValue = string | number | boolean;

/**
 * Recipe variable input (shadcn-flavored): boolean → Activé/Désactivé,
 * options → dropdown, otherwise a text/number Input. Shared by the server
 * creation form and the "Variables" page.
 */
export function VariableField({
  variable,
  value,
  onChange,
  onBlur,
  error,
  disabled = false,
}: {
  variable: RecipeVariable;
  value: VariableValue | undefined;
  onChange: (value: VariableValue) => void;
  onBlur?: () => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={variable.env}>
        {variable.name}
        <span className="text-muted-foreground ml-2 font-mono text-xs">{variable.env}</span>
      </Label>
      {variable.type === 'boolean' ? (
        <Select
          value={String(value)}
          onValueChange={(v) => onChange(v === 'true')}
          disabled={disabled}
        >
          <SelectTrigger id={variable.env} className="w-full" onBlur={onBlur}>
            {/* base-ui only resolves an item's LABEL once its popup opened —
                a closed trigger would show the raw 'true'/'false' wire value,
                so the label is resolved here (FilterControl is the reference). */}
            <SelectValue>
              {(current: string | null) =>
                current === 'true' ? 'Activé' : current === 'false' ? 'Désactivé' : '—'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Activé</SelectItem>
            <SelectItem value="false">Désactivé</SelectItem>
          </SelectContent>
        </Select>
      ) : variable.options ? (
        <Select
          value={String(value)}
          onValueChange={(v) => v !== null && onChange(v)}
          disabled={disabled}
        >
          <SelectTrigger id={variable.env} className="w-full" onBlur={onBlur}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {variable.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={variable.env}
          type={variable.type === 'number' ? 'number' : 'text'}
          value={String(value)}
          onChange={(e) =>
            onChange(variable.type === 'number' ? Number(e.target.value) : e.target.value)
          }
          onBlur={onBlur}
          disabled={disabled}
        />
      )}
      {variable.description && (
        <p className="text-muted-foreground text-xs">{variable.description}</p>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
