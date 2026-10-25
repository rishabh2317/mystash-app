import React, { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import {
  listCreatorLibrary,
  type CreatorLibraryItem,
  type CreatorLibrarySnapshot,
} from '@/src/services/creatorLibraryApi';
import { CREATE_COPY } from '@/src/ui/createCopy';
import { studioPlatformLabel } from '@/src/ui/createStudioFlow';

export type StudioLibrarySelection = {
  sourceUrl: string;
  title?: string;
  thumbnail?: string;
  platform?: string;
  contentSourceId?: string;
};

type Props = {
  selectedUrl?: string | null;
  onSelect: (video: StudioLibrarySelection) => void;
};

/** Already-synced videos as a selection list — no enclosing card. */
export function CreateStudioLibraryPicker({ selectedUrl, onSelect }: Props) {
  const { tokens } = useThemeMode();
  const [snapshot, setSnapshot] = useState<CreatorLibrarySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listCreatorLibrary()
      .then((next) => {
        setSnapshot(next);
        setError(next.sync?.error ?? null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : CREATE_COPY.libraryUnavailable));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const items = snapshot?.items ?? [];

  return (
    <View style={{ gap: tokens.space.xs }}>
      {error ? (
        <Text style={[typeStyle(tokens, 'bodyMuted'), { color: tokens.color.danger, fontSize: tokens.fontSize.caption }]}>
          {error}
        </Text>
      ) : null}
      {items.length === 0 ? (
        <Text style={[typeStyle(tokens, 'bodyMuted'), { fontSize: tokens.fontSize.caption, lineHeight: 18 }]}>
          {CREATE_COPY.libraryEmpty}
        </Text>
      ) : (
        items.slice(0, 12).map((item) => (
          <LibraryRow
            key={item.membershipId}
            item={item}
            selected={selectedUrl === item.canonicalUrl}
            onSelect={onSelect}
          />
        ))
      )}
    </View>
  );
}

function LibraryRow({
  item,
  selected,
  onSelect,
}: {
  item: CreatorLibraryItem;
  selected: boolean;
  onSelect: (video: StudioLibrarySelection) => void;
}) {
  const { tokens } = useThemeMode();
  const unavailable = item.availability === 'unavailable';
  const chrome = outlineCardChrome(tokens);

  return (
    <Pressable
      onPress={() => {
        if (unavailable || !item.canonicalUrl) return;
        onSelect({
          sourceUrl: item.canonicalUrl,
          title: item.title ?? undefined,
          thumbnail: item.thumbnailUrl ?? undefined,
          platform: item.platform,
          contentSourceId: item.contentSourceId,
        });
      }}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: unavailable }}
      accessibilityLabel={item.title || item.externalId}
      style={({ pressed }) => [
        styles.row,
        {
          ...chrome,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: selected ? tokens.color.primary : chrome.borderColor,
          backgroundColor: selected ? tokens.color.primarySurface : chrome.backgroundColor,
          borderRadius: tokens.radius.md,
          paddingVertical: tokens.space.xs,
          paddingHorizontal: tokens.space.xs,
          opacity: controlOpacity(
            resolveControlPhase({ pressed, disabled: unavailable }),
            tokens.motion.pressOpacity,
          ),
        },
      ]}
    >
      {item.thumbnailUrl ? (
        <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, { backgroundColor: tokens.color.canvasEnd }]} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={typeStyle(tokens, 'tileTitle')}>
          {item.title || item.externalId}
        </Text>
        <Text style={typeStyle(tokens, 'tileMeta')}>{studioPlatformLabel(item.platform)}</Text>
        {item.canonicalUrl ? (
          <Text numberOfLines={1} style={typeStyle(tokens, 'tileMeta')}>
            {item.canonicalUrl}
          </Text>
        ) : null}
        {unavailable ? (
          <Text style={typeStyle(tokens, 'tileMeta')}>{CREATE_COPY.libraryUnavailable}</Text>
        ) : null}
      </View>
      {selected ? (
        <Text style={typeStyle(tokens, 'tilePrice')}>{CREATE_COPY.videoSelectedBadge}</Text>
      ) : unavailable ? null : (
        <Ionicons name="chevron-forward-outline" size={16} color={tokens.color.textMuted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 44, height: 58, borderRadius: 8 },
});
