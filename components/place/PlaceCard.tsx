import { enqueueObservation } from '@/src/analytics/client';
import { useQualifiedExposure } from '@/src/analytics/hooks';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { PlaceSourceVideo, PlaceStashItem } from '@/src/types/placeStash';
import { placeCardView } from '@/src/ui/stashPlaces';
import { placeSourceVideos } from '@/src/ui/placeSourceVideo';
import { FEED_MIN_HIT_TARGET } from '@/src/ui/feedA11y';
import { PRODUCT_CARD_LAYOUT } from '@/src/ui/productCardLayout';
import { CardMediaActions } from '@/components/commerce/CardMediaActions';
import { PlaceImage } from './PlaceImage';

type Props = {
  item: PlaceStashItem;
  onSearch: (url: string) => void;
  onOpenSource?: (source: PlaceSourceVideo, sources?: PlaceSourceVideo[]) => void;
  onRemove?: () => void;
};

/** Product discovery-card geometry; no invented venue photos or destinations. */
export function PlaceCard({ item, onSearch, onOpenSource, onRemove }: Props) {
  const entityType=item.kind==='resolved'?'place':'place_save';
  const exposureRef=useQualifiedExposure('place.impression',entityType,item.id);
  const { tokens } = useThemeMode();
  const view = placeCardView(item);
  const sources = placeSourceVideos(item);
  const destinations = [{ id: 'search', label: view.ctaLabel, url: view.searchUrl }];

  return (
    <View ref={exposureRef} collapsable={false} style={[styles.card, outlineCardChrome(tokens), {
      borderRadius: tokens.radius.lg, padding: PRODUCT_CARD_LAYOUT.relatedInset,
    }]}>
      <View style={[styles.media, { borderRadius: tokens.radius.md, backgroundColor: tokens.color.surfaceSubtle }]}>
        <PlaceImage placeId={item.kind==='resolved'?item.id:null} name={view.name} style={StyleSheet.absoluteFill}/>
        <CardMediaActions title={view.name} onPlay={sources.length && onOpenSource ? () => onOpenSource(sources[0], sources) : undefined} onRemove={onRemove} />
      </View>
      <View style={{ paddingTop: tokens.space.xs, paddingHorizontal: tokens.space.xxs / 2, gap: tokens.space.xxs / 2 }}>
        <Text accessibilityRole="header" style={typeStyle(tokens, 'tileTitle')} numberOfLines={2}>{view.name}</Text>
        {view.location ? <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={2}>{view.location}</Text> : null}
        {view.categoryText ? <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={2}>{view.categoryText}</Text> : null}
        {/* Presentation slot is destination-neutral; Google Search is the only supported action. */}
        {destinations.map(destination => <Pressable key={destination.id} accessibilityRole="button"
          accessibilityLabel={`${destination.label}, ${view.name}`}
          onPress={() => {
            enqueueObservation('place.outbound_requested',entityType,item.id,'stash',{destination_kind:'search'});
            onSearch(view.searchUrl);
          }}
          style={({ pressed }) => [styles.destination, { gap: tokens.space.xxs,
            opacity: pressed ? tokens.motion.pressOpacity : 1 }]}>
          <Text style={[typeStyle(tokens, 'tileMeta'), { color: tokens.color.primary, flexShrink: 1 }]}>{destination.label}</Text>
          <Ionicons accessible={false} name="open-outline" size={12} color={tokens.color.primary} />
        </Pressable>)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', borderWidth: StyleSheet.hairlineWidth },
  media: { width: '100%', aspectRatio: PRODUCT_CARD_LAYOUT.relatedMediaAspect, overflow: 'hidden' },
  destination: { minHeight: FEED_MIN_HIT_TARGET, maxWidth: '100%', flexDirection: 'row', alignItems: 'center' },
});
