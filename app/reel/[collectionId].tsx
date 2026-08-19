import ReelItem from '@/components/ReelItem';
import { ContextActions } from '@/components/chrome/ContextActions';
import { TopBar } from '@/components/chrome/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import {
  mapCollectionDetailToReelViewModel,
  mapReelViewModelToVideo,
} from '@/src/mappers/reelMapper';
import { CollectionApiError } from '@/src/services/collectionApi';
import { useCollectionSaveHandler } from '@/src/services/collectionSaveOrchestration';
import { loadCollectionDetail } from '@/src/services/collectionHydration';
import { useRecordCollectionView } from '@/src/services/collectionViewTracking';
import { isCollectionSaved } from '@/src/services/engagementApi';
import { shareCollection } from '@/src/services/shareLinks';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

/**
 * Focused Reel host — loads Collection on demand, maps to ReelViewModel,
 * and reuses the existing Reel stack (no Home/Creator/Search Reel forks).
 * Save/Share use the same Engagement orchestration as Collection page.
 */
export default function FocusedReelHost() {
  const router = useRouter();
  const { user } = useAuth();
  const { mode } = useThemeMode();
  const isLight = mode === 'titanium';
  const params = useLocalSearchParams<{ collectionId?: string | string[] }>();
  const collectionId = Array.isArray(params.collectionId)
    ? params.collectionId[0]
    : params.collectionId;

  const [detail, setDetail] = useState<CollectionDetailViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);

  const load = useCallback(async () => {
    if (!collectionId?.trim()) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const next = await loadCollectionDetail(collectionId.trim());
      setDetail(next);
      if (user) {
        try {
          setIsSaved(await isCollectionSaved(next.collectionId));
        } catch {
          setIsSaved(false);
        }
      } else {
        setIsSaved(false);
      }
    } catch (e) {
      setDetail(null);
      if (e instanceof CollectionApiError && e.statusCode === 404) {
        setNotFound(true);
      } else {
        setError(e instanceof Error ? e.message : 'Could not load collection');
      }
    } finally {
      setLoading(false);
    }
  }, [collectionId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useRecordCollectionView({
    collectionId: detail?.collectionId,
    creatorId: detail?.creator.id,
    surface: 'focused_reel',
    enabled: Boolean(detail),
  });

  const reelVideo = useMemo(() => {
    if (!detail) return null;
    return mapReelViewModelToVideo(mapCollectionDetailToReelViewModel(detail));
  }, [detail]);

  const saveHandler = useCollectionSaveHandler({
    collectionId: detail?.collectionId ?? '',
    creatorId: detail?.creator.id ?? null,
    isSaved,
    onOptimisticSave: (next) => {
      setSavePending(true);
      setIsSaved(next);
    },
    onRollback: (previous) => {
      setIsSaved(previous);
      setSavePending(false);
    },
  });

  const onSavePress = useCallback(async () => {
    if (!detail) return;
    setSavePending(true);
    try {
      await saveHandler();
    } finally {
      setSavePending(false);
    }
  }, [detail, saveHandler]);

  const onSharePress = useCallback(async () => {
    if (!detail) return;
    try {
      await shareCollection({
        collectionId: detail.collectionId,
        title: detail.title,
        creatorId: detail.creator.id,
        surface: 'focused_reel',
      });
    } catch (e) {
      Alert.alert('Share', e instanceof Error ? e.message : 'Could not share collection.');
    }
  }, [detail]);

  const text = isLight ? '#1A1A1B' : '#F8FAFC';
  const muted = isLight ? '#4E5257' : '#AEB8C5';

  if (loading) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#05070A', '#0A0E14', '#05070A']} style={StyleSheet.absoluteFill} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#F8FAFC" />
        </View>
        <TopBar
          mode="immersive"
          showBack
          backAccessibilityLabel="Close reel"
          onBack={() => router.back()}
        />
      </View>
    );
  }

  if (notFound) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#05070A', '#0A0E14', '#05070A']} style={StyleSheet.absoluteFill} />
        <View style={styles.centered}>
          <Text style={[styles.message, { color: text }]}>Collection unavailable</Text>
          <Pressable onPress={() => router.back()} style={styles.action}>
            <Text style={{ color: muted, fontWeight: '700' }}>Go back</Text>
          </Pressable>
        </View>
        <TopBar
          mode="immersive"
          showBack
          backAccessibilityLabel="Close reel"
          onBack={() => router.back()}
        />
      </View>
    );
  }

  if (error || !detail || !reelVideo) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#05070A', '#0A0E14', '#05070A']} style={StyleSheet.absoluteFill} />
        <View style={styles.centered}>
          <Text style={[styles.message, { color: muted }]}>{error ?? 'Something went wrong'}</Text>
          <Pressable onPress={() => void load()} style={styles.action}>
            <Text style={{ color: text, fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
        <TopBar
          mode="immersive"
          showBack
          backAccessibilityLabel="Close reel"
          onBack={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ReelItem video={reelVideo} isActive onBuyPress={() => {}} />
      <TopBar
        mode="immersive"
        showBack
        backAccessibilityLabel="Close reel"
        onBack={() => router.back()}
        trailing={
          <ContextActions
            save={{ isSaved, pending: savePending, onPress: () => void onSavePress() }}
            share={{ onPress: () => void onSharePress(), accessibilityLabel: 'Share collection' }}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#05070A',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
  },
  action: {
    padding: 12,
  },
});
