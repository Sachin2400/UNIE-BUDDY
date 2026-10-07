-- The earlier migration (20260718054402_...) creates RLS policies on
-- storage.objects for a bucket named 'newspapers', but never creates the
-- bucket itself. On a fresh Supabase project (no bucket created manually
-- via the dashboard), uploads fail with:
--   {"statusCode":"404","error":"Bucket not found","code":"NoSuchBucket"}
-- This migration creates it. Kept private (public = false) since the
-- existing policies already scope access to each user's own folder
-- (auth.uid() = (storage.foldername(name))[1]) via signed/authenticated
-- requests, not public URLs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('newspapers', 'newspapers', false)
ON CONFLICT (id) DO NOTHING;
