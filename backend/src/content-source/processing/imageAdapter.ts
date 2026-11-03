import type { SupabaseClient } from '@supabase/supabase-js';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompositeMediaUnderstanding } from '../../media/CompositeMediaUnderstanding';
import type { MediaUnderstandingProvider } from '../../media/MediaUnderstandingProvider';
import { OpenAiVisionProvider } from '../../providers/vision/OpenAiVisionProvider';
import { GoogleVisionOcrProvider } from '../../providers/ocr/GoogleVisionOcrProvider';
import { GoogleVisionLogoProvider } from '../../providers/logo/GoogleVisionLogoProvider';
import { OpenAiSceneProvider } from '../../providers/scene/OpenAiSceneProvider';
import { OpenAiReasonerProvider } from '../../providers/reasoner/OpenAiReasonerProvider';
import type { ReasonerProvider } from '../../providers/reasoner/ReasonerProvider';
import { ContextBuilder } from '../../context/ContextBuilder';
import { ProductValidator } from '../../products/ProductValidator';
import { ProductRanker } from '../../products/ProductRanker';
import { createPrivateImageService } from '../../user-import/media/factory';
import type { PrivateImageService } from '../../user-import/media/service';
import { imageDigest,type ImageAsset } from '../../user-import/media/contracts';
import type { VideoExtractionPort } from '../ports';
import { assertImportWorkActive,abortImportOperation } from '../../user-import/workContext';
import { ShareError } from '../../user-import/share/contracts';

export function createImageExtractionAdapter(admin:SupabaseClient, runtime:{images?:PrivateImageService;media?:MediaUnderstandingProvider;reasoner?:ReasonerProvider}={}):VideoExtractionPort {
  const images=runtime.images??createPrivateImageService(admin),media=runtime.media??new CompositeMediaUnderstanding(new OpenAiVisionProvider(admin),new GoogleVisionOcrProvider(),new GoogleVisionLogoProvider(),new OpenAiSceneProvider(admin));
  const reasoner=runtime.reasoner??new OpenAiReasonerProvider(admin);
  return { async extract({contentSource:source,traceId}) {
    if(source.mediaKind!=='IMAGE'||!source.ownerId||!source.privateMediaId)throw new ShareError('private_image_unavailable',404);
    const asset=await images.store.command<ImageAsset>(source.ownerId,'status',source.privateMediaId);
    if(asset.state!=='accepted'||asset.source_id!==source.id||!asset.import_id)throw new ShareError('private_image_unavailable',404);
    const bytes=await images.media(source.ownerId,asset.import_id,'original');
    if(imageDigest(bytes)!==asset.normalized_digest)throw new ShareError('private_image_unavailable',503);
    const work=await mkdtemp(join(tmpdir(),'mystash-image-evidence-'));
    try {
      assertImportWorkActive();const localPath=join(work,'image.jpg');await writeFile(localPath,bytes,{mode:0o600});
      const facts=await abortImportOperation(media.analyze({frames:[{index:0,timestampMs:0,storagePath:'',localPath,base64Jpeg:bytes.toString('base64')}],ingestId:source.id,traceId}));
      if(facts.providerMeta.failed?.includes('vision')&&!facts.ocr.length)throw new ShareError('image_understanding_unavailable',503);
      const context=new ContextBuilder().build({platform:'image',externalVideoId:source.id,sourceUrl:'',metadata:{title:'Private still image'},transcriptText:'',media:{...facts,frames:[{index:0,timestampMs:0,storagePath:''}]}});
      const reasoned=await abortImportOperation(reasoner.reason({context,ingestId:source.id,traceId,includePlaces:true,inputKind:'image'}));
      assertImportWorkActive();
      const text=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      const ocr=` ${text(facts.ocr.map(line=>line.text).join(' '))} `;
      const names=(value:string)=>ocr.includes(` ${text(value)} `);
      const products=new ProductRanker().rank(new ProductValidator().validate(reasoned.products),context).map(product=>{
        // A reasoner claiming OCR is not proof that those words occurred in the image.
        const identityNamed=(product.brand&&product.model&&names(`${product.brand} ${product.model}`))
          || (text(product.name).length>=4&&names(product.name));
        const sources: import('../../domain/types').EvidenceSource[]=product.sources.filter(source=>source==='VISION'||source==='SCENE');if(identityNamed)sources.push('OCR');
        return {...product,sources,image:null,merchantUrl:null,price:null,currency:null};
      });
      return {products,places:reasoned.places??[],cacheHit:false,empty:!products.length,finalStage:'private_image',extractionMethod:'ai_extract'};
    }catch(error){assertImportWorkActive();if(error instanceof ShareError)throw error;throw new ShareError('image_extraction_unavailable',503);}
    finally{await rm(work,{recursive:true,force:true});}
  } };
}
