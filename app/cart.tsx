import { Redirect } from 'expo-router';

/** Legacy `/cart` path — Stash lives under the tab navigator. */
export default function CartRedirect() {
  return <Redirect href="/stash" />;
}
