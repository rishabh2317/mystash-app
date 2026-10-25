import React, { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { useThemeMode } from '@/contexts/ThemeContext';
import {
  addLibraryItemToCollection,
  attachCampaignProduct,
  attachLibraryItemProduct,
  listCampaignProducts,
  listCreatorLibrary,
  listEditableCollections,
  listLibraryItemProducts,
  publishCollection,
  removeLibraryItemProduct,
  requestCreatorLibrarySync,
  type CampaignOffering,
  type CreatorLibrarySnapshot,
  type EditableCollection,
  type LibraryItemProduct,
} from '@/src/services/creatorLibraryApi';
import { CREATE_COPY } from '@/src/ui/createCopy';

/** Compact synced-library list. Does not start ingest or change playback. */
export function CreatorLibraryPanel(props: { connectedAccountId: string }) {
  const { tokens } = useThemeMode();
  const [snapshot, setSnapshot] = useState<CreatorLibrarySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [products, setProducts] = useState<LibraryItemProduct[]>([]);
  const [campaignProducts, setCampaignProducts] = useState<CampaignOffering[]>([]);
  const [productId, setProductId] = useState('');
  const [collections, setCollections] = useState<EditableCollection[]>([]);
  const [collectionId, setCollectionId] = useState<string | null>(null);

  const load = useCallback(() => {
    listCreatorLibrary()
      .then((next) => {
        setSnapshot(next);
        setError(next.sync?.error ?? null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load library'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const loadProducts = async (contentSourceId: string) => {
    const body = await listLibraryItemProducts(contentSourceId);
    setProducts(body.products);
  };

  const onOpen = (contentSourceId: string) => {
    const next = openId === contentSourceId ? null : contentSourceId;
    setOpenId(next);
    setProductId('');
    if (next) {
      loadProducts(next).catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Could not load products'),
      );
      listEditableCollections()
        .then((body) => setCollections(body.collections))
        .catch(() => setCollections([]));
      listCampaignProducts()
        .then((body) => setCampaignProducts(body.products))
        .catch(() => setCampaignProducts([]));
    }
  };

  const onAddToCollection = async (targetId?: string) => {
    if (!openId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addLibraryItemToCollection(openId, {
        collectionId: targetId,
        title: targetId ? undefined : 'From library',
      });
      setCollectionId(result.collectionId);
      const fresh = await listEditableCollections();
      setCollections(fresh.collections);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add to Collection');
    } finally {
      setBusy(false);
    }
  };

  const onPublish = async () => {
    if (!collectionId) return;
    setBusy(true);
    setError(null);
    try {
      await publishCollection(collectionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish');
    } finally {
      setBusy(false);
    }
  };

  const onAttach = async (kind: 'catalog' | 'discovered') => {
    if (!openId || !productId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await attachLibraryItemProduct(
        openId,
        kind === 'catalog'
          ? { catalogProductId: productId.trim() }
          : { discoveredProductId: productId.trim() },
      );
      setProductId('');
      await loadProducts(openId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach product');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (id: string) => {
    if (!openId) return;
    setBusy(true);
    try {
      await removeLibraryItemProduct(openId, id);
      await loadProducts(openId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove product');
    } finally {
      setBusy(false);
    }
  };

  const onSync = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestCreatorLibrarySync(props.connectedAccountId);
      setTimeout(load, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  const syncing = busy || snapshot?.sync?.status === 'running';
  const items = snapshot?.items ?? [];

  return (
    <View
      style={{
        borderColor: tokens.color.border,
        backgroundColor: tokens.color.surface,
        borderRadius: tokens.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        padding: tokens.space.sm,
        gap: tokens.space.xs,
      }}
    >
      <View style={styles.header}>
        <Text style={{ color: tokens.color.text, fontWeight: tokens.fontWeight.bold, flex: 1 }}>
          {CREATE_COPY.libraryTitle}
        </Text>
        <Pressable onPress={() => void onSync()} disabled={syncing} accessibilityRole="button">
          <Text style={{ color: tokens.color.primary, fontWeight: tokens.fontWeight.bold }}>
            {syncing ? CREATE_COPY.librarySyncing : CREATE_COPY.librarySync}
          </Text>
        </Pressable>
      </View>
      {error ? (
        <Text style={{ color: tokens.color.danger, fontSize: tokens.fontSize.caption }}>{error}</Text>
      ) : null}
      {items.length === 0 ? (
        <Text style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.caption, lineHeight: 18 }}>
          {CREATE_COPY.libraryEmpty}
        </Text>
      ) : (
        items.slice(0, 8).map((item) => (
          <View key={item.membershipId} style={{ gap: 6 }}>
            <Pressable onPress={() => onOpen(item.contentSourceId)} style={styles.row} accessibilityRole="button">
              {item.thumbnailUrl ? (
                <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, { backgroundColor: tokens.color.border }]} />
              )}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: tokens.color.text, fontSize: tokens.fontSize.caption }}>
                  {item.title || item.externalId}
                </Text>
                <Text style={{ color: tokens.color.textMuted, fontSize: 11 }}>{CREATE_COPY.libraryProducts}</Text>
                {item.availability === 'unavailable' ? (
                  <Text style={{ color: tokens.color.textMuted, fontSize: 11 }}>{CREATE_COPY.libraryUnavailable}</Text>
                ) : null}
              </View>
            </Pressable>
            {openId === item.contentSourceId ? (
              <View style={{ gap: 6, paddingLeft: 50 }}>
                <Text style={{ color: tokens.color.textMuted, fontSize: 11, lineHeight: 16 }}>
                  {CREATE_COPY.libraryProductHint}
                </Text>
                {products.map((product) => (
                  <View key={product.id} style={styles.row}>
                    <Text numberOfLines={1} style={{ color: tokens.color.text, fontSize: 12, flex: 1 }}>
                      {product.name}
                    </Text>
                    {product.attachmentSource === 'CREATOR_MANUAL' ||
                    product.attachmentSource === 'CAMPAIGN' ||
                    product.attachmentSource === 'BRAND_FEED' ? (
                      <Pressable onPress={() => void onRemove(product.id)} disabled={busy}>
                        <Text style={{ color: tokens.color.danger, fontSize: 12 }}>{CREATE_COPY.libraryRemoveProduct}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {campaignProducts.length > 0 ? (
                  <Text style={{ color: tokens.color.textMuted, fontSize: 11 }}>
                    {CREATE_COPY.libraryCampaignProducts}
                  </Text>
                ) : null}
                {campaignProducts.slice(0, 5).map((offering) => (
                  <Pressable
                    key={offering.campaignProductId}
                    disabled={busy}
                    onPress={() => {
                      if (!openId) return;
                      setBusy(true);
                      setError(null);
                      void attachCampaignProduct(openId, offering.campaignProductId)
                        .then(() => loadProducts(openId))
                        .catch((e: unknown) =>
                          setError(e instanceof Error ? e.message : 'Could not attach campaign product'),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    <Text numberOfLines={1} style={{ color: tokens.color.text, fontSize: 12 }}>
                      {offering.brandName}: {offering.name}
                    </Text>
                  </Pressable>
                ))}
                <TextInput
                  value={productId}
                  onChangeText={setProductId}
                  placeholder={CREATE_COPY.libraryProductPlaceholder}
                  placeholderTextColor={tokens.color.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    color: tokens.color.text,
                    borderColor: tokens.color.border,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    fontSize: 13,
                  }}
                />
                <View style={styles.header}>
                  <Pressable onPress={() => void onAddToCollection()} disabled={busy}>
                    <Text style={{ color: tokens.color.primary, fontSize: 12, fontWeight: tokens.fontWeight.bold }}>
                      {CREATE_COPY.libraryNewCollection}
                    </Text>
                  </Pressable>
                  {collectionId ? (
                    <Pressable onPress={() => void onPublish()} disabled={busy}>
                      <Text style={{ color: tokens.color.primary, fontSize: 12, fontWeight: tokens.fontWeight.bold }}>
                        {CREATE_COPY.libraryPublish}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {collections.slice(0, 4).map((collection) => (
                  <Pressable key={collection.id} onPress={() => void onAddToCollection(collection.id)} disabled={busy}>
                    <Text numberOfLines={1} style={{ color: tokens.color.text, fontSize: 12 }}>
                      {CREATE_COPY.libraryAddCollection}: {collection.title || 'Untitled'}
                    </Text>
                  </Pressable>
                ))}
                <View style={styles.header}>
                  <Pressable onPress={() => void onAttach('catalog')} disabled={busy}>
                    <Text style={{ color: tokens.color.primary, fontSize: 12, fontWeight: tokens.fontWeight.bold }}>
                      {CREATE_COPY.libraryAttachCatalog}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => void onAttach('discovered')} disabled={busy}>
                    <Text style={{ color: tokens.color.primary, fontSize: 12, fontWeight: tokens.fontWeight.bold }}>
                      {CREATE_COPY.libraryAttachDiscovered}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thumb: { width: 42, height: 42, borderRadius: 8 },
});
