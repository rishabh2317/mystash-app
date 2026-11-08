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

/** Keep a later tap visible while an earlier response supplies the authoritative count. */
export function reconcileVisibleLike(server: ReelLikeState, desiredLiked: boolean): ReelLikeState {
  return server.liked === desiredLiked ? server : optimisticReelLike(server);
}
