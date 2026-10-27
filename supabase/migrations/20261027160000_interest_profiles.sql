-- Phase 5 local preparation. Purpose-specific opt-in; no recommendation consumer is enabled.
ALTER TABLE public.analytics_preferences
 ADD COLUMN personalization_since timestamptz,
 ADD COLUMN personalization_revision uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN personalization_policy_version integer NOT NULL DEFAULT 1,
 ADD COLUMN personalization_lease_until timestamptz;
-- Earlier phases never offered this purpose. Do not inherit any unsupported preexisting true bit.
UPDATE public.analytics_preferences SET personalization_enabled=false;
ALTER TABLE public.analytics_preferences ADD CONSTRAINT analytics_personalization_since_chk
 CHECK(NOT personalization_enabled OR personalization_since IS NOT NULL);
CREATE TABLE public.analytics_interest_profiles (
 user_id uuid PRIMARY KEY REFERENCES public.analytics_preferences(user_id) ON DELETE CASCADE,
 consent_revision uuid NOT NULL,version integer NOT NULL CHECK(version=1),
 built_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 features jsonb NOT NULL CHECK(jsonb_typeof(features)='array' AND jsonb_array_length(features)<=50),
 source_capped boolean NOT NULL DEFAULT false,
 CHECK(octet_length(features::text)<=32768)
);
CREATE INDEX analytics_interest_expiry_idx ON public.analytics_interest_profiles(expires_at);
CREATE INDEX analytics_personalization_pending_idx ON public.analytics_preferences(personalization_lease_until)
 WHERE personalization_enabled;
ALTER TABLE public.analytics_interest_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_interest_profiles FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.analytics_interest_profiles TO service_role;

CREATE FUNCTION public.analytics_interest_preferences_before() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT NEW.measurement_enabled OR NOT NEW.activity_enabled OR NEW.personalization_policy_version<>1 THEN
  NEW.personalization_enabled:=false;
 END IF;
 IF NOT NEW.personalization_enabled THEN
  NEW.personalization_since:=NULL;NEW.personalization_lease_until:=NULL;
  IF OLD.personalization_enabled THEN NEW.personalization_revision:=gen_random_uuid();END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION public.analytics_interest_preferences_after() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT NEW.personalization_enabled OR NEW.personalization_revision IS DISTINCT FROM OLD.personalization_revision THEN
  DELETE FROM public.analytics_interest_profiles WHERE user_id=NEW.user_id;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER analytics_interest_preferences_before BEFORE UPDATE ON public.analytics_preferences
 FOR EACH ROW EXECUTE FUNCTION public.analytics_interest_preferences_before();
CREATE TRIGGER analytics_interest_preferences_after AFTER UPDATE ON public.analytics_preferences
 FOR EACH ROW EXECUTE FUNCTION public.analytics_interest_preferences_after();
CREATE FUNCTION public.analytics_interest_account_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL OR NEW.account_status<>'ACTIVE' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||NEW.id,0));
  UPDATE public.analytics_preferences SET personalization_enabled=false WHERE user_id=NEW.id;
  DELETE FROM public.analytics_interest_profiles WHERE user_id=NEW.id;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER analytics_interest_account_erasure AFTER UPDATE OF account_status,deleted_at ON public.users
 FOR EACH ROW EXECUTE FUNCTION public.analytics_interest_account_erasure();

CREATE FUNCTION public.analytics_personalization_settings(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.analytics_preferences;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id AND deleted_at IS NULL AND account_status<>'DELETED') THEN
  RAISE EXCEPTION 'Account unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p_user_id;
 RETURN jsonb_build_object('enabled',coalesce(p.personalization_enabled,false),'revision',p.personalization_revision,
  'policy_version',coalesce(p.personalization_policy_version,1),'since',p.personalization_since);
