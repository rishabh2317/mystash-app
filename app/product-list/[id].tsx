import InstagramReelItem from '@/components/InstagramReelItem';
import YouTubeReelItem from '@/components/YouTubeReelItem';
import { Product, Video } from '@/src/mocks/videos';
import { fetchVideoById } from '@/src/services/supabase';
import { getVideoUrlInfo } from '@/src/utils/videoUtils';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeMode } from '@/contexts/ThemeContext';
import { openProductShopping } from '@/src/services/shoppingClick';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

import { mockVideos } from '@/src/mocks/videos';

function ProductCard({
  product,
  router,
  videoId,
}: {
  product: Product;
  router: any;
  videoId?: string;
}) {
  // Temporary mock implementation since CartProvider is removed
  const addToCart = (product: Product) => {
    console.log('Added to cart:', product.name);
  };
  const handleBuyNow = async () => {
    if (!product.catalog_product_id) {
      Alert.alert('Link unavailable', 'No shopping destination is available for this item yet.');
      return;
    }
    try {
      await openProductShopping({
        catalogProductId: product.catalog_product_id,
        videoId,
      });
    } catch {
      Alert.alert('Error', 'Could not open the product link');
    }
  };

  const handleAddToBag = () => {
    addToCart(product);
    // Show confirmation with option to go to bag
    Alert.alert(
      'Added to Bag',
      `${product.name} has been added to your bag`,
      [
        { text: 'Continue Shopping', style: 'cancel' },
        { text: 'View Bag', onPress: () => router.push('/cart') }
      ]
    );
  };

  return (
    <View style={styles.productCard}>
      <Image
        source={{ uri: product.image }}
        style={styles.productImage}
        contentFit="cover"
      />
      <View style={styles.productInfo}>
        <Text style={styles.provider}>{product.provider ?? 'Partner'}</Text>
        <Text style={styles.productTitle}>{product.name}</Text>
        <Text style={styles.price}>{product.price}</Text>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.buyNowButton]}
            onPress={handleBuyNow}
          >
            <Text style={[styles.buttonText, styles.buyNowText]}>Buy Now</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, styles.addToBagButton]}
            onPress={handleAddToBag}
          >
            <Text style={[styles.buttonText, styles.addToBagText]}>Add to Bag</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function HeaderWithBag({ title }: { title: string }) {
  const router = useRouter();
  const { mode } = useThemeMode();
  const iconColor = mode === 'titanium' ? '#1A1A1B' : '#F8FAFC';
  
  const handleBackPress = () => {
    router.back();
  };

  const handleBagPress = () => {
    router.push('/cart');
  };

  return (
    <LinearGradient
      colors={['rgba(0,0,0,1)', 'rgba(0,0,0,1)', 'rgba(0,0,0,0.5)']}
      locations={[0, 0.8, 1]}
      style={styles.header}
    >
      <View style={styles.headerContent}>
        <TouchableOpacity onPress={handleBackPress} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity onPress={handleBagPress} style={styles.bagButton}>
          <Ionicons name="cart-outline" size={18} color={iconColor} />
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

export default function ProductListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [video, setVideo] = useState<Video | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) {
        setVideo(null);
        return;
      }
      const fromDb = await fetchVideoById(id);
      if (cancelled) return;
      if (fromDb) {
        setVideo(fromDb);
        return;
      }
      setVideo(mockVideos.find((v) => v.id === id) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (video === undefined) {
    return (
      <View style={[styles.container, styles.errorContainer]}>
        <HeaderWithBag title="Products" />
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  if (!video) {
    return (
      <View style={styles.container}>
        <HeaderWithBag title="Products" />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Video not found</Text>
        </View>
      </View>
    );
  }

  const urlInfo = getVideoUrlInfo(video.url);

  return (
    <View style={styles.container}>
      <HeaderWithBag title="Products" />
      
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.productsContainer}>
          <Text style={styles.sectionTitle}>All Products</Text>
          
          {video.products?.map((product) => (
            <ProductCard key={product.id} product={product} router={router} videoId={video.id} />
          ))}
        </View>
        
        {/* Video Embed Section */}
        <View style={styles.videoSection}>
          <Text style={styles.sectionTitle}>Video</Text>
          <View style={styles.videoContainer}>
            {urlInfo.platform === 'youtube' ? (
              <YouTubeReelItem 
                video={video} 
                isActive={true} 
                onBuyPress={() => {}} 
              />
            ) : urlInfo.platform === 'instagram' ? (
              <InstagramReelItem 
                video={video} 
                isActive={true} 
                onBuyPress={() => {}} 
              />
            ) : (
              <View style={styles.fallbackContainer}>
                <Text style={styles.fallbackText}>Video not available</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    fontSize: 20,
    color: 'white',
    fontWeight: 'bold',
  },
  bagButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bagIcon: {
    fontSize: 18,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  placeholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  productsContainer: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 20,
  },
  productCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 20,
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: 200,
    backgroundColor: '#f5f5f5',
  },
  productInfo: {
    padding: 20,
  },
  provider: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 4,
  },
  productTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
  },
  price: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 16,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buyNowButton: {
    backgroundColor: '#000000',
  },
  addToBagButton: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#000000',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  buyNowText: {
    color: '#ffffff',
  },
  addToBagText: {
    color: '#000000',
  },
  videoSection: {
    marginTop: 20,
    marginBottom: 40,
  },
  videoContainer: {
    width: '100%',
    aspectRatio: 16/9,
    marginHorizontal: 20,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000000',
    minHeight: 200,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 18,
    color: '#666666',
  },
  fallbackContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  fallbackText: {
    fontSize: 16,
    color: '#666666',
  },
});
