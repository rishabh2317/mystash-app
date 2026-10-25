import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  UIManager,
  View,
  useWindowDimensions,
} from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { AUTH_COPY } from '@/src/auth/authErrors';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { typeStyle } from '@/src/theme/typography';
import { createFieldColors, createSurfaceStyle } from '@/src/ui/createChrome';

const WELCOME_HERO = require('../../assets/images/auth_screen_signed_out_hero.png');
const FORM_HERO = require('../../assets/images/auth_screen_hero.png');

/** Intrinsic PNG size and opaque artwork bounds (alpha > 0). */
const WELCOME_ART = {
  width: 1024,
  height: 1536,
  visLeft: 36,
  visTop: 210,
  visWidth: 968,
  visHeight: 1226,
} as const;

const FORM_ART = {
  width: 1245,
  height: 1263,
  visLeft: 153,
  visTop: 146,
  visWidth: 1025,
  visHeight: 1019,
} as const;

function artLayout(
  art: {
    width: number;
    height: number;
    visLeft: number;
    visTop: number;
    visWidth: number;
    visHeight: number;
  },
  visBox: { width: number; height: number },
) {
  const scale = Math.min(visBox.width / art.visWidth, visBox.height / art.visHeight);
  return {
    width: art.width * scale,
    height: art.height * scale,
    marginLeft: -art.visLeft * scale + (visBox.width - art.visWidth * scale) / 2,
    marginTop: -art.visTop * scale + (visBox.height - art.visHeight * scale) / 2,
  };
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type ProfileAuthMode = 'signin' | 'signup';
export type ProfileAuthStep = 'welcome' | 'form';

type Props = {
  step: ProfileAuthStep;
  onOpenMode: (mode: ProfileAuthMode) => void;
  authMode: ProfileAuthMode;
  onChangeMode: (mode: ProfileAuthMode) => void;
  name: string;
  onChangeName: (value: string) => void;
  onChangeUsername: (value: string) => void;
  email: string;
  onChangeEmail: (value: string) => void;
  password: string;
  onChangePassword: (value: string) => void;
  confirmPassword: string;
  onChangeConfirmPassword: (value: string) => void;
  submitting: boolean;
  onSubmit: () => void;
  onGoogle: () => void;
  onForgotPassword: () => void;
};

function animateAuthStep() {
  LayoutAnimation.configureNext({
    duration: 280,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

/**
 * Signed-out Profile authentication. Presentation only — parents own
 * submit, Google, and password-reset destinations.
 */
export function ProfileAuthForm({
  step,
  onOpenMode,
  authMode,
  onChangeMode,
  name,
  onChangeName,
  onChangeUsername,
  email,
  onChangeEmail,
  password,
  onChangePassword,
  confirmPassword,
  onChangeConfirmPassword,
  submitting,
  onSubmit,
  onGoogle,
  onForgotPassword,
}: Props) {
  if (step === 'welcome') {
    return (
      <WelcomeState
        onOpenMode={(mode) => {
          animateAuthStep();
          onOpenMode(mode);
        }}
      />
    );
  }

  return (
    <FormState
      authMode={authMode}
      onChangeMode={onChangeMode}
      name={name}
      onChangeName={onChangeName}
      onChangeUsername={onChangeUsername}
      email={email}
      onChangeEmail={onChangeEmail}
      password={password}
      onChangePassword={onChangePassword}
      confirmPassword={confirmPassword}
      onChangeConfirmPassword={onChangeConfirmPassword}
      submitting={submitting}
      onSubmit={onSubmit}
      onGoogle={onGoogle}
      onForgotPassword={onForgotPassword}
    />
  );
}

function WelcomeState({ onOpenMode }: { onOpenMode: (mode: ProfileAuthMode) => void }) {
  const tokens = useThemeTokens();
  const { width, height } = useWindowDimensions();
  const contentWidth = width - tokens.space.lg * 2;
  const visAspect = WELCOME_ART.visWidth / WELCOME_ART.visHeight;
  const maxHero = Math.min(height * 0.5, 440);
  const minHero = 220;
  const heroBoxHeight = Math.max(
    minHero,
    Math.min(maxHero, contentWidth / visAspect),
  );
  const heroImg = artLayout(WELCOME_ART, { width: contentWidth, height: heroBoxHeight });

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: tokens.space.lg,
        paddingTop: tokens.space.sm,
        paddingBottom: tokens.space.md,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: tokens.space.xs, marginBottom: tokens.space.sm }}>
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.headline,
            lineHeight: tokens.lineHeight.headline,
            fontFamily: tokens.fontFamily.extraBold,
          }}
        >
          {AUTH_COPY.landingHeadline}
        </Text>
        <Text style={typeStyle(tokens, 'bodyMuted')}>{AUTH_COPY.landingBody}</Text>
      </View>

      <View
        pointerEvents="none"
        style={{
          flexGrow: 1,
          minHeight: heroBoxHeight,
          justifyContent: 'center',
          overflow: 'visible',
        }}
      >
        <View style={{ height: heroBoxHeight, overflow: 'visible' }}>
          <Image
            source={WELCOME_HERO}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
            importantForAccessibility="no"
            style={{
              width: heroImg.width,
              height: heroImg.height,
              marginLeft: heroImg.marginLeft,
              marginTop: heroImg.marginTop,
            }}
          />
        </View>
      </View>

      <View style={{ gap: tokens.space.sm, marginTop: tokens.space.sm }}>
        <ChoiceRow
          icon="mail-outline"
          title={AUTH_COPY.signIn}
          subtitle={AUTH_COPY.landingSignInHint}
          onPress={() => onOpenMode('signin')}
        />
        <ChoiceRow
          icon="person-outline"
          title={AUTH_COPY.landingSignUpTitle}
          subtitle={AUTH_COPY.landingSignUpHint}
          onPress={() => onOpenMode('signup')}
        />
      </View>

      <View style={{ marginTop: tokens.space.md }}>
        <TermsLine />
      </View>
    </ScrollView>
  );
}

