import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';

type Props = {
  allowPlaceholder?: boolean;
  productId: string;
  uri: string | null | undefined;
  alt: string;
  style?: object;
  contentFit?: 'cover' | 'contain';
};

export function ProductHeroImage({ productId, uri, alt, style, allowPlaceholder=true, contentFit = 'cover' }: Props) {
  const source = uri && uri.startsWith('http') ? uri : allowPlaceholder ? CATALOG_IMAGE_PLACEHOLDER : null;
  return (
    <View style={[styles.wrap, style]}>
      {source ? <Image
        source={{ uri: source }}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        recyclingKey={`${productId}:${source}`}
        accessibilityLabel={alt}
        transition={200}
      /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
});
