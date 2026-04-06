import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET;
const ALLOWED_ORIGINS = [
  'https://noprohr.netlify.app',
  'http://localhost:8888'
];

export function signToken(payload) {
  return jwt.sign(payload, SECRET(), { expiresIn: '2h' });
}

export function verifyToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace('Bearer ', '');
  if (!token) throw new Error('인증 토큰이 없습니다');
  return jwt.verify(token, SECRET(), { algorithms: ['HS256'] });
}

export function requireAdmin(event) {
  const decoded = verifyToken(event);
  if (decoded.role !== 'admin') throw new Error('관리자 권한이 필요합니다');
  return decoded;
}

export function cors(event) {
  const origin = event?.headers?.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json'
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
