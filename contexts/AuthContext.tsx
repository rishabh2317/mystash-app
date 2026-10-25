import { Session, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { AUTH_COPY, formatAuthError } from '@/src/auth/authErrors';
import { completeAuthCallback, getAuthParamsFromUrl } from '@/src/auth/authCallback';
import { isAuthEmailVerified } from '@/src/auth/emailVerified';
import {
  beginInAppAuthSession,
  endInAppAuthSession,
  interpretAuthSessionResult,
} from '@/src/auth/oauthCallbackOwnership';
import { supabaseAuthCallbackDeps } from '@/src/auth/supabaseAuthCallback';
import { passwordMeetsPolicy, passwordPolicyMessage } from '@/src/auth/passwordPolicy';
import {
  clearPendingConfirmationEmail,
  readPasswordRecoveryPending,
  readPendingConfirmationEmail,
  writePasswordRecoveryPending,
  writePendingConfirmationEmail,
  RESEND_LAST_SENT_KEY,
} from '@/src/auth/pendingAuth';
import { canResendConfirmation } from '@/src/auth/resendCooldown';
import {
  type AuthIntent,
  appendAuthIntentToRedirectUrl,
} from '@/src/navigation/authIntent';
import { unlinkPushBeforeSignOut } from '@/src/notifications/pushRegistration';
import { supabase } from '@/src/services/supabase';

WebBrowser.maybeCompleteAuthSession();

function authCallbackUrl(): string {
  return Linking.createURL('auth/callback');
}

/** Host + path only. Never include query, hash, codes, or tokens. */
function oauthUrlDiagnostic(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '(unparseable)';
  }
}

type SignUpPayload = {
  fullName: string;
  username: string;
  email: string;
  password: string;
};

export type SignUpResult = {
  error: string | null;
  /** Confirm email is required: no session until the link is opened. */
  needsEmailConfirmation: boolean;
};

