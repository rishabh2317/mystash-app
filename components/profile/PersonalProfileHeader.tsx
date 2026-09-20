import React from 'react';
import { Pressable, Text } from 'react-native';

import { ProfileIdentityHeader } from '@/components/profile/ProfileIdentityHeader';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { CreatorViewModel } from '@/src/types/creator';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { PERSONAL_PROFILE_COPY } from '@/src/ui/personalProfile';

type Props = {
  creator: CreatorViewModel;
  onEditPress: () => void;
};

export function PersonalProfileHeader({ creator, onEditPress }: Props) {
  const { tokens } = useThemeMode();

  return (
    <ProfileIdentityHeader
      creator={creator}
      action={
        <Pressable
          onPress={onEditPress}
          accessibilityRole="button"
          accessibilityLabel={PERSONAL_PROFILE_COPY.editProfile}
          hitSlop={8}
          style={({ pressed }) => ({
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          })}
        >
          <Text
            style={{
              color: tokens.color.primary,
              fontSize: tokens.fontSize.label,
              lineHeight: tokens.lineHeight.label,
              fontWeight: tokens.fontWeight.semibold,
            }}
          >
            {PERSONAL_PROFILE_COPY.editProfile}
          </Text>
        </Pressable>
      }
    />
  );
}
