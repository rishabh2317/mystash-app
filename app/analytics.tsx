import CreatorAnalyticsScreen from '@/components/analytics/CreatorAnalyticsScreen';
import LegacyAnalyticsScreen from '@/components/analytics/LegacyAnalyticsScreen';

/** Staged local preparation: the existing screen stays active until coordinated rollout. */
export default function AnalyticsScreen() {
  return process.env.EXPO_PUBLIC_CREATOR_ANALYTICS_ENABLED === 'true'
    ? <CreatorAnalyticsScreen />
    : <LegacyAnalyticsScreen />;
}
