CREATE FUNCTION find_test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label;END IF;END$$;
CREATE FUNCTION find_test_empty(u uuid,i uuid,s uuid,state text DEFAULT 'READY') RETURNS void LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO content_sources(id,platform,external_id,canonical_url,media_kind,processing_status,pipeline_version,last_processed_at)
 VALUES(s,'web',s::text,'https://fixture.invalid/product','WEB_PAGE',state,'fixture',now());
 INSERT INTO user_imports(id,user_id,raw_input,source_url,normalized_url,dedupe_key,platform,content_source_id)
 VALUES(i,u,'fixture','https://fixture.invalid/product','https://fixture.invalid/product',i::text,'web',s);
 UPDATE user_imports SET stash_sync_state='complete' WHERE id=i;
END$$;
INSERT INTO auth.users VALUES('55555555-5555-4555-8555-555555555555'),('77777777-7777-4777-8777-777777777777') ON CONFLICT(id) DO NOTHING;
INSERT INTO users(id) VALUES('55555555-5555-4555-8555-555555555555'),('77777777-7777-4777-8777-777777777777') ON CONFLICT(id) DO UPDATE SET account_status='ACTIVE',deleted_at=NULL;
SELECT analytics_set_preferences('55555555-5555-4555-8555-555555555555',true,true);
DO $$DECLARE owner uuid:='55555555-5555-4555-8555-555555555555';imported uuid:='66666666-6666-4666-8666-666666666666';source uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';product uuid;place jsonb;provenance jsonb;BEGIN
 INSERT INTO content_sources(id,platform,external_id,canonical_url,media_kind,processing_status,pipeline_version)
 VALUES(source,'youtube','find-delivery','https://fixture.invalid/private-source','VIDEO','QUEUED','fixture');
 INSERT INTO user_imports(id,user_id,raw_input,source_url,normalized_url,dedupe_key,platform,content_source_id,interest_note)
 VALUES(imported,owner,'PRIVATE SOURCE CANARY','https://fixture.invalid/private-source','https://fixture.invalid/private-source','find-delivery','youtube',source,'PRIVATE NOTE CANARY');
 INSERT INTO content_source_import_progress(content_source_id,attempt_id,extraction_version,started_at,product_status,place_status)
 VALUES(source,'aaaaaaaa-1111-4111-8111-111111111111','fixture',clock_timestamp(),'running','running');
 PERFORM find_reconcile_delivery(true,true,25);
 PERFORM find_test_assert(NOT EXISTS(SELECT 1 FROM notification_outbox),'no notification for partial/running updates');
 FOR n IN 1..5 LOOP
  product:=('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  INSERT INTO catalog_products(id) VALUES(product);
  INSERT INTO content_source_products(content_source_id,external_id,name,extraction_method,processor_version,catalog_product_id)
  VALUES(source,n::text,'PRIVATE PRODUCT CANARY','ai_extract','fixture',product);
  provenance:=jsonb_build_object('source_surface','USER_IMPORT','source_content_source_id',source,'source_user_import_id',imported);
  PERFORM find_cart_put(owner,product,NULL,provenance,true);
 END LOOP;
 FOR n IN 1..2 LOOP
  place:=place_upsert_hypothesis(jsonb_build_object('content_source_id',source,'extracted_name','PRIVATE PLACE CANARY '||n,'city','Jaipur','country','India','confidence',0.9,'evidence',jsonb_build_object('summary','PRIVATE OCR CANARY'),'sources','["OCR"]'::jsonb,'hypothesis_key','find-delivery-'||n,'unresolved_reason','pending_resolution'));
  PERFORM place_attach_import(owner,(place->>'id')::uuid,source,imported);
 END LOOP;
 UPDATE content_source_import_progress SET product_status='complete',place_status='complete' WHERE content_source_id=source;
 UPDATE content_sources SET processing_status='READY',last_processed_at=clock_timestamp() WHERE id=source;
 UPDATE user_imports SET stash_sync_state='complete' WHERE id=imported;
END$$;
-- Concurrent consumers run after these checks; this first call also exercises durable replay.
SELECT find_reconcile_delivery(true,true,25);
SELECT find_test_assert((SELECT count(*)=1 FROM notification_outbox),'five products and two places create one capture notification');
SELECT find_test_assert((SELECT bool_and(payload=jsonb_build_object('findId','66666666-6666-4666-8666-666666666666','outcome','found')) FROM notification_outbox),'notification payload contains only opaque Find ID and bounded outcome');
SELECT find_test_assert(NOT EXISTS(SELECT 1 FROM analytics_events WHERE properties::text LIKE '%CANARY%' OR session_id IS NOT NULL),'backend facts contain no private evidence or invented client sessions');
SELECT find_test_assert((SELECT properties->>'count_bucket'='6+' FROM analytics_events WHERE event_name='find.processing_completed'),'bounded authoritative result count');
UPDATE user_imports SET find_delivery_pending=true,find_delivery_after=now() WHERE id='66666666-6666-4666-8666-666666666666';
SELECT find_reconcile_delivery(true,true,25);
SELECT find_test_assert((SELECT count(*)=1 FROM notification_outbox),'handoff and receipt replay is idempotent');
-- A new attempt may have a failure message, but never a second completion for this capture.
UPDATE content_source_import_progress SET attempt_id='bbbbbbbb-1111-4111-8111-111111111111',started_at=clock_timestamp(),product_status='complete',place_status='complete' WHERE content_source_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
UPDATE user_imports SET stash_sync_state='complete' WHERE id='66666666-6666-4666-8666-666666666666';
SELECT find_reconcile_delivery(true,true,25);
SELECT find_test_assert((SELECT count(*)=1 FROM notification_outbox),'at most one completion across processing retries');
DO $$DECLARE e jsonb;p analytics_preferences;r jsonb;before_count integer;BEGIN
 SELECT * INTO p FROM analytics_preferences WHERE user_id='55555555-5555-4555-8555-555555555555';
 e:=jsonb_build_object('event_id',gen_random_uuid(),'event_name','find.results_opened','entity_type','find','entity_id','66666666-6666-4666-8666-666666666666','schema_version',1,'session_id',gen_random_uuid(),'occurred_at',now(),'surface','find','platform','ios','app_version','1.0.0','properties','{}'::jsonb);
 r:=analytics_ingest('55555555-5555-4555-8555-555555555555',p.revision,jsonb_build_array(e));PERFORM find_test_assert(jsonb_array_length(r->'accepted')=1,'owned private Find read measurement accepted');
 PERFORM analytics_set_preferences('77777777-7777-4777-8777-777777777777',true,true);
 r:=analytics_ingest('77777777-7777-4777-8777-777777777777',(SELECT revision FROM analytics_preferences WHERE user_id='77777777-7777-4777-8777-777777777777'),jsonb_build_array(e||jsonb_build_object('event_id',gen_random_uuid())));
 PERFORM find_test_assert((r->>'rejected')::int=1,'cross-owner Find analytics denied');
 r:=analytics_ingest('55555555-5555-4555-8555-555555555555',p.revision,jsonb_build_array(e||jsonb_build_object('event_name','find.processing_completed','properties',jsonb_build_object('capture_origin','url','outcome','found','count_bucket','6+'))));
 PERFORM find_test_assert((r->>'rejected')::int=1,'client cannot forge authoritative completion');
 r:=analytics_ingest('55555555-5555-4555-8555-555555555555',p.revision,jsonb_build_array(e||jsonb_build_object('properties',jsonb_build_object('ocr','PRIVATE OCR CANARY'))));
 PERFORM find_test_assert((r->>'rejected')::int=1,'raw evidence rejected by SQL validator');
 PERFORM analytics_set_preferences('55555555-5555-4555-8555-555555555555',false,false);
 PERFORM find_test_assert(NOT EXISTS(SELECT 1 FROM analytics_events WHERE entity_type='find' AND (actor_id IS NOT NULL OR entity_id IS NOT NULL OR session_id IS NOT NULL)),'withdrawal strips every private Find identifier');
 SELECT count(*) INTO before_count FROM analytics_events;
 PERFORM find_test_empty('55555555-5555-4555-8555-555555555555','dddddddd-1111-4111-8111-111111111111','cccccccc-1111-4111-8111-111111111111');
 PERFORM find_reconcile_delivery(true,true,25);
 PERFORM find_test_assert((SELECT count(*)=before_count FROM analytics_events),'consent-off capture still works without measurement');
END$$;
-- Empty and failed captures use generic summaries, one row each. Hidden imports never hand off.
SELECT find_test_empty('77777777-7777-4777-8777-777777777777','dddddddd-2222-4222-8222-222222222222','cccccccc-2222-4222-8222-222222222222','FAILED');
SELECT find_reconcile_delivery(true,true,25);
SELECT find_test_assert(EXISTS(SELECT 1 FROM notification_outbox WHERE event_type='find.failed' AND payload->>'findId'='dddddddd-2222-4222-8222-222222222222'),'failed capture notification');
SELECT find_test_assert(EXISTS(SELECT 1 FROM notification_outbox WHERE event_type='find.completed' AND payload->>'outcome'='empty'),'zero-result completion summary');
SELECT find_test_empty('77777777-7777-4777-8777-777777777777','dddddddd-3333-4333-8333-333333333333','cccccccc-3333-4333-8333-333333333333');
UPDATE user_imports SET hidden_at=now() WHERE id='dddddddd-3333-4333-8333-333333333333';
SELECT find_reconcile_delivery(true,true,25);
SELECT find_test_assert(NOT EXISTS(SELECT 1 FROM notification_outbox WHERE payload->>'findId'='dddddddd-3333-4333-8333-333333333333'),'hidden before handoff is suppressed');
-- Hiding after enqueue, before materialization is fenced inside the existing outbox RPC.
UPDATE user_imports SET hidden_at=now() WHERE id='dddddddd-2222-4222-8222-222222222222';
DO $$DECLARE o record;r record;BEGIN
 FOR o IN SELECT * FROM notification_claim_outbox(100,60,10) LOOP
  SELECT * INTO r FROM notification_materialize(o.outbox_id,o.lease_token,jsonb_build_object('type',o.event_type,'category','task','title','Your Find','body','Open your Find','data',o.payload,'deep_link','/find/'||(o.payload->>'findId'),'requires_actor',false),NULL);
 END LOOP;
 PERFORM find_test_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE data->>'findId'='dddddddd-2222-4222-8222-222222222222'),'late hidden notification is not materialized');
