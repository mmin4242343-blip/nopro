import { supabase } from './_shared/supabase.js';
import { verifyToken, ok, err, options } from './_shared/auth.js';
import { encryptEmps } from './_shared/crypto.js';

// 모든 키의 old_value를 감사 로그에 저장 (전체 복구 가능)
// 대용량 키는 프론트에서 별도 API 호출로 분리하여 타임아웃 방지
const SKIP_OLD_VALUE_KEYS = [];

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    // 요청 본문 크기 제한 (10MB)
    if (event.body && event.body.length > 10 * 1024 * 1024) {
      return err(413, '요청 데이터가 너무 큽니다', event);
    }

    const decoded = verifyToken(event);
    if (decoded.role === 'admin') return err(403, '관리자는 데이터 저장 불가', event);
    const companyId = decoded.companyId;
    const changedBy = decoded.email || 'unknown';

    let body;
    try { body = JSON.parse(event.body); } catch { return err(400, '잘못된 요청 형식입니다', event); }

    // 단일 저장 또는 bulk 저장
    const ALLOWED_KEYS = ['emps','pol','bk','tbk','rec','bonus','allow','tax','leave_settings','leave_overrides','folders','safety','pol_snapshots','pay_snapshots','bk_snapshots','emp_display_order'];
    const items = body.items || [{ key: body.key, value: body.value, expectedUpdatedAt: body.expectedUpdatedAt }];

    const versions = {};   // 저장 성공한 키 → 새 updated_at (클라가 자기 _serverVersions 갱신용)
    const conflicts = [];  // 낙관적 잠금 충돌 — 클라가 stale 상태로 덮어쓰려 한 키 정보

    for (const item of items) {
      if (!item.key || !ALLOWED_KEYS.includes(item.key)) continue;

      let value = item.value;

      // emps 데이터의 주민번호 뒷자리 암호화
      if (item.key === 'emps' && Array.isArray(value)) {
        value = encryptEmps(value);
      }

      const dataStr = JSON.stringify(value);

      // 감사 로그용 + 🛡️ 빈값 가드용 + 🛡️ 낙관적 잠금용: 기존 값/버전 조회
      let oldValue = null;
      let serverUpdatedAt = null;
      try {
        const { data: existing } = await supabase
          .from('company_data')
          .select('data_value, updated_at')
          .eq('company_id', companyId)
          .eq('data_key', item.key)
          .single();
        if (existing) {
          oldValue = existing.data_value;
          serverUpdatedAt = existing.updated_at;
        }
      } catch {
        // 기존 값 조회 실패해도 저장은 진행
      }

      // 🛡️ 서버측 2차 방어: 빈값 저장 절대 금지 (보호 대상 키)
      const PROTECTED = new Set(['emps','rec','bonus','allow','tax','tbk','safety','bk','emp_display_order']);
      if (PROTECTED.has(item.key)) {
        // emp_display_order는 빈 배열이 정상값(아직 마이그레이션 전, 또는 직원 0명)이므로 oldValue 없을 때만 빈값 허용
        if (item.key === 'emp_display_order' && Array.isArray(value) && value.length === 0 && !oldValue) {
          // 최초 1회 빈 배열 저장 허용 (이후엔 PROTECTED 가드 풀로 작동)
        } else {
          const clientIsEmpty = Array.isArray(value) ? value.length === 0 : (value && typeof value==='object' && Object.keys(value).length===0);
          if (clientIsEmpty) {
            console.warn(`🛡️ 서버 가드: 빈값 저장 차단 (company=${companyId}, key=${item.key}, by=${changedBy}, oldExists=${!!oldValue})`);
            continue;  // 해당 키만 스킵
          }
        }
      }

      // 🛡️ 낙관적 잠금 (강화판): 옛 캐시된 클라이언트가 가드를 우회하지 못하게 함
      const expectedUpdatedAt = item.expectedUpdatedAt || null;
      const isStaleOverwrite = expectedUpdatedAt && serverUpdatedAt && new Date(serverUpdatedAt) > new Date(expectedUpdatedAt);
      const isLegacyClientRisk = !expectedUpdatedAt && serverUpdatedAt && PROTECTED.has(item.key);
      if (isStaleOverwrite || isLegacyClientRisk) {
        conflicts.push({
          key: item.key,
          expected: expectedUpdatedAt,
          actual: serverUpdatedAt,
          reason: isLegacyClientRisk ? 'legacy-client-no-version' : 'stale-version',
        });
        console.warn(`🛡️ 낙관적 잠금: ${isLegacyClientRisk?'레거시 클라이언트 차단':'충돌'} (company=${companyId}, key=${item.key}, by=${changedBy}, expected=${expectedUpdatedAt}, server=${serverUpdatedAt})`);
        continue;
      }

      // 🛡️ 6중 가드: 사이즈 급감 자동 차단 (낙관적 잠금이 어떻게든 뚫려도 최종 방어선)
      // PROTECTED 키가 30% 이상 줄어들면 stale-overwrite로 간주, 무조건 거부.
      // 정상적인 사용 패턴에서 30% 감소는 거의 없음 (정당한 대량 삭제는 보통 단계적).
      // 만약 정말 의도된 30%+ 삭제라면 → 문의 후 SHRINK_OK 플래그로 우회.
      if (PROTECTED.has(item.key) && oldValue) {
        const oldSize = oldValue.length;
        const newSize = dataStr.length;
        const SHRINK_THRESHOLD = 0.30; // 30% 이상 감소 시 차단
        const MIN_LOSS_BYTES = 5000;   // 5KB 미만 차이는 무시 (신규/소규모 정상 동작)
        const lostBytes = oldSize - newSize;
        if (lostBytes > MIN_LOSS_BYTES && lostBytes / oldSize > SHRINK_THRESHOLD) {
          conflicts.push({
            key: item.key,
            reason: 'size-drop-blocked',
            oldSize,
            newSize,
            lostBytes,
          });
          console.error(`🚨 사이즈 급감 차단! (company=${companyId}, key=${item.key}, by=${changedBy}, ${oldSize}B → ${newSize}B, -${lostBytes}B = ${Math.round(lostBytes/oldSize*100)}% 감소). 데이터 손실 방지 위해 거부.`);
          continue;
        }
      }

      // atomic upsert (레이스 컨디션 방지)
      const newUpdatedAt = new Date().toISOString();
      const { error: upsertErr } = await supabase
        .from('company_data')
        .upsert({
          company_id: companyId,
          data_key: item.key,
          data_value: dataStr,
          updated_at: newUpdatedAt
        }, { onConflict: 'company_id,data_key' });
      if (upsertErr) return err(500, '서버 오류가 발생했습니다', event);

      versions[item.key] = newUpdatedAt;

      // 감사 로그 기록 (비동기, 실패해도 저장에 영향 없음)
      try {
        await supabase.from('audit_log').insert({
          company_id: companyId,
          data_key: item.key,
          action: oldValue ? 'update' : 'create',
          changed_by: changedBy,
          old_value: oldValue,
          new_value: dataStr,
          changed_at: new Date().toISOString()
        });
      } catch {
        // 감사 로그 실패해도 데이터 저장에 영향 없음
      }
    }

    return ok({ success: true, versions, conflicts }, event);

  } catch (e) {
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
