import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { railPageIndex } from '@/src/ui/rail';

type Props = {
  children: React.ReactNode;
  /** Page gutter the rail should bleed into so cards start flush with content. */
  gutter?: number;
  /** Card pitch (card width + gap) — enables snapping and page dots. */
  itemPitch?: number;
  /** Number of pages for the dot indicator. Omit to hide dots. */
  pageCount?: number;
  accessibilityLabel?: string;
};

/**
 * Horizontal rail with consistent gutter bleed, snapping and an optional
 * page indicator. Sections supply cards; the rail owns scroll mechanics.
 */
export function ContentRail({
  children,
  gutter = 0,
  itemPitch,
  pageCount,
  accessibilityLabel,
}: Props) {
  const { tokens } = useThemeMode();
  const [page, setPage] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const showDots = Boolean(pageCount && pageCount > 1 && itemPitch);
  const measured = viewportWidth > 0 && contentWidth > 0;

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!showDots || !itemPitch) return;
    const next = railPageIndex({
      offsetX: event.nativeEvent.contentOffset.x,
      itemPitch,
      pageCount: pageCount ?? 0,
      maxOffsetX: measured ? Math.max(0, contentWidth - viewportWidth) : undefined,
    });
    if (next !== page) setPage(next);
  };

  const onLayout = (event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={itemPitch}
        snapToAlignment="start"
        disableIntervalMomentum
        onScroll={showDots ? onScroll : undefined}
        scrollEventThrottle={showDots ? 32 : undefined}
        onLayout={showDots ? onLayout : undefined}
        onContentSizeChange={showDots ? (width) => setContentWidth(width) : undefined}
        accessibilityLabel={accessibilityLabel}
        style={{ marginHorizontal: -gutter }}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          gap: itemPitch ? undefined : tokens.space.sm,
          // Horizontal rails must not stretch children to the page height —
          // related cards would grow a tall empty body under the price.
          alignItems: 'flex-start',
        }}
      >
        {children}
      </ScrollView>
      {showDots ? (
        <View style={[styles.dots, { gap: tokens.space.xxs, marginTop: tokens.space.sm }]}>
          {Array.from({ length: pageCount ?? 0 }).map((_, index) => (
            <View
              key={`dot-${index}`}
              style={[
                styles.dot,
                {
                  borderRadius: tokens.radius.pill,
                  backgroundColor:
                    index === page ? tokens.color.primary : tokens.color.border,
                  width: index === page ? tokens.space.sm : tokens.space.xxs,
                },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    height: 4,
  },
});
