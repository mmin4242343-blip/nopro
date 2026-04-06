import { supabase } from './_shared/supabase.mjs';
import { verifyToken, ok, err, options } from './_shared/auth.mjs';
import { encryptEmps } from './_shared/crypto.mjs';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

  try {
    const decoded = verifyToken(event);
    if (decoded.role === 'admin') return err(403, '관리자는 데이터 저장 불가');
    const companyId = decoded.companyId;

    const body = JSON.parse(event.body);

    // 단일 저장 또는 bulk 저장
    const items = body.items || [{ key: body.key, value: body.value }];

    for (const item of items) {
      if (!item.key) continue;

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
        if (updateErr) return err(500, 'DB 저장 오류: ' + updateErr.message);
      } else {
        const { error: insertErr } = await supabase
          .from('company_data')
          .insert({
            company_id: companyId,
            data_key: item.key,
            data_value: dataStr,
            updated_at: new Date().toISOString()
          });
        if (insertErr) return err(500, 'DB 저장 오류: ' + insertErr.message);
      }
    }

    return ok({ success: true });

  } catch (e) {
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다');
    return err(500, e.message);
  }
}
