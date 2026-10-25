import { useAuth } from '@/contexts/AuthContext';
import {
  ProductDetailsSheet,
  ReviewProductCard,
  type ProductDetailsActionConfig,
} from '@/components/commerce';
import { ActionButton } from '@/components/ui/ActionButton';
import { ActionChoiceRow } from '@/components/ui/ActionChoiceRow';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Text } from '@/components/ui/Text';
import { CreateInlineNotice } from '@/components/create/CreateInlineNotice';
import { CreateScreenShell } from '@/components/create/CreateScreenShell';
import {
  CreateStudioLibraryPicker,
  type StudioLibrarySelection,
} from '@/components/create/CreateStudioLibraryPicker';
import { StagedProgressIndicator } from '@/components/create/StagedProgressIndicator';
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
import { listLibraryItemProducts } from '@/src/services/creatorLibraryApi';
import {
  ingestDraftNeedsHydration,
  ingestDraftNeedsProductRetry,
  reviewVerificationStatus,
  selectedProductsCanPublish,
} from '@/src/services/reviewResolution';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { CREATE_COPY } from '@/src/ui/createCopy';
import { createFieldColors } from '@/src/ui/createChrome';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import {
  buildEditorReadiness,
  contentPlatformLabel,
  productsSectionMetaLabel,
} from '@/src/ui/createEditorReadiness';
import { createPartialProductLinksMessage } from '@/src/ui/createFeedback';
import { ingestAllowsManualProducts, ingestEditorShowsProcessing } from '@/src/ui/createHandoff';
import { mapManualProductLinkStages, mapVideoExtractionStages } from '@/src/ui/ingestProgressStages';
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
import { maybePromptForPush } from '@/src/notifications/permissionPrompt';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { DraftProduct, IngestDraftPayload } from '@/src/types/curation';
import { buildInstagramEmbedHtml } from '@/src/utils/instagramWebViewEmbed';
import {
  buildYoutubeWebHtml,
  extractYoutubeVideoIdFromUrl,
  resolveYoutubeParentOrigin,
} from '@/src/utils/youtubeWebViewEmbed';
import { transformToReviewEmbedUrl } from '@/src/utils/videoUtils';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

