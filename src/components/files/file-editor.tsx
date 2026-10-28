import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { toast } from 'sonner';

import { readFileFn, saveFileFn } from '~/server/functions/files';
import { saveFileFormSchema } from '~/validators/files';
import { ErrorState } from '~/components/error/error-state';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { CodeEditor } from './code-editor';
import { formatSize } from './format-size';

/**
 * Text file editor (?file=… deep link) — one card: header (back + name +
 * folder + size), the Monaco editor, footer (save + dirty badge + hint).
 * Only WHITELISTED text files open here (txt/ini/yml/yaml/xml/json — see
 * EDITABLE_FILE_EXTENSIONS); the agent additionally refuses binary content
 * server-side (NUL sniff).
 */
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
  /** Content of the LAST successful save — the dirty badge compares to it. */
  const [savedContent, setSavedContent] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['file', serverId, path],
    queryFn: () => readFile({ data: { serverId, path } }),
  });

  const save = useMutation({
    mutationFn: (content: string) => saveFile({ data: { serverId, path, content } }),
    onSuccess: (_result, content) => {
      setError(null);
      setSavedContent(content);
      toast.success('Fichier enregistré');
    },
    onError: (err) => setError(err.message),
  });

  const fileName = path.split('/').pop() ?? path;

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          <ArrowLeft />
          Retour
        </Button>
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate font-mono text-sm">{fileName}</CardTitle>
          <CardDescription className="truncate text-xs">
            Dossier : {dir || 'racine'}
          </CardDescription>
        </div>
        {query.data && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatSize(query.data.size)}
          </span>
        )}
      </CardHeader>

      {query.isPending && (
        <CardContent className="p-4">
          <div className="space-y-2.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-[50vh] w-full" />
          </div>
        </CardContent>
      )}

      {query.isError && (
        <CardContent className="p-0">
          <ErrorState bare message={query.error.message} onRetry={() => void query.refetch()} />
        </CardContent>
      )}

      {query.data && (
        <SaveFileForm
          key={path}
          initialContent={query.data.content}
          savedContent={savedContent}
          path={path}
          pending={save.isPending}
          error={error}
          canSave={canSave}
          onSubmit={(content) => save.mutate(content)}
        />
      )}
    </Card>
  );
}

/**
 * Editor form (TanStack Form + Zod) — owns the content field, the Ctrl+S
 * shortcut and the footer (save button, dirty badge, hint). Keyed by path
 * upstream, so a file switch starts from a fresh form.
 */
function SaveFileForm({
  initialContent,
  savedContent,
  path,
  pending,
  error,
  canSave,
  onSubmit,
}: {
  initialContent: string;
  /** Content of the last successful save (null → not saved yet this session). */
  savedContent: string | null;
  path: string;
  pending: boolean;
  error: string | null;
  canSave: boolean;
  onSubmit: (content: string) => void;
}) {
  // The dirty badge compares to the last SAVED content — the form's own
  // isDirty stays true after a save (it compares to the initial values).
  const baseline = savedContent ?? initialContent;
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
        void form.handleSubmit();
      }}
      className="contents"
    >
      <CardContent className="p-0">
        <form.Field name="content">
          {(field) => (
            <CodeEditor
              path={path}
              value={field.state.value}
              readOnly={!canSave}
              onChange={(content) => field.handleChange(content)}
              onSave={() => void form.handleSubmit()}
            />
          )}
        </form.Field>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3 border-t px-4 py-3">
        {canSave ? (
          <Button type="submit" size="sm" disabled={pending}>
            <Save />
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Lecture seule — tu n’as pas la permission de modifier ce fichier.
          </p>
        )}
        <form.Subscribe selector={(state) => state.values.content !== baseline}>
          {(isDirty) =>
            isDirty && canSave ? (
              <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                Non enregistré
              </Badge>
            ) : null
          }
        </form.Subscribe>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="ml-auto text-xs text-muted-foreground">
          Édition réservée aux fichiers texte (txt, ini, yml, yaml, xml, json) — max 1 Mo
        </p>
      </CardFooter>
    </form>
  );
}
