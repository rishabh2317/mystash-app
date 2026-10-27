-- Phase 2, local-only preparation. Service flags remain off until a coordinated release.
CREATE INDEX engagement_session_expiry_idx ON public.engagement_interaction_facts(created_at) WHERE session_id IS NOT NULL;
CREATE INDEX engagement_merchant_actor_expiry_idx ON public.engagement_interaction_facts(created_at) WHERE interaction_type='merchant_click' AND actor_user_id IS NOT NULL;
CREATE INDEX product_clicks_actor_expiry_idx ON public.product_clicks(created_at) WHERE user_id IS NOT NULL;

CREATE TABLE public.analytics_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 measurement_enabled boolean NOT NULL DEFAULT false, activity_enabled boolean NOT NULL DEFAULT false,
 personalization_enabled boolean NOT NULL DEFAULT false,
 revision uuid NOT NULL DEFAULT gen_random_uuid(), policy_version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT activity_enabled OR measurement_enabled),
 CHECK(NOT personalization_enabled OR activity_enabled)
);
CREATE TABLE public.analytics_events (
 event_id uuid PRIMARY KEY,event_name text NOT NULL,schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
 occurred_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 session_id uuid,actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,consent_revision uuid,
 entity_type text NOT NULL CHECK(entity_type IN ('app','collection','product','place','place_save','creator','search')),
 entity_id uuid,namespace text CHECK(namespace IS NULL OR namespace IN ('auto','catalog','discovered')),collection_id uuid,creator_id uuid,
 surface text NOT NULL CHECK(surface IN ('app','watch','collection','product','search','stash','creator','other')),
 platform text NOT NULL CHECK(platform IN ('ios','android','web','server')),app_version text NOT NULL,source text NOT NULL CHECK(source IN ('client','server')),
 properties jsonb NOT NULL DEFAULT '{}',
 CHECK(event_name IN ('session.started','collection.impression','collection.opened','product.impression','product.opened',
 'place.impression','place.outbound_requested','creator.profile_opened',
 'search.results_served','search.result_clicked','merchant.outbound_resolved'))
);
CREATE INDEX analytics_events_received_idx ON public.analytics_events(received_at);
CREATE INDEX analytics_events_creator_time_idx ON public.analytics_events(creator_id,occurred_at);
CREATE INDEX analytics_events_actor_time_idx ON public.analytics_events(actor_id,occurred_at) WHERE actor_id IS NOT NULL;
CREATE INDEX analytics_events_session_time_idx ON public.analytics_events(session_id,occurred_at) WHERE session_id IS NOT NULL;
CREATE TABLE public.analytics_search_results (
 request_id uuid PRIMARY KEY,session_id uuid NOT NULL,actor_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 results jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_search_expiry_idx ON public.analytics_search_results(created_at);
CREATE TABLE public.analytics_health_daily (
 day date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),metric text NOT NULL,value bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(day,metric)
);
ALTER TABLE public.analytics_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_search_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_health_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_preferences,public.analytics_events,public.analytics_search_results,public.analytics_health_daily FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.analytics_preferences,public.analytics_events,public.analytics_search_results,public.analytics_health_daily TO service_role;

CREATE FUNCTION public.analytics_health(p_metric text,p_delta integer DEFAULT 1) RETURNS void LANGUAGE sql SET search_path='' AS $$
 INSERT INTO public.analytics_health_daily(day,metric,value) VALUES((now() AT TIME ZONE 'UTC')::date,p_metric,p_delta)
 ON CONFLICT(day,metric) DO UPDATE SET value=public.analytics_health_daily.value+excluded.value;
