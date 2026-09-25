import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { useAuth } from '@/contexts/AuthContext';
import { useCommerceCountry } from '@/contexts/CommerceCountryContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { ensureMe, type UserSettingsViewModel } from '@/src/services/userApi';
import { BAG_COPY } from '@/src/ui/contracts';
import {
  SETTINGS_COPY,
  SHOPPING_COUNTRY_OPTIONS,
  settingsAppearanceValue,
  settingsCreatorStatusLabel,
  settingsCurateCopy,
  settingsShoppingCountryValue,
} from '@/src/ui/settingsHub';

/** Settings hub — compact grouped rows over the existing account destinations. */
export default function SettingsScreen() {
  const router = useRouter();
  const { tokens, isLight, toggleTheme } = useThemeMode();
  const { user, loading, signOut } = useAuth();
  const { snapshot, setManualCountry, enableAutomaticLocation, refresh } = useCommerceCountry();
  const [me, setMe] = useState<UserSettingsViewModel | null>(null);
  const [countryBusy, setCountryBusy] = useState(false);

  useEffect(() => {
    if (!user || loading) {
      setMe(null);
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

  const creatorStatusLabel = settingsCreatorStatusLabel(me?.creatorStatus);
  const curateCopy = settingsCurateCopy(me?.creatorStatus);
  const showAnalytics = Boolean(me && me.creatorStatus !== 'NONE');
  const shoppingCountryValue = settingsShoppingCountryValue({
    country: snapshot?.country ?? me?.country,
    countrySource: snapshot?.countrySource ?? me?.countrySource,
  });

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

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
        <TopBar mode="page" title={SETTINGS_COPY.title} showBack showBag={false} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={tokens.color.primary} />
        </View>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
        <TopBar mode="page" title={SETTINGS_COPY.title} showBack showBag={false} />
        <View style={styles.centered}>
          <Text style={{ color: tokens.color.textMuted, textAlign: 'center' }}>
            {SETTINGS_COPY.signInPrompt}
          </Text>
          <Pressable onPress={() => router.replace('/(tabs)/profile')} style={{ marginTop: 16 }}>
            <Text
              style={{
                color: tokens.color.primary,
                fontWeight: tokens.fontWeight.bold,
                fontSize: tokens.fontSize.bodyStrong,
              }}
            >
              {SETTINGS_COPY.goToProfile}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
      <TopBar mode="page" title={SETTINGS_COPY.title} showBack showBag={false} />
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
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.caption,
            lineHeight: tokens.lineHeight.caption,
            marginTop: -tokens.space.xs,
          }}
        >
          {SETTINGS_COPY.subtitle}
        </Text>

        <SettingsSection title={SETTINGS_COPY.creator}>
          <SettingsRow
            variant="highlighted"
            icon="sparkles-outline"
            title={curateCopy.title}
            subtitle={curateCopy.subtitle}
            disabled={me?.creatorStatus === 'SUSPENDED'}
            onPress={() => router.push('/(tabs)/create')}
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
        </SettingsSection>

        <SettingsSection title={SETTINGS_COPY.account}>
          <SettingsRow
            variant="value"
            icon="person-outline"
            title={SETTINGS_COPY.profile}
            value={`@${profileHandle}`}
          />
          <SettingsRow
            variant="value"
            icon="mail-outline"
            title={SETTINGS_COPY.email}
            value={user.email ?? 'N/A'}
          />
          <SettingsRow
            variant="value"
            icon="create-outline"
            title={SETTINGS_COPY.creatorStatus}
            value={creatorStatusLabel}
          />
          <SettingsRow
            variant="navigation"
            icon="globe-outline"
            title={SETTINGS_COPY.publicProfile}
            value={SETTINGS_COPY.publicProfileValue}
            onPress={() => router.push(`/creator/${encodeURIComponent(profileHandle)}`)}
          />
          <SettingsRow
            variant="value"
            icon="shield-checkmark-outline"
            title={SETTINGS_COPY.plan}
            value={SETTINGS_COPY.planValue}
          />
          <SettingsRow
            variant="value"
            icon="card-outline"
            title={SETTINGS_COPY.payment}
            value={SETTINGS_COPY.paymentValue}
          />
          <SettingsRow
            variant="value"
            icon="location-outline"
            title={SETTINGS_COPY.shipping}
            value={SETTINGS_COPY.shippingValue}
          />
          <SettingsRow
            variant="navigation"
            icon="flag-outline"
            title={SETTINGS_COPY.shoppingCountry}
            subtitle={SETTINGS_COPY.shoppingCountryHint}
            value={countryBusy ? 'Updating…' : shoppingCountryValue}
            onPress={onPickShoppingCountry}
          />
          <SettingsRow
            variant="navigation"
            icon="bag-handle-outline"
            title={SETTINGS_COPY.bag}
            value={BAG_COPY.view}
            onPress={() => router.push('/cart')}
          />
        </SettingsSection>

        <SettingsSection title={SETTINGS_COPY.preferences}>
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
            variant="value"
            icon="notifications-outline"
            title={SETTINGS_COPY.notifications}
            value={SETTINGS_COPY.notificationsValue}
          />
          <SettingsRow
            variant="value"
            icon="lock-closed-outline"
            title={SETTINGS_COPY.privacy}
            value={SETTINGS_COPY.privacyValue}
          />
        </SettingsSection>

        <SettingsSection title={SETTINGS_COPY.social}>
          <SettingsRow
            variant="navigation"
            icon="logo-instagram"
            title="Instagram"
            value="@mystash_app"
            onPress={() => void Linking.openURL('https://instagram.com')}
          />
          <SettingsRow
            variant="navigation"
            icon="logo-youtube"
            title="YouTube"
            value="@MystashOfficial"
            onPress={() => void Linking.openURL('https://youtube.com')}
          />
          <SettingsRow
            variant="navigation"
            icon="globe-outline"
            title="Website"
            value="mystash.ai"
            onPress={() => void Linking.openURL('https://mystash.ai')}
          />
        </SettingsSection>

        <SettingsSection title={SETTINGS_COPY.session}>
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
