CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.users(id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
 account_status text DEFAULT 'ACTIVE',deleted_at timestamptz,followers_count int DEFAULT 0,
 following_count int DEFAULT 0,counters_updated_at timestamptz);
CREATE TABLE public.collections(id uuid PRIMARY KEY,creator_id uuid,title text,status text DEFAULT 'published',
 visibility text DEFAULT 'public',moderation_state text DEFAULT 'clear',deleted_at timestamptz,published_at timestamptz DEFAULT now(),
 views_count int DEFAULT 0,saves_count int DEFAULT 0,shares_count int DEFAULT 0,product_clicks_count int DEFAULT 0,counters_updated_at timestamptz);
CREATE TABLE public.catalog_products(id uuid PRIMARY KEY,status text DEFAULT 'ACTIVE');
CREATE TABLE public.collection_product_tags(id uuid PRIMARY KEY,collection_id uuid,catalog_product_id uuid);
CREATE TABLE public.videos(id uuid PRIMARY KEY,collection_id uuid);
CREATE TABLE public.product_clicks(id uuid,user_id uuid);
CREATE TABLE public.user_place_saves(id uuid,user_id uuid);
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
