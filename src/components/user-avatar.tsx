import { useEffect, useState } from 'react';
import { cn } from 'cn';

/**
 * User avatar — initials by default. When the panel setting `app:gravatar`
 * (admin > Paramètres) is enabled, the Gravatar of the e-mail (SHA-256,
 * `d=404`) is used, falling back to the initials while it loads, when the
 * account has no Gravatar, or when Web Crypto is unavailable.
 */
export function UserAvatar({
  name,
  email,
  gravatar,
  className,
}: {
  name: string | null | undefined;
  email: string | null | undefined;
  gravatar: boolean;
  className?: string;
}) {
  const [hash, setHash] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!gravatar || !email || crypto.subtle === undefined) {
      setHash(null);
      return;
    }
    let alive = true;
    crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
      .then((digest) => {
        if (!alive) return;
        setHash(
          Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(''),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [gravatar, email]);

  if (gravatar && hash !== null && !failed) {
    return (
      <img
        src={`https://gravatar.com/avatar/${hash}?s=64&d=404`}
        alt=""
        onError={() => setFailed(true)}
        className={cn('rounded-full object-cover', className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold',
        className,
      )}
    >
      {name?.charAt(0).toUpperCase() ?? '?'}
    </div>
  );
}
