import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { usePushPermission } from '@/src/hooks/usePushPermission';
import { notificationsEnabled } from '@/src/notifications/linking';
import {
  fetchNotificationSettings,
  updateNotificationSettings,
  type NotificationSettings,
} from '@/src/services/notificationsApi';
import { createFieldColors } from '@/src/ui/createChrome';
import { NOTIFICATIONS_COPY, PUSH_COPY, pushSettingsValue } from '@/src/ui/notificationsInbox';
import { typeStyle } from '@/src/theme/typography';

function pairEnabled(
  settings: NotificationSettings,
  category: NotificationSettings['preferences'][number]['category'],
  channel: NotificationSettings['preferences'][number]['channel'],
): boolean {
  return settings.preferences.find((p) => p.category === category && p.channel === channel)?.enabled ?? false;
}

function clockInput(value: string): string {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export default function NotificationSettingsScreen() {
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const push = usePushPermission();
  const field = createFieldColors(tokens);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');

  const load = useCallback(async () => {
    const next = await fetchNotificationSettings();
    setSettings(next);
    if (next.quietHours) {
      setQuietStart(clockInput(next.quietHours.start));
      setQuietEnd(clockInput(next.quietHours.end));
    }
  }, []);

  useEffect(() => {
    if (!user || !notificationsEnabled()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    load()
      .catch(() => {
        if (!cancelled) Alert.alert(NOTIFICATIONS_COPY.prefsLoadError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, load]);

  const save = async (patch: Parameters<typeof updateNotificationSettings>[0]) => {
    if (!settings || saving) return;
    setSaving(true);
    try {
      const next = await updateNotificationSettings({ timezone: deviceTimeZone(), ...patch });
      setSettings(next);
      if (next.quietHours) {
        setQuietStart(clockInput(next.quietHours.start));
        setQuietEnd(clockInput(next.quietHours.end));
      }
    } catch {
      Alert.alert(NOTIFICATIONS_COPY.prefsSaveError);
    } finally {
      setSaving(false);
    }
  };

  const setPair = (
    category: NotificationSettings['preferences'][number]['category'],
    channel: NotificationSettings['preferences'][number]['channel'],
    enabled: boolean,
  ) => {
    if (!settings) return;
    const preferences = settings.preferences.map((row) =>
      row.category === category && row.channel === channel ? { ...row, enabled } : row,
    );
    setSettings({ ...settings, preferences });
    void save({ preferences });
  };

  const onQuietToggle = (on: boolean) => {
    if (on) {
      void save({ quietHours: { start: quietStart, end: quietEnd } });
      return;
    }
    void save({ quietHours: null });
  };

  const onQuietBlur = () => {
    if (!settings?.quietHours) return;
    void save({ quietHours: { start: quietStart, end: quietEnd } });
  };

  if (!notificationsEnabled()) {
    return (
      <View style={[styles.centered, { backgroundColor: tokens.color.canvas }]}>
        <Text style={typeStyle(tokens, 'body')}>{NOTIFICATIONS_COPY.unavailable}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: tokens.color.canvas }]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!settings) {
    return (
      <View style={[styles.centered, { backgroundColor: tokens.color.canvas, padding: tokens.space.lg, gap: tokens.space.md }]}>
        <Text style={typeStyle(tokens, 'body')}>{NOTIFICATIONS_COPY.prefsLoadError}</Text>
      </View>
    );
  }

  const quietOn = Boolean(settings.quietHours);
  const inputStyle = {
    color: field.color,
    borderColor: field.borderColor,
    backgroundColor: field.backgroundColor,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    fontSize: tokens.fontSize.body,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 88,
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.color.canvas }}
      contentContainerStyle={{ padding: tokens.space.lg, gap: tokens.space.lg, paddingBottom: tokens.space.xxl }}
    >
      <SettingsSection title={NOTIFICATIONS_COPY.prefsSocial}>
        <SettingsRow
          variant="toggle"
          title={NOTIFICATIONS_COPY.prefsSocialInbox}
          subtitle={NOTIFICATIONS_COPY.prefsSocialHint}
          toggleValue={pairEnabled(settings, 'social', 'inbox')}
          onToggle={(next) => setPair('social', 'inbox', next)}
          disabled={saving}
        />
        <SettingsRow
          variant="toggle"
          title={NOTIFICATIONS_COPY.prefsSocialPush}
          toggleValue={pairEnabled(settings, 'social', 'push')}
          onToggle={(next) => setPair('social', 'push', next)}
          disabled={saving}
        />
      </SettingsSection>

      <SettingsSection title={NOTIFICATIONS_COPY.prefsTask}>
        <SettingsRow
          variant="toggle"
          title={NOTIFICATIONS_COPY.prefsTaskPush}
          subtitle={NOTIFICATIONS_COPY.prefsTaskHint}
          toggleValue={pairEnabled(settings, 'task', 'push')}
          onToggle={(next) => setPair('task', 'push', next)}
          disabled={saving}
        />
      </SettingsSection>

      <SettingsSection title={NOTIFICATIONS_COPY.prefsAccount}>
        <SettingsRow
          variant="toggle"
          title={NOTIFICATIONS_COPY.prefsAccountPush}
          subtitle={NOTIFICATIONS_COPY.prefsAccountHint}
          toggleValue={pairEnabled(settings, 'account', 'push')}
          onToggle={(next) => setPair('account', 'push', next)}
          disabled={saving}
        />
      </SettingsSection>

      <SettingsSection title={NOTIFICATIONS_COPY.prefsPromo}>
        <SettingsRow
          variant="toggle"
          title={NOTIFICATIONS_COPY.prefsPromoInbox}
          subtitle={NOTIFICATIONS_COPY.prefsPromoHint}
          toggleValue={pairEnabled(settings, 'promo', 'inbox')}
          onToggle={(next) => setPair('promo', 'inbox', next)}
          disabled={saving}
        />
        <SettingsRow
          variant="toggle"
          title={NOTIFICATIONS_COPY.prefsPromoPush}
          toggleValue={pairEnabled(settings, 'promo', 'push')}
          onToggle={(next) => setPair('promo', 'push', next)}
          disabled={saving}
        />
      </SettingsSection>

      <SettingsSection title={NOTIFICATIONS_COPY.prefsQuiet}>
        <SettingsRow
          variant="toggle"
          title={NOTIFICATIONS_COPY.prefsQuiet}
          subtitle={NOTIFICATIONS_COPY.prefsQuietHint}
          toggleValue={quietOn}
          onToggle={onQuietToggle}
          disabled={saving}
        />
        {quietOn ? (
          <View style={{ paddingHorizontal: tokens.space.md, paddingBottom: tokens.space.md, gap: tokens.space.sm }}>
            <View style={{ flexDirection: 'row', gap: tokens.space.md }}>
              <View style={{ gap: tokens.space.xxs }}>
                <Text style={typeStyle(tokens, 'tileMeta')}>{NOTIFICATIONS_COPY.prefsQuietStart}</Text>
                <TextInput
                  value={quietStart}
                  onChangeText={setQuietStart}
                  onBlur={onQuietBlur}
                  placeholder="22:00"
                  placeholderTextColor={field.placeholderTextColor}
                  keyboardType="numbers-and-punctuation"
                  style={inputStyle}
                  accessibilityLabel={NOTIFICATIONS_COPY.prefsQuietStart}
                />
              </View>
              <View style={{ gap: tokens.space.xxs }}>
                <Text style={typeStyle(tokens, 'tileMeta')}>{NOTIFICATIONS_COPY.prefsQuietEnd}</Text>
                <TextInput
                  value={quietEnd}
                  onChangeText={setQuietEnd}
                  onBlur={onQuietBlur}
                  placeholder="07:00"
                  placeholderTextColor={field.placeholderTextColor}
                  keyboardType="numbers-and-punctuation"
                  style={inputStyle}
                  accessibilityLabel={NOTIFICATIONS_COPY.prefsQuietEnd}
                />
              </View>
            </View>
            <Text style={typeStyle(tokens, 'tileMeta')}>{NOTIFICATIONS_COPY.prefsQuietInvalid}</Text>
          </View>
        ) : null}
      </SettingsSection>

      {push.supported && push.permission ? (
        <SettingsSection title={PUSH_COPY.settingsRow}>
          <SettingsRow
            variant="navigation"
            icon="phone-portrait-outline"
            title={PUSH_COPY.settingsRow}
            value={pushSettingsValue(push.permission)}
            onPress={push.onPress}
          />
        </SettingsSection>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
