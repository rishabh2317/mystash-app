import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, { Extrapolate, interpolateColor, useAnimatedStyle } from 'react-native-reanimated';

import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useRouter } from 'expo-router';

function ProfileRow({
  icon,
  label,
  value,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  action?: () => void;
}) {
  const { mode } = useThemeMode();
  const isLight = mode === 'titanium';

  return (
    <TouchableOpacity activeOpacity={action ? 0.8 : 1} onPress={action} disabled={!action}>
      <View style={[styles.rowCard, { backgroundColor: isLight ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.08)' }]}>
        <Ionicons name={icon} size={18} color={isLight ? '#1A1A1B' : '#F8FAFC'} />
        <View style={styles.rowTextWrap}>
          <Text style={[styles.rowLabel, { color: isLight ? '#4E5257' : '#AEB8C5' }]}>{label}</Text>
          <Text style={[styles.rowValue, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>{value}</Text>
        </View>
        {action ? (
          <Ionicons name="open-outline" size={16} color={isLight ? '#4E5257' : '#CBD5E1'} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function ThemeToggleCard() {
  const { mode, toggleTheme, lightOpacity } = useThemeMode();
  const isLight = mode === 'titanium';

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
        <Text style={[styles.themeTitle, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>Appearance</Text>
        <Text style={[styles.themeSubtitle, { color: isLight ? '#4E5257' : '#AEB8C5' }]}>
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
  const { mode } = useThemeMode();
  const { user, loading, signInWithEmail, signUpWithEmail, signInWithGoogle, signOut } = useAuth();
  const isLight = mode === 'titanium';
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const profileName = useMemo(() => {
    if (!user) return '';
    return (
      (user.user_metadata?.full_name as string) ||
      (user.user_metadata?.name as string) ||
      user.email?.split('@')[0] ||
      'Mystash User'
    );
  }, [user]);

  const profileHandle = useMemo(() => {
    if (!user) return '';
    return (user.user_metadata?.username as string) || user.email?.split('@')[0] || 'user';
  }, [user]);

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
      const { error } = await signInWithGoogle();
      if (error && error !== 'Google sign in canceled.') {
        Alert.alert('Google sign in failed', error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={isLight ? '#00AFC0' : '#A855F7'} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.screen}>
        <LinearGradient
          colors={isLight ? ['#FDFDFD', '#E8E8E8', '#D1D1D1'] : ['#0D111F', '#020408']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={[styles.name, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>Welcome to Mystash</Text>
          <Text style={[styles.email, { color: isLight ? '#4E5257' : '#AEB8C5' }]}>
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
        colors={isLight ? ['#FDFDFD', '#E8E8E8', '#D1D1D1'] : ['#0D111F', '#020408']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

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
          <Text style={[styles.name, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>{profileName}</Text>
          <Text style={[styles.email, { color: isLight ? '#4E5257' : '#AEB8C5' }]}>{user.email}</Text>
          <Text style={[styles.handle, { color: isLight ? '#00AFC0' : '#A855F7' }]}>@{profileHandle}</Text>
        </View>

        <ThemeToggleCard />

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => router.push('/(tabs)/create')}
          style={[
            styles.curateCard,
            {
              borderColor: isLight ? 'rgba(0,242,255,0.45)' : 'rgba(168,85,247,0.55)',
              backgroundColor: isLight ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.08)',
            },
          ]}
        >
          <Ionicons name="sparkles-outline" size={22} color={isLight ? '#00AFC0' : '#C084FC'} />
          <View style={{ flex: 1, paddingLeft: 10 }}>
            <Text style={[styles.curateTitle, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>Curate collection</Text>
            <Text style={[styles.curateSub, { color: isLight ? '#4E5257' : '#AEB8C5' }]}>
              Paste a reel URL, review AI picks, publish to the feed. Same flow as the Create tab.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={isLight ? '#64748B' : '#94A3B8'} />
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>Account</Text>
          <ProfileRow icon="person-outline" label="Username" value={`@${profileHandle}`} />
          <ProfileRow icon="mail-outline" label="Email" value={user.email ?? 'N/A'} />
          <ProfileRow icon="shield-checkmark-outline" label="Plan" value="Mystash Pro Beta" />
          <ProfileRow icon="card-outline" label="Payment" value="Visa •••• 2189 (placeholder)" />
          <ProfileRow icon="location-outline" label="Shipping Address" value="Add primary address" />
          <ProfileRow icon="notifications-outline" label="Notifications" value="Push + Email enabled" />
          <ProfileRow icon="lock-closed-outline" label="Privacy" value="Manage data & permissions" />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>Social</Text>
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
          <Text style={[styles.sectionTitle, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>Session</Text>
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
  rowCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowTextWrap: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  rowValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '700',
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

