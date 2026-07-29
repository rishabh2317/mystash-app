import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';

type Props = {
  uri: string | null | undefined;
  alt: string;
  style?: object;
  contentFit?: 'cover' | 'contain';
};

export function ProductHeroImage({ uri, alt, style, contentFit = 'cover' }: Props) {
  const source = uri && uri.startsWith('http') ? uri : CATALOG_IMAGE_PLACEHOLDER;
  return (
    <View style={[styles.wrap, style]}>
      <Image
        source={{ uri: source }}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        recyclingKey={source}
        accessibilityLabel={alt}
        transition={200}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
});
