import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { ArrowLeft, Play, Save, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { ScheduleFormFields } from '~/components/schedule-form';
import { cronToHuman } from '~/lib/cron';
import { serverCan } from '~/lib/permissions';
import { serverSchedulesList } from '~/lists/schedules';
import { getServerFn } from '~/server/functions/servers';
import {
  getScheduleFn,
  updateScheduleFn,
  runScheduleNowFn,
  deleteScheduleFn,
} from '~/server/functions/schedules';
import { scheduleEditFormSchema, type ScheduleEditFormDto } from '~/validators/schedules';

/**
 * /servers/$serverId/schedules/$scheduleId — one schedule: edit form (the
 * shared schedule fields + the active toggle), "run now", and deletion.
 * The form mounts only once the schedule is loaded (a TanStack Form takes
 * its default values once, from the query data).
 */
export const Route = createFileRoute('/servers/$serverId/schedules/$scheduleId/')({
  component: ServerScheduleDetailPage,
});

/** The schedule detail payload (getScheduleFn). */
interface ScheduleDetail {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  isActive: boolean;
  isProcessing: boolean;
  onlyWhenOnline: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  tasks: { id: string; sequenceId: number; action: 'power' | 'command'; payload: string; timeOffset: number; continueOnFailure: boolean }[];
}

/** Task rows → the form's discriminated task union (payload cast is validated server-side). */
function toFormTasks(tasks: ScheduleDetail['tasks']): ScheduleEditFormDto['tasks'] {
  return tasks.map((task) =>
    task.action === 'power'
      ? {
          action: 'power',
          payload: task.payload as 'start' | 'stop' | 'restart' | 'kill',
          timeOffset: task.timeOffset,
          continueOnFailure: task.continueOnFailure,
        }
      : {
          action: 'command',
          payload: task.payload,
          timeOffset: task.timeOffset,
          continueOnFailure: task.continueOnFailure,
        },
  );
}

function ServerScheduleDetailPage() {
  const { serverId, scheduleId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const getServer = useServerFn(getServerFn);
  const getSchedule = useServerFn(getScheduleFn);
  const updateSchedule = useServerFn(updateScheduleFn);
  const runScheduleNow = useServerFn(runScheduleNowFn);
  const deleteSchedule = useServerFn(deleteScheduleFn);

  const serverQuery = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });
  const permissions = serverQuery.data?.viewer?.permissions ?? [];
  const canUpdate = serverCan(permissions, { 'server.schedules': ['update'] });
  const canDelete = serverCan(permissions, { 'server.schedules': ['delete'] });

  // Poll while the chain runs — the claim clears when the last task ends.
  const query = useQuery({
    queryKey: ['server-schedule', serverId, scheduleId],
    queryFn: () => getSchedule({ data: { serverId, scheduleId } }),
    refetchInterval: (current) => (current.state.data?.isProcessing ? 10_000 : false),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['server-schedule', serverId, scheduleId] });
    await queryClient.invalidateQueries({ queryKey: ['server-schedules', serverId] });
  };

  const update = useMutation({
    mutationFn: (value: ScheduleEditFormDto) =>
      updateSchedule({ data: { ...value, serverId, scheduleId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Planification enregistrée');
    },
    onError: (error) => toast.error(error.message),
  });

  const runNow = useMutation({
    mutationFn: () => runScheduleNow({ data: { serverId, scheduleId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Exécution lancée');
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteSchedule({ data: { serverId, scheduleId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['server-schedules', serverId] });
      toast.success('Planification supprimée');
      await navigate({
        to: '/servers/$serverId/schedules',
        params: { serverId },
        search: serverSchedulesList.defaultSearch,
      });
    },
    onError: (error) => toast.error(error.message),
  });

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }
  if (query.error || !query.data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">
          {query.error?.message ?? 'Planification introuvable'}
        </p>
        <Button
          variant="outline"
          render={
            <Link
              to="/servers/$serverId/schedules"
              params={{ serverId }}
              search={serverSchedulesList.defaultSearch}
            />
          }
        >
          <ArrowLeft />
          Retour aux planifications
        </Button>
      </div>
    );
  }

  const schedule = query.data satisfies ScheduleDetail;

  return (
    <div className="space-y-6">
      {/* ─── Summary ─── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{schedule.name}</CardTitle>
              <CardDescription>
                {cronToHuman(schedule.cron)} · {schedule.timezone}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {schedule.isProcessing ? (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  En cours…
                </span>
              ) : schedule.isActive ? (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Active
                </span>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Inactive
                </span>
              )}
              {canUpdate && (
                <Button
                  variant="outline"
                  disabled={schedule.isProcessing || !schedule.isActive || runNow.isPending}
                  onClick={() => runNow.mutate()}
                >
                  <Play />
                  Exécuter maintenant
                </Button>
              )}
              {canDelete && (
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 />
                  Supprimer
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Prochaine exécution :{' '}
          {schedule.isActive ? (schedule.nextRunAt?.toLocaleString('fr-FR') ?? '—') : '—'} ·
          Dernière exécution :{' '}
          {schedule.lastRunAt ? schedule.lastRunAt.toLocaleString('fr-FR') : 'jamais'}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Supprimer « ${schedule.name} » ?`}
        description="Une exécution déjà en cours s’achève ; plus aucune ne se déclenchera."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          remove.mutate();
          setDeleteOpen(false);
        }}
      />

      {/* ─── Edit form (the shared schedule fields + the active toggle) ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Modifier la planification</CardTitle>
          <CardDescription>
            Toute la liste de tâches est remplacée à l’enregistrement ;
            l’expression cron est réévaluée et la prochaine exécution
            recalculée.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canUpdate ? (
            <ScheduleEditForm
              initial={{
                name: schedule.name,
                cron: schedule.cron,
                timezone: schedule.timezone,
                onlyWhenOnline: schedule.onlyWhenOnline,
                isActive: schedule.isActive,
                tasks: toFormTasks(schedule.tasks),
              }}
              submitting={update.isPending}
              onSubmit={(value) => update.mutate(value)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Tu n’as pas la permission de modifier cette planification.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** The edit form — mounts once the schedule is loaded (default values are final). */
function ScheduleEditForm({
  initial,
  submitting,
  onSubmit,
}: {
  initial: ScheduleEditFormDto;
  submitting: boolean;
  onSubmit: (value: ScheduleEditFormDto) => void;
}) {
  const form = useForm({
    defaultValues: initial,
    validators: { onChange: scheduleEditFormSchema },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="space-y-4">
        <ScheduleFormFields form={form} canDeactivate />
        <form.Subscribe selector={(s) => [s.isSubmitting, submitting]}>
          {([isSubmitting, pending]) => (
            <Button type="submit" disabled={isSubmitting || pending}>
              <Save />
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
