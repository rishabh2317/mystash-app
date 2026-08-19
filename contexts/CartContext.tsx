import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import {
  addCartItem,
  CartApiError,
  fetchCart,
  removeCartItem,
  type CartItemSource,
  type CartLine,
  type RemoveCartItemReason,
} from '@/src/services/cartApi';
import { registerCartRefreshHandler } from '@/src/services/cartBoundary';
import { openProductShopping } from '@/src/services/shoppingClick';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';

export type CartStatus = 'idle' | 'loading' | 'ready' | 'error';

type CartContextValue = {
  items: CartLine[];
  itemCount: number;
  status: CartStatus;
  errorMessage: string | null;
  awaitingConfirmationProductId: string | null;
  purchaseConfirmVisible: boolean;
  refresh: () => Promise<void>;
  addItem: (catalogProductId: string, source?: CartItemSource | null) => Promise<void>;
  removeItem: (catalogProductId: string, reason?: RemoveCartItemReason) => Promise<void>;
  beginBuy: (product: CatalogProductViewModel) => Promise<void>;
  resolvePurchaseConfirmation: (yes: boolean) => Promise<void>;
  dismissPurchaseConfirmation: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, session, loading: authLoading } = useAuth();
  const [items, setItems] = useState<CartLine[]>([]);
  const [itemCount, setItemCount] = useState(0);
  const [status, setStatus] = useState<CartStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [awaitingConfirmationProductId, setAwaitingConfirmationProductId] = useState<
    string | null
  >(null);
  const [purchaseConfirmVisible, setPurchaseConfirmVisible] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const leftForMerchantRef = useRef(false);

  const clearLocal = useCallback(() => {
    setItems([]);
    setItemCount(0);
    setStatus('idle');
    setErrorMessage(null);
    setAwaitingConfirmationProductId(null);
    setPurchaseConfirmVisible(false);
    leftForMerchantRef.current = false;
  }, []);

  const refresh = useCallback(async () => {
    if (!user || !session?.access_token) {
      clearLocal();
      return;
    }
    setStatus((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    setErrorMessage(null);
    try {
      const snapshot = await fetchCart();
      setItems(snapshot.items);
      setItemCount(snapshot.itemCount);
      setStatus('ready');
    } catch (e) {
      const message = e instanceof CartApiError ? e.message : 'Could not load cart.';
      setErrorMessage(message);
      setStatus('error');
    }
  }, [clearLocal, session?.access_token, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      clearLocal();
      return;
    }
    void refresh();
  }, [authLoading, user, clearLocal, refresh]);

  useEffect(() => {
    registerCartRefreshHandler(refresh);
    return () => registerCartRefreshHandler(null);
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (
        (prev === 'background' || prev === 'inactive') &&
        next === 'active' &&
        leftForMerchantRef.current &&
        awaitingConfirmationProductId
      ) {
        leftForMerchantRef.current = false;
        setPurchaseConfirmVisible(true);
      }
    });
    return () => sub.remove();
  }, [awaitingConfirmationProductId]);

  const addItem = useCallback(
    async (catalogProductId: string, source?: CartItemSource | null) => {
      const id = catalogProductId.trim();
      if (!id) return;
      await addCartItem(id, source);
      await refresh();
    },
    [refresh],
  );

  const removeItem = useCallback(
    async (catalogProductId: string, reason: RemoveCartItemReason = 'user_remove') => {
      const id = catalogProductId.trim();
      if (!id) return;
      const previous = items;
      const previousCount = itemCount;
      setItems((curr) => curr.filter((line) => line.catalogProductId !== id));
      setItemCount((c) => Math.max(0, c - 1));
      try {
        await removeCartItem(id, reason);
      } catch (e) {
        setItems(previous);
        setItemCount(previousCount);
        setErrorMessage(e instanceof CartApiError ? e.message : 'Could not remove item.');
        await refresh();
        throw e;
      }
    },
    [itemCount, items, refresh],
  );

  const beginBuy = useCallback(async (product: CatalogProductViewModel) => {
    if (!product.catalogProductId) return;
    setAwaitingConfirmationProductId(product.catalogProductId);
    leftForMerchantRef.current = true;
    setPurchaseConfirmVisible(false);
    try {
      await openProductShopping({ catalogProductId: product.catalogProductId });
    } catch (e) {
      leftForMerchantRef.current = false;
      setAwaitingConfirmationProductId(null);
      throw e;
    }
  }, []);

  const dismissPurchaseConfirmation = useCallback(() => {
    setPurchaseConfirmVisible(false);
    setAwaitingConfirmationProductId(null);
    leftForMerchantRef.current = false;
  }, []);

  const resolvePurchaseConfirmation = useCallback(
    async (yes: boolean) => {
      const id = awaitingConfirmationProductId;
      setPurchaseConfirmVisible(false);
      setAwaitingConfirmationProductId(null);
      leftForMerchantRef.current = false;
      if (!id) return;
      if (yes) {
        await removeItem(id, 'purchase_confirmed');
      }
    },
    [awaitingConfirmationProductId, removeItem],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      itemCount,
      status,
      errorMessage,
      awaitingConfirmationProductId,
      purchaseConfirmVisible,
      refresh,
      addItem,
      removeItem,
      beginBuy,
      resolvePurchaseConfirmation,
      dismissPurchaseConfirmation,
    }),
    [
      items,
      itemCount,
      status,
      errorMessage,
      awaitingConfirmationProductId,
      purchaseConfirmVisible,
      refresh,
      addItem,
      removeItem,
      beginBuy,
      resolvePurchaseConfirmation,
      dismissPurchaseConfirmation,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}

export function useCartOptional(): CartContextValue | null {
  return useContext(CartContext);
}
