import React, { useMemo } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Extrapolate,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';

import { useThemeMode } from '@/contexts/ThemeContext';
import type { Product, Video } from '@/src/mocks/videos';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const DOCK_HEIGHT = SCREEN_HEIGHT * 0.32;
/** Fixed-width dock chips so one product does not stretch across the row; extras scroll horizontally. */
const PRODUCT_DOCK_CARD_WIDTH = 96;
const VIEW_MORE_CELL_WIDTH = 86;

function StarDustOverlay({ density = 90 }: { density?: number }) {
  // Stable star positions across renders.
  const stars = useMemo(() => {
    const arr: Array<{ x: number; y: number; s: number }> = [];
    for (let i = 0; i < density; i++) {
      arr.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        s: Math.random() < 0.3 ? 1.5 : 1,
      });
    }
    return arr;
  }, [density]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {stars.map((star, idx) => (
        <View
          key={idx}
          style={{
            position: 'absolute',
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.s,
            height: star.s,
            borderRadius: 2,
            backgroundColor: 'white',
            opacity: 0.1,
          }}
        />
      ))}
    </View>
  );
}

function LedFlowTrack({ lightOpacity, darkOpacity }: { lightOpacity: any; darkOpacity: any }) {
  const pulse = useSharedValue(0);

  React.useEffect(() => {
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: 1600 }), -1, true);
  }, [pulse]);

  const baseLightStyle = useAnimatedStyle(() => ({
    opacity: lightOpacity.value * 0.6,
  }));

  const baseNebulaStyle = useAnimatedStyle(() => ({
    opacity: darkOpacity.value * 0.6,
  }));

  const titaniumGlowStyle = useAnimatedStyle(() => ({
    opacity: lightOpacity.value * interpolate(pulse.value, [0, 1], [0.45, 0.95], Extrapolate.CLAMP),
    transform: [{ scaleX: interpolate(pulse.value, [0, 1], [0.985, 1], Extrapolate.CLAMP) }],
  }));

  const nebulaGlowStyle = useAnimatedStyle(() => ({
    opacity: darkOpacity.value * interpolate(pulse.value, [0, 1], [0.35, 0.9], Extrapolate.CLAMP),
    transform: [{ scaleX: interpolate(pulse.value, [0, 1], [0.98, 1], Extrapolate.CLAMP) }],
  }));

  return (
    <View style={styles.ledOuter}>
      <Animated.View style={[styles.ledBaseLight, baseLightStyle]} pointerEvents="none" />
      <Animated.View style={[styles.ledBaseNebula, baseNebulaStyle]} pointerEvents="none" />

      <Animated.View
        style={[styles.fullLengthLed, titaniumGlowStyle, { shadowRadius: 8, shadowOpacity: 0.6 }]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={['#00F2FF', '#22D3EE', '#60A5FA', '#00F2FF']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        style={[styles.fullLengthLed, nebulaGlowStyle, { shadowColor: '#A855F7', shadowRadius: 15, shadowOpacity: 0.65 }]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={['#A855F7', '#7C3AED', '#22D3EE', '#A855F7']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

function ProductCardFrame({
  product,
  lightOpacity,
  darkOpacity,
}: {
  product: Product;
  lightOpacity: any;
  darkOpacity: any;
}) {
  return (
    <View style={styles.productCardColumn}>
      <Animated.View style={[styles.titaniumCardFrame, styles.layerFill, { opacity: lightOpacity }]} pointerEvents="none">
        <View style={styles.cardContent}>
          <Image
            source={{ uri: product.image }}
            style={styles.productImage}
            contentFit="cover"
            recyclingKey={`${product.id}:${product.image}`}
          />
          <Text style={[styles.productPrice, { color: '#1A1A1B' }]}>{product.price}</Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.nebulaCardFrame, styles.layerFill, { opacity: darkOpacity }]} pointerEvents="none">
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[styles.nebulaCardInner, styles.cardContent]}>
          <Image
            source={{ uri: product.image }}
            style={styles.productImage}
            contentFit="cover"
            recyclingKey={`${product.id}:${product.image}`}
          />
          <Text style={[styles.productPrice, { color: '#F8FAFC', textShadowColor: '#A855F7' }]}>{product.price}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

export default function BottomDock({
  video,
  router,
  onVolumeToggle,
  isMuted,
}: {
  video: Video;
  router: any;
  onVolumeToggle?: () => void;
  isMuted?: boolean;
}) {
  const { mode, lightOpacity, darkOpacity } = useThemeMode();

  const products = video.products || [];
  const showProductDock = products.length > 0;

  const handleViewAll = () => {
    if (!video.collection_id) return;
    router.push(`/collection/${video.collection_id}`);
  };

  const titleAnimatedStyle = useAnimatedStyle(() => {
    return {
      color: interpolateColor(lightOpacity.value, [0, 1], ['#F8FAFC', '#1A1A1B']),
      textShadowColor: interpolateColor(
        lightOpacity.value,
        [0, 1],
        ['rgba(168,85,247,0.55)', 'rgba(0,0,0,0)'],
      ),
      textShadowRadius: interpolate(lightOpacity.value, [0, 1], [10, 0], Extrapolate.CLAMP),
    } as any;
  });

  const curatorAnimatedStyle = useAnimatedStyle(() => {
    return {
      color: interpolateColor(lightOpacity.value, [0, 1], ['#E5E7EB', '#4E5257']),
    } as any;
  });

  const stashAnimatedStyle = useAnimatedStyle(() => {
    return {
      color: interpolateColor(lightOpacity.value, [0, 1], ['#A855F7', '#00F2FF']),
    } as any;
  });

  const starTint = mode === 'titanium' ? '#F59E0B' : '#FDE68A';

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {/* Dock background crossfade */}
      <Animated.View style={[styles.titaniumBg, { opacity: lightOpacity }]} pointerEvents="none">
        <LinearGradient
          colors={['#FDFDFD', '#E8E8E8', '#D1D1D1']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.nebulaBg, { opacity: darkOpacity }]} pointerEvents="none">
        <LinearGradient
          colors={['#0D111F', '#020408']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
        <LinearGradient
          colors={['rgba(45,58,104,0.45)', 'rgba(13,17,31,0.0)']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
        <StarDustOverlay />
      </Animated.View>

      {/* Specular chamfer line (top edge of the dock) */}
      <View style={styles.dockTopSpecular} pointerEvents="none" />

      {/* Inner-edge LED track (dock meets video at its top edge) */}
      <View style={styles.ledTopEdge}>
        <LedFlowTrack lightOpacity={lightOpacity} darkOpacity={darkOpacity} />
      </View>

      <View style={styles.dockContent} pointerEvents="box-none">
        {/* Metadata Section */}
        <View style={styles.metadataSection}>
          <View style={styles.titleRow}>
            <View style={styles.titleTextWrap}>
              <Animated.Text
                style={[styles.videoTitle, titleAnimatedStyle]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {video.video_title || video.product_name}
              </Animated.Text>
            </View>

            {onVolumeToggle && (
              <TouchableOpacity
                style={[
                  styles.volumeButton,
                  {
                    backgroundColor: mode === 'titanium' ? 'rgba(0,242,255,0.18)' : 'rgba(168,85,247,0.18)',
                  },
                ]}
                onPress={onVolumeToggle}
                activeOpacity={0.8}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={styles.speakerIcon}>{isMuted ? '🔇' : '🔊'}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.curatorRow}>
            <View style={styles.identityCluster}>
              <Animated.Text style={[styles.curatorName, curatorAnimatedStyle]} numberOfLines={1}>
                {video.curator_id || video.creator_name}
              </Animated.Text>
              <View style={styles.stashScoreContainer}>
                <Ionicons name="star" size={11} color={starTint} />
                <Animated.Text style={[styles.stashScore, stashAnimatedStyle]}>
                  {video.stash_score}
                </Animated.Text>
              </View>
            </View>
          </View>
        </View>

        {/* Product chips: horizontal scroll + always-visible View More → product list with embed */}
        {showProductDock ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.productScroll}
            contentContainerStyle={styles.productScrollContent}
            nestedScrollEnabled
          >
            {products.map((product) => (
              <View key={product.id} style={styles.productScrollItem}>
                <ProductCardFrame product={product} lightOpacity={lightOpacity} darkOpacity={darkOpacity} />
              </View>
            ))}

            <TouchableOpacity
              style={styles.viewMoreCell}
              onPress={handleViewAll}
              activeOpacity={0.8}
            >
              <View style={styles.viewAllContainer}>
                <Animated.View
                  style={[styles.viewAllTitanium, styles.layerFill, { opacity: lightOpacity }]}
                  pointerEvents={mode === 'titanium' ? 'auto' : 'none'}
                >
                  <LinearGradient
                    colors={['#FDFDFD', '#D1D1D1']}
                    style={StyleSheet.absoluteFill}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                  />
                  <View style={styles.viewAllPressedInner} />
                  <Text style={styles.viewAllTextTitanium}>View More</Text>
                </Animated.View>

                <Animated.View
                  style={[styles.viewAllNebula, styles.layerFill, { opacity: darkOpacity }]}
                  pointerEvents={mode === 'nebula' ? 'auto' : 'none'}
                >
                  <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
                  <View style={styles.viewAllPortalBorder} />
                  <Text style={styles.viewAllTextNebula}>View More</Text>
                </Animated.View>
              </View>
            </TouchableOpacity>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: DOCK_HEIGHT,
    zIndex: 10,
  },
  titaniumBg: {
    ...StyleSheet.absoluteFillObject,
  },
  nebulaBg: {
    ...StyleSheet.absoluteFillObject,
  },
  dockTopSpecular: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.95,
  },
  ledTopEdge: {
    position: 'absolute',
    top: 1,
    left: 0,
    right: 0,
    height: 2,
  },
  ledOuter: {
    flex: 1,
  },
  ledBaseLight: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(176,181,187,0.95)',
  },
  ledBaseNebula: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.30)',
  },
  fullLengthLed: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 0,
    overflow: 'hidden',
    shadowColor: '#00F2FF',
  },
  dockContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
  },
  metadataSection: {
    paddingBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 0,
  },
  titleTextWrap: {
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  videoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  volumeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  speakerIcon: {
    fontSize: 16,
    color: '#0A0E14',
  },
  curatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  identityCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  curatorName: {
    fontSize: 14,
    fontWeight: '600',
    maxWidth: SCREEN_WIDTH * 0.56,
  },
  stashScoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  stashScore: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  productScroll: {
    maxHeight: 92,
    marginTop: 2,
  },
  productScrollContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    paddingRight: 4,
    paddingVertical: 2,
  },
  productScrollItem: {
    width: PRODUCT_DOCK_CARD_WIDTH,
    minHeight: 82,
  },
  viewMoreCell: {
    width: VIEW_MORE_CELL_WIDTH,
    minHeight: 82,
  },
  productCardColumn: {
    width: '100%',
    minHeight: 82,
    position: 'relative',
  },
  layerFill: {
    ...StyleSheet.absoluteFillObject,
  },
  cardContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginBottom: 4,
  },
  productPrice: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  titaniumCardFrame: {
    backgroundColor: 'rgba(255,255,255,0.60)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B0B5BB',
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  nebulaCardFrame: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    padding: 8,
  },
  nebulaCardInner: {
    paddingHorizontal: 2,
  },
  viewAllContainer: {
    flex: 1,
    position: 'relative',
    minHeight: 82,
  },
  viewAllTitanium: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B0B5BB',
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flex: 1,
  },
  viewAllPressedInner: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.7)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  viewAllTextTitanium: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A1A1B',
  },
  viewAllNebula: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#A855F7',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    flex: 1,
  },
  viewAllPortalBorder: {
    position: 'absolute',
    top: 1,
    bottom: 1,
    left: 1,
    right: 1,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.25)',
  },
  viewAllTextNebula: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F8FAFC',
    textShadowColor: '#A855F7',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
  },
});

