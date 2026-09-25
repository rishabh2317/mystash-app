import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { CollectionPageHeader } from '@/components/collection/CollectionPageHeader';
import { CollectionScreen } from '@/components/collection/CollectionScreen';
import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { CollectionApiError } from '@/src/services/collectionApi';
import { useCollectionSaveHandler } from '@/src/services/collectionSaveOrchestration';
import { loadCollectionDetail } from '@/src/services/collectionHydration';
import { useRecordCollectionView } from '@/src/services/collectionViewTracking';
import { useCreatorFollowHandler } from '@/src/services/creatorFollowOrchestration';
import { isCollectionSaved, isFollowingCreator } from '@/src/services/engagementApi';
import { shareCollection } from '@/src/services/shareLinks';
import { softCanvasGradient } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
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
  const [isFollowing, setIsFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);

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

  useEffect(() => {
    if (!user || !detail?.creator.id) {
      setIsFollowing(false);
      return;
    }
    let cancelled = false;
    void isFollowingCreator(detail.creator.id)
      .then((next) => {
        if (!cancelled) setIsFollowing(next);
      })
      .catch(() => {
        if (!cancelled) setIsFollowing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.creator.id, user]);

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

  const isSelf = Boolean(user && detail && user.id === detail.creator.id);

  const followHandler = useCreatorFollowHandler({
    creatorId: detail?.creator.id ?? '',
    username: detail?.creator.username ?? '',
    isSelf,
    isFollowing,
    onOptimisticFollow: (next) => {
      setFollowPending(true);
      setIsFollowing(next);
    },
    onRollback: (previous) => {
      setIsFollowing(previous);
      setFollowPending(false);
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

  const onFollowPress = useCallback(async () => {
    try {
      await followHandler();
    } finally {
      setFollowPending(false);
    }
  }, [followHandler]);

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
  const message = [typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' as const }];
  const shell = (body: React.ReactNode) => (
    <View style={styles.root}>
      <LinearGradient colors={[...softCanvasGradient(tokens)]} style={StyleSheet.absoluteFill} />
      <CollectionPageHeader title="Shop" />
      <View style={[styles.centered, { padding: tokens.space.lg, gap: tokens.space.sm }]}>{body}</View>
    </View>
  );

  if (loading) {
    return shell(<ActivityIndicator size="large" color={text} />);
  }

  if (notFound) {
    return shell(
      <>
        <Text style={message}>Collection not found</Text>
        <ActionButton label="Go back" variant="secondary" onPress={() => router.back()} />
      </>,
    );
  }

  if (error || !detail) {
    return shell(
      <>
        <Text style={message}>{error ?? 'Something went wrong'}</Text>
        <ActionButton label="Retry" variant="secondary" onPress={() => void load()} />
      </>,
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
      isFollowing={isFollowing}
      followPending={followPending}
      isSelf={isSelf}
      onFollowPress={() => void onFollowPress()}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
