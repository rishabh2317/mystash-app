import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { probeDurationMs } from '../../media/FrameExtractor';
import type { DownloadedVideo, VideoProvider } from './VideoProvider';

function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
    child.on('error', (err) => resolve({ code: 1, stderr: err.message }));
  });
}

export class YtDlpVideoProvider implements VideoProvider {
  readonly name = 'yt-dlp';

  async download(sourceUrl: string, workDir: string): Promise<DownloadedVideo> {
    await fs.mkdir(workDir, { recursive: true });
    const outTemplate = path.join(workDir, 'video.%(ext)s');
    const r = await run('yt-dlp', [
      '-f',
      'bv*[height<=720]+ba/b[height<=720]/b',
      '--merge-output-format',
      'mp4',
      '-o',
      outTemplate,
      '--no-playlist',
      sourceUrl,
    ]);
    if (r.code !== 0) {
      throw new Error(`yt-dlp failed: ${r.stderr.slice(0, 300)}`);
    }

    const files = await fs.readdir(workDir);
    const vid = files.find((f) => f.startsWith('video.'));
    if (!vid) throw new Error('yt-dlp produced no video file');
    const localPath = path.join(workDir, vid);
    const durationMs = await probeDurationMs(localPath);
    return { localPath, durationMs };
  }

  async cleanup(localPath: string): Promise<void> {
    try {
      await fs.rm(path.dirname(localPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
