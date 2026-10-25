import { type Href, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { shouldRedirectToPasswordReset } from '@/src/auth/recoveryRedirect';

/** Cold-start and in-app recovery: keep the user on the reset screen until they finish. */
export function AuthRecoveryGate() {
  const { loading, session, passwordRecoveryPending } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (
      !shouldRedirectToPasswordReset({
        loading,
        hasSession: Boolean(session),
        passwordRecoveryPending,
        pathname,
      })
    ) {
      return;
    }
    router.replace('/auth/reset-password' as Href);
  }, [loading, session, passwordRecoveryPending, pathname, router]);

  return null;
}
