-- Universal Find phase 6. Additive preparation; no historical notification backfill.
BEGIN;
ALTER TABLE public.user_imports
 ADD COLUMN find_delivery_tracked boolean NOT NULL DEFAULT false,
 ADD COLUMN find_delivery_pending boolean NOT NULL DEFAULT false,
 ADD COLUMN find_delivery_after timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN find_notice_attempt uuid,
 ADD COLUMN find_completion_notified boolean NOT NULL DEFAULT false,
 ADD COLUMN find_measurement_revision uuid,
 ADD COLUMN find_measure_accepted boolean NOT NULL DEFAULT false,
 ADD COLUMN find_measure_started uuid,
 ADD COLUMN find_measure_terminal uuid,
 ADD COLUMN find_measure_saved uuid;
CREATE INDEX find_delivery_due ON public.user_imports(find_delivery_after,id) WHERE find_delivery_pending AND hidden_at IS NULL;
CREATE INDEX find_notification_import ON public.notifications((data->>'findId'),user_id) WHERE type IN ('find.completed','find.failed');

CREATE FUNCTION public.find_queue_delivery() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.attempt_started_at IS DISTINCT FROM OLD.attempt_started_at) THEN
  -- Retrying a pre-release import observes the new attempt, never its historical acceptance.
  IF TG_OP='UPDATE' AND NOT OLD.find_delivery_tracked THEN NEW.find_measure_accepted:=true;END IF;
  NEW.find_delivery_tracked:=true;
  SELECT revision INTO NEW.find_measurement_revision FROM analytics_preferences WHERE user_id=NEW.user_id AND measurement_enabled;
 END IF;
 IF NEW.find_delivery_tracked THEN NEW.find_delivery_pending:=NEW.hidden_at IS NULL;NEW.find_delivery_after:=clock_timestamp();END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER find_queue_delivery BEFORE INSERT OR UPDATE OF stash_sync_state,content_source_id,attempt_started_at,hidden_at ON public.user_imports FOR EACH ROW EXECUTE FUNCTION public.find_queue_delivery();
CREATE FUNCTION public.find_queue_source_delivery() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source_id uuid;
BEGIN
 IF TG_TABLE_NAME='content_sources' THEN source_id:=NEW.id;ELSE source_id:=NEW.content_source_id;END IF;
 UPDATE user_imports SET find_delivery_pending=true,find_delivery_after=clock_timestamp()
 WHERE content_source_id=source_id
 AND find_delivery_tracked AND hidden_at IS NULL;RETURN NEW;
END $$;
CREATE TRIGGER find_source_delivery AFTER UPDATE OF processing_status ON public.content_sources FOR EACH ROW EXECUTE FUNCTION public.find_queue_source_delivery();
CREATE TRIGGER find_attempt_delivery AFTER INSERT OR UPDATE OF attempt_id,product_status,place_status ON public.content_source_import_progress FOR EACH ROW EXECUTE FUNCTION public.find_queue_source_delivery();

-- Extend the existing measurement store and validator, keeping all unrelated event behavior intact.
ALTER TABLE public.analytics_events DROP CONSTRAINT analytics_events_entity_type_check;
ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_entity_type_check CHECK(entity_type IN ('app','collection','product','place','place_save','creator','search','find'));
ALTER TABLE public.analytics_events DROP CONSTRAINT analytics_events_surface_check;
ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_surface_check CHECK(surface IN ('app','watch','collection','product','search','stash','creator','other','find'));
ALTER TABLE public.analytics_events DROP CONSTRAINT analytics_events_event_name_check;
ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_event_name_check CHECK(event_name IN (
 'session.started','collection.impression','collection.opened','product.impression','product.opened','place.impression','place.outbound_requested','creator.profile_opened',
 'search.results_served','search.result_clicked','merchant.outbound_resolved',
 'find.opened','find.capture_action_chosen','find.capture_submitted','find.capture_cancelled','find.results_opened','find.result_removed','find.result_restored',
 'find.ingestion_accepted','find.processing_started','find.processing_completed','find.processing_failed','find.stash_synchronized'));
