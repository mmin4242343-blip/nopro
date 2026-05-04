-- ════════════════════════════════════════════════════════════════
-- 단일 로그인 차단 마이그레이션 (2026-05-04)
-- 같은 계정으로 여러 PC/브라우저 동시 로그인 차단
-- idle timeout: 1시간 (마지막 활동 후 1시간 지나면 다른 곳에서 로그인 가능)
-- ════════════════════════════════════════════════════════════════

-- 1. companies 테이블에 컬럼 2개 추가
--    · active_session_id  : 현재 활성 세션의 UUID (JWT의 sid와 매칭)
--    · active_session_at  : 마지막 활동 시각 (heartbeat — auth-verify 호출 때마다 갱신)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS active_session_id TEXT,
  ADD COLUMN IF NOT EXISTS active_session_at TIMESTAMPTZ;

-- 2. 검증 — 컬럼이 정상 추가됐는지 확인
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'companies'
   AND column_name IN ('active_session_id', 'active_session_at')
 ORDER BY column_name;

-- 위 SELECT 결과로 두 행이 나와야 정상:
--   active_session_at | timestamp with time zone | YES
--   active_session_id | text                     | YES

-- ════════════════════════════════════════════════════════════════
-- 운영 메모
-- ════════════════════════════════════════════════════════════════
-- · 코드 배포 후 첫 로그인부터 자동으로 채워짐
-- · 기존 로그인 세션은 active_session_id가 비어있어 충돌 없이 자동 전환됨
--   (auth-verify가 옛 JWT 받으면 새 sid 발급해서 DB에 채움)
--
-- · 강제로 모든 세션 만료시키려면 (비상 롤백):
--     UPDATE companies SET active_session_id = NULL, active_session_at = NULL;
--
-- · 특정 회사만 강제 로그아웃:
--     UPDATE companies SET active_session_id = NULL, active_session_at = NULL WHERE id = <ID>;
--
-- · 현재 활성 세션 확인:
--     SELECT id, email, company_name,
--            active_session_id IS NOT NULL AS is_active,
--            active_session_at,
--            NOW() - active_session_at AS idle_for
--       FROM companies
--      WHERE active_session_id IS NOT NULL
--      ORDER BY active_session_at DESC;
--
-- · 컬럼 완전 제거 (필요 없어진 경우):
--     ALTER TABLE companies DROP COLUMN active_session_id;
--     ALTER TABLE companies DROP COLUMN active_session_at;
