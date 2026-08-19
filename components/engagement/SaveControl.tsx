import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  isSaved: boolean;
  pending?: boolean;
  disabled?: boolean;
  isLight: boolean;
  onPress: () => void;
};

/** Emit-only Save control — parents own auth + Engagement API. */
export function SaveControl({
  isSaved,
  pending = false,
  disabled = false,
  isLight,
  onPress,
}: Props) {
  const color = isLight ? '#1A1A1B' : '#F8FAFC';
  const label = isSaved ? 'Saved' : 'Save';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)',
          opacity: pressed || pending || disabled ? 0.7 : 1,
        },
      ]}
    >
      {pending ? (
        <ActivityIndicator color={color} />
      ) : (
        <>
          <Ionicons
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={18}
            color={color}
          />
          <Text style={[styles.label, { color }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
  },
});