$$;
CREATE FUNCTION public.analytics_set_preferences(p_user_id uuid,p_measurement boolean,p_activity boolean,p_expected_revision uuid DEFAULT NULL,p_allow_increase boolean DEFAULT true,p_decrease_only boolean DEFAULT false)
RETURNS public.analytics_preferences LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.analytics_preferences; prior public.analytics_preferences; increasing boolean;
BEGIN
 IF p_measurement IS NULL OR p_activity IS NULL OR (p_activity AND NOT p_measurement) THEN
  RAISE EXCEPTION 'Invalid preferences' USING ERRCODE='22023'; END IF;
 -- Same per-account lock as ingestion so a withdrawal cannot race an account-linked insert.
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_user_id,0));
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id AND deleted_at IS NULL AND account_status<>'DELETED') THEN
  RAISE EXCEPTION 'Account unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO prior FROM public.analytics_preferences WHERE user_id=p_user_id;
 IF p_decrease_only THEN
  p_measurement:=coalesce(prior.measurement_enabled,false) AND p_measurement;
  p_activity:=coalesce(prior.activity_enabled,false) AND p_activity;
 END IF;
 increasing:=(p_measurement AND NOT coalesce(prior.measurement_enabled,false)) OR (p_activity AND NOT coalesce(prior.activity_enabled,false));
 IF increasing AND (NOT coalesce(p_allow_increase,false) OR p_expected_revision IS DISTINCT FROM prior.revision) THEN
  RAISE EXCEPTION 'Fresh consent required' USING ERRCODE='40001';END IF;
 IF prior.user_id IS NOT NULL AND prior.measurement_enabled=p_measurement AND prior.activity_enabled=p_activity THEN r:=prior;ELSE
 INSERT INTO public.analytics_preferences(user_id,measurement_enabled,activity_enabled)
 VALUES(p_user_id,p_measurement,p_activity) ON CONFLICT(user_id) DO UPDATE SET
 measurement_enabled=p_measurement,activity_enabled=p_activity,
 personalization_enabled=CASE WHEN p_activity THEN public.analytics_preferences.personalization_enabled ELSE false END,
 revision=gen_random_uuid(),updated_at=now() RETURNING * INTO r;
 END IF;
 -- Preserve aggregate observations, but remove account/session linkage and private entity IDs on withdrawal.
 IF NOT p_activity THEN
  UPDATE public.analytics_events SET actor_id=NULL,session_id=NULL,consent_revision=NULL,
   entity_id=CASE WHEN (creator_id IS NULL AND entity_type IN ('collection','place_save')) OR (namespace='discovered' AND creator_id IS NULL) THEN NULL ELSE entity_id END,
   collection_id=CASE WHEN creator_id IS NULL THEN NULL ELSE collection_id END,
   properties=CASE WHEN event_name='search.result_clicked' THEN '{}'::jsonb ELSE properties END
   WHERE actor_id=p_user_id;
  DELETE FROM public.analytics_search_results WHERE actor_id=p_user_id;
  UPDATE public.engagement_interaction_facts SET session_id=NULL WHERE actor_user_id=p_user_id;
  UPDATE public.engagement_interaction_facts SET actor_user_id=NULL,anonymous_id='redir:'||event_id,
    privacy_class='anonymous',metadata=metadata-'destinationUrl' WHERE actor_user_id=p_user_id AND interaction_type='merchant_click';
  UPDATE public.product_clicks SET user_id=NULL WHERE user_id=p_user_id;
 END IF;
 RETURN r;
END; $$;

