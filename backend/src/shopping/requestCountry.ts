import type {Request} from 'express';
import type {SupabaseClient} from '@supabase/supabase-js';
import {optionalVerifiedUserId} from '../auth/requireAuth';
import {SupabaseUserRepository} from '../user/SupabaseUserRepository';
import {resolveCountryCode} from '../merchant-pricing/country';

const text=(v:unknown)=>typeof v==='string'?v:null;
export async function resolveShoppingRequestCountry(admin:SupabaseClient,req:Request):Promise<string>{
  let profile:string|null=null;let savedLocale:string|null=null;
  const user=await optionalVerifiedUserId(req);
  if(user){const row=await new SupabaseUserRepository(admin).getById(user).catch(()=>null);profile=row?.country??null;savedLocale=typeof row?.extensions?.shoppingLocale==='string'?row.extensions.shoppingLocale:row?.language??null;}
  return resolveCountryCode({explicit:text(req.query.country),profile:profile??text(req.query.profileCountry),
    deviceLocale:text(req.query.locale)??savedLocale??text(req.headers['accept-language'])});
}
