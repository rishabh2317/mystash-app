import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextLayoutEventData,
  type NativeSyntheticEvent,
  type TextStyle,
} from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

type Props = {
  text: string;
  /** Lines shown while collapsed. */
  collapsedLines: number;
  style: StyleProp<TextStyle>;
  expandLabel?: string;
  collapseLabel?: string;
  accessibilityRole?: 'header' | 'text';
};

/**
 * Long copy clamped to `collapsedLines` with a toggle, shown only when the text
 * actually overflows. Overflow is measured by rendering the string once
 * unclamped and invisible, so the toggle never appears for short copy.
 */
export function ExpandableText({
  text,
  collapsedLines,
  style,
  expandLabel = 'More',
  collapseLabel = 'Less',
  accessibilityRole,
}: Props) {
  const { tokens } = useThemeMode();
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const overflows = totalLines !== null && totalLines > collapsedLines;

  const onMeasure = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const lines = event.nativeEvent.lines.length;
    setTotalLines((current) => (current === lines ? current : lines));
  };

  // Clamp until measured and while collapsed, so a long title never flashes
  // three-plus lines before onTextLayout fires.
  const body = (
    <Text
      accessibilityRole={accessibilityRole}
      style={style}
      numberOfLines={expanded ? undefined : collapsedLines}
    >
      {text}
    </Text>
  );

  return (
    <View>
      <Text
        style={[style, styles.measure]}
        onTextLayout={onMeasure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {text}
      </Text>

      {overflows ? (
        <Pressable
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={`${text}. ${expanded ? collapseLabel : expandLabel}`}
          accessibilityState={{ expanded }}
          style={({ pressed }) => ({
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          })}
        >
          {body}
          <Text
            style={{
              color: tokens.color.primary,
              fontSize: tokens.fontSize.label,
              lineHeight: tokens.lineHeight.label,
              fontWeight: tokens.fontWeight.bold,
              marginTop: tokens.space.xxs,
            }}
          >
            {expanded ? collapseLabel : expandLabel}
          </Text>
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Off-layout copy used only to count lines before the first clamp. */
  measure: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
    top: 0,
  },
});
