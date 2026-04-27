-- ═══════════════════════════════════════════════════════════════════════
-- audit_log 용량 모니터링 SQL
--
-- ⚠️ 자동 삭제 정책 없음 (사용자 지시: 데이터 절대 삭제·수정 금지)
-- 본 파일은 진단용 쿼리만 제공 — 실행해도 데이터 변경 없음.
-- 정리가 필요하다고 판단되면 ROLLBACK 가능한 트랜잭션으로 신중히 진행.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 모니터링 1: 회사별 audit_log 행 수 + 용량
SELECT
  company_id,
  COUNT(*) AS row_count,
  pg_size_pretty(SUM(coalesce(length(old_value),0) + coalesce(length(new_value),0))::bigint) AS approx_size,
  MIN(changed_at) AS oldest,
  MAX(changed_at) AS newest
FROM audit_log
GROUP BY company_id
ORDER BY row_count DESC;


-- ─── 모니터링 2: 키별 용량 (rec/tbk가 압도적으로 큰지 확인)
SELECT
  data_key,
  COUNT(*) AS row_count,
  pg_size_pretty(SUM(coalesce(length(old_value),0) + coalesce(length(new_value),0))::bigint) AS total_size,
  pg_size_pretty(AVG(coalesce(length(old_value),0) + coalesce(length(new_value),0))::bigint) AS avg_size_per_row
FROM audit_log
GROUP BY data_key
ORDER BY SUM(coalesce(length(old_value),0) + coalesce(length(new_value),0)) DESC;


-- ─── 모니터링 3: 전체 audit_log 테이블 크기
SELECT pg_size_pretty(pg_total_relation_size('audit_log')) AS total_size;


-- ─── 모니터링 4: 월별 audit_log 누적 추이 (사고 유무·증가 속도 파악)
SELECT
  to_char(changed_at, 'YYYY-MM') AS month,
  COUNT(*) AS rows,
  pg_size_pretty(SUM(coalesce(length(old_value),0) + coalesce(length(new_value),0))::bigint) AS size
FROM audit_log
GROUP BY to_char(changed_at, 'YYYY-MM')
ORDER BY month DESC
LIMIT 12;


-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ 정리가 정말 필요한 경우 (Supabase 용량 한도 초과 임박 등)
--   아래 쿼리는 **참고용**. 실행 전 반드시:
--   1) 회사 책임자 승인
--   2) DROP 전 백업 테이블 생성 (CREATE TABLE backup AS SELECT * FROM audit_log)
--   3) 트랜잭션으로 감싸서 결과 확인 후 COMMIT
-- ═══════════════════════════════════════════════════════════════════════

-- 예시: 365일 이상 지난 rec/tbk 키 audit_log만 정리 (실행 X — 주석 처리)
-- BEGIN;
--   CREATE TABLE audit_log_backup_<날짜> AS
--     SELECT * FROM audit_log
--     WHERE data_key IN ('rec','tbk')
--       AND changed_at < now() - interval '365 days';
--
--   -- 백업 카운트 확인
--   SELECT COUNT(*) FROM audit_log_backup_<날짜>;
--
--   -- 실제 삭제 (확인 후 주석 해제)
--   -- DELETE FROM audit_log
--   --   WHERE data_key IN ('rec','tbk')
--   --     AND changed_at < now() - interval '365 days';
-- COMMIT;  -- 또는 ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════
-- 권장 — 정리 대신 Supabase 용량 추이 모니터링
--   매주 모니터링 1·2·3 쿼리 실행
--   증가 속도가 비정상이면 (예: 한 달 +5GB) 정리 검토
--   아니면 그대로 두는 것이 가장 안전 (감사 이력 자료 가치)
-- ═══════════════════════════════════════════════════════════════════════
