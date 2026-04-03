-- ============================================
-- ADMIN PATCH - Run this in Supabase SQL Editor
-- Allows admins/ceo to update any profile
-- ============================================

-- Drop existing update policy
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- New policy: users can update own profile OR admins can update anyone
CREATE POLICY "Users and admins can update profiles"
  ON profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'ceo')
    )
  );
