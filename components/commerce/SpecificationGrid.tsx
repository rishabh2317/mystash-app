import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '@/contexts/ThemeContext';

type Props = {
  specifications: Record<string, string>;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
};

export function SpecificationGrid({ specifications }: Props) {
  const { tokens } = useThemeMode();
  const entries = Object.entries(specifications);
  if (!entries.length) return null;

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Text style={[styles.heading, { color: tokens.color.text }]}>Specifications</Text>
      {entries.map(([key, value]) => (
        <View key={key} style={[styles.row, { borderBottomColor: tokens.color.divider }]}>
          <Text style={[styles.key, { color: tokens.color.textMuted }]}>{key}</Text>
          <Text style={[styles.value, { color: tokens.color.text }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, gap: 0 },
  heading: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  key: { flex: 1, fontSize: 14, fontWeight: '600' },
  value: { flex: 1.2, fontSize: 14, textAlign: 'right', fontWeight: '500' },
});
