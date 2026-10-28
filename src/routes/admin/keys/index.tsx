import { useState } from 'react';
import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { Copy, KeySquare, Trash2 } from 'lucide-react';
import {
  listSshKeysFn,
  createSshKeyFn,
  deleteSshKeyFn,
} from '~/server/functions/ssh-keys';
import { DataTable } from '~/components/data-table/data-table';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { adminSshKeysList, type AdminSshKeyRow } from '~/lists/ssh-keys';
import { createSshKeySchema, type CreateSshKeyDto } from '~/validators/ssh-keys';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';

export const Route = createFileRoute('/admin/keys/')({
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    adminSshKeysList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(adminSshKeysList.defaultSearch)] },
  component: AdminSshKeysPage,
});

/**
 * /admin/keys — the SSH key pairs of the panel. Generated (Ed25519 via the
 * system ssh-keygen) or imported, they authenticate the panel's git clones
 * of PRIVATE repositories: a key is attached to a marketplace registry and
 * every recipe imported from it is cloned/updated with it. Filtering,
 * sorting and pagination run in the database; the state lives in the URL.
 */
function AdminSshKeysPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const search = Route.useSearch();

  const listKeys = useServerFn(listSshKeysFn);
  const createKey = useServerFn(createSshKeyFn);
  const deleteKey = useServerFn(deleteSshKeyFn);

  const query = useQuery({
    queryKey: ['admin-ssh-keys', search],
    queryFn: () => listKeys({ data: search }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (sshKeyId: string) => deleteKey({ data: { sshKeyId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-ssh-keys'] });
      toast.success('Clé supprimée');
    },
    onError: (error) => toast.error(error.message),
  });

  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  const [keyToDelete, setKeyToDelete] = useState<AdminSshKeyRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Clés SSH</CardTitle>
          <CardDescription>
            Paires de clés du panel — générées ou importées — utilisées pour
            cloner les dépôts privés (recettes). La clé privée est chiffrée en
            base et n’est jamais affichée.
          </CardDescription>
          <CardAction>
            <Button onClick={() => setCreateOpen(true)}>
              <KeySquare />
              Ajouter une clé
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <DataTable
            list={adminSshKeysList}
            rows={query.data?.rows ?? []}
            rowCount={query.data?.rowCount ?? 0}
            search={search}
            onSearchChange={onSearchChange}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            emptyMessage="Aucune clé — génère une paire ou importe une clé de déploiement."
            rowContext={{
              deleting: remove.isPending,
              onDelete: (key) => setKeyToDelete(key),
            }}
          />
        </CardContent>
      </Card>

      <CreateSshKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        createKey={createKey}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['admin-ssh-keys'] })}
      />

      <ConfirmDialog
        open={keyToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setKeyToDelete(null);
        }}
        onConfirm={() => {
          if (keyToDelete) remove.mutate(keyToDelete.id);
          setKeyToDelete(null);
        }}
        title={`Supprimer la clé « ${keyToDelete?.name} » ?`}
        description="La clé privée est définitivement supprimée — les dépôts privés qui l’utilisent ne seront plus accessibles."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}

type CreateSshKeyResult = { id: string; name: string; publicKey: string; fingerprint: string };

