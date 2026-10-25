import { Image } from 'expo-image';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { SETTINGS_COPY, settingsHandleLabel } from '@/src/ui/settingsHub';

const AVATAR_SIZE = 64;

type Props = {
  displayName: string | null | undefined;
  username: string | null | undefined;
  email: string | null | undefined;
  avatarUrl: string | null | undefined;
  onEditProfile: () => void;
};

/** Account vs public identity: display name, immutable @username, immutable email. */
export function SettingsIdentityHeader({
  displayName,
  username,
  email,
  avatarUrl,
  onEditProfile,
}: Props) {
  const { tokens } = useThemeMode();
  const handle = settingsHandleLabel(username);
  const name = displayName?.trim() || 'Your profile';

  return (
    <View style={[styles.row, { gap: tokens.space.md, paddingVertical: tokens.space.xs }]}>
      <Pressable
        onPress={onEditProfile}
        accessibilityRole="button"
        accessibilityLabel={SETTINGS_COPY.changePhoto}
        style={styles.avatarHit}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View
            style={[
              styles.avatar,
              styles.fallback,
              { backgroundColor: tokens.color.surfaceSubtle },
            ]}
          >
            <Text style={typeStyle(tokens, 'sectionTitle')}>
              {name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
      </Pressable>
      <View style={[styles.copy, { gap: 2 }]}>
        <Text style={typeStyle(tokens, 'identityTitle')} numberOfLines={1}>
          {name}
        </Text>
        {handle ? (
          <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
            {handle}
          </Text>
        ) : null}
        {email ? (
          <Text style={typeStyle(tokens, 'bodyMuted')} numberOfLines={1}>
            {email}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarHit: {
    flexShrink: 0,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
});
