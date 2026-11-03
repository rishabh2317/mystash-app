-- Read-only deployed dependency audit. Account values are psql parameters.

BEGIN READ ONLY; SET LOCAL ROLE postgres; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
 'migration_versions',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations WHERE version>='20261027000000'),
 'functions',(SELECT jsonb_object_agg(name,to_regprocedure(signature) IS NOT NULL) FROM (VALUES
 ('ingest','public.analytics_ingest(uuid,uuid,jsonb,text,jsonb)'),
 ('preferences','public.analytics_set_preferences(uuid,boolean,boolean,uuid,boolean,boolean)'),
 ('creator','public.analytics_creator_report(uuid,integer)'),('admin','public.analytics_admin_report(uuid,integer)'),
 ('creator_rollup','public.analytics_rollup_creators(boolean)'),('admin_rollup','public.analytics_rollup_admin(boolean)'),
 ('maintenance','public.analytics_maintenance()'),('interest_claim','public.analytics_interest_claim(integer)'),
 ('interest_source','public.analytics_interest_source(uuid)'),('interest_store','public.analytics_interest_store(uuid,uuid,jsonb,boolean,timestamptz)'),
 ('personalization','public.analytics_set_personalization(uuid,boolean,uuid,uuid,integer)'),('interest_delete','public.analytics_reset_interests(uuid)')) x(name,signature)),
 'worker_rpc_timeouts_safe',(SELECT count(*)=7 AND bool_and(coalesce(array_to_string(proconfig,',') LIKE '%statement_timeout=%',false)
  AND coalesce(array_to_string(proconfig,',') LIKE '%lock_timeout=%',false)) FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname IN ('analytics_rollup_creators','analytics_rollup_admin',
  'analytics_interest_claim','analytics_interest_source','analytics_interest_store','analytics_maintenance','engagement_check_and_record')),
 'private_tables_rls_enabled',(SELECT bool_and(rowsecurity) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'analytics_%'),
 'private_table_grants_safe',NOT EXISTS(SELECT 1 FROM pg_tables t WHERE schemaname='public' AND tablename LIKE 'analytics_%'
  AND (has_table_privilege('anon','public.'||tablename,'SELECT') OR has_table_privilege('authenticated','public.'||tablename,'SELECT'))),
 'preflight',public.engagement_counter_preflight(),
 'preferences_total',(SELECT count(*) FROM public.analytics_preferences),
 'measurement_opt_ins',(SELECT count(*) FROM public.analytics_preferences WHERE measurement_enabled),
 'activity_opt_ins',(SELECT count(*) FROM public.analytics_preferences WHERE activity_enabled),
 'personalization_opt_ins',(SELECT count(*) FROM public.analytics_preferences WHERE personalization_enabled),
 'events',(SELECT count(*) FROM public.analytics_events),'profiles',(SELECT count(*) FROM public.analytics_interest_profiles),
 'admin_members',(SELECT coalesce(jsonb_agg(user_id),'[]') FROM public.analytics_admin_members WHERE enabled),
 'accounts',(SELECT coalesce(jsonb_object_agg(CASE WHEN lower(a.email)=lower(:'test_email') THEN 'test' ELSE 'admin' END,
  jsonb_build_object('id',a.id,'verified',a.email_confirmed_at IS NOT NULL,'profile_exists',u.id IS NOT NULL,
   'account_status',u.account_status,'creator_status',u.creator_status,'deleted',u.deleted_at IS NOT NULL,
   'measurement',coalesce(p.measurement_enabled,false),'activity',coalesce(p.activity_enabled,false),
   'personalization',coalesce(p.personalization_enabled,false))), '{}')
  FROM auth.users a LEFT JOIN public.users u ON u.id=a.id LEFT JOIN public.analytics_preferences p ON p.user_id=a.id
  WHERE lower(a.email) IN (lower(:'test_email'),lower(:'admin_email'))),
 'creator_refreshed_at',(SELECT last_scan FROM public.analytics_rollup_state WHERE singleton),
 'admin_refreshed_at',(SELECT last_scan FROM public.analytics_admin_rollup_state WHERE singleton));
ROLLBACK;
