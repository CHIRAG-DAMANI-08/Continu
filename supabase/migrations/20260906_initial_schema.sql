-- continu initial schema
-- Run in Supabase Dashboard > SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table
CREATE TABLE profiles (
  clerk_user_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contexts table
CREATE TABLE continu_contexts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id TEXT NOT NULL REFERENCES profiles(clerk_user_id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 500),
  source_platform TEXT CHECK (char_length(source_platform) <= 100),
  source_url TEXT CHECK (char_length(source_url) <= 2000),
  payload JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_contexts_user ON continu_contexts(clerk_user_id);
CREATE INDEX idx_contexts_created ON continu_contexts(created_at DESC);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE continu_contexts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "Users insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (clerk_user_id = auth.jwt()->>'sub');

-- RLS Policies for continu_contexts
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