function FormState({
  authMode,
  onChangeMode,
  name,
  onChangeName,
  onChangeUsername,
  email,
  onChangeEmail,
  password,
  onChangePassword,
  confirmPassword,
  onChangeConfirmPassword,
  submitting,
  onSubmit,
  onGoogle,
  onForgotPassword,
}: Omit<Props, 'step' | 'onOpenMode'>) {
  const tokens = useThemeTokens();
  const field = createFieldColors(tokens);
  const signup = authMode === 'signup';
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const { width } = useWindowDimensions();
  const formHeroBox = Math.min(108, Math.max(88, width * 0.26));
  const formHeroImg = artLayout(FORM_ART, { width: formHeroBox, height: formHeroBox });

  const onEmailChange = (value: string) => {
    onChangeEmail(value);
    const fromEmail = usernameFromEmail(value);
    if (fromEmail) onChangeUsername(fromEmail);
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
          paddingBottom: tokens.space.xl,
          gap: tokens.space.md,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
          <View style={{ flex: 1, minWidth: 0, gap: tokens.space.xs, paddingRight: tokens.space.xs }}>
            <Text
              style={{
                color: tokens.color.text,
                fontSize: tokens.fontSize.headline,
                lineHeight: tokens.lineHeight.headline,
                fontFamily: tokens.fontFamily.extraBold,
              }}
            >
              {signup ? AUTH_COPY.formSignUpTitle : AUTH_COPY.formSignInTitle}
            </Text>
            <Text style={typeStyle(tokens, 'bodyMuted')}>
              {signup ? AUTH_COPY.welcomeSignUp : AUTH_COPY.formSignInBody}
            </Text>
          </View>
          <View
            pointerEvents="none"
            style={{
              width: formHeroBox,
              height: formHeroBox,
              overflow: 'visible',
              marginRight: -tokens.space.xs,
            }}
          >
            <Image
              source={FORM_HERO}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              importantForAccessibility="no"
              style={{
                width: formHeroImg.width,
                height: formHeroImg.height,
                marginLeft: formHeroImg.marginLeft,
                marginTop: formHeroImg.marginTop,
              }}
            />
          </View>
        </View>

        <View
          style={[
            createSurfaceStyle(tokens),
            {
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: tokens.radius.xl,
              padding: tokens.space.lg,
              gap: tokens.space.md,
            },
          ]}
        >
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: tokens.color.surfaceSubtle,
              borderRadius: tokens.radius.md,
              padding: tokens.space.xxs,
              gap: tokens.space.xxs,
            }}
            accessibilityRole="tablist"
          >
            <ModeSegment
              label={AUTH_COPY.signIn}
              selected={!signup}
              disabled={submitting}
              onPress={() => onChangeMode('signin')}
            />
            <ModeSegment
              label={AUTH_COPY.createAccount}
              selected={signup}
              disabled={submitting}
              onPress={() => onChangeMode('signup')}
            />
          </View>

          {signup ? (
            <AuthField
              label={AUTH_COPY.displayName}
              value={name}
              onChangeText={onChangeName}
              placeholder={AUTH_COPY.displayNamePlaceholder}
              icon="person-outline"
              autoCapitalize="words"
              autoComplete="name"
              editable={!submitting}
              field={field}
            />
          ) : null}

          <AuthField
            label={AUTH_COPY.email}
            value={email}
            onChangeText={onEmailChange}
            placeholder={signup ? AUTH_COPY.emailPlaceholderSignUp : AUTH_COPY.emailPlaceholderSignIn}
            icon="mail-outline"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            editable={!submitting}
            field={field}
          />

          <View style={{ gap: tokens.space.xs }}>
            <AuthField
              label={AUTH_COPY.password}
              value={password}
              onChangeText={onChangePassword}
              placeholder={
                signup ? AUTH_COPY.passwordPlaceholderSignUp : AUTH_COPY.passwordPlaceholderSignIn
              }
              icon="lock-closed-outline"
              secureTextEntry={!passwordVisible}
              autoComplete={signup ? 'new-password' : 'password'}
              editable={!submitting}
              field={field}
              trailing={
                <Pressable
                  onPress={() => setPasswordVisible((visible) => !visible)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={
                    passwordVisible ? AUTH_COPY.hidePassword : AUTH_COPY.showPassword
                  }
                >
                  <Ionicons
                    name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={tokens.color.textMuted}
                  />
                </Pressable>
              }
            />
            {!signup ? (
              <Pressable
                onPress={onForgotPassword}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={AUTH_COPY.forgotPassword}
                style={{ alignSelf: 'flex-end', paddingVertical: tokens.space.xxs }}
              >
                <Text style={typeStyle(tokens, 'link')}>{AUTH_COPY.forgotPassword}</Text>
              </Pressable>
            ) : null}
          </View>

          {signup ? (
            <AuthField
              label={AUTH_COPY.confirmPassword}
              value={confirmPassword}
              onChangeText={onChangeConfirmPassword}
              placeholder={AUTH_COPY.confirmPasswordPlaceholder}
              icon="lock-closed-outline"
              secureTextEntry={!confirmVisible}
              autoComplete="new-password"
              editable={!submitting}
              field={field}
              trailing={
                <Pressable
                  onPress={() => setConfirmVisible((visible) => !visible)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={
                    confirmVisible ? AUTH_COPY.hidePassword : AUTH_COPY.showPassword
                  }
                >
                  <Ionicons
                    name={confirmVisible ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={tokens.color.textMuted}
                  />
                </Pressable>
              }
            />
          ) : null}

          <ActionButton
            variant="filled"
            label={signup ? AUTH_COPY.createAccount : AUTH_COPY.signIn}
            onPress={onSubmit}
            pending={submitting}
            disabled={submitting}
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
            <View style={[styles.rule, { backgroundColor: tokens.color.divider }]} />
            <Text style={typeStyle(tokens, 'tileMeta')}>or</Text>
            <View style={[styles.rule, { backgroundColor: tokens.color.divider }]} />
          </View>

          <ActionButton
            variant="outlinePrimary"
            label={AUTH_COPY.continueGoogle}
            leadingIcon="logo-google"
            onPress={onGoogle}
            disabled={submitting}
          />
        </View>

        <TermsLine />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ChoiceRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const tokens = useThemeTokens();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.md,
        paddingVertical: tokens.space.md,
        paddingHorizontal: tokens.space.md,
        backgroundColor: tokens.color.surface,
        borderColor: tokens.color.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: tokens.radius.xl,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tokens.color.surfaceSubtle,
        }}
      >
        <Ionicons name={icon} size={18} color={tokens.color.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            color: tokens.color.text,
            fontFamily: tokens.fontFamily.semibold,
            fontSize: tokens.fontSize.bodyStrong,
            lineHeight: tokens.lineHeight.bodyStrong,
          }}
        >
          {title}
        </Text>
        <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={tokens.color.textMuted} />
    </Pressable>
  );
}

