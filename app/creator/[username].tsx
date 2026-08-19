import { Ionicons } from '@expo/vector-icons';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreatorProfile } from '@/components/creator/CreatorProfile';
import { ShareControl } from '@/components/engagement/ShareControl';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { listCreatorCollections } from '@/src/services/collectionApi';
import { useCreatorFollowHandler } from '@/src/services/creatorFollowOrchestration';
import { isFollowingCreator } from '@/src/services/engagementApi';
import { shareCreatorProfile } from '@/src/services/shareLinks';
import { fetchPublicCreatorByUsername, UserApiError } from '@/src/services/userApi';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CreatorViewModel } from '@/src/types/creator';

export default function CreatorProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { mode } = useThemeMode();
  const isLight = mode === 'titanium';
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

  const text = isLight ? '#1A1A1B' : '#F8FAFC';
  const muted = isLight ? '#4E5257' : '#AEB8C5';
  const bg = isLight
    ? (['#F3F4F6', '#E5E7EB', '#F9FAFB'] as const)
    : (['#020617', '#0F172A', '#020617'] as const);

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...bg]} style={StyleSheet.absoluteFill} />
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: text }]} numberOfLines={1}>
          {creator ? `@${creator.username}` : 'Creator'}
        </Text>
        {creator ? (
          <ShareControl
            isLight={isLight}
            onPress={() => void onSharePress()}
            accessibilityLabel="Share creator profile"
          />
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
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
