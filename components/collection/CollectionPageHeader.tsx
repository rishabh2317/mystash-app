import React, { useMemo } from 'react';

import { ContextActions } from '@/components/chrome/ContextActions';
import { OverflowMenu, type OverflowMenuItem } from '@/components/chrome/OverflowMenu';
import { TopBar } from '@/components/chrome/TopBar';

type Props = {
  /** Kept for the loading / error states, where there is no hero title yet. */
  title?: string;
  isSaved?: boolean;
  savePending?: boolean;
  onSavePress?: () => void;
  onSharePress?: () => void;
  /** Secondary actions collapsed into the overflow menu. */
  overflowItems?: OverflowMenuItem[];
};

/**
 * Collection chrome — canonical TopBar with Save + overflow.
 * The page title lives in the hero, so the bar stays clean and unlabelled
 * once content is loaded.
 */
export function CollectionPageHeader({
  title,
  isSaved = false,
  savePending = false,
  onSavePress,
  onSharePress,
  overflowItems,
}: Props) {
  const items = useMemo<OverflowMenuItem[]>(() => {
    const rows: OverflowMenuItem[] = [];
    if (onSharePress) {
      rows.push({
        id: 'share',
        label: 'Share collection',
        icon: 'share-outline',
        onPress: onSharePress,
      });
    }
    return [...rows, ...(overflowItems ?? [])];
  }, [onSharePress, overflowItems]);

  return (
    <TopBar
      mode="page"
      title={title}
      showBack
      showBag={false}
      backAccessibilityLabel="Back"
      trailing={
        <ContextActions
          save={
            onSavePress
              ? { isSaved, pending: savePending, iconOnly: true, onPress: onSavePress }
              : undefined
          }
        >
          <OverflowMenu items={items} accessibilityLabel="More collection actions" />
        </ContextActions>
      }
    />
  );
}
