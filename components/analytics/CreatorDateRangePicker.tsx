import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { type CreatorDateRange, lastCompleteUtcDay, shiftUtcDay, validateCreatorDateRange } from '@/src/ui/creatorDateRange';

type Props = { visible: boolean; value: CreatorDateRange | null; onApply: (range: CreatorDateRange) => void; onCancel: () => void };
const monthKey = (day: string) => day.slice(0, 7);
const monthOffset = (month: string, offset: number) => {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + offset, 1)).toISOString().slice(0, 7);
};

export function CreatorDateRangePicker({ visible, value, onApply, onCancel }: Props) {
  const { tokens } = useThemeMode(), insets = useSafeAreaInsets();
  const lastDay = lastCompleteUtcDay();
  const [month, setMonth] = useState(monthKey(value?.start ?? lastDay));
  const [start, setStart] = useState<string | null>(value?.start ?? null);
  const [end, setEnd] = useState<string | null>(value?.end ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setStart(value?.start ?? null); setEnd(value?.end ?? null);
    setMonth(monthKey(value?.start ?? lastDay)); setError(null);
  }, [visible, value?.start, value?.end, lastDay]);
  const first = `${month}-01`;
  const firstWeekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const count = new Date(`${monthOffset(month, 1)}-01T00:00:00Z`).getTime() - new Date(`${first}T00:00:00Z`).getTime();
  const days = Math.round(count / 86400000);
  const label = new Date(`${first}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const choose = (day: string) => {
    setError(null);
    if (!start || end || day < start) { setStart(day); setEnd(null); return; }
    const issue = validateCreatorDateRange({ start, end: day });
    if (issue) { setError(issue); return; }
    setEnd(day);
  };
  const apply = () => {
    if (!start || !end) { setError('Choose a start and end date.'); return; }
    const issue = validateCreatorDateRange({ start, end });
    if (issue) { setError(issue); return; }
    onApply({ start, end });
  };
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <View style={{ maxHeight: '85%', backgroundColor: tokens.color.canvas, borderTopLeftRadius: tokens.radius.lg,
        borderTopRightRadius: tokens.radius.lg, paddingBottom: insets.bottom + tokens.space.md }}>
        <ScrollView contentContainerStyle={{ padding: tokens.space.lg, gap: tokens.space.md }}>
          <Text accessibilityRole="header" style={typeStyle(tokens, 'sectionTitle')}>Choose dates</Text>
          <Text style={typeStyle(tokens, 'bodyMuted')}>Select a start day, then an end day. Choose up to 90 completed UTC days.</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth(monthOffset(month, -1))}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="chevron-back" size={20} color={tokens.color.text} />
            </Pressable>
            <Text style={typeStyle(tokens, 'tileTitle')}>{label}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" disabled={month >= monthKey(lastDay)}
              onPress={() => setMonth(monthOffset(month, 1))}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: month >= monthKey(lastDay) ? 0.4 : 1 }}>
              <Ionicons name="chevron-forward" size={20} color={tokens.color.text} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row' }}>{['S','M','T','W','T','F','S'].map((name, i) =>
            <Text key={i} style={[typeStyle(tokens, 'tileMeta'), { width: `${100 / 7}%`, textAlign: 'center' }]}>{name}</Text>)}</View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {Array.from({ length: firstWeekday }, (_, i) => <View key={`blank-${i}`} style={{ width: `${100 / 7}%`, height: 44 }} />)}
            {Array.from({ length: days }, (_, i) => {
              const day = shiftUtcDay(first, i), selected = day === start || day === end;
              const within = Boolean(start && end && day > start && day < end);
              const disabled = day > lastDay;
              return <Pressable key={day} accessibilityRole="button" accessibilityLabel={day}
                accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => choose(day)}
                style={{ width: `${100 / 7}%`, minHeight: 44, alignItems: 'center', justifyContent: 'center',
                  borderRadius: tokens.radius.md, backgroundColor: selected ? tokens.color.primarySurface : within ? tokens.color.surfaceSubtle : 'transparent',
                  opacity: disabled ? 0.35 : 1 }}>
                <Text style={[typeStyle(tokens, 'body'), { color: selected ? tokens.color.onPrimarySurface : tokens.color.text }]}>{i + 1}</Text>
              </Pressable>;
            })}
          </View>
          <Text style={typeStyle(tokens, 'tileMeta')}>Start: {start ?? 'Choose a date'} · End: {end ?? 'Choose a date'}</Text>
          {error ? <Text accessibilityRole="alert" style={[typeStyle(tokens, 'body'), { color: tokens.color.danger }]}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: tokens.space.sm }}>
            <View style={{ flex: 1 }}><ActionButton label="Cancel" variant="secondary" onPress={onCancel} /></View>
            <View style={{ flex: 1 }}><ActionButton label="Apply" disabled={!start || !end} onPress={apply} /></View>
          </View>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
