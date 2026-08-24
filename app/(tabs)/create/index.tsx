import { useAuth } from '@/contexts/AuthContext';
import { CreatorOnboardingPanel } from '@/components/creator/CreatorOnboardingPanel';
import { CreateInlineNotice } from '@/components/create/CreateInlineNotice';
import { CreateScreenShell } from '@/components/create/CreateScreenShell';
import { StatusBlock } from '@/components/status/StatusBlock';
import { listUserDraftIngests, type UserDraftIngestSummary, submitIngestUrl } from '@/src/services/curation';
import {
  activateCreatorAccount,
  ensureMe,
  type UserSettingsViewModel,
  UserApiError,
} from '@/src/services/userApi';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { CREATE_COPY, draftResumeStatusLabel } from '@/src/ui/createCopy';
import {
  createFieldColors,
  createPrimaryButtonStyle,
  createSecondaryButtonStyle,
  createSegmentBadgeColors,
  createSurfaceStyle,
} from '@/src/ui/createChrome';
import {
  segmentCreateDrafts,
  type CreateDraftSegment,
} from '@/src/ui/createDraftSegments';
import { createUnsupportedUrlFieldError } from '@/src/ui/createFeedback';
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

export default function CreateSubmitScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const tokens = useThemeTokens();
  const { showToast } = useAppToast();
  const [url, setUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [progressHint, setProgressHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [resumeDrafts, setResumeDrafts] = useState<UserDraftIngestSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);

  const [me, setMe] = useState<UserSettingsViewModel | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  const valid = isSupportedVideoUrl(url.trim());
  const isActiveCreator = me?.creatorStatus === 'ACTIVE';
  const field = createFieldColors(tokens, { invalid: Boolean(url.trim()) && !valid });
  const titleField = createFieldColors(tokens);
  const primary = createPrimaryButtonStyle(tokens, {
    disabled: !valid || busy,
    pending: busy,
  });
  const secondary = createSecondaryButtonStyle(tokens, { disabled: !valid || busy });
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

  const refreshResumeList = useCallback(() => {
    if (!user) return;
    setDraftsLoading(true);
    listUserDraftIngests()
      .then(setResumeDrafts)
      .finally(() => setDraftsLoading(false));
  }, [user]);

  const segmentedDrafts = useMemo(() => segmentCreateDrafts(resumeDrafts), [resumeDrafts]);

  const openDraft = (id: string) => {
    router.push(`/(tabs)/create/review?ingestId=${encodeURIComponent(id)}`);
  };

  const renderDraftRow = (row: UserDraftIngestSummary, segment: CreateDraftSegment) => {
    const action =
      segment === 'processing'
        ? CREATE_COPY.processingAction
        : segment === 'attention'
          ? CREATE_COPY.attentionAction
          : CREATE_COPY.continueAction;
    const badge = createSegmentBadgeColors(tokens, segment);

    return (
      <TouchableOpacity
        key={row.id}
        style={[
          styles.draftRow,
          {
            borderColor: surface.borderColor,
            backgroundColor: tokens.color.surface,
            borderRadius: tokens.radius.md,
          },
        ]}
        onPress={() => openDraft(row.id)}
        accessibilityRole="button"
        accessibilityLabel={`${action} ${row.videoTitle || row.sourceUrl}`}
      >
        {row.thumbnail ? (
          <Image source={{ uri: row.thumbnail }} style={styles.draftThumb} contentFit="cover" />
        ) : (
          <View
            style={[
              styles.draftThumb,
              { backgroundColor: tokens.color.canvasEnd, borderRadius: tokens.radius.sm },
            ]}
          />
        )}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: tokens.color.text,
              fontSize: tokens.fontSize.body,
              fontWeight: tokens.fontWeight.bold,
            }}
            numberOfLines={1}
          >
            {row.videoTitle || row.sourceUrl}
          </Text>
          <Text
            style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.caption, marginTop: 2 }}
            numberOfLines={1}
          >
            {row.sourceUrl}
          </Text>
          <Text
            style={{
              color: tokens.color.accent,
              fontSize: tokens.fontSize.caption,
              fontWeight: tokens.fontWeight.bold,
              marginTop: 4,
            }}
          >
            {action}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: badge.bg, borderRadius: tokens.radius.sm }]}>
          <Text
            style={{
              color: badge.fg,
              fontSize: 11,
              fontWeight: tokens.fontWeight.extraBold,
              textTransform: 'uppercase',
            }}
          >
            {draftResumeStatusLabel(row.status)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  useCreateFlowReset(
    useCallback(() => {
      setUrl('');
      setVideoTitle('');
      setBusy(false);
      setProgressHint(null);
      setFormError(null);
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      refreshMe();
      refreshResumeList();
    }, [refreshMe, refreshResumeList]),
  );

  const urlFieldError = createUnsupportedUrlFieldError(url, valid);

  const onActivateCreator = async (displayName: string | null) => {
    setActivating(true);
    setMeError(null);
    try {
      const next = await activateCreatorAccount({ displayName });
      setMe(next);
      showToast({ tone: 'success', title: CREATE_COPY.creatorActivatedToast });
    } catch (e) {
      const msg =
        e instanceof UserApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not activate creator';
      setMeError(msg);
    } finally {
      setActivating(false);
    }
  };

  const onSubmit = async (productAcquisition: 'automatic' | 'manual' = 'automatic') => {
    setFormError(null);
    if (!isActiveCreator) {
      setFormError(CREATE_COPY.creatorRequiredBody);
      return;
    }
    const trimmed = url.trim();
    if (!isSupportedVideoUrl(trimmed)) {
      setFormError(CREATE_COPY.unsupportedUrlBody);
      return;
    }

    setBusy(true);
    setProgressHint(
      productAcquisition === 'manual' ? CREATE_COPY.progressManualMode : CREATE_COPY.progressSending,
    );
    try {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await submitIngestUrl(trimmed, {
            videoTitle: videoTitle.trim() || undefined,
            productAcquisition,
          });
          if (!res.ingestId) {
            setFormError(CREATE_COPY.startFailedBody);
            return;
          }
          setProgressHint(CREATE_COPY.progressOpeningEditor);
          refreshResumeList();
          const modeQ = productAcquisition === 'manual' ? '&mode=manual' : '';
          router.push(
            `/(tabs)/create/review?ingestId=${encodeURIComponent(res.ingestId)}${modeQ}`,
          );
          return;
        } catch (e) {
          const msg = (e as Error).message ?? 'Unknown error';
          if (/Creator status ACTIVE required/i.test(msg)) {
            refreshMe();
            setFormError(CREATE_COPY.creatorRequiredSetupBody);
            return;
          }
          if (attempt === 1) {
            setFormError(msg || CREATE_COPY.startFailedBody);
          }
        }
      }
    } finally {
      setProgressHint(null);
      setBusy(false);
    }
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
          { padding: tokens.space.md + 4, gap: tokens.space.sm, paddingBottom: tokens.space.xl },
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
          {CREATE_COPY.studioHeadline}
        </Text>
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.bodyStrong,
            lineHeight: 20,
          }}
        >
          {CREATE_COPY.studioSubhead}
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
          value={url}
          onChangeText={(value) => {
            setUrl(value);
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

        {formError ? (
          <CreateInlineNotice
            tone="error"
            body={formError}
            actionLabel={CREATE_COPY.feedbackDismiss}
            onAction={() => setFormError(null)}
          />
        ) : null}

        <TouchableOpacity
          style={[styles.primary, primary, { marginTop: tokens.space.xs, paddingVertical: 14 }]}
          disabled={!valid || busy}
          onPress={() => void onSubmit('automatic')}
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
              {CREATE_COPY.primaryStart}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.secondaryOutline,
            secondary,
            { borderWidth: tokens.stroke.thin, paddingVertical: 13 },
          ]}
          onPress={() => void onSubmit('manual')}
          disabled={!valid || busy}
        >
          <Text
            style={{
              color: tokens.color.accent,
              fontWeight: tokens.fontWeight.extraBold,
              fontSize: tokens.fontSize.body,
            }}
          >
            {CREATE_COPY.secondaryManual}
          </Text>
        </TouchableOpacity>
        {progressHint ? (
          <Text
            style={{
              color: tokens.color.textMuted,
              fontSize: 13,
              lineHeight: 18,
              textAlign: 'center',
              marginTop: 4,
            }}
            accessibilityLiveRegion="polite"
          >
            {progressHint}
          </Text>
        ) : null}

        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.title,
            fontWeight: tokens.fontWeight.extraBold,
            marginTop: tokens.space.md,
          }}
        >
          {CREATE_COPY.draftsHubTitle}
        </Text>
        <Text style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.bodyStrong, lineHeight: 20 }}>
          {CREATE_COPY.draftsHubSub}
        </Text>

        {draftsLoading ? (
          <ActivityIndicator style={{ marginVertical: 8 }} color={tokens.color.accent} />
        ) : segmentedDrafts.isEmpty ? (
          <Text style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.bodyStrong, marginTop: 4 }}>
            {CREATE_COPY.continueEmpty}
          </Text>
        ) : (
          <View style={{ gap: tokens.space.md, marginTop: 4 }}>
            {segmentedDrafts.continueCreating.length > 0 ? (
              <View style={{ gap: 6 }}>
                <Text
                  style={{
                    color: tokens.color.text,
                    fontSize: tokens.fontSize.body,
                    fontWeight: tokens.fontWeight.extraBold,
                  }}
                >
                  {CREATE_COPY.continueSectionTitle}
                </Text>
                <Text style={{ color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}>
                  {CREATE_COPY.continueSectionSub}
                </Text>
                {segmentedDrafts.continueCreating.map((row) => renderDraftRow(row, 'continue'))}
              </View>
            ) : null}

            {segmentedDrafts.processing.length > 0 ? (
              <View style={{ gap: 6 }}>
                <Text
                  style={{
                    color: tokens.color.text,
                    fontSize: tokens.fontSize.body,
                    fontWeight: tokens.fontWeight.extraBold,
                  }}
                >
                  {CREATE_COPY.processingSectionTitle}
                </Text>
                <Text style={{ color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}>
                  {CREATE_COPY.processingSectionSub}
                </Text>
                {segmentedDrafts.processing.map((row) => renderDraftRow(row, 'processing'))}
              </View>
            ) : null}

            {segmentedDrafts.needsAttention.length > 0 ? (
              <View style={{ gap: 6 }}>
                <Text
                  style={{
                    color: tokens.color.text,
                    fontSize: tokens.fontSize.body,
                    fontWeight: tokens.fontWeight.extraBold,
                  }}
                >
                  {CREATE_COPY.attentionSectionTitle}
                </Text>
                <Text style={{ color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}>
                  {CREATE_COPY.attentionSectionSub}
                </Text>
                {segmentedDrafts.needsAttention.map((row) => renderDraftRow(row, 'attention'))}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </CreateScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  inner: { flexGrow: 1, padding: 20, paddingTop: 12, gap: 12, paddingBottom: 32 },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primary: {
    alignItems: 'center',
  },
  secondaryOutline: {
    marginTop: 4,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    marginTop: 6,
  },
  draftThumb: { width: 48, height: 48, borderRadius: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 4 },
});
