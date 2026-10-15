import { useEffect, useState } from 'react';
import { createFileRoute, Link, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm, useStore } from '@tanstack/react-form';
import { toast } from 'sonner';
import { ExternalLink, Plus } from 'lucide-react';
import {
  listAdminNodesFn,
  createNodeFn,
  deleteNodeFn,
  resolveNodeFqdnFn,
} from '~/server/functions/admin';
import { DataTable } from '~/components/data-table/data-table';
import { useAuth } from '~/contexts/use-auth';
import { canFromPermissions } from '~/lib/permissions';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { adminNodesList, type AdminNodeRow } from '~/lists/nodes';
import { createNodeSchema, type CreateNodeDto } from '~/validators/node';
import { buildAgentConfig } from '~/lib/agent-config';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { NodeSchemeField } from '~/components/node-scheme-field';
import type { NodeScheme } from '~/validators/node';

export const Route = createFileRoute('/admin/nodes/')({
  // Same schema as the server function: the route validates the URL, the
  // function validates the payload — one definition, no drift.
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    adminNodesList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(adminNodesList.defaultSearch)] },
  component: AdminNodesPage,
});

/** Crude IPv4 check — enough to skip the DNS lookup for raw IPs (like Pelican's is_ip). */
const IP_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function AdminNodesPage() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();

  const listNodes = useServerFn(listAdminNodesFn);
  const createNode = useServerFn(createNodeFn);
  const deleteNode = useServerFn(deleteNodeFn);

  const canDelete = canFromPermissions(permissions, { 'panel.nodes': ['delete'] });

  const query = useQuery({
    queryKey: ['admin-nodes', search],
    queryFn: () => listNodes({ data: search }),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: async (data: CreateNodeDto) => {
      const result = await createNode({ data });
      // The picker list stays in the same cache key space as before.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-nodes'] }),
        queryClient.invalidateQueries({ queryKey: ['nodes'] }),
      ]);
      return result;
    },
  });

  const remove = useMutation({
    mutationFn: (node: AdminNodeRow) => deleteNode({ data: { nodeId: node.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-nodes'] });
      toast.success('Node supprimé');
    },
    onError: (error) => toast.error(error.message),
  });

  // Search updates write the WHOLE validated query back (reducer form would
  // require the raw params type): the page resets below are part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  const onDelete = (node: AdminNodeRow) => {
    if (confirm(`Supprimer le node « ${node.name} » ?`)) {
      remove.mutate(node);
    }
  };

  const form = useForm({
    validators: { onChange: createNodeSchema },
    defaultValues: { name: '', fqdn: '', agentPort: 8080, publicPort: 8080, scheme: 'http' as NodeScheme },
    onSubmit: ({ value }) => create.mutate(value),
  });

  // Pelican-style live DNS check: the FQDN is resolved server-side
  // (browsers cannot do DNS), debounced so keystrokes don't spam lookups.
  const resolveFqdn = useServerFn(resolveNodeFqdnFn);
  const fqdnValue = useStore(form.store, (s) => s.values.fqdn);
  const [debouncedFqdn, setDebouncedFqdn] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFqdn(fqdnValue.trim()), 700);
    return () => clearTimeout(timer);
  }, [fqdnValue]);

  const isIp = IP_PATTERN.test(debouncedFqdn);
  const dnsCheckable = debouncedFqdn.length >= 3 && !isIp;
  const dnsQuery = useQuery({
    queryKey: ['node-fqdn-check', debouncedFqdn],
    queryFn: () => resolveFqdn({ data: { fqdn: debouncedFqdn } }),
    enabled: dnsCheckable,
    staleTime: 60_000,
  });

  // Pelican-style layout: the "add node" form only shows behind the header button
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-6">
      {/* ─── Node list — filtering/sorting/pagination run in the database ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Nodes</CardTitle>
          <CardDescription>
            Machines hébergeant un agent Mojito.
          </CardDescription>
          <CardAction>
            <Button onClick={() => setShowCreate((v) => !v)}>
              <Plus />
              {showCreate ? 'Fermer' : 'Ajouter un node'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <DataTable
            list={adminNodesList}
            rows={query.data?.rows ?? []}
            rowCount={query.data?.rowCount ?? 0}
            search={search}
            onSearchChange={onSearchChange}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            emptyMessage="Aucun node enregistré."
            rowContext={{ canDelete, deleting: remove.isPending, onDelete }}
          />
        </CardContent>
      </Card>

      {/* ─── Create a node (hidden behind the list card's action button) ─── */}
      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Ajouter un node</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              className="space-y-4"
            >
              <form.Field name="fqdn">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="node-fqdn">
                      {isIp ? 'Adresse IP' : 'Nom de domaine (FQDN)'}
                    </Label>
                    <Input
                      id="node-fqdn"
                      autoFocus
                      placeholder="node1.example.com ou 192.168.1.10"
                      value={field.state.value}
                      onChange={(e) => {
                        const value = e.target.value;
                        field.handleChange(value);
                        // Pelican-style: prefill the display name from the
                        // subdomain while the name field is still empty.
                        const label = value.split('.')[0];
                        if (label && !/^\d+$/.test(label) && !form.getFieldValue('name')) {
                          form.setFieldValue('name', label);
                        }
                      }}
                      onBlur={field.handleBlur}
                    />
                    {dnsCheckable && dnsQuery.isPending && (
                      <p className="text-sm text-muted-foreground">
                        Vérification DNS…
                      </p>
                    )}
                    {dnsCheckable && !dnsQuery.isPending && (
                      <p
                        className={`text-sm ${dnsQuery.data?.ip ? 'text-emerald-600' : 'text-destructive'}`}
                      >
                        {dnsQuery.data?.ip
                          ? `Valide : ${dnsQuery.data.ip}`
                          : 'Introuvable — vérifie le DNS (ou indique une IP)'}
                      </p>
                    )}
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
                    <Label htmlFor="node-port">Port d’écoute</Label>
                    <Input
                      id="node-port"
                      type="number"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onBlur={field.handleBlur}
                    />
                    <p className="text-xs text-muted-foreground">Port que l’agent ouvre sur le node (shard.yml <code>api.port</code>).</p>
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
                    <Label htmlFor="node-public-port">Port accessible</Label>
                    <Input
                      id="node-public-port"
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
                    <p id="node-scheme" className="text-sm font-medium leading-none">
                      Communication SSL
                    </p>
                    <NodeSchemeField
                      id="node-scheme"
                      value={field.state.value}
                      onChange={(value) => field.handleChange(value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Équivalent Pelican « Communicate over SSL » : le panel et les
                      navigateurs (console WS) joignent l’agent via ce protocole, sur le
                      port accessible. Derrière un reverse proxy qui termine le TLS,
                      l’agent reste en HTTP sur son port d’écoute.
                    </p>
                  </div>
                )}
              </form.Field>

              <form.Field name="name">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="node-name">Nom d'affichage</Label>
                    <Input
                      id="node-name"
                      placeholder="Windows-01"
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

              <Button type="submit" className="w-full" disabled={create.isPending}>
                {create.isPending ? 'Création…' : 'Créer le node'}
              </Button>
            </form>

            {create.isError && (
              <p className="mt-2 text-sm text-destructive">{create.error.message}</p>
            )}

            {/* Agent config shown ONCE after creation — the token inside will
                never be displayed again */}
            {create.data?.agentToken && (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
                <p className="font-semibold text-amber-800 dark:text-amber-300">
                  Copie cette configuration maintenant — le token ne sera plus jamais affiché.
                </p>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Placer ce fichier <code>shard.yml</code> à côté de{' '}
                  <code>shard.exe</code> sur le node, puis démarrer l'agent.
                </p>
                <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs dark:bg-black/40">
                  {buildAgentConfig(create.data)}
                </pre>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(buildAgentConfig(create.data!))
                        .then(() => toast.success('Configuration shard.yml copiée'))
                        .catch(() => toast.error('Copie impossible — sélectionne le texte manuellement'));
                    }}
                  >
                    Copier la configuration
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    render={<Link to="/admin/nodes/$nodeId" params={{ nodeId: create.data.id }} />}
                  >
                    <ExternalLink />
                    Ouvrir la page du node
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
