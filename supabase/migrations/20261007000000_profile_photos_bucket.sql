-- Public, user-owned profile avatars. One canonical normalized file per versioned path.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-photos',
  'profile-photos',
  true,
  524288,
  ARRAY['image/jpeg', 'image/jpg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "profile_photos_public_read" ON storage.objects;
CREATE POLICY "profile_photos_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile-photos');

DROP POLICY IF EXISTS "profile_photos_owner_insert" ON storage.objects;
CREATE POLICY "profile_photos_owner_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS "profile_photos_owner_update" ON storage.objects;
CREATE POLICY "profile_photos_owner_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND split_part(name, '/', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'profile-photos'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS "profile_photos_owner_delete" ON storage.objects;
CREATE POLICY "profile_photos_owner_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND split_part(name, '/', 1) = auth.uid()::text
);
