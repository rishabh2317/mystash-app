BEGIN;
-- Serialization failures are HTTP 500 at PostgREST and can be retried by gateways.
-- An expected-version mismatch is an application conflict, not a transient DB failure.
DO $$ DECLARE signature regprocedure;definition text;BEGIN
 FOR signature IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('public_stash_visibility','public_stash_publish') LOOP
  SELECT pg_get_functiondef(signature) INTO definition;
  IF position('''40001''' IN definition)=0 THEN RAISE EXCEPTION 'Public Stash conflict contract changed';END IF;
  EXECUTE replace(definition,'''40001''','''PT409''');
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
