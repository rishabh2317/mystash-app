-- Phase 4 preparation only. No backfill, bucket publication or startup migration.
BEGIN;
CREATE TABLE public.find_image_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, capture_id uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 expected_digest text NOT NULL CHECK(expected_digest ~ '^[a-f0-9]{64}$'),
 expected_size integer NOT NULL CHECK(expected_size BETWEEN 1 AND 5242880),
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 capture_origin text CHECK(capture_origin IN ('camera','gallery')),
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','verifying','accepted','duplicate','deleting','deleted')),
 staging_path text NOT NULL UNIQUE, original_path text NOT NULL UNIQUE, thumbnail_path text NOT NULL UNIQUE,
 upload_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '3 hours',
 verify_lease uuid, verify_until timestamptz, normalized_digest text,
 width integer CHECK(width BETWEEN 1 AND 2560), height integer CHECK(height BETWEEN 1 AND 2560),
 byte_size integer CHECK(byte_size BETWEEN 1 AND 5242880),
 source_id uuid REFERENCES public.content_sources(id) ON DELETE RESTRICT,
 import_id uuid REFERENCES public.user_imports(id) ON DELETE SET NULL,
 staging_cleaned boolean NOT NULL DEFAULT false,
 cancelled boolean NOT NULL DEFAULT false,
 cleanup_lease uuid, cleanup_until timestamptz, cleanup_after timestamptz NOT NULL DEFAULT clock_timestamp(),
 delete_requested_at timestamptz, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,capture_id),
 CHECK(state NOT IN ('accepted','duplicate') OR (source_id IS NOT NULL AND normalized_digest IS NOT NULL AND normalized_digest ~ '^[a-f0-9]{64}$'))
);
-- No auth-user FK cascade: private object deletion must survive hard account deletion.
CREATE UNIQUE INDEX find_image_owner_digest ON public.find_image_assets(user_id,normalized_digest) WHERE state='accepted';
CREATE INDEX find_image_source ON public.find_image_assets(source_id);
CREATE INDEX find_image_owner_created ON public.find_image_assets(user_id,created_at DESC);
CREATE INDEX find_image_owner_pending ON public.find_image_assets(user_id) WHERE state IN ('open','verifying');
CREATE INDEX find_image_cleanup ON public.find_image_assets(cleanup_after) WHERE state<>'deleted';
ALTER TABLE public.find_image_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.find_image_assets FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.find_image_assets TO service_role;

ALTER TABLE public.content_sources DROP CONSTRAINT content_sources_platform_check;
ALTER TABLE public.content_sources DROP CONSTRAINT content_sources_media_kind_check;
ALTER TABLE public.content_sources ALTER COLUMN canonical_url DROP NOT NULL;
ALTER TABLE public.content_sources ADD COLUMN owner_id uuid, ADD COLUMN private_media_id uuid UNIQUE REFERENCES public.find_image_assets(id),
 ADD CONSTRAINT content_sources_private_kind CHECK(
  (media_kind='IMAGE' AND platform='image' AND owner_id IS NOT NULL AND private_media_id IS NOT NULL AND canonical_url IS NULL AND thumbnail_url IS NULL)
  OR (media_kind IN ('VIDEO','WEB_PAGE') AND platform IN ('youtube','instagram','web') AND owner_id IS NULL AND private_media_id IS NULL AND canonical_url IS NOT NULL));
-- Existing URL uniqueness is unchanged. Image external IDs are random asset IDs, never hashes or paths.
ALTER TABLE public.user_imports ALTER COLUMN raw_input DROP NOT NULL, ALTER COLUMN source_url DROP NOT NULL, ALTER COLUMN normalized_url DROP NOT NULL;
ALTER TABLE public.user_imports ADD COLUMN capture_origin text CHECK(capture_origin IN ('camera','gallery')),
 ADD CONSTRAINT user_import_image_url CHECK((platform='image' AND raw_input IS NULL AND source_url IS NULL AND normalized_url IS NULL)
 OR (platform<>'image' AND raw_input IS NOT NULL AND source_url IS NOT NULL AND normalized_url IS NOT NULL));

