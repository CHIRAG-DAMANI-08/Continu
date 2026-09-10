-- Migration: Migrate from Clerk auth to Supabase Auth
-- Replaces clerk_user_id with user_id UUID referencing auth.users(id)
-- Updates Row Level Security policies to use auth.uid()

DROP TABLE IF EXISTS continu_contexts CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Profiles table
CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Continu Contexts table (Zero Knowledge / Encrypted)
-- All context data is stored encrypted client-side using AES-256-GCM.
-- No plaintext context content, names, URLs, or conversation turns exist in the database.
CREATE TABLE continu_contexts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_continu_contexts_user_id ON continu_contexts(user_id);
CREATE INDEX idx_continu_contexts_created ON continu_contexts(created_at DESC);
CREATE INDEX idx_profiles_user_id ON profiles(user_id);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE continu_contexts ENABLE ROW LEVEL SECURITY;

-- Profiles RLS
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own profile"
  ON profiles FOR DELETE
  USING (user_id = auth.uid());

-- Contexts RLS
CREATE POLICY "Users read own contexts"
  ON continu_contexts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own contexts"
  ON continu_contexts FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own contexts"
  ON continu_contexts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own contexts"
  ON continu_contexts FOR DELETE
  USING (user_id = auth.uid());

-- Auto-create profile on Supabase Auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