END; $$;
CREATE FUNCTION public.analytics_set_personalization(p_user_id uuid,p_enabled boolean,p_expected_revision uuid DEFAULT NULL,p_measurement_revision uuid DEFAULT NULL,p_policy integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.analytics_preferences;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_user_id,0));
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Invalid preference' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id AND deleted_at IS NULL AND account_status<>'DELETED') THEN
  RAISE EXCEPTION 'Account unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p_user_id;
 IF p_enabled THEN
  IF p_policy IS DISTINCT FROM 1 OR p.personalization_policy_version IS DISTINCT FROM 1 OR
   p.personalization_revision IS DISTINCT FROM p_expected_revision OR p_expected_revision IS NULL OR
   p.revision IS DISTINCT FROM p_measurement_revision OR p_measurement_revision IS NULL OR
   p.measurement_enabled IS DISTINCT FROM true OR p.activity_enabled IS DISTINCT FROM true OR
   NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id AND account_status='ACTIVE') THEN
   RAISE EXCEPTION 'Fresh consent required' USING ERRCODE='40001';END IF;
  IF NOT p.personalization_enabled THEN
   UPDATE public.analytics_preferences SET personalization_enabled=true,personalization_since=clock_timestamp(),
    personalization_revision=gen_random_uuid(),personalization_lease_until=NULL WHERE user_id=p_user_id;
  END IF;
 ELSE
  UPDATE public.analytics_preferences SET personalization_enabled=false,personalization_revision=gen_random_uuid(),personalization_lease_until=NULL WHERE user_id=p_user_id;
  DELETE FROM public.analytics_interest_profiles WHERE user_id=p_user_id;
 END IF;
 RETURN public.analytics_personalization_settings(p_user_id);
END; $$;
CREATE FUNCTION public.analytics_reset_interests(p_user_id uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_user_id,0));
 UPDATE public.analytics_preferences SET personalization_revision=gen_random_uuid(),
  personalization_since=CASE WHEN personalization_enabled THEN clock_timestamp() ELSE NULL END,
  personalization_lease_until=NULL WHERE user_id=p_user_id;
 DELETE FROM public.analytics_interest_profiles WHERE user_id=p_user_id;
END; $$;

CREATE FUNCTION public.analytics_interest_visible(p_user_id uuid,p_kind text,p_id uuid,p_namespace text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.engagement_relationship_edges e WHERE e.user_id=p_user_id AND e.edge_type='HIDE' AND e.state='ACTIVE'
  AND ((p_kind='product' AND p_namespace='catalog' AND e.object_type='catalog_product' AND e.object_id=p_id::text)
   OR (p_kind='collection' AND e.object_type IN ('collection','reel') AND (e.object_id=p_id::text OR EXISTS(
    SELECT 1 FROM public.videos v WHERE v.id::text=e.object_id AND v.collection_id=p_id)))
   OR (p_kind='creator' AND e.object_type='creator' AND e.object_id=p_id::text))) THEN RETURN false;END IF;
 IF p_kind='creator' THEN RETURN p_id<>p_user_id AND EXISTS(SELECT 1 FROM public.users WHERE id=p_id AND creator_status='ACTIVE' AND account_status='ACTIVE' AND deleted_at IS NULL);END IF;
 IF p_kind='collection' THEN RETURN EXISTS(SELECT 1 FROM public.collections WHERE id=p_id AND creator_id<>p_user_id
  AND status='published' AND visibility='public' AND moderation_state='clear' AND deleted_at IS NULL);END IF;
 IF p_kind='product' AND p_namespace='catalog' THEN RETURN EXISTS(SELECT 1 FROM public.catalog_products WHERE id=p_id AND status<>'HIDDEN');END IF;
 IF p_kind='product' AND p_namespace='discovered' THEN RETURN EXISTS(SELECT 1 FROM public.discovered_products d WHERE d.id=p_id AND d.internal_status='ACTIVE')
  AND (EXISTS(SELECT 1 FROM public.cart_items WHERE user_id=p_user_id AND discovered_product_id=p_id)
   OR EXISTS(SELECT 1 FROM public.collection_product_tags t JOIN public.collections c ON c.id=t.collection_id
    WHERE t.discovered_product_id=p_id AND c.status='published' AND c.visibility='public' AND c.moderation_state='clear' AND c.deleted_at IS NULL));END IF;
 RETURN false;
