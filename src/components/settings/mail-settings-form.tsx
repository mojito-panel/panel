import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { updateMailSettingsFn } from '~/server/functions/settings';
import {
  updateMailSettingsSchema,
  type ForcedSettings,
  type MailSettingsDto,
  type UpdateMailSettingsDto,
} from '~/validators/settings';
import {
  MAIL_ENCRYPTIONS,
  type MailDriver,
  type MailEncryption,
} from '~/lib/settings';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { SettingFieldShell } from './fields';

const MAIL_ENCRYPTION_LABELS: Record<MailEncryption, string> = {
  tls: 'TLS',
  starttls: 'STARTTLS',
  none: 'Aucun (déconseillé)',
};

/**
 * Mail tab content — SMTP transport (the only driver in V1; the `mail:driver`
 * key exists so other transports slot in later without a schema change). The
 * stored password is never round-tripped: an empty submit keeps the current
 * one (placeholder says whether one exists). Rendered inside the TabsCard
 * of /admin/settings.
 */
export function MailSettingsForm({
  mail,
  forced,
}: {
  mail: MailSettingsDto;
  forced: ForcedSettings;
}) {
  const queryClient = useQueryClient();
  const updateMail = useServerFn(updateMailSettingsFn);

  const update = useMutation({
    mutationFn: async (data: UpdateMailSettingsDto) => {
      const result = await updateMail({ data });
      await queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      return result;
    },
    onSuccess: () => toast.success('Paramètres mail enregistrés'),
    onError: (err) => toast.error(err.message),
  });

  const form = useForm({
    validators: { onChange: updateMailSettingsSchema },
    defaultValues: {
      driver: mail.driver,
      host: mail.host,
      port: mail.port,
      username: mail.username,
      password: '',
      encryption: mail.encryption,
      fromAddress: mail.fromAddress,
      fromName: mail.fromName,
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
      <form.Field name="driver">
        {(field) => (
          <SettingFieldShell
            id="settings-mail-driver"
            label="Driver"
            hint="Uniquement SMTP pour le moment — d’autres drivers à venir."
            errors={field.state.meta.errors}
          >
            <Select
              value={field.state.value}
              onValueChange={(value) =>
                value !== null && field.handleChange(value as MailDriver)
              }
            >
              <SelectTrigger id="settings-mail-driver" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="smtp">SMTP</SelectItem>
              </SelectContent>
            </Select>
          </SettingFieldShell>
        )}
      </form.Field>

      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <form.Field name="host">
          {(field) => (
            <SettingFieldShell
              id="settings-mail-host"
              label="Hôte SMTP"
              forced={forced['mail:smtp:host']}
              errors={field.state.meta.errors}
            >
              <Input
                id="settings-mail-host"
                placeholder="smtp.exemple.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                disabled={forced['mail:smtp:host'] !== undefined}
              />
            </SettingFieldShell>
          )}
        </form.Field>

        <form.Field name="port">
          {(field) => (
            <SettingFieldShell
              id="settings-mail-port"
              label="Port"
              forced={forced['mail:smtp:port']}
              errors={field.state.meta.errors}
            >
              <Input
                id="settings-mail-port"
                type="number"
                value={field.state.value}
                onChange={(e) => field.handleChange(Number(e.target.value))}
                onBlur={field.handleBlur}
                disabled={forced['mail:smtp:port'] !== undefined}
              />
            </SettingFieldShell>
          )}
        </form.Field>
      </div>

      <form.Field name="encryption">
        {(field) => (
          <SettingFieldShell
            id="settings-mail-encryption"
            label="Chiffrement"
            forced={forced['mail:smtp:encryption']}
            errors={field.state.meta.errors}
          >
            <Select
              value={field.state.value}
              onValueChange={(value) =>
                value !== null && field.handleChange(value as MailEncryption)
              }
              disabled={forced['mail:smtp:encryption'] !== undefined}
            >
              <SelectTrigger id="settings-mail-encryption" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAIL_ENCRYPTIONS.map((encryption) => (
                  <SelectItem key={encryption} value={encryption}>
                    {MAIL_ENCRYPTION_LABELS[encryption]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingFieldShell>
        )}
      </form.Field>

      <form.Field name="username">
        {(field) => (
          <SettingFieldShell
            id="settings-mail-username"
            label="Utilisateur"
            forced={forced['mail:smtp:username']}
            errors={field.state.meta.errors}
          >
            <Input
              id="settings-mail-username"
              autoComplete="off"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={forced['mail:smtp:username'] !== undefined}
            />
          </SettingFieldShell>
        )}
      </form.Field>

      <form.Field name="password">
        {(field) => (
          <SettingFieldShell
            id="settings-mail-password"
            label="Mot de passe"
            hint="Chiffré au repos — jamais renvoyé vers le navigateur."
            forced={forced['mail:smtp:password']}
            errors={field.state.meta.errors}
          >
            <Input
              id="settings-mail-password"
              type="password"
              autoComplete="new-password"
              placeholder={
                mail.hasPassword
                  ? '•••••••• — laisser vide pour conserver'
                  : 'Aucun mot de passe enregistré'
              }
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={forced['mail:smtp:password'] !== undefined}
            />
          </SettingFieldShell>
        )}
      </form.Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="fromAddress">
          {(field) => (
            <SettingFieldShell
              id="settings-mail-from-address"
              label="Adresse d’expédition"
              forced={forced['mail:from:address']}
              errors={field.state.meta.errors}
            >
              <Input
                id="settings-mail-from-address"
                placeholder="panel@exemple.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                disabled={forced['mail:from:address'] !== undefined}
              />
            </SettingFieldShell>
          )}
        </form.Field>

        <form.Field name="fromName">
          {(field) => (
            <SettingFieldShell
              id="settings-mail-from-name"
              label="Nom d’expédition"
              forced={forced['mail:from:name']}
              errors={field.state.meta.errors}
            >
              <Input
                id="settings-mail-from-name"
                placeholder="Mojito Panel"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                disabled={forced['mail:from:name'] !== undefined}
              />
            </SettingFieldShell>
          )}
        </form.Field>
      </div>

      <Button type="submit" disabled={update.isPending}>
        {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </Button>
    </form>
  );
}