CREATE FUNCTION public.find_measurement_valid(e jsonb,p_source text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE name text:=e->>'event_name';p jsonb:=e->'properties';keys text[];
BEGIN
 IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR coalesce(e->>'schema_version','1')<>'1' OR EXISTS(SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('event_id','event_name','schema_version','occurred_at','session_id','entity_type','entity_id','surface','platform','app_version','namespace','collection_id','properties')) THEN RETURN false;END IF;
 IF coalesce(name,'') NOT IN ('find.opened','find.capture_action_chosen','find.capture_submitted','find.capture_cancelled','find.results_opened','find.result_removed','find.result_restored',
  'find.ingestion_accepted','find.processing_started','find.processing_completed','find.processing_failed','find.stash_synchronized') THEN RETURN false;END IF;
 IF e->>'surface' IS DISTINCT FROM 'find' OR e ? 'collection_id' OR e ? 'namespace' OR jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF name IN ('find.opened','find.capture_action_chosen','find.capture_submitted','find.capture_cancelled') THEN
  IF e->>'entity_type' IS DISTINCT FROM 'app' OR e ? 'entity_id' THEN RETURN false;END IF;
 ELSE IF e->>'entity_type' IS DISTINCT FROM 'find' OR coalesce(e->>'entity_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false;END IF;END IF;
 IF p_source='client' AND name NOT IN ('find.opened','find.capture_action_chosen','find.capture_submitted','find.capture_cancelled','find.results_opened') THEN RETURN false;END IF;
 keys:=CASE WHEN name IN ('find.opened','find.results_opened') THEN ARRAY[]::text[]
  WHEN name IN ('find.result_removed','find.result_restored') THEN ARRAY['result_type']
  WHEN name='find.processing_completed' THEN ARRAY['capture_origin','outcome','count_bucket']
  WHEN name='find.processing_failed' THEN ARRAY['capture_origin','outcome','failure_class']
  WHEN name='find.stash_synchronized' THEN ARRAY['capture_origin','count_bucket'] ELSE ARRAY['capture_origin'] END;
 IF NOT(p ?& keys) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT(k=ANY(keys))) THEN RETURN false;END IF;
 IF p ? 'capture_origin' AND coalesce(p->>'capture_origin','') NOT IN ('url','camera','gallery','image') THEN RETURN false;END IF;
 IF p ? 'result_type' AND coalesce(p->>'result_type','') NOT IN ('product','place') THEN RETURN false;END IF;
 IF p ? 'outcome' AND coalesce(p->>'outcome','') NOT IN ('found','partial','empty','failed') THEN RETURN false;END IF;
 IF p ? 'count_bucket' AND coalesce(p->>'count_bucket','') NOT IN ('0','1','2-5','6+') THEN RETURN false;END IF;
 IF p ? 'failure_class' AND coalesce(p->>'failure_class','') NOT IN ('extraction','saving') THEN RETURN false;END IF;
 RETURN true;
END $$;
DO $$ DECLARE def text;BEGIN
 SELECT pg_get_functiondef('public.analytics_ingest(uuid,uuid,jsonb,text,jsonb)'::regprocedure) INTO def;
 IF position('r:=NULL; owner:=NULL;' IN def)=0 OR position('ELSIF r.entity_type=''creator'' THEN' IN def)=0 THEN RAISE EXCEPTION 'Unexpected measurement contract';END IF;
 def:=replace(def,'r:=NULL; owner:=NULL;',
  'IF (item->>''event_name'' LIKE ''find.%'' OR item->>''entity_type''=''find'') AND NOT public.find_measurement_valid(item,p_source) THEN rejected:=rejected+1;rejected_ids:=rejected_ids||jsonb_build_array(item->>''event_id'');CONTINUE;END IF; r:=NULL; owner:=NULL;');
 def:=replace(def,'ELSIF r.entity_type=''creator'' THEN',
  'ELSIF r.entity_type=''find'' THEN private_entity:=true; SELECT EXISTS(SELECT 1 FROM public.user_imports WHERE id=r.entity_id AND user_id=p_user_id AND hidden_at IS NULL) INTO visible; ELSIF r.entity_type=''creator'' THEN');
 EXECUTE def;
END $$;
-- Covers aggregate-only insertion, consent withdrawal, expiry and account erasure paths.
CREATE FUNCTION public.find_measurement_private() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN IF NEW.entity_type='find' AND NEW.actor_id IS NULL THEN NEW.entity_id:=NULL;NEW.collection_id:=NULL;NEW.creator_id:=NULL;END IF;RETURN NEW;END $$;
CREATE TRIGGER find_measurement_private BEFORE INSERT OR UPDATE ON public.analytics_events FOR EACH ROW EXECUTE FUNCTION public.find_measurement_private();
CREATE FUNCTION public.find_measurement_withdrawal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT NEW.measurement_enabled OR NEW.revision IS DISTINCT FROM OLD.revision THEN
  UPDATE user_imports SET find_measurement_revision=NULL WHERE user_id=NEW.user_id;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER find_measurement_withdrawal AFTER UPDATE ON public.analytics_preferences FOR EACH ROW EXECUTE FUNCTION public.find_measurement_withdrawal();

CREATE FUNCTION public.find_operational_measure(p_import uuid,p_attempt uuid,p_name text,p_properties jsonb,p_time timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.user_imports;pref public.analytics_preferences;event uuid;
BEGIN
 SELECT * INTO i FROM user_imports WHERE id=p_import AND hidden_at IS NULL;
 IF NOT FOUND OR p_name NOT IN ('find.ingestion_accepted','find.processing_started','find.processing_completed','find.processing_failed','find.stash_synchronized') THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||i.user_id,0));
 SELECT * INTO pref FROM analytics_preferences WHERE user_id=i.user_id AND measurement_enabled AND revision=i.find_measurement_revision;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM users WHERE id=i.user_id AND deleted_at IS NULL AND account_status IN ('ACTIVE','CREATED')) THEN RETURN;END IF;
 IF NOT find_measurement_valid(jsonb_build_object('event_name',p_name,'entity_type','find','entity_id',i.id,'surface','find','properties',p_properties),'server') THEN RAISE EXCEPTION 'Invalid Find measurement';END IF;
 event:=md5('find:'||i.id||':'||p_attempt||':'||p_name)::uuid;
 -- Backend facts have no invented client session. Activity identity is separately opted in.
 INSERT INTO analytics_events(event_id,event_name,occurred_at,session_id,actor_id,consent_revision,entity_type,entity_id,surface,platform,app_version,source,properties)
 VALUES(event,p_name,p_time,NULL,CASE WHEN pref.activity_enabled THEN i.user_id END,CASE WHEN pref.activity_enabled THEN pref.revision END,
  'find',CASE WHEN pref.activity_enabled THEN i.id END,'find','server','0.0.0','server',p_properties) ON CONFLICT(event_id) DO NOTHING;
