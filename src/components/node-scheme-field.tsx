import { cn } from 'cn';

import { Button } from '~/components/ui/button';
import type { NodeScheme } from '~/validators/node';

/**
 * Node scheme picker (Pelican "Communicate over SSL"): a single-select
 * BUTTON GROUP — HTTP / HTTPS / HTTPS behind a reverse proxy. The chosen
 * scheme applies to everything that talks to the agent: the panel (REST)
 * and the browsers (console + health WS), through the node's public port.
 */
const OPTIONS: { value: NodeScheme; label: string; description: string }[] = [
  { value: 'http', label: 'HTTP', description: 'Agent en clair' },
  { value: 'https', label: 'HTTPS', description: 'TLS servi par l’agent' },
  {
    value: 'https-behind-proxy',
    label: 'HTTPS derrière proxy',
    description: 'Le reverse proxy termine le TLS',
  },
];

export function NodeSchemeField({
  id,
  value,
  onChange,
  disabled = false,
}: {
  /** id of the LABEL element describing the group (aria-labelledby). */
  id: string;
  value: NodeScheme;
  onChange: (value: NodeScheme) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-labelledby={id} className="grid gap-2 sm:grid-cols-3">
      {OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            variant={selected ? 'default' : 'outline'}
            onClick={() => onChange(option.value)}
            className="flex h-auto flex-col items-start gap-0.5 py-2 text-left"
          >
            <span className="text-sm font-medium">{option.label}</span>
            <span
              className={cn(
                'text-xs font-normal',
                selected ? 'text-primary-foreground/80' : 'text-muted-foreground',
              )}
            >
              {option.description}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