END; $$;
CREATE FUNCTION public.analytics_interest_explicit(p_user_id uuid,p_kind text,p_id uuid,p_namespace text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(s),'[]') FROM (
  SELECT 'followed_creator'::text AS s WHERE p_kind='creator' AND EXISTS(SELECT 1 FROM public.engagement_relationship_edges
   WHERE user_id=p_user_id AND edge_type='FOLLOW' AND state='ACTIVE' AND object_type='creator' AND object_id=p_id::text)
  UNION SELECT 'saved_collection' WHERE p_kind='collection' AND EXISTS(SELECT 1 FROM public.engagement_relationship_edges
   WHERE user_id=p_user_id AND edge_type='SAVE' AND state='ACTIVE' AND object_type='collection' AND object_id=p_id::text)
  UNION SELECT 'saved_product' WHERE p_kind='product' AND (EXISTS(SELECT 1 FROM public.cart_items WHERE user_id=p_user_id
   AND ((p_namespace='catalog' AND catalog_product_id=p_id) OR (p_namespace='discovered' AND discovered_product_id=p_id))) OR
   (p_namespace='catalog' AND EXISTS(SELECT 1 FROM public.engagement_relationship_edges WHERE user_id=p_user_id AND edge_type IN ('SAVE','WISHLIST') AND state='ACTIVE' AND object_type='catalog_product' AND object_id=p_id::text)))
 ) refs;
