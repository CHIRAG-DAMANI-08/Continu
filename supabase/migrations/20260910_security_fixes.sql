-- Migration: 20260910_security_fixes.sql
-- Fixes missing DELETE policy on continu_contexts and adds WITH CHECK clauses to UPDATE policies

-- 1. Ensure DELETE policy exists on continu_contexts
DROP POLICY IF EXISTS "Users delete own contexts" ON continu_contexts;
CREATE POLICY "Users delete own contexts"
  ON continu_contexts FOR DELETE
  USING (user_id = auth.uid());

-- 2. Ensure UPDATE policy on continu_contexts has WITH CHECK
DROP POLICY IF EXISTS "Users update own contexts" ON continu_contexts;
CREATE POLICY "Users update own contexts"
  ON continu_contexts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3. Ensure UPDATE policy on profiles has WITH CHECK
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
