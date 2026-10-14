import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { getNodeFn, updateNodeFn, resetNodeTokenFn, listNodeAllocationsFn, createNodeAllocationsFn, deleteAllocationFn, assignAllocationFn, revokeAllocationFn } from '~/server/functions/admin';
import { listServersFn } from '~/server/functions/servers';
import {
  updateNodeSchema,
  createAllocationsSchema,
  type UpdateNodeDto,
  type CreateAllocationsDto,
} from '~/validators/node';
import { buildAgentConfig, buildAgentConfigWithoutToken } from '~/lib/agent-config';
import { NodeSchemeField } from '~/components/node-scheme-field';
import type { NodeScheme } from '~/validators/node';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { CardSection, TabsCard } from '~/components/tabs-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Trash2 } from 'lucide-react';

export const Route = createFileRoute('/admin/nodes/$nodeId')({
  component: AdminNodeEditPage,
});

/**
 * Node edit page — Pelican panel layout (Filament NodeResource): a record
 * page with tabs in the card header. Overview (live agent version +
 * counters) / basic settings (name, fqdn, port) / config file (generated
 * shard.yml + token reset, since the token is encrypted at rest and only
 * displayable once).
 */
function AdminNodeEditPage() {
  const { nodeId } = Route.useParams();
  const queryClient = useQueryClient();

  const getNode = useServerFn(getNodeFn);
  const resetToken = useServerFn(resetNodeTokenFn);

  const query = useQuery({
    queryKey: ['node', nodeId],
    queryFn: () => getNode({ data: { nodeId } }),
  });

  const reset = useMutation({
    mutationFn: async () => {
      const result = await resetToken({ data: { nodeId } });
      await queryClient.invalidateQueries({ queryKey: ['node', nodeId] });
      return result;
    },
    onSuccess: () => {
      toast.success('Token régénéré — mets à jour l’shard.yml de l’agent');
    },
    onError: (err) => toast.error(err.message),
  });

  if (query.isPending) {
    return <p className="text-muted-foreground">Chargement du node…</p>;
  }
  if (query.isError) {
    return <p className="text-destructive">{query.error.message}</p>;
  }

  const node = query.data;
  const configNode = {
    name: node.name,
    fqdn: node.fqdn,
    agentPort: node.agentPort,
    sftpPort: node.sftpPort,
    panelUrl: node.panelUrl,
  };
  // The fresh token lives in the mutation result — shown ONCE (like at node
  // creation), never persisted anywhere.
  const freshToken = reset.data?.agentToken ?? null;
  const configYaml = freshToken
    ? buildAgentConfig({ ...configNode, agentToken: freshToken })
    : buildAgentConfigWithoutToken(configNode);

  return (
    <div>
      {/* ─── Record header (Filament EditNode heading) ─────────────────── */}
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{node.name}</h1>
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          {node.status}
        </span>
      </div>
      <p className="text-muted-foreground">
        {node.scheme}://{node.fqdn}:{node.publicPort}
      </p>

      {/* ─── Tabs (Pelican detailTabs: overview / basic settings / allocations / config) ── */}
      <TabsCard
        defaultValue="overview"
        className="mt-6"
        tabs={[
          /* ── Overview tab (Pelican "node_info" fieldset) ─────────────── */
          {
            value: 'overview',
            label: 'Vue d’ensemble',
            content: (
              <CardSection title="Informations du node">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <InfoEntry
                    label="Version de l'agent"
                    value={node.agentVersion ?? 'injoignable'}
                    muted={!node.agentVersion}
                  />
                  <InfoEntry label="Serveurs installés" value={String(node.serverCount)} />
                  <InfoEntry
                    label="Dernier contact"
                    value={node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString('fr-FR') : 'jamais'}
                    muted={!node.lastSeenAt}
                  />
                  <InfoEntry
                    label="Créé le"
                    value={new Date(node.createdAt).toLocaleString('fr-FR')}
                  />
                </div>
              </CardSection>
            ),
          },

          /* ── Basic settings tab (Pelican "basic_settings") ───────────── */
          {
            value: 'settings',
            label: 'Paramètres de base',
            /* Mounted only once the node is loaded — useForm initializes its
               defaultValues at mount, so it must NOT live in the loading
               skeleton (empty fields would freeze in the form). */
            content: (
              <NodeSettingsForm
                node={{ id: node.id, name: node.name, fqdn: node.fqdn, scheme: node.scheme as NodeScheme, agentPort: node.agentPort, publicPort: node.publicPort, sftpPort: node.sftpPort }}
              />
            ),
          },

          /* ── Allocations tab (Pelican NodeResource "Allocations") ────── */
          {
            value: 'allocations',
            label: 'Allocations',
            content: <NodeAllocationsPanel nodeId={node.id} />,
          },

          /* ── Config file tab (Pelican "config_file" + reset token) ───── */
          {
            value: 'config',
            label: 'Fichier de config',
            content: (
              <CardSection
                title="shard.yml"
                description={
                  <>
                    Placer ce fichier à côté de <code>shard.exe</code> sur le node
                    (ou démarrer avec <code>shard.exe --config &lt;chemin&gt;</code>).
                    Le token est chiffré côté panel et affiché une seule fois :{' '}
                    {freshToken
                      ? 'voici la configuration complète avec le token fraîchement régénéré.'
                      : 'régénère le token pour afficher une configuration complète.'}
                  </>
                }
              >
                <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{configYaml}</pre>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!freshToken}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(configYaml)
                        .then(() => toast.success('Configuration shard.yml copiée'))
                        .catch(() => toast.error('Copie impossible — sélectionne le texte manuellement'));
                    }}
                  >
                    Copier la configuration
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={reset.isPending}
                    onClick={() => {
                      if (
                        confirm(
                          'Régénérer le token ? L’agent en cours d’exécution ne reconnaîtra plus le panel tant que son shard.yml n’est pas mis à jour.',
                        )
                      ) {
                        reset.mutate();
                      }
                    }}
                  >
                    {reset.isPending ? 'Régénération…' : 'Réinitialiser le token'}
                  </Button>
                </div>
              </CardSection>
            ),
          },
        ]}
      />
    </div>
  );
}

