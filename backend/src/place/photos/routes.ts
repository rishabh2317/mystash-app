import type { Request, Response } from 'express';
import { sendAuthError } from '../../auth/requireAuth';
import { uuid } from '../../user-import/share/contracts';
import type { PlacePhotoService } from './PlacePhotoService';

export function createPlacePhotoHandler(deps: {
  authenticate(req: Request): Promise<{userId:string} | null>;
  service: Pick<PlacePhotoService,'read'>;
}) {
  return async (req: Request,res: Response): Promise<void> => {
    res.setHeader('Cache-Control','private, no-store, max-age=0');
    res.setHeader('Vary','Authorization');
    try {
      const auth = await deps.authenticate(req);
      if (!auth) { res.status(401).json({error:'authentication_required'}); return; }
      const id = req.params.placeId, width = req.query.width ?? '640', importId = req.query.importId;
      if (!uuid.test(String(id))) { res.status(404).json({error:'place_not_found'}); return; }
      if (typeof width !== 'string' || !['128','256','640'].includes(width) || importId !== undefined && (typeof importId !== 'string' || !uuid.test(importId))) {
        res.status(400).json({error:'invalid_photo_request'}); return;
      }
      const result = await deps.service.read(auth.userId,id,Number(width),importId as string | undefined);
      if (!result) { res.status(404).json({error:'place_not_found'}); return; }
      res.json(result);
    } catch (error) {
      if (sendAuthError(res,error)) return;
      // No upstream response, credential, photo reference or URL enters logs/errors.
      res.status(503).json({error:'place_photo_unavailable'});
    }
  };
}
