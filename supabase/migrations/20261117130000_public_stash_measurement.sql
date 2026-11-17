BEGIN;
-- Existing consent-aware analytics pipeline; no second collector or visitor identity store.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.analytics_events'::regclass AND contype='c' LOOP
  IF c.def LIKE '%event_name%' THEN
   EXECUTE format('ALTER TABLE public.analytics_events DROP CONSTRAINT %I',c.conname);
   EXECUTE format('ALTER TABLE public.analytics_events ADD CONSTRAINT %I %s',c.conname,replace(c.def,'event_name = ANY (ARRAY[','event_name = ANY (ARRAY[''stash.opened''::text, ''stash.item_saved''::text, ''place.opened''::text, '));
  ELSIF c.def LIKE '%surface%' THEN
   EXECUTE format('ALTER TABLE public.analytics_events DROP CONSTRAINT %I',c.conname);
   EXECUTE format('ALTER TABLE public.analytics_events ADD CONSTRAINT %I %s',c.conname,replace(c.def,'surface = ANY (ARRAY[','surface = ANY (ARRAY[''public_stash''::text, '));
  END IF;
 END LOOP;
END $$;
CREATE INDEX analytics_stash_received ON public.analytics_events((properties->>'public_stash_id'),event_name,received_at) WHERE surface='public_stash';
CREATE TABLE public.analytics_public_stash_daily(
 public_stash_id uuid NOT NULL REFERENCES public.public_stashes(public_id) ON DELETE CASCADE,
 day date NOT NULL,metric text NOT NULL CHECK(metric IN('views','product_opens','place_opens','saves','shopping_clicks')),
 value bigint NOT NULL CHECK(value>=0),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(public_stash_id,day,metric)
);
ALTER TABLE public.analytics_public_stash_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_public_stash_daily FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.analytics_public_stash_daily TO service_role;
CREATE FUNCTION public.public_stash_rollup_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE metric_name text;stash uuid;
BEGIN
 IF NEW.surface<>'public_stash' OR NEW.properties->>'stash_deduplicated'='true' THEN RETURN NEW;END IF;
 stash:=(NEW.properties->>'public_stash_id')::uuid;
 metric_name:=CASE NEW.event_name WHEN 'stash.opened' THEN 'views' WHEN 'product.opened' THEN 'product_opens' WHEN 'place.opened' THEN 'place_opens' WHEN 'stash.item_saved' THEN 'saves' WHEN 'merchant.outbound_resolved' THEN 'shopping_clicks' END;
 IF stash IS NOT NULL AND metric_name IS NOT NULL THEN
  INSERT INTO analytics_public_stash_daily(public_stash_id,day,metric,value) VALUES(stash,(NEW.received_at AT TIME ZONE 'UTC')::date,metric_name,1)
  ON CONFLICT(public_stash_id,day,metric) DO UPDATE SET value=analytics_public_stash_daily.value+1,updated_at=clock_timestamp();
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER public_stash_rollup_event AFTER INSERT ON public.analytics_events FOR EACH ROW EXECUTE FUNCTION public.public_stash_rollup_event();
-- Patch the current installed ingestion function, preserving all Find/consent fixes.
DO $$ DECLARE f text;needle text;replacement text;BEGIN
 SELECT pg_get_functiondef(oid) INTO f FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='analytics_ingest';
 needle:='IF visible IS DISTINCT FROM true THEN';
 replacement:=$patch$
 IF r.surface='public_stash' THEN
  IF r.event_name NOT IN('stash.opened','product.opened','place.opened','stash.item_saved','merchant.outbound_resolved') OR
   NOT (r.properties ? 'public_stash_id') OR (r.event_name='stash.item_saved' AND p_source<>'server') THEN
   rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;
  END IF;
  owner:=public.public_stash_visible_owner((r.properties->>'public_stash_id')::uuid);
  IF owner IS NULL OR owner=p_user_id THEN rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;END IF;
  IF r.event_name<>'stash.opened' THEN
   BEGIN
    PERFORM public.public_stash_item((r.properties->>'public_stash_id')::uuid,CASE WHEN r.entity_type='place' THEN 'place' ELSE 'product' END,coalesce(r.namespace,'place'),r.entity_id);
   EXCEPTION WHEN no_data_found THEN rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;END;
  END IF;
  visible:=true;private_entity:=false;public_content:=false;owner:=NULL;r.collection_id:=NULL;
  IF r.event_name='stash.opened' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('stash-view:'||r.session_id::text||':'||(r.properties->>'public_stash_id'),0));
   IF EXISTS(SELECT 1 FROM public.analytics_events WHERE event_id=r.event_id) THEN
    SELECT properties INTO r.properties FROM public.analytics_events WHERE event_id=r.event_id;
   ELSIF EXISTS(SELECT 1 FROM public.analytics_events WHERE surface='public_stash' AND event_name='stash.opened' AND session_id=r.session_id
    AND properties->>'public_stash_id'=r.properties->>'public_stash_id' AND received_at>now()-interval '30 minutes') THEN
    r.properties:=r.properties||jsonb_build_object('stash_deduplicated',true);
   END IF;
  END IF;
 ELSIF r.properties ? 'public_stash_id' OR r.event_name IN('stash.opened','stash.item_saved','place.opened') THEN
  rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;
 END IF;
 IF visible IS DISTINCT FROM true THEN
$patch$;
 IF position(needle IN f)=0 THEN RAISE EXCEPTION 'Analytics ingestion contract changed';END IF;
 EXECUTE replace(f,needle,replacement);
END $$;
CREATE FUNCTION public.public_stash_insights(p_user uuid,p_days integer DEFAULT 7) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF p_days NOT IN(7,30) THEN RAISE EXCEPTION 'Invalid range' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_object_agg(metric,total),'{}'::jsonb) INTO result FROM(
 SELECT d.metric,sum(d.value) AS total FROM analytics_public_stash_daily d JOIN public_stashes s ON s.public_id=d.public_stash_id
 WHERE s.user_id=p_user AND d.day>=(now() AT TIME ZONE 'UTC')::date-p_days+1 GROUP BY d.metric) x;
 RETURN jsonb_build_object('days',p_days,'metrics',result,'refreshedAt',clock_timestamp(),'coverage','partial');
END $$;
CREATE FUNCTION public.public_stash_measurement_maintenance() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DELETE FROM analytics_public_stash_daily WHERE day<(now() AT TIME ZONE 'UTC')::date-interval '13 months';
 DELETE FROM analytics_public_stash_daily WHERE public_stash_id IN(SELECT s.public_id FROM public_stashes s JOIN users u ON u.id=s.user_id WHERE u.deleted_at IS NOT NULL OR u.account_status='DELETED');
$$;
CREATE OR REPLACE FUNCTION public.public_stash_account_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL OR NEW.account_status='DELETED' THEN
  UPDATE public_stashes SET visibility='private',version=version+1,updated_at=clock_timestamp() WHERE user_id=NEW.id AND visibility<>'private';
  DELETE FROM analytics_public_stash_daily WHERE public_stash_id IN(SELECT public_id FROM public_stashes WHERE user_id=NEW.id);
 END IF;RETURN NEW;
END $$;
DO $$ DECLARE p regprocedure;BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'public_stash_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p);END LOOP;
END $$;
COMMIT;
