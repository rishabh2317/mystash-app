import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { AUTH_COPY } from '@/src/auth/authErrors';
import { createFieldColors } from '@/src/ui/createChrome';
import { typeStyle } from '@/src/theme/typography';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { requestPasswordReset } = useAuth();
  const field = createFieldColors(tokens);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email.trim());
      if (result.error) setError(result.error);
      else setSent(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: tokens.color.canvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typeStyle(tokens, 'sectionTitle')}>{AUTH_COPY.forgotTitle}</Text>
        <Text style={[typeStyle(tokens, 'bodyMuted'), { marginTop: 8 }]}>
          {sent ? AUTH_COPY.genericRecovery : AUTH_COPY.forgotBody}
        </Text>
        {!sent ? (
          <>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
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
                label={AUTH_COPY.forgotSubmit}
                onPress={() => void onSubmit()}
                pending={pending}
                disabled={pending}
              />
            </View>
          </>
        ) : null}
        <View style={{ marginTop: 16 }}>
          <ActionButton
            label={AUTH_COPY.backToSignIn}
            variant="quiet"
            onPress={() => router.replace('/(tabs)/profile')}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
  input: {
    marginTop: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
});
