import { supabase } from './supabase.js';

// ── Rate Limit 설정 ──
// 이메일 기반 DB-only (서버리스 환경에서 in-memory는 인스턴스마다 독립이라 무의미)
const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 10;

// 관리자 계정은 더 엄격한 제한
const ADMIN_WINDOW_MINUTES = 30;
const ADMIN_MAX_ATTEMPTS = 5;

export async function checkRateLimit(email, ip, isAdmin = false) {
  const window = isAdmin ? ADMIN_WINDOW_MINUTES : WINDOW_MINUTES;
  const max = isAdmin ? ADMIN_MAX_ATTEMPTS : MAX_ATTEMPTS;

  try {
    const since = new Date(Date.now() - window * 60_000).toISOString();
    const { count, error } = await supabase
      .from('login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('email', email)
      .gte('attempted_at', since);

    // DB 오류 시 차단 (fail-closed: 공격자가 DB 부하로 우회하는 것 방지)
    if (error) {
      console.error('rate-limit: DB check failed');
      return { allowed: false, retryAfter: 60 };
    }

    if (count >= max) {
      return { allowed: false, retryAfter: window * 60 };
    }
  } catch {
    // 예외 시에도 차단 (fail-closed)
    return { allowed: false, retryAfter: 60 };
  }

  return { allowed: true };
}

export async function recordLoginAttempt(email, ip) {
  try {
    await supabase.from('login_attempts').insert({
      email,
      ip: ip || 'unknown',
      attempted_at: new Date().toISOString()
    });
  } catch {
    // 기록 실패해도 로그인 흐름에 영향 없음
  }
}

export async function clearLoginAttempts(email) {
  try {
    await supabase.from('login_attempts').delete().eq('email', email);
  } catch {
    // 삭제 실패해도 무방
  }
}
