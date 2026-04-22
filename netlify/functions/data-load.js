import { supabase } from './_shared/supabase.js';
import { verifyToken, ok, err, options } from './_shared/auth.js';
import { decryptEmps } from './_shared/crypto.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    const decoded = verifyToken(event);
    if (decoded.role === 'admin') return err(403, '관리자는 이 엔드포인트 사용 불가', event);
    const companyId = decoded.companyId;

    let body = {};
    try { if (event.body) body = JSON.parse(event.body); } catch { return err(400, '잘못된 요청 형식입니다', event); }
    const key = body.key;

    // data-save와 동일한 키 화이트리스트 적용
    const ALLOWED_KEYS = ['emps','pol','bk','tbk','rec','bonus','allow','tax','leave_settings','leave_overrides','folders','safety','pol_snapshots','pay_snapshots'];
    if (key && !ALLOWED_KEYS.includes(key)) {
      return err(400, '허용되지 않은 데이터 키입니다', event);
    }

    let query = supabase
      .from('company_data')
      .select('data_key, data_value')
      .eq('company_id', companyId);

    if (key) {
      query = query.eq('data_key', key);
    }

    const { data: rows, error: dbErr } = await query;
    if (dbErr) return err(500, '서버 오류가 발생했습니다', event);

    const map = {};
    (rows || []).forEach(r => {
      try { map[r.data_key] = JSON.parse(r.data_value); } catch (e) {}
    });

    // emps 데이터의 주민번호 뒷자리 복호화
    if (map.emps) {
      map.emps = decryptEmps(map.emps);
    }

    return ok(map, event);

  } catch (e) {
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
