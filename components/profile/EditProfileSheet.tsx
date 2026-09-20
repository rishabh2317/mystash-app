import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { CreatorViewModel } from '@/src/types/creator';
import { PERSONAL_PROFILE_COPY } from '@/src/ui/personalProfile';

type Props = {
  visible: boolean;
  creator: CreatorViewModel;
  pending?: boolean;
  onClose: () => void;
  onSave: (patch: { displayName: string; bio: string }) => void;
};

export function EditProfileSheet({ visible, creator, pending, onClose, onSave }: Props) {
  const { tokens } = useThemeMode();
  const [displayName, setDisplayName] = useState(creator.displayName ?? '');
  const [bio, setBio] = useState(creator.bio ?? '');

  useEffect(() => {
    if (!visible) return;
    setDisplayName(creator.displayName ?? '');
    setBio(creator.bio ?? '');
  }, [visible, creator.displayName, creator.bio]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.overlay, { backgroundColor: tokens.overlay.scrim }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: tokens.color.surface,
              borderTopLeftRadius: tokens.radius.xxl,
              borderTopRightRadius: tokens.radius.xxl,
              padding: tokens.space.lg,
              gap: tokens.space.md,
            },
          ]}
        >
          <Text
            style={{
              color: tokens.color.text,
              fontSize: tokens.fontSize.title,
              lineHeight: tokens.lineHeight.title,
              fontWeight: tokens.fontWeight.bold,
            }}
          >
            {PERSONAL_PROFILE_COPY.editProfile}
          </Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Display name"
            placeholderTextColor={tokens.color.textMuted}
            style={[
              styles.input,
              {
                color: tokens.color.text,
                borderColor: tokens.color.border,
                backgroundColor: tokens.color.surfaceSubtle,
                borderRadius: tokens.radius.md,
                paddingHorizontal: tokens.space.md,
                paddingVertical: tokens.space.sm,
                fontSize: tokens.fontSize.body,
              },
            ]}
          />
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Bio"
            placeholderTextColor={tokens.color.textMuted}
            multiline
            style={[
              styles.input,
              styles.bio,
              {
                color: tokens.color.text,
                borderColor: tokens.color.border,
                backgroundColor: tokens.color.surfaceSubtle,
                borderRadius: tokens.radius.md,
                paddingHorizontal: tokens.space.md,
                paddingVertical: tokens.space.sm,
                fontSize: tokens.fontSize.body,
              },
            ]}
          />
          <ActionButton
            variant="filled"
            label="Save"
            pending={pending}
            onPress={() => onSave({ displayName: displayName.trim(), bio: bio.trim() })}
          />
          <ActionButton variant="quiet" label="Cancel" onPress={onClose} disabled={pending} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  sheet: {},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  bio: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
});
