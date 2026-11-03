-- Only applied inside the self-owned, disposable Find PostgreSQL fixture.
ALTER TABLE users ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN creator_status text DEFAULT 'ACTIVE';
ALTER TABLE catalog_products ADD COLUMN name text,ADD COLUMN category text;
CREATE TABLE collections(id uuid PRIMARY KEY,creator_id uuid,title text,status text DEFAULT 'published',visibility text DEFAULT 'public',moderation_state text DEFAULT 'clear',deleted_at timestamptz,published_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),hero_thumbnail_url text);
CREATE TABLE collection_product_tags(id uuid PRIMARY KEY,collection_id uuid,catalog_product_id uuid,discovered_product_id uuid);
CREATE TABLE ingest_requests(id uuid PRIMARY KEY,status text,created_at timestamptz DEFAULT now());
CREATE TABLE engagement_interaction_facts(event_id uuid PRIMARY KEY,actor_user_id uuid,session_id uuid,object_type text,object_id uuid,interaction_type text,anonymous_id text,privacy_class text,metadata jsonb,occurred_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now());
CREATE FUNCTION engagement_commit(jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT $1 $$;
CREATE TABLE product_clicks(id uuid PRIMARY KEY,event_id uuid UNIQUE,user_id uuid,created_at timestamptz DEFAULT now());
GRANT USAGE ON SCHEMA auth TO service_role,anon,authenticated;
