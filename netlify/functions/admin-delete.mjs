import { supabase } from './_shared/supabase.mjs';
import { requireAdmin, ok, err, options } from './_shared/auth.mjs';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'DELETE') return err(405, 'Method not allowed', event);

  try {
    requireAdmin(event);

    const { companyId } = JSON.parse(event.body);
    if (!companyId) return err(400, '회사 ID가 필요합니다', event);

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

    if (dbErr) return err(500, '서버 오류가 발생했습니다', event);

    return ok({ success: true }, event);

  } catch (e) {
    if (e.message.includes('관리자')) return err(403, '관리자 권한이 필요합니다', event);
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
