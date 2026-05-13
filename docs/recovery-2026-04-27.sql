-- ═══════════════════════════════════════════════════════════════════════
-- 데이터 유실 복구 SQL — 2026-04-27 08:52 KST 사고
-- 회사 ID: 4 (test2@naver.com)
--
-- 사고 요약 (audit_log CSV 분석 결과):
--   2026-04-26 23:52:04 UTC  emps: 44,803 → 44,417 (-386 bytes)
--   2026-04-26 23:52:17 UTC  rec:  411,225 → 356,993 (-54,232 bytes) ← 핵심 손실
--   2026-04-26 23:52:23 UTC  tbk:  2,650 → 1,951 (-699 bytes)
--
-- 복구 전략:
--   audit_log에는 old_value(손실 직전 정상 상태)가 보존되어 있음.
--   해당 row의 old_value를 company_data에 복원하면 정확한 시점으로 되돌릴 수 있음.
--
-- ⚠️ 실행 순서 — 반드시 1 → 2 → 3 → 4 순서대로
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- STEP 1: 손실 시점 확인 (먼저 실행해서 결과 확인 후 STEP 2 진행)
-- ═══════════════════════════════════════════════════════════════════════
SELECT
  data_key,
  changed_at,
  changed_by,
  length(old_value) AS before_size,
  length(new_value) AS after_size,
  length(old_value) - length(new_value) AS lost_bytes
FROM audit_log
WHERE company_id = 4
  AND data_key IN ('rec', 'tbk', 'emps', 'bonus', 'allow', 'tax', 'safety')
  AND length(old_value) > length(new_value)            -- 데이터가 줄어든 케이스만
  AND length(old_value) - length(new_value) > 100      -- 100 bytes 이상 손실
ORDER BY changed_at DESC
LIMIT 50;
-- 기대 결과: emps(386), rec(54232), tbk(699) 손실 row가 보여야 함
-- 만약 보이지 않으면 STEP 2 이하는 진행하지 말고 알려주세요


-- ═══════════════════════════════════════════════════════════════════════
-- STEP 2: 복구 직전 현재 상태를 별도 테이블로 백업 (반드시 실행)
-- ═══════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS company_data_pre_recovery_20260427;
CREATE TABLE company_data_pre_recovery_20260427 AS
SELECT * FROM company_data WHERE company_id = 4;

-- 백업 검증
SELECT data_key, length(data_value) AS size, updated_at
FROM company_data_pre_recovery_20260427
ORDER BY data_key;


-- ═══════════════════════════════════════════════════════════════════════
-- STEP 3: 복구 실행 — 각 키별로 손실 직전 상태로 복원
-- ═══════════════════════════════════════════════════════════════════════

-- 3-1. rec(출퇴근/연차) 복구 — 04-26 23:52:17 UTC 손실
UPDATE company_data
SET data_value = al.old_value,
    updated_at = now()
FROM (
  SELECT old_value
  FROM audit_log
  WHERE company_id = 4
    AND data_key = 'rec'
    AND changed_at >= '2026-04-26 23:52:17'
    AND changed_at <  '2026-04-26 23:52:18'
  LIMIT 1
) AS al
WHERE company_data.company_id = 4
  AND company_data.data_key = 'rec';

-- 3-2. tbk(임시 휴게시간) 복구 — 04-26 23:52:23 UTC 손실
UPDATE company_data
SET data_value = al.old_value,
    updated_at = now()
FROM (
  SELECT old_value
  FROM audit_log
  WHERE company_id = 4
    AND data_key = 'tbk'
    AND changed_at >= '2026-04-26 23:52:23'
    AND changed_at <  '2026-04-26 23:52:24'
  LIMIT 1
) AS al
WHERE company_data.company_id = 4
  AND company_data.data_key = 'tbk';

-- 3-3. emps(직원 정보) 복구 — 04-26 23:52:04 UTC 손실
UPDATE company_data
SET data_value = al.old_value,
    updated_at = now()
FROM (
  SELECT old_value
  FROM audit_log
  WHERE company_id = 4
    AND data_key = 'emps'
    AND changed_at >= '2026-04-26 23:52:04'
    AND changed_at <  '2026-04-26 23:52:05'
  LIMIT 1
) AS al
WHERE company_data.company_id = 4
  AND company_data.data_key = 'emps';


-- ═══════════════════════════════════════════════════════════════════════
-- STEP 4: 복구 검증 — 사이즈가 사고 이전 수준으로 회복됐는지 확인
-- ═══════════════════════════════════════════════════════════════════════
SELECT
  data_key,
  length(data_value) AS current_size,
  updated_at
FROM company_data
WHERE company_id = 4
  AND data_key IN ('rec', 'tbk', 'emps')
ORDER BY data_key;
-- 기대 결과:
--   emps: 44,803 (이전: 44,417)
--   rec:  411,225 (이전: 356,993)
--   tbk:  2,650 (이전: 1,951)


-- ═══════════════════════════════════════════════════════════════════════
-- 사용자 확인 후 실무자에게 알릴 사항:
--   1. 브라우저 강제 새로고침(Ctrl+F5)
--   2. 혹은 로그아웃 후 재로그인
--   → 위 복구된 서버 상태가 클라이언트로 다시 내려옴
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 만약 복구 후 문제 발견 시 롤백 (STEP 2의 백업으로 되돌림)
-- ═══════════════════════════════════════════════════════════════════════
-- UPDATE company_data cd
-- SET data_value = b.data_value, updated_at = now()
-- FROM company_data_pre_recovery_20260427 b
-- WHERE cd.company_id = b.company_id
--   AND cd.data_key   = b.data_key
--   AND cd.company_id = 4;
