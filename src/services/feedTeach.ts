import AsyncStorage from '@react-native-async-storage/async-storage';

import { FEED_TEACH_STORAGE_KEY } from '@/src/ui/feedA11y';

export async function readFeedTeachDismissed(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(FEED_TEACH_STORAGE_KEY);
    return raw === '1';
  } catch {
    return true;
  }
}

export async function dismissFeedTeach(): Promise<void> {
  try {
    await AsyncStorage.setItem(FEED_TEACH_STORAGE_KEY, '1');
  } catch {
    // Local preference only; Home still hides the hint for this session.
  }
}
