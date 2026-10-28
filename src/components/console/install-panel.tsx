import { RefreshCw } from 'lucide-react';

import { InProgressBadge } from '~/components/status-badge';
import { Button } from '~/components/ui/button';

/** Minimal shape of the install status pushed by the agent over the WS. */
export interface InstallNoticeStatus {
  status: 'installing' | 'installed' | 'failed';
}

interface InstallNoticeProps {
  /** Live install status (null = pending, the WS has not pushed yet). */
  status: InstallNoticeStatus | null;
  /** Retry callback — undefined hides the button (no server.settings.update). */
  onRetry?: () => void;
  retryPending: boolean;
  retryError: string | null;
}

/**
 * Slim install notice — the steps stream into the console below, so a
 * one-line message is enough, plus the retry action when the install fails.
 */
export function InstallNotice({ status, onRetry, retryPending, retryError }: InstallNoticeProps) {
  if (status?.status === 'failed') {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">
        <span>Échec de l'installation</span>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retryPending}>
            <RefreshCw className={retryPending ? 'animate-spin' : undefined} />
            {retryPending ? 'Nouvelle tentative…' : 'Réessayer'}
          </Button>
        )}
        {retryError && <span>{retryError}</span>}
      </div>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <InProgressBadge label="Installation en cours" tone="blue" />
      <span>— suivez la progression ci-dessous.</span>
    </p>
  );
}
