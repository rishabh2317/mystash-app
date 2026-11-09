INSERT INTO auth.users VALUES ('70000000-0000-4000-8000-000000000001'), ('70000000-0000-4000-8000-000000000002');
INSERT INTO public.users(id,creator_status) VALUES
 ('70000000-0000-4000-8000-000000000001','ACTIVE'),
 ('70000000-0000-4000-8000-000000000002','ACTIVE');
INSERT INTO public.collections(id,creator_id,title) VALUES
 ('70000000-0000-4000-8000-000000000011','70000000-0000-4000-8000-000000000001','Own collection'),
 ('70000000-0000-4000-8000-000000000012','70000000-0000-4000-8000-000000000002','Other collection');
INSERT INTO public.analytics_creator_daily(creator_id,day,metric,entity_id,namespace,collection_key,value) VALUES
 ('70000000-0000-4000-8000-000000000001',current_date-10,'collection_opens','70000000-0000-4000-8000-000000000011','','70000000-0000-4000-8000-000000000011',3),
 ('70000000-0000-4000-8000-000000000001',current_date-9,'collection_opens','70000000-0000-4000-8000-000000000011','','70000000-0000-4000-8000-000000000011',5),
 ('70000000-0000-4000-8000-000000000002',current_date-9,'collection_opens','70000000-0000-4000-8000-000000000012','','70000000-0000-4000-8000-000000000012',99);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.analytics_creator_report_range('70000000-0000-4000-8000-000000000001',current_date-10,current_date-9);
 PERFORM public.test_assert((r->>'days')::int=1 AND (r->>'end_day')::date=current_date-9,'one complete UTC day uses exclusive end');
 PERFORM public.test_assert((SELECT (x->>'value')::int FROM jsonb_array_elements(r->'daily') x
  WHERE x->>'day'=(current_date-10)::text AND x->>'metric'='collection_opens')=3,'current day included');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'daily') x
  WHERE x->>'day'=(current_date-9)::text),'exclusive end excludes the next day');
 PERFORM public.test_assert(jsonb_array_length(r->'top_collections')=1 AND r->'top_collections'->0->>'title'='Own collection','rankings scoped to selected day and creator');
 r:=public.analytics_creator_report_range('70000000-0000-4000-8000-000000000001',current_date-9,current_date-8);
 PERFORM public.test_assert((SELECT (x->>'value')::int FROM jsonb_array_elements(r->'daily') x
  WHERE x->>'day'=(current_date-9)::text AND x->>'metric'='collection_opens')=5,'adjacent range includes next day');
 PERFORM public.test_assert(NOT has_function_privilege('authenticated','public.analytics_creator_report_range(uuid,date,date)','EXECUTE'),'authenticated cannot call custom RPC');
 PERFORM public.test_assert(NOT has_function_privilege('anon','public.analytics_creator_report_range(uuid,date,date)','EXECUTE'),'anonymous cannot call custom RPC');
 BEGIN PERFORM public.analytics_creator_report_range('70000000-0000-4000-8000-000000000001',current_date,current_date+1);
  RAISE EXCEPTION 'future range accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.analytics_creator_report_range('70000000-0000-4000-8000-000000000001',current_date-91,current_date);
  RAISE EXCEPTION 'overlong range accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 UPDATE public.collections SET visibility='private' WHERE id='70000000-0000-4000-8000-000000000011';
 r:=public.analytics_creator_report_range('70000000-0000-4000-8000-000000000001',current_date-10,current_date-9);
 PERFORM public.test_assert(jsonb_array_length(r->'top_collections')=0 AND jsonb_array_length(r->'daily')=0,'private collection excluded');
END $$;
