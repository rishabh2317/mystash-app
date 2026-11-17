/** Offline compatibility fixture. Never connect this surface to production data. */
import React from 'react';
import { Linking, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { ProductCard } from '@/components/commerce/ProductCard';
import { ProductPage } from '@/components/product/ProductPage';
import { PlaceCard } from '@/components/place/PlaceCard';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { catalogViewFromProductPage } from '@/src/ui/productPage';
import type { ProductPageView } from '@/src/types/productPage';
import type { PlaceStashResolved } from '@/src/types/placeStash';
const productId = '11111111-1111-4111-8111-111111111111';
const page: ProductPageView = {
  productId, shoppingProductId: null, title: 'Product compatibility fixture', brand: 'Mystash', category: 'Home',
  heroImage: null, galleryImages: [], price: '120', currency: 'INR', merchant: 'Fixture merchant',
  description: 'An offline fixture for the existing Product Page. Buying options use stored data only.',
  specifications: { Material: 'Ceramic' }, offers: [{ id: 'fixture-offer', merchant: 'Fixture merchant', price: '120', currency: 'INR', availability: 'in_stock', action: 'buy' }],
  canShop: true, source: null, relatedMedia: [], reviews: null, compareAvailable: false, detailsUpdating: false,
};
const place: PlaceStashResolved = {
  kind: 'resolved', id: productId, name: 'Place compatibility fixture', category: 'Cafe', localityLabel: 'Mumbai, India',
  formattedAddress: 'Fixture address, Mumbai', destination: { kind: 'google_search', query: 'Fixture cafe Mumbai', url: 'https://www.google.com/search?q=Fixture+cafe+Mumbai' }, image: null,
};
const publicActions = { onSave() {}, async onShop() {} };
export default function Proof() {
  const { tokens, toggleTheme } = useThemeMode();
  const { productId: detailProduct, placeId } = useLocalSearchParams();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(260, Math.max(140, (width - 52) / 2));
  return <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
    <ScrollView contentContainerStyle={{ padding: 16, gap: tokens.space.md, maxWidth: 1000, width: '100%', alignSelf: 'center' }}>
      <Text style={typeStyle(tokens, 'sectionTitle')}>Public Stash · technical proof</Text>
      <Text style={typeStyle(tokens, 'bodyMuted')}>Offline fixtures. Publishing and saving are not implemented here.</Text>
      <Pressable accessibilityRole="button" onPress={toggleTheme} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={typeStyle(tokens, 'link')}>Change theme</Text></Pressable>
      <Text style={typeStyle(tokens, 'body')}>Curated by @mystash</Text>
      <Link href={"/stash/proof" as Href}>Stash</Link>
      {detailProduct ? <ProductPage page={page} publicActions={publicActions} /> : placeId ? <View style={{ gap: 12 }}>
        <Text style={typeStyle(tokens, 'sectionTitle')}>{place.name}</Text>
        <Text style={typeStyle(tokens, 'body')}>{place.formattedAddress}</Text>
        <Text style={typeStyle(tokens, 'bodyMuted')}>Provider images and attribution require the public membership authorization implemented after this proof.</Text>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(place.destination.url)}><Text style={typeStyle(tokens, 'link')}>Search Google</Text></Pressable>
      </View> : <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ width: cardWidth }}><ProductCard product={catalogViewFromProductPage(page)} variant="related" onPress={() => {}} /><Link href={`/stash/proof/products/catalog/${productId}` as Href}>Open product</Link></View>
        <View style={{ width: cardWidth }}><PlaceCard item={place} onSearch={() => {}} /><Link href={`/stash/proof/places/${productId}` as Href}>Open place</Link></View>
      </View>}
    </ScrollView>
  </View>;
}
