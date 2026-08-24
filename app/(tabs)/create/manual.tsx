import { useAuth } from '@/contexts/AuthContext';
import { CreatorOnboardingPanel } from '@/components/creator/CreatorOnboardingPanel';
import { CreateInlineNotice } from '@/components/create/CreateInlineNotice';
import { CreateScreenShell } from '@/components/create/CreateScreenShell';
import { StatusBlock } from '@/components/status/StatusBlock';
import { submitManualProductLinks } from '@/src/services/curation';
import {
  activateCreatorAccount,
  ensureMe,
  type UserSettingsViewModel,
  UserApiError,
} from '@/src/services/userApi';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { CREATE_COPY } from '@/src/ui/createCopy';
import {
  createFieldColors,
  createPrimaryButtonStyle,
  createSurfaceStyle,
} from '@/src/ui/createChrome';
import { createPartialProductLinksMessage, createUnsupportedUrlFieldError } from '@/src/ui/createFeedback';
import { useAppToast } from '@/src/ui/useAppToast';
import { isSupportedVideoUrl } from '@/src/utils/videoUtils';
import { useCreateFlowReset } from '@/src/state/createFlowSession';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  const tokens = useThemeTokens();
  const { showToast } = useAppToast();

  const [videoUrl, setVideoUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [rows, setRows] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);
  const [preview, setPreview] = useState<
    | null
    | {
        ingestId: string;
        products: { id: string; name: string; price: string; image?: string; affiliateUrl: string }[];
      }
  >(null);
  const [me, setMe] = useState<UserSettingsViewModel | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  const isActiveCreator = me?.creatorStatus === 'ACTIVE';
  const videoOk = isSupportedVideoUrl(videoUrl.trim());
  const field = createFieldColors(tokens, { invalid: Boolean(videoUrl.trim()) && !videoOk });
  const titleField = createFieldColors(tokens);
  const productField = createFieldColors(tokens);
  const surface = createSurfaceStyle(tokens);

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
      setFormError(null);
      setPartialWarning(null);
    }, []),
  );

  const onActivateCreator = async (displayName: string | null) => {
    setActivating(true);
    setMeError(null);
    try {
      setMe(await activateCreatorAccount({ displayName }));
      showToast({ tone: 'success', title: CREATE_COPY.creatorActivatedManualToast });
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
  const primary = createPrimaryButtonStyle(tokens, {
    disabled: !canSubmit,
    pending: busy,
  });
  const urlFieldError = createUnsupportedUrlFieldError(videoUrl, videoOk);

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
    setFormError(null);
    setPartialWarning(null);
    if (!isActiveCreator) {
      setFormError(CREATE_COPY.creatorRequiredBody);
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
        setFormError(CREATE_COPY.manualSaveFailedInline);
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
      const partial = createPartialProductLinksMessage(res.failedProductUrls ?? []);
      if (partial) setPartialWarning(partial);
    } catch (e) {
      const msg = (e as Error).message ?? 'Unknown error';
      if (/Creator status ACTIVE required/i.test(msg)) {
        refreshMe();
        setFormError(CREATE_COPY.creatorRequiredSetupBody);
        return;
      }
      setFormError(msg || CREATE_COPY.manualSaveFailedInline);
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
      <CreateScreenShell>
        <StatusBlock kind="loading" message={CREATE_COPY.editorLoading} fill />
      </CreateScreenShell>
    );
  }

  if (!user) {
    return (
      <CreateScreenShell>
        <View style={[styles.inner, styles.centered]}>
          <StatusBlock
            kind="empty"
            title={CREATE_COPY.signInTitle}
            message={CREATE_COPY.signInBody}
            actionLabel="Go to Profile"
            onAction={() => router.replace('/(tabs)/profile')}
          />
        </View>
      </CreateScreenShell>
    );
  }

  if (!isActiveCreator) {
    return (
      <CreateScreenShell>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.inner}>
          <CreatorOnboardingPanel
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
      </CreateScreenShell>
    );
  }

  return (
    <CreateScreenShell>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.inner,
          { padding: tokens.space.md + 4, gap: tokens.space.sm, paddingBottom: tokens.space.xl + 8 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.display,
            fontWeight: tokens.fontWeight.extraBold,
          }}
        >
          {CREATE_COPY.manualHeadline}
        </Text>
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.bodyStrong,
            lineHeight: 20,
          }}
        >
          {CREATE_COPY.manualSubhead}
        </Text>

        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: 13,
            fontWeight: tokens.fontWeight.semibold,
          }}
        >
          {CREATE_COPY.contentUrlLabel}
        </Text>
        <TextInput
          value={videoUrl}
          onChangeText={(value) => {
            setVideoUrl(value);
            setFormError(null);
          }}
          placeholder={CREATE_COPY.contentUrlPlaceholder}
          placeholderTextColor={field.placeholderTextColor}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[
            styles.input,
            {
              color: field.color,
              borderColor: field.borderColor,
              backgroundColor: field.backgroundColor,
              borderRadius: tokens.radius.md,
              fontSize: tokens.fontSize.body,
            },
          ]}
        />
        {urlFieldError ? (
          <CreateInlineNotice
            tone="error"
            title={CREATE_COPY.unsupportedUrlTitle}
            body={`${urlFieldError} ${CREATE_COPY.urlExamplesHint}`}
          />
        ) : null}

        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: 13,
            fontWeight: tokens.fontWeight.semibold,
          }}
        >
          {CREATE_COPY.collectionTitleLabel}
        </Text>
        <TextInput
          value={videoTitle}
          onChangeText={setVideoTitle}
          placeholder={CREATE_COPY.collectionTitlePlaceholder}
          placeholderTextColor={titleField.placeholderTextColor}
          autoCapitalize="sentences"
          maxLength={200}
          style={[
            styles.input,
            {
              color: titleField.color,
              borderColor: titleField.borderColor,
              backgroundColor: titleField.backgroundColor,
              borderRadius: tokens.radius.md,
              fontSize: tokens.fontSize.body,
            },
          ]}
        />

        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: 13,
            fontWeight: tokens.fontWeight.semibold,
            marginTop: tokens.space.xs,
          }}
        >
          Product links ({uniqueProductUrls.length}/{MAX_PRODUCTS} unique)
        </Text>
        {rows.map((line, index) => (
          <View key={`row-${index}`} style={styles.rowWrap}>
            <TextInput
              value={line}
              onChangeText={(t) => updateRow(index, t)}
              placeholder={`Product URL ${index + 1}`}
              placeholderTextColor={productField.placeholderTextColor}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[
                styles.input,
                styles.rowInput,
                {
                  color: productField.color,
                  borderColor: productField.borderColor,
                  backgroundColor: productField.backgroundColor,
                  borderRadius: tokens.radius.md,
                  fontSize: tokens.fontSize.body,
                },
              ]}
            />
            {rows.length > 1 ? (
              <TouchableOpacity
                onPress={() => removeRow(index)}
                style={[
                  styles.removeBtn,
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

        {rows.length < MAX_PRODUCTS ? (
          <TouchableOpacity style={styles.outlineBtn} onPress={addRow}>
            <Text
              style={{
                color: tokens.color.accent,
                fontWeight: tokens.fontWeight.bold,
                fontSize: tokens.fontSize.bodyStrong,
              }}
            >
              ＋ Add another link
            </Text>
          </TouchableOpacity>
        ) : null}

        {formError ? (
          <CreateInlineNotice
            tone="error"
            body={formError}
            actionLabel={CREATE_COPY.feedbackDismiss}
            onAction={() => setFormError(null)}
          />
        ) : null}
        {partialWarning ? (
          <CreateInlineNotice
            tone="warning"
            title={CREATE_COPY.partialLinksTitle}
            body={partialWarning}
          />
        ) : null}

        <TouchableOpacity
          style={[styles.primary, primary, { marginTop: tokens.space.sm, paddingVertical: 14 }]}
          disabled={!canSubmit}
          onPress={onFetchDetails}
          accessibilityState={{ busy }}
        >
          {busy ? (
            <ActivityIndicator color={tokens.color.successOn} />
          ) : (
            <Text
              style={{
                color: tokens.color.successOn,
                fontWeight: tokens.fontWeight.extraBold,
                fontSize: tokens.fontSize.body,
              }}
            >
              {CREATE_COPY.manualFetch}
            </Text>
          )}
        </TouchableOpacity>

        {preview ? (
          <View style={{ marginTop: tokens.space.lg - 4, gap: tokens.space.sm }}>
            <Text
              style={{
                color: tokens.color.text,
                fontSize: tokens.fontSize.title,
                fontWeight: tokens.fontWeight.extraBold,
              }}
            >
              {CREATE_COPY.manualPreview}
            </Text>
            {preview.products.map((p) => (
              <View
                key={p.id}
                style={[
                  styles.previewCard,
                  {
                    borderColor: surface.borderColor,
                    backgroundColor: surface.backgroundColor,
                    borderRadius: tokens.radius.lg,
                  },
                ]}
              >
                {p.image ? (
                  <Image source={{ uri: p.image }} style={styles.previewThumb} contentFit="cover" />
                ) : (
                  <View
                    style={[
                      styles.previewThumb,
                      { backgroundColor: tokens.color.canvasEnd, borderRadius: tokens.radius.sm + 2 },
                    ]}
                  />
                )}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    style={{
                      color: tokens.color.text,
                      fontSize: tokens.fontSize.body,
                      fontWeight: tokens.fontWeight.bold,
                    }}
                    numberOfLines={2}
                  >
                    {p.name}
                  </Text>
                  <Text style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.caption }}>
                    {p.price} · Shop link wrapped for tracking
                  </Text>
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={[
                styles.secondaryFull,
                {
                  backgroundColor: tokens.color.cta,
                  borderRadius: tokens.radius.md,
                  marginTop: tokens.space.xxs,
                },
              ]}
              onPress={goReview}
            >
              <Text
                style={{
                  color: tokens.color.successOn,
                  fontWeight: tokens.fontWeight.extraBold,
                  fontSize: tokens.fontSize.body,
                }}
              >
                {CREATE_COPY.manualContinue}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </CreateScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  inner: { flexGrow: 1, padding: 20, paddingTop: 12, gap: 10, paddingBottom: 40 },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowInput: { flex: 1 },
  removeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    alignItems: 'center',
  },
  outlineBtn: { alignSelf: 'flex-start', paddingVertical: 8 },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderWidth: 1,
  },
  previewThumb: { width: 64, height: 64, borderRadius: 10 },
  secondaryFull: {
    paddingVertical: 14,
    alignItems: 'center',
  },
});
