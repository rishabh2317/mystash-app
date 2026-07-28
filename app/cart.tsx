import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Dimensions, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeMode } from '@/contexts/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function CartItem({ item, onRemove, onUpdateQuantity }: { 
  item: any; 
  onRemove: (id: string) => void; 
  onUpdateQuantity: (id: string, quantity: number) => void;
}) {
  const handleBuyNow = async () => {
    try {
      await Linking.openURL('https://example.com/buy');
    } catch (error) {
      Alert.alert('Error', 'Could not open the product link');
    }
  };

  const handleRemove = () => {
    Alert.alert(
      'Remove Item',
      `Are you sure you want to remove ${item.name} from your bag?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => onRemove(item.id) }
      ]
    );
  };

  const increaseQuantity = () => {
    onUpdateQuantity(item.id, item.quantity + 1);
  };

  const decreaseQuantity = () => {
    if (item.quantity > 1) {
      onUpdateQuantity(item.id, item.quantity - 1);
    }
  };

  return (
    <View style={styles.cartItem}>
      <Image
        source={{ uri: item.image }}
        style={styles.itemImage}
        contentFit="cover"
      />
      
      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemPrice}>{item.price}</Text>
        
        <View style={styles.quantityControls}>
          <TouchableOpacity
            style={styles.quantityButton}
            onPress={decreaseQuantity}
            disabled={item.quantity <= 1}
          >
            <Text style={[styles.quantityButtonText, item.quantity <= 1 && styles.disabledText]}>
              -
            </Text>
          </TouchableOpacity>
          
          <Text style={styles.quantityText}>{item.quantity}</Text>
          
          <TouchableOpacity
            style={styles.quantityButton}
            onPress={increaseQuantity}
          >
            <Text style={styles.quantityButtonText}>+</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.itemActions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.buyButton]}
            onPress={handleBuyNow}
          >
            <Text style={styles.buyButtonText}>Buy</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, styles.removeButton]}
            onPress={handleRemove}
          >
            <Text style={styles.removeButtonText}>Remove</Text>
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

export default function CartScreen() {
  // Temporary mock implementation since CartProvider is removed
  const items: any[] = [];
  const removeFromCart = (id: string) => console.log('Remove item:', id);
  const updateQuantity = (id: string, quantity: number) => console.log('Update quantity:', id, quantity);
  const getTotalItems = () => 0;
  const getTotalPrice = () => '$0.00';
  
  const router = useRouter();

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <HeaderWithBag title="My Bag" />
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Your bag is empty</Text>
          <TouchableOpacity
            style={styles.continueShoppingButton}
            onPress={() => router.back()}
          >
            <Text style={styles.continueShoppingText}>Continue Shopping</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <HeaderWithBag title="My Bag" />
      
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.itemsContainer}>
          {items.map((item) => (
            <CartItem
              key={item.id}
              item={item}
              onRemove={removeFromCart}
              onUpdateQuantity={updateQuantity}
            />
          ))}
        </View>
      </ScrollView>
      
      <View style={styles.footer}>
        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            Total ({getTotalItems()} items): {getTotalPrice()}
          </Text>
        </View>
        
        <TouchableOpacity style={styles.checkoutButton}>
          <Text style={styles.checkoutButtonText}>Proceed to Checkout</Text>
        </TouchableOpacity>
      </View>
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
  itemsContainer: {
    padding: 20,
  },
  cartItem: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginBottom: 16,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  itemImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  itemInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'space-between',
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 4,
  },
  itemPrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 12,
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  quantityButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  disabledText: {
    color: '#cccccc',
  },
  quantityText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginHorizontal: 16,
  },
  itemActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  buyButton: {
    backgroundColor: '#000000',
  },
  removeButton: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#000000',
  },
  buyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  removeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  footer: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    padding: 20,
    paddingBottom: 40,
  },
  summary: {
    marginBottom: 16,
  },
  summaryText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    textAlign: 'center',
  },
  checkoutButton: {
    backgroundColor: '#000000',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  checkoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    color: '#666666',
    marginBottom: 24,
    textAlign: 'center',
  },
  continueShoppingButton: {
    backgroundColor: '#000000',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  continueShoppingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});
