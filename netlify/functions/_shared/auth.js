import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://noprohr.netlify.app,http://localhost:8888').split(',').map(s => s.trim());
const COOKIE_NAME = 'nopro_token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7일 (초)

export function signToken(payload) {
  return jwt.sign(payload, SECRET(), { expiresIn: '7d' });
}

export function verifyToken(event) {
  // httpOnly 쿠키에서만 토큰 읽기 (Authorization 헤더 폴백 제거 — XSS 방어)
  const token = parseCookie(event.headers.cookie || event.headers.Cookie || '', COOKIE_NAME);
  if (!token) throw new Error('인증 토큰이 없습니다');
  return jwt.verify(token, SECRET(), { algorithms: ['HS256'] });
}

export function requireAdmin(event) {
  const decoded = verifyToken(event);
  if (decoded.role !== 'admin') throw new Error('관리자 권한이 필요합니다');
  return decoded;
}

function parseCookie(cookieStr, name) {
  if (!cookieStr) return null;
  // 같은 이름의 쿠키가 여러 개일 때 가장 마지막(최신) 것을 사용
  const cookies = cookieStr.split(';').map(c => c.trim()).filter(c => c.startsWith(name + '='));
  if (cookies.length === 0) return null;
  const last = cookies[cookies.length - 1];
  return last.split('=').slice(1).join('=');
}

export function cors(event) {
  const origin = event?.headers?.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json'
  };
}

function cookieFlags(event) {
  const origin = event?.headers?.origin || '';
  const isLocal = origin.includes('localhost');
  const secure = isLocal ? '' : ' Secure;';
  return secure;
}

export function tokenCookie(token, event) {
  const secure = cookieFlags(event);
  return `${COOKIE_NAME}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

// 예전 Path=/api 쿠키를 제거하는 클리어 쿠키
function clearOldPathCookie(event) {
  const secure = cookieFlags(event);
  return `${COOKIE_NAME}=; HttpOnly;${secure} SameSite=Lax; Path=/api; Max-Age=0`;
}

export function clearTokenCookie(event) {
  const secure = cookieFlags(event);
  return `${COOKIE_NAME}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`;
}

export function okWithCookie(body, token, event) {
  return {
    statusCode: 200,
    headers: cors(event),
    multiValueHeaders: {
      'Set-Cookie': [
        tokenCookie(token, event),
        clearOldPathCookie(event)
      ]
    },
    body: JSON.stringify(body)
  };
}

export function ok(body, event) {
  return { statusCode: 200, headers: cors(event), body: JSON.stringify(body) };
}

export function err(statusCode, message, event) {
  return { statusCode, headers: cors(event), body: JSON.stringify({ error: message }) };
}

export function options(event) {
  return { statusCode: 204, headers: cors(event), body: '' };
}

// 로그아웃 시 두 경로 모두 클리어
export function logoutResponse(event) {
  return {
    statusCode: 200,
    headers: cors(event),
    multiValueHeaders: {
      'Set-Cookie': [
        clearTokenCookie(event),
        clearOldPathCookie(event)
      ]
    },
    body: JSON.stringify({ success: true })
  };
}