END $$;

CREATE FUNCTION public.find_reconcile_delivery(p_notifications boolean DEFAULT false,p_measurement boolean DEFAULT false,p_limit integer DEFAULT 25)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE picked record;i public.user_imports;progress public.content_source_import_progress;source public.content_sources;
 outcome jsonb;attempt uuid;origin text;bucket text;total integer;terminal boolean;notice text;happened timestamptz;done integer:=0;enqueued record;
BEGIN
 FOR picked IN SELECT id,user_id,content_source_id FROM user_imports WHERE find_delivery_pending AND hidden_at IS NULL AND find_delivery_after<=clock_timestamp()
  ORDER BY find_delivery_after,id LIMIT greatest(1,least(coalesce(p_limit,25),100)) LOOP
  BEGIN
   PERFORM pg_advisory_xact_lock(hashtextextended('analytics-consent:'||picked.user_id,0));
   -- Same progress-before-import lock order as fenced extraction. Busy rows retry later.
   PERFORM 1 FROM content_source_import_progress WHERE content_source_id=picked.content_source_id FOR SHARE NOWAIT;
   SELECT * INTO i FROM user_imports WHERE id=picked.id AND find_delivery_pending AND hidden_at IS NULL FOR UPDATE SKIP LOCKED;
   IF NOT FOUND THEN CONTINUE;END IF;
   IF NOT EXISTS(SELECT 1 FROM users WHERE id=i.user_id AND deleted_at IS NULL AND account_status IN ('ACTIVE','CREATED')) THEN UPDATE user_imports SET find_delivery_pending=false WHERE id=i.id;CONTINUE;END IF;
   SELECT * INTO source FROM content_sources WHERE id=i.content_source_id;
   SELECT * INTO progress FROM content_source_import_progress WHERE content_source_id=i.content_source_id;
   IF source.queued_at IS NOT NULL AND progress.started_at<source.queued_at THEN progress:=NULL;END IF;
   attempt:=coalesce(progress.attempt_id,i.id);origin:=CASE WHEN i.platform='image' THEN coalesce(i.capture_origin,'image') ELSE 'url' END;
   SELECT m->'outcome' INTO outcome FROM find_outcome_memberships(i.user_id,ARRAY[i.id]) m;
   IF outcome IS NULL THEN CONTINUE;END IF;
   total:=(outcome->>'foundProducts')::int+(outcome->>'foundPlaces')::int;
   bucket:=CASE WHEN total=0 THEN '0' WHEN total=1 THEN '1' WHEN total<=5 THEN '2-5' ELSE '6+' END;
   happened:=greatest(i.created_at,coalesce(progress.finished_at,source.last_processed_at,i.created_at));
   IF NOT i.find_measure_accepted THEN
    IF p_measurement THEN PERFORM find_operational_measure(i.id,i.id,'find.ingestion_accepted',jsonb_build_object('capture_origin',origin),i.created_at);END IF;
    i.find_measure_accepted:=true;
   END IF;
   IF i.find_measure_started IS DISTINCT FROM attempt THEN
    IF p_measurement AND progress.attempt_id IS NOT NULL AND progress.started_at>=i.created_at THEN
     PERFORM find_operational_measure(i.id,attempt,'find.processing_started',jsonb_build_object('capture_origin',origin),progress.started_at);END IF;
    i.find_measure_started:=attempt;
   END IF;
   -- An unattached acceptance is incomplete evidence, not a persisted terminal failure.
   terminal:=source.id IS NOT NULL AND source.processing_status IN ('READY','FAILED') AND NOT (outcome->>'extractionActive')::boolean
    AND (outcome->>'stashSync' IN ('complete','failed') OR outcome->>'result'='failed');
   IF terminal THEN
    notice:=CASE WHEN outcome->>'result'='failed' OR outcome->>'stashSync'='failed' THEN 'find.failed' ELSE 'find.completed' END;
    IF i.find_notice_attempt IS DISTINCT FROM attempt THEN
     IF p_notifications AND NOT(i.find_completion_notified AND notice='find.completed') THEN
      SELECT * INTO enqueued FROM notification_enqueue_event(notice,'find:'||i.user_id||':'||i.id||':'||attempt,i.user_id,NULL,happened,
       jsonb_build_object('findId',i.id,'outcome',outcome->>'result'),1::smallint,2592000);
      IF notice='find.completed' THEN i.find_completion_notified:=true;END IF;
     END IF;
     i.find_notice_attempt:=attempt;
    END IF;
    IF i.find_measure_terminal IS DISTINCT FROM attempt THEN
     IF p_measurement THEN
      PERFORM find_operational_measure(i.id,attempt,CASE WHEN notice='find.failed' THEN 'find.processing_failed' ELSE 'find.processing_completed' END,
       jsonb_build_object('capture_origin',origin,'outcome',outcome->>'result')||CASE WHEN notice='find.failed' THEN jsonb_build_object('failure_class',CASE WHEN outcome->>'stashSync'='failed' THEN 'saving' ELSE 'extraction' END) ELSE jsonb_build_object('count_bucket',bucket) END,happened);
     END IF;i.find_measure_terminal:=attempt;
    END IF;
   END IF;
   IF terminal AND outcome->>'stashSync'='complete' AND i.find_measure_saved IS DISTINCT FROM attempt THEN
    IF p_measurement THEN PERFORM find_operational_measure(i.id,attempt,'find.stash_synchronized',jsonb_build_object('capture_origin',origin,'count_bucket',bucket),happened);END IF;
    i.find_measure_saved:=attempt;
   END IF;
   UPDATE user_imports SET find_notice_attempt=i.find_notice_attempt,find_completion_notified=i.find_completion_notified,
    find_measure_accepted=i.find_measure_accepted,find_measure_started=i.find_measure_started,find_measure_terminal=i.find_measure_terminal,find_measure_saved=i.find_measure_saved,
    find_delivery_pending=NOT terminal,find_delivery_after=clock_timestamp()+interval '30 seconds' WHERE id=i.id;
   done:=done+1;
  EXCEPTION WHEN lock_not_available THEN NULL;
  END;
 END LOOP;RETURN done;