$$;
CREATE FUNCTION public.analytics_interest_source(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.analytics_preferences;result jsonb; observed_at timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_user_id,0));
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p_user_id;
 observed_at:=clock_timestamp();
 IF p.personalization_enabled IS DISTINCT FROM true OR p.measurement_enabled IS DISTINCT FROM true OR p.activity_enabled IS DISTINCT FROM true
  OR p.personalization_policy_version IS DISTINCT FROM 1 OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id AND account_status='ACTIVE' AND deleted_at IS NULL) THEN RETURN NULL;END IF;
 WITH refs AS (
  SELECT 'product'::text AS kind,coalesce(catalog_product_id,discovered_product_id) AS id,
   CASE WHEN catalog_product_id IS NOT NULL THEN 'catalog' ELSE 'discovered' END AS namespace,updated_at AS changed_at FROM public.cart_items WHERE user_id=p_user_id
  UNION ALL SELECT CASE object_type WHEN 'creator' THEN 'creator' WHEN 'collection' THEN 'collection' ELSE 'product' END,
   object_id::uuid,CASE WHEN object_type='catalog_product' THEN 'catalog' ELSE NULL END,updated_at
   FROM public.engagement_relationship_edges WHERE user_id=p_user_id AND state='ACTIVE' AND
   ((edge_type='FOLLOW' AND object_type='creator') OR (edge_type='SAVE' AND object_type='collection') OR (edge_type IN ('SAVE','WISHLIST') AND object_type='catalog_product'))
   AND object_id~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 ), explicit_refs AS (
  SELECT kind,id,namespace,max(changed_at) AS changed_at FROM refs WHERE id IS NOT NULL AND public.analytics_interest_visible(p_user_id,kind,id,namespace)
  GROUP BY kind,id,namespace ORDER BY max(changed_at) DESC,id,kind,namespace LIMIT 201
 ), positive AS (
  SELECT r.kind,r.id::text AS key,r.namespace,public.analytics_interest_explicit(p_user_id,r.kind,r.id,r.namespace) AS sources,
   CASE WHEN coalesce(cp.category,dp.category) IN ('sports','fashion','beauty','electronics','home','food','automotive','outdoors','gaming','travel') THEN coalesce(cp.category,dp.category) END AS category,
   c.creator_id FROM explicit_refs r LEFT JOIN public.catalog_products cp ON r.kind='product' AND r.namespace='catalog' AND cp.id=r.id
   LEFT JOIN public.discovered_products dp ON r.kind='product' AND r.namespace='discovered' AND dp.id=r.id
   LEFT JOIN public.collections c ON r.kind='collection' AND c.id=r.id
 ), observations AS (
  SELECT e.event_name AS name,CASE WHEN e.entity_type='product' THEN 'product' WHEN e.entity_type='creator' THEN 'creator' ELSE 'collection' END AS kind,
   e.entity_id::text AS key,e.namespace,e.occurred_at,
   CASE WHEN coalesce(cp.category,dp.category) IN ('sports','fashion','beauty','electronics','home','food','automotive','outdoors','gaming','travel') THEN coalesce(cp.category,dp.category) END AS category,c.creator_id
  FROM public.analytics_events e
  LEFT JOIN public.catalog_products cp ON e.entity_type='product' AND e.namespace='catalog' AND cp.id=e.entity_id
  LEFT JOIN public.discovered_products dp ON e.entity_type='product' AND e.namespace='discovered' AND dp.id=e.entity_id
  LEFT JOIN public.collections c ON e.entity_type='collection' AND c.id=e.entity_id
  WHERE e.actor_id=p_user_id AND e.event_name IN ('product.opened','collection.opened','creator.profile_opened','merchant.outbound_resolved')
   AND e.occurred_at>=greatest(p.personalization_since,observed_at-interval '7 days') AND e.received_at>=p.personalization_since AND e.occurred_at<=observed_at
   AND public.analytics_interest_visible(p_user_id,CASE e.entity_type WHEN 'product' THEN 'product' WHEN 'creator' THEN 'creator' ELSE 'collection' END,e.entity_id,e.namespace)
   AND NOT EXISTS(SELECT 1 FROM public.engagement_interaction_facts f WHERE f.actor_user_id=p_user_id
    AND f.created_at>=p.personalization_since AND f.created_at<=observed_at AND f.created_at>e.occurred_at AND
    ((e.entity_type='collection' AND f.object_type='collection' AND f.object_id=e.entity_id::text AND f.interaction_type='unsave') OR
     (e.entity_type='creator' AND f.object_type='creator' AND f.object_id=e.entity_id::text AND f.interaction_type='unfollow')))
  ORDER BY e.occurred_at DESC,e.event_id LIMIT 2001
 ) SELECT jsonb_build_object('revision',p.personalization_revision,'since',p.personalization_since,'observed_at',observed_at,'policy_version',1,
  'current',coalesce((SELECT jsonb_agg(to_jsonb(positive)) FROM positive),'[]'),
  'events',coalesce((SELECT jsonb_agg(to_jsonb(observations)) FROM observations),'[]')) INTO result;
 RETURN result;