END$$;
UPDATE user_imports SET hidden_at=now() WHERE id='dddddddd-1111-4111-8111-111111111111';
SELECT find_test_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE data->>'findId'='dddddddd-1111-4111-8111-111111111111' AND inbox_visible),'hide removes existing Find inbox visibility');
SELECT analytics_rollup_admin(true);
SELECT find_test_assert(EXISTS(SELECT 1 FROM analytics_admin_daily WHERE metric='find_completed' AND dimension='all' AND value>=1),'Find events enter existing aggregate report');
SELECT find_test_assert(NOT EXISTS(SELECT 1 FROM analytics_admin_daily WHERE dimension LIKE '%66666666%'),'no private Find dimension');
SELECT find_test_assert(NOT has_function_privilege('authenticated','find_reconcile_delivery(boolean,boolean,integer)','EXECUTE') AND NOT has_function_privilege('anon','find_operational_measure(uuid,uuid,text,jsonb,timestamptz)','EXECUTE'),'new handoff and operational RPCs are service-only');
SELECT find_test_assert(NOT find_measurement_valid('{}'::jsonb,'client') AND NOT find_measurement_valid('{"event_name":"find.opened","entity_type":null,"surface":null,"properties":{}}'::jsonb,'client'),'incomplete or null Find classifications fail closed');
DO $$DECLARE i uuid:=gen_random_uuid();BEGIN
 INSERT INTO user_imports(id,user_id,raw_input,source_url,normalized_url,dedupe_key,platform)
 VALUES(i,'77777777-7777-4777-8777-777777777777','fixture','https://fixture.invalid/unattached','https://fixture.invalid/unattached',i::text,'web');
 PERFORM find_reconcile_delivery(true,true,25);
 PERFORM find_test_assert(NOT EXISTS(SELECT 1 FROM notification_outbox WHERE payload->>'findId'=i::text) AND (SELECT find_delivery_pending FROM user_imports WHERE id=i),'unattached acceptance cannot emit a premature failure');
