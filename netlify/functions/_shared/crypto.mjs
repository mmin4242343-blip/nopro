import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const getKey = () => Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

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