END; $$;
CREATE FUNCTION public.analytics_interest_store(p_user_id uuid,p_revision uuid,p_features jsonb,p_capped boolean DEFAULT false,p_observed_at timestamptz DEFAULT clock_timestamp())
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.analytics_preferences;f jsonb;kept jsonb:='[]';sources jsonb;boost numeric;stored boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_user_id,0));
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p_user_id;
 IF p_revision IS NULL OR p.personalization_enabled IS DISTINCT FROM true OR p.measurement_enabled IS DISTINCT FROM true OR p.activity_enabled IS DISTINCT FROM true
  OR p.personalization_revision IS DISTINCT FROM p_revision OR p.personalization_policy_version IS DISTINCT FROM 1 OR NOT EXISTS(
   SELECT 1 FROM public.users WHERE id=p_user_id AND account_status='ACTIVE' AND deleted_at IS NULL) THEN RETURN false;END IF;
 IF p_observed_at IS NULL OR p_observed_at<clock_timestamp()-interval '5 minutes' OR p_observed_at>clock_timestamp()+interval '1 minute' OR p_observed_at<p.personalization_since THEN RETURN false;END IF;
 IF jsonb_typeof(p_features) IS DISTINCT FROM 'array' OR jsonb_array_length(p_features)>50 OR octet_length(p_features::text)>32768 THEN RAISE EXCEPTION 'Invalid features' USING ERRCODE='22023';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_features) LOOP
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid features' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('kind','key','namespace','explicit_sources','explicit_score','inferred_score','score','evidence_days','evidence_entities','last_day','confidence')) OR
   NOT f ?& ARRAY['kind','key','namespace','explicit_sources','explicit_score','inferred_score','score','evidence_days','evidence_entities','last_day','confidence'] OR
   jsonb_typeof(f->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'key') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'confidence') IS DISTINCT FROM 'string' OR
   jsonb_typeof(f->'score') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'explicit_score') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'inferred_score') IS DISTINCT FROM 'number' OR
   jsonb_typeof(f->'evidence_days') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'evidence_entities') IS DISTINCT FROM 'number' OR
   jsonb_typeof(f->'last_day') NOT IN ('null','string') OR
   f->>'kind' NOT IN ('product','collection','creator','category') OR f->>'confidence' NOT IN ('explicit','supported','emerging') OR
   jsonb_typeof(f->'explicit_sources')<>'array' OR jsonb_array_length(f->'explicit_sources')>3 OR
   EXISTS(SELECT 1 FROM jsonb_array_elements_text(f->'explicit_sources') s WHERE s NOT IN ('saved_product','saved_collection','followed_creator')) OR
   (f->>'score')::numeric NOT BETWEEN 0 AND 20 OR (f->>'explicit_score')::numeric NOT BETWEEN 0 AND 8 OR (f->>'inferred_score')::numeric NOT BETWEEN 0 AND 12 OR
   (f->>'evidence_days')::int NOT BETWEEN 0 AND 8 OR (f->>'evidence_entities')::int NOT BETWEEN 0 AND 200 THEN RAISE EXCEPTION 'Invalid features' USING ERRCODE='22023';END IF;
  IF (f->>'evidence_days')::numeric<>trunc((f->>'evidence_days')::numeric) OR (f->>'evidence_entities')::numeric<>trunc((f->>'evidence_entities')::numeric) OR
   (f->>'last_day' IS NOT NULL AND (f->>'last_day' !~ '^\d{4}-\d{2}-\d{2}$' OR (f->>'last_day')::date NOT BETWEEN (now() AT TIME ZONE 'UTC')::date-7 AND (now() AT TIME ZONE 'UTC')::date)) THEN RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='22023';END IF;
  IF f->>'kind'='category' THEN
   IF f->>'key' NOT IN ('sports','fashion','beauty','electronics','home','food','automotive','outdoors','gaming','travel') OR f->>'namespace' IS NOT NULL OR jsonb_array_length(f->'explicit_sources')<>0 OR (f->>'explicit_score')::numeric<>0 THEN RAISE EXCEPTION 'Invalid category' USING ERRCODE='22023';END IF;
   f:=f||jsonb_build_object('score',(f->>'inferred_score')::numeric,'confidence',CASE WHEN ((f->>'evidence_days')::int>=2 OR (f->>'evidence_entities')::int>=2) AND (f->>'inferred_score')::numeric>=1 THEN 'supported' ELSE 'emerging' END);
  ELSE
   IF f->>'key' !~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
    ((f->>'kind'='product' AND coalesce(f->>'namespace','') NOT IN ('catalog','discovered')) OR (f->>'kind'<>'product' AND f->>'namespace' IS NOT NULL)) THEN RAISE EXCEPTION 'Invalid reference' USING ERRCODE='22023';END IF;
   IF NOT public.analytics_interest_visible(p_user_id,f->>'kind',(f->>'key')::uuid,f->>'namespace') THEN CONTINUE;END IF;
   sources:=public.analytics_interest_explicit(p_user_id,f->>'kind',(f->>'key')::uuid,f->>'namespace');
   boost:=CASE WHEN sources ? 'followed_creator' THEN 8 WHEN sources ? 'saved_product' THEN 6 WHEN sources ? 'saved_collection' THEN 5 ELSE 0 END;
   f:=f||jsonb_build_object('explicit_sources',sources,'explicit_score',boost,'score',least(20,boost+(f->>'inferred_score')::numeric),
    'confidence',CASE WHEN boost>0 THEN 'explicit' WHEN ((f->>'evidence_days')::int>=2 OR (f->>'kind'='creator' AND (f->>'evidence_entities')::int>=2)) AND (f->>'inferred_score')::numeric>=1 THEN 'supported' ELSE 'emerging' END);
  END IF;
  kept:=kept||jsonb_build_array(f);
 END LOOP;
 INSERT INTO public.analytics_interest_profiles(user_id,consent_revision,version,built_at,expires_at,features,source_capped)
 VALUES(p_user_id,p_revision,1,p_observed_at,p_observed_at+interval '24 hours',kept,coalesce(p_capped,false))
 ON CONFLICT(user_id) DO UPDATE SET consent_revision=excluded.consent_revision,version=1,built_at=excluded.built_at,expires_at=excluded.expires_at,features=excluded.features,source_capped=excluded.source_capped
 WHERE public.analytics_interest_profiles.built_at<=excluded.built_at;
 stored:=FOUND;
 UPDATE public.analytics_preferences SET personalization_lease_until=NULL WHERE user_id=p_user_id;
 RETURN stored;