CREATE FUNCTION public.find_image_import_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.content_sources;
BEGIN
 SELECT * INTO s FROM content_sources WHERE id=NEW.content_source_id;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM find_image_assets WHERE import_id=OLD.id AND (user_id IS DISTINCT FROM NEW.user_id OR source_id IS DISTINCT FROM NEW.content_source_id)) THEN RAISE EXCEPTION 'Private image association is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.hidden_at IS NOT NULL AND NEW.hidden_at IS NULL AND EXISTS(SELECT 1 FROM find_image_assets WHERE import_id=OLD.id AND state IN ('deleting','deleted')) THEN RAISE EXCEPTION 'Deleted image cannot be restored' USING ERRCODE='23514'; END IF;
 IF s.media_kind='IMAGE' AND (NEW.user_id IS DISTINCT FROM s.owner_id OR NEW.platform<>'image'
  OR NOT EXISTS(SELECT 1 FROM find_image_assets a WHERE a.id=s.private_media_id AND a.user_id=NEW.user_id AND a.state='verifying')) THEN
  -- Existing accepted imports may only update presentation/visibility, never change ownership/source.
  IF TG_OP<>'UPDATE' OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.content_source_id IS DISTINCT FROM OLD.content_source_id
   OR NOT EXISTS(SELECT 1 FROM find_image_assets a WHERE a.id=s.private_media_id AND a.user_id=NEW.user_id AND a.import_id=NEW.id) THEN
   RAISE EXCEPTION 'Private image ownership mismatch' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.platform='image' AND (s.id IS NULL OR s.media_kind<>'IMAGE' OR NEW.user_id IS DISTINCT FROM s.owner_id) THEN
  RAISE EXCEPTION 'Private image source required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER find_image_import_owner BEFORE INSERT OR UPDATE ON public.user_imports FOR EACH ROW EXECUTE FUNCTION public.find_image_import_owner();
CREATE FUNCTION public.find_image_source_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.media_kind='IMAGE' AND NOT EXISTS(SELECT 1 FROM find_image_assets WHERE id=NEW.private_media_id AND user_id=NEW.owner_id
  AND (source_id IS NULL OR source_id=NEW.id)) THEN RAISE EXCEPTION 'Invalid private image asset' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER find_image_source_owner BEFORE INSERT OR UPDATE ON public.content_sources FOR EACH ROW EXECUTE FUNCTION public.find_image_source_owner();

CREATE FUNCTION public.find_image_hide() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.hidden_at IS NOT NULL AND NEW.hidden_at IS DISTINCT FROM OLD.hidden_at THEN
  UPDATE find_image_assets SET state='deleting',delete_requested_at=clock_timestamp(),cleanup_after=clock_timestamp(),verify_lease=NULL
   WHERE source_id=NEW.content_source_id AND user_id=NEW.user_id AND state IN ('accepted','duplicate');
  UPDATE content_source_import_progress SET lease_active=false,lease_expires_at=clock_timestamp() WHERE content_source_id=NEW.content_source_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER find_image_hide AFTER UPDATE OF hidden_at ON public.user_imports FOR EACH ROW WHEN(NEW.platform='image') EXECUTE FUNCTION public.find_image_hide();
CREATE FUNCTION public.find_image_import_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE find_image_assets SET state='deleting',cancelled=true,delete_requested_at=clock_timestamp(),cleanup_after=clock_timestamp(),verify_lease=NULL
 WHERE source_id=OLD.content_source_id AND user_id=OLD.user_id AND state<>'deleted';
 UPDATE content_source_import_progress SET lease_active=false,lease_expires_at=clock_timestamp() WHERE content_source_id=OLD.content_source_id;
 RETURN OLD;
END $$;
CREATE TRIGGER find_image_import_delete AFTER DELETE ON public.user_imports FOR EACH ROW WHEN(OLD.platform='image') EXECUTE FUNCTION public.find_image_import_delete();

