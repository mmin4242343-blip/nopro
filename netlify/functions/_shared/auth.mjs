import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET;

export function signToken(payload) {
  return jwt.sign(payload, SECRET(), { expiresIn: '24h' });
}

export function verifyToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace('Bearer ', '');
  if (!token) throw new Error('인증 토큰이 없습니다');
  return jwt.verify(token, SECRET());
}

export function requireAdmin(event) {
  const decoded = verifyToken(event);
  if (decoded.role !== 'admin') throw new Error('관리자 권한이 필요합니다');
  return decoded;
}

export function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };
}

export function ok(body) {
  return { statusCode: 200, headers: cors(), body: JSON.stringify(body) };
}

export function err(statusCode, message) {
  return { statusCode, headers: cors(), body: JSON.stringify({ error: message }) };
}

export function options() {
  return { statusCode: 204, headers: cors(), body: '' };
}
