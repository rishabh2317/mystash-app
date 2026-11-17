BEGIN;
CREATE TABLE public.public_stashes (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN('private','public')),
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.public_stashes ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_stash_owner_read ON public.public_stashes FOR SELECT USING(user_id=auth.uid());
REVOKE ALL ON public.public_stashes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.public_stashes TO authenticated;
GRANT ALL ON public.public_stashes TO service_role;
ALTER TABLE public.cart_items ADD COLUMN published_at timestamptz,ADD COLUMN publication_changed_at timestamptz,
 ADD COLUMN publication_version bigint NOT NULL DEFAULT 0 CHECK(publication_version>=0),
 ADD CONSTRAINT cart_publication_saved CHECK(published_at IS NULL OR removed_at IS NULL);
ALTER TABLE public.user_place_saves ADD COLUMN published_at timestamptz,ADD COLUMN publication_changed_at timestamptz,
 ADD COLUMN publication_version bigint NOT NULL DEFAULT 0 CHECK(publication_version>=0),
 ADD COLUMN save_origin text NOT NULL DEFAULT 'import' CHECK(save_origin IN('import','direct')),
 ALTER COLUMN content_source_place_id DROP NOT NULL,ALTER COLUMN content_source_id DROP NOT NULL,ALTER COLUMN user_import_id DROP NOT NULL,
 ADD CONSTRAINT place_save_origin_shape CHECK((save_origin='import' AND content_source_place_id IS NOT NULL AND content_source_id IS NOT NULL AND user_import_id IS NOT NULL)
 OR(save_origin='direct' AND place_id IS NOT NULL AND content_source_place_id IS NULL AND content_source_id IS NULL AND user_import_id IS NULL)),
 ADD CONSTRAINT place_publication_saved CHECK(published_at IS NULL OR(removed_at IS NULL AND place_id IS NOT NULL));
ALTER TABLE public.cart_items DROP CONSTRAINT cart_items_source_surface_check;
ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_source_surface_check CHECK(source_surface IS NULL OR source_surface IN('COLLECTION','SEARCH','PRODUCT_DETAILS','OTHER','USER_IMPORT','PUBLIC_STASH'));
CREATE INDEX cart_public_stash_page ON public.cart_items(user_id,published_at DESC,id DESC) WHERE published_at IS NOT NULL AND removed_at IS NULL;
CREATE INDEX place_public_stash_page ON public.user_place_saves(user_id,published_at DESC,id DESC) WHERE published_at IS NOT NULL AND removed_at IS NULL;

CREATE FUNCTION public.public_stash_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN IF NEW.public_id IS DISTINCT FROM OLD.public_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Stash identity is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER public_stash_identity_guard BEFORE UPDATE ON public.public_stashes FOR EACH ROW EXECUTE FUNCTION public.public_stash_identity_guard();
CREATE FUNCTION public.public_stash_unsave() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.removed_at IS NOT NULL THEN
  IF TG_OP='INSERT' OR OLD.removed_at IS NULL OR NEW.published_at IS NOT NULL THEN
   NEW.published_at:=NULL;NEW.publication_changed_at:=clock_timestamp();NEW.publication_version:=NEW.publication_version+1;
  END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER public_stash_cart_unsave BEFORE INSERT OR UPDATE ON public.cart_items FOR EACH ROW EXECUTE FUNCTION public.public_stash_unsave();
CREATE TRIGGER public_stash_place_unsave BEFORE INSERT OR UPDATE ON public.user_place_saves FOR EACH ROW EXECUTE FUNCTION public.public_stash_unsave();
CREATE FUNCTION public.public_stash_account_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL OR NEW.account_status='DELETED' THEN
  UPDATE public_stashes SET visibility='private',version=version+1,updated_at=clock_timestamp() WHERE user_id=NEW.id AND visibility<>'private';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER public_stash_account_revoke AFTER UPDATE OF deleted_at,account_status ON public.users FOR EACH ROW EXECUTE FUNCTION public.public_stash_account_revoke();
