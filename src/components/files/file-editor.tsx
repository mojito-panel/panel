import { useMutation, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { Save } from 'lucide-react';

import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { readFileFn, saveFileFn } from '~/server/functions/files';
import { saveFileFormSchema } from '~/validators/files';
import { formatSize } from './format-size';
import { FileErrorState } from './file-error-state';

/** Text editor (read → edit → save) — opened via ?file=… deep link. */
export function FileEditor({
  serverId,
  dir,
  path,
  onClose,
  canSave,
}: {
  serverId: string;
  dir: string;
  path: string;
  onClose: () => void;
  canSave: boolean;
}) {
  const readFile = useServerFn(readFileFn);
  const saveFile = useServerFn(saveFileFn);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['file', serverId, path],
    queryFn: () => readFile({ data: { serverId, path } }),
  });

  const save = useMutation({
    mutationFn: (content: string) => saveFile({ data: { serverId, path, content } }),
    onSuccess: () => setError(null),
    onError: (err) => setError(err.message),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          ← Retour
        </Button>
        <span className="text-sm font-medium">{path}</span>
        {query.data && (
          <span className="text-xs text-muted-foreground">({formatSize(query.data.size)})</span>
        )}
      </div>

      {query.isPending && (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-[60vh] w-full" />
        </div>
      )}

      {query.isError && (
        <FileErrorState message={query.error.message} onRetry={() => query.refetch()} />
      )}

      {query.data && (
        <>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <SaveFileForm
            key={path}
            initialContent={query.data.content}
            pending={save.isPending}
            canSave={canSave}
            onSubmit={(content) => save.mutate(content)}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Dossier : {dir || 'racine'} — l’éditeur est réservé aux fichiers texte (max 1 Mo).
          </p>
        </>
      )}
    </div>
  );
}

/** Editor textarea (TanStack Form + Zod) — keyed by path to reset on file change. */
function SaveFileForm({
  initialContent,
  pending,
  canSave,
  onSubmit,
}: {
  initialContent: string;
  pending: boolean;
  /** false → read-only view (sub-user without server.files.write). */
  canSave: boolean;
  onSubmit: (content: string) => void;
}) {
  const form = useForm({
    validators: { onChange: saveFileFormSchema },
    defaultValues: { content: initialContent },
    onSubmit: ({ value }) => onSubmit(value.content),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="mt-4"
    >
      <form.Field name="content">
        {(field) => (
          <textarea
            className="h-[60vh] w-full resize-y rounded-md border bg-background p-3 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            spellCheck={false}
          />
        )}
      </form.Field>
      <div className="mt-3">
        {canSave ? (
          <Button type="submit" disabled={pending}>
            <Save />
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Lecture seule — tu n’as pas la permission de modifier ce fichier.
          </p>
        )}
      </div>
    </form>
  );
}
