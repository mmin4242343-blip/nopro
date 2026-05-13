// 클라이언트 → 서버 에러 전송 엔드포인트
//
// 호출자: 브라우저의 reportError() 함수 (window.onerror, unhandledrejection, 가드 트리거 등)
// 인증: 선택적 — 로그인 안 된 사용자(랜딩 페이지 등)도 익명 기록 가능
// PII 스크럽: 클라가 1차 + 서버가 2차 (이중 방어)
// 남용 방지: IP당 분당 30건 in-memory rate-limit

import { cors, options } from './_shared/auth.js';
import { logServerError } from './_shared/logger.js';
import { scrubText, hashIp } from './_shared/scrub.js';
import jwt from 'jsonwebtoken';

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;
const _ipBuckets = new Map();
function _checkRate(ip) {
  const now = Date.now();
  const bucket = _ipBuckets.get(ip) || { count: 0, ts: now };
  if (now - bucket.ts > RATE_WINDOW_MS) { bucket.count = 0; bucket.ts = now; }
  bucket.count++;
  _ipBuckets.set(ip, bucket);
  // 메모리 누수 방지: 캐시 1만 항목 초과 시 오래된 것 제거
  if (_ipBuckets.size > 10000) {
    const cutoff = now - RATE_WINDOW_MS;
    for (const [k, v] of _ipBuckets) if (v.ts < cutoff) _ipBuckets.delete(k);
  }
  return bucket.count <= RATE_MAX;
}

const VALID_LEVELS = new Set(['error', 'warn', 'info', 'guard']);

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // body parse
    let body = {};
    try { if (event.body) body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: cors(event), body: JSON.stringify({ error: 'invalid json' }) }; }

    // body 크기 제한 (너무 큰 페이로드는 스택트레이스 폭주일 가능성)
    if (event.body && event.body.length > 16 * 1024) {
      return { statusCode: 413, headers: cors(event), body: JSON.stringify({ error: 'too large' }) };
    }

    // Rate Limit
    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
    if (!_checkRate(ip)) {
      return { statusCode: 429, headers: { ...cors(event), 'Retry-After': '60' }, body: JSON.stringify({ error: 'rate limited' }) };
    }

    // 인증 정보 (있으면 추출, 없어도 통과)
    let companyId = null, userEmail = null;
    try {
      const cookieStr = event.headers.cookie || event.headers.Cookie || '';
      const m = cookieStr.split(';').map(c => c.trim()).find(c => c.startsWith('nopro_token='));
      if (m) {
        const token = m.slice('nopro_token='.length);
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        companyId = decoded.companyId || null;
        userEmail = decoded.email || null;
      }
    } catch { /* 세션 만료·무효 토큰: 익명으로 기록 */ }

    // 필드 정제
    const level = VALID_LEVELS.has(body.level) ? body.level : 'error';
    const source = scrubText(String(body.source || 'client')).slice(0, 40);
    const message = scrubText(String(body.message || '(no message)')).slice(0, 2000);
    const stack = body.stack ? scrubText(String(body.stack)).slice(0, 4000) : null;
    const url = body.url ? scrubText(String(body.url)).slice(0, 500) : null;
    const userAgent = body.userAgent ? String(body.userAgent).slice(0, 500) : null;
    const buildId = body.buildId ? String(body.buildId).slice(0, 20) : null;

    await logServerError({
      level,
      source: source.startsWith('client') ? source : `client:${source}`,
      message,
      stack,
      meta: { url, userAgent, ...(body.meta || {}) },
      companyId,
      userEmail,
      buildId,
      ipHash: hashIp(ip)
    });

    return { statusCode: 200, headers: cors(event), body: JSON.stringify({ ok: true }) };

  } catch (e) {
    return { statusCode: 500, headers: cors(event), body: JSON.stringify({ error: 'internal' }) };
  }
};
