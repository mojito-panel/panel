import { useForm } from '@tanstack/react-form';
import { Save, X } from 'lucide-react';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { createEntryFormSchema } from '~/validators/files';

/** Create form (TanStack Form + Zod) — name + file/directory type. */
export function CreateEntryForm({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: { name: string; type: 'file' | 'directory' }) => void;
}) {
  const form = useForm({
    validators: { onChange: createEntryFormSchema },
    defaultValues: { name: '', type: 'file' as 'file' | 'directory' },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border p-3"
    >
      <form.Field name="name">
        {(field) => (
          <div className="space-y-1">
            <Input
              id="new-entry-name"
              placeholder="nom"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              autoFocus
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{field.state.meta.errors[0]?.message}</p>
            )}
          </div>
        )}
      </form.Field>
      <form.Field name="type">
        {(field) => (
          <Select
            value={field.state.value}
            onValueChange={(v) => field.handleChange(v as 'file' | 'directory')}
          >
            <SelectTrigger id="new-entry-type" className="w-full" onBlur={field.handleBlur}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="file">Fichier</SelectItem>
              <SelectItem value="directory">Dossier</SelectItem>
            </SelectContent>
          </Select>
        )}
      </form.Field>
      <Button type="submit" size="sm" disabled={pending}>
        <Save />
        Créer
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        <X />
        Annuler
      </Button>
    </form>
  );
}
