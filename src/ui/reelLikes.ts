export type ReelLikeState = {
  liked: boolean;
  likeCount: number;
};

export function optimisticReelLike(current: ReelLikeState): ReelLikeState {
  return {
    liked: !current.liked,
    likeCount: Math.max(0, current.likeCount + (current.liked ? -1 : 1)),
  };
}
