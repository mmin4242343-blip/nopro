-- ═══════════════════════════════════════════════════════════════════════
-- admin_notifications 테이블 신규 생성 (관리자 알림 시스템)
--
-- 실행 방법:
--   1) Supabase 콘솔 → SQL Editor 접속
--   2) 이 파일 전체 내용 복사 → 붙여넣기 → RUN
--   3) "Success. No rows returned" 메시지 확인
--   4) 좌측 [Database] → [Tables]에서 admin_notifications 테이블 생성 확인
--
-- 보존 정책: 영구 보존 (사용자가 직접 '전체 삭제' 버튼으로 삭제 전까지)
--   → pg_cron 자동 정리 없음
--
-- 데이터 무결성: 새 테이블이라 기존 데이터·21중 가드 영역과 완전 무관
-- 롤백: 맨 아래 DROP 섹션 주석 해제 후 실행
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. 테이블 생성
CREATE TABLE IF NOT EXISTS admin_notifications (
  id              BIGSERIAL PRIMARY KEY,
  type            VARCHAR(32)  NOT NULL,         -- 'signup' | 'profile_change' | (확장 가능)
  title           VARCHAR(255) NOT NULL,
  body            TEXT,
  company_id      BIGINT       REFERENCES companies(id) ON DELETE SET NULL,
  meta            JSONB,                         -- 추가 컨텍스트 (가입 직원수·변경 필드 등)
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ                    -- NULL이면 unread
);

-- ─── 2. 인덱스 (조회 성능)
CREATE INDEX IF NOT EXISTS idx_admin_notif_created_at ON admin_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notif_read_at    ON admin_notifications(read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_admin_notif_type       ON admin_notifications(type);

-- ─── 3. 검증 쿼리 (실행 후 확인용)
-- SELECT COUNT(*) FROM admin_notifications;       -- 0 이어야 정상
-- \d admin_notifications                          -- 테이블 구조 확인


-- ═══════════════════════════════════════════════════════════════════════
-- 롤백 — 알림 기능을 완전히 되돌릴 때만 실행
-- ═══════════════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS admin_notifications;
