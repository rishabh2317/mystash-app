import React from 'react';
import { StyleSheet, View } from 'react-native';

import { FollowControl } from '@/components/engagement/FollowControl';
import { SaveControl } from '@/components/engagement/SaveControl';
import { ShareControl } from '@/components/engagement/ShareControl';

type SaveProps = {
  isSaved: boolean;
  pending?: boolean;
  iconOnly?: boolean;
  onPress: () => void;
};

type ShareProps = {
  onPress: () => void;
  accessibilityLabel?: string;
};

type FollowProps = {
  isFollowing: boolean;
  pending?: boolean;
  onPress: () => void;
};

type Props = {
  save?: SaveProps;
  share?: ShareProps;
  follow?: FollowProps;
  children?: React.ReactNode;
};

/** Composes emit-only Save / Share / Follow. Parents own auth + APIs. */
export function ContextActions({ save, share, follow, children }: Props) {
  if (!save && !share && !follow && !children) return null;

  return (
    <View style={styles.row}>
      {save ? (
        <SaveControl
          isSaved={save.isSaved}
          pending={save.pending}
          iconOnly={save.iconOnly}
          onPress={save.onPress}
        />
      ) : null}
      {share ? (
        <ShareControl onPress={share.onPress} accessibilityLabel={share.accessibilityLabel} />
      ) : null}
      {follow ? (
        <FollowControl
          isFollowing={follow.isFollowing}
          pending={follow.pending}
          onPress={follow.onPress}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
