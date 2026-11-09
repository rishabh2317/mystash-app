-- Disposable, public-only Search projection for the explicitly selected Render QA fallback.
-- OpenSearch remains the production search engine. Source tables remain authoritative.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
SET search_path TO public, extensions;

CREATE TABLE public.search_qa_documents (
  entity_type text NOT NULL CHECK (entity_type IN ('collection', 'creator', 'product')),
  id uuid NOT NULL,
  title text NOT NULL,
  searchable_text text NOT NULL,
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, id)
);
ALTER TABLE public.search_qa_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.search_qa_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.search_qa_documents TO service_role;
CREATE INDEX search_qa_text_fts_idx ON public.search_qa_documents
  USING gin (to_tsvector('simple', searchable_text));
CREATE INDEX search_qa_title_trgm_idx ON public.search_qa_documents
  USING gin (title gin_trgm_ops);
CREATE INDEX search_qa_text_trgm_idx ON public.search_qa_documents
  USING gin (searchable_text gin_trgm_ops);

CREATE FUNCTION public.search_qa_project(kind text, row_data jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, extensions AS $$
DECLARE d jsonb; creator jsonb;
BEGIN
  IF kind = 'collections' THEN
    IF row_data->>'status' <> 'published' OR row_data->>'visibility' <> 'public'
       OR row_data->>'moderation_state' <> 'clear'
       OR coalesce((row_data->>'search_eligible')::boolean, false) IS NOT TRUE
       OR row_data->>'published_at' IS NULL OR row_data->>'deleted_at' IS NOT NULL THEN RETURN NULL; END IF;
    creator := jsonb_build_object('creatorId', row_data->>'creator_id', 'displayName', row_data->>'creator_name',
      'username', row_data->>'creator_username', 'avatarRef', row_data->>'creator_avatar');
    d := jsonb_build_object('id',row_data->>'id','entityType','collection','collectionId',row_data->>'id',
      'slug',row_data->>'slug','searchTitle',coalesce(row_data->>'search_title',row_data->>'title'),
      'searchKeywords',coalesce(nullif(row_data->'search_keywords','null'::jsonb),'[]'::jsonb),
      'searchBrands',coalesce(nullif(row_data->'search_brands','null'::jsonb),'[]'::jsonb),
      'searchCategories',coalesce(nullif(row_data->'search_categories','null'::jsonb),'[]'::jsonb),
      'creator',creator,'primaryMediaRef',coalesce(row_data->>'hero_thumbnail_url',row_data->>'primary_media_id'),
      'productTagCount',coalesce((row_data->>'product_tag_count')::int,0),
      'publishedAt',row_data->>'published_at','qualityScore',row_data->'quality_score',
      'viewsCount',coalesce((row_data->>'views_count')::int,0),
      'savesCount',coalesce((row_data->>'saves_count')::int,0),
      'sharesCount',coalesce((row_data->>'shares_count')::int,0),
      'productClicksCount',coalesce((row_data->>'product_clicks_count')::int,0),
      'creatorAuthority',0,'saveRate',null,'contentRevision',coalesce((row_data->>'content_revision')::int,1));
    d := d || jsonb_build_object('searchableText',concat_ws(' ',row_data->>'search_title',row_data->>'title',
      row_data->>'search_text',row_data->>'caption',row_data->>'creator_name',row_data->>'creator_username',
      (SELECT string_agg(value,' ') FROM jsonb_array_elements_text(coalesce(nullif(row_data->'search_keywords','null'::jsonb),'[]'::jsonb))),
      (SELECT string_agg(value,' ') FROM jsonb_array_elements_text(coalesce(nullif(row_data->'search_brands','null'::jsonb),'[]'::jsonb))),
      (SELECT string_agg(value,' ') FROM jsonb_array_elements_text(coalesce(nullif(row_data->'search_categories','null'::jsonb),'[]'::jsonb)))));
  ELSIF kind = 'users' THEN
    IF row_data->>'account_status' <> 'ACTIVE' OR row_data->>'creator_status' <> 'ACTIVE'
       OR nullif(row_data->>'username','') IS NULL OR row_data->>'deleted_at' IS NOT NULL THEN RETURN NULL; END IF;
    d := jsonb_build_object('id',row_data->>'id','entityType','creator','userId',row_data->>'id',
      'username',row_data->>'username','displayName',row_data->>'display_name','bio',row_data->>'bio',
      'avatarRef',row_data->>'profile_photo_url','followersCount',coalesce((row_data->>'followers_count')::int,0),
      'creatorAuthority',0,'contentRevision',coalesce((row_data->>'schema_version')::int,1),
      'searchableText',concat_ws(' ',row_data->>'display_name',row_data->>'username',row_data->>'bio'));
  ELSIF kind = 'catalog_products' THEN
    IF row_data->>'status' <> 'ACTIVE' OR row_data->>'merged_into_id' IS NOT NULL THEN RETURN NULL; END IF;
    d := jsonb_build_object('id',row_data->>'id','entityType','product','catalogProductId',row_data->>'id',
      'canonicalSlug',row_data->>'canonical_slug','name',row_data->>'name','brand',row_data->>'brand',
      'model',row_data->>'model','category',row_data->>'category','aliases','[]'::jsonb,
      'verificationStatus',row_data->>'verification_status','primaryImageRef',row_data->>'image_url',
      'popularity',0,'lastVerifiedAt',row_data->>'last_verified_at',
      'priceAmount',CASE WHEN regexp_replace(coalesce(row_data->>'price',''),'[^0-9.]','','g') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN regexp_replace(row_data->>'price','[^0-9.]','','g')::numeric ELSE NULL END,
      'priceCurrency',row_data->>'currency','contentRevision',1,
      'searchableText',concat_ws(' ',row_data->>'name',row_data->>'normalized_name',row_data->>'brand',
        row_data->>'model',row_data->>'category'));
  ELSE RAISE EXCEPTION 'Unsupported Search source'; END IF;
  RETURN d || jsonb_build_object('searchEligible',true,'deleted',false,'indexedAt',now());
END $$;
REVOKE ALL ON FUNCTION public.search_qa_project(text,jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.search_qa_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE source_row jsonb; doc jsonb; kind text; entity text; row_id uuid;
BEGIN
  kind := TG_TABLE_NAME;
  entity := CASE kind WHEN 'collections' THEN 'collection' WHEN 'users' THEN 'creator'
    WHEN 'catalog_products' THEN 'product' ELSE NULL END;
  IF entity IS NULL THEN RAISE EXCEPTION 'Unsupported Search source'; END IF;
  source_row := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  row_id := (source_row->>'id')::uuid;
  DELETE FROM public.search_qa_documents WHERE entity_type=entity AND id=row_id;
  IF TG_OP <> 'DELETE' THEN
    doc := public.search_qa_project(kind,source_row);
    IF doc IS NOT NULL THEN
      INSERT INTO public.search_qa_documents(entity_type,id,title,searchable_text,document)
      VALUES(entity,row_id,coalesce(doc->>'searchTitle',doc->>'displayName',doc->>'name',doc->>'username',''),
        doc->>'searchableText',doc);
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.search_qa_sync() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER search_qa_collections_sync AFTER INSERT OR UPDATE OR DELETE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.search_qa_sync();
CREATE TRIGGER search_qa_users_sync AFTER INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.search_qa_sync();
CREATE TRIGGER search_qa_products_sync AFTER INSERT OR UPDATE OR DELETE ON public.catalog_products
  FOR EACH ROW EXECUTE FUNCTION public.search_qa_sync();

INSERT INTO public.search_qa_documents(entity_type,id,title,searchable_text,document)
SELECT 'collection', c.id, coalesce(d.doc->>'searchTitle',''), d.doc->>'searchableText', d.doc
FROM public.collections c CROSS JOIN LATERAL (SELECT public.search_qa_project('collections',to_jsonb(c)) doc) d
WHERE d.doc IS NOT NULL;
INSERT INTO public.search_qa_documents(entity_type,id,title,searchable_text,document)
SELECT 'creator', u.id, coalesce(d.doc->>'displayName',d.doc->>'username',''), d.doc->>'searchableText', d.doc
FROM public.users u CROSS JOIN LATERAL (SELECT public.search_qa_project('users',to_jsonb(u)) doc) d
WHERE d.doc IS NOT NULL;
INSERT INTO public.search_qa_documents(entity_type,id,title,searchable_text,document)
SELECT 'product', p.id, coalesce(d.doc->>'name',''), d.doc->>'searchableText', d.doc
FROM public.catalog_products p CROSS JOIN LATERAL (SELECT public.search_qa_project('catalog_products',to_jsonb(p)) doc) d
WHERE d.doc IS NOT NULL;

-- Only the server service role can query. The API continues to return the established DTO.
CREATE FUNCTION public.search_qa_page(p_query text, p_exact text, p_entity_type text,
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
        d.title % p_exact OR p_exact <% d.searchable_text))
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
REVOKE ALL ON FUNCTION public.search_qa_page(text,text,text,jsonb,integer,double precision,text,text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_qa_page(text,text,text,jsonb,integer,double precision,text,text[],text[]) TO service_role;
