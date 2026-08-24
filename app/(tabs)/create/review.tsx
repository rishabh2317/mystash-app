import { useAuth } from '@/contexts/AuthContext';
import {
  ProductDetailsSheet,
  ReviewProductCard,
  type ProductDetailsActionConfig,
} from '@/components/commerce';
import { CreateInlineNotice } from '@/components/create/CreateInlineNotice';
import { CreateScreenShell } from '@/components/create/CreateScreenShell';
import { PublishConfirmSheet } from '@/components/create/PublishConfirmSheet';
import { PublishSuccessScreen } from '@/components/create/PublishSuccessScreen';
import { StatusBlock } from '@/components/status/StatusBlock';
import { getCurationDraft, removeCurationDraft } from '@/src/state/curationDraftStore';
import { curationLog } from '@/src/logging/curationLog';
import {
  INGEST_ASYNC_POLL_INTERVAL_MS,
  appendManualProductsToIngest,
  loadOrResumeIngestDraft,
  normalizeIngestError,
  publishIngestSelection,
  rejectIngestRequest,
  retryUnresolvedIngestDrafts,
  submitIngestUrl,
  updateIngestVideoTitle,
} from '@/src/services/curation';
import { draftProductToViewModel } from '@/src/services/catalogProductMapper';
import {
  ingestDraftNeedsHydration,
  ingestDraftNeedsProductRetry,
  reviewVerificationStatus,
  selectedProductsCanPublish,
} from '@/src/services/reviewResolution';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { CREATE_COPY } from '@/src/ui/createCopy';
import {
  createFieldColors,
  createPrimaryButtonStyle,
  createSecondaryButtonStyle,
  createSurfaceStyle,
} from '@/src/ui/createChrome';
import {
  buildEditorReadiness,
  contentPlatformLabel,
  productsSectionMetaLabel,
  type EditorReadinessItem,
} from '@/src/ui/createEditorReadiness';
import { createPartialProductLinksMessage } from '@/src/ui/createFeedback';
import { ingestAllowsManualProducts, ingestEditorShowsProcessing } from '@/src/ui/createHandoff';
import {
  buildPublishConfirmSummary,
  publishProductCountLabel,
  resolvePublishSuccessCollectionId,
  type PublishRitualPhase,
} from '@/src/ui/createPublishRitual';
import { useAppToast } from '@/src/ui/useAppToast';
import {
  abandonCreateFlow,
  completeCreateFlow,
  exitCreateFlowAfterAbandon,
  exitCreateFlowAfterSuccess,
  exitCreateFlowToCollection,
  exitCreateFlowToCreateAnother,
} from '@/src/state/createFlowSession';
import { requestFeedReload } from '@/src/services/feedRefresh';
import { useProductBuyHandler } from '@/src/services/productActionOrchestration';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { DraftProduct, IngestDraftPayload } from '@/src/types/curation';
import { buildInstagramEmbedHtml } from '@/src/utils/instagramWebViewEmbed';
import {
  buildYoutubeWebHtml,
  extractYoutubeVideoIdFromUrl,
  resolveYoutubeParentOrigin,
} from '@/src/utils/youtubeWebViewEmbed';
import { transformToReviewEmbedUrl } from '@/src/utils/videoUtils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

const MAX_MANUAL_LINKS = 5;

function readinessItemLabel(item: EditorReadinessItem): string {
  if (item.id === 'content') {
    return item.done ? CREATE_COPY.editorReadinessContentDone : CREATE_COPY.editorReadinessContentTodo;
  }
  if (item.id === 'products') {
    return item.done ? CREATE_COPY.editorReadinessProductsDone : CREATE_COPY.editorReadinessProductsTodo;
  }
  if (item.done) return CREATE_COPY.editorReadinessResolvingDone;
  const n = item.count ?? 0;
  return `${n} ${CREATE_COPY.editorReadinessResolvingTodo}`;
}

