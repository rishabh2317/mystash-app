import { Image } from 'expo-image';
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { StatusBlock } from '@/components/status/StatusBlock';
import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useCreatorOnboarding } from '@/src/hooks/useCreatorOnboarding';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { typeStyle } from '@/src/theme/typography';
import type { UserSettingsViewModel } from '@/src/services/userApi';
import { createFieldColors, createSurfaceStyle } from '@/src/ui/createChrome';
import { CREATE_COPY } from '@/src/ui/createCopy';
import {
  CREATOR_ONBOARDING_BIO_MAX,
  creatorOnboardingStepLabel,
} from '@/src/ui/creatorOnboarding';
import { pickProviderAccount, providerStatusLabel, shouldShowConnectedProvider } from '@/src/ui/connectedAccounts';
import { SETTINGS_COPY, settingsHandleLabel } from '@/src/ui/settingsHub';

const HERO = require('../../assets/images/creator_studio_video_hero.png');

type Props = {
  onActivated: (me: UserSettingsViewModel) => void;
  onAlreadyActive?: (me: UserSettingsViewModel) => void;
  onSuspended?: (me: UserSettingsViewModel) => void;
  onCancel?: () => void;
};

/**
 * Canonical creator onboarding: redesigned hero + card around the original
 * two-step form (profile → optional social). Parents own post-activation
 * navigation. Completion is step 2 only.
 */
