-- ============================================
-- MESSAGES TABLE - Run this in Supabase SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  to_id UUID,
  to_name TEXT DEFAULT '전체',
  content TEXT NOT NULL DEFAULT '',
  is_broadcast BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view messages"
  ON messages FOR SELECT
  USING (
    is_broadcast = true
    OR from_id = auth.uid()
    OR to_id = auth.uid()
  );

CREATE POLICY "Users can send messages"
  ON messages FOR INSERT
  WITH CHECK (auth.uid() = from_id);