CREATE FUNCTION public.find_image_account_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF true THEN
  UPDATE user_imports SET hidden_at=clock_timestamp(),interest_note=NULL WHERE user_id=OLD.id AND platform='image' AND hidden_at IS NULL;
  UPDATE find_image_assets SET state='deleting',cancelled=true,delete_requested_at=clock_timestamp(),verify_lease=NULL,cleanup_after=clock_timestamp() WHERE user_id=OLD.id AND state<>'deleted';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER find_image_hard_delete BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.find_image_account_delete();
-- Separate UPDATE trigger returns NEW so soft account deletion itself is not undone.
CREATE FUNCTION public.find_image_soft_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL OR NEW.account_status='DELETED' THEN
  UPDATE user_imports SET hidden_at=clock_timestamp(),interest_note=NULL WHERE user_id=NEW.id AND platform='image' AND hidden_at IS NULL;
  UPDATE find_image_assets SET state='deleting',cancelled=true,delete_requested_at=clock_timestamp(),verify_lease=NULL,cleanup_after=clock_timestamp() WHERE user_id=NEW.id AND state<>'deleted';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER find_image_soft_delete AFTER UPDATE OF deleted_at,account_status ON public.users FOR EACH ROW EXECUTE FUNCTION public.find_image_soft_delete();

-- Serialize image evidence writes with hiding, deletion and expired attempt leases.
CREATE OR REPLACE FUNCTION public.import_work_assert() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE headers jsonb; source_id uuid; attempt uuid; r public.content_source_import_progress;
BEGIN
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF NOT(headers ? 'x-mystash-import-source') AND NOT(headers ? 'x-mystash-import-attempt') THEN RETURN; END IF;
 source_id:=(headers->>'x-mystash-import-source')::uuid; attempt:=(headers->>'x-mystash-import-attempt')::uuid;
 SELECT * INTO r FROM content_source_import_progress WHERE content_source_id=source_id FOR UPDATE;
 IF NOT FOUND OR r.attempt_id IS DISTINCT FROM attempt OR NOT r.lease_active OR r.lease_expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'IMPORT_WORK_STALE' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM content_sources WHERE id=source_id AND media_kind='IMAGE') AND NOT EXISTS(
  SELECT 1 FROM find_image_assets a JOIN user_imports i ON i.id=a.import_id WHERE a.source_id=source_id AND a.state='accepted' AND i.hidden_at IS NULL)
 THEN RAISE EXCEPTION 'IMPORT_WORK_STALE' USING ERRCODE='55000'; END IF;
END $$;

