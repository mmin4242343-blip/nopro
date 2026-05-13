// ═══════════════════════════════════════════════════════════════════════
// 관리자 알림 액션 API (읽음 처리 / 삭제)
//
// POST /api/admin-notifications-action
//   body: { action: 'mark_read_all' }              - 전체 읽음 처리
//   body: { action: 'mark_read', ids: [1,2,3] }    - 선택 읽음 처리
//   body: { action: 'delete_all' }                 - 전체 삭제
//   body: { action: 'delete', ids: [1,2,3] }       - 선택 삭제
//
// 응답: { affected: <건수> }
// ═══════════════════════════════════════════════════════════════════════

import { supabase } from './_shared/supabase.js';
import { requireAdmin, ok, err, options } from './_shared/auth.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    requireAdmin(event);

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return err(400, '잘못된 요청 본문', event); }

    const action = body.action;
    const ids = Array.isArray(body.ids) ? body.ids.map(n => +n).filter(n => Number.isFinite(n)) : null;

    if (action === 'mark_read_all') {
      const { error, count } = await supabase
        .from('admin_notifications')
        .update({ read_at: new Date().toISOString() }, { count: 'exact' })
        .is('read_at', null);
      if (error) return err(500, '읽음 처리 실패', event);
      return ok({ affected: count || 0 }, event);
    }

    if (action === 'mark_read') {
      if (!ids || ids.length === 0) return err(400, 'ids 필요', event);
      const { error, count } = await supabase
        .from('admin_notifications')
        .update({ read_at: new Date().toISOString() }, { count: 'exact' })
        .in('id', ids);
      if (error) return err(500, '읽음 처리 실패', event);
      return ok({ affected: count || 0 }, event);
    }

    if (action === 'delete_all') {
      // 전체 삭제 — id IS NOT NULL 로 모든 행 매칭 (Supabase는 WHERE 절 필수)
      const { error, count } = await supabase
        .from('admin_notifications')
        .delete({ count: 'exact' })
        .not('id', 'is', null);
      if (error) return err(500, '삭제 실패', event);
      return ok({ affected: count || 0 }, event);
    }

    if (action === 'delete') {
      if (!ids || ids.length === 0) return err(400, 'ids 필요', event);
      const { error, count } = await supabase
        .from('admin_notifications')
        .delete({ count: 'exact' })
        .in('id', ids);
      if (error) return err(500, '삭제 실패', event);
      return ok({ affected: count || 0 }, event);
    }

    return err(400, 'action 값이 유효하지 않습니다', event);

  } catch (e) {
    if (e.message?.includes('관리자')) return err(403, '관리자 권한이 필요합니다', event);
    if (e.message?.includes('토큰') || e.message?.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
};
