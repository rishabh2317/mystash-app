import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { SettingsIdentityHeader } from '@/components/settings/SettingsIdentityHeader';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useCommerceCountry } from '@/contexts/CommerceCountryContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { ensureMe, type UserSettingsViewModel } from '@/src/services/userApi';
import {
  ConnectedAccountsApiError,
  connectProviderWithBrowser,
  disconnectConnectedAccount,
  healthCheckConnectedAccount,
  listConnectedAccounts,
  reauthProviderWithBrowser,
  type ConnectedAccountProvider,
  type ConnectedAccountsSnapshot,
} from '@/src/services/connectedAccountsApi';
import { pickProviderAccount, providerStatusLabel, shouldShowConnectedProvider } from '@/src/ui/connectedAccounts';
import {
  SETTINGS_COPY,
  SHOPPING_COUNTRY_OPTIONS,
  settingsAppearanceValue,
  settingsCreatorStatusLabel,
  settingsCurateCopy,
  settingsIdentityDisplayName,
  settingsShoppingCountryValue,
} from '@/src/ui/settingsHub';
import { typeStyle } from '@/src/theme/typography';
import { useUnreadNotifications } from '@/src/hooks/useUnreadNotifications';
import { NOTIFICATIONS_HREF } from '@/src/notifications/linking';
import { usePushPermission } from '@/src/hooks/usePushPermission';
import { NOTIFICATIONS_COPY, PUSH_COPY, pushSettingsValue, unreadBadgeLabel } from '@/src/ui/notificationsInbox';

