import React, { createContext, useContext, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * UX-B.2 FeedbackHost — overlay slot for app toasts (UX-CREATE-B.6 / UX-B.10).
 * Screens must use useAppToast / useFeedbackSlot; do not invent a parallel host.
 */
type FeedbackSlotApi = {
  setSlot: (node: React.ReactNode) => void;
};

const FeedbackSlotContext = createContext<FeedbackSlotApi | null>(null);

export function FeedbackHost({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<React.ReactNode>(null);
  const api = useMemo(() => ({ setSlot }), []);

  return (
    <FeedbackSlotContext.Provider value={api}>
      {children}
      <View
        pointerEvents="box-none"
        style={styles.anchor}
        testID="feedback-anchor"
        accessibilityElementsHidden={!slot}
        importantForAccessibility={slot ? 'yes' : 'no-hide-descendants'}
      >
        {slot}
      </View>
    </FeedbackSlotContext.Provider>
  );
}

/** Reserved for toast rendering via useAppToast (FeedbackHost). */
export function useFeedbackSlot(): FeedbackSlotApi {
  const ctx = useContext(FeedbackSlotContext);
  if (!ctx) {
    return { setSlot: () => {} };
  }
  return ctx;
}

const styles = StyleSheet.create({
  anchor: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
  },
});
