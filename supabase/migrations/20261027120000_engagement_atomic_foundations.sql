-- Deploy before the backend using AtomicEngagementService. No historical counters are rewritten.
ALTER TABLE public.product_clicks ADD COLUMN IF NOT EXISTS event_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS product_clicks_event_id_idx ON public.product_clicks(event_id);
-- RPCs are server-only; do not grant client access when adding future analytics policies.
REVOKE ALL ON public.engagement_interaction_facts, public.engagement_relationship_edges,
  public.engagement_counter_projections, public.product_clicks, public.user_place_saves
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.engagement_interaction_facts, public.engagement_relationship_edges,
  public.engagement_counter_projections, public.product_clicks, public.user_place_saves TO service_role;

ALTER TABLE public.engagement_interaction_facts DROP CONSTRAINT IF EXISTS engagement_facts_actor_chk;
ALTER TABLE public.engagement_interaction_facts ADD CONSTRAINT engagement_facts_actor_chk CHECK (
  actor_user_id IS NOT NULL OR anonymous_id IS NOT NULL OR
  (privacy_class = 'anonymous' AND COALESCE(metadata->>'actor_erased' = 'true', false))
);

CREATE INDEX IF NOT EXISTS engagement_facts_collection_counter_idx ON public.engagement_interaction_facts(collection_id,interaction_type,object_type) WHERE collection_id IS NOT NULL;

-- A baseline preserves pre-epoch analytics totals without inventing historical events.
CREATE TABLE IF NOT EXISTS public.engagement_counter_baselines(
 object_type text NOT NULL,object_id text NOT NULL,counter_name text NOT NULL,
 value bigint NOT NULL CHECK(value>=0),initialized_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(object_type,object_id,counter_name)
);
ALTER TABLE public.engagement_counter_baselines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_counter_baselines FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.engagement_counter_baselines TO service_role;

CREATE OR REPLACE FUNCTION public.engagement_increment_counter(
 p_object_type text,p_object_id text,p_counter_name text,p_delta bigint DEFAULT 1
) RETURNS public.engagement_counter_projections LANGUAGE plpgsql SET search_path='' AS $$
DECLARE mirror bigint; prior_facts bigint; stock bigint; baseline bigint; projected public.engagement_counter_projections;
BEGIN
 -- The commit has inserted the new fact/edge already, in this same transaction.
 -- Lock the mirror before inspecting projections, including legacy writers using row locks.
 IF p_object_type='collection' THEN
  SELECT CASE p_counter_name WHEN 'views' THEN views_count WHEN 'shares' THEN shares_count
   WHEN 'product_clicks' THEN product_clicks_count WHEN 'saves' THEN saves_count END INTO mirror
   FROM public.collections WHERE id=p_object_id::uuid FOR UPDATE;
 ELSIF (p_object_type='creator' AND p_counter_name='followers') OR (p_object_type='user' AND p_counter_name='following') THEN
  SELECT CASE p_counter_name WHEN 'followers' THEN followers_count ELSE following_count END INTO mirror
   FROM public.users WHERE id=p_object_id::uuid FOR UPDATE;
 END IF;
 SELECT * INTO projected FROM public.engagement_counter_projections WHERE object_type=p_object_type
  AND object_id=p_object_id AND counter_name=p_counter_name FOR UPDATE;
 IF mirror IS NOT NULL AND projected.object_id IS NOT NULL AND mirror<>projected.value THEN
  RAISE EXCEPTION 'Counter mirror/projection drift; cutover review required' USING ERRCODE='55000';
 END IF;
 IF p_counter_name IN ('saves','followers','following') THEN
  IF p_counter_name='following' THEN
   SELECT count(*) INTO stock FROM public.engagement_relationship_edges WHERE state='ACTIVE' AND user_id=p_object_id::uuid AND edge_type='FOLLOW';
  ELSE
   SELECT count(*) INTO stock FROM public.engagement_relationship_edges WHERE state='ACTIVE' AND object_id=p_object_id AND object_type=p_object_type
    AND edge_type=CASE p_counter_name WHEN 'saves' THEN 'SAVE' ELSE 'FOLLOW' END;
  END IF;
  IF mirror IS NULL OR mirror<>stock-p_delta THEN
   RAISE EXCEPTION 'Relationship stock/mirror drift; cutover review required' USING ERRCODE='55000';
  END IF;
 ELSE
  IF p_object_type='collection' THEN
   SELECT count(*)-p_delta INTO prior_facts FROM public.engagement_interaction_facts WHERE collection_id=p_object_id::uuid
    AND CASE p_counter_name WHEN 'views' THEN object_type='collection' AND interaction_type='view'
     WHEN 'shares' THEN object_type='collection' AND interaction_type='share' WHEN 'product_clicks' THEN interaction_type='merchant_click' ELSE false END;
  ELSE
   SELECT count(*)-p_delta INTO prior_facts FROM public.engagement_interaction_facts WHERE object_type=p_object_type AND object_id=p_object_id
    AND interaction_type=CASE WHEN p_object_type='creator' AND p_counter_name='shares' THEN 'share'
     WHEN p_object_type='catalog_product' AND p_counter_name='merchant_clicks' THEN 'merchant_click' ELSE NULL END;
  END IF;
  IF prior_facts<0 OR p_delta<>1 THEN RAISE EXCEPTION 'Invalid cumulative counter delta' USING ERRCODE='22023'; END IF;
  mirror:=coalesce(mirror,projected.value,prior_facts);
  SELECT value INTO baseline FROM public.engagement_counter_baselines WHERE object_type=p_object_type AND object_id=p_object_id AND counter_name=p_counter_name;
  IF baseline IS NULL THEN
   IF mirror<prior_facts THEN RAISE EXCEPTION 'Counter below historical facts; cutover review required' USING ERRCODE='55000'; END IF;
   baseline:=mirror-prior_facts;
   INSERT INTO public.engagement_counter_baselines(object_type,object_id,counter_name,value) VALUES(p_object_type,p_object_id,p_counter_name,baseline);
  END IF;
  IF mirror<>baseline+prior_facts THEN RAISE EXCEPTION 'Counter fact/baseline drift; cutover review required' USING ERRCODE='55000'; END IF;
 END IF;
 INSERT INTO public.engagement_counter_projections(object_type,object_id,counter_name,value)
 VALUES(p_object_type,p_object_id,p_counter_name,mirror+p_delta)
 ON CONFLICT(object_type,object_id,counter_name) DO UPDATE SET value=excluded.value,updated_at=now()
 RETURNING * INTO projected;
 RETURN projected;