export default function SettingsScreen() {
  const router = useRouter();
  const { tokens, isLight, toggleTheme } = useThemeMode();
  const { user, loading, signOut } = useAuth();
  const { snapshot, setManualCountry, enableAutomaticLocation, refresh } = useCommerceCountry();
  const notifications = useUnreadNotifications();
  const push = usePushPermission();
  const [me, setMe] = useState<UserSettingsViewModel | null>(null);
  const [countryBusy, setCountryBusy] = useState(false);
  const [connected, setConnected] = useState<ConnectedAccountsSnapshot | null>(null);
  const [connectedBusy, setConnectedBusy] = useState(false);

  const refreshConnected = async () => {
    if (!user) {
      setConnected(null);
      return;
    }
    try {
      setConnected(await listConnectedAccounts());
    } catch {
      setConnected(null);
    }
  };

  useEffect(() => {
    if (!user || loading) {
      setMe(null);
      setConnected(null);
      return;
    }
    let cancelled = false;
    ensureMe()
      .then((next) => {
        if (!cancelled) setMe(next);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      });
    listConnectedAccounts()
      .then((snap) => {
        if (!cancelled) setConnected(snap);
      })
      .catch(() => {
        if (!cancelled) setConnected(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  useEffect(() => {
    if (!snapshot?.country || !me) return;
    if (me.country === snapshot.country && me.countrySource === snapshot.countrySource) return;
    setMe((current) =>
      current
        ? {
            ...current,
            country: snapshot.country,
            countrySource: snapshot.countrySource,
          }
        : current,
    );
  }, [snapshot, me]);

  const profileHandle = useMemo(() => {
    if (!user) return '';
    return me?.username || (user.user_metadata?.username as string) || user.email?.split('@')[0] || 'user';
  }, [user, me?.username]);

  const profileDisplayName = useMemo(
    () =>
      settingsIdentityDisplayName({
        displayName: me?.displayName,
        username: profileHandle,
        fullName:
          (typeof user?.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
          (typeof user?.user_metadata?.name === 'string' && user.user_metadata.name) ||
          null,
      }),
    [me?.displayName, profileHandle, user?.user_metadata?.full_name, user?.user_metadata?.name],
  );

  const curateCopy = settingsCurateCopy(me?.creatorStatus);
  const showAnalytics = Boolean(me && me.creatorStatus !== 'NONE');
  const shoppingCountryValue = settingsShoppingCountryValue({
    country: snapshot?.country ?? me?.country,
    countrySource: snapshot?.countrySource ?? me?.countrySource,
  });

  const youtubeAccount = pickProviderAccount(connected, 'youtube');
  const instagramAccount = pickProviderAccount(connected, 'instagram');
  const showYouTube = shouldShowConnectedProvider(
    connected?.providers.youtube?.linkingEnabled ?? false,
    youtubeAccount,
  );
  const showInstagram = shouldShowConnectedProvider(
    connected?.providers.instagram?.linkingEnabled ?? false,
    instagramAccount,
  );

  const onPickShoppingCountry = () => {
    const applyManual = async (code: string) => {
      setCountryBusy(true);
      try {
        await setManualCountry(code);
        await refresh();
      } catch (e) {
        Alert.alert('Could not update country', e instanceof Error ? e.message : 'Try again.');
      } finally {
        setCountryBusy(false);
      }
    };
    const applyLocation = async () => {
      setCountryBusy(true);
      try {
        await enableAutomaticLocation();
        await refresh();
      } catch (e) {
        Alert.alert('Could not use location', e instanceof Error ? e.message : 'Try again.');
      } finally {
        setCountryBusy(false);
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [
            'Cancel',
            SETTINGS_COPY.shoppingCountryUseLocation,
            ...SHOPPING_COUNTRY_OPTIONS.map((row) => row.label),
          ],
          cancelButtonIndex: 0,
        },
        (index) => {
          if (index === 1) void applyLocation();
          else if (index > 1) {
            const option = SHOPPING_COUNTRY_OPTIONS[index - 2];
            if (option) void applyManual(option.code);
          }
        },
      );
      return;
    }

    Alert.alert(SETTINGS_COPY.shoppingCountry, SETTINGS_COPY.shoppingCountryHint, [
      { text: 'Cancel', style: 'cancel' },
      { text: SETTINGS_COPY.shoppingCountryUseLocation, onPress: () => void applyLocation() },
      ...SHOPPING_COUNTRY_OPTIONS.map((row) => ({
        text: row.label,
        onPress: () => void applyManual(row.code),
      })),
    ]);
  };

  const onConnectedProviderPress = (provider: ConnectedAccountProvider) => {
    const linkingEnabled = connected?.providers[provider]?.linkingEnabled ?? false;
    const account = pickProviderAccount(connected, provider);
    const title =
      provider === 'youtube' ? SETTINGS_COPY.connectedYouTube : SETTINGS_COPY.connectedInstagram;

    if (!linkingEnabled && !account) return;

    const run = async (action: 'connect' | 'disconnect' | 'reauth' | 'health') => {
      setConnectedBusy(true);
      try {
        if (action === 'connect') {
          await connectProviderWithBrowser(provider);
        } else if (action === 'disconnect' && account) {
          await disconnectConnectedAccount(account.id);
        } else if (action === 'reauth' && account) {
          await reauthProviderWithBrowser(account.id);
        } else if (action === 'health' && account) {
          await healthCheckConnectedAccount(account.id);
        }
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
      options.push({
        text: SETTINGS_COPY.connectedConnect,
        onPress: () => void run('connect'),
      });
    } else if (account) {
      if (account.status === 'needs_reauth' && linkingEnabled) {
        options.push({
          text: SETTINGS_COPY.connectedReauth,
          onPress: () => void run('reauth'),
        });
      }
      if (linkingEnabled) {
        options.push({
          text: SETTINGS_COPY.connectedCheck,
          onPress: () => void run('health'),
        });
      }
      options.push({
        text: SETTINGS_COPY.connectedDisconnect,
        style: 'destructive',
        onPress: () => void run('disconnect'),
      });
    }
    Alert.alert(title, SETTINGS_COPY.connectedAccountsHint, options);
  };

  const onCreatorPress = () => {
    if (me?.creatorStatus === 'SUSPENDED') return;
    if (me?.creatorStatus === 'ACTIVE') {
      router.push('/(tabs)/create');
      return;
    }
    router.push('/settings/creator-onboarding');
  };

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={tokens.color.primary} />
        </View>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
        <View style={styles.centered}>
          <Text style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' }]}>
            {SETTINGS_COPY.signInPrompt}
          </Text>
          <Pressable onPress={() => router.replace('/(tabs)/profile')} style={{ marginTop: 16 }}>
            <Text style={typeStyle(tokens, 'link')}>{SETTINGS_COPY.goToProfile}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: tokens.space.md,
            paddingTop: tokens.space.sm,
            paddingBottom: tokens.space.xxl,
            gap: tokens.space.lg,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsIdentityHeader
          displayName={profileDisplayName}
          username={profileHandle}
          email={user.email ?? me?.emailMirrored}
          avatarUrl={me?.avatarUrl}
          onEditProfile={() => router.push('/settings/edit-profile')}
        />

        <SettingsSection title={SETTINGS_COPY.profile}>
          <SettingsRow
            variant="value"
            icon="at-outline"
            title={SETTINGS_COPY.username}
            subtitle={SETTINGS_COPY.usernameHint}
            value={`@${profileHandle}`}
          />
          <SettingsRow
            variant="value"
            icon="mail-outline"
            title={SETTINGS_COPY.email}
            value={user.email ?? me?.emailMirrored ?? 'N/A'}
          />
          <SettingsRow
            variant="navigation"
            icon="create-outline"
            title={SETTINGS_COPY.editProfile}
            subtitle={SETTINGS_COPY.displayNameHint}
            onPress={() => router.push('/settings/edit-profile')}
          />
          <SettingsRow
            variant="navigation"
            icon="globe-outline"
            title={SETTINGS_COPY.publicProfile}
            value={SETTINGS_COPY.publicProfileValue}
            onPress={() => router.push(`/creator/${encodeURIComponent(profileHandle)}`)}
          />
        </SettingsSection>

        <SettingsSection title={SETTINGS_COPY.creator}>
          <SettingsRow
            variant={me?.creatorStatus === 'ACTIVE' ? 'navigation' : 'highlighted'}
            icon="sparkles-outline"
            title={curateCopy.title}
            subtitle={curateCopy.subtitle}
            value={settingsCreatorStatusLabel(me?.creatorStatus)}
            disabled={me?.creatorStatus === 'SUSPENDED'}
            onPress={onCreatorPress}
          />
          {showAnalytics ? (
            <SettingsRow
              variant="navigation"
              icon="stats-chart-outline"
              title={SETTINGS_COPY.analytics}
              subtitle={SETTINGS_COPY.analyticsHint}
              onPress={() => router.push('/analytics')}
            />
          ) : null}
          {showYouTube || showInstagram ? (
            <>
              {showYouTube ? (
                <SettingsRow
                  variant="navigation"
                  icon="logo-youtube"
                  title={SETTINGS_COPY.connectedYouTube}
                  value={
                    connectedBusy
                      ? 'Updating…'
                      : providerStatusLabel(
                          youtubeAccount,
                          connected?.providers.youtube.linkingEnabled ?? false,
                        )
                  }
                  onPress={() => onConnectedProviderPress('youtube')}
                />
              ) : null}
              {showInstagram ? (
                <SettingsRow
                  variant="navigation"
                  icon="logo-instagram"
                  title={SETTINGS_COPY.connectedInstagram}
                  value={
                    connectedBusy
                      ? 'Updating…'
                      : providerStatusLabel(
                          instagramAccount,
                          connected?.providers.instagram.linkingEnabled ?? false,
                        )
                  }
                  onPress={() => onConnectedProviderPress('instagram')}
                />
              ) : null}
            </>
          ) : null}
        </SettingsSection>

        <SettingsSection title={SETTINGS_COPY.preferences}>
          {notifications.enabled ? (
            <>
              <SettingsRow
                variant="navigation"
                icon="notifications-outline"
                title={NOTIFICATIONS_COPY.settingsRow}
                subtitle={NOTIFICATIONS_COPY.settingsRowHint}
                value={unreadBadgeLabel(notifications.unread) || null}
                onPress={() => router.push(NOTIFICATIONS_HREF)}
              />
              <SettingsRow
                variant="navigation"
                icon="options-outline"
                title={NOTIFICATIONS_COPY.prefsRow}
                subtitle={NOTIFICATIONS_COPY.prefsRowHint}
                onPress={() => router.push('/settings/notifications')}
              />
            </>
          ) : null}
          {push.supported && push.permission ? (
            <SettingsRow
              variant="navigation"
              icon="phone-portrait-outline"
              title={PUSH_COPY.settingsRow}
              value={pushSettingsValue(push.permission)}
              onPress={push.onPress}
            />
          ) : null}
          <SettingsRow
            variant="toggle"
            icon="color-palette-outline"
            title={SETTINGS_COPY.appearance}
            subtitle={SETTINGS_COPY.appearanceHint}
            value={settingsAppearanceValue(isLight)}
            toggleValue={!isLight}
            onToggle={() => toggleTheme()}
          />
          <SettingsRow
            variant="navigation"
            icon="flag-outline"
            title={SETTINGS_COPY.shoppingCountry}
            subtitle={SETTINGS_COPY.shoppingCountryHint}
            value={countryBusy ? 'Updating…' : shoppingCountryValue}
            onPress={onPickShoppingCountry}
          />
        </SettingsSection>

        <SettingsSection title={SETTINGS_COPY.account}>
          <SettingsRow
            variant="destructive"
            icon="log-out-outline"
            title={SETTINGS_COPY.signOut}
            onPress={() => {
              void signOut().catch(() => Alert.alert('Sign out', 'Could not sign out.'));
            }}
          />
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  content: {},
});