function normalizeHttpUrl(value: string): string | null {
  const t = value.trim();
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

export default function CreateReviewScreen() {
  const params = useLocalSearchParams<{ ingestId?: string | string[]; mode?: string | string[] }>();
  const ingestIdParam =
    typeof params.ingestId === 'string'
      ? params.ingestId.trim()
      : Array.isArray(params.ingestId)
        ? params.ingestId[0]?.trim()
        : undefined;
  const modeParam =
    typeof params.mode === 'string'
      ? params.mode.trim()
      : Array.isArray(params.mode)
        ? params.mode[0]?.trim()
        : undefined;
  const openManualOnLoad = modeParam === 'manual';
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const handleBuy = useProductBuyHandler();
  const tokens = useThemeTokens();
  const { showToast } = useAppToast();
  const field = createFieldColors(tokens);
  const surface = createSurfaceStyle(tokens);
  const secondaryChrome = createSecondaryButtonStyle(tokens);

  const memoryDraft = ingestIdParam ? getCurationDraft(ingestIdParam) : undefined;
  const [draft, setDraft] = useState<IngestDraftPayload | undefined>(memoryDraft);
  const [hydrating, setHydrating] = useState(() => Boolean(ingestIdParam) && !memoryDraft);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [pollingBusy, setPollingBusy] = useState(false);
  const [detailsProduct, setDetailsProduct] = useState<CatalogProductViewModel | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [manualRows, setManualRows] = useState<string[]>(['']);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualComposerOpen, setManualComposerOpen] = useState(openManualOnLoad);
  const [storyTitle, setStoryTitle] = useState('');
  const [storyCaption, setStoryCaption] = useState('');
  const [retryError, setRetryError] = useState<string | null>(null);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [storyTitleError, setStoryTitleError] = useState<string | null>(null);
  const [publishPhase, setPublishPhase] = useState<PublishRitualPhase>('idle');
  const [publishedCollectionId, setPublishedCollectionId] = useState<string | null>(null);
  const [publishedTitle, setPublishedTitle] = useState('');
  const [publishedProductCount, setPublishedProductCount] = useState(0);
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
      setHydrateError(null);
      if (!ingestDraftNeedsHydration(mem)) {
        setHydrating(false);
        return;
      }
    }

    let cancelled = false;
    (async () => {
      if (!mem) setHydrating(true);
      setHydrateError(null);
      try {
        const d = await loadOrResumeIngestDraft(ingestIdParam);
        if (cancelled) return;
        if (!d) {
          if (!mem) {
            setHydrateError('This Collection was not found. It may have been published or removed.');
            setDraft(undefined);
          }
        } else {
          setDraft(d);
        }
      } catch (e) {
        if (!cancelled && !mem) {
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

  useEffect(() => {
    if (!ingestIdParam || !draft || !ingestEditorShowsProcessing(draft)) return;
    let cancelled = false;
    const tick = () => {
      void loadOrResumeIngestDraft(ingestIdParam)
        .then((d) => {
          if (!cancelled && d) setDraft(d);
        })
        .catch(() => {
          /* keep showing processing; Refresh remains available */
        });
    };
    tick();
    const interval = setInterval(tick, INGEST_ASYNC_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ingestIdParam, draft?.ingestId, draft?.status, draft?.extractionPending, draft?.products.length]);

  const retryLoadDraft = () => {
    if (!ingestIdParam) return;
    setHydrateError(null);
    setHydrating(true);
    loadOrResumeIngestDraft(ingestIdParam)
      .then((d) => {
        if (!d) {
          setHydrateError('This Collection was not found.');
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

  useEffect(() => {
    if (!draft?.ingestId) return;
    setStoryTitle(draft.videoTitle ?? '');
  }, [draft?.ingestId, draft?.videoTitle]);

  useEffect(() => {
    if (!draft?.ingestId) return;
    setStoryCaption('');
  }, [draft?.ingestId]);

  const uniqueManualUrls = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of manualRows) {
      const normalized = normalizeHttpUrl(row);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }, [manualRows]);

  const addManualRow = () => {
    setManualRows((prev) => (prev.length < MAX_MANUAL_LINKS ? [...prev, ''] : prev));
  };

  const updateManualRow = (idx: number, value: string) => {
    setManualRows((prev) => prev.map((row, i) => (i === idx ? value : row)));
  };

  const removeManualRow = (idx: number) => {
    setManualRows((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [''];
    });
  };

  if (authLoading) {
    return (
      <CreateScreenShell>
        <StatusBlock kind="loading" message={CREATE_COPY.editorLoading} fill />
      </CreateScreenShell>
    );
  }

  if (!user) {
    return (
      <CreateScreenShell>
        <StatusBlock
          kind="empty"
          title={CREATE_COPY.signInTitle}
          message={CREATE_COPY.editorSignInPublish}
          actionLabel="Profile"
          onAction={() => router.replace('/(tabs)/profile')}
          fill
        />
      </CreateScreenShell>
    );
  }

  if (!ingestIdParam) {
    return (
      <CreateScreenShell>
        <StatusBlock
          kind="empty"
          message={CREATE_COPY.editorMissingId}
          actionLabel={CREATE_COPY.editorBackToStudio}
          onAction={() => router.replace('/(tabs)/create')}
          fill
        />
      </CreateScreenShell>
    );
  }

  if (hydrating) {
    return (
      <CreateScreenShell>
        <StatusBlock kind="loading" message={CREATE_COPY.editorLoading} fill />
      </CreateScreenShell>
    );
  }

  if (hydrateError) {
    return (
      <CreateScreenShell>
        <View style={[styles.center, { paddingHorizontal: tokens.space.lg }]}>
          <StatusBlock
            kind="error"
            message={hydrateError}
            actionLabel="Retry"
            onAction={retryLoadDraft}
          />
          <TouchableOpacity
            style={[
              styles.secondaryBtn,
              {
                backgroundColor: tokens.color.borderStrong,
                borderRadius: tokens.radius.sm + 2,
                marginTop: tokens.space.sm,
              },
            ]}
            onPress={() => router.replace('/(tabs)/create')}
          >
            <Text
              style={{
                color: tokens.mode === 'titanium' ? tokens.color.textOnAccent : tokens.color.canvas,
                fontWeight: tokens.fontWeight.bold,
              }}
            >
              {CREATE_COPY.editorBackToStudio}
            </Text>
          </TouchableOpacity>
        </View>
      </CreateScreenShell>
    );
  }

  if (!draft) {
    return (
      <CreateScreenShell>
        <StatusBlock
          kind="empty"
          message={CREATE_COPY.editorNotFound}
          actionLabel={CREATE_COPY.editorBackToStudio}
          onAction={() => router.replace('/(tabs)/create')}
          fill
        />
      </CreateScreenShell>
    );
  }

  if (draft.status === 'failed' && !manualComposerOpen) {
    const sourceBlocked = ['SOURCE_RESTRICTED', 'SOURCE_UNAVAILABLE', 'UNSUPPORTED_SOURCE'].includes(
      draft.extractionError?.code ?? '',
    );
    return (
      <CreateScreenShell>
        <View style={[styles.center, { paddingHorizontal: tokens.space.lg }]}>
          <Text
            style={{
              color: tokens.color.text,
              fontWeight: tokens.fontWeight.extraBold,
              fontSize: tokens.fontSize.title + 1,
              textAlign: 'center',
            }}
          >
            {CREATE_COPY.editorFailedTitle}
          </Text>
          <Text
            style={{
              color: tokens.color.textMuted,
              textAlign: 'center',
              marginTop: tokens.space.xs,
              lineHeight: 20,
            }}
          >
            {draft.extractionError?.message ?? CREATE_COPY.editorFailedBody}
          </Text>
          <TouchableOpacity
            style={[
              styles.secondaryBtn,
              {
                marginTop: tokens.space.lg - 4,
                opacity: busy ? 0.6 : 1,
                backgroundColor: tokens.color.borderStrong,
                borderRadius: tokens.radius.sm + 2,
              },
            ]}
            disabled={busy}
            onPress={() => {
              setBusy(true);
              setRetryError(null);
              void submitIngestUrl(draft.sourceUrl, { videoTitle: draft.videoTitle })
                .then(async (res) => {
                  if (!res.ingestId) {
                    setRetryError(CREATE_COPY.retryFailedInline);
                    return;
                  }
                  const next = await loadOrResumeIngestDraft(res.ingestId);
                  if (next) setDraft(next);
                })
                .catch((e) => setRetryError(normalizeIngestError(e) || CREATE_COPY.retryFailedInline))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? (
              <ActivityIndicator color={tokens.color.text} />
            ) : (
              <Text
                style={{
                  color: tokens.mode === 'titanium' ? tokens.color.textOnAccent : tokens.color.canvas,
                  fontWeight: tokens.fontWeight.bold,
                }}
              >
                {CREATE_COPY.editorRetryFind}
              </Text>
            )}
          </TouchableOpacity>
          {retryError ? (
            <View style={{ marginTop: tokens.space.sm, width: '100%' }}>
              <CreateInlineNotice
                tone="error"
                body={retryError}
                actionLabel={CREATE_COPY.feedbackDismiss}
                onAction={() => setRetryError(null)}
              />
            </View>
          ) : null}
          {!sourceBlocked ? (
            <TouchableOpacity
              style={[
                styles.secondaryBtn,
                {
                  marginTop: tokens.space.sm - 2,
                  backgroundColor: tokens.color.borderStrong,
                  borderRadius: tokens.radius.sm + 2,
                },
              ]}
              onPress={() => setManualComposerOpen(true)}
            >
              <Text
                style={{
                  color: tokens.mode === 'titanium' ? tokens.color.textOnAccent : tokens.color.canvas,
                  fontWeight: tokens.fontWeight.bold,
                }}
              >
                {CREATE_COPY.editorAddLinks}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[
              styles.secondaryBtn,
              {
                marginTop: tokens.space.sm - 2,
                backgroundColor: tokens.color.borderStrong,
                borderRadius: tokens.radius.sm + 2,
              },
            ]}
            onPress={() => router.replace('/(tabs)/create')}
          >
            <Text
              style={{
                color: tokens.mode === 'titanium' ? tokens.color.textOnAccent : tokens.color.canvas,
                fontWeight: tokens.fontWeight.bold,
              }}
            >
              {CREATE_COPY.editorBackToStudio}
            </Text>
          </TouchableOpacity>
        </View>
      </CreateScreenShell>
    );
  }

  if (ingestEditorShowsProcessing(draft)) {
    return (
      <CreateScreenShell>
        <View style={styles.center}>
          <StatusBlock kind="loading" message={CREATE_COPY.editorProcessing} />
          <Text
            style={{
              marginTop: tokens.space.xs,
              color: tokens.color.textMuted,
              textAlign: 'center',
              paddingHorizontal: tokens.space.lg,
              fontSize: 13,
              lineHeight: 18,
            }}
          >
            {CREATE_COPY.editorProcessingHint}
          </Text>
          <TouchableOpacity
            style={[
              styles.secondaryBtn,
              {
                marginTop: tokens.space.lg - 4,
                opacity: pollingBusy ? 0.6 : 1,
                backgroundColor: tokens.color.borderStrong,
                borderRadius: tokens.radius.sm + 2,
              },
            ]}
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
              <ActivityIndicator color={tokens.color.text} />
            ) : (
              <Text
                style={{
                  color: tokens.mode === 'titanium' ? tokens.color.textOnAccent : tokens.color.canvas,
                  fontWeight: tokens.fontWeight.bold,
                }}
              >
                {CREATE_COPY.editorRefresh}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </CreateScreenShell>
    );
  }

  const openDetails = (product: CatalogProductViewModel) => {
    setDetailsProduct(product);
    setDetailsVisible(true);
  };

  const closeDetails = () => {
    setDetailsVisible(false);
    setDetailsProduct(null);
  };

  const refreshDraftFromCatalog = async () => {
    if (!ingestIdParam) return;
    setEditorNotice(null);
    try {
      let d = await loadOrResumeIngestDraft(ingestIdParam);
      if (!d) {
        setEditorNotice(CREATE_COPY.refreshNotFoundInline);
        return;
      }
      setDraft(d);
      if (ingestDraftNeedsProductRetry(d)) {
        await retryUnresolvedIngestDrafts(ingestIdParam);
        d = await loadOrResumeIngestDraft(ingestIdParam);
        if (d) setDraft(d);
      }
      showToast({ tone: 'success', title: CREATE_COPY.refreshSuccessToast });
    } catch (e) {
      setEditorNotice(normalizeIngestError(e) || CREATE_COPY.refreshFailedInline);
    }
  };

  const addManualLinksToCollection = async () => {
    if (!draft) return;
    if (!ingestAllowsManualProducts(draft)) {
      setManualError('Manual products are unavailable while automatic extraction is running.');
      return;
    }
    if (uniqueManualUrls.length < 1 || uniqueManualUrls.length > MAX_MANUAL_LINKS) {
      setManualError(`Add 1-${MAX_MANUAL_LINKS} valid product URLs.`);
      return;
    }
    setManualBusy(true);
    setManualError(null);
    try {
      const res = await appendManualProductsToIngest(draft.ingestId, uniqueManualUrls);
      if (!res.ingestId || !res.draft) {
        setManualError(CREATE_COPY.manualSaveFailedInline);
        return;
      }
      if (res.ingestId !== draft.ingestId) {
        setManualError('Product add returned a different Collection. No changes applied.');
        return;
      }
      setDraft({
        ...res.draft,
        // Append never rewrites video extraction provenance — keep prior if absent.
        extractionSource: res.draft.extractionSource ?? draft.extractionSource,
        extractionStatus: res.draft.extractionStatus ?? draft.extractionStatus,
        extractionError: res.draft.extractionError ?? draft.extractionError,
        pipelineMeta: res.draft.pipelineMeta ?? draft.pipelineMeta,
      });
      if (!res.noop) {
        setManualRows(['']);
        setManualComposerOpen(false);
      }
      const partial = createPartialProductLinksMessage(res.failedProductUrls ?? []);
      if (partial) {
        setManualError(partial);
      } else if (!res.noop) {
        showToast({ tone: 'success', title: CREATE_COPY.manualAddSuccessToast });
      }
    } catch (e) {
      setManualError(normalizeIngestError(e));
    } finally {
      setManualBusy(false);
    }
  };

  const detailsActions: ProductDetailsActionConfig = {
    enabled: ['replace', 'refresh', 'remove'],
    onReplace: () => {
      closeDetails();
      if (ingestAllowsManualProducts(draft)) {
        setManualComposerOpen(true);
      }
    },
    onRefresh: () => {
      void refreshDraftFromCatalog();
    },
    onRemove: (product) => {
      const draftItem = draft?.products.find(
        (p) => p.catalogProductId === product.id || p.id === product.id,
      );
      if (draftItem?.id) {
        setSelected((s) => ({ ...s, [draftItem.id]: false }));
      }
      closeDetails();
    },
  };

  const selectedIds = draft.products.filter((p) => p.id && selected[p.id]).map((p) => p.id);
  const canPublish = selectedProductsCanPublish(draft.products, selected);
  const readiness = buildEditorReadiness({
    hasContent: Boolean(draft.sourceUrl?.trim()),
    products: draft.products,
    selected,
  });
  const productsMeta = productsSectionMetaLabel(readiness.includedCount, readiness.attentionCount);

  const persistStoryTitle = async () => {
    const next = storyTitle.trim();
    const prev = (draft.videoTitle ?? '').trim();
    if (next === prev) return;
    setStoryTitleError(null);
    try {
      await updateIngestVideoTitle(draft.ingestId, next);
      setDraft({ ...draft, videoTitle: next || undefined });
    } catch {
      setStoryTitleError(CREATE_COPY.storyTitleSaveFailed);
    }
  };

  const publishSummary = buildPublishConfirmSummary({
    title: storyTitle || draft.videoTitle,
    productCount: selectedIds.length,
    thumbnailUrl: draft.thumbnail,
    previewLine: CREATE_COPY.publishConfirmPreview,
  });

  const openPublishConfirm = () => {
    if (!readiness.ready || !canPublish) {
      return;
    }
    if (selectedIds.length < 1) {
      setPublishError(CREATE_COPY.editorPublishSelectBody);
      return;
    }
    setPublishError(null);
    setPublishPhase('confirm');
  };

  const closePublishConfirm = () => {
    if (publishPhase === 'publishing') return;
    setPublishPhase('idle');
  };

  const confirmPublish = async () => {
    if (!readiness.ready || !canPublish || selectedIds.length < 1) {
      setPublishPhase('idle');
      setPublishError(CREATE_COPY.editorPublishSelectBody);
      return;
    }
    setPublishPhase('publishing');
    setBusy(true);
    setPublishError(null);
    try {
      const res = await publishIngestSelection(draft.ingestId, selectedIds, draft);
      if (!res.ok) {
        setPublishPhase('idle');
        setPublishError(res.error ?? CREATE_COPY.publishFailedInline);
        return;
      }
      const collectionId = resolvePublishSuccessCollectionId(res.collectionId);
      removeCurationDraft(draft.ingestId);
      completeCreateFlow();
      requestFeedReload();
      setPublishedCollectionId(collectionId);
      setPublishedTitle(publishSummary.title);
      setPublishedProductCount(selectedIds.length);
      setPublishPhase('success');
    } finally {
      setBusy(false);
    }
  };

  const onRejectAll = async () => {
    Alert.alert(CREATE_COPY.editorDiscardConfirmTitle, CREATE_COPY.editorDiscardConfirmBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await rejectIngestRequest(draft.ingestId, draft);
            removeCurationDraft(draft.ingestId);
            abandonCreateFlow();
            exitCreateFlowAfterAbandon(router);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: DraftProduct }) => {
    const vm = draftProductToViewModel(item);
    const displayStatus = reviewVerificationStatus(item);
    return (
      <ReviewProductCard
        product={vm}
        included={!!selected[item.id]}
        onToggleInclude={(v) => setSelected((s) => ({ ...s, [item.id]: v }))}
        onOpenDetails={openDetails}
        confidence={item.confidence}
        extractionHint={displayStatus === 'RESOLVING' ? CREATE_COPY.editorResolvingHint : null}
      />
    );
  };

  const showExtractionError =
    !!draft.extractionError &&
    (draft.extractionStatus === 'degraded' || draft.status === 'review_required');
  const needsManualProducts =
    draft.status === 'review_required' ||
    (draft.products.length === 0 && draft.status !== 'processing');

  const sectionTitleColor = tokens.color.text;
  const sectionMetaColor = tokens.color.textMuted;
  const mutedColor = tokens.color.textMuted;
  const publishBtn = createPrimaryButtonStyle(tokens, {
    disabled: !readiness.ready || !canPublish || busy || publishPhase !== 'idle',
    pending: busy,
  });

  const headerNote = (
    <View style={{ marginBottom: 10, gap: 16 }}>
      {/* CONTENT */}
      <View style={styles.editorSection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>
            {CREATE_COPY.editorSectionContent}
          </Text>
          <Text style={[styles.sectionMeta, { color: sectionMetaColor }]}>
            {contentPlatformLabel(draft.platform)}
          </Text>
        </View>
        {reviewVideoWebSource ? (
          <View
            style={[
              styles.embedWrap,
              {
                borderColor: tokens.color.border,
                backgroundColor: '#000',
                borderRadius: tokens.radius.lg,
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
        ) : (
          <Text style={[styles.headerNote, { color: mutedColor }]}>
            {draft.sourceUrl || CREATE_COPY.editorReadinessContentTodo}
          </Text>
        )}
      </View>

      {/* PRODUCTS */}
      <View style={styles.editorSection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>
            {CREATE_COPY.editorSectionProducts}
          </Text>
          <Text style={[styles.sectionMeta, { color: sectionMetaColor }]}>{productsMeta}</Text>
        </View>

        {editorNotice ? (
          <CreateInlineNotice
            tone="error"
            body={editorNotice}
            actionLabel={CREATE_COPY.feedbackRetry}
            onAction={() => void refreshDraftFromCatalog()}
          />
        ) : null}

        {showExtractionError ? (
          <View
            style={[
              styles.errorBanner,
              {
                borderColor: tokens.color.warning,
                backgroundColor:
                  tokens.mode === 'titanium' ? 'rgba(180,83,9,0.12)' : 'rgba(251,191,36,0.18)',
                borderRadius: tokens.radius.md,
              },
            ]}
          >
            <Text style={[styles.errorBannerTitle, { color: tokens.color.warning }]}>
              {CREATE_COPY.editorExtractionNotice}
            </Text>
            <Text style={[styles.errorBannerBody, { color: tokens.color.text }]}>
              {draft.extractionError?.message ?? 'These rows are previews only. Fix the issue and try again.'}
            </Text>
            {draft.extractionError?.detail ? (
              <Text style={[styles.errorBannerDetail, { color: tokens.color.textMuted }]} selectable>
                {draft.extractionError.detail}
              </Text>
            ) : null}
          </View>
        ) : null}
        {needsManualProducts ? (
          <View
            style={[
              styles.errorBanner,
              {
                borderColor: tokens.color.accent,
                backgroundColor:
                  tokens.mode === 'titanium' ? 'rgba(0,175,192,0.12)' : 'rgba(168,85,247,0.18)',
                borderRadius: tokens.radius.md,
              },
            ]}
          >
            <Text style={[styles.errorBannerTitle, { color: tokens.color.accent }]}>
              {CREATE_COPY.editorNoProductsTitle}
            </Text>
            <Text style={[styles.errorBannerBody, { color: tokens.color.text }]}>
              {draft.extractionError?.message ?? CREATE_COPY.editorNoProductsBody}
            </Text>
            <TouchableOpacity
              style={{ marginTop: tokens.space.xs }}
              onPress={() => setManualComposerOpen(true)}
            >
              <Text style={{ color: tokens.color.accent, fontWeight: tokens.fontWeight.extraBold }}>
                {CREATE_COPY.editorAddLinksAction}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {ingestAllowsManualProducts(draft) && manualComposerOpen ? (
          <View
            style={[
              styles.manualComposer,
              {
                borderColor: tokens.color.border,
                backgroundColor: surface.backgroundColor,
                borderRadius: tokens.radius.md,
                padding: tokens.space.sm,
                gap: tokens.space.xs,
              },
            ]}
          >
            <Text
              style={{
                color: tokens.color.text,
                fontSize: tokens.fontSize.body,
                fontWeight: tokens.fontWeight.extraBold,
              }}
            >
              {CREATE_COPY.editorAddLinks}
            </Text>
            <Text
              style={{
                color: tokens.color.textMuted,
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              Add up to {MAX_MANUAL_LINKS} product URLs for this Collection.
            </Text>
            {manualRows.map((row, idx) => (
              <View key={`manual-row-${idx}`} style={styles.manualRowWrap}>
                <TextInput
                  value={row}
                  onChangeText={(value) => updateManualRow(idx, value)}
                  placeholder={`Product URL ${idx + 1}`}
                  placeholderTextColor={field.placeholderTextColor}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={[
                    styles.manualInput,
                    {
                      color: field.color,
                      borderColor: field.borderColor,
                      backgroundColor: field.backgroundColor,
                      borderRadius: tokens.radius.sm + 2,
                    },
                  ]}
                />
                {manualRows.length > 1 ? (
                  <TouchableOpacity
                    onPress={() => removeManualRow(idx)}
                    style={[
                      styles.manualRemoveBtn,
                      {
                        backgroundColor:
                          tokens.mode === 'titanium' ? 'rgba(185,28,28,0.14)' : 'rgba(252,165,165,0.2)',
                        borderRadius: tokens.radius.sm + 2,
                      },
                    ]}
                  >
                    <Text style={{ color: tokens.color.danger, fontSize: 16, fontWeight: tokens.fontWeight.bold }}>
                      ✕
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
            {manualRows.length < MAX_MANUAL_LINKS ? (
              <TouchableOpacity onPress={addManualRow} style={styles.manualAddRowBtn}>
                <Text style={{ color: tokens.color.accent, fontWeight: tokens.fontWeight.bold }}>
                  + Add another link
                </Text>
              </TouchableOpacity>
            ) : null}
            {manualError ? (
              <Text style={{ color: tokens.color.danger, fontSize: tokens.fontSize.caption }}>
                {manualError}
              </Text>
            ) : null}
            <View style={styles.manualActions}>
              <TouchableOpacity
                style={[
                  styles.manualCancelBtn,
                  secondaryChrome,
                  { borderWidth: tokens.stroke.thin },
                ]}
                onPress={() => {
                  setManualComposerOpen(false);
                  setManualError(null);
                  setManualRows(['']);
                }}
                disabled={manualBusy}
              >
                <Text style={{ color: tokens.color.text, fontWeight: tokens.fontWeight.bold }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.manualSaveBtn,
                  {
                    backgroundColor: tokens.color.cta,
                    borderRadius: tokens.radius.sm + 2,
                    opacity: manualBusy ? 0.7 : 1,
                  },
                ]}
                onPress={() => void addManualLinksToCollection()}
                disabled={manualBusy}
              >
                {manualBusy ? (
                  <ActivityIndicator color={tokens.color.successOn} />
                ) : (
                  <Text style={{ color: tokens.color.successOn, fontWeight: tokens.fontWeight.extraBold }}>
                    Add products
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : ingestAllowsManualProducts(draft) ? (
          <TouchableOpacity
            style={styles.manualOpenBtn}
            onPress={() => setManualComposerOpen(true)}
          >
            <Text style={{ color: tokens.color.accent, fontWeight: tokens.fontWeight.extraBold }}>
              {CREATE_COPY.editorAddLinks}
            </Text>
          </TouchableOpacity>
        ) : null}
        <Text style={[styles.headerNote, { color: mutedColor }]}>
          {needsManualProducts
            ? CREATE_COPY.editorNoteManual
            : draft.extractionStatus === 'ok'
              ? CREATE_COPY.editorNoteOk
              : CREATE_COPY.editorNotePreview}
        </Text>
      </View>
    </View>
  );

  const storyFooter = (
    <View style={[styles.editorSection, { marginTop: tokens.space.xs, marginBottom: tokens.space.lg }]}>
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>
          {CREATE_COPY.editorSectionStory}
        </Text>
        <Text style={[styles.sectionMeta, { color: sectionMetaColor }]}>
          {CREATE_COPY.editorSectionStoryOptional}
        </Text>
      </View>
      <Text style={[styles.fieldLabel, { color: mutedColor }]}>{CREATE_COPY.editorStoryTitleLabel}</Text>
      <TextInput
        value={storyTitle}
        onChangeText={setStoryTitle}
        onEndEditing={() => void persistStoryTitle()}
        placeholder={CREATE_COPY.editorStoryTitlePlaceholder}
        placeholderTextColor={field.placeholderTextColor}
        style={[
          styles.storyInput,
          {
            color: field.color,
            borderColor: field.borderColor,
            backgroundColor: field.backgroundColor,
            borderRadius: tokens.radius.sm + 2,
          },
        ]}
      />
      {storyTitleError ? (
        <CreateInlineNotice
          tone="error"
          body={storyTitleError}
          actionLabel={CREATE_COPY.feedbackDismiss}
          onAction={() => setStoryTitleError(null)}
        />
      ) : null}
      <Text style={[styles.fieldLabel, { color: mutedColor, marginTop: tokens.space.xs }]}>
        {CREATE_COPY.editorStoryCaptionLabel}
      </Text>
      <TextInput
        value={storyCaption}
        onChangeText={setStoryCaption}
        placeholder={CREATE_COPY.editorStoryCaptionPlaceholder}
        placeholderTextColor={field.placeholderTextColor}
        multiline
        style={[
          styles.storyInput,
          styles.storyCaptionInput,
          {
            color: field.color,
            borderColor: field.borderColor,
            backgroundColor: field.backgroundColor,
            borderRadius: tokens.radius.sm + 2,
          },
        ]}
      />
      <Text style={[styles.captionHint, { color: sectionMetaColor }]}>
        {CREATE_COPY.editorStoryCaptionHint}
      </Text>
    </View>
  );

  return (
    <CreateScreenShell>
      <FlatList
        data={draft.products}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={headerNote}
        ListFooterComponent={storyFooter}
      />
      <View
        style={[
          styles.footer,
          {
            borderTopColor: tokens.color.border,
            backgroundColor: tokens.color.surface,
            gap: tokens.space.sm - 2,
            padding: tokens.space.md,
            paddingBottom: tokens.space.lg + 4,
          },
        ]}
      >
        <View style={styles.readinessBlock}>
          <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>
            {CREATE_COPY.editorSectionReadiness}
          </Text>
          {readiness.items.map((item) => (
            <View key={item.id} style={styles.readinessRow}>
              <Text
                style={{
                  color: item.done ? tokens.color.success : mutedColor,
                  fontSize: 13,
                }}
              >
                {item.done ? '✓' : '○'} {readinessItemLabel(item)}
              </Text>
            </View>
          ))}
          {!readiness.ready ? (
            <Text style={[styles.captionHint, { color: sectionMetaColor, marginTop: 4 }]}>
              {CREATE_COPY.editorReadinessExpandHint}
            </Text>
          ) : null}
          {publishError ? (
            <CreateInlineNotice
              tone="error"
              body={publishError}
              actionLabel={CREATE_COPY.feedbackRetry}
              onAction={() => {
                setPublishError(null);
                openPublishConfirm();
              }}
            />
          ) : null}
        </View>
        <View style={[styles.footerActions, { gap: tokens.space.sm - 2 }]}>
          <TouchableOpacity
            style={[
              styles.rejectBtn,
              {
                borderColor: tokens.color.danger,
                borderRadius: tokens.radius.md,
              },
            ]}
            onPress={onRejectAll}
            disabled={busy || publishPhase !== 'idle'}
          >
            <Text style={{ color: tokens.color.danger, fontWeight: tokens.fontWeight.bold }}>
              {CREATE_COPY.editorDiscard}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.publishBtn, publishBtn, { paddingVertical: 14 }]}
            onPress={openPublishConfirm}
            disabled={!readiness.ready || !canPublish || busy || publishPhase !== 'idle'}
          >
            {busy ? (
              <ActivityIndicator color={tokens.color.successOn} />
            ) : (
              <Text
                style={{
                  color: tokens.color.successOn,
                  fontWeight: tokens.fontWeight.extraBold,
                }}
              >
                {CREATE_COPY.editorPublish}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      <PublishConfirmSheet
        visible={publishPhase === 'confirm' || publishPhase === 'publishing'}
        summary={publishSummary}
        publishing={publishPhase === 'publishing'}
        onConfirm={() => void confirmPublish()}
        onCancel={closePublishConfirm}
      />
      <PublishSuccessScreen
        visible={publishPhase === 'success'}
        title={publishedTitle || publishSummary.title}
        productCountLabel={publishProductCountLabel(publishedProductCount || selectedIds.length)}
        canViewCollection={Boolean(publishedCollectionId)}
        onViewFeed={() => exitCreateFlowAfterSuccess(router)}
        onViewCollection={() => {
          if (publishedCollectionId) {
            exitCreateFlowToCollection(router, publishedCollectionId);
          } else {
            exitCreateFlowAfterSuccess(router);
          }
        }}
        onCreateAnother={() => exitCreateFlowToCreateAnother(router)}
      />
      <ProductDetailsSheet
        visible={detailsVisible}
        product={detailsProduct}
        onClose={closeDetails}
        actions={detailsActions}
        onBuy={handleBuy}
      />
    </CreateScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  list: { padding: 16, paddingBottom: 220, gap: 12 },
  editorSection: { gap: 8 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  sectionMeta: { fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  fieldLabel: { fontSize: 12, fontWeight: '700' },
  storyInput: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  storyCaptionInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  captionHint: { fontSize: 12, lineHeight: 16 },
  embedWrap: {
    width: '100%',
    height: 220,
    borderWidth: 1,
    overflow: 'hidden',
  },
  embedWeb: { flex: 1, backgroundColor: '#000' },
  headerNote: { fontSize: 14, lineHeight: 20 },
  errorBanner: {
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  errorBannerTitle: { fontSize: 14, fontWeight: '800' },
  errorBannerBody: { fontSize: 13, lineHeight: 18 },
  errorBannerDetail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  manualOpenBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  manualComposer: {
    borderWidth: 1,
  },
  manualRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  manualInput: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  manualRemoveBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualAddRowBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  manualActions: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 8,
  },
  manualCancelBtn: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualSaveBtn: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
  },
  readinessBlock: { gap: 4 },
  readinessRow: { paddingVertical: 1 },
  footerActions: {
    flexDirection: 'row',
  },
  rejectBtn: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  publishBtn: {
    flex: 1,
    alignItems: 'center',
  },
  secondaryBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
