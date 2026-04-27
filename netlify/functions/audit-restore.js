import { supabase } from './_shared/supabase.js';
import { verifyToken, ok, err, options } from './_shared/auth.js';

// 🔄 복구 API: 특정 audit_log 행의 old_value 또는 new_value를 company_data에 복원.
// 호출 형식: POST /audit-restore
//   body: { auditId: <audit_log.id>, useField: 'old_value'|'new_value' (default: old_value) }
//
// 안전장치:
//   - 복원 직전 현재 상태를 audit_log에 'restore-snapshot' action으로 기록 (롤백 가능)
//   - 본인 회사 audit_log 행만 사용 가능 (companyId 일치 확인)
//   - 'restore' action이 audit_log에 새로 기록되어 누가 언제 복원했는지 추적

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    const decoded = verifyToken(event);
    if (decoded.role === 'admin') return err(403, '관리자 계정은 복구 불가', event);
    const companyId = decoded.companyId;
    const changedBy = decoded.email || 'unknown';
    if (!companyId) return err(403, '권한이 없습니다', event);

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { return err(400, '잘못된 요청 형식', event); }

    const auditId = body.auditId;
    const useField = (body.useField === 'new_value') ? 'new_value' : 'old_value';
    if (!auditId) return err(400, 'auditId 필요', event);

    // 1. 복원 대상 audit_log 행 조회 (본인 회사 제한)
    const { data: auditRow, error: auditErr } = await supabase
      .from('audit_log')
      .select('id, company_id, data_key, old_value, new_value, changed_at, changed_by')
      .eq('id', auditId)
      .eq('company_id', companyId)
      .single();
    if (auditErr || !auditRow) return err(404, '해당 감사 로그를 찾을 수 없습니다', event);

    const restoreValue = auditRow[useField];
    if (!restoreValue) return err(400, '해당 시점에 ' + useField + ' 데이터가 없습니다', event);

    // 2. 복원 직전 현재 상태 백업 (audit_log에 'restore-snapshot' 기록)
    let currentValue = null;
    try {
      const { data: existing } = await supabase
        .from('company_data')
        .select('data_value')
        .eq('company_id', companyId)
        .eq('data_key', auditRow.data_key)
        .single();
      if (existing) currentValue = existing.data_value;
    } catch {}

    if (currentValue) {
      try {
        await supabase.from('audit_log').insert({
          company_id: companyId,
          data_key: auditRow.data_key,
          action: 'restore-snapshot',
          changed_by: changedBy,
          old_value: currentValue,
          new_value: currentValue,  // 복원 직전 상태 백업 (롤백 시 활용)
          changed_at: new Date().toISOString(),
        });
      } catch {}
    }

    // 3. 복원 실행
    const newUpdatedAt = new Date().toISOString();
    const { error: upsertErr } = await supabase
      .from('company_data')
      .upsert({
        company_id: companyId,
        data_key: auditRow.data_key,
        data_value: restoreValue,
        updated_at: newUpdatedAt,
      }, { onConflict: 'company_id,data_key' });
    if (upsertErr) return err(500, '복원 실패', event);

    // 4. 복원 이벤트 audit_log 기록
    try {
      await supabase.from('audit_log').insert({
        company_id: companyId,
        data_key: auditRow.data_key,
        action: 'restore',
        changed_by: changedBy,
        old_value: currentValue,
        new_value: restoreValue,
        changed_at: new Date().toISOString(),
      });
    } catch {}

    return ok({
      success: true,
      data_key: auditRow.data_key,
      restoredFromAuditId: auditId,
      restoredFromTimestamp: auditRow.changed_at,
      restoredSize: restoreValue.length,
      newUpdatedAt,
    }, event);

  } catch (e) {
    if (e.message && (e.message.includes('토큰') || e.message.includes('jwt'))) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
};