CREATE FUNCTION public.public_stash_visible_owner(p_public uuid,p_preview uuid DEFAULT NULL) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT s.user_id FROM public_stashes s JOIN users u ON u.id=s.user_id WHERE s.public_id=p_public
 AND(s.visibility='public' OR s.user_id=p_preview) AND u.deleted_at IS NULL AND u.account_status IN('ACTIVE','CREATED')
$$;
CREATE FUNCTION public.public_stash_settings(p_user uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public_stashes;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user AND deleted_at IS NULL AND account_status IN('ACTIVE','CREATED')) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002';END IF;
 INSERT INTO public_stashes(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public_stashes WHERE user_id=p_user;
 RETURN jsonb_build_object('publicId',s.public_id,'visibility',s.visibility,'version',s.version,
 'products',coalesce((SELECT jsonb_agg(jsonb_build_object('membershipId',id,'namespace',CASE WHEN catalog_product_id IS NOT NULL THEN 'catalog' ELSE 'discovered' END,
 'itemId',coalesce(catalog_product_id,discovered_product_id),'published',published_at IS NOT NULL,'version',publication_version)) FROM cart_items WHERE user_id=p_user AND removed_at IS NULL),'[]'::jsonb),
 'places',coalesce((SELECT jsonb_agg(jsonb_build_object('membershipId',id,'itemId',place_id,'published',published_at IS NOT NULL,'version',publication_version)) FROM user_place_saves WHERE user_id=p_user AND removed_at IS NULL),'[]'::jsonb));
END $$;
CREATE FUNCTION public.public_stash_visibility(p_user uuid,p_visibility text,p_version bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public_stashes;
BEGIN
 IF p_visibility IS NULL OR p_visibility NOT IN('private','public') THEN RAISE EXCEPTION 'Invalid visibility' USING ERRCODE='22023';END IF;
 PERFORM public_stash_settings(p_user);
 SELECT * INTO s FROM public_stashes WHERE user_id=p_user FOR UPDATE;
 IF p_version IS NULL OR s.version<>p_version THEN RAISE EXCEPTION 'Refresh publication state' USING ERRCODE='40001';END IF;
 IF s.visibility<>p_visibility THEN UPDATE public_stashes SET visibility=p_visibility,version=version+1,updated_at=clock_timestamp() WHERE user_id=p_user;END IF;
 RETURN public_stash_settings(p_user);
END $$;
CREATE FUNCTION public.public_stash_publish(p_user uuid,p_kind text,p_membership uuid,p_published boolean,p_version bigint,p_enable boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record;tab text;eligible boolean;
BEGIN
 PERFORM public_stash_settings(p_user);
 PERFORM 1 FROM public_stashes WHERE user_id=p_user FOR UPDATE;
 IF p_kind='product' THEN tab:='cart_items';ELSIF p_kind='place' THEN tab:='user_place_saves';ELSE RAISE EXCEPTION 'Invalid kind' USING ERRCODE='22023';END IF;
 EXECUTE format('SELECT * FROM %I WHERE id=$1 AND user_id=$2 AND removed_at IS NULL FOR UPDATE',tab) INTO r USING p_membership,p_user;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Membership not found' USING ERRCODE='P0002';END IF;
 IF p_version IS NULL OR r.publication_version<>p_version THEN RAISE EXCEPTION 'Refresh publication state' USING ERRCODE='40001';END IF;
 IF p_published IS NULL THEN RAISE EXCEPTION 'Invalid publication' USING ERRCODE='22023';END IF;
 IF p_kind='place' THEN eligible:=(r.save_origin='direct' OR EXISTS(SELECT 1 FROM content_source_places h WHERE h.id=r.content_source_place_id AND h.retired_at IS NULL)) AND r.place_id IS NOT NULL AND EXISTS(SELECT 1 FROM places WHERE id=r.place_id);
 ELSE eligible:=EXISTS(SELECT 1 FROM catalog_products WHERE id=r.catalog_product_id AND status='ACTIVE') OR EXISTS(SELECT 1 FROM discovered_products WHERE id=r.discovered_product_id AND internal_status='ACTIVE');END IF;
 IF p_published AND NOT eligible THEN RAISE EXCEPTION 'Item unavailable for publication' USING ERRCODE='23514';END IF;
 -- Record every accepted explicit decision, including unpublish on an already
 -- unpublished survivor. A later identity merge must not revive an older selection.
 EXECUTE format('UPDATE %I SET published_at=CASE WHEN $1 THEN coalesce(published_at,clock_timestamp()) END,publication_changed_at=clock_timestamp(),publication_version=publication_version+1 WHERE id=$2',tab) USING p_published,p_membership;
 IF p_enable AND p_published THEN UPDATE public_stashes SET visibility='public',version=version+1,updated_at=clock_timestamp() WHERE user_id=p_user AND visibility='private';END IF;
 RETURN public_stash_settings(p_user);
END $$;
CREATE FUNCTION public.public_stash_item(p_public uuid,p_kind text,p_namespace text,p_item uuid,p_preview uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid;result jsonb;
BEGIN
 IF p_kind='product' AND p_namespace='catalog' THEN p_item:=find_catalog_survivor(p_item);END IF;
 owner:=public_stash_visible_owner(p_public,p_preview);
 IF owner IS NULL THEN RAISE EXCEPTION 'Stash unavailable' USING ERRCODE='P0002';END IF;
 IF p_kind='product' THEN
 SELECT jsonb_build_object('id',p_item,'namespace',p_namespace) INTO result FROM cart_items c WHERE c.user_id=owner AND c.removed_at IS NULL AND c.published_at IS NOT NULL
 AND((p_namespace='catalog' AND c.catalog_product_id=p_item AND EXISTS(SELECT 1 FROM catalog_products WHERE id=p_item AND status='ACTIVE'))
 OR(p_namespace='discovered' AND c.discovered_product_id=p_item AND EXISTS(SELECT 1 FROM discovered_products WHERE id=p_item AND internal_status='ACTIVE'))) LIMIT 1;
 ELSIF p_kind='place' THEN
 SELECT jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'city',p.city,'region',p.region,'country',p.country,'locality',p.locality,
 'formattedAddress',p.formatted_address,'latitude',p.latitude,'longitude',p.longitude,'mapsUrl',p.maps_url,'provider',p.provider,'providerPlaceId',p.provider_place_id)
 INTO result FROM user_place_saves s JOIN places p ON p.id=s.place_id WHERE s.user_id=owner AND s.removed_at IS NULL AND s.published_at IS NOT NULL AND (s.save_origin='direct' OR EXISTS(SELECT 1 FROM content_source_places h WHERE h.id=s.content_source_place_id AND h.retired_at IS NULL)) AND s.place_id=p_item;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Item unavailable' USING ERRCODE='P0002';END IF;RETURN result;
END $$;
CREATE FUNCTION public.public_stash_read(p_public uuid,p_tab text DEFAULT 'products',p_limit integer DEFAULT 20,p_time timestamptz DEFAULT NULL,p_after uuid DEFAULT NULL,p_preview uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid;items jsonb;counts jsonb;curator jsonb;
BEGIN
 owner:=public_stash_visible_owner(p_public,p_preview);
 IF owner IS NULL THEN RAISE EXCEPTION 'Stash unavailable' USING ERRCODE='P0002';END IF;
 IF p_limit<1 OR p_limit>51 OR p_tab NOT IN('products','places') OR (p_time IS NULL)<>(p_after IS NULL) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 SELECT jsonb_build_object('username',username,'avatarUrl',profile_photo_url) INTO curator FROM users WHERE id=owner;
 SELECT jsonb_build_object('products',(SELECT count(*) FROM cart_items c LEFT JOIN catalog_products p ON p.id=c.catalog_product_id LEFT JOIN discovered_products d ON d.id=c.discovered_product_id
 WHERE c.user_id=owner AND c.removed_at IS NULL AND c.published_at IS NOT NULL AND(p.status='ACTIVE' OR d.internal_status='ACTIVE')),
 'places',(SELECT count(*) FROM user_place_saves s JOIN places p ON p.id=s.place_id WHERE s.user_id=owner AND s.removed_at IS NULL AND s.published_at IS NOT NULL AND (s.save_origin='direct' OR EXISTS(SELECT 1 FROM content_source_places h WHERE h.id=s.content_source_place_id AND h.retired_at IS NULL)))) INTO counts;
 IF p_tab='products' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO items FROM(
 SELECT c.id AS cursor_id,c.published_at AS cursor_time,coalesce(c.catalog_product_id,c.discovered_product_id) AS id,
 CASE WHEN c.catalog_product_id IS NOT NULL THEN 'catalog' ELSE 'discovered' END AS namespace,
 coalesce(p.name,d.name) AS title,coalesce(p.image_url,d.image_url) AS image,coalesce(p.brand,d.brand) AS brand
 FROM cart_items c LEFT JOIN catalog_products p ON p.id=c.catalog_product_id LEFT JOIN discovered_products d ON d.id=c.discovered_product_id
 WHERE c.user_id=owner AND c.removed_at IS NULL AND c.published_at IS NOT NULL AND(p.status='ACTIVE' OR d.internal_status='ACTIVE')
 AND(p_time IS NULL OR(c.published_at,c.id)<(p_time,p_after)) ORDER BY c.published_at DESC,c.id DESC LIMIT p_limit) x;
 ELSE
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO items FROM(
 SELECT s.id AS cursor_id,s.published_at AS cursor_time,p.id,p.name AS title,p.category,p.city,p.country
 FROM user_place_saves s JOIN places p ON p.id=s.place_id WHERE s.user_id=owner AND s.removed_at IS NULL AND s.published_at IS NOT NULL AND (s.save_origin='direct' OR EXISTS(SELECT 1 FROM content_source_places h WHERE h.id=s.content_source_place_id AND h.retired_at IS NULL))
 AND(p_time IS NULL OR(s.published_at,s.id)<(p_time,p_after)) ORDER BY s.published_at DESC,s.id DESC LIMIT p_limit) x;
 END IF;
 RETURN jsonb_build_object('publicId',p_public,'curator',curator,'counts',counts,'items',items);
END $$;
CREATE FUNCTION public.public_stash_save(p_user uuid,p_public uuid,p_kind text,p_namespace text,p_item uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;s user_place_saves;was_removed boolean;
BEGIN
 PERFORM 1 FROM public_stashes WHERE public_id=p_public FOR SHARE;
 result:=public_stash_item(p_public,p_kind,p_namespace,p_item);
 p_item:=(result->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user AND deleted_at IS NULL AND account_status IN('ACTIVE','CREATED')) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002';END IF;
 IF p_kind='product' THEN
  IF p_namespace='catalog' THEN PERFORM id FROM catalog_products WHERE id=p_item FOR SHARE; ELSE PERFORM id FROM discovered_products WHERE id=p_item FOR SHARE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('find-cart:'||p_user::text,0));
  SELECT removed_at IS NOT NULL INTO was_removed FROM cart_items WHERE user_id=p_user AND(catalog_product_id=p_item OR discovered_product_id=p_item);
  result:=find_cart_put(p_user,CASE WHEN p_namespace='catalog' THEN p_item END,CASE WHEN p_namespace='discovered' THEN p_item END,jsonb_build_object('source_surface','PUBLIC_STASH'),false);
  RETURN jsonb_build_object('saved',true,'created',coalesce((result->>'created')::boolean,false) OR coalesce(was_removed,false));
 END IF;
 PERFORM 1 FROM places WHERE id=p_item FOR UPDATE;
 SELECT * INTO s FROM user_place_saves WHERE user_id=p_user AND place_id=p_item FOR UPDATE;
 IF FOUND THEN
  was_removed:=s.removed_at IS NOT NULL;
  IF was_removed THEN UPDATE user_place_saves SET removed_at=NULL,explicit_action_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=s.id;END IF;
 ELSE
  INSERT INTO user_place_saves(user_id,place_id,save_origin,explicit_action_at) VALUES(p_user,p_item,'direct',clock_timestamp());was_removed:=true;
 END IF;
 RETURN jsonb_build_object('saved',true,'created',was_removed);
END $$;
CREATE OR REPLACE FUNCTION public.find_cart_remap(p_source uuid,p_target uuid) RETURNS jsonb LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.cart_items; target public.cart_items; remapped integer:=0; collisions integer:=0;
BEGIN
 IF p_source=p_target THEN RETURN jsonb_build_object('remapped',0,'collisionsResolved',0); END IF;
 PERFORM id FROM catalog_products WHERE id IN (p_source,p_target) ORDER BY id FOR SHARE;
 FOR r IN SELECT * FROM cart_items WHERE catalog_product_id=p_source ORDER BY user_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('find-cart:'||r.user_id::text,0));
  SELECT * INTO r FROM cart_items WHERE id=r.id FOR UPDATE;
  IF NOT FOUND THEN CONTINUE; END IF;
  SELECT * INTO target FROM cart_items WHERE user_id=r.user_id AND catalog_product_id=p_target FOR UPDATE;
  IF FOUND THEN
   IF r.explicit_action_at IS NOT NULL AND (target.explicit_action_at IS NULL OR r.explicit_action_at>target.explicit_action_at OR (r.explicit_action_at=target.explicit_action_at AND r.removed_at IS NOT NULL)) THEN
    UPDATE cart_items SET removed_at=r.removed_at,explicit_action_at=r.explicit_action_at WHERE id=target.id;
   END IF;
   UPDATE cart_items SET published_at=CASE WHEN removed_at IS NULL THEN
    CASE WHEN r.publication_changed_at IS NOT NULL AND (publication_changed_at IS NULL OR r.publication_changed_at>publication_changed_at OR(r.publication_changed_at=publication_changed_at AND r.published_at IS NULL)) THEN r.published_at ELSE published_at END END,
    publication_changed_at=greatest(publication_changed_at,r.publication_changed_at),publication_version=greatest(publication_version,r.publication_version)+1 WHERE id=target.id;
   DELETE FROM cart_items WHERE id=r.id; collisions:=collisions+1;
  ELSE
   UPDATE cart_items SET catalog_product_id=p_target,updated_at=clock_timestamp() WHERE id=r.id; remapped:=remapped+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('remapped',remapped,'collisionsResolved',collisions);
END $$;

CREATE OR REPLACE FUNCTION public.find_place_membership(p_user uuid,p_save uuid,p_restore boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.user_place_saves; h public.content_source_places;
BEGIN
 SELECT * INTO r FROM user_place_saves WHERE user_id=p_user AND
  id=coalesce((SELECT save_id FROM place_save_redirects WHERE old_save_id=p_save),p_save);
 IF NOT FOUND THEN RAISE EXCEPTION 'Place save not found' USING ERRCODE='P0002'; END IF;
 IF r.save_origin='direct' THEN
  PERFORM id FROM places WHERE id=r.place_id FOR UPDATE;
  UPDATE user_place_saves SET removed_at=CASE WHEN NOT p_restore THEN clock_timestamp() END,explicit_action_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  RETURN to_jsonb(r);
 END IF;
 SELECT * INTO STRICT h FROM content_source_places WHERE id=r.content_source_place_id FOR UPDATE;
 IF h.place_id IS NOT NULL THEN PERFORM id FROM places WHERE id=h.place_id FOR UPDATE; END IF;
 IF p_restore AND h.retired_at IS NOT NULL THEN RAISE EXCEPTION 'Place result unavailable' USING ERRCODE='23514'; END IF;
 UPDATE user_place_saves SET removed_at=CASE WHEN NOT p_restore THEN clock_timestamp() END,
 explicit_action_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE user_id=p_user AND id=coalesce((SELECT save_id FROM place_save_redirects WHERE old_save_id=p_save),p_save) RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.place_mark_resolved(p_hypothesis_id uuid,p_place_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET statement_timeout='20s' SET lock_timeout='2s' AS $$
DECLARE h public.content_source_places; s public.user_place_saves; survivor public.user_place_saves;
BEGIN
 PERFORM public.import_work_assert();
 SELECT * INTO STRICT h FROM public.content_source_places WHERE id=p_hypothesis_id FOR UPDATE;
 PERFORM id FROM public.places WHERE id=p_place_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Canonical place not found' USING ERRCODE='23514'; END IF;
 IF h.place_id IS NOT NULL AND h.place_id<>p_place_id THEN
  RAISE EXCEPTION 'Hypothesis already has a different canonical identity' USING ERRCODE='23514'; END IF;
 UPDATE public.content_source_places SET place_id=p_place_id,resolution_state='resolved',unresolved_reason=NULL,
 updated_at=clock_timestamp() WHERE id=h.id RETURNING * INTO h;
 FOR s IN SELECT * FROM public.user_place_saves WHERE content_source_place_id=h.id ORDER BY user_id,id FOR UPDATE LOOP
  SELECT * INTO survivor FROM public.user_place_saves WHERE user_id=s.user_id AND place_id=p_place_id AND id<>s.id FOR UPDATE;
  IF FOUND THEN
   IF s.explicit_action_at IS NOT NULL AND (survivor.explicit_action_at IS NULL OR s.explicit_action_at>survivor.explicit_action_at OR (s.explicit_action_at=survivor.explicit_action_at AND s.removed_at IS NOT NULL)) THEN
    UPDATE public.user_place_saves SET removed_at=s.removed_at,explicit_action_at=s.explicit_action_at WHERE id=survivor.id;
   END IF;
   UPDATE user_place_saves SET published_at=CASE WHEN removed_at IS NULL THEN
    CASE WHEN s.publication_changed_at IS NOT NULL AND (publication_changed_at IS NULL OR s.publication_changed_at>publication_changed_at OR(s.publication_changed_at=publication_changed_at AND s.published_at IS NULL)) THEN s.published_at ELSE published_at END END,
    publication_changed_at=greatest(publication_changed_at,s.publication_changed_at),publication_version=greatest(publication_version,s.publication_version)+1 WHERE id=survivor.id;
   -- Move attribution before deleting the redundant card. Neither source disappears.
   UPDATE public.user_place_save_sources SET save_id=survivor.id WHERE save_id=s.id;
   UPDATE public.place_save_redirects SET save_id=survivor.id WHERE save_id=s.id;
   INSERT INTO public.place_save_redirects(old_save_id,save_id) VALUES(s.id,survivor.id)
    ON CONFLICT(old_save_id) DO UPDATE SET save_id=EXCLUDED.save_id;
   DELETE FROM public.user_place_saves WHERE id=s.id;
  ELSE
   UPDATE public.user_place_saves SET place_id=p_place_id,updated_at=clock_timestamp() WHERE id=s.id;
  END IF;
 END LOOP;
 RETURN to_jsonb(h);
END $$;
DO $$ DECLARE p regprocedure; BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'public_stash_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p);END LOOP;
 END $$;
COMMIT;
