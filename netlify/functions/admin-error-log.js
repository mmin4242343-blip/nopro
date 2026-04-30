// 관리자 전용 — error_log 조회 + 통계
//
// 응답: { rows: [...], total: N, stats: { byLevel: {error: N, warn: N, ...}, byDay: [{date, count}] } }
// 쿼리 파라미터:
//   level   — 'error' | 'warn' | 'info' | 'guard'
//   source  — 부분 일치 (LIKE %x%)
//   since   — ISO 날짜 (기본: 7일 전)
//   limit   — 최대 200 (기본 100)
//   offset  — 페이징

import { supabase } from './_shared/supabase.js';
import { requireAdmin, ok, err, options } from './_shared/auth.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'GET') return err(405, 'Method not allowed', event);

  try {
    requireAdmin(event);

    const q = event.queryStringParameters || {};
    let limit = parseInt(q.limit || '100', 10);
    let offset = parseInt(q.offset || '0', 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) limit = 100;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    const sinceIso = q.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 본 목록
    let query = supabase
      .from('error_log')
      .select('id, occurred_at, level, source, message, stack, url, user_agent, company_id, user_email, meta, build_id, ip_hash', { count: 'exact' })
      .gte('occurred_at', sinceIso)
      .order('occurred_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (q.level && ['error','warn','info','guard'].includes(q.level)) {
      query = query.eq('level', q.level);
    }
    if (q.source) {
      query = query.ilike('source', `%${String(q.source).replace(/[%_]/g,'')}%`);
    }

    const { data: rows, count, error: dbErr } = await query;
    if (dbErr) return err(500, '조회 실패', event);

    // 통계 (전체 기간 대상이 아니라 since 이후로 제한)
    // level별 카운트
    const { data: levelStats } = await supabase
      .from('error_log')
      .select('level')
      .gte('occurred_at', sinceIso);
    const byLevel = { error: 0, warn: 0, info: 0, guard: 0 };
    (levelStats || []).forEach(r => { byLevel[r.level] = (byLevel[r.level] || 0) + 1; });

    // 일별 추이 (최근 7일)
    const { data: dayStats } = await supabase
      .from('error_log')
      .select('occurred_at')
      .gte('occurred_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    const byDay = {};
    (dayStats || []).forEach(r => {
      const d = String(r.occurred_at).slice(0, 10);
      byDay[d] = (byDay[d] || 0) + 1;
    });
    const byDayArr = Object.entries(byDay).map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return ok({
      rows: rows || [],
      total: count || 0,
      stats: { byLevel, byDay: byDayArr }
    }, event);

  } catch (e) {
    if (e.message?.includes('관리자')) return err(403, '관리자 권한이 필요합니다', event);
    if (e.message?.includes('토큰') || e.message?.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류', event);
  }
};
