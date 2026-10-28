import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { updateGeneralSettingsFn } from '~/server/functions/settings';
import {
  updateGeneralSettingsSchema,
  type ForcedSettings,
  type GeneralSettingsDto,
  type UpdateGeneralSettingsDto,
} from '~/validators/settings';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { SettingFieldShell, SettingSwitchRow } from './fields';

/**
 * General tab content — App Name, favicon, Gravatar avatars, public
 * registration. Rendered inside the TabsCard of /admin/settings.
 * Mounted only once the settings are loaded: useForm freezes its
 * defaultValues at mount (same pattern as the node edit page).
 */
export function GeneralSettingsForm({
  general,
  forced,
}: {
  general: GeneralSettingsDto;
  forced: ForcedSettings;
}) {
  const queryClient = useQueryClient();
  const updateGeneral = useServerFn(updateGeneralSettingsFn);

  const update = useMutation({
    mutationFn: async (data: UpdateGeneralSettingsDto) => {
      const result = await updateGeneral({ data });
      // Branding (title/favicon/avatars/registration) derives from these keys
      await queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['branding'] });
      return result;
    },
    onSuccess: () => toast.success('Paramètres généraux enregistrés'),
    onError: (err) => toast.error(err.message),
  });

  const form = useForm({
    validators: { onChange: updateGeneralSettingsSchema },
    defaultValues: {
      appName: general.appName,
      favicon: general.favicon,
      gravatar: general.gravatar,
      registrationEnabled: general.registrationEnabled,
      marketplaceSyncInterval: general.marketplaceSyncInterval,
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
      <form.Field name="appName">
        {(field) => (
          <SettingFieldShell
            id="settings-app-name"
            label="Nom de l’application"
            forced={forced['app:name']}
            errors={field.state.meta.errors}
          >
            <Input
              id="settings-app-name"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={forced['app:name'] !== undefined}
            />
          </SettingFieldShell>
        )}
      </form.Field>

      <form.Field name="favicon">
        {(field) => (
          <SettingFieldShell
            id="settings-favicon"
            label="Favicon"
            hint="URL http(s) d’une icône — laissée vide, l’icône par défaut du navigateur s’applique."
            forced={forced['app:favicon']}
            errors={field.state.meta.errors}
          >
            <Input
              id="settings-favicon"
              placeholder="https://exemple.com/favicon.ico"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={forced['app:favicon'] !== undefined}
            />
          </SettingFieldShell>
        )}
      </form.Field>

      <form.Field name="gravatar">
        {(field) => (
          <SettingSwitchRow
            id="settings-gravatar"
            label="Avatars Gravatar"
            description="Utilise l’avatar Gravatar associé à l’e-mail de chaque utilisateur (initiales sinon)."
            checked={field.state.value}
            onChange={(checked) => field.handleChange(checked)}
            forced={forced['app:gravatar']}
          />
        )}
      </form.Field>

      <form.Field name="registrationEnabled">
        {(field) => (
          <SettingSwitchRow
            id="settings-registration"
            label="Inscription des utilisateurs"
            description="Autorise la création de compte public via /register. La création d’un compte par un administrateur reste toujours possible."
            checked={field.state.value}
            onChange={(checked) => field.handleChange(checked)}
            forced={forced['app:registration_enabled']}
          />
        )}
      </form.Field>

      <form.Field name="marketplaceSyncInterval">
        {(field) => (
          <SettingFieldShell
            id="settings-marketplace-interval"
            label="Vérification marketplace (minutes)"
            hint="Intervalle entre les vérifications automatiques des mises à jour de recettes (registres et URLs). 0 = vérification manuelle uniquement — le bouton « Synchroniser » reste toujours disponible."
            forced={forced['marketplace:sync_interval']}
            errors={field.state.meta.errors}
          >
            <Input
              id="settings-marketplace-interval"
              type="number"
              min={0}
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
              onBlur={field.handleBlur}
              disabled={forced['marketplace:sync_interval'] !== undefined}
            />
          </SettingFieldShell>
        )}
      </form.Field>

      <Button type="submit" disabled={update.isPending}>
        {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </Button>
    </form>
  );
}
