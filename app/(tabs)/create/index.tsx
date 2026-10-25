import { useAuth } from '@/contexts/AuthContext';
import { CreatorOnboardingPanel } from '@/components/creator/CreatorOnboardingPanel';
import { CreateInlineNotice } from '@/components/create/CreateInlineNotice';
import { CreateScreenShell } from '@/components/create/CreateScreenShell';
import { CreateSignedOutState } from '@/components/create/CreateSignedOutState';
import { CreateStudioLibraryPicker } from '@/components/create/CreateStudioLibraryPicker';
import { CreateStudioStage, configureStudioStageAnimation } from '@/components/create/CreateStudioStage';
import { CreateStudioStepper } from '@/components/create/CreateStudioStepper';
import { StagedProgressIndicator } from '@/components/create/StagedProgressIndicator';
import { PublishSuccessScreen } from '@/components/create/PublishSuccessScreen';
import { StatusBlock } from '@/components/status/StatusBlock';
import { ActionButton } from '@/components/ui/ActionButton';
import { ActionChoiceRow } from '@/components/ui/ActionChoiceRow';
import { Text } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import {
  appendManualProductsToIngest,
  INGEST_ASYNC_POLL_INTERVAL_MS,
  listUserDraftIngests,
  loadOrResumeIngestDraft,
  normalizeIngestError,
  publishIngestSelection,
  rejectIngestRequest,
  submitIngestUrl,
  submitManualProductLinks,
  updateIngestVideoTitle,
  type UserDraftIngestSummary,
} from '@/src/services/curation';
import { ensureMe, type UserSettingsViewModel } from '@/src/services/userApi';
import { outlineCardChrome } from '@/src/theme/tokens';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { typeStyle } from '@/src/theme/typography';
import { CREATE_COPY, draftResumeStatusLabel } from '@/src/ui/createCopy';
import { createFieldColors } from '@/src/ui/createChrome';
import { segmentCreateDrafts, type CreateDraftSegment } from '@/src/ui/createDraftSegments';
import { createPartialProductLinksMessage, createUnsupportedUrlFieldError } from '@/src/ui/createFeedback';
import { selectedProductsCanPublish } from '@/src/services/reviewResolution';
import { ingestEditorShowsProcessing } from '@/src/ui/createHandoff';
import { mapManualProductLinkStages, mapVideoExtractionStages } from '@/src/ui/ingestProgressStages';
import {
  abandonCreateFlow,
  completeCreateFlow,
  exitCreateFlowAfterSuccess,
  exitCreateFlowToCollection,
  exitCreateFlowToCreateAnother,
  useCreateFlowReset,
} from '@/src/state/createFlowSession';
import { removeCurationDraft } from '@/src/state/curationDraftStore';
import { requestFeedReload } from '@/src/services/feedRefresh';
import { maybePromptForPush } from '@/src/notifications/permissionPrompt';
import {
  publishProductCountLabel,
  resolvePublishSuccessCollectionId,
} from '@/src/ui/createPublishRitual';
import { useAppToast } from '@/src/ui/useAppToast';
import { usePrefersReducedMotion } from '@/src/ui/usePrefersReducedMotion';
import {
  normalizeProductHttpUrl,
  studioActiveStepFromScroll,
  studioDefaultIncludeExtracted,
  studioExtractedProducts,
  studioIncludedExtractedProducts,
  studioPlatformLabel,
  studioProductSourceLabel,
  studioProductsSummaryLabel,
  studioRelativeTime,
  studioShowsNoProductsFound,
  studioStageExpanded,
  studioStepUnlocked,
  type StudioProductSource,
  type StudioStepId,
} from '@/src/ui/createStudioFlow';
import type { DraftProduct, IngestDraftPayload } from '@/src/types/curation';
import { detectPlatform, isSupportedVideoUrl } from '@/src/utils/videoUtils';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

type SelectedVideo = {
  sourceUrl: string;
  title?: string;
  thumbnail?: string;
  platform?: string;
};

