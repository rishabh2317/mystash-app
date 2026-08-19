import React from 'react';

import { ContextActions } from '@/components/chrome/ContextActions';
import { TopBar } from '@/components/chrome/TopBar';

type Props = {
  title: string;
  isSaved?: boolean;
  savePending?: boolean;
  onSavePress?: () => void;
  onSharePress?: () => void;
};

/** Collection page chrome — delegates to canonical TopBar. */
export function CollectionPageHeader({
  title,
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
      trailing={
        <ContextActions
          save={onSavePress ? { isSaved, pending: savePending, onPress: onSavePress } : undefined}
          share={onSharePress ? { onPress: onSharePress, accessibilityLabel: 'Share collection' } : undefined}
        />
      }
    />
  );
}
