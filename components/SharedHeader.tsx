import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeMode } from '@/contexts/ThemeContext';

interface SharedHeaderProps {
  title?: string;
  showBackButton?: boolean;
  showBagButton?: boolean;
}

export default function SharedHeader({ 
  title = 'MYSTASH', 
  showBackButton = false, 
  showBagButton = true 
}: SharedHeaderProps) {
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
        {showBackButton ? (
          <TouchableOpacity onPress={handleBackPress} style={styles.backButton}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.placeholder} />
        )}
        
        <Text style={styles.headerTitle}>{title}</Text>
        
        {showBagButton ? (
          <TouchableOpacity onPress={handleBagPress} style={styles.bagButton}>
            <Ionicons name="cart-outline" size={18} color={iconColor} />
          </TouchableOpacity>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
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
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
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
  placeholder: {
    width: 40,
  },
});
