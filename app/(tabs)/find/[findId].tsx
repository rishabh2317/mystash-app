import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect, type Href } from 'expo-router';
import { TopBar } from '@/components/chrome/TopBar';
import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { FindDetailView } from '@/components/find/FindDetailView';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useFindDetail } from '@/src/hooks/useFindDetail';
import { findApi } from '@/src/services/findApi';
import type { ReviewProduct } from '@/src/services/shareReviewApi';
import { FIND_ROUTES, safeFindUrl } from '@/src/ui/find';
import { typeStyle } from '@/src/theme/typography';
import { productPagePath } from '@/src/ui/productPage';
export default function FindDetailScreen() {
  const router = useRouter(), { tokens } = useThemeMode(), { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ findId: string }>(), id = typeof params.findId === 'string' ? params.findId : '';
  const detail = useFindDetail(id), owner = user?.id ?? null;
  const [options,setOptions] = useState<{ owner: string; id: string; rows: ReviewProduct[] } | null>(null), [optionsLoading,setOptionsLoading] = useState(false), [optionsError,setOptionsError] = useState<string | null>(null);
  const session = useRef({ owner,id, active: false }); session.current.owner = owner; session.current.id = id;
  const optionsGeneration = useRef(0);
  useEffect(() => { optionsGeneration.current++; setOptions(null); setOptionsError(null); setOptionsLoading(false); }, [owner,id]);
  useFocusEffect(useCallback(() => { session.current.active = true; return () => { session.current.active = false; optionsGeneration.current++; setOptionsLoading(false); }; }, []));
  const loadOptions = async () => {
    if (!owner || !detail.data?.capabilities.suggestions || optionsLoading) return;
    const token = ++optionsGeneration.current, account = owner, record = id;
    setOptionsLoading(true); setOptionsError(null);
    try {
      const result = await findApi.suggestions(id);
      if (session.current.active && token === optionsGeneration.current && session.current.owner === account && session.current.id === record) setOptions({ owner: account,id: record,rows: result.products });
    } catch { if (session.current.active && token === optionsGeneration.current && session.current.owner === account) setOptionsError('Couldn’t load similar options. Your identified results are still here.'); }
    finally { if (token === optionsGeneration.current) setOptionsLoading(false); }
  };
  const visibleOptions = options?.owner === owner && options.id === id ? options : null;
  return <View style={{ flex: 1, backgroundColor: tokens.color.canvasSoft, paddingLeft: insets.left, paddingRight: insets.right }}>
    <TopBar mode="page" title="Find" showBack onBack={() => router.canGoBack() ? router.back() : router.replace(FIND_ROUTES.home as Href)} />
    {!user && !loading ? <View style={{ padding: tokens.space.lg, gap: tokens.space.md }}><Text style={typeStyle(tokens,'body')}>Sign in to open your Find.</Text><ActionButton wrapLabel minTouchHeight={48} label="Sign in" onPress={() => router.push(FIND_ROUTES.profile)} /></View> : <FindDetailView
      data={detail.data} loading={loading || !detail.loaded} refreshing={detail.refreshing} error={detail.error} actionError={detail.actionError} pending={detail.pending}
      onRefresh={() => { void detail.refresh(); }} onOriginal={() => { const url = safeFindUrl(detail.data?.sourceUrl); if (url) void Linking.openURL(url).catch(() => Alert.alert('Couldn’t open the original link', 'Try again when your connection is available.')); }}
      onStash={segment => router.push(segment === 'places' ? '/stash?segment=places' : '/(tabs)/stash')}
      onProduct={productId => router.push(productPagePath(productId, { contentSourceId: detail.data?.contentSourceId ?? undefined, userImportId: id }) as Href)}
      onRetry={kind => { void detail.run(`retry:${kind}`, () => findApi.retry(id,kind)); }}
      onRemove={() => Alert.alert('Remove this capture from history?', 'Products and places in My Stash will stay saved.', [{ text: 'Cancel',style: 'cancel' }, { text: 'Remove',style: 'destructive',onPress: () => { void detail.run('remove', () => findApi.remove(id)).then(ok => { if (ok) router.replace(FIND_ROUTES.home as Href); }); } }])}
      onMembership={(row, restore) => {
        const key = row.kind === 'suggestion' ? `selected:${row.id}:${row.candidate}` : `${row.kind === 'places' ? 'place' : 'product'}:${row.id}`;
        void detail.run(key, () => row.kind === 'suggestion'
          ? restore ? findApi.restoreSavedSuggestion(id,row.id,row.candidate!,row.identity!) : findApi.removeSavedSuggestion(id,row.id,row.candidate!,row.identity!)
          : restore ? findApi.restoreResult(id,row.kind,row.id,row.identity) : findApi.removeResult(id,row.kind,row.id,row.identity));
      }}
      onSaveIntent={value => detail.run('intent', () => findApi.updateIntent(id,value))} options={visibleOptions?.rows ?? []} optionsLoaded={Boolean(visibleOptions)} optionsLoading={optionsLoading} optionsError={optionsError} onOptions={() => { void loadOptions(); }}
      onDecide={(sourceId,key,action) => { void detail.run(`option:${sourceId}:${key}`, () => findApi.decideSuggestion(id,sourceId,key,action)).then(ok => { if (ok) void loadOptions(); }); }}
    />}
  </View>;
}
