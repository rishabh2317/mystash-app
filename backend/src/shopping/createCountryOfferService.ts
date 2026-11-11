import type {SupabaseClient} from '@supabase/supabase-js';
import {createProductIntelligence} from '../product-intelligence/factory';
import type {CountryOfferService} from './CountryOfferService';

export function createCountryOfferService(admin:SupabaseClient):CountryOfferService|null {
  const pi=createProductIntelligence(admin,'shopping-country');
  if(!pi?.search.discoverMerchantEvidence)return null;
  return pi.countryOffers;
}