/** "Ajouter une clé" dialog — generate (Ed25519) or import an existing pair. */
function CreateSshKeyDialog({
  open,
  onOpenChange,
  createKey,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createKey: (args: { data: CreateSshKeyDto }) => Promise<{ id: string; publicKey: string; fingerprint: string }>;
  onCreated: () => Promise<void>;
}) {
  // After a GENERATION, the dialog switches to the public-key result view
  // (the only moment the admin can copy it for the forge).
  const [created, setCreated] = useState<CreateSshKeyResult | null>(null);

  const form = useForm({
    validators: { onChange: createSshKeySchema },
    defaultValues: {
      mode: 'generate',
      name: '',
      comment: '',
      privateKey: '',
      publicKey: '',
    } as CreateSshKeyDto,
    onSubmit: ({ value }) => create.mutate(value),
  });

  const create = useMutation({
    mutationFn: (value: CreateSshKeyDto) => createKey({ data: value }),
    onSuccess: async (result, value) => {
      await onCreated();
      if (value.mode === 'generate') {
        // Keep the dialog open — the public key is displayed for the forge.
        // The name comes from the form's own value: the server fn's serialized
        // DTO is the public trio (id/publicKey/fingerprint).
        setCreated({ ...result, name: value.name });
        toast.success('Clé générée');
      } else {
        form.reset();
        onOpenChange(false);
        toast.success('Clé importée');
      }
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          setCreated(null);
          form.reset();
        }
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Clé « {created.name} » générée</DialogTitle>
              <DialogDescription>
                Autorise cette clé publique sur ton dépôt privé (deploy key
                GitHub/GitLab, authorized_keys…) — la lecture seule suffit. La
                clé privée est stockée chiffrée par le panel et ne sera plus
                jamais affichée.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Clé publique</Label>
                <Textarea
                  readOnly
                  rows={4}
                  value={created.publicKey}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                Empreinte : {created.fingerprint}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(created.publicKey)}
                >
                  <Copy />
                  Copier la clé publique
                </Button>
                <Button onClick={() => setCreated(null)}>Terminé</Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Ajouter une clé SSH</DialogTitle>
              <DialogDescription>
                Génère une paire ou importe une clé de déploiement existante —
                elle servira à cloner les dépôts privés depuis le panel.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              className="space-y-4"
            >
              {/* The mode drives the Tabs, the visible fields and the submit
                  label — read REACTIVELY via form.Subscribe (getFieldValue is
                  a one-time read: without the subscription a tab click
                  updates the store but never re-renders the dialog). */}
              <form.Subscribe selector={(s) => s.values.mode}>
                {(mode) => (
                  <>
                    <Tabs
                      value={mode}
                      onValueChange={(v) =>
                        v && form.setFieldValue('mode', v as CreateSshKeyDto['mode'])
                      }
                    >
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="generate">Générer une paire</TabsTrigger>
                        <TabsTrigger value="import">Importer une clé</TabsTrigger>
                      </TabsList>

                      <TabsContent value="generate" className="space-y-4 pt-2">
                        <p className="text-sm text-muted-foreground">
                          Une paire Ed25519 est générée par le panel
                          (ssh-keygen). La clé privée est stockée chiffrée et
                          ne sera plus jamais affichée — seule la clé publique
                          sera à autoriser sur ton dépôt.
                        </p>
                        <form.Field name="comment">
                          {(field) => (
                            <div className="space-y-2">
                              <Label htmlFor="ssh-key-comment">Commentaire (optionnel)</Label>
                              <Input
                                id="ssh-key-comment"
                                placeholder="mojito-panel"
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
                      </TabsContent>

                      <TabsContent value="import" className="space-y-4">
                        <form.Field name="privateKey">
                          {(field) => (
                            <div className="space-y-2">
                              <Label htmlFor="ssh-private-key">Clé privée</Label>
                              <Textarea
                                id="ssh-private-key"
                                rows={6}
                                placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…'}
                                className="font-mono text-xs"
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
                        <form.Field name="publicKey">
                          {(field) => (
                            <div className="space-y-2">
                              <Label htmlFor="ssh-public-key">Clé publique (optionnelle)</Label>
                              <Textarea
                                id="ssh-public-key"
                                rows={2}
                                placeholder="ssh-ed25519 AAAA… utilisateur@hôte"
                                className="font-mono text-xs"
                                value={field.state.value}
                                onChange={(e) => field.handleChange(e.target.value)}
                                onBlur={field.handleBlur}
                              />
                              {field.state.meta.errors.length > 0 && (
                                <p className="text-sm text-destructive">
                                  {field.state.meta.errors[0]?.message}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                Laisser vide : la clé publique est déduite de la
                                clé privée. Si elle est fournie, elle est
                                vérifiée contre la clé privée.
                              </p>
                            </div>
                          )}
                        </form.Field>
                      </TabsContent>
                    </Tabs>

                    <form.Field name="name">
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor="ssh-key-name">Nom d’affichage</Label>
                          <Input
                            id="ssh-key-name"
                            placeholder="Déploiement GitHub"
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

                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Annuler
                      </Button>
                      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
                        {([canSubmit, isSubmitting]) => (
                          <Button
                            type="submit"
                            disabled={!canSubmit || isSubmitting || create.isPending}
                          >
                            <KeySquare />
                            {create.isPending
                              ? 'Création…'
                              : mode === 'generate'
                                ? 'Générer la paire'
                                : 'Importer la clé'}
                          </Button>
                        )}
                      </form.Subscribe>
                    </div>
                  </>
                )}
              </form.Subscribe>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