END;
$$;

CREATE OR REPLACE FUNCTION public.engagement_commit(p_fact jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  f public.engagement_interaction_facts;
  previous public.engagement_interaction_facts;
  e public.engagement_relationship_edges;
  c public.collections;
  counter public.engagement_counter_projections;
  edge_kind text;
  desired text;
  lock_key text;
  counter_kind text;
  delta integer;
BEGIN
  f := jsonb_populate_record(NULL::public.engagement_interaction_facts, p_fact);
  IF f.event_id IS NULL OR (f.actor_user_id IS NULL AND f.anonymous_id IS NULL) THEN
    RAISE EXCEPTION 'event and actor required' USING ERRCODE = '22023';
  END IF;
  IF NOT ((f.object_type='collection' AND f.interaction_type IN ('view','impression','share','save','unsave'))
    OR (f.object_type='creator' AND f.interaction_type IN ('follow','unfollow','share'))
    OR (f.object_type='reel' AND f.interaction_type IN ('like','unlike'))
    OR (f.object_type='catalog_product' AND f.interaction_type='merchant_click')) THEN
    RAISE EXCEPTION 'unsupported interaction' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('engagement-event:' || f.event_id, 0));
  SELECT * INTO previous FROM public.engagement_interaction_facts WHERE event_id=f.event_id;
  IF FOUND THEN
    IF previous.interaction_type IS DISTINCT FROM f.interaction_type
      OR previous.object_type IS DISTINCT FROM f.object_type OR previous.object_id IS DISTINCT FROM f.object_id
      OR previous.actor_user_id IS DISTINCT FROM f.actor_user_id OR previous.anonymous_id IS DISTINCT FROM f.anonymous_id
      OR (f.object_type='catalog_product' AND previous.collection_id IS DISTINCT FROM f.collection_id)
      OR previous.catalog_product_id IS DISTINCT FROM f.catalog_product_id
      OR previous.collection_product_tag_id IS DISTINCT FROM f.collection_product_tag_id THEN
      RAISE EXCEPTION 'event_id already belongs to another interaction' USING ERRCODE='23505';
    END IF;
    SELECT * INTO e FROM public.engagement_relationship_edges
      WHERE user_id=previous.actor_user_id AND object_type=previous.object_type AND object_id=previous.object_id
      AND edge_type=CASE WHEN previous.interaction_type IN ('follow','unfollow') THEN 'FOLLOW'
        WHEN previous.interaction_type IN ('save','unsave') THEN 'SAVE'
        WHEN previous.interaction_type IN ('like','unlike') THEN 'LIKE' END
      ORDER BY (state='ACTIVE') DESC,updated_at DESC LIMIT 1;
    RETURN jsonb_build_object('fact',to_jsonb(previous),'inserted',false,'edge',to_jsonb(e));
  END IF;
  IF f.object_type='collection' THEN f.collection_id := f.object_id::uuid; END IF;
  IF f.object_type='reel' THEN
    SELECT collection_id INTO f.collection_id FROM public.videos WHERE id=f.object_id::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reel not found' USING ERRCODE='P0002'; END IF;
  END IF;
  -- Same ordered locks for every operation touching an object or actor. Account deletion uses these too.
  FOR lock_key IN SELECT DISTINCT k FROM unnest(ARRAY[
    'collection:' || f.collection_id, 'catalog_product:' || f.catalog_product_id,
    'user:' || f.actor_user_id, CASE WHEN f.object_type='creator' THEN 'user:' || f.object_id END,
    CASE WHEN f.object_type='reel' THEN 'reel:' || f.object_id END
  ]) k WHERE k IS NOT NULL ORDER BY k LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('engagement:' || lock_key, 0));
  END LOOP;
  IF f.actor_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=f.actor_user_id AND deleted_at IS NULL AND account_status <> 'DELETED'
  ) THEN RAISE EXCEPTION 'Actor not found' USING ERRCODE='P0002'; END IF;
  IF f.collection_id IS NOT NULL THEN
    SELECT * INTO c FROM public.collections WHERE id=f.collection_id;
    IF NOT FOUND OR c.deleted_at IS NOT NULL OR c.moderation_state<>'clear' OR NOT (
      coalesce(c.creator_id=f.actor_user_id,false) OR (c.status='published' AND c.visibility IN ('public','unlisted'))
    ) THEN RAISE EXCEPTION 'Collection not found' USING ERRCODE='P0002'; END IF;
    IF f.object_type='reel' AND (c.status<>'published' OR c.visibility<>'public' OR c.published_at IS NULL) THEN
      RAISE EXCEPTION 'Reel not found' USING ERRCODE='P0002';
    END IF;
    f.creator_id := c.creator_id;
  ELSIF f.object_type='creator' THEN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=f.object_id::uuid AND deleted_at IS NULL AND account_status<>'DELETED') THEN
      RAISE EXCEPTION 'Creator not found' USING ERRCODE='P0002';
    END IF;
    f.creator_id := f.object_id::uuid;
  ELSE f.creator_id := NULL;
  END IF;
  IF f.interaction_type='merchant_click' THEN
    IF f.catalog_product_id IS DISTINCT FROM f.object_id::uuid OR NOT EXISTS (
      SELECT 1 FROM public.catalog_products WHERE id=f.catalog_product_id AND status<>'HIDDEN'
    ) THEN RAISE EXCEPTION 'Product not found' USING ERRCODE='P0002'; END IF;
    IF f.collection_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.collection_product_tags WHERE collection_id=f.collection_id AND catalog_product_id=f.catalog_product_id
    ) THEN RAISE EXCEPTION 'Product not tagged in collection' USING ERRCODE='22023'; END IF;
    IF f.collection_product_tag_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.collection_product_tags WHERE id=f.collection_product_tag_id
        AND collection_id=f.collection_id AND catalog_product_id=f.catalog_product_id
    ) THEN RAISE EXCEPTION 'Invalid product attribution' USING ERRCODE='22023'; END IF;
    -- Only retain an allowlisted host/provider context, never a destination URL.
    f.metadata := jsonb_build_object('destinationHost', f.metadata->>'destinationHost',
      'destinationType', f.metadata->>'destinationType', 'shoppingProvider',f.metadata->>'shoppingProvider',
      'affiliateProvider',f.metadata->>'affiliateProvider','platform',f.metadata->>'platform','country',f.metadata->>'country');
  END IF;
  edge_kind := CASE WHEN f.interaction_type IN ('follow','unfollow') THEN 'FOLLOW'
    WHEN f.interaction_type IN ('save','unsave') THEN 'SAVE' WHEN f.interaction_type IN ('like','unlike') THEN 'LIKE' END;
  IF edge_kind IS NOT NULL THEN
    IF f.actor_user_id IS NULL OR (edge_kind='FOLLOW' AND f.actor_user_id=f.creator_id) THEN
      RAISE EXCEPTION 'Invalid relationship actor' USING ERRCODE='22023'; END IF;
    desired := CASE WHEN f.interaction_type IN ('follow','save','like') THEN 'ACTIVE' ELSE 'REMOVED' END;
    SELECT * INTO e FROM public.engagement_relationship_edges WHERE user_id=f.actor_user_id
      AND edge_type=edge_kind AND object_type=f.object_type AND object_id=f.object_id
      ORDER BY (state='ACTIVE') DESC, updated_at DESC LIMIT 1;
    IF (e.id IS NULL AND desired='REMOVED') OR e.state=desired THEN
      RETURN jsonb_build_object('fact',NULL,'inserted',false,'edge',to_jsonb(e));
    END IF;
  END IF;
  f.id := gen_random_uuid(); f.created_at := now(); f.occurred_at := coalesce(f.occurred_at,now());
  f.privacy_class := CASE WHEN f.interaction_type IN ('follow','unfollow') THEN 'public'
    WHEN f.actor_user_id IS NULL THEN 'anonymous' ELSE 'private' END;
  f.metadata := coalesce(f.metadata,'{}'::jsonb);
  INSERT INTO public.engagement_interaction_facts SELECT (f).*;
  IF edge_kind IS NOT NULL THEN
    IF e.id IS NULL THEN
      INSERT INTO public.engagement_relationship_edges(user_id,edge_type,object_type,object_id,state,source_event_id,privacy_class)
        VALUES(f.actor_user_id,edge_kind,f.object_type,f.object_id,desired,f.event_id,f.privacy_class) RETURNING * INTO e;
    ELSE
      UPDATE public.engagement_relationship_edges SET state=desired,source_event_id=f.event_id,updated_at=now()
        WHERE id=e.id RETURNING * INTO e;
    END IF;
  END IF;
  delta := CASE WHEN desired='REMOVED' THEN -1 ELSE 1 END;
  counter_kind := CASE WHEN f.object_type='collection' AND f.interaction_type='view' THEN 'views'
    WHEN f.object_type='collection' AND f.interaction_type='share' THEN 'shares'
    WHEN edge_kind='SAVE' THEN 'saves' WHEN f.interaction_type='merchant_click' AND f.collection_id IS NOT NULL THEN 'product_clicks' END;
  IF counter_kind IS NOT NULL THEN
    counter := public.engagement_increment_counter('collection',f.collection_id::text,counter_kind,delta);
    UPDATE public.collections SET
      views_count=CASE WHEN counter_kind='views' THEN counter.value ELSE views_count END,
      saves_count=CASE WHEN counter_kind='saves' THEN counter.value ELSE saves_count END,
      shares_count=CASE WHEN counter_kind='shares' THEN counter.value ELSE shares_count END,
      product_clicks_count=CASE WHEN counter_kind='product_clicks' THEN counter.value ELSE product_clicks_count END,
      counters_updated_at=now() WHERE id=f.collection_id;
  END IF;
  IF edge_kind='FOLLOW' THEN
    -- Lock mirrors consistently even for mutual follows.
    PERFORM id FROM public.users WHERE id IN (f.actor_user_id,f.creator_id) ORDER BY id FOR UPDATE;
    counter := public.engagement_increment_counter('creator',f.creator_id::text,'followers',delta);
    UPDATE public.users SET followers_count=counter.value,counters_updated_at=now() WHERE id=f.creator_id;
    counter := public.engagement_increment_counter('user',f.actor_user_id::text,'following',delta);
    UPDATE public.users SET following_count=counter.value,counters_updated_at=now() WHERE id=f.actor_user_id;
  END IF;
  IF f.object_type='creator' AND f.interaction_type='share' THEN
    PERFORM public.engagement_increment_counter('creator',f.creator_id::text,'shares',1);
  ELSIF f.interaction_type='merchant_click' THEN
    PERFORM public.engagement_increment_counter('catalog_product',f.catalog_product_id::text,'merchant_clicks',1);
  END IF;
  RETURN jsonb_build_object('fact',to_jsonb(f),'inserted',true,'edge',to_jsonb(e));
