import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CatalogVerificationStatus } from '@/src/types/catalogProduct';

const LABELS: Record<CatalogVerificationStatus, string> = {
  VERIFIED: 'Verified',
  UNVERIFIED: 'Unverified',
  UNRESOLVED: 'Unresolved',
  RESOLVING: 'Resolving',
};

type Props = {
  status: CatalogVerificationStatus;
  isLight: boolean;
};

export function VerificationBadge({ status, isLight }: Props) {
  const bg =
    status === 'VERIFIED'
      ? isLight
        ? '#DCFCE7'
        : '#14532D'
      : status === 'UNVERIFIED'
        ? isLight
          ? '#FEF3C7'
          : '#78350F'
        : status === 'RESOLVING'
          ? isLight
            ? '#E0F2FE'
            : '#0C4A6E'
          : isLight
            ? '#E2E8F0'
            : '#334155';
  const fg =
    status === 'VERIFIED'
      ? isLight
        ? '#166534'
        : '#BBF7D0'
      : status === 'UNVERIFIED'
        ? isLight
          ? '#92400E'
          : '#FDE68A'
        : status === 'RESOLVING'
          ? isLight
            ? '#0369A1'
            : '#7DD3FC'
          : isLight
            ? '#334155'
            : '#E2E8F0';

  return (
    <View
      style={[styles.badge, { backgroundColor: bg }]}
      accessibilityRole="text"
      accessibilityLabel={`Verification status: ${LABELS[status]}`}
    >
      <Text style={[styles.text, { color: fg }]}>{LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