export function CreatorOnboardingPanel({
  onActivated,
  onAlreadyActive,
  onSuspended,
  onCancel,
}: Props) {
  const tokens = useThemeTokens();
  const field = createFieldColors(tokens);
  const {
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
  } = useCreatorOnboarding({
    onActivated,
    onAlreadyActive,
    onSuspended,
    onCancel,
  });

  const handle = settingsHandleLabel(me?.username);
  const pending = busy;
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

  if (loading) {
    return <StatusBlock kind="loading" message={CREATE_COPY.onboardingLoading} fill />;
  }

  if (!me) {
    return (
      <StatusBlock
        kind="error"
        title={CREATE_COPY.onboardingLoadErrorTitle}
        message={error ?? CREATE_COPY.onboardingLoadErrorBody}
        actionLabel={CREATE_COPY.onboardingTryAgain}
        onAction={() => void load()}
        fill
      />
    );
  }

  if (me.creatorStatus === 'ACTIVE') {
    return <StatusBlock kind="loading" message={CREATE_COPY.onboardingLoading} fill />;
  }

  if (me.creatorStatus === 'SUSPENDED') {
    return (
      <View style={styles.page}>
        <Hero />
        <View style={[styles.card, cardChrome(tokens)]}>
          <Text style={typeStyle(tokens, 'identityBrand')}>{CREATE_COPY.onboardingEyebrow}</Text>
          <Headline>{CREATE_COPY.onboardingSuspendedTitle}</Headline>
          <Text style={typeStyle(tokens, 'bodyMuted')}>{CREATE_COPY.onboardingSuspendedBody}</Text>
        </View>
      </View>
    );
  }

  const isSetup = me.creatorStatus === 'ONBOARDING';
  const inputStyle = {
    color: field.color,
    borderColor: field.borderColor,
    backgroundColor: field.backgroundColor,
    borderRadius: tokens.radius.md,
    fontSize: tokens.fontSize.body,
    fontFamily: tokens.fontFamily.regular,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{
          paddingHorizontal: tokens.space.md,
          paddingTop: tokens.space.xs,
          paddingBottom: tokens.space.xxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.page}>
          <Hero />
          <View style={[styles.card, cardChrome(tokens)]}>
            <View style={{ gap: tokens.space.xs }}>
              <Text style={typeStyle(tokens, 'identityBrand')}>
                {isSetup ? CREATE_COPY.onboardingEyebrowSetup : CREATE_COPY.onboardingEyebrow}
              </Text>
              <Headline>
                {isSetup ? CREATE_COPY.onboardingHeadlineSetup : CREATE_COPY.onboardingHeadline}
              </Headline>
              <Text style={typeStyle(tokens, 'tileMeta')}>{creatorOnboardingStepLabel(step)}</Text>
              <Text style={typeStyle(tokens, 'identityTitle')}>
                {step === 'profile'
                  ? SETTINGS_COPY.onboardingStepProfile
                  : SETTINGS_COPY.onboardingStepSocial}
              </Text>
              <Text style={typeStyle(tokens, 'bodyMuted')}>
                {step === 'profile'
                  ? SETTINGS_COPY.onboardingProfileWhy
                  : SETTINGS_COPY.onboardingSocialWhy}
              </Text>
            </View>

            {handle ? (
              <Text style={typeStyle(tokens, 'identityTitle')} numberOfLines={1}>
                {handle}
              </Text>
            ) : null}

            {step === 'profile' ? (
              <>
                <View style={{ gap: tokens.space.xs }}>
                  <Text style={typeStyle(tokens, 'tileTitle')}>{SETTINGS_COPY.displayName}</Text>
                  <TextInput
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder={SETTINGS_COPY.displayNamePlaceholder}
                    placeholderTextColor={field.placeholderTextColor}
                    editable={!pending}
                    autoCapitalize="words"
                    autoCorrect={false}
                    accessibilityLabel={SETTINGS_COPY.displayName}
                    style={[styles.input, inputStyle, { minHeight: 48 }]}
                  />
                </View>
                <View style={{ gap: tokens.space.xs }}>
                  <Text style={typeStyle(tokens, 'tileTitle')}>{SETTINGS_COPY.bio}</Text>
                  <TextInput
                    value={bio}
                    onChangeText={setBio}
                    placeholder={SETTINGS_COPY.bioPlaceholder}
                    placeholderTextColor={field.placeholderTextColor}
                    editable={!pending}
                    multiline
                    maxLength={CREATOR_ONBOARDING_BIO_MAX}
                    accessibilityLabel={SETTINGS_COPY.bio}
                    style={[styles.input, styles.bio, inputStyle]}
                  />
                </View>
              </>
            ) : (
              <>
                {showYouTube || showInstagram ? (
                  <SettingsSection title={SETTINGS_COPY.connectedAccounts}>
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
                        onPress={() => onConnectedPress('youtube')}
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
                        onPress={() => onConnectedPress('instagram')}
                      />
                    ) : null}
                  </SettingsSection>
                ) : (
                  <Text style={typeStyle(tokens, 'bodyMuted')}>
                    {SETTINGS_COPY.onboardingSocialLater}
                  </Text>
                )}
              </>
            )}

            {error ? (
              <Text style={{ color: tokens.color.danger, fontSize: tokens.fontSize.caption }}>
                {error}
              </Text>
            ) : null}

            {step === 'profile' ? (
              <ActionButton
                variant="filled"
                label={SETTINGS_COPY.onboardingContinue}
                trailingIcon={pending ? undefined : 'arrow-forward'}
                pending={pending}
                disabled={pending}
                onPress={() => void onContinueProfile()}
              />
            ) : (
              <ActionButton
                variant="filled"
                label={SETTINGS_COPY.onboardingPrimary}
                trailingIcon={pending ? undefined : 'arrow-forward'}
                pending={pending}
                disabled={pending}
                onPress={() => void onBecomeCreator()}
              />
            )}

            {step === 'social' ? (
              <ActionButton
                variant="quiet"
                label={SETTINGS_COPY.onboardingBack}
                disabled={pending}
                onPress={() => setStep('profile')}
              />
            ) : null}

            <ActionButton
              variant="quiet"
              label={SETTINGS_COPY.onboardingSecondary}
              disabled={pending}
              onPress={() => void onNotNow()}
            />

            <Pressable
              onPress={() => void load()}
              disabled={pending}
              accessibilityRole="button"
              accessibilityLabel={CREATE_COPY.onboardingRefresh}
              style={[styles.refresh, { opacity: pending ? tokens.motion.pressOpacity : 1 }]}
            >
              <Text style={typeStyle(tokens, 'link')}>{CREATE_COPY.onboardingRefresh}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Headline({ children }: { children: string }) {
  const tokens = useThemeTokens();
  return (
    <Text
      style={{
        color: tokens.color.text,
        fontSize: tokens.fontSize.headline,
        lineHeight: tokens.lineHeight.headline,
        fontFamily: tokens.fontFamily.extraBold,
      }}
    >
      {children}
    </Text>
  );
}

function Hero() {
  return (
    <Image
      source={HERO}
      style={styles.hero}
      contentFit="contain"
      accessibilityIgnoresInvertColors
      importantForAccessibility="no"
      accessibilityElementsHidden
    />
  );
}

function cardChrome(tokens: ReturnType<typeof useThemeTokens>) {
  return {
    ...createSurfaceStyle(tokens),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tokens.radius.xl,
    padding: tokens.space.lg,
    gap: tokens.space.md,
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { width: '100%' },
  hero: {
    width: '100%',
    height: 220,
    marginBottom: -28,
    zIndex: 0,
  },
  card: { zIndex: 1 },
  input: { borderWidth: 1 },
  bio: { minHeight: 96, textAlignVertical: 'top' },
  refresh: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});