END $$;

-- Existing materializer/push policy remain authoritative. Find adds only visibility fences.
ALTER FUNCTION public.notification_materialize(bigint,uuid,jsonb,jsonb) RENAME TO notification_materialize_before_find;
CREATE FUNCTION public.notification_materialize(p_outbox_id bigint,p_lease_token uuid,p_render jsonb,p_push jsonb DEFAULT NULL)
RETURNS TABLE(outcome text,notification_id uuid,deliveries_created integer) LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE o public.notification_outbox;
BEGIN
 SELECT * INTO o FROM notification_outbox WHERE id=p_outbox_id AND status='claimed' AND lease_token=p_lease_token FOR UPDATE;
 IF o.event_type IN ('find.completed','find.failed') THEN
  PERFORM 1 FROM user_imports WHERE id=(o.payload->>'findId')::uuid AND user_id=o.recipient_user_id AND hidden_at IS NULL FOR SHARE;
  IF NOT FOUND THEN UPDATE notification_outbox SET status='processed',processed_at=now(),result='suppressed_recipient',lease_token=NULL,lease_until=NULL WHERE id=o.id;
   RETURN QUERY SELECT 'suppressed_recipient'::text,NULL::uuid,0;RETURN;END IF;
 END IF;
 RETURN QUERY SELECT * FROM notification_materialize_before_find(p_outbox_id,p_lease_token,p_render,p_push);
