import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';

export function ProfileRow({
  icon,
  label,
  value,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  action?: () => void;
}) {
  const { tokens } = useThemeMode();

  return (
    <TouchableOpacity activeOpacity={action ? 0.8 : 1} onPress={action} disabled={!action}>
      <View
        style={[
          styles.rowCard,
          {
            backgroundColor: tokens.color.surfaceRaised,
            borderColor: tokens.color.border,
            borderRadius: tokens.radius.lg,
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={tokens.color.icon} />
        <View style={styles.rowTextWrap}>
          <Text style={[styles.rowLabel, { color: tokens.color.textMuted }]}>{label}</Text>
          <Text style={[styles.rowValue, { color: tokens.color.text }]}>{value}</Text>
        </View>
        {action ? (
          <Ionicons name="chevron-forward" size={16} color={tokens.color.textMuted} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  rowCard: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowTextWrap: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  rowValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '700',
  },
});
