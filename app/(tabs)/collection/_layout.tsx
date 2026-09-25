import { Stack } from 'expo-router';

export default function CollectionStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[collectionId]" />
    </Stack>
  );
}
