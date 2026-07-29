import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  specifications: Record<string, string>;
  isLight: boolean;
};

export function SpecificationGrid({ specifications, isLight }: Props) {
  const entries = Object.entries(specifications);
  if (!entries.length) return null;

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Text style={[styles.heading, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>Specifications</Text>
      {entries.map(([key, value]) => (
        <View key={key} style={[styles.row, { borderBottomColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }]}>
          <Text style={[styles.key, { color: isLight ? '#64748B' : '#94A3B8' }]}>{key}</Text>
          <Text style={[styles.value, { color: isLight ? '#0F172A' : '#F1F5F9' }]}>{value}</Text>
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
