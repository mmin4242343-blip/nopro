import { supabase } from './_shared/supabase.mjs';
import { requireAdmin, ok, err, options } from './_shared/auth.mjs';

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'DELETE') return err(405, 'Method not allowed');

  try {
    requireAdmin(event);

    const { companyId } = JSON.parse(event.body);
    if (!companyId) return err(400, '회사 ID가 필요합니다');

    // 회사 데이터 삭제
    await supabase
      .from('company_data')
      .delete()
      .eq('company_id', companyId);

    // 회사 삭제
    const { error: dbErr } = await supabase
      .from('companies')
      .delete()
      .eq('id', companyId);

    if (dbErr) return err(500, 'DB 오류: ' + dbErr.message);

    return ok({ success: true });

  } catch (e) {
    if (e.message.includes('관리자')) return err(403, e.message);
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다');
    return err(500, e.message);
  }
}