CREATE FUNCTION public.analytics_ingest(p_user_id uuid,p_revision uuid,p_events jsonb,p_source text DEFAULT 'client',p_search_results jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE pref public.analytics_preferences; item jsonb; prior public.analytics_events; r public.analytics_events;
 accepted jsonb:='[]';rejected_ids jsonb:='[]'; duplicates integer:=0; rejected integer:=0; owner uuid; visible boolean; private_entity boolean;
 public_content boolean; collection_visible boolean; request_row public.analytics_search_results; result_match jsonb;
BEGIN
 IF p_source NOT IN ('client','server') OR jsonb_typeof(p_events) IS DISTINCT FROM 'array' OR jsonb_array_length(p_events)>50 THEN
  RAISE EXCEPTION 'Invalid batch' USING ERRCODE='22023'; END IF;
 IF p_user_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_user_id,0));
  SELECT * INTO pref FROM public.analytics_preferences WHERE user_id=p_user_id;
  IF NOT FOUND OR NOT pref.measurement_enabled OR pref.revision IS DISTINCT FROM p_revision OR NOT EXISTS(
    SELECT 1 FROM public.users WHERE id=p_user_id AND deleted_at IS NULL AND account_status<>'DELETED'
  ) THEN
   PERFORM public.analytics_health('consent_rejected',jsonb_array_length(p_events));
   RETURN jsonb_build_object('accepted','[]'::jsonb,'rejected',jsonb_array_length(p_events),'consent_rejected',true);
  END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_events) LOOP
  r:=NULL; owner:=NULL; visible:=true; private_entity:=false; public_content:=false;
  r.event_id:=(item->>'event_id')::uuid;r.event_name:=item->>'event_name';r.schema_version:=1;
  r.occurred_at:=(item->>'occurred_at')::timestamptz;r.session_id:=(item->>'session_id')::uuid;
  r.entity_type:=item->>'entity_type';r.entity_id:=(item->>'entity_id')::uuid;r.namespace:=item->>'namespace';
  r.surface:=item->>'surface';r.platform:=item->>'platform';r.app_version:=item->>'app_version';
  r.collection_id:=(item->>'collection_id')::uuid;r.properties:=item->'properties';r.source:=p_source;
  r.received_at:=now();r.updated_at:=now();
  IF r.occurred_at<now()-interval '24 hours' OR r.occurred_at>now()+interval '5 minutes' THEN rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;END IF;
  IF p_source='client' AND r.event_name IN ('merchant.outbound_resolved','search.results_served') THEN rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;END IF;
  IF p_user_id IS NOT NULL AND pref.activity_enabled THEN r.actor_id:=p_user_id;r.consent_revision:=p_revision;END IF;
  IF r.entity_type='collection' THEN r.collection_id:=r.entity_id;
  ELSIF r.entity_type='product' THEN
   IF r.namespace IN ('auto','catalog') AND EXISTS(SELECT 1 FROM public.catalog_products WHERE id=r.entity_id AND status<>'HIDDEN') THEN r.namespace:='catalog';
   ELSIF r.namespace IN ('auto','discovered') AND EXISTS(SELECT 1 FROM public.discovered_products WHERE id=r.entity_id AND internal_status='ACTIVE') AND (EXISTS(
    SELECT 1 FROM public.cart_items WHERE discovered_product_id=r.entity_id AND user_id=p_user_id
   ) OR EXISTS(SELECT 1 FROM public.collection_product_tags WHERE collection_id=r.collection_id AND discovered_product_id=r.entity_id)) THEN r.namespace:='discovered';private_entity:=true;
   ELSE visible:=false;END IF;
  ELSIF r.entity_type IN ('place','place_save') THEN
   private_entity:=r.entity_type='place_save';
   SELECT EXISTS(SELECT 1 FROM public.user_place_saves WHERE user_id=p_user_id AND
    ((r.entity_type='place' AND place_id=r.entity_id) OR (r.entity_type='place_save' AND id=r.entity_id))) INTO visible;
  ELSIF r.entity_type='creator' THEN
   SELECT EXISTS(SELECT 1 FROM public.users WHERE id=r.entity_id AND deleted_at IS NULL AND account_status<>'DELETED') INTO visible;
   IF visible THEN owner:=r.entity_id;public_content:=true;END IF;
  END IF;
  IF r.collection_id IS NOT NULL THEN
   SELECT creator_id, (status='published' AND visibility='public' AND moderation_state='clear' AND deleted_at IS NULL),
    (deleted_at IS NULL AND moderation_state='clear' AND (creator_id=p_user_id OR (status='published' AND visibility IN ('public','unlisted'))))
    INTO owner,public_content,collection_visible FROM public.collections WHERE id=r.collection_id;
   IF NOT FOUND THEN visible:=false;ELSE visible:=coalesce(visible,false) AND coalesce(collection_visible,false);END IF;
   IF r.entity_type='product' AND NOT EXISTS(SELECT 1 FROM public.collection_product_tags
    WHERE collection_id=r.collection_id AND ((r.namespace='catalog' AND catalog_product_id=r.entity_id) OR (r.namespace='discovered' AND discovered_product_id=r.entity_id))) THEN visible:=false;END IF;
  END IF;
  IF visible IS DISTINCT FROM true THEN rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;END IF;
  r.creator_id:=CASE WHEN public_content THEN owner ELSE NULL END;
  IF r.event_name='search.result_clicked' THEN
   SELECT * INTO request_row FROM public.analytics_search_results WHERE request_id=(r.properties->>'request_id')::uuid
    AND session_id=r.session_id AND actor_id IS NOT DISTINCT FROM r.actor_id AND created_at>now()-interval '24 hours';
   IF NOT FOUND THEN rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;END IF;
   SELECT value INTO result_match FROM jsonb_array_elements(request_row.results) WHERE value->>'id'=r.entity_id::text AND
    value->>'entity_type'=r.entity_type AND (value->>'rank')::integer=(r.properties->>'rank')::integer LIMIT 1;
   IF NOT FOUND THEN rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;END IF;
  END IF;
  -- Do not retain IDs that themselves identify a private Stash membership in aggregate-only observations.
  IF r.namespace='discovered' AND public_content THEN private_entity:=false;END IF;
  IF NOT public_content AND r.collection_id IS NOT NULL THEN private_entity:=true; END IF;
  IF private_entity AND r.actor_id IS NULL THEN r.entity_id:=NULL;END IF;
  IF NOT public_content AND r.actor_id IS NULL THEN r.collection_id:=NULL;END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('analytics-event:'||r.event_id,0));
  SELECT * INTO prior FROM public.analytics_events WHERE event_id=r.event_id;
  IF FOUND THEN
   IF prior.actor_id IS DISTINCT FROM r.actor_id OR prior.session_id IS DISTINCT FROM r.session_id OR
    prior.entity_type IS DISTINCT FROM r.entity_type OR prior.entity_id IS DISTINCT FROM r.entity_id OR
    prior.event_name IS DISTINCT FROM r.event_name OR prior.namespace IS DISTINCT FROM r.namespace OR
    prior.surface IS DISTINCT FROM r.surface OR prior.occurred_at IS DISTINCT FROM r.occurred_at THEN
    rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;
   END IF;
   IF r.event_name='search.results_served' AND EXISTS(SELECT 1 FROM public.analytics_search_results
     WHERE request_id=r.event_id AND results IS DISTINCT FROM p_search_results) THEN
    rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;END IF;
   IF prior.properties IS DISTINCT FROM r.properties THEN rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(r.event_id);CONTINUE;
   ELSE duplicates:=duplicates+1;END IF;
  ELSE INSERT INTO public.analytics_events SELECT (r).*;
  END IF;
  IF r.event_name='search.results_served' AND p_search_results IS NOT NULL THEN
   INSERT INTO public.analytics_search_results(request_id,session_id,actor_id,results) VALUES(r.event_id,r.session_id,r.actor_id,p_search_results)
    ON CONFLICT(request_id) DO NOTHING;
  END IF;
  accepted:=accepted||jsonb_build_array(to_jsonb(r.event_id));
 END LOOP;
 PERFORM public.analytics_health('accepted',jsonb_array_length(accepted)-duplicates);
 PERFORM public.analytics_health('duplicates',duplicates);PERFORM public.analytics_health('invalid_or_ineligible',rejected);
 RETURN jsonb_build_object('accepted',accepted,'rejected',rejected,'duplicates',duplicates,'rejected_ids',rejected_ids);