END$$;
-- Same authoritative contract: delay is not terminal; mixed branch results are partial.
DO $$DECLARE i uuid;source uuid;attempt uuid;BEGIN
 SELECT id,content_source_id INTO i,source FROM user_imports WHERE id='66666666-6666-4666-8666-666666666666';
 PERFORM analytics_set_preferences('55555555-5555-4555-8555-555555555555',true,true,(SELECT revision FROM analytics_preferences WHERE user_id='55555555-5555-4555-8555-555555555555'));
 UPDATE user_imports SET attempt_started_at=clock_timestamp() WHERE id=i;
 attempt:=gen_random_uuid();
 UPDATE content_source_import_progress SET attempt_id=attempt,product_status='complete',place_status='failed',started_at=clock_timestamp(),finished_at=clock_timestamp() WHERE content_source_id=source;
 UPDATE user_imports SET stash_sync_state='complete',stash_sync_attempt_id=attempt WHERE id=i;
 PERFORM find_reconcile_delivery(true,true,25);
 PERFORM find_test_assert(EXISTS(SELECT 1 FROM analytics_events WHERE event_name='find.processing_completed' AND properties->>'outcome'='partial'),'partial completion is measured without another completion notification');
 PERFORM find_test_empty('77777777-7777-4777-8777-777777777777','dddddddd-6666-4666-8666-666666666666','cccccccc-6666-4666-8666-666666666666','PROCESSING');
 UPDATE user_imports SET attempt_started_at=now()-interval '1 hour' WHERE id='dddddddd-6666-4666-8666-666666666666';
 PERFORM find_reconcile_delivery(true,true,25);
 PERFORM find_test_assert(NOT EXISTS(SELECT 1 FROM notification_outbox WHERE payload->>'findId'='dddddddd-6666-4666-8666-666666666666'),'delayed active processing never sends terminal alerts');
 PERFORM find_test_assert(NOT EXISTS(SELECT 1 FROM analytics_events WHERE entity_id='dddddddd-6666-4666-8666-666666666666' AND event_name='find.stash_synchronized'),'running extraction cannot acknowledge final Stash synchronization');
