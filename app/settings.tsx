import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';

import { TopBar } from '@/components/chrome/TopBar';
import { ProfileRow } from '@/components/profile/ProfileRow';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { ensureMe, type UserSettingsViewModel } from '@/src/services/userApi';
import { BAG_COPY } from '@/src/ui/contracts';

function ThemeToggleCard() {
  const { toggleTheme, lightOpacity, tokens, isLight } = useThemeMode();

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      lightOpacity.value,
      [0, 1],
      ['rgba(15,23,42,0.45)', 'rgba(209,213,219,0.9)'],
    ),
    borderColor: interpolateColor(
      lightOpacity.value,
      [0, 1],
      ['rgba(255,255,255,0.25)', 'rgba(176,181,187,1)'],
    ),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(lightOpacity.value, [0, 1], ['#A855F7', '#00F2FF']),
    borderColor: interpolateColor(
      lightOpacity.value,
      [0, 1],
      ['rgba(168,85,247,0.5)', 'rgba(0,242,255,0.5)'],
    ),
    transform: [{ translateX: isLight ? 0 : 28 }],
  }));

  return (
    <View
      style={[
        styles.themeCard,
        { backgroundColor: isLight ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.08)' },
      ]}
    >
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

/** Former Profile account menu — Settings & Analytics surface. */
export default function SettingsScreen() {
  const router = useRouter();
  const { tokens, isLight } = useThemeMode();
  const { user, loading, signOut } = useAuth();
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

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <TopBar mode="page" title="Settings & Analytics" showBack showBag={false} />
        <View style={[styles.screen, styles.centered]}>
          <ActivityIndicator size="large" color={tokens.color.accent} />
        </View>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.screen}>
        <TopBar mode="page" title="Settings & Analytics" showBack showBag={false} />
        <View style={styles.centered}>
          <Text style={{ color: tokens.color.textMuted }}>Sign in from Profile to manage settings.</Text>
          <Pressable onPress={() => router.replace('/(tabs)/profile')} style={{ marginTop: 16 }}>
            <Text style={{ color: tokens.color.text, fontWeight: '700' }}>Go to Profile</Text>
          </Pressable>
        </View>
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
      <TopBar mode="page" title="Settings & Analytics" showBack showBag={false} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
          <TouchableOpacity
            style={[styles.dangerBtn, { backgroundColor: isLight ? '#111827' : '#EF4444' }]}
            onPress={() => {
              void signOut().catch(() => Alert.alert('Sign out', 'Could not sign out.'));
            }}
          >
            <Text style={styles.dangerBtnText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  themeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  themeTextWrap: { flex: 1, gap: 2 },
  themeTitle: { fontSize: 16, fontWeight: '700' },
  themeSubtitle: { fontSize: 13 },
  toggleTrack: {
    width: 56,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 2,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  curateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  curateTitle: { fontSize: 15, fontWeight: '700' },
  curateSub: { fontSize: 12, marginTop: 2 },
  section: { gap: 2, marginTop: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', marginBottom: 6, marginLeft: 4 },
  dangerBtn: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