/** One info entry of the Overview tab (Filament TextEntry equivalent). */
function InfoEntry({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-medium ${muted ? 'text-muted-foreground' : ''}`}>{value}</p>
    </div>
  );
}

/**
 * Basic settings form — a SEPARATE component so useForm mounts with the
 * loaded node values as defaultValues (the parent renders it only once
 * the query resolved).
 */
function NodeSettingsForm({
  node,
}: {
  node: { id: string; name: string; fqdn: string; scheme: NodeScheme; agentPort: number; publicPort: number; sftpPort: number };
}) {
  const queryClient = useQueryClient();
  const updateNode = useServerFn(updateNodeFn);

  const update = useMutation({
    mutationFn: async (data: UpdateNodeDto) => {
      const result = await updateNode({ data });
      await queryClient.invalidateQueries({ queryKey: ['node', node.id] });
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      return result;
    },
    onSuccess: () => toast.success('Node mis à jour'),
    onError: (err) => toast.error(err.message),
  });

  const form = useForm({
    validators: { onChange: updateNodeSchema },
    defaultValues: {
      nodeId: node.id,
      name: node.name,
      fqdn: node.fqdn,
      scheme: node.scheme,
      agentPort: node.agentPort,
      publicPort: node.publicPort,
      sftpPort: node.sftpPort,
    },
    onSubmit: ({ value }) => update.mutate(value),
  });

  return (
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
            <Label htmlFor="node-edit-name">Nom d'affichage</Label>
            <Input
              id="node-edit-name"
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

      <form.Field name="fqdn">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="node-edit-fqdn">FQDN / IP</Label>
            <Input
              id="node-edit-fqdn"
              placeholder="node1.example.com ou 192.168.1.10"
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

      <form.Field name="agentPort">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="node-edit-port">Port d’écoute</Label>
            <Input
              id="node-edit-port"
              type="number"
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
              onBlur={field.handleBlur}
            />
            <p className="text-xs text-muted-foreground">Port que l’agent ouvre sur le node (shard.yml <code>api.port</code>) — après modification, régénère la configuration.</p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">
                {field.state.meta.errors[0]?.message}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="publicPort">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="node-edit-public-port">Port accessible</Label>
            <Input
              id="node-edit-public-port"
              type="number"
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
              onBlur={field.handleBlur}
            />
            <p className="text-xs text-muted-foreground">Port utilisé par le panel et les navigateurs pour joindre l’agent — derrière un reverse proxy, c’est le port exposé par le proxy (ex. 443) ; sinon identique au port d’écoute.</p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">
                {field.state.meta.errors[0]?.message}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="scheme">
        {(field) => (
          <div className="space-y-2">
            <p id="node-edit-scheme" className="text-sm font-medium leading-none">
              Communication SSL
            </p>
            <NodeSchemeField
              id="node-edit-scheme"
              value={field.state.value}
              onChange={(value) => field.handleChange(value)}
            />
            <p className="text-xs text-muted-foreground">
              Protocole utilisé par le panel ET les navigateurs (console, santé)
              pour joindre l’agent, sur le port accessible. Derrière un reverse
              proxy qui termine le TLS : l’agent reste en HTTP sur son port
              d’écoute.
            </p>
          </div>
        )}
      </form.Field>

      <form.Field name="sftpPort">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="node-edit-sftp-port">Port SFTP</Label>
            <Input
              id="node-edit-sftp-port"
              type="number"
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
              onBlur={field.handleBlur}
            />
            <p className="text-xs text-muted-foreground">
              Port d’écoute SFTP de l’agent (shard.yml <code>sftp.port</code>)
              — après modification, régénère la configuration.
            </p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">
                {field.state.meta.errors[0]?.message}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <Button type="submit" disabled={update.isPending}>
        {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </Button>
    </form>
  );
}

/**
 * Allocations tab — Pelican node allocation management: create IP:port
 * entries (single port or range), assign them to servers, revoke, delete.
 */
function NodeAllocationsPanel({ nodeId }: { nodeId: string }) {
  const queryClient = useQueryClient();
  const listAllocations = useServerFn(listNodeAllocationsFn);
  const createAllocations = useServerFn(createNodeAllocationsFn);
  const deleteAllocation = useServerFn(deleteAllocationFn);
  const assignAllocation = useServerFn(assignAllocationFn);
  const revokeAllocation = useServerFn(revokeAllocationFn);
  const listServers = useServerFn(listServersFn);

  const query = useQuery({
    queryKey: ['node-allocations', nodeId],
    queryFn: () => listAllocations({ data: { nodeId } }),
  });
  const serversQuery = useQuery({
    queryKey: ['servers'],
    queryFn: () => listServers(),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['node-allocations', nodeId] });
  };

  const create = useMutation({
    mutationFn: async (data: CreateAllocationsDto) => {
      const result = await createAllocations({ data });
      await invalidate();
      return result;
    },
    onSuccess: (result) =>
      toast.success(
        result.created > 0
          ? `${result.created} allocation(s) créée(s)${result.skipped > 0 ? `, ${result.skipped} déjà existante(s) ignorée(s)` : ''}`
          : 'Aucune allocation créée — tous ces ports existent déjà sur cette IP',
      ),
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (allocationId: string) => {
      const result = await deleteAllocation({ data: { allocationId } });
      await invalidate();
      return result;
    },
    onSuccess: () => toast.success('Allocation supprimée'),
    onError: (err) => toast.error(err.message),
  });

  const assign = useMutation({
    mutationFn: async ({ allocationId, serverId }: { allocationId: string; serverId: string }) => {
      const result = await assignAllocation({ data: { allocationId, serverId } });
      await invalidate();
      return result;
    },
    onSuccess: () => toast.success('Allocation affectée au serveur'),
    onError: (err) => toast.error(err.message),
  });

  const revoke = useMutation({
    mutationFn: async (allocationId: string) => {
      const result = await revokeAllocation({ data: { allocationId } });
      await invalidate();
      return result;
    },
    onSuccess: () => toast.success('Allocation révoquée — elle retourne dans le pool'),
    onError: (err) => toast.error(err.message),
  });

  const form = useForm({
    validators: { onChange: createAllocationsSchema },
    defaultValues: { nodeId, ip: '0.0.0.0', ports: '', alias: '' },
    onSubmit: ({ value }) => create.mutate(value),
  });

  const allocations = query.data ?? [];
  const freeCount = allocations.filter((a) => a.serverId === null).length;
  const nodeServers = (serversQuery.data ?? []).filter((s) => s.nodeId === nodeId);

  return (
    <div className="divide-y">
      <CardSection
        title="Pool d'allocations"
        description={`IP:port disponibles pour les serveurs de ce node (${freeCount} libre / ${allocations.length} au total).`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="flex flex-wrap items-start gap-2"
        >
          <form.Field name="ip">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor="alloc-ip">IP</Label>
                <Input
                  id="alloc-ip"
                  className="w-40"
                  placeholder="0.0.0.0"
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

          <form.Field name="ports">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor="alloc-ports">Ports</Label>
                <Input
                  id="alloc-ports"
                  className="w-64"
                  placeholder="25565 ou 25570-25575, 25599"
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

          <form.Field name="alias">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor="alloc-alias">Alias (optionnel)</Label>
                <Input
                  id="alloc-alias"
                  className="w-48"
                  placeholder="jeu.example.com"
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

          <Button type="submit" className="mt-6" disabled={create.isPending}>
            {create.isPending ? 'Création…' : 'Créer'}
          </Button>
        </form>
      </CardSection>

      <CardSection title="Allocations du node">
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : allocations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune allocation — crée-en ci-dessus pour pouvoir installer des
            serveurs sur ce node.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Adresse</th>
                <th className="py-2 pr-4 font-medium">Alias</th>
                <th className="py-2 pr-4 font-medium">Serveur</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {allocations.map((allocation) => (
                <tr key={allocation.id}>
                  <td className="py-2 pr-4 font-mono">
                    {allocation.ip}:{allocation.port}
                  </td>
                  <td className="py-2 pr-4">{allocation.alias ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {allocation.serverId === null ? (
                      <span className="text-muted-foreground">libre</span>
                    ) : (
                      <>
                        {allocation.serverName}
                        {allocation.primary && (
                          <span className="ml-2 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                            principale
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {allocation.serverId === null ? (
                      <div className="flex items-center justify-end gap-2">
                        {nodeServers.length > 0 && (
                          <Select
                            value=""
                            onValueChange={(serverId) =>
                              serverId !== null &&
                              assign.mutate({ allocationId: allocation.id, serverId })
                            }
                          >
                            <SelectTrigger size="sm" className="w-44">
                              <SelectValue placeholder="— Affecter à —" />
                            </SelectTrigger>
                            <SelectContent>
                              {nodeServers.map((server) => (
                                <SelectItem key={server.id} value={server.id}>
                                  {server.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `Supprimer l’allocation ${allocation.ip}:${allocation.port} ?`,
                              )
                            ) {
                              remove.mutate(allocation.id);
                            }
                          }}
                        >
                          <Trash2 />
                          Supprimer
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(allocation.id)}
                      >
                        Révoquer
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardSection>
    </div>
  );
}
