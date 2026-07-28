import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { adaptiveFrameCount, getPipelineConfig, uniformTimestampsMs } from '../config/pipelineConfig';
import type { FrameRef } from '../domain/types';
import { ingestLog } from '../pipeline/ingestLog';

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: err.message }));
  });
}

export async function probeDurationMs(videoPath: string): Promise<number> {
  const r = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ]);
  const sec = Number(r.stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) return 10_000;
  return Math.floor(sec * 1000);
}

export async function extractFramesAtTimestamps(params: {
  videoPath: string;
  timestampsMs: number[];
  outDir: string;
  ingestId: string;
}): Promise<FrameRef[]> {
  await fs.mkdir(params.outDir, { recursive: true });
  const frames: FrameRef[] = [];

  for (let i = 0; i < params.timestampsMs.length; i++) {
    const ts = params.timestampsMs[i]!;
    const sec = (ts / 1000).toFixed(3);
    const file = path.join(params.outDir, `frame_${String(i).padStart(3, '0')}.jpg`);
    const r = await run('ffmpeg', [
      '-y',
      '-ss',
      sec,
      '-i',
      params.videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      file,
    ]);
    if (r.code !== 0) {
      ingestLog('warn', 'frame_extract.ffmpeg_failed', {
        ingestId: params.ingestId,
        index: i,
        message: r.stderr.slice(0, 200),
      });
      continue;
    }
    const buf = await fs.readFile(file);
    const sha = createHash('sha256').update(buf).digest('hex');
    frames.push({
      index: i,
      timestampMs: ts,
      storagePath: file,
      localPath: file,
      base64Jpeg: buf.toString('base64'),
    });
    void sha;
  }
  return frames;
}

export async function extractAdaptiveFrames(params: {
  videoPath: string;
  outDir: string;
  ingestId: string;
  maxFrames?: number;
}): Promise<{ frames: FrameRef[]; durationMs: number }> {
  const durationMs = await probeDurationMs(params.videoPath);
  const durationSec = durationMs / 1000;
  let count = adaptiveFrameCount(durationSec);
  if (params.maxFrames != null) count = Math.min(count, params.maxFrames);
  const cfg = getPipelineConfig();
  count = Math.min(count, cfg.stage3MaxFrames);
  const timestamps = uniformTimestampsMs(durationMs, count);
  const frames = await extractFramesAtTimestamps({
    videoPath: params.videoPath,
    timestampsMs: timestamps,
    outDir: params.outDir,
    ingestId: params.ingestId,
  });
  return { frames, durationMs };
}

/** Merge existing Stage-2 frames with additional Stage-3 timestamps up to max. */
export function planStage3Timestamps(
  durationMs: number,
  existing: FrameRef[],
  maxTotal: number,
): number[] {
  const target = Math.min(maxTotal, Math.max(existing.length, maxTotal));
  const all = uniformTimestampsMs(durationMs, target);
  const existingTs = new Set(existing.map((f) => f.timestampMs));
  const missing = all.filter((t) => {
    for (const e of existingTs) {
      if (Math.abs(e - t) < 250) return false;
    }
    return true;
  });
  return missing;
}
