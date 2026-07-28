import { Image } from 'expo-image';
import { StyleSheet, TextInput, ScrollView } from 'react-native';
import { useState } from 'react';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { mockVideos, Video } from '@/src/mocks/videos';

export default function SearchScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredVideos, setFilteredVideos] = useState<Video[]>(mockVideos);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim() === '') {
      setFilteredVideos(mockVideos);
    } else {
      const filtered = mockVideos.filter(
        (video) =>
          video.product_name.toLowerCase().includes(query.toLowerCase()) ||
          video.creator_name.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredVideos(filtered);
    }
  };

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={
        <IconSymbol
          size={310}
          color="#808080"
          name="magnifyingglass"
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Search</ThemedText>
      </ThemedView>
      
      <ThemedView style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search products or creators..."
          value={searchQuery}
          onChangeText={handleSearch}
        />
      </ThemedView>

      <ThemedView style={styles.resultsContainer}>
        <ThemedText type="subtitle">
          {searchQuery ? `Results (${filteredVideos.length})` : 'All Videos'}
        </ThemedText>
        <ScrollView showsVerticalScrollIndicator={false}>
          {filteredVideos.map((video) => (
            <ThemedView key={video.id} style={styles.videoItem}>
              <Image
                source={{ uri: video.thumbnail }}
                style={styles.thumbnail}
                contentFit="cover"
              />
              <ThemedView style={styles.videoInfo}>
                <ThemedText style={styles.productName}>{video.product_name}</ThemedText>
                <ThemedText style={styles.creatorName}>by {video.creator_name}</ThemedText>
                <ThemedText style={styles.stashScore}>⭐ {video.stash_score}</ThemedText>
              </ThemedView>
            </ThemedView>
          ))}
        </ScrollView>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  searchContainer: {
    margin: 16,
  },
  searchInput: {
    height: 40,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f5f5f5',
  },
  resultsContainer: {
    margin: 16,
  },
  videoItem: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbnail: {
    width: 100,
    height: 75,
  },
  videoInfo: {
    flex: 1,
    padding: 8,
  },
  productName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  creatorName: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  stashScore: {
    fontSize: 12,
    color: '#888',
  },
});
