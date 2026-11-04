import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { stashFilterChipChrome } from '@/src/theme/tokens';
import type { FindItem } from '@/src/services/findClient';
export function FindIntentEditor({ intent, busy, onSave }: { intent: FindItem['intent']; busy: boolean; onSave(value: FindItem['intent']): Promise<boolean> }) {
  const { tokens } = useThemeMode();
  const [draft,setDraft] = useState<FindItem['intent'] | null>(null);
  if (!draft) return <View style={{ gap: tokens.space.sm }}>
    {intent.note ? <Text style={typeStyle(tokens,'body')}>{intent.note}</Text> : null}
    <ActionButton wrapLabel minTouchHeight={48} label={intent.note || intent.kind ? 'Edit your interest' : 'Add an optional note'} variant="quiet" leadingIcon="create-outline" onPress={() => setDraft(intent)} />
  </View>;
  const changedElsewhere = intent.revision !== draft.revision;
  return <View style={{ gap: tokens.space.sm }}>
    <Text style={typeStyle(tokens,'body')}>What caught your eye?</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm }}>
      {(['product','place','both'] as const).map(kind => <Pressable key={kind} accessibilityRole="button" accessibilityState={{ selected: draft.kind === kind, disabled: busy }} disabled={busy}
        onPress={() => setDraft({ ...draft, kind: draft.kind === kind ? null : kind })}
        style={{ ...stashFilterChipChrome(tokens, draft.kind === kind), minHeight: 48, justifyContent: 'center', paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.xs }}>
        <Text style={[typeStyle(tokens,'caption'), { color: tokens.color.text, fontFamily: draft.kind === kind ? tokens.fontFamily.medium : tokens.fontFamily.regular }]}>{kind === 'product' ? 'Products' : kind === 'place' ? 'Places' : 'Both'}</Text>
      </Pressable>)}
    </View>
    <TextInput value={draft.note ?? ''} onChangeText={note => setDraft({ ...draft,note })} editable={!busy} multiline maxLength={280} accessibilityLabel="Optional private note, 280 characters maximum"
      placeholder="What would you like to remember?" placeholderTextColor={tokens.color.textMuted}
      style={{ ...typeStyle(tokens,'body'), minHeight: 88, padding: tokens.space.sm, borderRadius: tokens.radius.md, borderWidth: tokens.stroke.thin, borderColor: tokens.color.border, backgroundColor: tokens.color.surface, color: tokens.color.text, textAlignVertical: 'top' }} />
    <Text style={typeStyle(tokens,'caption')}>{Array.from(draft.note ?? '').length}/280 · Only you can see this note.</Text>
    {changedElsewhere ? <View accessibilityRole="alert"><Text style={typeStyle(tokens,'bodyMuted')}>This note changed elsewhere. Your draft is still here.</Text><ActionButton wrapLabel minTouchHeight={48} label="Discard draft and use latest note" variant="quiet" onPress={() => setDraft(intent)} /></View> : null}
    <ActionButton wrapLabel minTouchHeight={48} label="Save note" pending={busy} disabled={changedElsewhere} onPress={() => { void onSave(draft).then(saved => { if (saved) setDraft(null); }); }} />
    <ActionButton wrapLabel minTouchHeight={48} label="Cancel editing" variant="quiet" disabled={busy} onPress={() => setDraft(null)} />
  </View>;
}
