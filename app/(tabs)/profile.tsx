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

import { TopBar } from '@/components/chrome/TopBar';
import { StatusBlock } from '@/components/status/StatusBlock';
import { CollectionTileSkeleton } from '@/components/collection/CollectionTileSkeleton';
import { EditProfileSheet } from '@/components/profile/EditProfileSheet';
import { PersonalProfile } from '@/components/profile/PersonalProfile';
import { ProfileAuthForm, type ProfileAuthStep } from '@/components/profile/ProfileAuthForm';
import { ProfileHeaderSkeleton } from '@/components/profile/ProfileHeaderSkeleton';
import { SkeletonGrid } from '@/components/status/SkeletonStack';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import {
  parseAddToCartIntent,
  parseAuthIntent,
  parseFollowCreatorIntent,
  parseSaveCollectionIntent,
} from '@/src/navigation/authIntent';
import { useUnreadNotifications } from '@/src/hooks/useUnreadNotifications';
import { NOTIFICATIONS_HREF } from '@/src/notifications/linking';
import { requestAddToCart } from '@/src/services/cartBoundary';
import { NOTIFICATIONS_COPY } from '@/src/ui/notificationsInbox';
import { listCreatorCollections } from '@/src/services/collectionApi';
import { followCreator, saveCollection } from '@/src/services/engagementApi';
import { loadSavedCollections } from '@/src/services/personalProfileContent';
import { shareCreatorProfile } from '@/src/services/shareLinks';
import { collectionTilePressPath } from '@/src/ui/collectionLayout';
import {
  PROFILE_VIDEO_GRID_ASPECT,
  PROFILE_VIDEO_GRID_COLUMNS,
  PROFILE_VIDEO_GRID_GAP,
} from '@/src/ui/personalProfile';
import { reconcilePublicCollectionCount } from '@/src/ui/publicCreatorProfile';
import { pageCanvasGradient } from '@/src/theme/tokens';
import { AUTH_COPY } from '@/src/auth/authErrors';
import { MIN_PASSWORD_LENGTH, passwordMeetsPolicy } from '@/src/auth/passwordPolicy';
import { ensureMe, updateMyProfile } from '@/src/services/userApi';
import { maybePromptForPush } from '@/src/notifications/permissionPrompt';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CreatorViewModel } from '@/src/types/creator';

