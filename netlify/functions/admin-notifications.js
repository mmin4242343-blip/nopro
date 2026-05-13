// ═══════════════════════════════════════════════════════════════════════
// 관리자 알림 조회 API
//
// GET /api/admin-notifications?limit=50&offset=0&unread=1
//   - limit, offset: 페이징 (기본 50건)
//   - unread=1: 안 읽은 것만 조회 (생략 시 전체)
//
// 응답: { rows: [...], total, unreadCount }
// ═══════════════════════════════════════════════════════════════════════

import { supabase } from './_shared/supabase.js';
import { requireAdmin, ok, err, options } from './_shared/auth.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'GET') return err(405, 'Method not allowed', event);

  try {
    requireAdmin(event);

    const qs = event.queryStringParameters || {};
    const limit = Math.min(Math.max(parseInt(qs.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(qs.offset, 10) || 0, 0);
    const unreadOnly = qs.unread === '1';

    // 목록 조회
    let q = supabase
      .from('admin_notifications')
      .select('id, type, title, body, company_id, meta, created_at, read_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (unreadOnly) q = q.is('read_at', null);

    const { data: rows, count, error: listErr } = await q;
    if (listErr) {
      console.error('[admin-notifications] list error:', listErr.message);
      return err(500, '알림 조회 실패', event);
    }

    // 안 읽은 알림 개수 (뱃지용)
    const { count: unreadCount, error: cntErr } = await supabase
      .from('admin_notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);

    if (cntErr) {
      console.warn('[admin-notifications] unread count error:', cntErr.message);
    }

    return ok({
      rows: rows || [],
      total: count || 0,
      unreadCount: unreadCount || 0
    }, event);

  } catch (e) {
    if (e.message?.includes('관리자')) return err(403, '관리자 권한이 필요합니다', event);
    if (e.message?.includes('토큰') || e.message?.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
};
