import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';

import { TopBar } from '@/components/chrome/TopBar';
import { ProfileRow } from '@/components/profile/ProfileRow';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import {
  parseAddToCartIntent,
  parseAuthIntent,
  parseFollowCreatorIntent,
  parseSaveCollectionIntent,
} from '@/src/navigation/authIntent';
import { requestAddToCart } from '@/src/services/cartBoundary';
import { followCreator, saveCollection } from '@/src/services/engagementApi';
import { ensureMe, type UserSettingsViewModel } from '@/src/services/userApi';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { BAG_COPY } from '@/src/ui/contracts';

function ThemeToggleCard() {
  const { toggleTheme, lightOpacity, tokens, isLight } = useThemeMode();

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(lightOpacity.value, [0, 1], ['rgba(15,23,42,0.45)', 'rgba(209,213,219,0.9)']),
    borderColor: interpolateColor(lightOpacity.value, [0, 1], ['rgba(255,255,255,0.25)', 'rgba(176,181,187,1)']),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(lightOpacity.value, [0, 1], ['#A855F7', '#00F2FF']),
    borderColor: interpolateColor(lightOpacity.value, [0, 1], ['rgba(168,85,247,0.5)', 'rgba(0,242,255,0.5)']),
    transform: [{ translateX: isLight ? 0 : 28 }],
  }));

  return (
    <View style={[styles.themeCard, { backgroundColor: isLight ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.08)' }]}>
      <View style={styles.themeTextWrap}>
        <Text style={[styles.themeTitle, { color: tokens.color.text }]}>Appearance</Text>
        <Text style={[styles.themeSubtitle, { color: tokens.color.textMuted }]}>
          {isLight ? 'Industrial Titanium' : 'Deep Space Nebula'}
        </Text>
      </View>
      <TouchableOpacity activeOpacity={0.85} onPress={toggleTheme}>
        <Animated.View style={[styles.toggleTrack, trackStyle]}>
          <Animated.View style={[styles.toggleThumb, thumbStyle]} />
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

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
  const { user, loading, signInWithEmail, signUpWithEmail, signInWithGoogle, signOut } = useAuth();
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const consumedAuthIntentRef = useRef<string | null>(null);
  const [me, setMe] = useState<UserSettingsViewModel | null>(null);

  useEffect(() => {
    if (!user || loading) {
      setMe(null);
      return;
    }
    let cancelled = false;
    ensureMe()
      .then((next) => {
        if (!cancelled) setMe(next);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

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

  const profileName = useMemo(() => {
    if (!user) return '';
    return (
      me?.displayName ||
      (user.user_metadata?.full_name as string) ||
      (user.user_metadata?.name as string) ||
      user.email?.split('@')[0] ||
      'Mystash User'
    );
  }, [user, me?.displayName]);

  const profileHandle = useMemo(() => {
    if (!user) return '';
    return me?.username || (user.user_metadata?.username as string) || user.email?.split('@')[0] || 'user';
  }, [user, me?.username]);

  const creatorStatusLabel = useMemo(() => {
    switch (me?.creatorStatus) {
      case 'ACTIVE':
        return 'ACTIVE creator';
      case 'ONBOARDING':
        return 'Onboarding in progress';
      case 'SUSPENDED':
        return 'Creator suspended';
      case 'NONE':
        return 'Shopper (not a creator)';
      default:
        return 'Loading…';
    }
  }, [me?.creatorStatus]);

  const curateCopy = useMemo(() => {
    if (me?.creatorStatus === 'ACTIVE') {
      return {
        title: 'Curate collection',
        sub: 'Paste a reel URL, review AI picks, publish to the feed. Same flow as the Create tab.',
      };
    }
    if (me?.creatorStatus === 'ONBOARDING') {
      return {
        title: 'Finish creator setup',
        sub: 'Complete onboarding on the Create tab to activate Collections.',
      };
    }
    if (me?.creatorStatus === 'SUSPENDED') {
      return {
        title: 'Creator suspended',
        sub: 'Collection creation is blocked until creator privileges are reinstated.',
      };
    }
    return {
      title: 'Become a creator',
      sub: 'Activate your creator account on the Create tab to ingest Collections.',
    };
  }, [me?.creatorStatus]);

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
      // Forward validated Profile route intent into OAuth redirectTo so a cold
      // Google callback can resume ADD_TO_CART / FOLLOW_CREATOR / SAVE_COLLECTION.
      const authIntent = parseAuthIntent(params);
      const { error } = await signInWithGoogle({ authIntent });
      if (error && error !== 'Google sign in canceled.') {
        Alert.alert('Google sign in failed', error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <TopBar mode="page" title="Profile" />
        <View style={[styles.screen, styles.centered]}>
          <ActivityIndicator size="large" color={isLight ? '#00AFC0' : '#A855F7'} />
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
        <TopBar mode="page" title="Profile" />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={[styles.name, { color: tokens.color.text }]}>Welcome to Mystash</Text>
          <Text style={[styles.email, { color: tokens.color.textMuted }]}>
            Sign in to manage profile, wishlist, and creator earnings.
          </Text>

          <View style={[styles.authCard, { backgroundColor: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.08)' }]}>
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
              <Text style={styles.primaryBtnText}>{authMode === 'signup' ? 'Create account' : 'Sign in'}</Text>
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
      <TopBar mode="page" title="Profile" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerBlock}>
          <Image
            source={{
              uri:
                (user.user_metadata?.avatar_url as string) ||
                'https://i.pravatar.cc/300?img=33',
            }}
            style={styles.avatar}
            contentFit="cover"
          />
          <Text style={[styles.name, { color: tokens.color.text }]}>{profileName}</Text>
          <Text style={[styles.email, { color: tokens.color.textMuted }]}>{user.email}</Text>
          <Text style={[styles.handle, { color: isLight ? '#00AFC0' : '#A855F7' }]}>@{profileHandle}</Text>
        </View>

        <ThemeToggleCard />

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => router.push('/(tabs)/create')}
          disabled={me?.creatorStatus === 'SUSPENDED'}
          style={[
            styles.curateCard,
            {
              borderColor: isLight ? 'rgba(0,242,255,0.45)' : 'rgba(168,85,247,0.55)',
              backgroundColor: isLight ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.08)',
              opacity: me?.creatorStatus === 'SUSPENDED' ? 0.55 : 1,
            },
          ]}
        >
          <Ionicons name="sparkles-outline" size={22} color={isLight ? '#00AFC0' : '#C084FC'} />
          <View style={{ flex: 1, paddingLeft: 10 }}>
            <Text style={[styles.curateTitle, { color: tokens.color.text }]}>{curateCopy.title}</Text>
            <Text style={[styles.curateSub, { color: tokens.color.textMuted }]}>{curateCopy.sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={isLight ? '#64748B' : '#94A3B8'} />
        </TouchableOpacity>

        {me && me.creatorStatus !== 'NONE' ? (
          <ProfileRow
            icon="stats-chart-outline"
            label="Analytics"
            value="Views, followers, saves, and more"
            action={() => router.push('/analytics')}
          />
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: tokens.color.text }]}>Account</Text>
          <ProfileRow
            icon="cart-outline"
            label="Bag"
            value={BAG_COPY.view}
            action={() => router.push('/cart')}
          />
          <ProfileRow icon="person-outline" label="Username" value={`@${profileHandle}`} />
          <ProfileRow icon="create-outline" label="Creator status" value={creatorStatusLabel} />
          <ProfileRow
            icon="globe-outline"
            label="Public profile"
            value="View as others see you"
            action={() => router.push(`/creator/${encodeURIComponent(profileHandle)}`)}
          />
          <ProfileRow icon="mail-outline" label="Email" value={user.email ?? 'N/A'} />
          <ProfileRow icon="shield-checkmark-outline" label="Plan" value="Mystash Pro Beta" />
          <ProfileRow icon="card-outline" label="Payment" value="Visa •••• 2189 (placeholder)" />
          <ProfileRow icon="location-outline" label="Shipping Address" value="Add primary address" />
          <ProfileRow icon="notifications-outline" label="Notifications" value="Push + Email enabled" />
          <ProfileRow icon="lock-closed-outline" label="Privacy" value="Manage data & permissions" />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: tokens.color.text }]}>Social</Text>
          <ProfileRow
            icon="logo-instagram"
            label="Instagram"
            value="@mystash_app"
            action={() => Linking.openURL('https://instagram.com')}
          />
          <ProfileRow
            icon="logo-youtube"
            label="YouTube"
            value="@MystashOfficial"
            action={() => Linking.openURL('https://youtube.com')}
          />
          <ProfileRow
            icon="globe-outline"
            label="Website"
            value="mystash.ai"
            action={() => Linking.openURL('https://mystash.ai')}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: tokens.color.text }]}>Session</Text>
          <TouchableOpacity style={[styles.dangerBtn, { backgroundColor: isLight ? '#111827' : '#EF4444' }]} onPress={signOut}>
            <Text style={styles.dangerBtnText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBlock: {
    alignItems: 'center',
    marginBottom: 8,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  name: {
    fontSize: 24,
    fontWeight: '800',
  },
  email: {
    fontSize: 14,
    marginTop: 4,
  },
  handle: {
    fontSize: 13,
    marginTop: 4,
    fontWeight: '700',
  },
  themeCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  themeTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  themeSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  toggleTrack: {
    width: 54,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    padding: 2,
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 6,
    marginBottom: 2,
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
  dangerBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dangerBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  curateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 4,
  },
  curateTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  curateSub: {
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
});