CREATE FUNCTION public.find_media_command(p_user uuid,p_action text,p_id uuid DEFAULT NULL,p_input jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='25s' SET lock_timeout='2s' AS $$
DECLARE a public.find_image_assets; existing public.find_image_assets; asset_id uuid; new_source uuid; imported uuid; result jsonb; lease uuid;
BEGIN
 -- Private lifecycle is service-only. User commands still require an active, verified API owner.
 IF p_action IN ('claim','verifyLease','accept','release','cleanupClaim','cleanupFinish') AND p_input->>'lease' IS NULL THEN RAISE EXCEPTION 'Image lease required' USING ERRCODE='23514'; END IF;
 IF p_action NOT IN ('cleanupClaim','cleanupFinish') THEN
  IF p_user IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user)
   OR EXISTS(SELECT 1 FROM users WHERE id=p_user AND (deleted_at IS NOT NULL OR account_status='DELETED')) THEN
   RAISE EXCEPTION 'image_not_found' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('find-images:'||p_user::text,0));
 END IF;
 IF p_action='initialize' THEN
  SELECT * INTO a FROM find_image_assets WHERE user_id=p_user AND capture_id=(p_input->>'captureId')::uuid FOR UPDATE;
  IF FOUND THEN
   IF a.request_digest IS DISTINCT FROM p_input->>'requestDigest' THEN RAISE EXCEPTION 'image_conflict' USING ERRCODE='23514'; END IF;
   IF a.state='deleted' AND a.import_id IS NULL AND NOT a.cancelled THEN
    -- An expired, never-accepted upload may resume under its stable capture ID.
    -- Old capabilities have expired and physical cleanup is acknowledged before paths rotate.
    asset_id:=gen_random_uuid();
    UPDATE find_image_assets SET state='open',expected_digest=p_input->>'sha256',upload_expires_at=clock_timestamp()+interval '3 hours',
     staging_path=p_user||'/'||asset_id||'/input',original_path=p_user||'/'||asset_id||'/original.jpg',thumbnail_path=p_user||'/'||asset_id||'/thumbnail.jpg',
     deleted_at=NULL,delete_requested_at=NULL,staging_cleaned=false,cleanup_after=clock_timestamp(),verify_lease=NULL,verify_until=NULL,cleanup_lease=NULL,cleanup_until=NULL WHERE id=a.id RETURNING * INTO a;
   END IF;
   IF a.state='open' THEN UPDATE find_image_assets SET upload_expires_at=clock_timestamp()+interval '3 hours' WHERE id=a.id RETURNING * INTO a; END IF;
   RETURN to_jsonb(a);
  END IF;
  IF EXISTS(SELECT 1 FROM share_acceptance_receipts WHERE user_id=p_user AND capture_id=(p_input->>'captureId')::uuid) THEN RAISE EXCEPTION 'image_conflict' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM find_image_assets WHERE user_id=p_user AND state IN ('open','verifying'))>=10
   OR (SELECT count(*) FROM find_image_assets WHERE user_id=p_user AND created_at>clock_timestamp()-interval '1 day')>=50 THEN
   RAISE EXCEPTION 'image_quota' USING ERRCODE='54000'; END IF;
  asset_id:=gen_random_uuid();
  INSERT INTO find_image_assets(id,user_id,capture_id,request_digest,expected_digest,expected_size,mime,capture_origin,staging_path,original_path,thumbnail_path)
  VALUES(asset_id,p_user,(p_input->>'captureId')::uuid,p_input->>'requestDigest',p_input->>'sha256',(p_input->>'size')::int,p_input->>'mime',p_input->>'origin',
   p_user||'/'||asset_id||'/input',p_user||'/'||asset_id||'/original.jpg',p_user||'/'||asset_id||'/thumbnail.jpg') RETURNING * INTO a;
  RETURN to_jsonb(a);
 ELSIF p_action='cleanupClaim' THEN
  WITH expired AS (SELECT id FROM find_image_assets WHERE state IN ('open','verifying') AND upload_expires_at<clock_timestamp() AND coalesce(verify_until,'-infinity')<clock_timestamp() ORDER BY upload_expires_at,id LIMIT 25 FOR UPDATE SKIP LOCKED)
  UPDATE find_image_assets asset SET state='deleting',delete_requested_at=coalesce(delete_requested_at,clock_timestamp()) FROM expired WHERE asset.id=expired.id;
  WITH picked AS (SELECT id FROM find_image_assets WHERE cleanup_after<=clock_timestamp()
   AND (state='deleting' OR (state IN ('accepted','duplicate') AND NOT staging_cleaned AND upload_expires_at<clock_timestamp()))
   AND coalesce(verify_until,'-infinity')<clock_timestamp()-interval '1 minute' AND coalesce(cleanup_until,'-infinity')<clock_timestamp()
   ORDER BY cleanup_after,id LIMIT 25 FOR UPDATE SKIP LOCKED), updated AS (
    UPDATE find_image_assets asset SET cleanup_lease=(p_input->>'lease')::uuid,cleanup_until=clock_timestamp()+interval '2 minutes',cleanup_after=clock_timestamp()+interval '1 minute'
    FROM picked p WHERE asset.id=p.id RETURNING asset.*)
  SELECT coalesce(jsonb_agg(to_jsonb(updated)),'[]') INTO result FROM updated;
  RETURN result;
 ELSIF p_action='cleanupFinish' THEN
  SELECT * INTO a FROM find_image_assets WHERE id=p_id FOR UPDATE;
  IF a.cleanup_lease IS NULL OR a.cleanup_until IS NULL OR a.cleanup_lease IS DISTINCT FROM (p_input->>'lease')::uuid OR a.cleanup_until<=clock_timestamp() OR a.state IS DISTINCT FROM p_input->>'state'
   THEN RAISE EXCEPTION 'image_conflict' USING ERRCODE='23514'; END IF;
  IF a.state IN ('accepted','duplicate') THEN UPDATE find_image_assets SET staging_cleaned=true,cleanup_lease=NULL,cleanup_until=NULL WHERE id=a.id;
  ELSE
   IF a.state='deleting' AND a.source_id IS NOT NULL THEN
    UPDATE content_source_products SET external_id='deleted:'||id,name='Original image removed',brand=NULL,model=NULL,category=NULL,price=NULL,currency=NULL,image=NULL,merchant_url=NULL,confidence=NULL,evidence='{}',sources='[]',match_assessment=NULL WHERE content_source_id=a.source_id;
    UPDATE content_source_places SET hypothesis_key='deleted:'||id,confidence=NULL,evidence='{}',sources='[]' WHERE content_source_id=a.source_id;
    -- Retained Stash lead identity is a separate personal item, needed for restore.
    -- Everything else is discarded; canonical places already keep only provider facts.
    UPDATE content_source_places h SET extracted_name='Original image removed',category=NULL,locality=NULL,city=NULL,region=NULL,country=NULL,mentioned_address=NULL
     WHERE h.content_source_id=a.source_id AND NOT EXISTS(SELECT 1 FROM user_place_saves s WHERE s.content_source_place_id=h.id)
      AND NOT EXISTS(SELECT 1 FROM user_place_save_sources s WHERE s.content_source_place_id=h.id);
    UPDATE content_sources SET title='Original image removed',thumbnail_url=NULL,failure_reason=NULL WHERE id=a.source_id;
    UPDATE user_imports SET interest_note=NULL WHERE id=a.import_id;
   END IF;
   UPDATE find_image_assets SET state=CASE WHEN upload_expires_at<=clock_timestamp() THEN 'deleted' ELSE 'deleting' END,
    deleted_at=CASE WHEN upload_expires_at<=clock_timestamp() THEN clock_timestamp() END,
    normalized_digest=NULL,expected_digest=repeat('0',64),cleanup_lease=NULL,cleanup_until=NULL,cleanup_after=greatest(upload_expires_at,clock_timestamp()+interval '1 minute') WHERE id=a.id;
  END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='media' THEN
  SELECT asset.* INTO a FROM find_image_assets asset JOIN user_imports i ON i.id=asset.import_id WHERE i.id=p_id AND i.user_id=p_user AND i.hidden_at IS NULL AND asset.user_id=p_user AND asset.state='accepted';
  IF NOT FOUND THEN RAISE EXCEPTION 'image_not_found' USING ERRCODE='P0002'; END IF;
  RETURN to_jsonb(a);
 END IF;
 SELECT * INTO a FROM find_image_assets WHERE id=p_id AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'image_not_found' USING ERRCODE='P0002'; END IF;
 IF p_action='status' THEN RETURN to_jsonb(a);
 ELSIF p_action='issued' THEN
  IF a.state<>'open' OR a.staging_path IS DISTINCT FROM p_input->>'path' THEN RAISE EXCEPTION 'image_conflict' USING ERRCODE='23514'; END IF;
  UPDATE find_image_assets SET upload_expires_at=clock_timestamp()+interval '3 hours' WHERE id=a.id RETURNING * INTO a;
  RETURN to_jsonb(a);
 ELSIF p_action='cancel' THEN
  IF a.state IN ('accepted','duplicate') THEN RAISE EXCEPTION 'image_already_accepted' USING ERRCODE='23514'; END IF;
  IF a.state<>'deleted' THEN UPDATE find_image_assets SET state='deleting',cancelled=true,delete_requested_at=clock_timestamp(),verify_lease=NULL WHERE id=a.id RETURNING * INTO a; END IF;
  RETURN to_jsonb(a);
 ELSIF p_action='claim' THEN
  IF a.import_id IS NOT NULL AND EXISTS(SELECT 1 FROM share_acceptance_receipts WHERE user_id=p_user AND capture_id=a.capture_id AND import_id=a.import_id) THEN RETURN to_jsonb(a); END IF;
  IF EXISTS(SELECT 1 FROM share_acceptance_receipts WHERE user_id=p_user AND capture_id=a.capture_id) THEN RAISE EXCEPTION 'image_conflict' USING ERRCODE='23514'; END IF;
  IF a.state NOT IN ('open','verifying') OR a.upload_expires_at<=clock_timestamp() OR (a.state='verifying' AND a.verify_until>clock_timestamp()) THEN RAISE EXCEPTION 'image_busy' USING ERRCODE='23514'; END IF;
  UPDATE find_image_assets SET state='verifying',verify_lease=(p_input->>'lease')::uuid,verify_until=clock_timestamp()+interval '3 minutes' WHERE id=a.id RETURNING * INTO a;
  RETURN to_jsonb(a);
 ELSIF p_action IN ('verifyLease','accept') THEN
  IF a.state<>'verifying' OR a.verify_lease IS DISTINCT FROM (p_input->>'lease')::uuid OR a.verify_until<=clock_timestamp() THEN RAISE EXCEPTION 'image_conflict' USING ERRCODE='23514'; END IF;
  IF p_action='verifyLease' THEN RETURN to_jsonb(a); END IF;
  IF p_input->>'digest' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid image digest' USING ERRCODE='23514'; END IF;
  SELECT * INTO existing FROM find_image_assets WHERE user_id=p_user AND normalized_digest=p_input->>'digest' AND state='accepted';
  IF FOUND THEN
   IF NOT EXISTS(SELECT 1 FROM user_imports WHERE id=existing.import_id AND hidden_at IS NULL) THEN RAISE EXCEPTION 'image_conflict' USING ERRCODE='23514'; END IF;
   UPDATE find_image_assets SET state='duplicate',normalized_digest=p_input->>'digest',source_id=existing.source_id,import_id=existing.import_id,verify_lease=NULL,verify_until=NULL WHERE id=a.id RETURNING * INTO a;
  ELSE
   INSERT INTO content_sources(platform,external_id,canonical_url,media_kind,processing_status,pipeline_version,owner_id,private_media_id,title)
    VALUES('image',a.id::text,NULL,'IMAGE','RECEIVED','private-image-v1',p_user,a.id,'Your image') RETURNING id INTO new_source;
   INSERT INTO user_imports(user_id,raw_input,source_url,normalized_url,dedupe_key,platform,status,content_source_id,capture_origin)
    VALUES(p_user,NULL,NULL,NULL,'image:'||a.id,'image','RECEIVED',new_source,a.capture_origin) RETURNING id INTO imported;
   UPDATE find_image_assets SET state='accepted',normalized_digest=p_input->>'digest',source_id=new_source,import_id=imported,width=(p_input->>'width')::int,height=(p_input->>'height')::int,byte_size=(p_input->>'size')::int,verify_lease=NULL,verify_until=NULL WHERE id=a.id RETURNING * INTO a;
  END IF;
  result:=jsonb_build_object('protocolVersion',2,'importId',a.import_id,'created',a.state='accepted','replayed',false,'delivery','accepted');
  INSERT INTO share_acceptance_receipts(user_id,capture_id,payload_digest,import_id,reply) VALUES(p_user,a.capture_id,a.request_digest,a.import_id,result);
  RETURN to_jsonb(a);
 ELSIF p_action='release' THEN
  UPDATE find_image_assets SET state='open',verify_lease=NULL,verify_until=NULL WHERE id=a.id AND state='verifying' AND verify_lease=(p_input->>'lease')::uuid;
  RETURN jsonb_build_object('ok',true);
 END IF;
 RAISE EXCEPTION 'Invalid image action' USING ERRCODE='22023';
