-- ============================================================================
-- Anestheo — profile photos (avatars)
--
-- PREPARED, NOT APPLIED. Run in the Supabase SQL editor; storage policies need
-- the editor's role. Idempotent. Pure ASCII.
--
-- The frontend works with or without this migration, in either deployment
-- order. auth.js reads profiles.avatar_url in its own tolerant query and
-- treats "column does not exist" as "no photo uploaded", so shipping the pages
-- first degrades to the provider picture and initials rather than breaking.
-- Applying this adds uploads; it changes nothing else.
--
-- NOT A SECURITY CHANGE. No policy on any existing table is touched, no
-- function is redefined, no grant is altered. It adds one nullable column and
-- one private bucket.
-- ============================================================================

-- -- 1. Where the photo lives on the profile -----------------------------
-- A STORAGE PATH, not a URL and not image bytes. The bucket is private, so a
-- displayable URL is signed per session and is never stored anywhere.
-- avatar_url is already in the guard_profiles_self_update() allowlist
-- (v2_security_hardening.sql), so this column is self-editable the moment it
-- exists and needs no change to that function.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_avatar_url_chk') THEN
    -- A path, never a URL. Storing "https://..." here would let a profile row
    -- point the whole app at a third-party host of the user's choosing.
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_url_chk
      CHECK (avatar_url IS NULL OR (avatar_url !~ '^[a-zA-Z]+://' AND length(avatar_url) <= 400));
  END IF;
END $c$;

-- -- 2. Private bucket ----------------------------------------------------
-- Separate from patient-documents and from any future verification bucket: a
-- profile picture and a passport scan have nothing in common but the word
-- "upload", and one bucket for both would mean one policy mistake exposes
-- both. 5 MB, images only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', false, 5242880,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public             = false;

-- -- 3. Object policies ---------------------------------------------------
-- Path convention: <auth.uid()>/<generated-name>.<ext>
-- The first folder segment IS the authorization: a user may only write inside
-- their own uid, which is checked by the database and not by the page.
DROP POLICY IF EXISTS av_obj_insert ON storage.objects;
CREATE POLICY av_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars'
              AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS av_obj_update ON storage.objects;
CREATE POLICY av_obj_update ON storage.objects FOR UPDATE TO authenticated
  USING      (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS av_obj_delete ON storage.objects;
CREATE POLICY av_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = auth.uid()::text);

-- READ is deliberately owner-only for now.
--
-- A profile picture is not a secret, but it is also not needed by anyone else
-- yet: nothing in the product renders another person's avatar today. Granting
-- a broader read "in case" would be the wrong default for a private bucket.
-- When the clinician directory grows avatars, widen THIS policy to exactly the
-- audience that needs it -- do not make the bucket public, and do not read the
-- path from anywhere but the database.
DROP POLICY IF EXISTS av_obj_select ON storage.objects;
CREATE POLICY av_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = auth.uid()::text);

-- -- 4. Verify -------------------------------------------------------------
DO $v$
DECLARE v_col boolean; v_bucket boolean; v_pol int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='profiles'
                    AND column_name='avatar_url') INTO v_col;
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id='avatars' AND public=false)
    INTO v_bucket;
  SELECT count(*) INTO v_pol FROM pg_policy
   WHERE polname IN ('av_obj_insert','av_obj_update','av_obj_delete','av_obj_select');
  RAISE NOTICE 'V1 profiles.avatar_url        : %', v_col;
  RAISE NOTICE 'V2 private avatars bucket     : %', v_bucket;
  RAISE NOTICE 'V3 object policies (expect 4) : %', v_pol;
  IF NOT (v_col AND v_bucket AND v_pol = 4) THEN
    RAISE EXCEPTION 'avatars migration did not complete';
  END IF;
  RAISE NOTICE 'avatars: ready.';
END $v$;
