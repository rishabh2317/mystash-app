import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import {
  ConnectedAccountsApiError,
  connectProviderWithBrowser,
  disconnectConnectedAccount,
  listConnectedAccounts,
  type ConnectedAccountProvider,
  type ConnectedAccountsSnapshot,
} from '@/src/services/connectedAccountsApi';
import {
  abandonCreatorOnboarding,
  completeCreatorOnboarding,
  ensureMe,
  startCreatorOnboarding,
  updateMyProfile,
  UserApiError,
  type UserSettingsViewModel,
} from '@/src/services/userApi';
import { createOnboardingDisplayName } from '@/src/ui/createCopy';
import {
  CREATOR_ONBOARDING_BIO_MAX,
  creatorOnboardingInitialStep,
  creatorOnboardingNeedsStart,
  type CreatorOnboardingStep,
} from '@/src/ui/creatorOnboarding';
import { pickProviderAccount } from '@/src/ui/connectedAccounts';
import { SETTINGS_COPY } from '@/src/ui/settingsHub';

type Options = {
  onActivated: (me: UserSettingsViewModel) => void;
  onAlreadyActive?: (me: UserSettingsViewModel) => void;
  onSuspended?: (me: UserSettingsViewModel) => void;
  onCancel?: () => void;
};

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof UserApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * Canonical creator onboarding: profile → optional social → complete.
 * Starts `ONBOARDING` only on Continue, never on mount. Completes only
 * after step 2 so social connections are not skipped.
 */
export function useCreatorOnboarding({
  onActivated,
  onAlreadyActive,
  onSuspended,
  onCancel,
}: Options) {
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;
  const onActivatedRef = useRef(onActivated);
  const onAlreadyActiveRef = useRef(onAlreadyActive);
  const onSuspendedRef = useRef(onSuspended);
  const onCancelRef = useRef(onCancel);
  onActivatedRef.current = onActivated;
  onAlreadyActiveRef.current = onAlreadyActive;
  onSuspendedRef.current = onSuspended;
  onCancelRef.current = onCancel;

  const [me, setMe] = useState<UserSettingsViewModel | null>(null);
  const [step, setStep] = useState<CreatorOnboardingStep>('profile');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<ConnectedAccountsSnapshot | null>(null);
  const [connectedBusy, setConnectedBusy] = useState(false);

  const applyProfileFields = useCallback((next: UserSettingsViewModel) => {
    const meta = userRef.current?.user_metadata;
    const fullName =
      (typeof meta?.full_name === 'string' && meta.full_name) ||
      (typeof meta?.name === 'string' && meta.name) ||
      null;
    setDisplayName(
      createOnboardingDisplayName({
        displayName: next.displayName,
        username: next.username,
        fullName,
      }) ?? '',
    );
    setBio(next.bio ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await ensureMe();
      setMe(next);
      applyProfileFields(next);
      setStep(creatorOnboardingInitialStep(next.creatorStatus));
      if (next.creatorStatus === 'ACTIVE') {
        onAlreadyActiveRef.current?.(next);
        return;
      }
      if (next.creatorStatus === 'SUSPENDED') {
        onSuspendedRef.current?.(next);
        return;
      }
      try {
        setConnected(await listConnectedAccounts());
      } catch {
        setConnected(null);
      }
    } catch (e) {
      setMe(null);
      setError(messageOf(e, 'Could not load account'));
    } finally {
      setLoading(false);
    }
  }, [applyProfileFields]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = async (): Promise<UserSettingsViewModel> => {
    const trimmedBio = bio.trim();
    if (trimmedBio.length > CREATOR_ONBOARDING_BIO_MAX) {
      throw new Error(`Bio must be at most ${CREATOR_ONBOARDING_BIO_MAX} characters`);
    }
    return updateMyProfile({
      displayName: displayName.trim() || null,
      bio: trimmedBio || null,
    });
  };

  const onContinueProfile = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let next = await saveProfile();
      if (creatorOnboardingNeedsStart(next.creatorStatus)) {
        next = await startCreatorOnboarding();
      }
      setMe(next);
      setStep('social');
    } catch (e) {
      setError(messageOf(e, 'Could not save profile'));
    } finally {
      setBusy(false);
    }
  };

  const onBecomeCreator = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let next = await saveProfile();
      if (creatorOnboardingNeedsStart(next.creatorStatus)) {
        next = await startCreatorOnboarding();
      }
      next = await completeCreatorOnboarding();
      setMe(next);
      if (next.creatorStatus !== 'ACTIVE') {
        setError(`Could not activate creator (status=${next.creatorStatus})`);
        return;
      }
      onActivatedRef.current(next);
    } catch (e) {
      setError(messageOf(e, 'Could not activate creator'));
    } finally {
      setBusy(false);
    }
  };

  const onNotNow = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (me?.creatorStatus === 'ONBOARDING') {
        const next = await abandonCreatorOnboarding();
        setMe(next);
        setStep('profile');
      }
      onCancelRef.current?.();
    } catch (e) {
      Alert.alert('Could not leave setup', messageOf(e, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const refreshConnected = async () => {
    try {
      setConnected(await listConnectedAccounts());
    } catch {
      setConnected(null);
    }
  };

  const onConnectedPress = (provider: ConnectedAccountProvider) => {
    const linkingEnabled = connected?.providers[provider]?.linkingEnabled ?? false;
    const account = pickProviderAccount(connected, provider);
    const title =
      provider === 'youtube' ? SETTINGS_COPY.connectedYouTube : SETTINGS_COPY.connectedInstagram;
    if (!linkingEnabled && !account) return;

    const run = async (action: 'connect' | 'disconnect') => {
      setConnectedBusy(true);
      try {
        if (action === 'connect') await connectProviderWithBrowser(provider);
        else if (account) await disconnectConnectedAccount(account.id);
        await refreshConnected();
      } catch (e) {
        const msg =
          e instanceof ConnectedAccountsApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Try again.';
        Alert.alert(`Could not update ${title}`, msg);
      } finally {
        setConnectedBusy(false);
      }
    };

    const options: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: 'Cancel', style: 'cancel' },
    ];
    if (linkingEnabled && (!account || account.status === 'disconnected')) {
      options.push({ text: SETTINGS_COPY.connectedConnect, onPress: () => void run('connect') });
    } else if (account) {
      options.push({
        text: SETTINGS_COPY.connectedDisconnect,
        style: 'destructive',
        onPress: () => void run('disconnect'),
      });
    }
    Alert.alert(title, SETTINGS_COPY.onboardingSocialWhy, options);
  };

  return {
    me,
    step,
    displayName,
    bio,
    loading,
    busy,
    error,
    connected,
    connectedBusy,
    setDisplayName,
    setBio,
    setStep,
    load,
    onContinueProfile,
    onBecomeCreator,
    onNotNow,
    onConnectedPress,
  };
}
