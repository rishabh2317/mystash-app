import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import {
  pickAndNormalizeAvatar,
  ProfilePhotoError,
  uploadNormalizedAvatar,
} from '@/src/services/profilePhotoUpload';
import { ensureMe, updateMyProfile, type UserSettingsViewModel } from '@/src/services/userApi';
import { createFieldColors } from '@/src/ui/createChrome';
import { SETTINGS_COPY, settingsHandleLabel } from '@/src/ui/settingsHub';
import { typeStyle } from '@/src/theme/typography';

export default function EditProfileScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const field = createFieldColors(tokens);
  const [me, setMe] = useState<UserSettingsViewModel | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureMe()
      .then((next) => {
        if (cancelled) return;
        setMe(next);
        setDisplayName(next.displayName ?? '');
        setBio(next.bio ?? '');
        setAvatarUrl(next.avatarUrl);
      })
      .catch((e) => {
        if (!cancelled) {
          Alert.alert('Could not load profile', e instanceof Error ? e.message : 'Try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onChangePhoto = async () => {
    if (!me) return;
    setPhotoBusy(true);
    try {
      console.warn('[profilePhoto] edit.start', { hasUserId: Boolean(me.userId) });
      const localUri = await pickAndNormalizeAvatar();
      if (!localUri) {
        console.warn('[profilePhoto] edit.canceled');
        return;
      }
      const url = await uploadNormalizedAvatar(me.userId, localUri);
      console.warn('[profilePhoto] profile.patch.start');
      const next = await updateMyProfile({ profilePhotoUrl: url });
      console.warn('[profilePhoto] profile.patch.ok', { hasAvatar: Boolean(next.avatarUrl) });
      setMe(next);
      setAvatarUrl(next.avatarUrl);
    } catch (e) {
      console.warn('[profilePhoto] edit.failed', {
        name: e instanceof Error ? e.name : typeof e,
        message: e instanceof Error ? e.message : String(e),
      });
      Alert.alert(
        'Could not update photo',
        e instanceof ProfilePhotoError || e instanceof Error ? e.message : 'Try again.',
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await updateMyProfile({
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
      });
      router.back();
    } catch (e) {
      Alert.alert('Couldn’t save profile', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: tokens.color.canvas }]}>
        <ActivityIndicator color={tokens.color.primary} />
      </View>
    );
  }

  const handle = settingsHandleLabel(me?.username);
  const email = user?.email ?? me?.emailMirrored;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: tokens.color.canvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: tokens.space.lg,
          gap: tokens.space.md,
          paddingBottom: tokens.space.xxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => void onChangePhoto()}
          disabled={photoBusy}
          accessibilityRole="button"
          accessibilityLabel={SETTINGS_COPY.changePhoto}
          style={{ alignItems: 'center', gap: tokens.space.sm }}
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, { backgroundColor: tokens.color.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={typeStyle(tokens, 'sectionTitle')}>
                {(displayName.trim() || handle || 'M').slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={typeStyle(tokens, 'link')}>
            {photoBusy ? 'Updating…' : SETTINGS_COPY.changePhoto}
          </Text>
        </Pressable>

        <View style={{ gap: tokens.space.xs }}>
          <Text style={typeStyle(tokens, 'tileTitle')}>{SETTINGS_COPY.displayName}</Text>
          <Text style={typeStyle(tokens, 'tileMeta')}>{SETTINGS_COPY.displayNameHint}</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={SETTINGS_COPY.displayNamePlaceholder}
            placeholderTextColor={field.placeholderTextColor}
            style={[
              styles.input,
              {
                color: field.color,
                borderColor: field.borderColor,
                backgroundColor: field.backgroundColor,
                borderRadius: tokens.radius.md,
                paddingHorizontal: tokens.space.md,
                paddingVertical: tokens.space.sm,
                fontSize: tokens.fontSize.body,
              },
            ]}
          />
        </View>

        <View style={{ gap: tokens.space.xs }}>
          <Text style={typeStyle(tokens, 'tileTitle')}>{SETTINGS_COPY.username}</Text>
          <Text style={typeStyle(tokens, 'tileMeta')}>{SETTINGS_COPY.usernameHint}</Text>
          <Text style={typeStyle(tokens, 'body')}>{handle || '—'}</Text>
        </View>

        <View style={{ gap: tokens.space.xs }}>
          <Text style={typeStyle(tokens, 'tileTitle')}>{SETTINGS_COPY.email}</Text>
          <Text style={typeStyle(tokens, 'body')}>{email || '—'}</Text>
        </View>

        <View style={{ gap: tokens.space.xs }}>
          <Text style={typeStyle(tokens, 'tileTitle')}>{SETTINGS_COPY.bio}</Text>
          <Text style={typeStyle(tokens, 'tileMeta')}>{SETTINGS_COPY.bioHint}</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder={SETTINGS_COPY.bioPlaceholder}
            placeholderTextColor={field.placeholderTextColor}
            multiline
            maxLength={500}
            style={[
              styles.input,
              styles.bio,
              {
                color: field.color,
                borderColor: field.borderColor,
                backgroundColor: field.backgroundColor,
                borderRadius: tokens.radius.md,
                paddingHorizontal: tokens.space.md,
                paddingVertical: tokens.space.sm,
                fontSize: tokens.fontSize.body,
              },
            ]}
          />
        </View>

        <ActionButton variant="filled" label="Save" pending={saving} onPress={() => void onSave()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  input: { borderWidth: StyleSheet.hairlineWidth },
  bio: { minHeight: 96, textAlignVertical: 'top' },
});
