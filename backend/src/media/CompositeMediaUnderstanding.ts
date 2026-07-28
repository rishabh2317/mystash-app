import type { MediaUnderstandingProvider, MediaUnderstandingInput } from './MediaUnderstandingProvider';
import type { MediaUnderstandingResult } from '../domain/types';
import type { VisionProvider } from '../providers/vision/VisionProvider';
import type { OCRProvider } from '../providers/ocr/OCRProvider';
import type { LogoProvider } from '../providers/logo/LogoProvider';
import type { SceneProvider } from '../providers/scene/SceneProvider';
import { ingestLog } from '../pipeline/ingestLog';

/**
 * Parallel fact extraction: vision ‖ OCR ‖ logo ‖ scene.
 * Partial failures yield empty slices — never throws for a single provider.
 */
export class CompositeMediaUnderstanding implements MediaUnderstandingProvider {
  readonly name = 'composite-mu';

  constructor(
    private readonly vision: VisionProvider,
    private readonly ocr: OCRProvider,
    private readonly logo: LogoProvider,
    private readonly scene: SceneProvider,
  ) {}

  async analyze(input: MediaUnderstandingInput): Promise<MediaUnderstandingResult> {
    const { frames, ingestId, traceId } = input;
    ingestLog('info', 'media_understanding.started', {
      ingestId,
      traceId,
      frameCount: frames.length,
    });

    const [visionR, ocrR, logoR, sceneR] = await Promise.allSettled([
      this.vision.detectObjects({ frames, ingestId, traceId }),
      this.ocr.extractText({ frames, ingestId, traceId }),
      this.logo.detectLogos({ frames, ingestId, traceId }),
      this.scene.classify({ frames, ingestId, traceId }),
    ]);

    const objects = visionR.status === 'fulfilled' ? visionR.value.objects : [];
    const ocr = ocrR.status === 'fulfilled' ? ocrR.value.lines : [];
    const logos = logoR.status === 'fulfilled' ? logoR.value.logos : [];
    const scene =
      sceneR.status === 'fulfilled'
        ? sceneR.value.scene
        : { label: 'unknown', confidence: 0 };
    const activities = sceneR.status === 'fulfilled' ? sceneR.value.activities : [];

    if (visionR.status === 'rejected') {
      ingestLog('warn', 'media_understanding.vision_failed', {
        ingestId,
        message: String(visionR.reason).slice(0, 160),
      });
    }
    if (ocrR.status === 'rejected') {
      ingestLog('warn', 'media_understanding.ocr_failed', {
        ingestId,
        message: String(ocrR.reason).slice(0, 160),
      });
    }
    if (logoR.status === 'rejected') {
      ingestLog('warn', 'media_understanding.logo_failed', {
        ingestId,
        message: String(logoR.reason).slice(0, 160),
      });
    }
    if (sceneR.status === 'rejected') {
      ingestLog('warn', 'media_understanding.scene_failed', {
        ingestId,
        message: String(sceneR.reason).slice(0, 160),
      });
    }

    const result: MediaUnderstandingResult = {
      objects,
      logos,
      scene,
      activities,
      ocr,
      frames: frames.map((f) => ({
        index: f.index,
        timestampMs: f.timestampMs,
        storagePath: f.storagePath,
      })),
      providerMeta: {
        vision: this.vision.name,
        ocr: this.ocr.name,
        logo: this.logo.name,
        scene: this.scene.name,
      },
    };

    ingestLog('info', 'media_understanding.complete', {
      ingestId,
      traceId,
      objectCount: objects.length,
      ocrCount: ocr.length,
      logoCount: logos.length,
      scene: scene.label,
    });

    return result;
  }
}