const MAX_MANUAL_LINKS = 5;

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
  const navigation = useNavigation();
  const { user, loading: authLoading } = useAuth();
  const handleBuy = useProductBuyHandler();
  const tokens = useThemeTokens();
  const { showToast } = useAppToast();
  const field = createFieldColors(tokens);
  const objectChrome = outlineCardChrome(tokens);

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
  const [publishedCoverUrl, setPublishedCoverUrl] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [librarySelectedUrl, setLibrarySelectedUrl] = useState<string | null>(null);
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

  const selectedIds = useMemo(
    () => (draft?.products ?? []).filter((p) => p.id && selected[p.id]).map((p) => p.id),
    [draft?.products, selected],
  );
  const canPublish = draft ? selectedProductsCanPublish(draft.products, selected) : false;
  const readiness = draft
    ? buildEditorReadiness({
        hasContent: Boolean(draft.sourceUrl?.trim()),
        products: draft.products,
        selected,
      })
    : { items: [], ready: false, includedCount: 0, attentionCount: 0 };

  const openPublishConfirm = useCallback(() => {
    if (!readiness.ready || !canPublish) return;
    if (selectedIds.length < 1) {
      setPublishError(CREATE_COPY.editorPublishSelectBody);
      return;
    }
    setPublishError(null);
    setPublishPhase('confirm');
  }, [readiness.ready, canPublish, selectedIds.length]);

  const showEditorPublish = Boolean(
    user &&
      ingestIdParam &&
      !authLoading &&
      !hydrating &&
      !hydrateError &&
      draft &&
      !(draft.status === 'failed' && !manualComposerOpen) &&
      !ingestEditorShowsProcessing(draft),
  );

  const publishHeaderDisabled =
    !showEditorPublish || !readiness.ready || !canPublish || busy || publishPhase !== 'idle';

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: showEditorPublish
        ? () => (
            <Pressable
              onPress={openPublishConfirm}
              disabled={publishHeaderDisabled}
              accessibilityRole="button"
              accessibilityLabel={CREATE_COPY.editorPublish}
              style={{ opacity: publishHeaderDisabled ? 0.4 : 1, paddingVertical: 6, paddingHorizontal: 4 }}
            >
              <Text style={typeStyle(tokens, 'link')} numberOfLines={1}>
                {CREATE_COPY.editorPublish}
              </Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, showEditorPublish, publishHeaderDisabled, openPublishConfirm, tokens]);

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
        <View style={[styles.center, { paddingHorizontal: tokens.space.lg, gap: tokens.space.md }]}>
          <StatusBlock
            kind="error"
            message={hydrateError}
            actionLabel="Retry"
            onAction={retryLoadDraft}
          />
          <ActionButton
            label={CREATE_COPY.editorBackToStudio}
            variant="quiet"
            onPress={() => router.replace('/(tabs)/create')}
          />
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
        <View style={[styles.center, { paddingHorizontal: tokens.space.lg, gap: tokens.space.md }]}>
          <Text style={[typeStyle(tokens, 'sectionTitle'), { textAlign: 'center' }]}>
            {CREATE_COPY.editorFailedTitle}
          </Text>
          <Text style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' }]}>
            {draft.extractionError?.message ?? CREATE_COPY.editorFailedBody}
          </Text>
          <ActionButton
            label={CREATE_COPY.editorRetryFind}
            variant="filled"
            pending={busy}
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
          />
          {retryError ? (
            <CreateInlineNotice
              tone="error"
              body={retryError}
              actionLabel={CREATE_COPY.feedbackDismiss}
              onAction={() => setRetryError(null)}
            />
          ) : null}
          {!sourceBlocked ? (
            <ActionButton
              label={CREATE_COPY.editorAddLinks}
              variant="outlinePrimary"
              onPress={() => setManualComposerOpen(true)}
            />
          ) : null}
          <ActionButton
            label={CREATE_COPY.editorBackToStudio}
            variant="quiet"
            onPress={() => router.replace('/(tabs)/create')}
          />
        </View>
      </CreateScreenShell>
    );
  }

  if (ingestEditorShowsProcessing(draft)) {
    return (
      <CreateScreenShell>
        <View style={[styles.center, { paddingHorizontal: tokens.space.lg, gap: tokens.space.md }]}>
          <StagedProgressIndicator
            stages={mapVideoExtractionStages(draft)}
            hint={CREATE_COPY.editorProcessingHint}
          />
          <ActionButton
            label={pollingBusy ? CREATE_COPY.editorLoading : CREATE_COPY.editorRefresh}
            variant="outlinePrimary"
            pending={pollingBusy}
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
          />
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

  const appendProductUrlsToCollection = async (urls: string[], options?: { closeComposer?: boolean }) => {
    if (!draft) return;
    if (!ingestAllowsManualProducts(draft)) {
      setManualError('Manual products are unavailable while automatic extraction is running.');
      return;
    }
    if (urls.length < 1 || urls.length > MAX_MANUAL_LINKS) {
      setManualError(`Add 1-${MAX_MANUAL_LINKS} valid product URLs.`);
      return;
    }
    setManualBusy(true);
    setManualError(null);
    try {
      const res = await appendManualProductsToIngest(draft.ingestId, urls);
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
      if (!res.noop && options?.closeComposer) {
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

  const addManualLinksToCollection = async () => {
    await appendProductUrlsToCollection(uniqueManualUrls, { closeComposer: true });
  };

  const addFromSyncedLibrary = async (sel: StudioLibrarySelection) => {
    setLibrarySelectedUrl(sel.sourceUrl);
    if (!sel.contentSourceId) {
      setManualError(CREATE_COPY.libraryUnavailable);
      return;
    }
    try {
      const { products } = await listLibraryItemProducts(sel.contentSourceId);
      const seen = new Set<string>();
      const urls: string[] = [];
      for (const product of products) {
        const normalized = normalizeHttpUrl(product.merchantUrl ?? '');
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        urls.push(normalized);
        if (urls.length >= MAX_MANUAL_LINKS) break;
      }
      if (urls.length < 1) {
        setManualError(CREATE_COPY.editorNoProductsBody);
        return;
      }
      await appendProductUrlsToCollection(urls);
      setLibraryPickerOpen(false);
    } catch (e) {
      setManualError(normalizeIngestError(e));
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
      setPublishedCoverUrl(draft.thumbnail ?? null);
      setPublishPhase('success');
      void maybePromptForPush('first_publish');
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

  const collectionTitle =
    storyTitle.trim() || draft.videoTitle?.trim() || CREATE_COPY.editorStoryTitlePlaceholder;
  const collectionMeta = [contentPlatformLabel(draft.platform), productsMeta].filter(Boolean).join(' · ');
  const readinessLine = readiness.ready
    ? CREATE_COPY.editorReadinessResolvingDone
    : CREATE_COPY.editorReadinessExpandHint;

  const headerNote = (
    <View style={{ gap: tokens.space.lg, marginBottom: tokens.space.md }}>
      <View style={{ gap: tokens.space.sm }}>
        <Text style={typeStyle(tokens, 'sectionTitle')}>{collectionTitle}</Text>
        <Text style={typeStyle(tokens, 'tileMeta')}>{collectionMeta}</Text>
        {reviewVideoWebSource ? (
          <View
            style={[
              styles.embedWrap,
              objectChrome,
              { borderRadius: tokens.radius.lg, overflow: 'hidden' },
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
        ) : draft.thumbnail ? (
          <View style={[styles.coverWrap, objectChrome, { borderRadius: tokens.radius.lg, overflow: 'hidden' }]}>
            <Image source={{ uri: draft.thumbnail }} style={styles.coverImage} contentFit="cover" />
          </View>
        ) : (
          <Text style={typeStyle(tokens, 'bodyMuted')}>
            {draft.sourceUrl || CREATE_COPY.editorReadinessContentTodo}
          </Text>
        )}
      </View>

      <View style={{ gap: tokens.space.sm }}>
        <SectionHeader title={CREATE_COPY.editorSectionProducts} subtitle={productsMeta} />

        {editorNotice ? (
          <CreateInlineNotice
            tone="error"
            body={editorNotice}
            actionLabel={CREATE_COPY.feedbackRetry}
            onAction={() => void refreshDraftFromCatalog()}
          />
        ) : null}

        {showExtractionError ? (
          <CreateInlineNotice
            tone="warning"
            title={CREATE_COPY.editorExtractionNotice}
            body={[
              draft.extractionError?.message ?? 'These rows are previews only. Fix the issue and try again.',
              draft.extractionError?.detail,
            ]
              .filter(Boolean)
              .join('\n')}
          />
        ) : null}
        {needsManualProducts ? (
          <CreateInlineNotice
            tone="info"
            title={CREATE_COPY.editorNoProductsTitle}
            body={draft.extractionError?.message ?? CREATE_COPY.editorNoProductsBody}
            actionLabel={CREATE_COPY.editorAddLinksAction}
            onAction={() => setManualComposerOpen(true)}
          />
        ) : null}

        {ingestAllowsManualProducts(draft) && manualComposerOpen ? (
          <View
            style={[
              objectChrome,
              {
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: tokens.radius.md,
                padding: tokens.space.md,
                gap: tokens.space.sm,
              },
            ]}
          >
            <Text style={typeStyle(tokens, 'tileTitle')}>{CREATE_COPY.editorPasteProductLink}</Text>
            <Text style={[typeStyle(tokens, 'bodyMuted'), { fontSize: tokens.fontSize.caption }]}>
              Add up to {MAX_MANUAL_LINKS} product URLs for this Collection.
            </Text>
            {manualRows.map((row, idx) => (
              <View key={`manual-row-${idx}`} style={styles.manualRowWrap}>
                <View
                  style={[
                    styles.fieldRow,
                    {
                      flex: 1,
                      backgroundColor: field.backgroundColor,
                      borderColor: field.borderColor,
                      borderRadius: tokens.radius.lg,
                    },
                  ]}
                >
                  <TextInput
                    value={row}
                    onChangeText={(value) => updateManualRow(idx, value)}
                    placeholder={`Product URL ${idx + 1}`}
                    placeholderTextColor={field.placeholderTextColor}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={[
                      styles.fieldInput,
                      {
                        color: field.color,
                        fontFamily: tokens.fontFamily.regular,
                        fontSize: tokens.fontSize.body,
                      },
                    ]}
                  />
                </View>
                {manualRows.length > 1 ? (
                  <Pressable
                    onPress={() => removeManualRow(idx)}
                    accessibilityRole="button"
                    accessibilityLabel="Remove link"
                    style={({ pressed }) => ({ opacity: pressed ? tokens.motion.pressOpacity : 1 })}
                  >
                    <Ionicons name="close-outline" size={22} color={tokens.color.danger} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {manualRows.length < MAX_MANUAL_LINKS ? (
              <ActionButton label="+ Add another link" variant="quiet" size="compact" onPress={addManualRow} />
            ) : null}
            {manualError ? (
              <Text style={[typeStyle(tokens, 'tileMeta'), { color: tokens.color.danger }]}>{manualError}</Text>
            ) : null}
            <ActionButton
              label="Add products"
              variant="outlinePrimary"
              size="compact"
              pending={manualBusy}
              disabled={manualBusy}
              onPress={() => void addManualLinksToCollection()}
            />
            <ActionButton
              label="Cancel"
              variant="quiet"
              size="compact"
              disabled={manualBusy}
              onPress={() => {
                setManualComposerOpen(false);
                setManualError(null);
                setManualRows(['']);
              }}
            />
            {manualBusy ? <StagedProgressIndicator stages={mapManualProductLinkStages(0)} /> : null}
          </View>
        ) : ingestAllowsManualProducts(draft) ? (
          <View style={{ gap: tokens.space.sm }}>
            <ActionChoiceRow
              icon="link-outline"
              title={CREATE_COPY.editorPasteProductLink}
              body={CREATE_COPY.productSourceLinkBody}
              onPress={() => {
                setLibraryPickerOpen(false);
                setManualComposerOpen(true);
              }}
            />
            <ActionChoiceRow
              icon="albums-outline"
              title={CREATE_COPY.editorAddFromLibrary}
              body={CREATE_COPY.libraryStepSub}
              selected={libraryPickerOpen}
              pending={manualBusy && libraryPickerOpen}
              onPress={() => {
                setManualComposerOpen(false);
                setLibraryPickerOpen((open) => !open);
              }}
            />
            {libraryPickerOpen ? (
              <CreateStudioLibraryPicker
                selectedUrl={librarySelectedUrl}
                onSelect={(sel) => void addFromSyncedLibrary(sel)}
              />
            ) : null}
            {manualError && !manualComposerOpen ? (
              <Text style={[typeStyle(tokens, 'tileMeta'), { color: tokens.color.danger }]}>{manualError}</Text>
            ) : null}
          </View>
        ) : null}
        <Text style={[typeStyle(tokens, 'bodyMuted'), { fontSize: tokens.fontSize.caption }]}>
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
    <View style={{ gap: tokens.space.lg, marginTop: tokens.space.md, paddingBottom: tokens.space.md }}>
      <View style={{ gap: tokens.space.sm }}>
        <Pressable
          onPress={() => setStoryOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: storyOpen }}
          accessibilityLabel={CREATE_COPY.editorSectionStory}
          style={({ pressed }) => [
            styles.discloseRow,
            { opacity: pressed ? tokens.motion.pressOpacity : 1 },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={typeStyle(tokens, 'sectionTitle')}>{CREATE_COPY.editorSectionStory}</Text>
            <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
              {storyOpen
                ? CREATE_COPY.editorSectionStoryOptional
                : storyTitle.trim() || CREATE_COPY.editorStoryTitlePlaceholder}
            </Text>
          </View>
          <Ionicons
            name={storyOpen ? 'chevron-down-outline' : 'chevron-forward-outline'}
            size={16}
            color={tokens.color.textMuted}
          />
        </Pressable>
        {storyOpen ? (
          <View style={{ gap: tokens.space.sm }}>
            <Text style={typeStyle(tokens, 'tileTitle')}>{CREATE_COPY.editorStoryTitleLabel}</Text>
            <View
              style={[
                styles.fieldRow,
                {
                  backgroundColor: field.backgroundColor,
                  borderColor: field.borderColor,
                  borderRadius: tokens.radius.lg,
                },
              ]}
            >
              <TextInput
                value={storyTitle}
                onChangeText={setStoryTitle}
                onEndEditing={() => void persistStoryTitle()}
                placeholder={CREATE_COPY.editorStoryTitlePlaceholder}
                placeholderTextColor={field.placeholderTextColor}
                style={[
                  styles.fieldInput,
                  {
                    color: field.color,
                    fontFamily: tokens.fontFamily.regular,
                    fontSize: tokens.fontSize.body,
                  },
                ]}
              />
            </View>
            {storyTitleError ? (
              <CreateInlineNotice
                tone="error"
                body={storyTitleError}
                actionLabel={CREATE_COPY.feedbackDismiss}
                onAction={() => setStoryTitleError(null)}
              />
            ) : null}
            <Text style={typeStyle(tokens, 'tileTitle')}>{CREATE_COPY.editorStoryCaptionLabel}</Text>
            <View
              style={[
                styles.fieldRow,
                styles.fieldRowMultiline,
                {
                  backgroundColor: field.backgroundColor,
                  borderColor: field.borderColor,
                  borderRadius: tokens.radius.lg,
                },
              ]}
            >
              <TextInput
                value={storyCaption}
                onChangeText={setStoryCaption}
                placeholder={CREATE_COPY.editorStoryCaptionPlaceholder}
                placeholderTextColor={field.placeholderTextColor}
                multiline
                style={[
                  styles.fieldInput,
                  {
                    color: field.color,
                    fontFamily: tokens.fontFamily.regular,
                    fontSize: tokens.fontSize.body,
                    minHeight: 72,
                    textAlignVertical: 'top',
                  },
                ]}
              />
            </View>
            <Text style={[typeStyle(tokens, 'tileMeta')]}>{CREATE_COPY.editorStoryCaptionHint}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: tokens.color.divider }} />
      <View style={{ gap: tokens.space.sm }}>
        <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={2}>
          {readinessLine}
        </Text>
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
        <ActionButton
          label={CREATE_COPY.editorDiscard}
          variant="quiet"
          disabled={busy || publishPhase !== 'idle'}
          onPress={() => void onRejectAll()}
        />
      </View>
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
      <PublishConfirmSheet
        visible={publishPhase === 'confirm' || publishPhase === 'publishing'}
        summary={publishSummary}
        publishing={publishPhase === 'publishing'}
        onConfirm={() => void confirmPublish()}
        onCancel={closePublishConfirm}
      />
      <PublishSuccessScreen
        visible={publishPhase === 'success'}
        layout="editor"
        coverUrl={publishedCoverUrl}
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  list: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40, gap: 12 },
  embedWrap: {
    width: '100%',
    height: 220,
    borderWidth: StyleSheet.hairlineWidth,
  },
  embedWeb: { flex: 1, backgroundColor: '#000' },
  coverWrap: {
    width: '100%',
    height: 180,
    borderWidth: StyleSheet.hairlineWidth,
  },
  coverImage: { width: '100%', height: '100%' },
  discloseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  fieldRowMultiline: {
    alignItems: 'flex-start',
    minHeight: 80,
    paddingVertical: 8,
  },
  fieldInput: {
    flex: 1,
    paddingVertical: 10,
  },
  manualRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
