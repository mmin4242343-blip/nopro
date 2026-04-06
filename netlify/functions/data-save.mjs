import { supabase } from './_shared/supabase.mjs';
import { verifyToken, ok, err, options } from './_shared/auth.mjs';
import { encryptEmps } from './_shared/crypto.mjs';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    const decoded = verifyToken(event);
    if (decoded.role === 'admin') return err(403, '관리자는 데이터 저장 불가', event);
    const companyId = decoded.companyId;

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

      // upsert
      const { data: existing } = await supabase
        .from('company_data')
        .select('id')
        .eq('company_id', companyId)
        .eq('data_key', item.key);

      if (existing && existing.length > 0) {
        const { error: updateErr } = await supabase
          .from('company_data')
          .update({ data_value: dataStr, updated_at: new Date().toISOString() })
          .eq('company_id', companyId)
          .eq('data_key', item.key);
        if (updateErr) return err(500, '서버 오류가 발생했습니다', event);
      } else {
        const { error: insertErr } = await supabase
          .from('company_data')
          .insert({
            company_id: companyId,
            data_key: item.key,
            data_value: dataStr,
            updated_at: new Date().toISOString()
          });
        if (insertErr) return err(500, '서버 오류가 발생했습니다', event);
      }
    }

    return ok({ success: true }, event);

  } catch (e) {
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
