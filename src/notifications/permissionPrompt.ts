import { Alert } from 'react-native';

import { supabase } from '@/src/services/supabase';
import { PUSH_COPY } from '@/src/ui/notificationsInbox';
import { decidePrompt, type PromptTrigger } from './pushPolicy';
import {
  explainerShown,
  markExplainerShown,
  pushSupported,
  readPushPermission,
  requestPushPermission,
  syncPushRegistration,
} from './pushRegistration';

/** Lets the success screen land before the explainer appears. */
const PROMPT_DELAY_MS = 1_200;
let prompting = false;

/**
 * Decision 8: after the first publish or first follow, show a short explainer, then the OS
 * dialog only if the user accepts. Never at launch, never twice, never after a denial.
 */
export async function maybePromptForPush(trigger: PromptTrigger): Promise<void> {
  if (prompting || !pushSupported()) return;
  prompting = true;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    const { permission, canAskAgain } = await readPushPermission();
    if (decidePrompt({ permission, canAskAgain, explainerShown: await explainerShown() }) !== 'ask') return;
    await markExplainerShown();
    await new Promise((resolve) => setTimeout(resolve, PROMPT_DELAY_MS));

    const accepted = await new Promise<boolean>((resolve) => {
      Alert.alert(PUSH_COPY.explainerTitle, PUSH_COPY.explainerBody[trigger], [
        { text: PUSH_COPY.explainerDecline, style: 'cancel', onPress: () => resolve(false) },
        { text: PUSH_COPY.explainerAccept, onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    if (!accepted) return;
    const granted = await requestPushPermission();
    if (granted === 'granted' || granted === 'provisional') await syncPushRegistration(userId, { force: true });
  } catch (e) {
    if (__DEV__) console.warn('[push] prompt failed', (e as Error).message);
  } finally {
    prompting = false;
  }
}
