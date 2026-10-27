import { enqueueObservation } from '@/src/analytics/client';
import { useQualifiedExposure } from '@/src/analytics/hooks';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { PlaceStashItem } from '@/src/types/placeStash';
import { placeCardView } from '@/src/ui/stashPlaces';

type Props = {
  item: PlaceStashItem;
  onSearch: (url: string) => void;
};

/**
 * Media-first Stash place card. Leads stay lighter and never invent a place photo.
 */
export function PlaceCard({ item, onSearch }: Props) {
  const entityType=item.kind==='resolved'?'place':'place_save';
  const exposureRef=useQualifiedExposure('place.impression',entityType,item.id);
  const { tokens } = useThemeMode();
  const view = placeCardView(item);
  const chrome = outlineCardChrome(tokens);

  return (
    <View
      ref={exposureRef}
      collapsable={false}
      style={[
        styles.card,
        {
          ...chrome,
          borderRadius: tokens.radius.lg,
          opacity: view.lead ? 0.88 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.media,
          {
            backgroundColor: tokens.color.surfaceSubtle,
            aspectRatio: view.lead ? 16 / 10 : 16 / 9,
          },
        ]}
      >
        {view.imageUrl ? (
          <Image
            source={{ uri: view.imageUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={`${item.kind}:${item.id}:${view.imageUrl}`}
            accessibilityLabel={view.name}
            transition={200}
          />
        ) : (
          <View style={styles.fallback} accessibilityLabel={`${view.name} photo unavailable`}>
            <Ionicons name="location-outline" size={22} color={tokens.color.textMuted} />
          </View>
        )}
      </View>
      <View style={{ padding: tokens.space.md, gap: tokens.space.sm }}>
        <View style={{ gap: tokens.space.xxs }}>
          <Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={2}>
            {view.name}
          </Text>
          {view.category ? (
            <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
              {view.category}
            </Text>
          ) : null}
          {view.location ? (
            <Text style={typeStyle(tokens, 'bodyMuted')} numberOfLines={1}>
              {view.location}
            </Text>
          ) : null}
          {view.uncertainty ? (
            <Text style={[typeStyle(tokens, 'tileMeta'), { color: tokens.color.textMuted }]} numberOfLines={2}>
              {view.uncertainty}
            </Text>
          ) : null}
        </View>
        <ActionButton
          size="compact"
          variant="outlinePrimary"
          label={view.ctaLabel}
          onPress={() => {
            enqueueObservation('place.outbound_requested',entityType,item.id,'stash',{destination_kind:'search'});
            onSearch(view.searchUrl);
          }}
          accessibilityLabel={`${view.ctaLabel}, ${view.name}`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  media: {
    width: '100%',
    overflow: 'hidden',
  },
  fallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