END $$;
ALTER FUNCTION public.notification_begin_push_send(uuid,integer) RENAME TO notification_begin_push_send_before_find;
CREATE FUNCTION public.notification_begin_push_send(p_dispatch_token uuid,p_send_lease_seconds integer)
RETURNS TABLE(delivery_id bigint,attempt_no integer,provider text,token text,token_fingerprint text,platform text,notification_id uuid,type text,category text,title text,body text,deep_link text,data jsonb,group_key text,actor_count integer,sample_actor_ids uuid[],send_deadline timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE row record;
BEGIN
 FOR row IN SELECT d.id,n.user_id,n.data FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id
  WHERE d.lease_token=p_dispatch_token AND d.status='dispatching' AND n.type IN ('find.completed','find.failed') LOOP
  PERFORM 1 FROM user_imports WHERE id=(row.data->>'findId')::uuid AND user_id=row.user_id AND hidden_at IS NULL FOR SHARE;
  IF NOT FOUND THEN UPDATE notification_deliveries SET status='suppressed',suppressed_reason='recipient_unavailable',lease_token=NULL,lease_until=NULL,terminal_at=now(),updated_at=now() WHERE id=row.id;END IF;
 END LOOP;
 RETURN QUERY SELECT * FROM notification_begin_push_send_before_find(p_dispatch_token,p_send_lease_seconds);
END $$;
CREATE FUNCTION public.find_hide_notifications() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.hidden_at IS NOT NULL THEN UPDATE notifications SET inbox_visible=false WHERE user_id=NEW.user_id AND type IN ('find.completed','find.failed') AND data->>'findId'=NEW.id::text;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER find_hide_notifications AFTER UPDATE OF hidden_at ON public.user_imports FOR EACH ROW EXECUTE FUNCTION public.find_hide_notifications();

-- Extend existing aggregate reporting; private Find IDs never enter dimensions or creator credit.
ALTER TABLE public.analytics_admin_daily DROP CONSTRAINT analytics_admin_daily_metric_check;
ALTER TABLE public.analytics_admin_daily ADD CONSTRAINT analytics_admin_daily_metric_check CHECK(metric IN (
 'app_sessions','collection_opens','collection_impressions','product_opens','product_impressions','place_impressions','place_outbound_requests','profile_opens',
 'search_responses','search_zero_matches','search_with_fallback','search_matching_results','search_fallback_results','search_latency_ms','search_clicks','search_click_rank_sum',
 'merchant_requests','affiliate_requests','saves_added','saves_removed','follows_added','follows_removed','likes_added','likes_removed','collection_shares',
 'find_opens','find_capture_choices','find_submissions','find_cancellations','find_results_opens','find_removals','find_restorations','find_accepted','find_started','find_completed','find_failed','find_stash_synced'));
DO $$ DECLARE def text;BEGIN
 SELECT pg_get_functiondef('public.analytics_rollup_admin(boolean)'::regprocedure) INTO def;
 IF position('(''app_sessions'',CASE' IN def)=0 THEN RAISE EXCEPTION 'Unexpected admin rollup contract';END IF;
 def:=replace(def,'(''app_sessions'',CASE',
  '(''find_opens'',CASE WHEN c.event_name=''find.opened'' THEN 1 END),
   (''find_capture_choices'',CASE WHEN c.event_name=''find.capture_action_chosen'' THEN 1 END),
   (''find_submissions'',CASE WHEN c.event_name=''find.capture_submitted'' THEN 1 END),
   (''find_cancellations'',CASE WHEN c.event_name=''find.capture_cancelled'' THEN 1 END),
   (''find_results_opens'',CASE WHEN c.event_name=''find.results_opened'' THEN 1 END),
   (''find_removals'',CASE WHEN c.event_name=''find.result_removed'' THEN 1 END),
   (''find_restorations'',CASE WHEN c.event_name=''find.result_restored'' THEN 1 END),
   (''find_accepted'',CASE WHEN c.event_name=''find.ingestion_accepted'' THEN 1 END),
   (''find_started'',CASE WHEN c.event_name=''find.processing_started'' THEN 1 END),
   (''find_completed'',CASE WHEN c.event_name=''find.processing_completed'' THEN 1 END),
   (''find_failed'',CASE WHEN c.event_name=''find.processing_failed'' THEN 1 END),
   (''find_stash_synced'',CASE WHEN c.event_name=''find.stash_synchronized'' THEN 1 END),
   (''app_sessions'',CASE');EXECUTE def;
END $$;
CREATE OR REPLACE FUNCTION public.find_schema_version() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT 4$$;
DO $$DECLARE proc regprocedure;BEGIN
 FOR proc IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND
 (proname LIKE 'find_%' OR proname IN ('notification_materialize_before_find','notification_materialize','notification_begin_push_send_before_find','notification_begin_push_send')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',proc);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',proc);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