END; $$;

-- Use a separate erasure trigger without requiring a currently active account.
CREATE FUNCTION public.analytics_erase_account_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.account_status<>'DELETED' AND NEW.deleted_at IS NULL THEN RETURN NEW;END IF;
  actor:=NEW.id;
 ELSE actor:=OLD.id;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||actor,0));
 UPDATE public.analytics_events SET actor_id=NULL,session_id=NULL,consent_revision=NULL,
 entity_id=CASE WHEN (creator_id IS NULL AND entity_type IN ('collection','place_save')) OR (namespace='discovered' AND creator_id IS NULL) THEN NULL ELSE entity_id END,
 collection_id=CASE WHEN creator_id IS NULL THEN NULL ELSE collection_id END,
 properties=CASE WHEN event_name='search.result_clicked' THEN '{}'::jsonb ELSE properties END WHERE actor_id=actor;
 DELETE FROM public.analytics_search_results WHERE actor_id=actor;
 DELETE FROM public.analytics_preferences WHERE user_id=actor;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END; $$;
CREATE TRIGGER analytics_soft_delete_erasure AFTER UPDATE OF account_status,deleted_at ON public.users FOR EACH ROW EXECUTE FUNCTION public.analytics_erase_account_trigger();
CREATE TRIGGER analytics_hard_delete_erasure BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.analytics_erase_account_trigger();

