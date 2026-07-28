import { promises as fs } from 'node:fs';
import { getPipelineConfig } from '../../config/pipelineConfig';
import type { DetectedLogo } from '../../domain/types';
import { getEnv } from '../../env';
import { ingestLog } from '../../pipeline/ingestLog';
import type { LogoInput, LogoOutput, LogoProvider } from './LogoProvider';

/** Google Cloud Vision LOGO_DETECTION — never invents logos via GPT. */
export class GoogleVisionLogoProvider implements LogoProvider {
  readonly name = 'gcp-vision-logo';

  async detectLogos(input: LogoInput): Promise<LogoOutput> {
    const t0 = performance.now();
    const cfg = getPipelineConfig();
    if (!cfg.gcpVisionEnabled || !getEnv('GOOGLE_APPLICATION_CREDENTIALS')) {
      return { logos: [], meta: { provider: this.name, durationMs: 0 } };
    }

    try {
      const vision = await import('@google-cloud/vision');
      const client = new vision.ImageAnnotatorClient();
      const logos: DetectedLogo[] = [];

      for (const frame of input.frames) {
        const path = frame.localPath;
        if (!path) continue;
        const buf = await fs.readFile(path);
        const [result] = await client.logoDetection(buf);
        for (const ann of result.logoAnnotations ?? []) {
          if (!ann.description) continue;
          logos.push({
            description: ann.description,
            confidence: ann.score ?? 0.7,
            frameIndex: frame.index,
            timestampMs: frame.timestampMs,
          });
        }
      }

      ingestLog('info', 'logo.complete', {
        ingestId: input.ingestId,
        logoCount: logos.length,
        provider: this.name,
      });

      return {
        logos,
        meta: { provider: this.name, durationMs: Math.round(performance.now() - t0) },
      };
    } catch (e) {
      ingestLog('warn', 'logo.complete', {
        ingestId: input.ingestId,
        error: (e as Error).message?.slice(0, 160),
        provider: this.name,
      });
      return { logos: [], meta: { provider: this.name, durationMs: Math.round(performance.now() - t0) } };
    }
  }
}
