import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { CalendarClock } from 'lucide-react';
import { DataTable } from '~/components/data-table/data-table';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { ScheduleFormFields } from '~/components/schedule-form';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { serverSchedulesList, type ServerScheduleRow } from '~/lists/schedules';
import { getServerFn } from '~/server/functions/servers';
import {
  listSchedulesFn,
  createScheduleFn,
  deleteScheduleFn,
  runScheduleNowFn,
} from '~/server/functions/schedules';
import { hasServerPermissions } from '~/lib/permissions';
import { scheduleEditFormSchema, type ScheduleEditFormDto } from '~/validators/schedules';

/**
 * /servers/$serverId/schedules — the cron schedules of one server (Pelican
 * "Schedules" tab). The list definition (`~/lists/schedules`) holds the
 * columns AND the query it accepts; the state lives in the URL search
 * params. Creating opens the shared schedule form in a dialog and lands
 * on the detail page of the new schedule.
 */
export const Route = createFileRoute('/servers/$serverId/schedules/')({
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    serverSchedulesList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(serverSchedulesList.defaultSearch)] },
  component: ServerSchedulesPage,
});

/** Default form values of the create dialog — one runnable starter task. */
const CREATE_DEFAULTS: ScheduleEditFormDto = {
  name: '',
  cron: '0 4 * * *',
  timezone: 'Europe/Paris',
  onlyWhenOnline: false,
  isActive: true,
  tasks: [{ action: 'power', payload: 'restart', timeOffset: 0, continueOnFailure: false }],
};

function ServerSchedulesPage() {
  const { serverId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ServerScheduleRow | null>(null);

  const getServer = useServerFn(getServerFn);
  const listSchedules = useServerFn(listSchedulesFn);
  const createSchedule = useServerFn(createScheduleFn);
  const runScheduleNow = useServerFn(runScheduleNowFn);
  const deleteSchedule = useServerFn(deleteScheduleFn);

  // Shared server query (cached) — viewer grants gate the page controls
  const serverQuery = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });
  const permissions = serverQuery.data?.viewer?.permissions ?? [];

  const canCreate = hasServerPermissions(permissions, { 'server.schedules': ['create'] });
  const canUpdate = hasServerPermissions(permissions, { 'server.schedules': ['update'] });
  const canDelete = hasServerPermissions(permissions, { 'server.schedules': ['delete'] });
  const canRead = hasServerPermissions(permissions, { 'server.schedules': ['read'] });

  // Poll while a schedule is mid-run — the claim clears when the chain ends.
  const query = useQuery({
    queryKey: ['server-schedules', serverId, search],
    queryFn: () => listSchedules({ data: { ...search, serverId } }),
    placeholderData: keepPreviousData,
    refetchInterval: (current) => {
      const processing = current.state.data?.rows?.some((row) => row.isProcessing) ?? false;
      return processing ? 10_000 : false;
    },
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['server-schedules', serverId] });
    // Sidebar badge (schedule count) lives on the shared detail query
    await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
  };

  const create = useMutation({
    mutationFn: (value: ScheduleEditFormDto) =>
      createSchedule({ data: { ...value, serverId } }),
    onSuccess: async (schedule) => {
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['server-schedules', serverId] });
      toast.success('Planification créée');
      await navigate({
        to: '/servers/$serverId/schedules/$scheduleId',
        params: { serverId, scheduleId: schedule.id },
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const runNow = useMutation({
    mutationFn: (scheduleId: string) => runScheduleNow({ data: { serverId, scheduleId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Exécution lancée');
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (scheduleId: string) => deleteSchedule({ data: { serverId, scheduleId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Planification supprimée');
    },
    onError: (error) => toast.error(error.message),
  });

  // Create dialog — the same shared form as the detail page, minus the
  // active toggle (a schedule is born active).
  const form = useForm({
    defaultValues: CREATE_DEFAULTS,
    validators: { onChange: scheduleEditFormSchema },
    onSubmit: ({ value }) => create.mutate(value),
  });

  // Search updates write the WHOLE validated query back: the page resets
  // below are part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  if (serverQuery.isSuccess && !canRead) {
    return (
      <p className="text-sm text-muted-foreground">
        Tu n’as pas la permission de gérer les planifications de ce serveur.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Planifications</CardTitle>
          <CardDescription>
            Déclenche des actions (alimentation, commandes) à des moments
            planifiés — les tâches s’enchaînent avec un délai entre chacune.
          </CardDescription>
          {canCreate && (
            <CardAction>
              <Button onClick={() => setCreateOpen(true)}>
                <CalendarClock />
                Créer une planification
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <DataTable
            list={serverSchedulesList}
            rows={query.data?.rows ?? []}
            rowCount={query.data?.rowCount ?? 0}
            search={search}
            onSearchChange={onSearchChange}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            emptyMessage="Aucune planification pour l’instant."
            rowContext={{
              canUpdate,
              canDelete,
              runningNow: runNow.isPending,
              deleting: remove.isPending,
              onRunNow: (schedule) => runNow.mutate(schedule.id),
              onEdit: (schedule) =>
                void navigate({
                  to: '/servers/$serverId/schedules/$scheduleId',
                  params: { serverId, scheduleId: schedule.id },
                }),
              onDelete: setToDelete,
            }}
          />
        </CardContent>
      </Card>

      {/* ─── Create dialog — the shared schedule form ─── */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            form.reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Créer une planification</DialogTitle>
            <DialogDescription>
              L’expression cron est évaluée dans le fuseau horaire choisi — la
              prochaine exécution est calculée à la sauvegarde.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <div className="space-y-6">
              <ScheduleFormFields form={form} />
              <form.Subscribe selector={(s) => [s.isSubmitting, create.isPending]}>
                {([isSubmitting, pending]) => (
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCreateOpen(false);
                        form.reset();
                      }}
                    >
                      Annuler
                    </Button>
                    <Button type="submit" disabled={isSubmitting || pending}>
                      {pending ? 'Création…' : 'Créer'}
                    </Button>
                  </DialogFooter>
                )}
              </form.Subscribe>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await remove.mutateAsync(toDelete.id);
            setToDelete(null);
          } catch {
            // Toasted by the mutation — keep the dialog open.
          }
        }}
        title={`Supprimer « ${toDelete?.name ?? ''} » ?`}
        description="Une exécution déjà en cours s’achève ; plus aucune ne se déclenchera."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}
