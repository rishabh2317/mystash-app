/** Intrinsic asset dimensions plus the visible artwork bounds inside its canvas. */
export type ArtworkBounds = {
  width: number;
  height: number;
  visLeft: number;
  visTop: number;
  visWidth: number;
  visHeight: number;
};

/** Shared with signup: fit visible art, rather than transparent PNG margins. */
export function artLayout(art: ArtworkBounds, box: { width: number; height: number }) {
  const scale = Math.min(box.width / art.visWidth, box.height / art.visHeight);
  return {
    width: art.width * scale,
    height: art.height * scale,
    marginLeft: -art.visLeft * scale + (box.width - art.visWidth * scale) / 2,
    marginTop: -art.visTop * scale + (box.height - art.visHeight * scale) / 2,
  };
}