END; $$;
CREATE FUNCTION public.analytics_interest_read(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.analytics_preferences;r public.analytics_interest_profiles;f jsonb;kept jsonb:='[]';sources jsonb;boost numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_user_id,0));
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p_user_id;
 IF p.personalization_enabled IS DISTINCT FROM true OR p.measurement_enabled IS DISTINCT FROM true OR p.activity_enabled IS DISTINCT FROM true OR p.personalization_policy_version IS DISTINCT FROM 1
  OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id AND account_status='ACTIVE' AND deleted_at IS NULL) THEN RETURN jsonb_build_object('status','disabled','features','[]'::jsonb);END IF;
 SELECT * INTO r FROM public.analytics_interest_profiles WHERE user_id=p_user_id AND consent_revision=p.personalization_revision AND version=1;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','insufficient','features','[]'::jsonb);END IF;
 IF r.expires_at<=now() OR r.built_at<now()-interval '2 hours' THEN RETURN jsonb_build_object('status','stale','features','[]'::jsonb);END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(r.features) LOOP
  IF f->>'kind'<>'category' THEN
   IF NOT public.analytics_interest_visible(p_user_id,f->>'kind',(f->>'key')::uuid,f->>'namespace') THEN CONTINUE;END IF;
   sources:=public.analytics_interest_explicit(p_user_id,f->>'kind',(f->>'key')::uuid,f->>'namespace');
   boost:=CASE WHEN sources ? 'followed_creator' THEN 8 WHEN sources ? 'saved_product' THEN 6 WHEN sources ? 'saved_collection' THEN 5 ELSE 0 END;
   IF EXISTS(SELECT 1 FROM public.engagement_interaction_facts WHERE actor_user_id=p_user_id AND created_at>=r.built_at AND object_id=f->>'key'
    AND ((f->>'kind'='collection' AND object_type='collection' AND interaction_type='unsave') OR(f->>'kind'='creator' AND object_type='creator' AND interaction_type='unfollow'))) THEN
    f:=f||jsonb_build_object('inferred_score',0,'evidence_days',0);END IF;
   f:=f||jsonb_build_object('explicit_sources',sources,'explicit_score',boost,'score',least(20,boost+(f->>'inferred_score')::numeric),
    'confidence',CASE WHEN boost>0 THEN 'explicit' WHEN ((f->>'evidence_days')::int>=2 OR (f->>'kind'='creator' AND (f->>'evidence_entities')::int>=2)) AND (f->>'inferred_score')::numeric>=1 THEN 'supported' ELSE 'emerging' END);
  END IF;
  kept:=kept||jsonb_build_array(f);
 END LOOP;
 RETURN jsonb_build_object('status',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(kept) x WHERE x->>'confidence' IN ('explicit','supported') AND (x->>'score')::numeric>=1) THEN 'ready' ELSE 'insufficient' END,
  'version',1,'policy_version',1,'built_at',r.built_at,'expires_at',r.expires_at,'source_capped',r.source_capped,'features',kept);
