import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShareError } from '../share/contracts';
import { IMAGE_MAX_BYTES, imageDigest } from './contracts';
const exec = promisify(execFile);
let decoding=0;
export type NormalizedImage = { original: Buffer; thumbnail: Buffer; width: number; height: number; digest: string };
export function sniffImage(bytes: Buffer): string | null {
  if (bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))) return 'image/jpeg';
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return 'image/webp';
  return null;
}
function animatedImage(bytes:Buffer,mime:string):boolean{
  let offset=mime==='image/png'?8:12;
  if(mime!=='image/png'&&mime!=='image/webp')return false;
  while(offset+8<=bytes.length){
    const png=mime==='image/png',length=png?bytes.readUInt32BE(offset):bytes.readUInt32LE(offset+4);
    const kind=bytes.toString('ascii',png?offset+4:offset,png?offset+8:offset+4);
    if((png&&kind==='acTL')||(!png&&['ANIM','ANMF'].includes(kind)))return true;
    offset+=png?12+length:8+length+(length%2);
  }
  return false;
}
/** Local files only. No protocols/playlists; one bounded still frame, metadata stripped. */
export async function normalizeImage(bytes: Buffer, mime: string): Promise<NormalizedImage> {
  if (!bytes.length || bytes.length>IMAGE_MAX_BYTES || sniffImage(bytes)!==mime) throw new ShareError('invalid_image_bytes',422);
  if(animatedImage(bytes,mime))throw new ShareError('animated_image_unsupported',422);
  if(decoding>=2)throw new ShareError('image_capacity_unavailable',503);
  decoding++;let work:string|undefined;
  try {
    work = await mkdtemp(join(tmpdir(),'mystash-private-image-'));
    const input=join(work,'input'),original=join(work,'original.jpg'),thumbnail=join(work,'thumbnail.jpg');
    await writeFile(input,bytes,{mode:0o600});
    const {stdout}=await exec('ffprobe',['-v','error','-protocol_whitelist','file','-show_streams','-of','json',input],{timeout:10000,maxBuffer:128*1024});
    const streams=JSON.parse(stdout).streams;
    const stream=streams?.[0],width=Number(stream?.width),height=Number(stream?.height);
    if (streams?.length!==1 || !['mjpeg','png','webp'].includes(stream?.codec_name) || !Number.isInteger(width) || !Number.isInteger(height)
      || width<1 || height<1 || width>2560 || height>2560 || width*height>2560*2560 || Number(stream.nb_frames ?? 1)>1) throw new ShareError('invalid_image_dimensions',422);
    const base=['-nostdin','-v','error','-protocol_whitelist','file','-threads','1','-filter_threads','1','-max_alloc','67108864','-i',input,'-map_metadata','-1','-frames:v','1','-c:v','mjpeg','-threads','1','-q:v','3'];
    await exec('ffmpeg',[...base,original],{timeout:20000,maxBuffer:128*1024});
    await exec('ffmpeg',[...base,'-vf',"scale=w='min(480,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease",thumbnail],{timeout:20000,maxBuffer:128*1024});
    const [normalized,thumb]=await Promise.all([readFile(original),readFile(thumbnail)]);
    if (normalized.length>IMAGE_MAX_BYTES || thumb.length>IMAGE_MAX_BYTES) throw new ShareError('image_too_large',422);
    // Probe normalized output: FFmpeg applies orientation while decoding.
    const out=await exec('ffprobe',['-v','error','-show_entries','stream=width,height','-of','json',original],{timeout:10000,maxBuffer:16384});
    const size=JSON.parse(out.stdout).streams[0];
    return {original:normalized,thumbnail:thumb,width:size.width,height:size.height,digest:imageDigest(normalized)};
  } catch(error) { if (error instanceof ShareError) throw error;if((error as {code?:string}).code==='ENOENT')throw new ShareError('image_codec_unavailable',503);throw new ShareError('image_decode_failed',422); }
  finally { decoding--;if(work)await rm(work,{recursive:true,force:true}); }
}
