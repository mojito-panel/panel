import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getSettingsFn } from '~/server/functions/settings';
import { GeneralSettingsCard } from '~/components/settings/general-settings-card';
import { MailSettingsCard } from '~/components/settings/mail-settings-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';

/**
 * /admin/settings — global panel settings (Pelican admin "Settings" parity):
 * a tabbed record page. Général (name, favicon, Gravatar, registration) and
 * Mail (SMTP). Fields whose key is forced by an environment variable
 * (MOJITO_*, see ~/lib/settings) are locked — the DB value is ignored. The
 * forms live in components/settings/ (one card per tab).
 */
export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const getSettings = useServerFn(getSettingsFn);

  const query = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => getSettings(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Paramètres</h1>
        <p className="text-muted-foreground">
          Réglages globaux du panel — général et messagerie.
        </p>
      </div>

      {query.isPending && (
        <p className="text-muted-foreground">Chargement des paramètres…</p>
      )}
      {query.isError && (
        <p className="text-sm text-destructive">{query.error.message}</p>
      )}

      {query.data && (
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">Général</TabsTrigger>
            <TabsTrigger value="mail">Mail</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-4">
            {/* Mounted only once the settings are loaded — useForm freezes
                its defaultValues at mount (same pattern as the node page). */}
            <GeneralSettingsCard general={query.data.general} forced={query.data.forced} />
          </TabsContent>

          <TabsContent value="mail" className="mt-4">
            <MailSettingsCard mail={query.data.mail} forced={query.data.forced} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
