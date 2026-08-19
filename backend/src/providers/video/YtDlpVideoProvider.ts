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

export type YtDlpJsonProbe =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; stderr: string; code: number };

/** Metadata-only probe (no media download). Used by Instagram source adapter. */
export function probeYtDlpJson(
  sourceUrl: string,
  timeoutMs = 25_000,
): Promise<YtDlpJsonProbe> {
  return new Promise((resolve) => {
    const child = spawn(
      'yt-dlp',
      ['-j', '--skip-download', '--no-playlist', '--no-warnings', sourceUrl],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, stderr: 'yt-dlp probe timed out', code: 1 });
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, stderr: stderr.slice(0, 800), code: code ?? 1 });
        return;
      }
      try {
        resolve({ ok: true, json: JSON.parse(stdout) as Record<string, unknown> });
      } catch {
        resolve({ ok: false, stderr: 'yt-dlp returned invalid JSON', code: 1 });
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stderr: err.message, code: 1 });
    });
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
