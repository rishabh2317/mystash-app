import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { listUserDraftIngests, type UserDraftIngestSummary, submitIngestUrl } from '@/src/services/curation';
import { isSupportedVideoUrl } from '@/src/utils/videoUtils';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
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

export default function CreateSubmitScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { mode } = useThemeMode();
  const isLight = mode === 'titanium';
  const [url, setUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [progressHint, setProgressHint] = useState<string | null>(null);
  /** True while Edge queued extraction and we are polling for `draft` (after immediate `onProcessing`). */
  const [processingExtraction, setProcessingExtraction] = useState(false);
  const [resumeDrafts, setResumeDrafts] = useState<UserDraftIngestSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);

  const valid = isSupportedVideoUrl(url.trim());

  const refreshResumeList = useCallback(() => {
    if (!user) return;
    setDraftsLoading(true);
    listUserDraftIngests()
      .then(setResumeDrafts)
      .finally(() => setDraftsLoading(false));
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      refreshResumeList();
    }, [refreshResumeList]),
  );

  const onSubmit = async () => {
    const trimmed = url.trim();
    if (!isSupportedVideoUrl(trimmed)) {
      Alert.alert('Invalid URL', 'Paste a YouTube Shorts or Instagram Reel / post URL.');
      return;
    }

    setBusy(true);
    setProcessingExtraction(false);
    setProgressHint('Sending request…');
    try {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await submitIngestUrl(trimmed, {
            onProcessing: () => {
              setProcessingExtraction(true);
              setProgressHint('Processing extraction…');
            },
            videoTitle: videoTitle.trim() || undefined,
          });
          if (!res.ingestId) {
            Alert.alert('Ingest failed', 'Could not start curation.');
            return;
          }
          setProgressHint('Opening review…');
          refreshResumeList();
          router.push(`/(tabs)/create/review?ingestId=${encodeURIComponent(res.ingestId)}`);
          return;
        } catch (e) {
          if (attempt === 1) {
            Alert.alert('Ingest failed', (e as Error).message ?? 'Unknown error');
          }
        }
      }
    } finally {
      setProgressHint(null);
      setProcessingExtraction(false);
      setBusy(false);
    }
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
            Sign in to create
          </Text>
          <Text style={[styles.sub, { color: isLight ? '#4E5257' : '#AEB8C5', textAlign: 'center' }]}>
            Add a Short or Reel link after you sign in on the Profile tab.
          </Text>
          <TouchableOpacity style={styles.primary} onPress={() => router.replace('/(tabs)/profile')}>
            <Text style={styles.primaryText}>Go to Profile</Text>
          </TouchableOpacity>
        </View>
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
        <Text style={[styles.title, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>
          Add YT shorts or Insta Reel link and wait for the magic
        </Text>
        <Text style={[styles.sub, { color: isLight ? '#4E5257' : '#AEB8C5' }]}>
          We extract shoppable products from the video. Review picks, then publish to the feed.
        </Text>

        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://youtube.com/shorts/… or instagram.com/reel/…"
          placeholderTextColor={isLight ? '#94A3B8' : '#64748B'}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[
            styles.input,
            {
              color: isLight ? '#111827' : '#F8FAFC',
              borderColor: valid || !url.trim() ? 'rgba(148,163,184,0.45)' : '#EF4444',
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

        <TouchableOpacity
          style={[styles.primary, { opacity: valid && !busy ? 1 : 0.45 }]}
          disabled={!valid || busy}
          onPress={onSubmit}
          accessibilityState={{ busy }}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Extract products</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryOutline, { borderColor: isLight ? 'rgba(148,163,184,0.55)' : 'rgba(148,163,184,0.4)' }]}
          onPress={() => router.push('/(tabs)/create/manual')}
          disabled={busy}
        >
          <Text style={[styles.secondaryOutlineText, { color: isLight ? '#0F766E' : '#93C5FD' }]}>
            Add products manually
          </Text>
        </TouchableOpacity>
        {processingExtraction ? (
          <View
            style={[styles.processingBanner, { borderColor: isLight ? 'rgba(148,163,184,0.5)' : 'rgba(148,163,184,0.35)' }]}
            accessibilityRole="progressbar"
            accessibilityLabel="Processing extraction"
          >
            <ActivityIndicator size="small" color={isLight ? '#00AFC0' : '#A855F7'} />
            <Text style={[styles.processingBannerText, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>
              Processing extraction…
            </Text>
          </View>
        ) : null}
        {progressHint ? (
          <Text style={[styles.progress, { color: isLight ? '#475569' : '#94A3B8' }]} accessibilityLiveRegion="polite">
            {progressHint}
          </Text>
        ) : null}

        <Text style={[styles.sectionTitle, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]}>Your drafts</Text>
        <Text style={[styles.sub, { color: isLight ? '#64748B' : '#94A3B8', marginTop: -4 }]}>
          Server-side drafts survive closing the app. Tap to continue reviewing.
        </Text>
        {draftsLoading ? (
          <ActivityIndicator style={{ marginVertical: 8 }} color={isLight ? '#00AFC0' : '#A855F7'} />
        ) : resumeDrafts.length === 0 ? (
          <Text style={[styles.emptyDrafts, { color: isLight ? '#64748B' : '#64748B' }]}>No drafts yet.</Text>
        ) : (
          resumeDrafts.map((row) => (
            <TouchableOpacity
              key={row.id}
              style={[styles.draftRow, { borderColor: isLight ? 'rgba(148,163,184,0.45)' : 'rgba(148,163,184,0.35)' }]}
              onPress={() =>
                router.push(`/(tabs)/create/review?ingestId=${encodeURIComponent(row.id)}`)
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.draftTitle, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]} numberOfLines={1}>
                  {row.videoTitle || row.sourceUrl}
                </Text>
                <Text style={[styles.draftUrl, { color: isLight ? '#64748B' : '#94A3B8' }]} numberOfLines={1}>
                  {row.sourceUrl}
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor:
                      row.status === 'draft' || row.status === 'ready_for_review'
                        ? isLight
                          ? 'rgba(16,185,129,0.2)'
                          : 'rgba(16,185,129,0.25)'
                        : 'rgba(251,191,36,0.25)',
                  },
                ]}
              >
                <Text style={[styles.badgeText, { color: isLight ? '#047857' : '#34D399' }]}>
                  {row.status === 'draft' || row.status === 'ready_for_review' ? 'Ready' : 'Processing'}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  inner: { flexGrow: 1, padding: 20, paddingTop: 12, gap: 12, paddingBottom: 32 },
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
  primary: {
    marginTop: 8,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  secondaryOutline: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  secondaryOutlineText: { fontWeight: '800', fontSize: 15 },
  progress: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 4 },
  processingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(148,163,184,0.12)',
  },
  processingBannerText: { fontSize: 15, fontWeight: '700' },
  sectionTitle: { fontSize: 17, fontWeight: '800', marginTop: 16 },
  emptyDrafts: { fontSize: 14, marginTop: 4 },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  draftTitle: { fontSize: 15, fontWeight: '700' },
  draftUrl: { fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
});
