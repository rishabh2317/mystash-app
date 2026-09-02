import { Stack } from 'expo-router';

import { TopBar } from '@/components/chrome/TopBar';
import { CREATE_STACK_TITLES } from '@/src/ui/createCopy';

export default function CreateStackLayout() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, back, navigation }) => (
          <TopBar
            mode="page"
            title={typeof options.title === 'string' ? options.title : ''}
            showBack={Boolean(back)}
            showBag={false}
            onBack={() => navigation.goBack()}
          />
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: CREATE_STACK_TITLES.studio }} />
      <Stack.Screen name="manual" options={{ title: CREATE_STACK_TITLES.manual }} />
      <Stack.Screen name="review" options={{ title: CREATE_STACK_TITLES.editor }} />
    </Stack>
  );
}
