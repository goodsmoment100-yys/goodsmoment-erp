-- ============================================
-- ATTENDANCE UPGRADE - 휴게시간 추가
-- Run this in Supabase SQL Editor
-- ============================================

-- 휴게시간 컬럼 추가
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS break_start TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS break_end TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS break_minutes INTEGER DEFAULT 0;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '' CHECK (location IN ('', 'store', 'office'));
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS worker_type TEXT DEFAULT 'regular' CHECK (worker_type IN ('regular', 'parttime'));
