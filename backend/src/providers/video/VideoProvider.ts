export type DownloadedVideo = {
  localPath: string;
  durationMs: number;
  title?: string;
};

export interface VideoProvider {
  readonly name: string;
  download(sourceUrl: string, workDir: string): Promise<DownloadedVideo>;
  cleanup?(localPath: string): Promise<void>;
}
