import { supabase } from './supabase.js';

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 10;

// In-memory burst protection (per warm instance)
const memoryMap = new Map();
const MEM_WINDOW_MS = 60_000; // 1분
const MEM_MAX = 5;

function checkMemoryLimit(key) {
  const now = Date.now();
  const record = memoryMap.get(key);
  if (!record) {
    memoryMap.set(key, { count: 1, start: now });
    return true;
  }
  if (now - record.start > MEM_WINDOW_MS) {
    memoryMap.set(key, { count: 1, start: now });
    return true;
  }
  record.count++;
  return record.count <= MEM_MAX;
}

function clearMemoryLimit(key) {
  memoryMap.delete(key);
}

export async function checkRateLimit(email, ip) {
  // 1) In-memory burst check
  const memKey = `${email}_${ip}`;
  if (!checkMemoryLimit(memKey)) {
    return { allowed: false, retryAfter: 60 };
  }

  // 2) DB-backed persistent check
  try {
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const { count, error } = await supabase
      .from('login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('email', email)
      .gte('attempted_at', since);

    if (error) return { allowed: true }; // DB 오류 시 허용 (가용성 우선)

    if (count >= MAX_ATTEMPTS) {
      return { allowed: false, retryAfter: WINDOW_MINUTES * 60 };
    }
  } catch {
    return { allowed: true }; // 예외 시 허용
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
    clearMemoryLimit(email);
    await supabase.from('login_attempts').delete().eq('email', email);
  } catch {
    // 삭제 실패해도 무방
  }
}
