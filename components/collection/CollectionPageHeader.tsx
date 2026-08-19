import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SaveControl } from '@/components/engagement/SaveControl';
import { ShareControl } from '@/components/engagement/ShareControl';
import { useThemeMode } from '@/contexts/ThemeContext';

type Props = {
  title: string;
  isSaved?: boolean;
  savePending?: boolean;
  onSavePress?: () => void;
  onSharePress?: () => void;
};

export function CollectionPageHeader({
  title,
  isSaved = false,
  savePending = false,
  onSavePress,
  onSharePress,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { mode } = useThemeMode();
  const isLight = mode === 'titanium';
  const text = isLight ? '#1A1A1B' : '#F8FAFC';

  return (
    <LinearGradient
      colors={
        isLight
          ? ['rgba(253,253,253,0.98)', 'rgba(232,232,232,0.95)']
          : ['rgba(13,17,31,0.98)', 'rgba(2,4,8,0.95)']
      }
      style={[styles.wrap, { paddingTop: insets.top + 8 }]}
    >
      <View style={styles.row}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={[
            styles.iconBtn,
            { backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)' },
          ]}
        >
          <Ionicons name="chevron-back" size={22} color={text} />
        </Pressable>
        <Text style={[styles.title, { color: text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.rightActions}>
          {onSavePress ? (
            <SaveControl
              isSaved={isSaved}
              pending={savePending}
              isLight={isLight}
              onPress={onSavePress}
            />
          ) : null}
          {onSharePress ? (
            <ShareControl isLight={isLight} onPress={onSharePress} accessibilityLabel="Share collection" />
          ) : null}
          <Pressable
            onPress={() => router.push('/cart')}
            accessibilityRole="button"
            accessibilityLabel="Open cart"
            style={[
              styles.iconBtn,
              { backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)' },
            ]}
          >
            <Ionicons name="cart-outline" size={20} color={text} />
          </Pressable>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
