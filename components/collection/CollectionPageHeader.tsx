import React from 'react';

import { ContextActions } from '@/components/chrome/ContextActions';
import { TopBar } from '@/components/chrome/TopBar';

type Props = {
  /** Defaults to “Shop” — Collection title lives in the hero. */
  title?: string;
  isSaved?: boolean;
  savePending?: boolean;
  onSavePress?: () => void;
  onSharePress?: () => void;
};

/**
 * Collection chrome — Save + Share icon actions.
 * Page heading is “Shop”; the collection title lives in the hero.
 */
export function CollectionPageHeader({
  title = 'Shop',
  isSaved = false,
  savePending = false,
  onSavePress,
  onSharePress,
}: Props) {
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
          share={
            onSharePress
              ? { onPress: onSharePress, accessibilityLabel: 'Share collection' }
              : undefined
          }
        />
      }
    />
  );
}
