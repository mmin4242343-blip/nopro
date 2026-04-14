import { supabase } from './_shared/supabase.js';
import { verifyToken, ok, err, options } from './_shared/auth.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'GET') return err(405, 'Method not allowed', event);

  try {
    const decoded = verifyToken(event);
    const companyId = decoded.companyId;
    if (!companyId) return err(403, '권한이 없습니다', event);

    const params = event.queryStringParameters || {};
    const dataKey = params.key || null;
    const limit = Math.max(1, Math.min(parseInt(params.limit) || 50, 200));
    const offset = Math.max(0, parseInt(params.offset) || 0);

    let query = supabase
      .from('audit_log')
      .select('id, data_key, action, changed_by, changed_at, old_value, new_value')
      .eq('company_id', companyId)
      .order('changed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (dataKey) {
      query = query.eq('data_key', dataKey);
    }

    const { data: logs, error: dbErr } = await query;
    if (dbErr) return err(500, '감사 로그 조회 실패', event);

    return ok({ logs: logs || [], total: (logs || []).length }, event);

  } catch (e) {
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
