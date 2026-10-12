import { useAuth } from '~/contexts/use-auth';
import { buildSftpUsername } from '~/lib/sftp';
import { KeyRound } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';

/** Read-only info row of the SFTP connection details. */
function SftpInfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * SFTP connection details (Pelican "SFTP Configuration" equivalent) behind
 * an "SFTP" toolbar button — host `fqdn:sftpPort`, username
 * `{username}.{serverId}`, password = the panel account password. Shown to
 * users holding any server.files.* grant — the same grants that gate the
 * SFTP permissions server-side.
 */
export function SftpConnectionDialog({
  fqdn,
  sftpPort,
  serverId,
}: {
  fqdn: string;
  sftpPort: number;
  serverId: string;
}) {
  const { user } = useAuth();

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <KeyRound />
        SFTP
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connexion SFTP</DialogTitle>
          <DialogDescription>
            Accès direct aux fichiers du serveur avec un client SFTP
            (FileZilla, WinSCP…). Le mot de passe est celui de ton compte
            panel.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y">
          <SftpInfoRow label="Hôte" value={`${fqdn}:${sftpPort}`} />
          <SftpInfoRow label="Port" value={sftpPort} />
          <SftpInfoRow label="Identifiant" value={buildSftpUsername(user?.username ?? '…', serverId)} />
          <SftpInfoRow label="Mot de passe" value="Ton mot de passe panel" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
