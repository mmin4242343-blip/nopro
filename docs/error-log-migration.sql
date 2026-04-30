-- ═══════════════════════════════════════════════════════════════════════
-- error_log 테이블 신규 생성 + 90일 자동 삭제 정책
--
-- 실행 방법:
--   1) Supabase 콘솔 → SQL Editor 접속
--   2) 이 파일 전체 내용 복사 → 붙여넣기 → RUN
--   3) "Success. No rows returned" 메시지 확인
--   4) 좌측 [Database] → [Tables]에서 error_log 테이블 생성됐는지 확인
--
-- 데이터 무결성: 새 테이블이라 기존 데이터·21중 가드 영역과 완전 무관
-- 롤백: 맨 아래 DROP 섹션 주석 해제 후 실행
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. 테이블 생성
CREATE TABLE IF NOT EXISTS error_log (
  id              BIGSERIAL PRIMARY KEY,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  level           VARCHAR(10)  NOT NULL,         -- 'error' | 'warn' | 'info' | 'guard'
  source          VARCHAR(40)  NOT NULL,         -- 'client' | 'server' | 함수명
  message         TEXT         NOT NULL,
  stack           TEXT,                          -- 스택 트레이스 (있으면)
  url             TEXT,                          -- 클라 URL
  user_agent      TEXT,                          -- 브라우저 UA
  company_id      BIGINT       REFERENCES companies(id) ON DELETE SET NULL,
  user_email      VARCHAR(255),                  -- 발생 사용자 (로그인 상태)
  meta            JSONB,                         -- 추가 컨텍스트 (PII 스크럽 후)
  build_id        VARCHAR(20),                   -- CLIENT_BUILD 식별자
  ip_hash         VARCHAR(16)                    -- IP는 해시화하여 PII 회피
);

-- ─── 2. 인덱스 (조회 성능)
CREATE INDEX IF NOT EXISTS idx_error_log_occurred_at ON error_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_level       ON error_log(level);
CREATE INDEX IF NOT EXISTS idx_error_log_source      ON error_log(source);
CREATE INDEX IF NOT EXISTS idx_error_log_company_id  ON error_log(company_id);

-- ─── 3. 90일 자동 삭제 함수
CREATE OR REPLACE FUNCTION cleanup_old_error_log()
RETURNS void AS $$
BEGIN
  DELETE FROM error_log
   WHERE occurred_at < now() - interval '90 days';
END;
$$ LANGUAGE plpgsql;

-- ─── 4. pg_cron 자동 정리 등록 (선택사항, pg_cron 활성 시에만)
--
--   ⚠️ pg_cron 미활성 시 이 블록은 그대로 두어도 안전 (DO 블록 안에서 동적 실행).
--      활성화 방법:
--        Supabase 콘솔 → Database → Extensions → "pg_cron" 검색 → Enable
--      활성화 후 이 파일을 다시 실행하거나, 또는 아래 한 줄만 실행:
--        SELECT cron.schedule('cleanup-error-log-90d', '0 3 * * *',
--          $$ SELECT cleanup_old_error_log(); $$);
--
--   pg_cron 안 쓸 거면 한 달에 한 번 SQL Editor에서 직접 실행:
--        SELECT cleanup_old_error_log();
DO $migrate$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    EXECUTE 'SELECT cron.schedule(' ||
            quote_literal('cleanup-error-log-90d') || ', ' ||
            quote_literal('0 3 * * *') || ', ' ||
            quote_literal('SELECT cleanup_old_error_log();') || ')';
    RAISE NOTICE 'pg_cron 스케줄 등록 완료: cleanup-error-log-90d';
  ELSE
    RAISE NOTICE 'pg_cron 미활성 — 90일 자동 삭제 등록 스킵 (수동 정리 가능: SELECT cleanup_old_error_log())';
  END IF;
END $migrate$;

-- ─── 5. 검증 쿼리 (실행 후 확인용)
-- SELECT COUNT(*) FROM error_log;                        -- 0 이어야 정상
-- SELECT * FROM cron.job WHERE jobname = 'cleanup-error-log-90d';  -- pg_cron 등록 확인


-- ═══════════════════════════════════════════════════════════════════════
-- 롤백 — 모니터링 기능을 완전히 되돌릴 때만 실행
-- ═══════════════════════════════════════════════════════════════════════
-- SELECT cron.unschedule('cleanup-error-log-90d');
-- DROP FUNCTION IF EXISTS cleanup_old_error_log();
-- DROP TABLE IF EXISTS error_log;