function TermsLine() {
  const tokens = useThemeTokens();
  return (
    <Text style={[typeStyle(tokens, 'tileMeta'), { textAlign: 'center' }]}>
      {AUTH_COPY.termsLead}{' '}
      <Text style={typeStyle(tokens, 'link')}>{AUTH_COPY.terms}</Text>
      {' and '}
      <Text style={typeStyle(tokens, 'link')}>{AUTH_COPY.privacyPolicy}</Text>
      .
    </Text>
  );
}

function ModeSegment({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const tokens = useThemeTokens();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="tab"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      style={{
        flex: 1,
        minHeight: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: tokens.radius.md,
        backgroundColor: selected ? tokens.color.primary : 'transparent',
        paddingVertical: tokens.space.xs,
        paddingHorizontal: tokens.space.sm,
      }}
    >
      <Text
        style={{
          fontFamily: tokens.fontFamily.semibold,
          fontSize: tokens.fontSize.caption,
          lineHeight: tokens.lineHeight.caption,
          color: selected ? tokens.color.onPrimary : tokens.color.textMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AuthField({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  trailing,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  autoComplete,
  editable,
  field,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  trailing?: React.ReactNode;
  secureTextEntry?: boolean;
  keyboardType?: 'email-address' | 'default';
  autoCapitalize?: 'none' | 'words';
  autoComplete?: 'email' | 'password' | 'new-password' | 'name';
  editable?: boolean;
  field: ReturnType<typeof createFieldColors>;
}) {
  const tokens = useThemeTokens();
  return (
    <View style={{ gap: tokens.space.xs }}>
      <Text style={typeStyle(tokens, 'tileTitle')}>{label}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space.sm,
          minHeight: 48,
          paddingHorizontal: tokens.space.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: field.borderColor,
          backgroundColor: field.backgroundColor,
          borderRadius: tokens.radius.md,
        }}
      >
        <Ionicons name={icon} size={18} color={tokens.color.textMuted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={tokens.color.textMuted}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={false}
          editable={editable}
          style={{
            flex: 1,
            color: tokens.color.textMuted,
            fontFamily: tokens.fontFamily.regular,
            fontSize: tokens.fontSize.body,
            lineHeight: tokens.lineHeight.body,
            paddingVertical: tokens.space.sm,
          }}
        />
        {trailing}
      </View>
    </View>
  );
}

function usernameFromEmail(email: string): string {
  return email.trim().split('@')[0]?.replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30) ?? '';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
});
