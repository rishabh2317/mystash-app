import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';

type Props = {
  isFollowing: boolean;
  pending?: boolean;
  disabled?: boolean;
  isLight: boolean;
  labelOverride?: string;
  onPress: () => void;
};

export function FollowControl({
  isFollowing,
  pending = false,
  disabled = false,
  isLight,
  labelOverride,
  onPress,
}: Props) {
  const label = labelOverride ?? (isFollowing ? 'Following' : 'Follow');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.btn,
        isFollowing
          ? {
              backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)',
              borderColor: isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.2)',
            }
          : {
              backgroundColor: isLight ? '#1A1A1B' : '#F8FAFC',
              borderColor: 'transparent',
            },
        { opacity: pressed || pending || disabled ? 0.7 : 1 },
      ]}
    >
      {pending ? (
        <ActivityIndicator color={isFollowing ? (isLight ? '#1A1A1B' : '#F8FAFC') : isLight ? '#F8FAFC' : '#1A1A1B'} />
      ) : (
        <Text
          style={[
            styles.label,
            {
              color: isFollowing
                ? isLight
                  ? '#1A1A1B'
                  : '#F8FAFC'
                : isLight
                  ? '#F8FAFC'
                  : '#1A1A1B',
            },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minWidth: 110,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
  },
});