END$$;
-- Real push policy RPCs: task preferences, quiet hours and hide immediately before send.
DO $$DECLARE owner uuid:='77777777-7777-4777-8777-777777777777';i uuid;source uuid;o notification_outbox;r record;dispatch uuid;begin_count int;push jsonb;
BEGIN
 PERFORM notification_register_push(owner,gen_random_uuid(),'expo','ExponentPushToken[find-fixture]','ios','1.0.0','1','en-US','UTC','granted','production');
 push:=jsonb_build_object('enabled',true,'ttl_seconds',86400,'retry_policy','retry_ambiguous_once','max_send_attempts',3,'cooldown_seconds',0,'rate_cap',NULL,'rate_window_seconds',86400,'provider_preference',jsonb_build_array('expo'));
 FOR mode IN 1..3 LOOP
  i:=gen_random_uuid();source:=gen_random_uuid();PERFORM find_test_empty(owner,i,source);PERFORM find_reconcile_delivery(true,true,25);
  SELECT * INTO o FROM notification_outbox WHERE payload->>'findId'=i::text;
  UPDATE notification_outbox SET status='claimed',lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' WHERE id=o.id RETURNING * INTO o;
  IF mode=1 THEN INSERT INTO notification_preferences(user_id,category,channel,enabled) VALUES(owner,'task','push',false);
  ELSE DELETE FROM notification_preferences WHERE user_id=owner;END IF;
  IF mode=2 THEN INSERT INTO user_notification_settings(user_id,timezone,quiet_hours_start,quiet_hours_end) VALUES(owner,'UTC',(now() AT TIME ZONE 'UTC')::time-interval '1 hour',(now() AT TIME ZONE 'UTC')::time+interval '2 hours');
  ELSE DELETE FROM user_notification_settings WHERE user_id=owner;END IF;
  SELECT * INTO r FROM notification_materialize(o.id,o.lease_token,jsonb_build_object('type',o.event_type,'category','task','title','Your Find','body','Open your Find','data',o.payload,'deep_link','/find/'||i,'requires_actor',false),push);
  IF mode=1 THEN
   PERFORM find_test_assert(r.deliveries_created=0 AND EXISTS(SELECT 1 FROM notifications WHERE id=r.notification_id AND inbox_visible AND push_decision='suppressed_preference'),'Find retains task inbox and obeys task push preference');
  ELSIF mode=2 THEN
   PERFORM find_test_assert(r.deliveries_created=1 AND EXISTS(SELECT 1 FROM notification_deliveries WHERE notification_id=r.notification_id AND available_at>now()+interval '1 hour'),'Find obeys existing quiet hours');
  ELSE
   UPDATE notification_deliveries SET available_at=now()+interval '1 day' WHERE notification_id<>r.notification_id;
   SELECT dispatch_token INTO dispatch FROM notification_claim_push_deliveries('expo',100,60,10) LIMIT 1;
   UPDATE user_imports SET hidden_at=now() WHERE id=i;
   SELECT count(*) INTO begin_count FROM notification_begin_push_send(dispatch,120);
   PERFORM find_test_assert(begin_count=0 AND EXISTS(SELECT 1 FROM notification_deliveries WHERE notification_id=r.notification_id AND status='suppressed'),'hidden after dispatch claim cannot begin a push');
  END IF;
 END LOOP;