CREATE FUNCTION public.analytics_maintenance() RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE removed bigint;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('analytics-maintenance',0)) THEN RETURN NULL;END IF;
 DELETE FROM public.analytics_search_results WHERE created_at<now()-interval '24 hours';
 UPDATE public.analytics_events SET session_id=NULL,consent_revision=NULL,
  properties=CASE WHEN event_name='search.result_clicked' THEN properties-'request_id' ELSE properties END
  WHERE received_at<now()-interval '24 hours' AND session_id IS NOT NULL;
 UPDATE public.engagement_interaction_facts SET session_id=NULL WHERE session_id IS NOT NULL AND created_at<now()-interval '24 hours';
 UPDATE public.engagement_interaction_facts SET actor_user_id=NULL,anonymous_id='redir:'||event_id,
   privacy_class='anonymous',metadata=metadata-'destinationUrl'
   WHERE actor_user_id IS NOT NULL AND interaction_type='merchant_click' AND created_at<now()-interval '7 days';
 UPDATE public.product_clicks SET user_id=NULL WHERE user_id IS NOT NULL AND created_at<now()-interval '7 days';
 DELETE FROM public.analytics_events WHERE received_at<now()-interval '7 days';GET DIAGNOSTICS removed=ROW_COUNT;
 DELETE FROM public.analytics_health_daily WHERE day<(now() AT TIME ZONE 'UTC')::date-90;
 RETURN jsonb_build_object('raw_events_expired',removed);
END; $$;
REVOKE ALL ON FUNCTION public.analytics_health(text,integer),public.analytics_set_preferences(uuid,boolean,boolean,uuid,boolean,boolean),
 public.analytics_ingest(uuid,uuid,jsonb,text,jsonb),public.analytics_maintenance(),public.analytics_erase_account_trigger() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_health(text,integer),public.analytics_set_preferences(uuid,boolean,boolean,uuid,boolean,boolean),
 public.analytics_ingest(uuid,uuid,jsonb,text,jsonb),public.analytics_maintenance() TO service_role;

-- Link existing authoritative actions only for separately opted-in account activity.
ALTER FUNCTION public.engagement_commit(jsonb) RENAME TO engagement_commit_v1;
REVOKE ALL ON FUNCTION public.engagement_commit_v1(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.engagement_commit(p_fact jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid; pref public.analytics_preferences;
BEGIN
 actor:=(p_fact->>'actor_user_id')::uuid;
 IF actor IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||actor,0));
  SELECT * INTO pref FROM public.analytics_preferences WHERE user_id=actor;
 END IF;
 IF pref.measurement_enabled IS DISTINCT FROM true OR pref.activity_enabled IS DISTINCT FROM true OR
  pref.revision IS DISTINCT FROM (p_fact->>'measurement_revision')::uuid THEN p_fact:=p_fact-'session_id';END IF;
 IF p_fact->>'interaction_type'='merchant_click'
  AND (pref.activity_enabled IS DISTINCT FROM true OR pref.measurement_enabled IS DISTINCT FROM true OR
   pref.revision IS DISTINCT FROM (p_fact->>'measurement_revision')::uuid) THEN
  p_fact:=p_fact||jsonb_build_object('actor_user_id',NULL,'anonymous_id','redir:'||(p_fact->>'event_id'),'session_id',NULL);
 END IF;
 RETURN public.engagement_commit_v1(p_fact-'measurement_revision'-'measurement_context');
END; $$;
REVOKE ALL ON FUNCTION public.engagement_commit(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_commit(jsonb) TO service_role;

-- Optional shopping account linkage uses the same consent lock, including legacy analytics rows.
CREATE FUNCTION public.analytics_record_legacy_click(p_user_id uuid,p_revision uuid,p_row jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE pref public.analytics_preferences;r public.product_clicks;
BEGIN
 IF p_user_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_user_id,0));
  SELECT * INTO pref FROM public.analytics_preferences WHERE user_id=p_user_id;
 END IF;
 r:=jsonb_populate_record(NULL::public.product_clicks,p_row);r.id:=gen_random_uuid();r.created_at:=now();r.user_id:=NULL;
 IF pref.measurement_enabled AND pref.activity_enabled AND pref.revision=p_revision AND EXISTS(
  SELECT 1 FROM public.users WHERE id=p_user_id AND deleted_at IS NULL AND account_status<>'DELETED'
 ) THEN r.user_id:=p_user_id;END IF;
 INSERT INTO public.product_clicks SELECT (r).* ON CONFLICT(event_id) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.analytics_record_legacy_click(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_record_legacy_click(uuid,uuid,jsonb) TO service_role;
