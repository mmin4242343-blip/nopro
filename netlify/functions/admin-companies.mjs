import { supabase } from './_shared/supabase.mjs';
import { requireAdmin, ok, err, options } from './_shared/auth.mjs';

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'GET') return err(405, 'Method not allowed');

  try {
    requireAdmin(event);

    const { data: companies, error: dbErr } = await supabase
      .from('companies')
      .select('id, company_name, manager_name, phone, email, size, join_date, status, created_at')
      .order('created_at', { ascending: false });

    if (dbErr) return err(500, 'DB 오류: ' + dbErr.message);

    // 각 회사의 직원 수 조회
    const result = [];
    for (const c of (companies || [])) {
      const { data: empData } = await supabase
        .from('company_data')
        .select('data_value')
        .eq('company_id', c.id)
        .eq('data_key', 'emps');

      let empCount = 0;
      if (empData && empData.length > 0) {
        try {
          const emps = JSON.parse(empData[0].data_value);
          empCount = Array.isArray(emps) ? emps.length : 0;
        } catch (e) {}
      }

      result.push({
        id: c.id,
        company: c.company_name,
        name: c.manager_name,
        phone: c.phone,
        email: c.email,
        size: c.size,
        joinDate: c.join_date,
        status: c.status,
        empCount
        // 비밀번호 절대 반환하지 않음
      });
    }

    return ok(result);

  } catch (e) {
    if (e.message.includes('관리자')) return err(403, e.message);
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다');
    return err(500, e.message);
  }
}
