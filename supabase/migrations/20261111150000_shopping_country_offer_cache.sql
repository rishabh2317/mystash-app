-- New lookups only. No historical extraction, deletion or membership changes.
-- Service-only atomic country cache/lease in existing product metadata.
-- Normal product enrichment replaces metadata. Keep newer country cache entries
-- across those writes so one worker cannot erase another country's refresh/lease.
CREATE OR REPLACE FUNCTION public.shopping_preserve_country_offer_cache()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE cache jsonb; entry record;
BEGIN
 IF (to_jsonb(NEW)->>'name') IS DISTINCT FROM (to_jsonb(OLD)->>'name')
 OR (to_jsonb(NEW)->>'brand') IS DISTINCT FROM (to_jsonb(OLD)->>'brand')
 OR (to_jsonb(NEW)->>'model') IS DISTINCT FROM (to_jsonb(OLD)->>'model') THEN
  NEW.metadata:=coalesce(NEW.metadata,'{}'::jsonb)-'shopping_country_offers';
  RETURN NEW;
 END IF;
 cache:=CASE WHEN jsonb_typeof(NEW.metadata->'shopping_country_offers')='object' THEN NEW.metadata->'shopping_country_offers' ELSE '{}'::jsonb END;
 FOR entry IN SELECT key,value FROM jsonb_each(CASE WHEN jsonb_typeof(OLD.metadata->'shopping_country_offers')='object' THEN OLD.metadata->'shopping_country_offers' ELSE '{}'::jsonb END) LOOP
  IF NOT cache ? entry.key OR coalesce((entry.value->>'revision')::bigint,0)>=coalesce((cache->entry.key->>'revision')::bigint,0) THEN
   cache:=cache||jsonb_build_object(entry.key,entry.value);
  END IF;
 END LOOP;
 IF cache<>'{}'::jsonb THEN NEW.metadata:=jsonb_set(coalesce(NEW.metadata,'{}'::jsonb),'{shopping_country_offers}',cache); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.shopping_preserve_country_offer_cache() FROM PUBLIC;
CREATE TRIGGER shopping_preserve_catalog_country_cache BEFORE UPDATE ON public.catalog_products
FOR EACH ROW EXECUTE FUNCTION public.shopping_preserve_country_offer_cache();
CREATE TRIGGER shopping_preserve_discovered_country_cache BEFORE UPDATE ON public.discovered_products
FOR EACH ROW EXECUTE FUNCTION public.shopping_preserve_country_offer_cache();

CREATE OR REPLACE FUNCTION public.shopping_country_offer_cache(
 p_kind text,p_product uuid,p_country text,p_evidence jsonb DEFAULT NULL,p_token uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE meta jsonb; entry jsonb; cache jsonb; token uuid; current_time_ms bigint; next_revision bigint;
BEGIN
 IF p_kind IS NULL OR p_country IS NULL OR p_kind NOT IN ('catalog','discovered') OR p_country !~ '^[A-Z]{2}$' THEN
  RAISE EXCEPTION 'invalid country cache key' USING ERRCODE='22023';
 END IF;
 IF p_kind='catalog' THEN SELECT metadata INTO meta FROM catalog_products WHERE id=p_product FOR UPDATE;
 ELSE SELECT metadata INTO meta FROM discovered_products WHERE id=p_product FOR UPDATE; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'product missing' USING ERRCODE='P0002'; END IF;
 meta:=coalesce(meta,'{}'::jsonb);current_time_ms:=(extract(epoch from clock_timestamp())*1000)::bigint;
 cache:=CASE WHEN jsonb_typeof(meta->'shopping_country_offers')='object' THEN meta->'shopping_country_offers' ELSE '{}'::jsonb END;
 entry:=coalesce(cache->p_country,'{}'::jsonb);
 next_revision:=coalesce((entry->>'revision')::bigint,0)+1;
 IF p_evidence IS NULL THEN
  -- Negative results are cached too. Provider calls are bounded across API instances.
  IF coalesce((entry->>'checkedAt')::bigint,0)>current_time_ms-21600000
    OR coalesce((entry->>'leaseUntil')::bigint,0)>current_time_ms THEN
   RETURN jsonb_build_object('claimed',false,'metadata',meta);
  END IF;
  token:=gen_random_uuid();
  entry:=entry||jsonb_build_object('leaseToken',token,'leaseUntil',current_time_ms+60000);
 ELSE
  IF jsonb_typeof(p_evidence)<>'array' OR jsonb_array_length(p_evidence)>30 THEN RAISE EXCEPTION 'invalid evidence'; END IF;
  IF entry->>'leaseToken' IS DISTINCT FROM p_token::text OR p_token IS NULL THEN
   RETURN jsonb_build_object('claimed',false,'metadata',meta);
  END IF;
  entry:=jsonb_build_object('checkedAt',current_time_ms,'evidence',p_evidence);
 END IF;
 entry:=entry||jsonb_build_object('revision',next_revision);
 meta:=jsonb_set(meta,'{shopping_country_offers}',cache||jsonb_build_object(p_country,entry));
 IF p_kind='catalog' THEN UPDATE catalog_products SET metadata=meta WHERE id=p_product;
 ELSE UPDATE discovered_products SET metadata=meta WHERE id=p_product; END IF;
 RETURN jsonb_build_object('claimed',p_evidence IS NULL,'token',token,'metadata',meta);
END $$;
REVOKE ALL ON FUNCTION public.shopping_country_offer_cache(text,uuid,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_country_offer_cache(text,uuid,text,jsonb,uuid) TO service_role;
