/** Test-only loader for the frozen pre-milestone source. Only dependency injection
 * is transplanted into the old extractor; its gates/scheduling/outputs stay frozen. */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import type { runProgressiveExtract } from '../../stages/progressiveExtract';
import type { ContentSourceProcessor } from '../../content-source/processing/ContentSourceProcessor';
import type { PlaceResolver } from '../PlaceResolver';

const root = resolve(__dirname, '../..');
function load(name: string, location: string, inject = false): Record<string, unknown> {
  let source = readFileSync(join(__dirname, 'fixtures', `${name}.ts.txt`), 'utf8');
  if (inject) {
    source = source.replace('  params: ProgressiveExtractInput,\n', '  params: ProgressiveExtractInput,\n  runtime: any = {},\n')
      .replace('  includePlaces: boolean,\n', '  includePlaces: boolean,\n  provider?: any,\n')
      .replace('const reasoner = new OpenAiReasonerProvider(admin);', 'const reasoner = provider ?? new OpenAiReasonerProvider(admin);')
      .replace('await getVideoExtractionCache(admin,', 'await (runtime.readCache ?? getVideoExtractionCache)(admin,')
      .replace("  if (platform === 'youtube') {", "  if (runtime.context) { const pack = await runtime.context(); ({title,creator,description,descriptionSource,thumbnailUrl,transcript}=pack); } else if (platform === 'youtube') {")
      .replaceAll("includePlaces);", "includePlaces, runtime.reasoner);")
      .replace('const mu = new CompositeMediaUnderstanding(', 'const mu = runtime.media ?? new CompositeMediaUnderstanding(')
      .replace('const videoProvider = new YtDlpVideoProvider();', 'const videoProvider = runtime.video ?? new YtDlpVideoProvider();')
      .replace("workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mystash-extract-'));", "workDir = await runtime.workDir();")
      .replaceAll('await extractAdaptiveFrames({', 'await runtime.adaptiveFrames({')
      .replaceAll('await extractFramesAtTimestamps({', 'await runtime.moreFrames({')
      .replaceAll('await uploadFramesToStorage(admin,', 'await runtime.upload(admin,')
      .replace('await setVideoExtractionCache(admin,', 'await runtime.writeCache(admin,');
  }
  const filename = join(root, location, `milestone1-${name}.js`);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  const originalRequire = mod.require.bind(mod);
  mod.require = (id: string) => name === 'progressiveExtract' && id === './gate' ? frozenGate : originalRequire(id);
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  (mod as unknown as { _compile(code: string, filename: string): void })._compile(compiled, filename);
  return mod.exports;
}
const frozenGate = load('gate', 'stages');
export const baselineExtract = load('progressiveExtract', 'stages', true).runProgressiveExtract as typeof runProgressiveExtract;
export const BaselineProcessor = load('ContentSourceProcessor', 'content-source/processing').ContentSourceProcessor as typeof ContentSourceProcessor;
export const BaselinePlaceResolver = load('PlaceResolver', 'place').PlaceResolver as typeof PlaceResolver;
