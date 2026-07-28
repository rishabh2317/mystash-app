import { promises as fs } from 'node:fs';
import { getPipelineConfig } from '../../config/pipelineConfig';
import type { OcrLine } from '../../domain/types';
import { getEnv } from '../../env';
import { ingestLog } from '../../pipeline/ingestLog';
import type { OcrInput, OcrOutput, OCRProvider } from './OCRProvider';

/**
 * Google Cloud Vision TEXT_DETECTION.
 * Gracefully returns empty when credentials / API unavailable.
 */
export class GoogleVisionOcrProvider implements OCRProvider {
  readonly name = 'gcp-vision-ocr';

  async extractText(input: OcrInput): Promise<OcrOutput> {
    const t0 = performance.now();
    const cfg = getPipelineConfig();
    if (!cfg.gcpVisionEnabled || !getEnv('GOOGLE_APPLICATION_CREDENTIALS')) {
      return { lines: [], meta: { provider: this.name, durationMs: 0 } };
    }

    try {
      const vision = await import('@google-cloud/vision');
      const client = new vision.ImageAnnotatorClient();
      const lines: OcrLine[] = [];

      for (const frame of input.frames) {
        const path = frame.localPath;
        if (!path) continue;
        const buf = await fs.readFile(path);
        const [result] = await client.textDetection(buf);
        const annotations = result.textAnnotations ?? [];
        const full = annotations[0]?.description?.trim();
        if (full) {
          lines.push({
            text: full.slice(0, 2000),
            confidence: 0.8,
            frameIndex: frame.index,
            timestampMs: frame.timestampMs,
          });
        }
      }

      ingestLog('info', 'ocr.complete', {
        ingestId: input.ingestId,
        lineCount: lines.length,
        provider: this.name,
      });

      return {
        lines,
        meta: { provider: this.name, durationMs: Math.round(performance.now() - t0) },
      };
    } catch (e) {
      ingestLog('warn', 'ocr.complete', {
        ingestId: input.ingestId,
        error: (e as Error).message?.slice(0, 160),
        provider: this.name,
      });
      return { lines: [], meta: { provider: this.name, durationMs: Math.round(performance.now() - t0) } };
    }
  }
}
