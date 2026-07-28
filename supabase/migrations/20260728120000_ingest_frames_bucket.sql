-- Private frame evidence bucket for progressive ingest (service role write; signed read).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ingest-frames',
  'ingest-frames',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/jpg']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No public policies: service_role bypasses RLS; clients use signed URLs only.
