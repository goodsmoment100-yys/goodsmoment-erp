-- ============================================
-- BIRCH SOUND ERP - Supabase Database Setup
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Profiles (사용자 프로필)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT DEFAULT '',
  role TEXT DEFAULT 'member' CHECK (role IN ('ceo', 'admin', 'manager', 'member')),
  phone TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view profiles"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);


-- 2. Attendance (출퇴근)
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  work_hours NUMERIC(4,1) DEFAULT 0,
  status TEXT DEFAULT 'off' CHECK (status IN ('off', 'working', 'done')),
  memo TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all attendance"
  ON attendance FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own attendance"
  ON attendance FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own attendance"
  ON attendance FOR UPDATE
  USING (auth.uid() = user_id);


-- 3. Notices (공지사항)
CREATE TABLE IF NOT EXISTS notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  tag TEXT DEFAULT 'general' CHECK (tag IN ('important', 'general', 'event')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view notices"
  ON notices FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create notices"
  ON notices FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authors can update own notices"
  ON notices FOR UPDATE
  USING (auth.uid() = author_id);

CREATE POLICY "Authors can delete own notices"
  ON notices FOR DELETE
  USING (auth.uid() = author_id);


-- 4. Approvals (결재)
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  approver_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type TEXT DEFAULT 'other' CHECK (type IN ('leave', 'expense', 'report', 'other')),
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view related approvals"
  ON approvals FOR SELECT
  USING (true);

CREATE POLICY "Users can create approvals"
  ON approvals FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Approvers can update approvals"
  ON approvals FOR UPDATE
  USING (auth.uid() = approver_id OR auth.uid() = requester_id);


-- 5. Settlements (정산)
CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  project TEXT DEFAULT '',
  description TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  receipt_url TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all settlements"
  ON settlements FOR SELECT
  USING (true);

CREATE POLICY "Users can create settlements"
  ON settlements FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settlements"
  ON settlements FOR UPDATE
  USING (auth.uid() = user_id);


-- ============================================
-- Create a trigger to auto-create profile on signup
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, department, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', '이름없음'),
    COALESCE(NEW.raw_user_meta_data->>'department', ''),
    'member'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
