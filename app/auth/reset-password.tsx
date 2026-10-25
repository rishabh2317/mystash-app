import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { AUTH_COPY } from '@/src/auth/authErrors';
import { MIN_PASSWORD_LENGTH, passwordMeetsPolicy, passwordPolicyMessage } from '@/src/auth/passwordPolicy';
import { createFieldColors } from '@/src/ui/createChrome';
import { typeStyle } from '@/src/theme/typography';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { session, updatePassword } = useAuth();
  const field = createFieldColors(tokens);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!passwordMeetsPolicy(password)) {
      setError(passwordPolicyMessage());
      return;
    }
    if (password !== confirm) {
      setError(AUTH_COPY.passwordMismatch);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await updatePassword(password);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.replace('/(tabs)/profile');
    } finally {
      setPending(false);
    }
  };

  if (!session) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: tokens.color.canvas }]}>
        <Text style={typeStyle(tokens, 'sectionTitle')}>{AUTH_COPY.invalidLink}</Text>
        <View style={{ marginTop: 16, alignSelf: 'stretch', paddingHorizontal: 24 }}>
          <ActionButton
            label={AUTH_COPY.backToSignIn}
            onPress={() => router.replace('/(tabs)/profile')}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: tokens.color.canvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typeStyle(tokens, 'sectionTitle')}>{AUTH_COPY.resetTitle}</Text>
        <Text style={[typeStyle(tokens, 'bodyMuted'), { marginTop: 8 }]}>
          {AUTH_COPY.resetBody} {passwordPolicyMessage()}
        </Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
          secureTextEntry
          autoComplete="new-password"
          placeholderTextColor={field.placeholderTextColor}
          style={[
            styles.input,
            {
              color: field.color,
              borderColor: field.borderColor,
              backgroundColor: field.backgroundColor,
            },
          ]}
        />
        <TextInput
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Confirm password"
          secureTextEntry
          autoComplete="new-password"
          placeholderTextColor={field.placeholderTextColor}
          style={[
            styles.input,
            {
              color: field.color,
              borderColor: field.borderColor,
              backgroundColor: field.backgroundColor,
            },
          ]}
        />
        {error ? (
          <Text style={{ color: tokens.color.danger, marginTop: 8 }}>{error}</Text>
        ) : null}
        <View style={{ marginTop: 20 }}>
          <ActionButton
            label={AUTH_COPY.resetSubmit}
            onPress={() => void onSubmit()}
            pending={pending}
            disabled={pending}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
  input: {
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
});
