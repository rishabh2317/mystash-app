import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CollectionPageHeader } from '@/components/collection/CollectionPageHeader';
import { CollectionScreen } from '@/components/collection/CollectionScreen';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { pageCanvasGradient } from '@/src/theme/tokens';
import { CollectionApiError } from '@/src/services/collectionApi';
import { useCollectionSaveHandler } from '@/src/services/collectionSaveOrchestration';
import { loadCollectionDetail } from '@/src/services/collectionHydration';
import { useRecordCollectionView } from '@/src/services/collectionViewTracking';
import { isCollectionSaved } from '@/src/services/engagementApi';
import { shareCollection } from '@/src/services/shareLinks';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';

export default function CollectionPageRoute() {
  const router = useRouter();
  const { user } = useAuth();
  const { tokens, isLight } = useThemeMode();
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
    surface: 'collection_page',
    enabled: Boolean(detail),
  });

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
        surface: 'collection_page',
      });
    } catch (e) {
      Alert.alert('Share', e instanceof Error ? e.message : 'Could not share collection.');
    }
  }, [detail]);

  const text = tokens.color.text;
  const muted = tokens.color.textMuted;
  const bg = pageCanvasGradient(tokens);

  if (loading) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={[...bg]} style={StyleSheet.absoluteFill} />
        <CollectionPageHeader title="Collection" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={text} />
        </View>
      </View>
    );
  }

  if (notFound) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={[...bg]} style={StyleSheet.absoluteFill} />
        <CollectionPageHeader title="Collection" />
        <View style={styles.centered}>
          <Text style={[styles.message, { color: text }]}>Collection not found</Text>
          <Pressable onPress={() => router.back()} style={styles.retry}>
            <Text style={{ color: muted, fontWeight: '700' }}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={[...bg]} style={StyleSheet.absoluteFill} />
        <CollectionPageHeader title="Collection" />
        <View style={styles.centered}>
          <Text style={[styles.message, { color: muted }]}>{error ?? 'Something went wrong'}</Text>
          <Pressable onPress={() => void load()} style={styles.retry}>
            <Text style={{ color: text, fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <CollectionScreen
      collection={detail}
      isLight={isLight}
      isSaved={isSaved}
      savePending={savePending}
      onSavePress={() => void onSavePress()}
      onSharePress={() => void onSharePress()}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  retry: {
    padding: 12,
  },
});
