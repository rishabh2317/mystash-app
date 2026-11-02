BEGIN;
ALTER TABLE public.user_imports ADD COLUMN interest_kind text CHECK(interest_kind IN ('product','place','both')),
  ADD COLUMN interest_note text CHECK(char_length(interest_note)<=280),
  ADD COLUMN intent_revision integer NOT NULL DEFAULT 0 CHECK(intent_revision>=0);
ALTER TABLE public.share_acceptance_receipts ADD COLUMN intent_reply jsonb;

CREATE FUNCTION public.share_update_intent(p_user uuid,p_import uuid,p_kind text,p_note text,p_revision integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_revision integer;
BEGIN
  SELECT intent_revision INTO current_revision FROM user_imports WHERE id=p_import AND user_id=p_user AND hidden_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found'; END IF;
  IF p_revision IS NULL OR p_revision<>current_revision THEN RAISE EXCEPTION 'revision_conflict'; END IF;
  UPDATE user_imports SET interest_kind=p_kind,interest_note=NULLIF(btrim(p_note),''),intent_revision=intent_revision+1,
    updated_at=now() WHERE id=p_import RETURNING intent_revision INTO current_revision;
  RETURN current_revision;
END $$;
CREATE FUNCTION public.share_capture_intent(p_user uuid,p_capture uuid,p_kind text,p_note text,p_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.share_acceptance_receipts; u public.user_imports; result jsonb;
BEGIN
  SELECT * INTO r FROM share_acceptance_receipts WHERE user_id=p_user AND capture_id=p_capture FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found'; END IF;
  IF r.intent_reply IS NOT NULL THEN RETURN r.intent_reply; END IF;
  SELECT * INTO u FROM user_imports WHERE id=r.import_id AND user_id=p_user AND hidden_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found'; END IF;
  -- Unknown native base revision may initialize an untouched import only.
  IF (p_revision IS NULL AND u.intent_revision<>0) OR (p_revision IS NOT NULL AND p_revision<>u.intent_revision) THEN
    result=jsonb_build_object('state','conflict','revision',u.intent_revision);
  ELSE
    UPDATE user_imports SET interest_kind=p_kind,interest_note=NULLIF(btrim(p_note),''),intent_revision=intent_revision+1,
      updated_at=now() WHERE id=u.id RETURNING intent_revision INTO u.intent_revision;
    result=jsonb_build_object('state','saved','revision',u.intent_revision);
  END IF;
  UPDATE share_acceptance_receipts SET intent_reply=result WHERE user_id=p_user AND capture_id=p_capture;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.share_update_intent(uuid,uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.share_capture_intent(uuid,uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.share_update_intent(uuid,uuid,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.share_capture_intent(uuid,uuid,text,text,integer) TO service_role;
COMMIT;
