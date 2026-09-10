-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  clerk_user_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Continu Contexts table (Zero Knowledge / Encrypted)
-- All context data is stored encrypted client-side using AES-256-GCM.
-- No plaintext context content, names, URLs, or conversation turns exist in the database.
CREATE TABLE IF NOT EXISTS continu_contexts (
  id UUID PRIMARY KEY,
  clerk_user_id TEXT NOT NULL REFERENCES profiles(clerk_user_id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contexts_user ON continu_contexts(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_contexts_created ON continu_contexts(created_at DESC);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE continu_contexts ENABLE ROW LEVEL SECURITY;

-- Profiles RLS
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "Users insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  USING (clerk_user_id = auth.jwt()->>'sub');

-- Contexts RLS
CREATE POLICY "Users read own contexts"
  ON continu_contexts FOR SELECT
  USING (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "Users insert own contexts"
  ON continu_contexts FOR INSERT
  WITH CHECK (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "Users update own contexts"
  ON continu_contexts FOR UPDATE
  USING (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "Users delete own contexts"
  ON continu_contexts FOR DELETE
  USING (clerk_user_id = auth.jwt()->>'sub');
