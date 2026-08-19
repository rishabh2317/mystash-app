import React, { createContext, useContext, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * UX-B.2 extension point for UX-B.10 toasts.
 * Hosts a pointer-events-box-none overlay. Does not render toast UI yet.
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

/** Reserved for UX-B.10. Screens must not invent a parallel toast host. */
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
