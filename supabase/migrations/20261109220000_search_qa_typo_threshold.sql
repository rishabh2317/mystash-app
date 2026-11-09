-- Keep the Render QA fallback tolerant of one-character brand/title typos.
-- pg_trgm's default word-similarity threshold (0.6) excludes `samsng` from
-- `Samsung` (0.571), although the same typo passes on some longer titles.
-- This QA-only predicate is deliberately bounded by entity and existing filters.
CREATE OR REPLACE FUNCTION public.search_qa_typo_match(p_query text, p_text text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT length(p_query) >= 4 AND word_similarity(p_query, p_text) >= 0.5;
$$;
REVOKE ALL ON FUNCTION public.search_qa_typo_match(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_qa_typo_match(text,text) TO service_role;


CREATE OR REPLACE FUNCTION public.search_qa_page(p_query text, p_exact text, p_entity_type text,
  p_filters jsonb, p_limit integer, p_after_score double precision DEFAULT NULL,
  p_after_id text DEFAULT NULL, p_exclude_ids text[] DEFAULT '{}', p_ids text[] DEFAULT NULL)
RETURNS TABLE(entity_type text,id text,score double precision,document jsonb)
LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  WITH matches AS (
    SELECT d.entity_type,d.id::text id,d.document,
      CASE WHEN p_ids IS NOT NULL THEN 1.0
        ELSE round((
          CASE WHEN lower(d.title)=lower(p_exact) THEN 10 ELSE 0 END +
          CASE WHEN lower(d.title) LIKE lower(p_exact)||'%' THEN 5 ELSE 0 END +
          CASE WHEN lower(d.title) LIKE '%'||lower(p_exact)||'%' THEN 3 ELSE 0 END +
          CASE WHEN lower(d.searchable_text) LIKE '%'||lower(p_exact)||'%' THEN 1.5 ELSE 0 END +
          CASE WHEN to_tsvector('simple',d.searchable_text) @@ websearch_to_tsquery('simple',p_query)
            THEN 2*ts_rank(to_tsvector('simple',d.searchable_text),websearch_to_tsquery('simple',p_query)) ELSE 0 END +
          1.5*similarity(d.title,p_exact) + word_similarity(p_exact,d.searchable_text)
        )::numeric,6)::double precision END score
    FROM public.search_qa_documents d
    WHERE (p_entity_type IS NULL OR d.entity_type=p_entity_type)
      AND (p_ids IS NULL OR d.id::text=ANY(p_ids))
      AND (p_ids IS NOT NULL OR (
        lower(d.searchable_text) LIKE '%'||lower(p_exact)||'%' OR
        to_tsvector('simple',d.searchable_text) @@ websearch_to_tsquery('simple',p_query) OR
        d.title % p_exact OR public.search_qa_typo_match(p_exact,d.searchable_text)))
      AND NOT d.id::text=ANY(coalesce(p_exclude_ids,'{}'))
      AND (p_filters->>'creatorId' IS NULL OR
        (d.entity_type='collection' AND d.document->'creator'->>'creatorId'=p_filters->>'creatorId') OR
        (d.entity_type='creator' AND d.id::text=p_filters->>'creatorId'))
      AND (p_filters->>'brand' IS NULL OR
        (d.entity_type='product' AND lower(d.document->>'brand')=lower(p_filters->>'brand')) OR
        (d.entity_type='collection' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(d.document->'searchBrands') b
          WHERE lower(b)=lower(p_filters->>'brand'))))
      AND (p_filters->>'category' IS NULL OR
        (d.entity_type='product' AND lower(d.document->>'category')=lower(p_filters->>'category')) OR
        (d.entity_type='collection' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(d.document->'searchCategories') c
          WHERE lower(c)=lower(p_filters->>'category'))))
      AND (coalesce((p_filters->>'verifiedOnly')::boolean,false) IS FALSE OR
        (d.entity_type='product' AND lower(d.document->>'verificationStatus') IN ('verified','high')))
      AND (coalesce((p_filters->>'recentlyPublished')::boolean,false) IS FALSE OR
        (d.entity_type='collection' AND (d.document->>'publishedAt')::timestamptz > now()-interval '30 days'))
      AND (coalesce((p_filters->>'popular')::boolean,false) IS FALSE OR
        (d.entity_type='collection' AND coalesce((d.document->>'savesCount')::int,0)+coalesce((d.document->>'viewsCount')::int,0)>=10) OR
        (d.entity_type='creator' AND coalesce((d.document->>'followersCount')::int,0)>=10) OR
        (d.entity_type='product' AND coalesce((d.document->>'popularity')::int,0)>=5))
      AND (p_filters->>'priceMin' IS NULL OR
        (d.entity_type='product' AND (d.document->>'priceAmount')::numeric >= (p_filters->>'priceMin')::numeric))
      AND (p_filters->>'priceMax' IS NULL OR
        (d.entity_type='product' AND (d.document->>'priceAmount')::numeric <= (p_filters->>'priceMax')::numeric))
  )
  SELECT m.entity_type,m.id,m.score,m.document FROM matches m
  WHERE p_after_score IS NULL OR m.score<p_after_score OR (m.score=p_after_score AND m.id>p_after_id)
  ORDER BY m.score DESC,m.id ASC LIMIT least(greatest(p_limit,1),100);
$$;