END; $$;
CREATE FUNCTION public.analytics_interest_claim(p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ids jsonb;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 100 OR p_limit IS NULL THEN RAISE EXCEPTION 'Invalid batch size' USING ERRCODE='22023';END IF;
 WITH picked AS (
  SELECT p.user_id FROM public.analytics_preferences p JOIN public.users u ON u.id=p.user_id
  LEFT JOIN public.analytics_interest_profiles i ON i.user_id=p.user_id
  WHERE p.personalization_enabled AND p.measurement_enabled AND p.activity_enabled AND p.personalization_policy_version=1
   AND u.account_status='ACTIVE' AND u.deleted_at IS NULL AND (p.personalization_lease_until IS NULL OR p.personalization_lease_until<now())
   AND (i.built_at IS NULL OR i.built_at<now()-interval '1 hour')
   AND (p.personalization_since>=now()-interval '24 hours' OR EXISTS(SELECT 1 FROM public.analytics_events e WHERE e.actor_id=p.user_id AND e.received_at>=now()-interval '24 hours'))
  ORDER BY i.built_at NULLS FIRST,p.user_id LIMIT p_limit FOR UPDATE OF p SKIP LOCKED
 ), claimed AS (
  UPDATE public.analytics_preferences p SET personalization_lease_until=clock_timestamp()+interval '2 minutes' FROM picked
  WHERE p.user_id=picked.user_id RETURNING p.user_id
 ) SELECT coalesce(jsonb_agg(user_id),'[]') INTO ids FROM claimed;
 RETURN ids;
END; $$;
CREATE FUNCTION public.analytics_interest_retention() RETURNS void LANGUAGE sql SET search_path='' AS $$
 DELETE FROM public.analytics_interest_profiles i WHERE i.expires_at<=now() OR NOT EXISTS(
  SELECT 1 FROM public.analytics_preferences p JOIN public.users u ON u.id=p.user_id
  WHERE p.user_id=i.user_id AND p.personalization_enabled AND p.measurement_enabled AND p.activity_enabled
   AND p.personalization_policy_version=1 AND p.personalization_revision=i.consent_revision AND u.account_status='ACTIVE' AND u.deleted_at IS NULL);
$$;
ALTER FUNCTION public.analytics_maintenance() RENAME TO analytics_maintenance_v4;
CREATE FUNCTION public.analytics_maintenance() RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM public.analytics_interest_retention();RETURN public.analytics_maintenance_v4();
END; $$;
REVOKE ALL ON FUNCTION public.analytics_interest_preferences_before(),public.analytics_interest_preferences_after(),public.analytics_interest_account_erasure() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.analytics_personalization_settings(uuid),public.analytics_set_personalization(uuid,boolean,uuid,uuid,integer),public.analytics_reset_interests(uuid),
 public.analytics_interest_visible(uuid,text,uuid,text),public.analytics_interest_explicit(uuid,text,uuid,text),public.analytics_interest_source(uuid),
 public.analytics_interest_store(uuid,uuid,jsonb,boolean,timestamptz),public.analytics_interest_read(uuid),public.analytics_interest_claim(integer),public.analytics_interest_retention(),public.analytics_maintenance() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_personalization_settings(uuid),public.analytics_set_personalization(uuid,boolean,uuid,uuid,integer),public.analytics_reset_interests(uuid),
 public.analytics_interest_visible(uuid,text,uuid,text),public.analytics_interest_explicit(uuid,text,uuid,text),public.analytics_interest_source(uuid),
 public.analytics_interest_store(uuid,uuid,jsonb,boolean,timestamptz),public.analytics_interest_read(uuid),public.analytics_interest_claim(integer),public.analytics_interest_retention(),public.analytics_maintenance() TO service_role;
