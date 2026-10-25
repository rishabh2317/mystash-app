import { useRouter, type Href } from 'expo-router';
import React, { useCallback } from 'react';
import { View } from 'react-native';

import { ShareActivityCard } from '@/components/search/ShareActivityCard';
import { ShareActivityCardSkeleton } from '@/components/search/ShareActivityCardSkeleton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { deleteUserImport, retryUserImport } from '@/src/services/userImportApi';
import { typeStyle } from '@/src/theme/typography';
import {
  SHARE_ACTIVITY_COPY,
  type ShareActivityView,
} from '@/src/ui/shareActivity';

type Props = {
  items: ShareActivityView[];
  loading: boolean;
  onRefresh: () => void | Promise<void>;
};

/**
 * Your Activity rail — header stays mounted while shares load.
 * Search landing and Stash share this; retry/delete use the existing import APIs.
 */
export function YourActivitySection({ items, loading, onRefresh }: Props) {
  const { tokens } = useThemeMode();
  const router = useRouter();

  const onRetry = useCallback(
    async (importId: string) => {
      try {
        await retryUserImport(importId);
        await onRefresh();
      } catch {
        /* surface via next poll */
      }
    },
    [onRefresh],
  );

  const onDelete = useCallback(
    async (importId: string) => {
      try {
        await deleteUserImport(importId);
        await onRefresh();
      } catch {
        /* ignore */
      }
    },
    [onRefresh],
  );

  return (
    <View style={{ gap: tokens.space.md }}>
      <SectionHeader
        title={SHARE_ACTIVITY_COPY.sectionTitle}
        actionLabel={SHARE_ACTIVITY_COPY.seeAll}
        onActionPress={() => router.push('/shares' as Href)}
      />
      {loading ? (
        <ShareActivityCardSkeleton />
      ) : items.length > 0 ? (
        items.map((activity) => (
          <ShareActivityCard
            key={activity.importId}
            item={activity}
            compact
            expandable
            onRetry={onRetry}
            onDelete={onDelete}
          />
        ))
      ) : (
        <View style={{ gap: tokens.space.xxs, paddingVertical: tokens.space.xs }}>
          <Text style={typeStyle(tokens, 'tileTitle')}>{SHARE_ACTIVITY_COPY.empty}</Text>
          <Text style={typeStyle(tokens, 'tileMeta')}>{SHARE_ACTIVITY_COPY.emptyHint}</Text>
        </View>
      )}
    </View>
  );
}