END $$;

-- Private bucket; no object policies for client reads, writes, listing or deletion.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
 ('find-private-images','find-private-images',false,5242880,ARRAY['image/jpeg','image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='find-private-images' AND (public OR file_size_limit IS DISTINCT FROM 5242880 OR allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg','image/png','image/webp'])) THEN RAISE EXCEPTION 'Private image bucket configuration mismatch'; END IF; END $$;
-- Also deny access if another bucket's permissive policy is broadened later.
CREATE POLICY find_images_private ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id<>'find-private-images') WITH CHECK(bucket_id<>'find-private-images');
CREATE FUNCTION public.find_claim_image_dispatch(p_lease uuid,p_limit integer DEFAULT 25)
RETURNS TABLE(user_id uuid,capture_id uuid,import_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH picked AS (SELECT r.user_id,r.capture_id FROM share_acceptance_receipts r JOIN user_imports i ON i.id=r.import_id
  JOIN content_sources s ON s.id=i.content_source_id WHERE i.hidden_at IS NULL AND s.media_kind='IMAGE' AND r.dispatch_after<=clock_timestamp()
  AND (r.dispatch_pending OR s.processing_status='QUEUED') ORDER BY r.dispatch_after LIMIT greatest(1,least(p_limit,25)) FOR UPDATE OF r SKIP LOCKED)
 UPDATE share_acceptance_receipts r SET dispatch_lease=p_lease,dispatch_after=clock_timestamp()+interval '60 seconds'
 FROM picked p WHERE r.user_id=p.user_id AND r.capture_id=p.capture_id RETURNING r.user_id,r.capture_id,r.import_id
$$;
CREATE FUNCTION public.find_image_attributions(p_user uuid,p_sources uuid[]) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',a.source_id,'findId',CASE WHEN a.state='accepted' THEN i.id END,
  'originalAvailable',a.state='accepted' AND i.hidden_at IS NULL,'label',CASE WHEN a.state='accepted' AND i.hidden_at IS NULL THEN 'Found from your image' ELSE 'Original image removed' END)),'[]')
 FROM find_image_assets a LEFT JOIN user_imports i ON i.id=a.import_id JOIN content_sources s ON s.private_media_id=a.id
 WHERE a.user_id=p_user AND s.owner_id=p_user AND a.source_id=ANY(p_sources)
