// 서버 측 로거 — 백엔드 함수에서 호출하여 error_log 테이블에 기록
//
// 사용 예:
//   import { logServerError } from './_shared/logger.js';
//   await logServerError({ source: 'data-save', message: 'guard rejected empty value', meta: { key } });
//
// 실패 시 자체 try-catch로 console.warn 폴백 (로깅 실패가 본 함수 동작 막지 않도록)

import { supabase } from './supabase.js';
import { scrubText, scrubObject } from './scrub.js';

const VALID_LEVELS = new Set(['error', 'warn', 'info', 'guard']);

export async function logServerError({ level = 'error', source, message, stack, meta, companyId, userEmail, buildId, ipHash } = {}) {
  try {
    if (!source || !message) return;
    if (!VALID_LEVELS.has(level)) level = 'error';

    const row = {
      level,
      source: String(source).slice(0, 40),
      message: scrubText(String(message)).slice(0, 2000),
      stack: stack ? scrubText(String(stack)).slice(0, 4000) : null,
      meta: meta ? scrubObject(meta) : null,
      company_id: companyId || null,
      user_email: userEmail ? scrubText(String(userEmail)).slice(0, 255) : null,
      build_id: buildId ? String(buildId).slice(0, 20) : null,
      ip_hash: ipHash ? String(ipHash).slice(0, 16) : null
    };

    const { error } = await supabase.from('error_log').insert(row);
    if (error) {
      // 자체 실패는 console에만 (재귀 로깅 방지)
      console.warn('logServerError insert failed:', error.message || error);
    }
  } catch (e) {
    console.warn('logServerError exception:', e?.message || e);
  }
}
