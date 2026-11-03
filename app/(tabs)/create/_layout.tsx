import { Stack, useRouter } from 'expo-router';

import { TopBar } from '@/components/chrome/TopBar';
import { CREATE_STACK_TITLES } from '@/src/ui/createCopy';

export default function CreateStackLayout() {
  const router = useRouter();
  return (
    <Stack
      screenOptions={{
        header: ({ options, back, navigation }) => (
          <TopBar
            mode="page"
            title={typeof options.title === 'string' ? options.title : ''}
            showBack
            showBag={false}
            onBack={() => back ? navigation.goBack() : router.replace('/(tabs)/profile')}
            trailing={
              typeof options.headerRight === 'function'
                ? options.headerRight({ canGoBack: Boolean(back) } as never)
                : undefined
            }
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
