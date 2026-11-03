import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {normalizeImage,sniffImage} from './imageCodec';
const exec=promisify(execFile);
test('real codec strips input metadata, preserves aspect ratio and generates a small JPEG thumbnail',async()=>{
  const {stdout}=await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x32','-frames:v','1','-f','image2pipe','-c:v','mjpeg','pipe:1'],{encoding:'buffer',timeout:10000});
  const tag=Buffer.from('Exif\0\0PRIVATE LOCATION CANARY'),length=Buffer.alloc(2);length.writeUInt16BE(tag.length+2);
  const jpeg=Buffer.concat([stdout.subarray(0,2),Buffer.from([0xff,0xe1]),length,tag,stdout.subarray(2)]);
  const image=await normalizeImage(jpeg,'image/jpeg');assert.equal(image.width/image.height,2);assert.equal(sniffImage(image.original),'image/jpeg');assert.equal(sniffImage(image.thumbnail),'image/jpeg');assert.ok(!image.original.includes(tag));assert.ok(image.thumbnail.length<5242880);
});
test('unsupported, malformed, oversized and animated image payloads fail before acceptance',async()=>{
  for(const bytes of [Buffer.from('<svg onload="alert(1)"/>'),Buffer.alloc(5242881),Buffer.from([137,80,78,71,13,10,26,10])])await assert.rejects(normalizeImage(bytes,'image/png'));
  await assert.rejects(normalizeImage(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from([0,0,0,0]),Buffer.from('acTL')]),'image/png'),/animated/);
  const {stdout}=await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=s=2562x2','-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'],{encoding:'buffer',timeout:10000});
  await assert.rejects(normalizeImage(stdout,'image/png'),/dimensions/);
});
