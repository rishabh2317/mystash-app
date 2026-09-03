export type FeedReelFollow = {
  isFollowing: boolean;
  pending?: boolean;
  onPress: () => void;
};

export type FeedReelSave = {
  isSaved: boolean;
  pending?: boolean;
  count: number;
  onPress: () => void;
};

export type FeedReelShare = {
  count: number;
  onPress: () => void;
  accessibilityLabel?: string;
};