export default function ProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    intent?: string | string[];
    catalogProductId?: string | string[];
    creatorId?: string | string[];
    username?: string | string[];
    collectionId?: string | string[];
  }>();
  const { tokens } = useThemeMode();
  const {
    user,
    loading,
    emailVerified,
    pendingConfirmationEmail,
    passwordRecoveryPending,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    resendConfirmationEmail,
    dismissPendingConfirmation,
    signOut,
  } = useAuth();
  const notifications = useUnreadNotifications();
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signup');
  const [authStep, setAuthStep] = useState<ProfileAuthStep>('welcome');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const consumedAuthIntentRef = useRef<string | null>(null);

  const [creator, setCreator] = useState<CreatorViewModel | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [collections, setCollections] = useState<CollectionViewModel[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);

  const [saved, setSaved] = useState<CollectionViewModel[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);

  const [editVisible, setEditVisible] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const loadGen = useRef(0);

  // OD-12: resume ADD_TO_CART / FOLLOW_CREATOR / SAVE_COLLECTION after successful auth.
  useEffect(() => {
    if (!loading && user && passwordRecoveryPending) {
      router.replace('/auth/reset-password' as Href);
    }
  }, [loading, user, passwordRecoveryPending, router]);

  useEffect(() => {
    if (!user || loading) return;

    const cartIntent = parseAddToCartIntent(params);
    if (cartIntent) {
      const consumeKey = `${cartIntent.intent}:${cartIntent.catalogProductId}`;
      if (consumedAuthIntentRef.current === consumeKey) return;
      consumedAuthIntentRef.current = consumeKey;
      void requestAddToCart(cartIntent.catalogProductId).catch((e) => {
        if (__DEV__) {
          console.warn('[profile] add-to-cart intent failed', e);
        }
      });
      router.replace('/(tabs)/profile');
      return;
    }

    const followIntent = parseFollowCreatorIntent(params);
    if (followIntent) {
      const consumeKey = `${followIntent.intent}:${followIntent.creatorId}`;
      if (consumedAuthIntentRef.current === consumeKey) return;
      consumedAuthIntentRef.current = consumeKey;
      void followCreator(followIntent.creatorId)
        .then(() => void maybePromptForPush('first_follow'))
        .catch((e) => {
          if (__DEV__) {
            console.warn('[profile] follow intent failed', e);
          }
        })
        .finally(() => {
          if (followIntent.username) {
            router.replace(`/creator/${encodeURIComponent(followIntent.username)}` as Href);
          } else {
            router.replace('/(tabs)/profile');
          }
        });
      return;
    }

    const saveIntent = parseSaveCollectionIntent(params);
    if (saveIntent) {
      const consumeKey = `${saveIntent.intent}:${saveIntent.collectionId}`;
      if (consumedAuthIntentRef.current === consumeKey) return;
      consumedAuthIntentRef.current = consumeKey;
      void saveCollection(saveIntent.collectionId)
        .catch((e) => {
          if (__DEV__) {
            console.warn('[profile] save intent failed', e);
          }
        })
        .finally(() => {
          router.replace(`/collection/${saveIntent.collectionId}` as Href);
        });
    }
  }, [
    user,
    loading,
    params.intent,
    params.catalogProductId,
    params.creatorId,
    params.username,
    params.collectionId,
    router,
  ]);

  const loadProfile = useCallback(async () => {
    const gen = ++loadGen.current;
    setProfileLoading(true);
    setProfileError(null);
    try {
      const me = await ensureMe();
      if (gen !== loadGen.current) return;
      setCreator(me);
      setProfileLoading(false);
    } catch (e) {
      if (gen !== loadGen.current) return;
      setProfileLoading(false);
      setProfileError(e instanceof Error ? e.message : 'Could not load profile');
      setCreator(null);
    }
  }, []);

  const loadCollections = useCallback(async (creatorId: string) => {
    setCollectionsLoading(true);
    try {
      const page = await listCreatorCollections(creatorId, { limit: 20 });
      setCollections(page.collections);
      setCreator((current) =>
        current
          ? {
              ...current,
              collectionCount: reconcilePublicCollectionCount(
                current.collectionCount,
                page.collections.length,
              ),
            }
          : current,
      );
    } catch {
      setCollections([]);
    } finally {
      setCollectionsLoading(false);
    }
  }, []);

  const loadSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      const page = await loadSavedCollections();
      setSaved(page.items);
    } catch {
      setSaved([]);
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || loading || !emailVerified || passwordRecoveryPending) {
      setCreator(null);
      setCollections([]);
      setSaved([]);
      return;
    }
    void loadProfile();
  }, [user, loading, emailVerified, passwordRecoveryPending, loadProfile]);

  useEffect(() => {
    if (!creator?.userId) return;
    void loadCollections(creator.userId);
    void loadSaved();
  }, [creator?.userId, loadCollections, loadSaved]);

  const onPressCollection = useCallback(
    (collection: CollectionViewModel) => {
      router.push(collectionTilePressPath(collection.collectionId) as Href);
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
        surface: 'personal_profile',
      });
    } catch (e) {
      Alert.alert('Share', e instanceof Error ? e.message : 'Could not share profile.');
    }
  }, [creator]);

  const onSaveProfile = useCallback(
    async (patch: { displayName: string; bio: string }) => {
      setEditPending(true);
      try {
        const next = await updateMyProfile({
          displayName: patch.displayName || null,
          bio: patch.bio || null,
        });
        setCreator(next);
        setEditVisible(false);
      } catch (e) {
        Alert.alert('Couldn’t save profile', e instanceof Error ? e.message : 'Try again.');
      } finally {
        setEditPending(false);
      }
    },
    [],
  );

  const onSubmitAuth = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Email and password are required.');
      return;
    }

    if (authMode === 'signup') {
      if (!name.trim() || !username.trim()) {
        Alert.alert('Missing fields', 'Full name and username are mandatory for sign up.');
        return;
      }
      if (!passwordMeetsPolicy(password)) {
        Alert.alert('Weak password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert('Password mismatch', 'Password and confirm password must match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (authMode === 'signin') {
        const { error } = await signInWithEmail(email.trim(), password);
        if (error) Alert.alert('Sign in failed', error);
      } else {
        const { error, needsEmailConfirmation } = await signUpWithEmail({
          fullName: name.trim(),
          username: username.trim(),
          email: email.trim(),
          password,
        });
        if (error) {
          Alert.alert('Sign up failed', error);
        } else if (needsEmailConfirmation) {
          Alert.alert(AUTH_COPY.pendingTitle, AUTH_COPY.pendingBody);
        } else {
          Alert.alert('Welcome', 'Your account is ready. You are signed in.');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onResendConfirmation = async () => {
    setSubmitting(true);
    try {
      const { error } = await resendConfirmationEmail(email.trim() || undefined);
      if (error) Alert.alert('Could not resend', error);
      else Alert.alert(AUTH_COPY.pendingTitle, AUTH_COPY.confirmationSent);
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleSignIn = async () => {
    setSubmitting(true);
    try {
      const authIntent = parseAuthIntent(params);
      const { error } = await signInWithGoogle({ authIntent });
      if (error && error !== 'Google sign in canceled.') {
        Alert.alert('Google sign in failed', error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const bg = [...pageCanvasGradient(tokens), tokens.color.canvas] as const;
  const text = tokens.color.text;
  const muted = tokens.color.textMuted;

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <TopBar mode="page" title="Profile" showBag={false} />
        <View style={[styles.screen, styles.centered]}>
          <ActivityIndicator size="large" color={tokens.color.accent} />
        </View>
      </View>
    );
  }

  if ((pendingConfirmationEmail && !user) || (user && !emailVerified)) {
    return (
      <View style={styles.screen}>
        <TopBar mode="page" title="Profile" showBag={false} />
        <View style={[styles.centered, { paddingHorizontal: 24 }]}>
          <StatusBlock
            kind="empty"
            title={AUTH_COPY.pendingTitle}
            message={AUTH_COPY.pendingBody}
            actionLabel={submitting ? 'Sending…' : AUTH_COPY.resend}
            onAction={() => void onResendConfirmation()}
          />
          <Pressable
            onPress={() => {
              void dismissPendingConfirmation();
              if (user) void signOut();
            }}
            style={{ marginTop: 16 }}
          >
            <Text style={{ color: muted, fontWeight: '600' }}>Use a different email</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.screen, { backgroundColor: tokens.color.canvasSoft }]}>
        <TopBar
          mode="page"
          title="Profile"
          showBag={false}
          showBack={authStep === 'form'}
          onBack={() => setAuthStep('welcome')}
        />
        <ProfileAuthForm
          step={authStep}
          onOpenMode={(mode) => {
            setAuthMode(mode);
            setAuthStep('form');
          }}
          authMode={authMode}
          onChangeMode={setAuthMode}
          name={name}
          onChangeName={setName}
          onChangeUsername={setUsername}
          email={email}
          onChangeEmail={setEmail}
          password={password}
          onChangePassword={setPassword}
          confirmPassword={confirmPassword}
          onChangeConfirmPassword={setConfirmPassword}
          submitting={submitting}
          onSubmit={() => void onSubmitAuth()}
          onGoogle={() => void onGoogleSignIn()}
          onForgotPassword={() => router.push('/auth/forgot-password' as Href)}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LinearGradient colors={[...bg]} style={StyleSheet.absoluteFill} />
      <TopBar
        mode="page"
        title={creator ? `@${creator.username}` : 'Profile'}
        showBag={false}
        trailing={
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Pressable
              onPress={() => router.push(notifications.enabled ? NOTIFICATIONS_HREF : '/settings')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={NOTIFICATIONS_COPY.bellLabel(notifications.unread)}
              style={styles.menuBtn}
            >
              <Ionicons name="notifications-outline" size={22} color={text} />
              {notifications.unread.unread > 0 ? (
                <View
                  style={[styles.unreadDot, { backgroundColor: tokens.color.primary }]}
                  accessibilityElementsHidden
                />
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Open Settings and Analytics"
              style={styles.menuBtn}
            >
              <Ionicons name="settings-outline" size={22} color={text} />
            </Pressable>
          </View>
        }
      />

      {profileLoading && !creator ? (
        <View style={{ paddingTop: tokens.space.md, gap: tokens.space.md }}>
          <View style={{ paddingHorizontal: tokens.space.md }}>
            <ProfileHeaderSkeleton />
          </View>
          <SkeletonGrid columns={PROFILE_VIDEO_GRID_COLUMNS} gap={PROFILE_VIDEO_GRID_GAP}>
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
          </SkeletonGrid>
        </View>
      ) : profileError && !creator ? (
        <View style={styles.centered}>
          <Text style={[styles.stateTitle, { color: text }]}>Couldn’t load profile</Text>
          <Text style={[styles.stateBody, { color: muted }]}>{profileError}</Text>
          <Pressable onPress={() => void loadProfile()} style={styles.retry}>
            <Text style={{ color: text, fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      ) : creator ? (
        <PersonalProfile
          creator={creator}
          collections={collections}
          saved={saved}
          collectionsLoading={collectionsLoading}
          savedLoading={savedLoading}
          onEditPress={() => setEditVisible(true)}
          onSharePress={() => void onSharePress()}
          onPressCollection={onPressCollection}
          onPressStat={(id) => router.push(`/profile/${id}` as Href)}
          onCreateCollection={() => router.push('/(tabs)/create' as Href)}
        />
      ) : null}

      {creator ? (
        <EditProfileSheet
          visible={editVisible}
          creator={creator}
          pending={editPending}
          onClose={() => setEditVisible(false)}
          onSave={(patch) => void onSaveProfile(patch)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 8,
  },
  stateTitle: { fontSize: 18, fontWeight: '800' },
  stateBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: { marginTop: 12, padding: 12 },
  menuBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
