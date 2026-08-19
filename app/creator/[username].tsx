import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ContextActions } from '@/components/chrome/ContextActions';
import { TopBar } from '@/components/chrome/TopBar';
import { CreatorProfile } from '@/components/creator/CreatorProfile';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { pageCanvasGradient } from '@/src/theme/tokens';
import { listCreatorCollections } from '@/src/services/collectionApi';
import { useCreatorFollowHandler } from '@/src/services/creatorFollowOrchestration';
import { isFollowingCreator } from '@/src/services/engagementApi';
import { shareCreatorProfile } from '@/src/services/shareLinks';
import { fetchPublicCreatorByUsername, UserApiError } from '@/src/services/userApi';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CreatorViewModel } from '@/src/types/creator';

export default function CreatorProfileScreen() {
  const router = useRouter();
  const { tokens, isLight } = useThemeMode();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ username?: string | string[] }>();
  const usernameParam = Array.isArray(params.username) ? params.username[0] : params.username;

  const [creator, setCreator] = useState<CreatorViewModel | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [collections, setCollections] = useState<CollectionViewModel[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsLoadingMore, setCollectionsLoadingMore] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [followPending, setFollowPending] = useState(false);

  const loadGen = useRef(0);

  const loadProfile = useCallback(async (username: string) => {
    const gen = ++loadGen.current;
    setProfileLoading(true);
    setProfileError(null);
    setNotFound(false);
    try {
      const profile = await fetchPublicCreatorByUsername(username);
      if (gen !== loadGen.current) return;
      setCreator(profile);
      setProfileLoading(false);

      // Follow status when authenticated
      if (user && user.id !== profile.userId) {
        try {
          const following = await isFollowingCreator(profile.userId);
          if (gen !== loadGen.current) return;
          setCreator((prev) => (prev ? { ...prev, isFollowing: following } : prev));
        } catch {
          /* ignore follow status errors */
        }
      }
    } catch (e) {
      if (gen !== loadGen.current) return;
      if (e instanceof UserApiError && e.statusCode === 301 && e.redirectToUsername) {
        router.replace(`/creator/${encodeURIComponent(e.redirectToUsername)}`);
        return;
      }
      setProfileLoading(false);
      if (e instanceof UserApiError && e.statusCode === 404) {
        setNotFound(true);
        setProfileError(null);
      } else {
        setProfileError(e instanceof Error ? e.message : 'Could not load creator');
      }
    }
  }, [router, user]);

  const loadCollections = useCallback(
    async (creatorId: string, cursor?: string | null, append = false) => {
      if (append) setCollectionsLoadingMore(true);
      else {
        setCollectionsLoading(true);
        setCollectionsError(null);
      }
      try {
        const page = await listCreatorCollections(creatorId, {
          limit: 20,
          cursor: cursor ?? null,
        });
        setCollections((prev) => (append ? [...prev, ...page.collections] : page.collections));
        setNextCursor(page.nextCursor);
      } catch (e) {
        setCollectionsError(e instanceof Error ? e.message : 'Could not load collections');
      } finally {
        setCollectionsLoading(false);
        setCollectionsLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!usernameParam?.trim()) {
      setNotFound(true);
      setProfileLoading(false);
      return;
    }
    void loadProfile(usernameParam.trim());
  }, [usernameParam, loadProfile]);

  useEffect(() => {
    if (!creator?.userId) return;
    void loadCollections(creator.userId);
  }, [creator?.userId, loadCollections]);

  const isSelf = Boolean(user && creator && user.id === creator.userId);

  const followHandler = useCreatorFollowHandler({
    creatorId: creator?.userId ?? '',
    username: creator?.username ?? usernameParam ?? '',
    isSelf,
    isFollowing: Boolean(creator?.isFollowing),
    onOptimisticFollow: (next) => {
      setFollowPending(true);
      setCreator((prev) =>
        prev
          ? {
              ...prev,
              isFollowing: next,
              followersCount: Math.max(0, prev.followersCount + (next ? 1 : -1)),
            }
          : prev,
      );
    },
    onRollback: (previous) => {
      setCreator((prev) =>
        prev
          ? {
              ...prev,
              isFollowing: previous,
              followersCount: Math.max(
                0,
                prev.followersCount + (previous ? 1 : -1),
              ),
            }
          : prev,
      );
    },
  });

  const onFollowPress = useCallback(async () => {
    await followHandler();
    setFollowPending(false);
  }, [followHandler]);

  const onPressCollection = useCallback(
    (collection: CollectionViewModel) => {
      router.push(`/collection/${collection.collectionId}` as Href);
    },
    [router],
  );

  const onSharePress = useCallback(async () => {
    if (!creator) return;
    try {
      await shareCreatorProfile({
        username: creator.username,
        displayName: creator.displayName,
        creatorId: creator.userId,
        surface: 'creator_profile',
      });
    } catch (e) {
      Alert.alert('Share', e instanceof Error ? e.message : 'Could not share profile.');
    }
  }, [creator]);

  const text = tokens.color.text;
  const muted = tokens.color.textMuted;
  const bg = [...pageCanvasGradient(tokens), tokens.color.canvas] as const;

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...bg]} style={StyleSheet.absoluteFill} />
      <TopBar
        mode="page"
        title={creator ? `@${creator.username}` : 'Creator'}
        showBack
        trailing={
          creator ? (
            <ContextActions
              share={{ onPress: () => void onSharePress(), accessibilityLabel: 'Share creator profile' }}
            />
          ) : undefined
        }
      />

      {profileLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={text} />
        </View>
      ) : notFound ? (
        <View style={styles.centered}>
          <Text style={[styles.stateTitle, { color: text }]}>Creator not found</Text>
          <Text style={[styles.stateBody, { color: muted }]}>
            This profile may be unavailable or the username is incorrect.
          </Text>
          <Pressable onPress={() => router.back()} style={styles.retry}>
            <Text style={{ color: text, fontWeight: '700' }}>Go back</Text>
          </Pressable>
        </View>
      ) : profileError ? (
        <View style={styles.centered}>
          <Text style={[styles.stateTitle, { color: text }]}>Couldn’t load creator</Text>
          <Text style={[styles.stateBody, { color: muted }]}>{profileError}</Text>
          <Pressable
            onPress={() => usernameParam && void loadProfile(usernameParam)}
            style={styles.retry}
          >
            <Text style={{ color: text, fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      ) : creator ? (
        <CreatorProfile
          creator={creator}
          collections={collections}
          isLight={isLight}
          isSelf={isSelf}
          followPending={followPending}
          collectionsLoading={collectionsLoading}
          collectionsLoadingMore={collectionsLoadingMore}
          collectionsError={collectionsError}
          onFollowPress={() => void onFollowPress()}
          onPressCollection={onPressCollection}
          onEndReachedCollections={() => {
            if (!nextCursor || collectionsLoadingMore || !creator) return;
            void loadCollections(creator.userId, nextCursor, true);
          }}
          onRetryCollections={() => void loadCollections(creator.userId)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 8,
  },
  stateTitle: { fontSize: 18, fontWeight: '800' },
  stateBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: { marginTop: 12, padding: 12 },
});
