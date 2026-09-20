import React from 'react';

import { ProfileStatsStrip } from '@/components/profile/ProfileStatsStrip';
import type { PersonalStat } from '@/src/ui/personalProfile';

type Props = {
  stats: PersonalStat[];
  onPressStat: (id: Exclude<PersonalStat['id'], 'likes'>) => void;
};

export function PersonalStatsBar({ stats, onPressStat }: Props) {
  return (
    <ProfileStatsStrip
      stats={stats.map((stat) => ({
        id: stat.id,
        value: stat.value,
        label: stat.label,
        onPress:
          stat.id === 'likes'
            ? undefined
            : () =>
                onPressStat(
                  stat.id as Exclude<PersonalStat['id'], 'likes'>,
                ),
      }))}
    />
  );
}
