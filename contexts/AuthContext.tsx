import { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { supabase } from '@/src/services/supabase';

WebBrowser.maybeCompleteAuthSession();

function formatSignInError(err: { message: string; code?: string } | null): string | null {
  if (!err) return null;
  const code = err.code;
  const msg = err.message;

  if (code === 'email_not_confirmed') {
    return 'Your email is not confirmed yet. Open the Supabase confirmation email (check spam), tap the link, then sign in again.\n\nFor testing: Supabase → Authentication → Providers → Email → disable "Confirm email".';
  }

  if (code === 'invalid_credentials') {
    return 'Invalid email or password.\n\n• If you signed up with "Continue with Google", use that button — password sign-in will not work for that account.\n• If you just registered by email, confirm the link in your inbox first.\n• Otherwise reset the password in Supabase → Authentication → Users (or use Forgot password when we add it).';
  }

  if (code === 'user_banned') {
    return 'This account is disabled. Check Supabase → Authentication → Users.';
  }

  if (code === 'provider_email_needs_verification') {
    return 'Google needs you to verify the email on their side, or the account is linked differently. Try Google sign-in again or use a different email.';
  }

  return msg;
}

function getAuthParamsFromUrl(url: string): Record<string, string> {
  const params: Record<string, string> = {};

  const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  const hash = url.includes('#') ? url.split('#')[1] : '';

  if (query) {
    const q = new URLSearchParams(query);
    q.forEach((value, key) => {
      params[key] = value;
    });
  }

  if (hash) {
    const h = new URLSearchParams(hash);
    h.forEach((value, key) => {
      params[key] = value;
    });
  }

  return params;
}

type SignUpPayload = {
  fullName: string;
  username: string;
  email: string;
  password: string;
};

export type SignUpResult = {
  error: string | null;
  /** Supabase has "Confirm email" enabled: user must click link, then use Sign in. */
  needsEmailConfirmation: boolean;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUpWithEmail: (payload: SignUpPayload) => Promise<SignUpResult>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session ?? null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setLoading(false);
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
      signUpWithEmail: async ({ fullName, username, email, password }) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              username,
            },
          },
        });

        if (error) {
          return { error: error.message ?? 'Sign up failed', needsEmailConfirmation: false };
        }

        const needsEmailConfirmation = !data.session && !!data.user;
        return { error: null, needsEmailConfirmation };
      },
      signInWithEmail: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error && __DEV__) {
          console.log('[auth] signIn error', { code: (error as { code?: string }).code, message: error.message });
        }
        return { error: formatSignInError(error as { message: string; code?: string }) };
      },
      signInWithGoogle: async () => {
        // Use a real Expo Router route, not the app root. The exact generated
        // value must be allowlisted in Supabase Auth → URL Configuration.
        const redirectTo = Linking.createURL('auth/callback');
        if (__DEV__) {
          console.log(
            '[auth] OAuth redirect URL (allowlist this exact value in Supabase):',
            redirectTo,
          );
        }
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            skipBrowserRedirect: true,
          },
        });

        if (error) return { error: error.message };
        if (!data?.url) return { error: 'Unable to start Google sign in.' };

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (__DEV__) {
          const urlHint = result.type === 'success' && result.url ? `${result.url.split('?')[0]}…` : '(none)';
          console.log('[auth] OAuth WebBrowser result:', result.type, urlHint);
        }
        if (result.type === 'cancel' || result.type === 'dismiss') {
          return { error: 'Google sign in canceled.' };
        }
        if (result.type !== 'success' || !result.url) {
          return { error: 'Google sign in did not return a valid callback URL.' };
        }

        const params = getAuthParamsFromUrl(result.url);
        if (params.error_description || params.error) {
          return { error: params.error_description || params.error || 'Google sign in failed.' };
        }

        if (params.code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
          if (exchangeError) {
            const m = exchangeError.message ?? '';
            if (
              m.toLowerCase().includes('code verifier') ||
              m.toLowerCase().includes('non-empty') ||
              (exchangeError as { code?: string }).code === 'validation_failed'
            ) {
              return {
                error:
                  'OAuth could not complete (PKCE verifier missing). This is fixed in the current build by using AsyncStorage for auth — reload the app and try Google again.',
              };
            }
            if (__DEV__) {
              console.log('[auth] exchangeCodeForSession error', {
                message: m,
                code: (exchangeError as { code?: string }).code,
              });
            }
            return { error: m };
          }
          return { error: null };
        }

        if (params.access_token && params.refresh_token) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
          return { error: setSessionError?.message ?? null };
        }

        return { error: 'Google sign in callback did not contain session tokens.' };
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

