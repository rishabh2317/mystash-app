import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useThemeTokens } from '@/src/theme/useThemeTokens';

type Props = {
  gap?: number;
  padding?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export function SkeletonStack({ gap, padding, style, children }: Props) {
  const tokens = useThemeTokens();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.wrap, { gap: gap ?? tokens.space.sm, padding: padding ?? 0 }, style]}
    >
      {children}
    </View>
  );
}

export function SkeletonGrid({
  columns = 2,
  gap,
  children,
}: {
  columns?: number;
  gap?: number;
  children: React.ReactNode;
}) {
  const tokens = useThemeTokens();
  const items = React.Children.toArray(children);
  const gutter = gap ?? tokens.space.sm;
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return (
    <View
      style={{ gap: gutter }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={[styles.row, { gap: gutter }]}>
          {row.map((child, i) => (
            <View key={i} style={styles.cell}>
              {child}
            </View>
          ))}
          {row.length < columns
            ? Array.from({ length: columns - row.length }).map((_, i) => (
                <View key={`pad-${i}`} style={styles.cell} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
});