export type GoogleSignInOptions = {
  authIntent?: AuthIntent | null;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  emailVerified: boolean;
  pendingConfirmationEmail: string | null;
  passwordRecoveryPending: boolean;
  signUpWithEmail: (payload: SignUpPayload) => Promise<SignUpResult>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: (options?: GoogleSignInOptions) => Promise<{ error: string | null }>;
  resendConfirmationEmail: (email?: string) => Promise<{ error: string | null }>;
  dismissPendingConfirmation: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);

  useEffect(() => {
    let mounted = true;

    void Promise.all([
      supabase.auth.getSession(),
      readPendingConfirmationEmail(AsyncStorage),
      readPasswordRecoveryPending(AsyncStorage),
    ]).then(([sessionResult, pendingEmail, recovery]) => {
      if (!mounted) return;
      const next = sessionResult.data.session ?? null;
      setSession(next);
      setPendingConfirmationEmail(pendingEmail);
      setPasswordRecoveryPending(recovery);
      if (next?.user && isAuthEmailVerified(next.user)) {
        void clearPendingConfirmationEmail(AsyncStorage);
        setPendingConfirmationEmail(null);
      }
    }).finally(() => {
      if (mounted) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession ?? null);
      setLoading(false);
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryPending(true);
        void writePasswordRecoveryPending(AsyncStorage, true);
      }
      if (nextSession?.user && isAuthEmailVerified(nextSession.user) && event !== 'PASSWORD_RECOVERY') {
        void clearPendingConfirmationEmail(AsyncStorage);
        setPendingConfirmationEmail(null);
      }
      if (!nextSession) {
        setPasswordRecoveryPending(false);
        void writePasswordRecoveryPending(AsyncStorage, false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      emailVerified: isAuthEmailVerified(session?.user),
      pendingConfirmationEmail,
      passwordRecoveryPending,
      signUpWithEmail: async ({ fullName, username, email, password }) => {
        if (!passwordMeetsPolicy(password)) {
          return { error: passwordPolicyMessage(), needsEmailConfirmation: false };
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: authCallbackUrl(),
            data: {
              full_name: fullName,
              username,
            },
          },
        });

        if (error) {
          return { error: formatAuthError(error, 'signup'), needsEmailConfirmation: false };
        }

        const needsEmailConfirmation = !data.session && !!data.user;
        if (needsEmailConfirmation) {
          await writePendingConfirmationEmail(AsyncStorage, email);
          setPendingConfirmationEmail(email.trim().toLowerCase());
          await AsyncStorage.setItem(RESEND_LAST_SENT_KEY, String(Date.now()));
        }
        return { error: null, needsEmailConfirmation };
      },
      signInWithEmail: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error && __DEV__) {
          console.log('[auth] signIn error', { code: (error as { code?: string }).code });
        }
        return { error: error ? formatAuthError(error, 'signin') : null };
      },
      signInWithGoogle: async (options) => {
        const redirectBase = Linking.createURL('auth/callback');
        const redirectTo = appendAuthIntentToRedirectUrl(
          redirectBase,
          options?.authIntent ?? null,
        );
        if (__DEV__) {
          console.log('[auth] OAuth redirect path', oauthUrlDiagnostic(redirectTo));
        }
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            skipBrowserRedirect: true,
          },
        });

        if (error) return { error: formatAuthError(error, 'google') };
        if (!data?.url) return { error: 'Unable to start Google sign in.' };

        beginInAppAuthSession();
        try {
          const result = await WebBrowser.openAuthSessionAsync(data.url, redirectBase);
          if (__DEV__) {
            const urlHint =
              result.type === 'success' && result.url ? oauthUrlDiagnostic(result.url) : '(none)';
            console.log('[auth] OAuth WebBrowser result:', result.type, urlHint);
          }
          const interpreted = interpretAuthSessionResult(result);
          if (interpreted.kind === 'cancel') {
            return { error: AUTH_COPY.googleCanceled };
          }
          if (interpreted.kind === 'error') {
            return { error: interpreted.message };
          }

          const params = getAuthParamsFromUrl(interpreted.url);
          const completed = await completeAuthCallback(supabaseAuthCallbackDeps(), params);
          void WebBrowser.dismissBrowser().catch(() => undefined);
          if (completed.status === 'error') {
            return { error: completed.message ?? AUTH_COPY.googleFailed };
          }
          if (completed.status === 'password_recovery') {
            await writePasswordRecoveryPending(AsyncStorage, true);
            setPasswordRecoveryPending(true);
          }
          return { error: null };
        } finally {
          endInAppAuthSession();
        }
      },
      dismissPendingConfirmation: async () => {
        await clearPendingConfirmationEmail(AsyncStorage);
        setPendingConfirmationEmail(null);
      },
      resendConfirmationEmail: async (email) => {
        const target = (email ?? pendingConfirmationEmail ?? session?.user?.email ?? '').trim();
        if (!target) return { error: 'Enter the email you used to sign up.' };
        const raw = await AsyncStorage.getItem(RESEND_LAST_SENT_KEY);
        const last = raw ? Number(raw) : null;
        if (!canResendConfirmation(Number.isFinite(last) ? last : null)) {
          return { error: formatAuthError({ code: 'over_email_send_rate_limit' }, 'resend') };
        }
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: target,
          options: { emailRedirectTo: authCallbackUrl() },
        });
        if (error) return { error: formatAuthError(error, 'resend') };
        await writePendingConfirmationEmail(AsyncStorage, target);
        setPendingConfirmationEmail(target.toLowerCase());
        await AsyncStorage.setItem(RESEND_LAST_SENT_KEY, String(Date.now()));
        return { error: null };
      },
      requestPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: authCallbackUrl(),
        });
        if (error) {
          const formatted = formatAuthError(error, 'recovery');
          if (formatted === AUTH_COPY.offline || formatted === AUTH_COPY.rateLimited) {
            return { error: formatted };
          }
        }
        return { error: null };
      },
      updatePassword: async (password) => {
        if (!passwordMeetsPolicy(password)) {
          return { error: passwordPolicyMessage() };
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return { error: formatAuthError(error, 'update-password') };
        await writePasswordRecoveryPending(AsyncStorage, false);
        setPasswordRecoveryPending(false);
        return { error: null };
      },
      signOut: async () => {
        await unlinkPushBeforeSignOut().catch(() => undefined);
        await clearPendingConfirmationEmail(AsyncStorage);
        await writePasswordRecoveryPending(AsyncStorage, false);
        setPendingConfirmationEmail(null);
        setPasswordRecoveryPending(false);
        await supabase.auth.signOut();
      },
    }),
    [session, loading, pendingConfirmationEmail, passwordRecoveryPending],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
