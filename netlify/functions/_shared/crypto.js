import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const getKey = () => {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY 환경변수가 설정되지 않았습니다');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY는 32바이트(64자 hex)여야 합니다');
  return key;
};

export function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let enc = cipher.update(String(plaintext), 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return 'ENC:' + iv.toString('hex') + ':' + tag + ':' + enc;
}

export function decrypt(ciphertext) {
  if (!ciphertext || !String(ciphertext).startsWith('ENC:')) return ciphertext;
  const key = getKey();
  const parts = String(ciphertext).slice(4).split(':');
  if (parts.length !== 3) return ciphertext;
  const [ivHex, tagHex, enc] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let dec = decipher.update(enc, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

export function encryptEmps(emps) {
  if (!Array.isArray(emps)) return emps;
  return emps.map(e => ({
    ...e,
    rrnBack: e.rrnBack ? encrypt(e.rrnBack) : e.rrnBack
  }));
}

export function decryptEmps(emps) {
  if (!Array.isArray(emps)) return emps;
  return emps.map(e => ({
    ...e,
    rrnBack: e.rrnBack ? decrypt(e.rrnBack) : e.rrnBack
  }));
}