export default function CreateSubmitScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const tokens = useThemeTokens();
  const { showToast } = useAppToast();
  const reduceMotion = usePrefersReducedMotion();

  const [me, setMe] = useState<UserSettingsViewModel | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [resumeDrafts, setResumeDrafts] = useState<UserDraftIngestSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);

  const [pasteUrl, setPasteUrl] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [draft, setDraft] = useState<IngestDraftPayload | undefined>();
  const [selectedProducts, setSelectedProducts] = useState<Record<string, boolean>>({});
  const [productSources, setProductSources] = useState<Record<string, StudioProductSource>>({});
  const [linkUrl, setLinkUrl] = useState('');
  const [linkComposerOpen, setLinkComposerOpen] = useState(false);
  const [storyTitle, setStoryTitle] = useState('');
  const [storyCaption, setStoryCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<StudioStepId>('video');
  const [publishPhase, setPublishPhase] = useState<'idle' | 'publishing' | 'success'>('idle');
  const [publishedCollectionId, setPublishedCollectionId] = useState<string | null>(null);
  const [publishedTitle, setPublishedTitle] = useState('');
  const [publishedProductCount, setPublishedProductCount] = useState(0);

  const scrollRef = useRef<ScrollView>(null);
  const spyLock = useRef(false);
  const stickyHeight = useRef(56);
  const sectionYs = useRef<Partial<Record<StudioStepId, number>>>({});
  const pendingFocus = useRef<StudioStepId | null>(null);

  const isActiveCreator = me?.creatorStatus === 'ACTIVE';
  const pasteValid = isSupportedVideoUrl(pasteUrl.trim());
  const pasteField = createFieldColors(tokens, { invalid: Boolean(pasteUrl.trim()) && !pasteValid });
  const titleField = createFieldColors(tokens);
  const productField = createFieldColors(tokens);
  const hasVideo = Boolean(selectedVideo?.sourceUrl);
  const extractedProducts = useMemo(
    () => studioExtractedProducts(draft?.products),
    [draft?.products],
  );
  const includedProducts = useMemo(
    () => studioIncludedExtractedProducts(extractedProducts, selectedProducts),
    [extractedProducts, selectedProducts],
  );
  const hasProducts = includedProducts.length > 0;
  const progress = { hasVideo, hasProducts };
  const canPublish = Boolean(draft && selectedProductsCanPublish(draft.products, selectedProducts));
  const processing = Boolean(draft && ingestEditorShowsProcessing(draft));
  const urlFieldError = createUnsupportedUrlFieldError(pasteUrl, pasteValid);
  const productsLocked = !hasVideo;
  const publishLocked = !hasProducts;
  const segmentedDrafts = useMemo(() => segmentCreateDrafts(resumeDrafts), [resumeDrafts]);

  const refreshMe = useCallback(() => {
    if (!user) {
      setMe(null);
      return;
    }
    setMeLoading(true);
    ensureMe()
      .then(setMe)
      .catch(() => {
        setMe(null);
      })
      .finally(() => setMeLoading(false));
  }, [user]);

  const refreshResumeList = useCallback(() => {
    if (!user) return;
    setDraftsLoading(true);
    listUserDraftIngests()
      .then(setResumeDrafts)
      .finally(() => setDraftsLoading(false));
  }, [user]);

  useCreateFlowReset(
    useCallback(() => {
      setPasteUrl('');
      setSelectedVideo(null);
      setDraft(undefined);
      setSelectedProducts({});
      setProductSources({});
      setLinkUrl('');
      setLinkComposerOpen(false);
      setStoryTitle('');
      setStoryCaption('');
      setBusy(false);
      setExtracting(false);
      setAddingLink(false);
      setFormError(null);
      setActiveStep('video');
      setPublishPhase('idle');
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      refreshMe();
      refreshResumeList();
    }, [refreshMe, refreshResumeList]),
  );

  useEffect(() => {
    if (!draft?.ingestId || !draft.products?.length) return;
    setSelectedProducts((prev) => {
      const next: Record<string, boolean> = {};
      const defaultOn = studioDefaultIncludeExtracted(draft);
      for (const product of draft.products) {
        if (!product.id) continue;
        next[product.id] = prev[product.id] !== undefined ? prev[product.id]! : defaultOn;
      }
      return next;
    });
  }, [draft, draft?.ingestId, draft?.products, draft?.extractionStatus, draft?.extractionSource]);

  useEffect(() => {
    if (!draft?.ingestId) return;
    setStoryTitle((prev) => prev || draft.videoTitle || selectedVideo?.title || '');
  }, [draft?.ingestId, draft?.videoTitle, selectedVideo?.title]);

  useEffect(() => {
    if (!draft?.ingestId) return;
    let cancelled = false;
    const tick = () => {
      void loadOrResumeIngestDraft(draft.ingestId)
        .then((next) => {
          if (!cancelled && next) {
            setDraft(next);
            if (next.thumbnail || next.videoTitle) {
              setSelectedVideo((prev) =>
                prev
                  ? {
                      ...prev,
                      thumbnail: next.thumbnail || prev.thumbnail,
                      title: next.videoTitle || prev.title,
                      platform: next.platform || prev.platform,
                    }
                  : prev,
              );
            }
          }
        })
        .catch(() => undefined);
    };
    tick();
    if (!ingestEditorShowsProcessing(draft)) {
      return () => {
        cancelled = true;
      };
    }
    const interval = setInterval(tick, INGEST_ASYNC_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [draft?.ingestId, draft?.status, draft?.extractionPending, draft?.products.length]);

  const scrollToStep = useCallback(
    (step: StudioStepId) => {
      if (!studioStepUnlocked(step, { hasVideo, hasProducts })) return;
      configureStudioStageAnimation(reduceMotion);
      const y = sectionYs.current[step];
      spyLock.current = true;
      setActiveStep(step);
      if (typeof y === 'number') {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - stickyHeight.current), animated: !reduceMotion });
      }
      setTimeout(() => {
        spyLock.current = false;
      }, reduceMotion ? 50 : 420);
    },
    [hasProducts, hasVideo, reduceMotion],
  );

  const applyVideo = (video: SelectedVideo) => {
    setFormError(null);
    setSelectedVideo(video);
    setDraft(undefined);
    setSelectedProducts({});
    setProductSources({});
    setLinkComposerOpen(false);
    setStoryTitle(video.title ?? '');
    configureStudioStageAnimation(reduceMotion);
    pendingFocus.current = 'products';
    setActiveStep('products');
  };

  useEffect(() => {
    if (!hasProducts || !canPublish) return;
    configureStudioStageAnimation(reduceMotion);
    pendingFocus.current = 'publish';
    setActiveStep('publish');
  }, [canPublish, hasProducts, reduceMotion]);

  useEffect(() => {
    const step = pendingFocus.current;
    if (!step) return;
    const timer = setTimeout(() => {
      pendingFocus.current = null;
      scrollToStep(step);
    }, 60);
    return () => clearTimeout(timer);
  }, [activeStep, hasProducts, hasVideo, scrollToStep]);

  const tagNewProducts = (products: DraftProduct[], source: StudioProductSource) => {
    setProductSources((prev) => {
      const next = { ...prev };
      for (const product of products) {
        if (product.id && next[product.id] === undefined) next[product.id] = source;
      }
      return next;
    });
  };

  const onFindWithAi = async () => {
    setFormError(null);
    if (!isActiveCreator) {
      setFormError(CREATE_COPY.creatorRequiredBody);
      return;
    }
    const url = selectedVideo?.sourceUrl.trim();
    if (!url || !isSupportedVideoUrl(url)) {
      setFormError(CREATE_COPY.unsupportedUrlBody);
      return;
    }
    setExtracting(true);
    try {
      const res = await submitIngestUrl(url, {
        videoTitle: (storyTitle.trim() || selectedVideo?.title)?.slice(0, 200),
        productAcquisition: 'automatic',
      });
      if (!res.ingestId) {
        setFormError(CREATE_COPY.startFailedBody);
        return;
      }
      const hydrated = await loadOrResumeIngestDraft(res.ingestId);
      const next = hydrated ?? res.draft;
      if (next) {
        setDraft(next);
        tagNewProducts(next.products, 'ai');
        setSelectedVideo((prev) =>
          prev
            ? {
                ...prev,
                thumbnail: next.thumbnail || prev.thumbnail,
                title: next.videoTitle || prev.title,
                platform: next.platform || prev.platform,
              }
            : prev,
        );
      }
      refreshResumeList();
    } catch (e) {
      const msg = (e as Error).message ?? CREATE_COPY.startFailedBody;
      if (/Creator status ACTIVE required/i.test(msg)) {
        refreshMe();
        setFormError(CREATE_COPY.creatorRequiredSetupBody);
      } else {
        setFormError(normalizeIngestError(e) || CREATE_COPY.startFailedBody);
      }
    } finally {
      setExtracting(false);
    }
  };

  const onAddProductLink = async () => {
    setFormError(null);
    const productUrl = normalizeProductHttpUrl(linkUrl);
    if (!productUrl) {
      setFormError(CREATE_COPY.manualSaveFailedInline);
      return;
    }
    const videoUrl = selectedVideo?.sourceUrl.trim();
    if (!videoUrl) return;
    setAddingLink(true);
    try {
      if (draft?.ingestId) {
        const res = await appendManualProductsToIngest(draft.ingestId, [productUrl]);
        if (res.draft) {
          setDraft(res.draft);
          tagNewProducts(res.draft.products, 'link');
        }
        const partial = createPartialProductLinksMessage(res.failedProductUrls ?? []);
        if (partial) setFormError(partial);
      } else {
        const res = await submitManualProductLinks(videoUrl, [productUrl], {
          videoTitle: (storyTitle.trim() || selectedVideo?.title)?.slice(0, 200),
        });
        if (!res.ingestId || !res.draft) {
          setFormError(CREATE_COPY.manualSaveFailedInline);
          return;
        }
        setDraft(res.draft);
        tagNewProducts(res.draft.products, 'link');
        const partial = createPartialProductLinksMessage(res.failedProductUrls ?? []);
        if (partial) setFormError(partial);
      }
      setLinkUrl('');
      refreshResumeList();
    } catch (e) {
      setFormError(normalizeIngestError(e) || CREATE_COPY.manualSaveFailedInline);
    } finally {
      setAddingLink(false);
    }
  };

  const onDiscard = () => {
    Alert.alert(CREATE_COPY.editorDiscardConfirmTitle, CREATE_COPY.editorDiscardConfirmBody, [
      { text: CREATE_COPY.feedbackDismiss, style: 'cancel' },
      {
        text: CREATE_COPY.discardCollection,
        style: 'destructive',
        onPress: () => {
          const current = draft;
          if (current) {
            void rejectIngestRequest(current.ingestId, current).finally(() => {
              removeCurationDraft(current.ingestId);
            });
          }
          abandonCreateFlow();
        },
      },
    ]);
  };

  const onPublish = async () => {
    if (!draft) return;
    if (!canPublish) {
      setFormError(
        processing || !selectedProductsCanPublish(draft.products, selectedProducts)
          ? CREATE_COPY.editorPublishResolvingBody
          : CREATE_COPY.editorPublishSelectBody,
      );
      return;
    }
    const ids = draft.products.filter((p) => p.id && selectedProducts[p.id]).map((p) => p.id);
    setBusy(true);
    setPublishPhase('publishing');
    setFormError(null);
    try {
      const title = storyTitle.trim();
      if (title && title !== (draft.videoTitle ?? '').trim()) {
        await updateIngestVideoTitle(draft.ingestId, title);
      }
      const res = await publishIngestSelection(draft.ingestId, ids, {
        ...draft,
        videoTitle: title || draft.videoTitle,
      });
      if (!res.ok) {
        setPublishPhase('idle');
        setFormError(res.error ?? CREATE_COPY.publishFailedInline);
        return;
      }
      removeCurationDraft(draft.ingestId);
      completeCreateFlow();
      requestFeedReload();
      setPublishedCollectionId(resolvePublishSuccessCollectionId(res.collectionId));
      setPublishedTitle(title || draft.videoTitle || 'Untitled Collection');
      setPublishedProductCount(ids.length);
      setPublishPhase('success');
      void maybePromptForPush('first_publish');
    } catch (e) {
      setPublishPhase('idle');
      setFormError(normalizeIngestError(e) || CREATE_COPY.publishFailedInline);
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || (user && meLoading && !me)) {
    return (
      <CreateScreenShell>
        <StatusBlock kind="loading" message={CREATE_COPY.editorLoading} fill />
      </CreateScreenShell>
    );
  }

  if (!user) {
    return (
      <CreateScreenShell>
        <CreateSignedOutState onGoToProfile={() => router.replace('/(tabs)/profile')} />
      </CreateScreenShell>
    );
  }

  if (!isActiveCreator) {
    return (
      <CreateScreenShell>
        <CreatorOnboardingPanel
          onActivated={(next) => {
            setMe(next);
            showToast({ tone: 'success', title: CREATE_COPY.creatorActivatedToast });
          }}
          onAlreadyActive={setMe}
          onCancel={() => void refreshMe()}
        />
      </CreateScreenShell>
    );
  }

  return (
    <CreateScreenShell>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={(event) => {
          if (spyLock.current) return;
          const probe = event.nativeEvent.contentOffset.y + stickyHeight.current + 12;
          const next = studioActiveStepFromScroll(probe, sectionYs.current);
          if (!studioStepUnlocked(next, progress) || next === activeStep) return;
          configureStudioStageAnimation(reduceMotion);
          setActiveStep(next);
        }}
        contentContainerStyle={{ paddingBottom: tokens.space.xxl }}
      >
        <View
          onLayout={(event) => {
            stickyHeight.current = event.nativeEvent.layout.height;
          }}
        >
          <CreateStudioStepper active={activeStep} progress={progress} onPressStep={scrollToStep} />
        </View>

        <View
          onLayout={(event) => {
            sectionYs.current.video = event.nativeEvent.layout.y;
          }}
        >
          <CreateStudioStage
            step="video"
            expanded={studioStageExpanded('video', activeStep)}
            locked={false}
            progress={progress}
            active={activeStep}
            summary={selectedVideo?.title || selectedVideo?.sourceUrl || CREATE_COPY.videoStageSub}
            subhead={CREATE_COPY.videoStageSub}
            onPressHeader={() => scrollToStep('video')}
          >
            <Text style={[typeStyle(tokens, 'tileTitle'), { color: tokens.color.textMuted }]}>
              {CREATE_COPY.addVideoFrom}
            </Text>
            <Text style={typeStyle(tokens, 'tileTitle')}>{CREATE_COPY.libraryStepTitle}</Text>
            <CreateStudioLibraryPicker selectedUrl={selectedVideo?.sourceUrl} onSelect={applyVideo} />

            <Text
              style={[
                typeStyle(tokens, 'identityBrand'),
                { marginTop: tokens.space.xs },
              ]}
            >
              {CREATE_COPY.pasteUrlAlt}
            </Text>
            <View
              style={[
                styles.fieldRow,
                {
                  backgroundColor: pasteField.backgroundColor,
                  borderColor: pasteField.borderColor,
                  borderRadius: tokens.radius.lg,
                },
              ]}
            >
              <Ionicons name="link-outline" size={18} color={tokens.color.textMuted} />
              <TextInput
                value={pasteUrl}
                onChangeText={(value) => {
                  setPasteUrl(value);
                  setFormError(null);
                }}
                placeholder={CREATE_COPY.pasteUrlTitle}
                placeholderTextColor={pasteField.placeholderTextColor}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={[
                  styles.fieldInput,
                  {
                    color: pasteField.color,
                    fontFamily: tokens.fontFamily.regular,
                    fontSize: tokens.fontSize.body,
                    lineHeight: tokens.lineHeight.body,
                  },
                ]}
              />
            </View>
            {urlFieldError ? (
              <CreateInlineNotice
                tone="error"
                title={CREATE_COPY.unsupportedUrlTitle}
                body={`${urlFieldError} ${CREATE_COPY.urlExamplesHint}`}
              />
            ) : null}
            {pasteValid ? (
              <ActionButton
                label={CREATE_COPY.usePastedUrl}
                variant="outlinePrimary"
                size="compact"
                trailingIcon="chevron-forward-outline"
                onPress={() =>
                  applyVideo({
                    sourceUrl: pasteUrl.trim(),
                    platform: detectPlatform(pasteUrl.trim()) ?? undefined,
                  })
                }
              />
            ) : null}

            {selectedVideo ? (
              <View
                style={[
                  styles.previewRow,
                  objectSurface(tokens),
                  { gap: tokens.space.sm, padding: tokens.space.sm },
                ]}
              >
                {selectedVideo.thumbnail ? (
                  <Image source={{ uri: selectedVideo.thumbnail }} style={styles.previewThumb} contentFit="cover" />
                ) : (
                  <View style={[styles.previewThumb, { backgroundColor: tokens.color.canvasEnd }]} />
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={typeStyle(tokens, 'tilePrice')}>{CREATE_COPY.videoSelectedBadge}</Text>
                  <Text numberOfLines={2} style={typeStyle(tokens, 'tileTitle')}>
                    {selectedVideo.title || selectedVideo.sourceUrl}
                  </Text>
                  <Text style={typeStyle(tokens, 'tileMeta')}>{studioPlatformLabel(selectedVideo.platform)}</Text>
                </View>
                <Pressable
                  onPress={() => {
                    configureStudioStageAnimation(reduceMotion);
                    setSelectedVideo(null);
                    setDraft(undefined);
                    setSelectedProducts({});
                    setProductSources({});
                    setLinkComposerOpen(false);
                    setFormError(null);
                    setActiveStep('video');
                  }}
                  accessibilityRole="button"
                >
                  <Text style={[typeStyle(tokens, 'link'), { color: tokens.color.textMuted }]}>
                    {CREATE_COPY.changeVideo}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <ActionButton
              label={CREATE_COPY.continueToProducts}
              variant="filled"
              size="compact"
              trailingIcon="chevron-forward-outline"
              disabled={!hasVideo}
              onPress={() => scrollToStep('products')}
            />
          </CreateStudioStage>
        </View>

        <View
          onLayout={(event) => {
            sectionYs.current.products = event.nativeEvent.layout.y;
          }}
        >
          <CreateStudioStage
            step="products"
            expanded={studioStageExpanded('products', activeStep)}
            locked={productsLocked}
            progress={progress}
            active={activeStep}
            summary={`${CREATE_COPY.productsStageSub} · ${studioProductsSummaryLabel(includedProducts.length)}`}
            subhead={CREATE_COPY.productsStageSub}
            onPressHeader={() => scrollToStep('products')}
          >
            <ActionChoiceRow
              icon="sparkles-outline"
              title={CREATE_COPY.productSourceAiTitle}
              body={CREATE_COPY.productSourceAiBody}
              onPress={() => void onFindWithAi()}
              pending={extracting}
              selected={extracting}
              disabled={extracting || addingLink}
            />
            {extracting || processing ? (
              <StagedProgressIndicator
                stages={draft ? mapVideoExtractionStages(draft) : mapManualProductLinkStages(0)}
                hint={CREATE_COPY.editorProcessingHint}
              />
            ) : null}

            <ActionChoiceRow
              icon="link-outline"
              title={CREATE_COPY.productSourceLinkTitle}
              body={CREATE_COPY.productSourceLinkBody}
              onPress={() => setLinkComposerOpen(true)}
              selected={linkComposerOpen}
              disabled={extracting || addingLink || processing}
            />
            {linkComposerOpen ? (
              <View style={{ gap: tokens.space.xs }}>
                <View
                  style={[
                    styles.fieldRow,
                    {
                      backgroundColor: productField.backgroundColor,
                      borderColor: tokens.color.border,
                      borderRadius: tokens.radius.lg,
                    },
                  ]}
                >
                  <Ionicons name="link-outline" size={18} color={tokens.color.textMuted} />
                  <TextInput
                    value={linkUrl}
                    onChangeText={setLinkUrl}
                    placeholder={CREATE_COPY.productSourceLinkPlaceholder}
                    placeholderTextColor={productField.placeholderTextColor}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={[
                      styles.fieldInput,
                      {
                        color: productField.color,
                        fontFamily: tokens.fontFamily.regular,
                        fontSize: tokens.fontSize.body,
                        lineHeight: tokens.lineHeight.body,
                      },
                    ]}
                  />
                </View>
                <ActionButton
                  label={CREATE_COPY.productSourceLinkAction}
                  variant="outlinePrimary"
                  size="compact"
                  pending={addingLink}
                  disabled={!normalizeProductHttpUrl(linkUrl) || addingLink}
                  trailingIcon="chevron-forward-outline"
                  onPress={() => void onAddProductLink()}
                />
              </View>
            ) : null}

            <ActionChoiceRow
              icon="cube-outline"
              title={CREATE_COPY.productSourceInventoryTitle}
              body={CREATE_COPY.productSourceInventoryBody}
              badge={CREATE_COPY.productSourceInventorySoon}
              locked
            />

            {includedProducts.length > 0 ? (
              <View style={{ gap: tokens.space.sm }}>
                {includedProducts.map((product) => (
                  <View
                    key={product.id}
                    style={[styles.previewRow, objectSurface(tokens), { padding: tokens.space.sm }]}
                  >
                    {product.image ? (
                      <Image source={{ uri: product.image }} style={styles.productThumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.productThumb, { backgroundColor: tokens.color.canvasEnd }]} />
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text numberOfLines={2} style={typeStyle(tokens, 'tileTitle')}>
                        {product.name}
                      </Text>
                      <Text style={typeStyle(tokens, 'tileMeta')}>
                        {studioProductSourceLabel(productSources[product.id])}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setSelectedProducts((prev) => ({ ...prev, [product.id]: false }))}
                      accessibilityRole="button"
                      accessibilityLabel={CREATE_COPY.libraryRemoveProduct}
                    >
                      <Text style={[typeStyle(tokens, 'link'), { color: tokens.color.textMuted }]}>
                        {CREATE_COPY.libraryRemoveProduct}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : studioShowsNoProductsFound({
                hasDraft: Boolean(draft),
                processing,
                extracting,
                extractedCount: extractedProducts.length,
              }) ? (
              <Text style={typeStyle(tokens, 'bodyMuted')}>{CREATE_COPY.editorNoProductsBody}</Text>
            ) : null}

            {formError && studioStageExpanded('products', activeStep) ? (
              <CreateInlineNotice
                tone="error"
                body={formError}
                actionLabel={CREATE_COPY.feedbackDismiss}
                onAction={() => setFormError(null)}
              />
            ) : null}

            <ActionButton
              label={CREATE_COPY.continueToPublish}
              variant="filled"
              size="compact"
              trailingIcon="chevron-forward-outline"
              disabled={!hasProducts}
              onPress={() => scrollToStep('publish')}
            />
          </CreateStudioStage>
        </View>

        <View
          onLayout={(event) => {
            sectionYs.current.publish = event.nativeEvent.layout.y;
          }}
        >
          <CreateStudioStage
            step="publish"
            expanded={studioStageExpanded('publish', activeStep)}
            locked={publishLocked}
            progress={progress}
            active={activeStep}
            summary={CREATE_COPY.publishStageSub}
            subhead={CREATE_COPY.publishStageSub}
            onPressHeader={() => scrollToStep('publish')}
          >
            <Text style={typeStyle(tokens, 'tileMeta')}>{CREATE_COPY.collectionPreviewLabel}</Text>
            <View
              style={[
                styles.previewRow,
                objectSurface(tokens),
                { alignItems: 'flex-start', padding: tokens.space.sm },
              ]}
            >
              {selectedVideo?.thumbnail ? (
                <Image source={{ uri: selectedVideo.thumbnail }} style={styles.previewThumb} contentFit="cover" />
              ) : (
                <View style={[styles.previewThumb, { backgroundColor: tokens.color.canvasEnd }]} />
              )}
              <View style={{ flex: 1, gap: 6 }}>
                <Text numberOfLines={2} style={typeStyle(tokens, 'tileTitle')}>
                  {storyTitle || selectedVideo?.title || selectedVideo?.sourceUrl}
                </Text>
                <Text style={typeStyle(tokens, 'tileMeta')}>{studioProductsSummaryLabel(includedProducts.length)}</Text>
                <View style={styles.previewThumbs}>
                  {includedProducts.slice(0, 4).map((product) =>
                    product.image ? (
                      <Image
                        key={product.id}
                        source={{ uri: product.image }}
                        style={styles.miniThumb}
                        contentFit="cover"
                      />
                    ) : (
                      <View key={product.id} style={[styles.miniThumb, { backgroundColor: tokens.color.canvasEnd }]} />
                    ),
                  )}
                </View>
              </View>
            </View>

            <Text style={typeStyle(tokens, 'tileTitle')}>{CREATE_COPY.editorStoryTitleLabel}</Text>
            <View
              style={[
                styles.fieldRow,
                {
                  backgroundColor: titleField.backgroundColor,
                  borderColor: titleField.borderColor,
                  borderRadius: tokens.radius.lg,
                },
              ]}
            >
              <TextInput
                value={storyTitle}
                onChangeText={setStoryTitle}
                placeholder={CREATE_COPY.editorStoryTitlePlaceholder}
                placeholderTextColor={titleField.placeholderTextColor}
                autoCapitalize="sentences"
                maxLength={200}
                style={[
                  styles.fieldInput,
                  {
                    color: titleField.color,
                    fontFamily: tokens.fontFamily.regular,
                    fontSize: tokens.fontSize.body,
                    lineHeight: tokens.lineHeight.body,
                  },
                ]}
              />
            </View>
            <Text style={typeStyle(tokens, 'tileTitle')}>{CREATE_COPY.studioDescriptionLabel}</Text>
            <View
              style={[
                styles.fieldRow,
                styles.fieldRowMultiline,
                {
                  backgroundColor: titleField.backgroundColor,
                  borderColor: titleField.borderColor,
                  borderRadius: tokens.radius.lg,
                },
              ]}
            >
              <TextInput
                value={storyCaption}
                onChangeText={setStoryCaption}
                placeholder={CREATE_COPY.studioDescriptionPlaceholder}
                placeholderTextColor={titleField.placeholderTextColor}
                autoCapitalize="sentences"
                multiline
                style={[
                  styles.fieldInput,
                  {
                    color: titleField.color,
                    fontFamily: tokens.fontFamily.regular,
                    fontSize: tokens.fontSize.body,
                    lineHeight: tokens.lineHeight.body,
                    minHeight: 80,
                    textAlignVertical: 'top',
                  },
                ]}
              />
            </View>
            {formError && studioStageExpanded('publish', activeStep) ? (
              <CreateInlineNotice
                tone="error"
                body={formError}
                actionLabel={CREATE_COPY.feedbackDismiss}
                onAction={() => setFormError(null)}
              />
            ) : null}
            <ActionButton
              label={CREATE_COPY.editorPublish}
              variant="filled"
              pending={busy || publishPhase === 'publishing'}
              disabled={!canPublish || busy}
              onPress={() => void onPublish()}
            />
            <ActionButton label={CREATE_COPY.discardCollection} variant="quiet" onPress={onDiscard} />
          </CreateStudioStage>
        </View>

        <View
          style={{
            paddingHorizontal: tokens.space.lg,
            gap: tokens.space.sm,
            paddingTop: tokens.space.xl,
          }}
        >
          <Text style={typeStyle(tokens, 'identityBrand')}>
            {CREATE_COPY.studioDraftsTitle}
          </Text>
          <Text style={[typeStyle(tokens, 'bodyMuted'), { fontSize: tokens.fontSize.caption }]}>
            {CREATE_COPY.draftsHubSub}
          </Text>
          {draftsLoading ? (
            <ActivityIndicator color={tokens.color.primary} />
          ) : segmentedDrafts.isEmpty ? (
            <Text style={typeStyle(tokens, 'bodyMuted')}>{CREATE_COPY.continueEmpty}</Text>
          ) : (
            <>
              {segmentedDrafts.continueCreating.map((row) =>
                renderDraftRow(row, 'continue', tokens, () =>
                  router.push(`/(tabs)/create/review?ingestId=${encodeURIComponent(row.id)}`),
                ),
              )}
              {segmentedDrafts.processing.map((row) =>
                renderDraftRow(row, 'processing', tokens, () =>
                  router.push(`/(tabs)/create/review?ingestId=${encodeURIComponent(row.id)}`),
                ),
              )}
              {segmentedDrafts.needsAttention.map((row) =>
                renderDraftRow(row, 'attention', tokens, () =>
                  router.push(`/(tabs)/create/review?ingestId=${encodeURIComponent(row.id)}`),
                ),
              )}
            </>
          )}
        </View>
      </ScrollView>

      <PublishSuccessScreen
        visible={publishPhase === 'success'}
        title={publishedTitle}
        productCountLabel={publishProductCountLabel(publishedProductCount)}
        canViewCollection={Boolean(publishedCollectionId)}
        onViewFeed={() => exitCreateFlowAfterSuccess(router)}
        onViewCollection={() => {
          if (publishedCollectionId) exitCreateFlowToCollection(router, publishedCollectionId);
          else exitCreateFlowAfterSuccess(router);
        }}
        onCreateAnother={() => {
          setPublishPhase('idle');
          exitCreateFlowToCreateAnother(router);
        }}
      />
    </CreateScreenShell>
  );
}

function objectSurface(tokens: ReturnType<typeof useThemeTokens>) {
  const chrome = outlineCardChrome(tokens);
  return {
    ...chrome,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tokens.radius.md,
  };
}

function renderDraftRow(
  row: UserDraftIngestSummary,
  segment: CreateDraftSegment,
  tokens: ReturnType<typeof useThemeTokens>,
  onPress: () => void,
) {
  const action =
    segment === 'processing'
      ? CREATE_COPY.processingAction
      : segment === 'attention'
        ? CREATE_COPY.attentionAction
        : CREATE_COPY.continueAction;
  const updated = studioRelativeTime(row.updatedAt);
  return (
    <Pressable
      key={row.id}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${action} ${row.videoTitle || row.sourceUrl}`}
      style={[styles.draftRow, objectSurface(tokens), { padding: tokens.space.sm }]}
    >
      {row.thumbnail ? (
        <Image source={{ uri: row.thumbnail }} style={styles.draftThumb} contentFit="cover" />
      ) : (
        <View style={[styles.draftThumb, { backgroundColor: tokens.color.canvasEnd }]} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={typeStyle(tokens, 'tileTitle')}>
          {row.videoTitle || row.sourceUrl}
        </Text>
        <Text numberOfLines={1} style={typeStyle(tokens, 'tileMeta')}>
          {[draftResumeStatusLabel(row.status), updated].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={{ flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Text style={typeStyle(tokens, 'link')}>{action}</Text>
        <Ionicons name="chevron-forward-outline" size={14} color={tokens.color.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    gap: 8,
    minHeight: 44,
  },
  fieldRowMultiline: {
    alignItems: 'flex-start',
    minHeight: 88,
    paddingVertical: 8,
  },
  fieldInput: {
    flex: 1,
    paddingVertical: 10,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewThumb: { width: 52, height: 70, borderRadius: 8 },
  productThumb: { width: 64, height: 64, borderRadius: 8 },
  miniThumb: { width: 28, height: 28, borderRadius: 6 },
  previewThumbs: { flexDirection: 'row', gap: 6 },
  draftRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  draftThumb: { width: 40, height: 40, borderRadius: 8 },
});

