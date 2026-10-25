import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';

type Props = {
  presentation?: 'rail' | 'grid' | 'row';
  railWidth?: number;
};

export function BagItemCardSkeleton({ presentation = 'grid', railWidth }: Props) {
  const tokens = useThemeTokens();
  const isRow = presentation === 'row';

  return (
    <View
      style={[
        isRow ? styles.rowCard : styles.card,
        presentation === 'rail' && railWidth ? { width: railWidth } : null,
        presentation === 'grid' ? styles.gridCard : null,
      ]}
    >
      <View
        style={[
          isRow ? styles.rowPress : styles.stackPress,
          { gap: tokens.space.sm },
        ]}
      >
        <SkeletonBlock
          radius={tokens.radius.lg}
          width={isRow ? 96 : undefined}
          height={isRow ? 96 : undefined}
          style={
            isRow
              ? undefined
              : {
                  width: '100%',
                  height: undefined,
                  aspectRatio: presentation === 'rail' ? 3 / 4 : 1,
                }
          }
        />
        <View style={[styles.meta, { gap: tokens.space.xxs }, isRow ? styles.rowMeta : null]}>
          <SkeletonBlock width="40%" height={11} />
          <SkeletonBlock height={isRow ? 18 : 15} />
          <SkeletonBlock width="35%" height={14} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexGrow: 0 },
  gridCard: { flex: 1, minWidth: 0 },
  rowCard: { width: '100%' },
  stackPress: { flexDirection: 'column', alignItems: 'stretch' },
  rowPress: { flexDirection: 'row', alignItems: 'flex-start' },
  meta: { minWidth: 0 },
  rowMeta: { flex: 1, paddingTop: 2 },
});
