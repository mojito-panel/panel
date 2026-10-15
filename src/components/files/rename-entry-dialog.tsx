import { useForm } from '@tanstack/react-form';
import { Save } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { renameEntryFormSchema } from '~/validators/files';

/**
 * Rename dialog of the file browser (TanStack Form + Zod). It used to be an
 * inline table row; a dialog keeps the listing a plain list of rows.
 */
export function RenameEntryDialog({
  entry,
  pending,
  onClose,
  onSubmit,
}: {
  /** Entry being renamed, or null when the dialog is closed. */
  entry: { name: string; path: string } | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: { name: string }) => void;
}) {
  const form = useForm({
    validators: { onChange: renameEntryFormSchema },
    defaultValues: { name: entry?.name ?? '' },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renommer</DialogTitle>
          <DialogDescription>{entry?.path}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <form.Field name="name">
            {(field) => (
              <div className="space-y-2">
                <Input
                  autoFocus
                  placeholder="nouveau nom"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors[0]?.message}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <form.Subscribe selector={(state) => state.canSubmit && !state.isSubmitting}>
              {(canSubmit) => (
                <Button type="submit" disabled={!canSubmit || pending}>
                  <Save />
                  Renommer
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
