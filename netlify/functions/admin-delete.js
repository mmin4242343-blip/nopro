import { supabase } from './_shared/supabase.js';
import { requireAdmin, ok, err, options } from './_shared/auth.js';
import { logServerError } from './_shared/logger.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'DELETE') return err(405, 'Method not allowed', event);

  try {
    const decoded = requireAdmin(event);

    const { companyId } = JSON.parse(event.body);
    if (!companyId) return err(400, '회사 ID가 필요합니다', event);

    // 🛡️ M-5: 삭제 전 스냅샷 — error_log에 감사 이벤트로 기록 (회사 삭제 후에도 ON DELETE SET NULL로 보존됨)
    let snapshot = null;
    try {
      const { data: companyRow } = await supabase
        .from('companies')
        .select('id, company_name, manager_name, email, phone, size, join_date, status, group_tag')
        .eq('id', companyId)
        .maybeSingle();
      const { count: dataCount } = await supabase
        .from('company_data')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);
      snapshot = { companyRow, dataKeyCount: dataCount || 0 };
    } catch (e) {
      // 스냅샷 실패해도 삭제는 진행 (감사로그 best-effort)
      console.warn('admin-delete: snapshot fetch failed:', e?.message);
    }

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

    // 🛡️ M-5: 삭제 완료 감사 로그 (best-effort, 실패해도 응답엔 영향 X)
    try {
      await logServerError({
        level: 'warn',
        source: 'admin-delete',
        message: `관리자 회사 삭제: companyId=${companyId} name=${snapshot?.companyRow?.company_name || 'unknown'}`,
        userEmail: decoded?.email || 'admin',
        meta: {
          deletedCompanyId: companyId,
          snapshot: snapshot?.companyRow || null,
          dataKeyCount: snapshot?.dataKeyCount || 0,
          deletedAt: new Date().toISOString()
        }
      });
    } catch {}

    return ok({ success: true }, event);

  } catch (e) {
    if (e.message.includes('관리자')) return err(403, '관리자 권한이 필요합니다', event);
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
