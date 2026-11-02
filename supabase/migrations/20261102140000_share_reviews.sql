BEGIN;
ALTER TABLE public.content_source_products ADD COLUMN match_assessment jsonb
  CHECK(match_assessment IS NULL OR (jsonb_typeof(match_assessment)='object' AND octet_length(match_assessment::text)<=16384));
CREATE INDEX user_imports_history_cursor_idx ON public.user_imports(user_id,created_at DESC,id DESC) WHERE hidden_at IS NULL;
CREATE TABLE public.user_import_product_reviews (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.user_imports(id) ON DELETE CASCADE,
  source_product_id uuid NOT NULL REFERENCES public.content_source_products(id) ON DELETE CASCADE,
  candidate_key text NOT NULL CHECK(candidate_key ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK(state IN ('accepting','accepted','dismissed')),
  lease_id uuid,
  lease_until timestamptz,
  product_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(import_id,source_product_id,candidate_key)
);
ALTER TABLE public.user_import_product_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_import_product_reviews FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.user_import_product_reviews TO service_role;
CREATE FUNCTION public.share_review_claim(p_user uuid,p_import uuid,p_source uuid,p_key text,p_lease uuid,p_dismiss boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.user_import_product_reviews;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM user_imports u JOIN content_source_products p ON p.content_source_id=u.content_source_id
    WHERE u.id=p_import AND u.user_id=p_user AND u.hidden_at IS NULL AND p.id=p_source
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p.match_assessment->'suggestions','[]'::jsonb)) s WHERE s->>'key'=p_key))
    THEN RAISE EXCEPTION 'import_not_found'; END IF;
  INSERT INTO user_import_product_reviews(user_id,import_id,source_product_id,candidate_key,state,lease_id,lease_until)
    VALUES(p_user,p_import,p_source,p_key,CASE WHEN p_dismiss THEN 'dismissed' ELSE 'accepting' END,p_lease,now()+interval '60 seconds')
    ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT r FROM user_import_product_reviews WHERE import_id=p_import AND source_product_id=p_source AND candidate_key=p_key FOR UPDATE;
  IF r.user_id<>p_user THEN RAISE EXCEPTION 'import_not_found'; END IF;
  IF r.state='accepted' OR (r.state='dismissed' AND p_dismiss) THEN RETURN jsonb_build_object('state',r.state,'productId',r.product_id); END IF;
  IF r.state='accepting' AND r.lease_id<>p_lease AND r.lease_until>now() THEN RAISE EXCEPTION 'review_busy'; END IF;
  UPDATE user_import_product_reviews SET state=CASE WHEN p_dismiss THEN 'dismissed' ELSE 'accepting' END,
    lease_id=p_lease,lease_until=now()+interval '60 seconds',updated_at=now()
    WHERE import_id=p_import AND source_product_id=p_source AND candidate_key=p_key;
  RETURN jsonb_build_object('state',CASE WHEN p_dismiss THEN 'dismissed' ELSE 'accepting' END);
END $$;
REVOKE ALL ON FUNCTION public.share_review_claim(uuid,uuid,uuid,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.share_review_claim(uuid,uuid,uuid,text,uuid,boolean) TO service_role;
COMMIT;
