INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111'),('33333333-3333-4333-8333-333333333333');
INSERT INTO users(id,username) SELECT id,CASE WHEN id='11111111-1111-4111-8111-111111111111' THEN 'owner' ELSE 'visitor' END FROM auth.users;
INSERT INTO catalog_products(id,name) VALUES('22222222-2222-4222-8222-222222222222','Public mug');
INSERT INTO cart_items(id,user_id,catalog_product_id) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
DO $$ DECLARE s jsonb;v jsonb;public_id uuid;denied boolean;BEGIN
 s:=public_stash_settings('11111111-1111-4111-8111-111111111111');public_id:=(s->>'publicId')::uuid;
 IF s->>'visibility'<>'private' THEN RAISE EXCEPTION 'Not private by default';END IF;
 denied:=false;BEGIN PERFORM public_stash_read(public_id);EXCEPTION WHEN no_data_found THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Private read leaked';END IF;
 PERFORM public_stash_visibility('11111111-1111-4111-8111-111111111111','public',0);
 v:=public_stash_read(public_id);IF jsonb_array_length(v->'items')<>0 THEN RAISE EXCEPTION 'Enabling auto-published';END IF;
 denied:=false;BEGIN PERFORM public_stash_publish('33333333-3333-4333-8333-333333333333','product','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,0);EXCEPTION WHEN no_data_found THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Cross-owner publication';END IF;
 PERFORM public_stash_publish('11111111-1111-4111-8111-111111111111','product','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,0);
 v:=public_stash_read(public_id);IF jsonb_array_length(v->'items')<>1 THEN RAISE EXCEPTION 'Published item missing';END IF;
 PERFORM public_stash_visibility('11111111-1111-4111-8111-111111111111','private',1);
 denied:=false;BEGIN PERFORM public_stash_item(public_id,'product','catalog','22222222-2222-4222-8222-222222222222');EXCEPTION WHEN no_data_found THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Private detail leaked';END IF;
 PERFORM public_stash_visibility('11111111-1111-4111-8111-111111111111','public',2);
 v:=public_stash_read(public_id);IF jsonb_array_length(v->'items')<>1 THEN RAISE EXCEPTION 'Selection not restored';END IF;
 denied:=false;BEGIN PERFORM public_stash_publish('11111111-1111-4111-8111-111111111111','product','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false,0);EXCEPTION WHEN SQLSTATE 'PT409' THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Stale mutation accepted';END IF;
 PERFORM find_cart_remove('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',NULL);
 IF EXISTS(SELECT 1 FROM cart_items WHERE published_at IS NOT NULL) THEN RAISE EXCEPTION 'Unsave retained selection';END IF;
 UPDATE cart_items SET removed_at=NULL;IF EXISTS(SELECT 1 FROM cart_items WHERE published_at IS NOT NULL) THEN RAISE EXCEPTION 'Restore republished';END IF;
 IF has_function_privilege('anon','public.public_stash_read(uuid,text,integer,timestamptz,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.public_stash_publish(uuid,text,uuid,boolean,bigint,boolean)','EXECUTE') THEN RAISE EXCEPTION 'RPC grant leak';END IF;
 IF has_table_privilege('authenticated','cart_items','UPDATE') OR has_table_privilege('anon','public_stashes','SELECT') THEN RAISE EXCEPTION 'Table grant leak';END IF;
END $$;
INSERT INTO places(id,provider,provider_place_id,name) VALUES('44444444-4444-4444-8444-444444444444','google','provider-fixture','Public cafe');
INSERT INTO user_place_saves(id,user_id,place_id,save_origin) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','direct');
SELECT public_stash_publish('11111111-1111-4111-8111-111111111111','place','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,0);
DO $$ DECLARE target_stash uuid;s jsonb;BEGIN
 SELECT public_id INTO target_stash FROM public_stashes WHERE user_id='11111111-1111-4111-8111-111111111111';
 s:=public_stash_save('33333333-3333-4333-8333-333333333333',target_stash,'place','place','44444444-4444-4444-8444-444444444444');
 IF s->>'created'<>'true' THEN RAISE EXCEPTION 'Direct save missing';END IF;
 s:=public_stash_save('33333333-3333-4333-8333-333333333333',target_stash,'place','place','44444444-4444-4444-8444-444444444444');
 IF s->>'created'<>'false' THEN RAISE EXCEPTION 'Duplicate save counted';END IF;
 IF EXISTS(SELECT 1 FROM user_place_saves WHERE user_id='33333333-3333-4333-8333-333333333333' AND(content_source_id IS NOT NULL OR user_import_id IS NOT NULL OR published_at IS NOT NULL)) THEN RAISE EXCEPTION 'Direct save copied private provenance or publication';END IF;
 PERFORM find_place_membership('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
 IF EXISTS(SELECT 1 FROM user_place_saves WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'Direct Place unsave published';END IF;
 UPDATE users SET deleted_at=now(),account_status='DELETED' WHERE id='11111111-1111-4111-8111-111111111111';
 IF public_stash_visible_owner(target_stash) IS NOT NULL THEN RAISE EXCEPTION 'Deleted account visible';END IF;
 UPDATE users SET deleted_at=NULL,account_status='ACTIVE' WHERE id='11111111-1111-4111-8111-111111111111';
 IF public_stash_visible_owner(target_stash) IS NOT NULL THEN RAISE EXCEPTION 'Account restore republished';END IF;
END $$;
-- Actual RLS execution, beyond grant introspection.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public_stashes WHERE user_id='11111111-1111-4111-8111-111111111111') THEN RAISE EXCEPTION 'RLS leaked another owner';END IF;
 BEGIN PERFORM public_stash_settings('11111111-1111-4111-8111-111111111111');RAISE EXCEPTION 'Client invoked privileged RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
-- A merge must carry an explicit unpublish rather than reviving an older selection.
INSERT INTO catalog_products(id,name) VALUES('66666666-6666-4666-8666-666666666666','Old identity'),('77777777-7777-4777-8777-777777777777','Survivor');
INSERT INTO cart_items(id,user_id,catalog_product_id,published_at,publication_changed_at) VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666',now()-interval '2 minutes',now()-interval '2 minutes'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','33333333-3333-4333-8333-333333333333','77777777-7777-4777-8777-777777777777',NULL,now()-interval '1 minute');
SELECT find_cart_remap('66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM cart_items WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'Merge revived publication';END IF;END $$;
-- An explicit no-op unpublish is newer than another identity's prior selection.
SELECT public_stash_publish('33333333-3333-4333-8333-333333333333','product','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false,(SELECT publication_version FROM cart_items WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'));
INSERT INTO catalog_products(id,name) VALUES('88888888-8888-4888-8888-888888888888','Second old identity');
INSERT INTO cart_items(id,user_id,catalog_product_id,published_at,publication_changed_at) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','33333333-3333-4333-8333-333333333333','88888888-8888-4888-8888-888888888888',now()-interval '10 seconds',now()-interval '10 seconds');
SELECT find_cart_remap('88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM cart_items WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'Merge ignored explicit no-op unpublish';END IF;END $$;
