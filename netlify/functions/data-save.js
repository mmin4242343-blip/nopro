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
    const ALLOWED_KEYS = ['emps','pol','bk','tbk','rec','bonus','allow','tax','leave_settings','leave_overrides','folders','safety','pol_snapshots','pay_snapshots','bk_snapshots'];
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
      const PROTECTED = new Set(['emps','rec','bonus','allow','tax','tbk','safety','bk']);
      if (PROTECTED.has(item.key)) {
        const clientIsEmpty = Array.isArray(value) ? value.length === 0 : (value && typeof value==='object' && Object.keys(value).length===0);
        if (clientIsEmpty) {
          console.warn(`🛡️ 서버 가드: 빈값 저장 차단 (company=${companyId}, key=${item.key}, by=${changedBy}, oldExists=${!!oldValue})`);
          continue;  // 해당 키만 스킵
        }
      }

      // 🛡️ 낙관적 잠금: 클라이언트가 모르는 서버 변경분이 있으면 거부 (stale-overwrite 방지)
      // - expectedUpdatedAt: 클라가 마지막으로 본 서버 updated_at
      // - 서버 updated_at이 그보다 새로우면 다른 디바이스가 먼저 저장한 것 → 클라의 옛 상태로 덮으면 안 됨
      // - expectedUpdatedAt 미전송(레거시 클라/최초 저장): 체크 스킵 (점진적 마이그레이션 호환)
      const expectedUpdatedAt = item.expectedUpdatedAt || null;
      if (expectedUpdatedAt && serverUpdatedAt && new Date(serverUpdatedAt) > new Date(expectedUpdatedAt)) {
        conflicts.push({
          key: item.key,
          expected: expectedUpdatedAt,
          actual: serverUpdatedAt,
        });
        console.warn(`🛡️ 낙관적 잠금: 충돌 (company=${companyId}, key=${item.key}, by=${changedBy}, expected=${expectedUpdatedAt}, server=${serverUpdatedAt})`);
        continue;  // 이 키만 스킵, 다른 아이템은 계속 처리
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
