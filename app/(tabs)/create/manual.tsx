import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { CreatorOnboardingPanel } from '@/components/creator/CreatorOnboardingPanel';
import { submitManualProductLinks } from '@/src/services/curation';
import {
  activateCreatorAccount,
  ensureMe,
  type UserSettingsViewModel,
  UserApiError,
} from '@/src/services/userApi';
import { isSupportedVideoUrl } from '@/src/utils/videoUtils';
import { useCreateFlowReset } from '@/src/state/createFlowSession';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const MAX_PRODUCTS = 5;

function normalizeHttpUrl(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

export default function ManualProductsScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { mode } = useThemeMode();
  const isLight = mode === 'titanium';

  const [videoUrl, setVideoUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [rows, setRows] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<
    | null
    | {
        ingestId: string;
        products: Array<{ id: string; name: string; price: string; image?: string; affiliateUrl: string }>;
      }
  >(null);
  const [me, setMe] = useState<UserSettingsViewModel | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  const isActiveCreator = me?.creatorStatus === 'ACTIVE';
  const videoOk = isSupportedVideoUrl(videoUrl.trim());

  const refreshMe = useCallback(() => {
    if (!user) {
      setMe(null);
      return;
    }
    setMeLoading(true);
    setMeError(null);
    ensureMe()
      .then(setMe)
      .catch((e) => {
        setMeError(e instanceof Error ? e.message : 'Could not load account');
      })
      .finally(() => setMeLoading(false));
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      refreshMe();
    }, [refreshMe]),
  );

  useCreateFlowReset(
    useCallback(() => {
      setVideoUrl('');
      setVideoTitle('');
      setRows(['']);
      setBusy(false);
      setPreview(null);
    }, []),
  );

  const onActivateCreator = async (displayName: string | null) => {
    setActivating(true);
    setMeError(null);
    try {
      setMe(await activateCreatorAccount({ displayName }));
      Alert.alert('You are a creator', 'You can now add Collections manually.');
    } catch (e) {
      setMeError(
        e instanceof UserApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not activate creator',
      );
    } finally {
      setActivating(false);
    }
  };

  const uniqueProductUrls = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of rows) {
      const n = normalizeHttpUrl(line);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  }, [rows]);

  const canSubmit =
    videoOk && uniqueProductUrls.length >= 1 && uniqueProductUrls.length <= MAX_PRODUCTS && !busy;

  const addRow = () => {
    setRows((r) => (r.length < MAX_PRODUCTS ? [...r, ''] : r));
  };

  const updateRow = (index: number, text: string) => {
    setRows((prev) => prev.map((x, i) => (i === index ? text : x)));
  };

  const removeRow = (index: number) => {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [''] : next;
    });
  };

  const onFetchDetails = async () => {
    if (!isActiveCreator) {
      Alert.alert('Creator required', 'Become an ACTIVE creator before creating Collections.');
      return;
    }
    if (!canSubmit) return;
    setBusy(true);
    setPreview(null);
    try {
      const res = await submitManualProductLinks(videoUrl, uniqueProductUrls, {
        videoTitle: videoTitle.trim() || undefined,
      });
      if (!res.ingestId || !res.draft) {
        Alert.alert('Something went wrong', 'Could not save manual draft.');
        return;
      }
      setPreview({
        ingestId: res.ingestId,
        products: res.draft.products.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          image: p.image,
          affiliateUrl: p.affiliateUrl,
        })),
      });
      if (res.failedProductUrls && res.failedProductUrls.length > 0) {
        Alert.alert(
          'Some links could not be read',
          `Saved ${res.draft.products.length} product(s). Could not extract: ${res.failedProductUrls.join(', ')}`,
        );
      }
    } catch (e) {
      const msg = (e as Error).message ?? 'Unknown error';
      if (/Creator status ACTIVE required/i.test(msg)) {
        refreshMe();
        Alert.alert(
          'Creator required',
          'Your account is not an ACTIVE creator yet. Finish creator setup, then try again.',
        );
        return;
      }
      Alert.alert('Could not fetch products', msg);
    } finally {
      setBusy(false);
    }
  };

  const goReview = () => {
    if (!preview) return;
    router.push(`/(tabs)/create/review?ingestId=${encodeURIComponent(preview.ingestId)}`);
  };

  if (authLoading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <LinearGradient
          colors={isLight ? ['#FDFDFD', '#E8E8E8'] : ['#0D111F', '#020408']}
          style={StyleSheet.absoluteFill}
        />
        <ActivityIndicator size="large" color={isLight ? '#00AFC0' : '#A855F7'} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.screen}>
        <LinearGradient
          colors={isLight ? ['#FDFDFD', '#E8E8E8'] : ['#0D111F', '#020408']}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.inner, styles.centered]}>
          <Text style={[styles.title, { color: isLight ? '#1A1A1B' : '#F8FAFC', textAlign: 'center' }]}>
            Sign in to continue
          </Text>
          <TouchableOpacity style={styles.primary} onPress={() => router.replace('/(tabs)/profile')}>
            <Text style={styles.primaryText}>Go to Profile</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!isActiveCreator) {
    return (
      <View style={styles.screen}>
        <LinearGradient
          colors={isLight ? ['#FDFDFD', '#E8E8E8', '#D1D1D1'] : ['#0D111F', '#020408']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.inner}>
          <CreatorOnboardingPanel
            isLight={isLight}
            creatorStatus={me?.creatorStatus ?? null}
            username={me?.username ?? null}
            displayName={me?.displayName ?? null}
            loading={meLoading}
            activating={activating}
            error={meError}
            onActivate={(displayName) => void onActivateCreator(displayName)}
            onRetry={refreshMe}
          />
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
      <ScrollView style={styles.scroll} contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>Add products manually</Text>
        <Text style={[styles.sub, { color: isLight ? '#4E5257' : '#AEB8C5' }]}>
          Paste your reel or Short first, then up to five unique shop links. Product pages go through the same
          Product Intelligence path (skipping video extraction). Profile URLs are not supported.
        </Text>

        <Text style={[styles.fieldLabel, { color: isLight ? '#64748B' : '#94A3B8' }]}>Reel / Short URL</Text>
        <TextInput
          value={videoUrl}
          onChangeText={setVideoUrl}
          placeholder="https://youtube.com/shorts/… or instagram.com/reel/…"
          placeholderTextColor={isLight ? '#94A3B8' : '#64748B'}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[
            styles.input,
            {
              color: isLight ? '#111827' : '#F8FAFC',
              borderColor: videoOk || !videoUrl.trim() ? 'rgba(148,163,184,0.45)' : '#EF4444',
              backgroundColor: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.08)',
            },
          ]}
        />

        <Text style={[styles.fieldLabel, { color: isLight ? '#64748B' : '#94A3B8' }]}>Video title (optional)</Text>
        <TextInput
          value={videoTitle}
          onChangeText={setVideoTitle}
          placeholder="Shown in drafts and feed after publish"
          placeholderTextColor={isLight ? '#94A3B8' : '#64748B'}
          autoCapitalize="sentences"
          maxLength={200}
          style={[
            styles.input,
            {
              color: isLight ? '#111827' : '#F8FAFC',
              borderColor: 'rgba(148,163,184,0.45)',
              backgroundColor: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.08)',
            },
          ]}
        />

        <Text style={[styles.fieldLabel, { color: isLight ? '#64748B' : '#94A3B8', marginTop: 8 }]}>
          Product links ({uniqueProductUrls.length}/{MAX_PRODUCTS} unique)
        </Text>
        {rows.map((line, index) => (
          <View key={`row-${index}`} style={styles.rowWrap}>
            <TextInput
              value={line}
              onChangeText={(t) => updateRow(index, t)}
              placeholder={`Product URL ${index + 1}`}
              placeholderTextColor={isLight ? '#94A3B8' : '#64748B'}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[
                styles.input,
                styles.rowInput,
                {
                  color: isLight ? '#111827' : '#F8FAFC',
                  borderColor: 'rgba(148,163,184,0.45)',
                  backgroundColor: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.08)',
                },
              ]}
            />
            {rows.length > 1 ? (
              <TouchableOpacity onPress={() => removeRow(index)} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}

        {rows.length < MAX_PRODUCTS ? (
          <TouchableOpacity style={styles.outlineBtn} onPress={addRow}>
            <Text style={[styles.outlineBtnText, { color: isLight ? '#0E7490' : '#93C5FD' }]}>＋ Add another link</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.primary, { opacity: canSubmit ? 1 : 0.45 }]}
          disabled={!canSubmit}
          onPress={onFetchDetails}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Fetch product details</Text>
          )}
        </TouchableOpacity>

        {preview ? (
          <View style={{ marginTop: 20, gap: 12 }}>
            <Text style={[styles.sectionTitle, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>Preview</Text>
            {preview.products.map((p) => (
              <View
                key={p.id}
                style={[
                  styles.previewCard,
                  {
                    borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)',
                    backgroundColor: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.06)',
                  },
                ]}
              >
                {p.image ? (
                  <Image source={{ uri: p.image }} style={styles.previewThumb} contentFit="cover" />
                ) : (
                  <View style={[styles.previewThumb, styles.thumbPh]} />
                )}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.previewName, { color: isLight ? '#111827' : '#F8FAFC' }]} numberOfLines={2}>
                    {p.name}
                  </Text>
                  <Text style={[styles.previewMeta, { color: isLight ? '#64748B' : '#94A3B8' }]}>
                    {p.price} · Shop link wrapped for tracking
                  </Text>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.secondaryFull} onPress={goReview}>
              <Text style={styles.secondaryFullText}>Continue to review</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  inner: { flexGrow: 1, padding: 20, paddingTop: 12, gap: 10, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 14, lineHeight: 20 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowInput: { flex: 1 },
  removeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(248,113,113,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: '#F87171', fontSize: 16, fontWeight: '700' },
  primary: {
    marginTop: 12,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  outlineBtn: { alignSelf: 'flex-start', paddingVertical: 8 },
  outlineBtnText: { fontWeight: '700', fontSize: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  previewThumb: { width: 64, height: 64, borderRadius: 10 },
  thumbPh: { backgroundColor: '#334155' },
  previewName: { fontSize: 15, fontWeight: '700' },
  previewMeta: { fontSize: 12 },
  secondaryFull: {
    marginTop: 4,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#0EA5E9',
  },
  secondaryFullText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
