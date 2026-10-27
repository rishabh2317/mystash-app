import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request,Response } from '../auth/requireAuth';
import { UUID } from './contracts';
import { analyticsEnabled } from './flags';
export type MeasurementContext = { sessionId: string; revision: string | null; anonymousConsent: boolean };
const context = new AsyncLocalStorage<MeasurementContext | null>();
export function requestMeasurement(req: Request): MeasurementContext | null {
  if (!analyticsEnabled() || !UUID.test(String(req.headers['x-mystash-session']))) return null;
  const revision=String(req.headers['x-mystash-consent-revision']??'');
  return { sessionId:String(req.headers['x-mystash-session']),revision:UUID.test(revision)?revision:null,
    anonymousConsent:req.headers['x-mystash-anonymous-consent']==='1' };
}
export const analyticsContextMiddleware = (req:Request,_res:Response,next:()=>void) => context.run(requestMeasurement(req),next);
export function currentMeasurement(): MeasurementContext | null { return analyticsEnabled()?context.getStore()??null:null; }
