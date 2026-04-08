import { supabase } from './_shared/supabase.js';
import { verifyToken, ok, err, options } from './_shared/auth.js';
import { encryptEmps } from './_shared/crypto.js';

// 대용량 키는 감사 로그에서 old_value를 생략 (저장 공간 절약)
const SKIP_OLD_VALUE_KEYS = ['rec', 'tbk'];

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    const decoded = verifyToken(event);
    if (decoded.role === 'admin') return err(403, '관리자는 데이터 저장 불가', event);
    const companyId = decoded.companyId;
    const changedBy = decoded.email || 'unknown';

    const body = JSON.parse(event.body);

    // 단일 저장 또는 bulk 저장
    const ALLOWED_KEYS = ['emps','pol','bk','tbk','rec','bonus','allow','tax','leave_settings','leave_overrides'];
    const items = body.items || [{ key: body.key, value: body.value }];

    for (const item of items) {
      if (!item.key || !ALLOWED_KEYS.includes(item.key)) continue;

      let value = item.value;

      // emps 데이터의 주민번호 뒷자리 암호화
      if (item.key === 'emps' && Array.isArray(value)) {
        value = encryptEmps(value);
      }

      const dataStr = JSON.stringify(value);

      // 감사 로그용: 기존 값 조회 (대용량 키 제외)
      let oldValue = null;
      if (!SKIP_OLD_VALUE_KEYS.includes(item.key)) {
        try {
          const { data: existing } = await supabase
            .from('company_data')
            .select('data_value')
            .eq('company_id', companyId)
            .eq('data_key', item.key)
            .single();
          if (existing) oldValue = existing.data_value;
        } catch {
          // 기존 값 조회 실패해도 저장은 진행
        }
      }

      // atomic upsert (레이스 컨디션 방지)
      const { error: upsertErr } = await supabase
        .from('company_data')
        .upsert({
          company_id: companyId,
          data_key: item.key,
          data_value: dataStr,
          updated_at: new Date().toISOString()
        }, { onConflict: 'company_id,data_key' });
      if (upsertErr) return err(500, '서버 오류가 발생했습니다', event);

      // 감사 로그 기록 (비동기, 실패해도 저장에 영향 없음)
      try {
        await supabase.from('audit_log').insert({
          company_id: companyId,
          data_key: item.key,
          action: oldValue ? 'update' : 'create',
          changed_by: changedBy,
          old_value: oldValue,
          new_value: SKIP_OLD_VALUE_KEYS.includes(item.key) ? null : dataStr,
          changed_at: new Date().toISOString()
        });
      } catch {
        // 감사 로그 실패해도 데이터 저장에 영향 없음
      }
    }

    return ok({ success: true }, event);

  } catch (e) {
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
