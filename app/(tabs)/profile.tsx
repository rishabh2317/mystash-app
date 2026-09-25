import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { EditProfileSheet } from '@/components/profile/EditProfileSheet';
import { PersonalProfile } from '@/components/profile/PersonalProfile';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import {
  parseAddToCartIntent,
  parseAuthIntent,
  parseFollowCreatorIntent,
  parseSaveCollectionIntent,
} from '@/src/navigation/authIntent';
import { requestAddToCart } from '@/src/services/cartBoundary';
import { listCreatorCollections } from '@/src/services/collectionApi';
import { followCreator, saveCollection } from '@/src/services/engagementApi';
import { loadSavedCollections } from '@/src/services/personalProfileContent';
import { shareCreatorProfile } from '@/src/services/shareLinks';
import { collectionTilePressPath } from '@/src/ui/collectionLayout';
import { reconcilePublicCollectionCount } from '@/src/ui/publicCreatorProfile';
import { pageCanvasGradient } from '@/src/theme/tokens';
import { ensureMe, updateMyProfile } from '@/src/services/userApi';
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
  const { tokens, isLight } = useThemeMode();
  const { user, loading, signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signup');
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
    if (!user || loading) {
      setCreator(null);
      setCollections([]);
      setSaved([]);
      return;
    }
    void loadProfile();
  }, [user, loading, loadProfile]);

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
      if (password.length < 8) {
        Alert.alert('Weak password', 'Password must be at least 8 characters.');
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
          Alert.alert(
            'Confirm your email',
            'Supabase sent a real message (often from noreply@mail.app.supabase.io). Check inbox and spam, tap Confirm, then use Sign in below with the same email and password.\n\nFor local testing only: in Supabase → Authentication → Providers → Email, turn off "Confirm email".',
          );
          setAuthMode('signin');
        } else {
          Alert.alert('Welcome', 'Your account is ready. You are signed in.');
        }
      }
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

  if (!user) {
    return (
      <View style={styles.screen}>
        <LinearGradient
          colors={
            isLight
              ? [tokens.color.canvasSoft, tokens.color.canvasSoftEnd, tokens.color.canvasEnd]
              : [tokens.color.canvasSoft, tokens.color.canvasSoftEnd, tokens.color.canvas]
          }
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <TopBar mode="page" title="Profile" showBag={false} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={[styles.name, { color: tokens.color.text }]}>Welcome to Mystash</Text>
          <Text style={[styles.email, { color: tokens.color.textMuted }]}>
            Sign in to manage profile, wishlist, and creator earnings.
          </Text>

          <View
            style={[
              styles.authCard,
              { backgroundColor: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.08)' },
            ]}
          >
            <View style={styles.authModeSwitch}>
              <TouchableOpacity
                onPress={() => setAuthMode('signup')}
                style={[styles.authPill, authMode === 'signup' && styles.authPillActive]}
              >
                <Text style={styles.authPillText}>Create account</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setAuthMode('signin')}
                style={[styles.authPill, authMode === 'signin' && styles.authPillActive]}
              >
                <Text style={styles.authPillText}>Sign in</Text>
              </TouchableOpacity>
            </View>

            {authMode === 'signup' && (
              <>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Full name *"
                  style={styles.input}
                  autoCapitalize="words"
                />
                <TextInput
                  value={username}
                  onChangeText={setUsername}
                  placeholder="Username *"
                  style={styles.input}
                  autoCapitalize="none"
                />
              </>
            )}

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email *"
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password *"
              secureTextEntry
              style={styles.input}
            />
            {authMode === 'signup' && (
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm password *"
                secureTextEntry
                style={styles.input}
              />
            )}

            <TouchableOpacity style={styles.primaryBtn} onPress={onSubmitAuth} disabled={submitting}>
              <Text style={styles.primaryBtnText}>
                {authMode === 'signup' ? 'Create account' : 'Sign in'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.googleBtn} onPress={onGoogleSignIn} disabled={submitting}>
              <Ionicons name="logo-google" size={16} color="#111827" />
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
              onPress={() => router.push('/settings')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              style={styles.menuBtn}
            >
              <Ionicons name="notifications-outline" size={22} color={text} />
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
        <View style={styles.centered}>
          <ActivityIndicator color={text} />
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
  content: {
    paddingHorizontal: 18,
    paddingTop: 26,
    paddingBottom: 32,
    gap: 16,
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
  name: {
    fontSize: 24,
    fontWeight: '800',
  },
  email: {
    fontSize: 14,
    marginTop: 4,
  },
  authCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    padding: 14,
    gap: 10,
  },
  authModeSwitch: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  authPill: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    paddingVertical: 8,
    alignItems: 'center',
  },
  authPillActive: {
    backgroundColor: 'rgba(0,242,255,0.18)',
    borderColor: 'rgba(0,242,255,0.7)',
  },
  authPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.45)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    color: '#111827',
  },
  primaryBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: '#111827',
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  googleBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  googleBtnText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 14,
  },
});
