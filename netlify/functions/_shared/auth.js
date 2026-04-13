import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://noprohr.netlify.app,http://localhost:8888').split(',').map(s => s.trim());
const COOKIE_NAME = 'nopro_token';
const COOKIE_MAX_AGE = 86400; // 24시간 (초)

export function signToken(payload) {
  return jwt.sign(payload, SECRET(), { expiresIn: '24h' });
}

export function verifyToken(event) {
  // 1) 쿠키에서 토큰 읽기 (우선)
  const cookieToken = parseCookie(event.headers.cookie || event.headers.Cookie || '', COOKIE_NAME);
  // 2) Authorization 헤더 폴백
  const header = event.headers.authorization || event.headers.Authorization || '';
  const bearerToken = header.replace('Bearer ', '');

  const token = cookieToken || bearerToken;
  if (!token) throw new Error('인증 토큰이 없습니다');
  return jwt.verify(token, SECRET(), { algorithms: ['HS256'] });
}

export function requireAdmin(event) {
  const decoded = verifyToken(event);
  if (decoded.role !== 'admin') throw new Error('관리자 권한이 필요합니다');
  return decoded;
}

function parseCookie(cookieStr, name) {
  const match = cookieStr.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return match ? match.split('=')[1] : null;
}

export function cors(event) {
  const origin = event?.headers?.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json'
  };
}

export function tokenCookie(token, event) {
  const origin = event?.headers?.origin || '';
  const isLocal = origin.includes('localhost');
  const secure = isLocal ? '' : ' Secure;';
  return `${COOKIE_NAME}=${token}; HttpOnly;${secure} SameSite=Strict; Path=/api; Max-Age=${COOKIE_MAX_AGE}`;
}

export function clearTokenCookie(event) {
  const origin = event?.headers?.origin || '';
  const isLocal = origin.includes('localhost');
  const secure = isLocal ? '' : ' Secure;';
  return `${COOKIE_NAME}=; HttpOnly;${secure} SameSite=Strict; Path=/api; Max-Age=0`;
}

export function okWithCookie(body, token, event) {
  return {
    statusCode: 200,
    headers: { ...cors(event), 'Set-Cookie': tokenCookie(token, event) },
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