END;
$$;

-- Remove account linkage permanently, including for the application's soft-delete path.
-- Historical content counters remain; this is deidentification, not a claim of irreversible anonymity.
CREATE OR REPLACE FUNCTION public.engagement_erase_actor(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target record; n bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('engagement:user:' || p_user_id,0));
  UPDATE public.engagement_interaction_facts SET actor_user_id=NULL, anonymous_id=NULL,session_id=NULL,
    privacy_class='anonymous',metadata='{"actor_erased":true}'::jsonb WHERE actor_user_id=p_user_id;
  FOR target IN SELECT DISTINCT object_type,object_id,edge_type FROM public.engagement_relationship_edges
    WHERE user_id=p_user_id AND state='ACTIVE' ORDER BY object_type,object_id,edge_type LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('engagement:' ||
      CASE WHEN target.object_type='creator' THEN 'user' ELSE target.object_type END || ':' || target.object_id,0));
    DELETE FROM public.engagement_relationship_edges WHERE user_id=p_user_id AND edge_type=target.edge_type
      AND object_type=target.object_type AND object_id=target.object_id;
    IF target.edge_type IN ('SAVE','FOLLOW') THEN
      SELECT count(*) INTO n FROM public.engagement_relationship_edges WHERE edge_type=target.edge_type
        AND object_type=target.object_type AND object_id=target.object_id AND state='ACTIVE';
      INSERT INTO public.engagement_counter_projections(object_type,object_id,counter_name,value) VALUES(
        target.object_type,target.object_id,CASE WHEN target.edge_type='SAVE' THEN 'saves' ELSE 'followers' END,n)
        ON CONFLICT(object_type,object_id,counter_name) DO UPDATE SET value=excluded.value,updated_at=now();
      IF target.edge_type='SAVE' THEN UPDATE public.collections SET saves_count=n,counters_updated_at=now() WHERE id=target.object_id::uuid;
      ELSE UPDATE public.users SET followers_count=n,counters_updated_at=now() WHERE id=target.object_id::uuid; END IF;
    END IF;
  END LOOP;
  DELETE FROM public.engagement_relationship_edges WHERE user_id=p_user_id;
  UPDATE public.engagement_counter_projections SET value=0,updated_at=now()
    WHERE object_type='user' AND object_id=p_user_id::text AND counter_name='following';
  UPDATE public.users SET following_count=0 WHERE id=p_user_id;
  UPDATE public.product_clicks SET user_id=NULL WHERE user_id=p_user_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.engagement_account_erasure_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN PERFORM public.engagement_erase_actor(OLD.id); RETURN OLD; END IF;
  IF NEW.account_status='DELETED' OR NEW.deleted_at IS NOT NULL THEN
    PERFORM public.engagement_erase_actor(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS engagement_soft_delete_erasure ON public.users;
CREATE TRIGGER engagement_soft_delete_erasure AFTER UPDATE OF account_status,deleted_at ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.engagement_account_erasure_trigger();
DROP TRIGGER IF EXISTS engagement_hard_delete_erasure ON auth.users;
CREATE TRIGGER engagement_hard_delete_erasure BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.engagement_account_erasure_trigger();

CREATE OR REPLACE FUNCTION public.engagement_reconcile()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
WITH facts AS (
 SELECT collection_id,count(*) FILTER(WHERE interaction_type='view' AND object_type='collection') AS views,
 count(*) FILTER(WHERE interaction_type='share' AND object_type='collection') AS shares,
 count(*) FILTER(WHERE interaction_type='merchant_click') AS clicks
 FROM public.engagement_interaction_facts WHERE collection_id IS NOT NULL GROUP BY collection_id
), saves AS (
 SELECT object_id,count(*) AS saves FROM public.engagement_relationship_edges
 WHERE edge_type='SAVE' AND object_type='collection' AND state='ACTIVE' GROUP BY object_id
), projections AS (
 SELECT object_id,max(value) FILTER(WHERE counter_name='views') AS views,max(value) FILTER(WHERE counter_name='saves') AS saves,
 max(value) FILTER(WHERE counter_name='shares') AS shares,max(value) FILTER(WHERE counter_name='product_clicks') AS clicks
 FROM public.engagement_counter_projections WHERE object_type='collection' GROUP BY object_id
), followers AS (
 SELECT object_id,count(*) AS n FROM public.engagement_relationship_edges WHERE edge_type='FOLLOW' AND state='ACTIVE' GROUP BY object_id
), following AS (
 SELECT user_id,count(*) AS n FROM public.engagement_relationship_edges WHERE edge_type='FOLLOW' AND state='ACTIVE' GROUP BY user_id
)
SELECT jsonb_build_object('checked_at',now(),'definition_version',1,
 'collection_mismatches',(SELECT count(*) FROM public.collections c LEFT JOIN facts f ON f.collection_id=c.id
 LEFT JOIN saves s ON s.object_id=c.id::text LEFT JOIN projections p ON p.object_id=c.id::text WHERE
 c.views_count<>coalesce(f.views,0)+coalesce((SELECT value FROM public.engagement_counter_baselines WHERE object_type='collection' AND object_id=c.id::text AND counter_name='views'),0) OR c.shares_count<>coalesce(f.shares,0)+coalesce((SELECT value FROM public.engagement_counter_baselines WHERE object_type='collection' AND object_id=c.id::text AND counter_name='shares'),0) OR c.product_clicks_count<>coalesce(f.clicks,0)+coalesce((SELECT value FROM public.engagement_counter_baselines WHERE object_type='collection' AND object_id=c.id::text AND counter_name='product_clicks'),0)
 OR c.saves_count<>coalesce(s.saves,0) OR c.views_count<>coalesce(p.views,0) OR c.saves_count<>coalesce(p.saves,0)
 OR c.shares_count<>coalesce(p.shares,0) OR c.product_clicks_count<>coalesce(p.clicks,0)),
 'user_mismatches',(SELECT count(*) FROM public.users u LEFT JOIN followers f ON f.object_id=u.id::text
 LEFT JOIN following g ON g.user_id=u.id WHERE u.followers_count<>coalesce(f.n,0) OR u.following_count<>coalesce(g.n,0)));
$$;

REVOKE ALL ON FUNCTION public.engagement_increment_counter(text,text,text,bigint),public.engagement_commit(jsonb),
 public.engagement_erase_actor(uuid),public.engagement_account_erasure_trigger(),public.engagement_reconcile() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_increment_counter(text,text,text,bigint),public.engagement_commit(jsonb),
 public.engagement_erase_actor(uuid),public.engagement_reconcile() TO service_role;

-- One statement gives exact totals without PostgREST's default row cap. Only the
-- ranked collection payload is bounded; totals always include every non-deleted collection.
CREATE OR REPLACE FUNCTION public.engagement_creator_summary(p_creator_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
WITH owned AS (
 SELECT id,title,views_count,saves_count,shares_count,product_clicks_count FROM public.collections
 WHERE creator_id=p_creator_id AND deleted_at IS NULL
), ranked AS (
 SELECT * FROM owned ORDER BY views_count DESC,product_clicks_count DESC,saves_count DESC,shares_count DESC,id LIMIT 100
)
SELECT jsonb_build_object('definition_version',1,'scope','current_non_deleted_collections',
 'generated_at',now(),'collections_total',(SELECT count(*) FROM owned),'collections_limit',100,
 'totals',jsonb_build_object('views',coalesce((SELECT sum(views_count) FROM owned),0),
 'followers',coalesce((SELECT followers_count FROM public.users WHERE id=p_creator_id),0),
 'saves',coalesce((SELECT sum(saves_count) FROM owned),0),'shares',coalesce((SELECT sum(shares_count) FROM owned),0),
 'product_redirects',coalesce((SELECT sum(product_clicks_count) FROM owned),0)),
 'collections',coalesce((SELECT jsonb_agg(jsonb_build_object('collection_id',id,'title',title,'views',views_count,
 'saves',saves_count,'shares',shares_count,'product_redirects',product_clicks_count)
 ORDER BY views_count DESC,product_clicks_count DESC,saves_count DESC,shares_count DESC,id) FROM ranked),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.engagement_creator_summary(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_creator_summary(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.engagement_reconciliation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), checked_at timestamptz NOT NULL DEFAULT now(), result jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS engagement_reconciliation_time_idx ON public.engagement_reconciliation_runs(checked_at DESC);
ALTER TABLE public.engagement_reconciliation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_reconciliation_runs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.engagement_reconciliation_runs TO service_role;
CREATE OR REPLACE FUNCTION public.engagement_check_and_record()
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE report jsonb;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-reconciliation',0)) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.engagement_reconciliation_runs WHERE checked_at>now()-interval '1 hour') THEN RETURN NULL; END IF;
 report:=public.engagement_reconcile();
 INSERT INTO public.engagement_reconciliation_runs(result) VALUES(report);
 DELETE FROM public.engagement_reconciliation_runs WHERE checked_at<now()-interval '30 days';
 RETURN report;
END;
$$;
REVOKE ALL ON FUNCTION public.engagement_check_and_record() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_check_and_record() TO service_role;
