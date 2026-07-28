import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { getCurationDraft, removeCurationDraft } from '@/src/state/curationDraftStore';
import { curationLog } from '@/src/logging/curationLog';
import {
  loadOrResumeIngestDraft,
  normalizeIngestError,
  publishIngestSelection,
  rejectIngestRequest,
} from '@/src/services/curation';
import { requestFeedReload } from '@/src/services/feedRefresh';
import type { DraftProduct, IngestDraftPayload } from '@/src/types/curation';
import { buildInstagramEmbedHtml } from '@/src/utils/instagramWebViewEmbed';
import {
  buildYoutubeWebHtml,
  extractYoutubeVideoIdFromUrl,
  resolveYoutubeParentOrigin,
} from '@/src/utils/youtubeWebViewEmbed';
import { transformToReviewEmbedUrl } from '@/src/utils/videoUtils';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

export default function CreateReviewScreen() {
  const params = useLocalSearchParams<{ ingestId?: string | string[] }>();
  const ingestIdParam =
    typeof params.ingestId === 'string'
      ? params.ingestId.trim()
      : Array.isArray(params.ingestId)
        ? params.ingestId[0]?.trim()
        : undefined;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { mode } = useThemeMode();
  const isLight = mode === 'titanium';

  const memoryDraft = ingestIdParam ? getCurationDraft(ingestIdParam) : undefined;
  const [draft, setDraft] = useState<IngestDraftPayload | undefined>(memoryDraft);
  const [hydrating, setHydrating] = useState(() => Boolean(ingestIdParam) && !memoryDraft);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [pollingBusy, setPollingBusy] = useState(false);

  const youtubeParentOrigin = useMemo(() => resolveYoutubeParentOrigin(), []);

  const reviewVideoWebSource = useMemo(() => {
    if (!draft?.sourceUrl) return null;
    if (draft.platform === 'youtube') {
      const vid = extractYoutubeVideoIdFromUrl(draft.sourceUrl);
      if (!vid) return null;
      return {
        html: buildYoutubeWebHtml(vid, youtubeParentOrigin),
        baseUrl: `${youtubeParentOrigin}/`,
      };
    }
    if (draft.platform === 'instagram') {
      const embed = transformToReviewEmbedUrl(draft.sourceUrl);
      if (!embed) return null;
      return {
        html: buildInstagramEmbedHtml(embed),
        baseUrl: 'https://www.instagram.com',
      };
    }
    return null;
  }, [draft?.ingestId, draft?.platform, draft?.sourceUrl, youtubeParentOrigin]);

  useEffect(() => {
    if (!ingestIdParam) return;

    const mem = getCurationDraft(ingestIdParam);
    if (mem) {
      setDraft(mem);
      setHydrating(false);
      setHydrateError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setHydrating(true);
      setHydrateError(null);
      try {
        const d = await loadOrResumeIngestDraft(ingestIdParam);
        if (cancelled) return;
        if (!d) {
          setHydrateError('This draft was not found. It may have been published or removed.');
          setDraft(undefined);
        } else {
          setDraft(d);
        }
      } catch (e) {
        if (!cancelled) {
          setHydrateError(normalizeIngestError(e));
          setDraft(undefined);
        }
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ingestIdParam]);

  const retryLoadDraft = () => {
    if (!ingestIdParam) return;
    setHydrateError(null);
    setHydrating(true);
    loadOrResumeIngestDraft(ingestIdParam)
      .then((d) => {
        if (!d) {
          setHydrateError('This draft was not found.');
          setDraft(undefined);
        } else {
          setDraft(d);
        }
      })
      .catch((e) => {
        setHydrateError(normalizeIngestError(e));
        setDraft(undefined);
      })
      .finally(() => setHydrating(false));
  };

  useEffect(() => {
    if (!draft) return;
    curationLog('info', 'review.draft_loaded', {
      ingestId: draft.ingestId,
      productCount: draft.products?.length ?? 0,
      extractionSource: draft.extractionSource,
      extractionStatus: draft.extractionStatus,
      extractionDurationMs: draft.extractionDurationMs,
      traceId: draft.traceId,
      extractionErrorCode: draft.extractionError?.code,
    });
  }, [draft]);

  useEffect(() => {
    if (!draft?.ingestId || !draft.products?.length) return;
    setSelected((prev) => {
      const m: Record<string, boolean> = {};
      const defaultOn = draft.extractionStatus === 'ok';
      for (const p of draft.products) {
        if (!p.id) continue;
        m[p.id] = prev[p.id] !== undefined ? prev[p.id]! : defaultOn;
      }
      return m;
    });
  }, [draft?.ingestId, draft?.products?.length, draft?.extractionStatus]);

  if (authLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
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
      <View style={[styles.screen, styles.center]}>
        <LinearGradient
          colors={isLight ? ['#FDFDFD', '#E8E8E8'] : ['#0D111F', '#020408']}
          style={StyleSheet.absoluteFill}
        />
        <Text style={{ color: isLight ? '#1A1A1B' : '#F8FAFC', marginBottom: 12 }}>Sign in to publish.</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)/profile')}>
          <Text style={styles.secondaryBtnText}>Profile</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!ingestIdParam) {
    return (
      <View style={styles.screen}>
        <LinearGradient
          colors={isLight ? ['#FDFDFD', '#E8E8E8'] : ['#0D111F', '#020408']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.center}>
          <Text style={{ color: isLight ? '#1A1A1B' : '#F8FAFC' }}>Missing ingest id.</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)/create')}>
            <Text style={styles.secondaryBtnText}>Back to Create</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (hydrating) {
    return (
      <View style={[styles.screen, styles.center]}>
        <LinearGradient
          colors={isLight ? ['#FDFDFD', '#E8E8E8'] : ['#0D111F', '#020408']}
          style={StyleSheet.absoluteFill}
        />
        <ActivityIndicator size="large" color={isLight ? '#00AFC0' : '#A855F7'} />
        <Text style={{ marginTop: 16, color: isLight ? '#475569' : '#94A3B8' }}>Loading draft…</Text>
      </View>
    );
  }

  if (hydrateError) {
    return (
      <View style={styles.screen}>
        <LinearGradient
          colors={isLight ? ['#FDFDFD', '#E8E8E8'] : ['#0D111F', '#020408']}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.center, { paddingHorizontal: 24 }]}>
          <Text style={{ color: isLight ? '#1A1A1B' : '#F8FAFC', textAlign: 'center', marginBottom: 12 }}>
            {hydrateError}
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={retryLoadDraft}>
            <Text style={styles.secondaryBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 10 }]} onPress={() => router.replace('/(tabs)/create')}>
            <Text style={styles.secondaryBtnText}>Back to Create</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!draft) {
    return (
      <View style={styles.screen}>
        <LinearGradient
          colors={isLight ? ['#FDFDFD', '#E8E8E8'] : ['#0D111F', '#020408']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.center}>
          <Text style={{ color: isLight ? '#1A1A1B' : '#F8FAFC' }}>
            No draft found. Go back and submit a URL again.
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)/create')}>
            <Text style={styles.secondaryBtnText}>Back to Create</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (draft.status === 'processing' && draft.products.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <LinearGradient
          colors={isLight ? ['#FDFDFD', '#E8E8E8'] : ['#0D111F', '#020408']}
          style={StyleSheet.absoluteFill}
        />
        <ActivityIndicator size="large" color={isLight ? '#00AFC0' : '#A855F7'} />
        <Text style={{ marginTop: 16, color: isLight ? '#475569' : '#94A3B8', textAlign: 'center', paddingHorizontal: 24 }}>
          Extraction is still running on the server. Wait a moment and tap refresh.
        </Text>
        <TouchableOpacity
          style={[styles.secondaryBtn, { marginTop: 20, opacity: pollingBusy ? 0.6 : 1 }]}
          disabled={pollingBusy}
          onPress={() => {
            setPollingBusy(true);
            loadOrResumeIngestDraft(ingestIdParam)
              .then((d) => {
                if (d) setDraft(d);
              })
              .catch((e) => setHydrateError(normalizeIngestError(e)))
              .finally(() => setPollingBusy(false));
          }}
        >
          {pollingBusy ? (
            <ActivityIndicator color={isLight ? '#1A1A1B' : '#F8FAFC'} />
          ) : (
            <Text style={styles.secondaryBtnText}>Refresh status</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  const toggle = (id: string) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  };

  const selectedIds = draft.products.filter((p) => p.id && selected[p.id]).map((p) => p.id);

  const onPublish = async () => {
    if (selectedIds.length < 1) {
      Alert.alert('Select products', 'Keep at least one product selected to publish.');
      return;
    }
    setBusy(true);
    try {
      const res = await publishIngestSelection(draft.ingestId, selectedIds, draft);
      if (!res.ok) {
        Alert.alert('Publish failed', res.error ?? 'Unknown error');
        return;
      }
      removeCurationDraft(draft.ingestId);
      requestFeedReload();
      Alert.alert('Published', 'Your reel is live in the feed.', [
        { text: 'OK', onPress: () => router.replace('/') },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onRejectAll = async () => {
    Alert.alert('Reject all?', 'This ingest will be marked rejected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await rejectIngestRequest(draft.ingestId, draft);
            removeCurationDraft(draft.ingestId);
            router.back();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: DraftProduct }) => (
    <View
      style={[
        styles.card,
        {
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)',
          backgroundColor: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.06)',
        },
      ]}
    >
      {item.image ? (
        <Image source={{ uri: item.image }} style={styles.thumb} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]} />
      )}
      <View style={styles.cardBody}>
        <Text style={[styles.name, { color: isLight ? '#111827' : '#F8FAFC' }]} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={[styles.meta, { color: isLight ? '#64748B' : '#94A3B8' }]}>
          {item.price} · {item.provider}
          {item.confidence != null && item.confidence > 0
            ? ` · ${Math.round(item.confidence * 100)}% match`
            : item.confidence === 0
              ? ' · preview row'
              : ''}
        </Text>
        <View style={styles.row}>
          <Text style={{ color: isLight ? '#334155' : '#CBD5E1', fontSize: 13 }}>Include</Text>
          <Switch value={!!selected[item.id]} onValueChange={() => toggle(item.id)} />
        </View>
        {item.affiliateUrl ? (
          <TouchableOpacity
            onPress={async () => {
              try {
                await Linking.openURL(item.affiliateUrl);
              } catch {
                Alert.alert('Error', 'Could not open the product link.');
              }
            }}
            accessibilityRole="link"
            accessibilityLabel="View product in browser"
          >
            <Text style={[styles.viewProductLink, { color: isLight ? '#0EA5E9' : '#38BDF8' }]}>View product</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  const showExtractionError = draft.extractionStatus === 'degraded' && !!draft.extractionError;

  const headerNote = (
    <View style={{ marginBottom: 10, gap: 8 }}>
      {reviewVideoWebSource ? (
        <View style={{ gap: 6 }}>
          <Text style={[styles.embedLabel, { color: isLight ? '#475569' : '#94A3B8' }]}>Video preview</Text>
          <View
            style={[
              styles.embedWrap,
              {
                borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)',
                backgroundColor: '#000',
              },
            ]}
          >
            <WebView
              source={{
                html: reviewVideoWebSource.html,
                baseUrl: reviewVideoWebSource.baseUrl,
              }}
              style={styles.embedWeb}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo
              scrollEnabled={false}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              bounces={false}
              androidLayerType="hardware"
              userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
              onError={(e) => {
                if (__DEV__) console.warn('Review embed WebView:', e.nativeEvent);
              }}
            />
          </View>
        </View>
      ) : null}
      {showExtractionError ? (
        <View
          style={[
            styles.errorBanner,
            {
              borderColor: isLight ? 'rgba(234,179,8,0.55)' : 'rgba(251,191,36,0.45)',
              backgroundColor: isLight ? 'rgba(254,243,199,0.95)' : 'rgba(120,53,15,0.35)',
            },
          ]}
        >
          <Text style={[styles.errorBannerTitle, { color: isLight ? '#92400E' : '#FDE68A' }]}>
            Extraction notice
          </Text>
          <Text style={[styles.errorBannerBody, { color: isLight ? '#78350F' : '#FEF3C7' }]}>
            {draft.extractionError?.message ?? 'These rows are previews only. Fix the issue and try again.'}
          </Text>
          {draft.extractionError?.detail ? (
            <Text style={[styles.errorBannerDetail, { color: isLight ? '#A16207' : '#FCD34D' }]} selectable>
              {draft.extractionError.detail}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text style={[styles.headerNote, { color: isLight ? '#475569' : '#94A3B8' }]}>
        {draft.extractionStatus === 'ok'
          ? 'Deselect anything you do not want in the feed. Affiliate column shows the wrapped buy link provider.'
          : 'Preview rows are unchecked by default. Only select items you intentionally want to publish after fixing extraction.'}
      </Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={isLight ? ['#FDFDFD', '#E8E8E8', '#D1D1D1'] : ['#0D111F', '#020408']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <FlatList
        data={draft.products}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={headerNote}
      />
      <View style={[styles.footer, { borderTopColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }]}>
        <TouchableOpacity style={styles.rejectBtn} onPress={onRejectAll} disabled={busy}>
          <Text style={styles.rejectBtnText}>Reject all</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.publishBtn, { opacity: selectedIds.length > 0 && !busy ? 1 : 0.45 }]}
          onPress={onPublish}
          disabled={selectedIds.length < 1 || busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishBtnText}>Publish</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  list: { padding: 16, paddingBottom: 120, gap: 12 },
  embedLabel: { fontSize: 13, fontWeight: '700' },
  embedWrap: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  embedWeb: { flex: 1, backgroundColor: '#000' },
  headerNote: { fontSize: 14, lineHeight: 20 },
  errorBanner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  errorBannerTitle: { fontSize: 14, fontWeight: '800' },
  errorBannerBody: { fontSize: 13, lineHeight: 18 },
  errorBannerDetail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  viewProductLink: { fontSize: 13, fontWeight: '700', marginTop: 6 },
  card: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    gap: 12,
    padding: 10,
  },
  thumb: { width: 72, height: 72, borderRadius: 10 },
  thumbPlaceholder: { backgroundColor: '#334155' },
  cardBody: { flex: 1, justifyContent: 'center', gap: 4 },
  name: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    paddingBottom: 28,
    borderTopWidth: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
  },
  rejectBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.6)',
    paddingVertical: 14,
    alignItems: 'center',
  },
  rejectBtnText: { color: '#FCA5A5', fontWeight: '700' },
  publishBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#0EA5E9',
    paddingVertical: 14,
    alignItems: 'center',
  },
  publishBtnText: { color: '#fff', fontWeight: '800' },
  secondaryBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#111827',
  },
  secondaryBtnText: { color: '#fff', fontWeight: '700' },
});