$$;
CREATE OR REPLACE FUNCTION public.find_read_rows(p_user uuid,p_ids uuid[] DEFAULT NULL)
RETURNS TABLE(id uuid,created_at timestamptz,item jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH owned AS MATERIALIZED (SELECT * FROM user_imports WHERE user_id=p_user AND hidden_at IS NULL AND (p_ids IS NULL OR id=ANY(p_ids))),
 memberships AS MATERIALIZED (SELECT m FROM find_outcome_memberships(p_user,coalesce((SELECT array_agg(id) FROM owned),ARRAY[]::uuid[])) m)
 SELECT i.id,i.created_at,jsonb_build_object('id',i.id,'createdAt',i.created_at,'sourceUrl',i.source_url,
  'sourceType',CASE WHEN i.platform IN ('instagram','youtube','image') THEN i.platform ELSE 'web' END,
  'captureOrigin',i.capture_origin,'privateMedia',CASE WHEN s.media_kind='IMAGE' THEN jsonb_build_object('state','available','original','/finds/'||i.id||'/media/original','thumbnail','/finds/'||i.id||'/media/thumbnail') END,
  'contentSourceId',i.content_source_id,'title',s.title,'thumbnailUrl',s.thumbnail_url,'outcome',m.m->'outcome',
  'intent',jsonb_build_object('kind',i.interest_kind,'note',i.interest_note,'revision',i.intent_revision))
 FROM owned i JOIN memberships m ON (m.m->>'import_id')::uuid=i.id LEFT JOIN content_sources s ON s.id=i.content_source_id
$$;
CREATE OR REPLACE FUNCTION public.find_schema_version() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT 3 $$;
DO $$ DECLARE p regprocedure; BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('find_media_command','find_image_import_owner','find_image_source_owner','find_image_hide','find_image_import_delete','find_image_account_delete','find_image_soft_delete','find_claim_image_dispatch','find_image_attributions') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p);
 END LOOP;
END $$;
COMMIT;