END$$;
-- Aggregate-only account consent never stores the private Find ID or a client session.
DO $$DECLARE owner uuid:=gen_random_uuid();i uuid:=gen_random_uuid();source uuid:=gen_random_uuid();BEGIN
 INSERT INTO auth.users VALUES(owner);INSERT INTO users(id) VALUES(owner);PERFORM analytics_set_preferences(owner,true,false);
 PERFORM find_test_empty(owner,i,source);PERFORM find_reconcile_delivery(false,true,25);
 PERFORM find_test_assert(EXISTS(SELECT 1 FROM analytics_events WHERE event_id=md5('find:'||i||':'||i||':find.ingestion_accepted')::uuid AND actor_id IS NULL AND entity_id IS NULL AND session_id IS NULL),'aggregate-only backend facts discard private identifiers');
END$$;
DO $$DECLARE owner uuid:=gen_random_uuid();i uuid:=gen_random_uuid();source uuid:=gen_random_uuid();event uuid;BEGIN
 INSERT INTO auth.users VALUES(owner);INSERT INTO users(id) VALUES(owner);PERFORM analytics_set_preferences(owner,true,true);
 PERFORM find_test_empty(owner,i,source);PERFORM find_reconcile_delivery(false,true,25);event:=md5('find:'||i||':'||i||':find.ingestion_accepted')::uuid;
 PERFORM find_test_assert(EXISTS(SELECT 1 FROM analytics_events WHERE event_id=event AND actor_id=owner AND entity_id=i),'activity opt-in links owned operational facts');
 UPDATE users SET account_status='DELETED',deleted_at=now() WHERE id=owner;
 PERFORM find_test_assert(EXISTS(SELECT 1 FROM analytics_events WHERE event_id=event AND actor_id IS NULL AND entity_id IS NULL AND session_id IS NULL),'account erasure removes private Find identifiers');
END$$;
-- Failed enqueue rolls the receipt markers back, and the next existing-consumer pass recovers.
DO $$DECLARE source uuid:=gen_random_uuid();first_id uuid:=gen_random_uuid();cached_id uuid:=gen_random_uuid();BEGIN
 PERFORM find_test_empty('55555555-5555-4555-8555-555555555555',first_id,source);
 INSERT INTO user_imports(id,user_id,raw_input,source_url,normalized_url,dedupe_key,platform,content_source_id)
 VALUES(cached_id,'77777777-7777-4777-8777-777777777777','fixture','https://fixture.invalid/cache','https://fixture.invalid/cache',cached_id::text,'web',source);
 UPDATE user_imports SET stash_sync_state='complete' WHERE id=cached_id;
 PERFORM find_reconcile_delivery(true,true,25);
 UPDATE user_imports SET find_delivery_pending=true,find_delivery_after=now() WHERE id=cached_id;
 PERFORM find_reconcile_delivery(true,true,25);
 PERFORM find_test_assert((SELECT count(*)=1 FROM notification_outbox WHERE payload->>'findId'=cached_id::text AND recipient_user_id='77777777-7777-4777-8777-777777777777'),'cached shared source notifies its new importer once');
 PERFORM find_test_assert(NOT EXISTS(SELECT 1 FROM analytics_events WHERE entity_id=cached_id AND event_name='find.processing_started'),'cached import does not fabricate new processing');
END$$;
SELECT find_test_empty('77777777-7777-4777-8777-777777777777','dddddddd-5555-4555-8555-555555555555','cccccccc-5555-4555-8555-555555555555');
CREATE FUNCTION find_test_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture outbox unavailable';END$$;
CREATE TRIGGER find_test_outbox_failure BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION find_test_outbox_failure();
DO $$BEGIN
 BEGIN PERFORM find_reconcile_delivery(true,true,25);RAISE EXCEPTION 'expected fixture failure';EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'fixture outbox unavailable' THEN RAISE;END IF;END;
 PERFORM find_test_assert((SELECT find_notice_attempt IS NULL AND find_delivery_pending FROM user_imports WHERE id='dddddddd-5555-4555-8555-555555555555'),'outbox failure cannot acknowledge terminal handoff');
END$$;
DROP TRIGGER find_test_outbox_failure ON notification_outbox;
SELECT find_reconcile_delivery(true,true,25);
SELECT find_test_assert((SELECT count(*)=1 FROM notification_outbox WHERE payload->>'findId'='dddddddd-5555-4555-8555-555555555555'),'retry creates exactly one terminal handoff');
-- Fresh terminal record is handed to two concurrent consumers by the Python runner.
SELECT find_test_empty('77777777-7777-4777-8777-777777777777','dddddddd-4444-4444-8444-444444444444','cccccccc-4444-4444-8444-444444444444');
SELECT 'PASS capture-level dedupe, terminal/partial/empty/failed/delayed states, task preferences, quiet hours, hide-before-send, privacy, ownership, consent withdrawal/erasure and aggregate reporting';
