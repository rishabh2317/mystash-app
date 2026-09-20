import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';

export type OverflowMenuItem = {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  destructive?: boolean;
};

type Props = {
  items: OverflowMenuItem[];
  accessibilityLabel?: string;
};

const CONTROL_SIZE = 40;

/**
 * Chrome overflow: secondary page actions that must stay reachable without
 * competing with the page's primary controls.
 */
export function OverflowMenu({ items, accessibilityLabel = 'More actions' }: Props) {
  const { tokens } = useThemeMode();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        hitSlop={hitSlopToMinTarget(CONTROL_SIZE)}
        style={({ pressed }) => [
          styles.control,
          {
            backgroundColor: tokens.color.overlay,
            borderRadius: tokens.radius.pill,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={tokens.color.icon} />
      </Pressable>

      <Modal
        visible={open}
        animationType="fade"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: tokens.overlay.scrim }]}
          onPress={() => setOpen(false)}
          accessibilityLabel="Dismiss menu"
        >
          <View
            style={[
              styles.sheet,
              {
                marginBottom: Math.max(insets.bottom, tokens.space.md),
                marginHorizontal: tokens.space.md,
                backgroundColor: tokens.color.canvasSoft,
                borderColor: tokens.color.border,
                borderRadius: tokens.radius.xl,
              },
            ]}
          >
            {items.map((item, index) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setOpen(false);
                  item.onPress();
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                style={({ pressed }) => [
                  styles.item,
                  {
                    paddingHorizontal: tokens.space.md,
                    paddingVertical: tokens.space.sm,
                    gap: tokens.space.sm,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: tokens.color.divider,
                    opacity: controlOpacity(
                      resolveControlPhase({ pressed }),
                      tokens.motion.pressOpacity,
                    ),
                  },
                ]}
              >
                <Ionicons
                  name={item.icon}
                  size={18}
                  color={item.destructive ? tokens.color.danger : tokens.color.text}
                />
                <Text
                  style={{
                    color: item.destructive ? tokens.color.danger : tokens.color.text,
                    fontSize: tokens.fontSize.body,
                    lineHeight: tokens.lineHeight.body,
                    fontWeight: tokens.fontWeight.semibold,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  control: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
