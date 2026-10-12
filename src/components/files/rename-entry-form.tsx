import { useForm } from '@tanstack/react-form';
import { Save, X } from 'lucide-react';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { renameEntryFormSchema } from '~/validators/files';

/** Inline rename row (TanStack Form + Zod) — replaces the entry's table row. */
export function RenameEntryForm({
  currentName,
  pending,
  onCancel,
  onSubmit,
}: {
  currentName: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: { name: string }) => void;
}) {
  const form = useForm({
    validators: { onChange: renameEntryFormSchema },
    defaultValues: { name: currentName },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <tr className="border-b">
      <td colSpan={4} className="py-2 pl-4 pr-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <form.Field name="name">
            {(field) => (
              <div className="space-y-1">
                <Input
                  placeholder="nouveau nom"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  autoFocus
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-xs text-destructive">
                    {field.state.meta.errors[0]?.message}
                  </p>
                )}
              </div>
            )}
          </form.Field>
          <Button type="submit" size="sm" disabled={pending}>
            <Save />
            Renommer
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <X />
            Annuler
          </Button>
        </form>
      </td>
    </tr>
  );
}
