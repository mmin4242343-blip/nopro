// PII (개인정보) 스크럽 — 노무 데이터 특수성으로 모니터링 로그에 절대 들어가면 안 되는 패턴 마스킹
//
// 스크럽 대상:
//   1) 주민번호 (예: 901231-1234567 → 901231-*******)
//   2) 사업자등록번호 (123-45-67890 → ***-**-*****)
//   3) 전화번호 (010-1234-5678 → 010-****-****)
//   4) 이메일 일부 (sangmin@naver.com → s****n@naver.com)
//   5) AES 암호화 prefix (ENC: 시작 문자열)
//
// 사용 위치: 클라이언트 reportError 직전, 서버 logError 직전 (이중 방어)

// 주민번호: 6자리-7자리 또는 13자리 연속
const RRN_PATTERN = /(\d{6})[-\s]?(\d{7})/g;

// 사업자등록번호: 3-2-5 또는 10자리 연속
const BIZ_PATTERN = /(\d{3})[-\s]?(\d{2})[-\s]?(\d{5})/g;

// 전화번호: 010/02/031 등 + 숫자
const PHONE_PATTERN = /(01[016789]|0[2-6]\d?)[-\s]?(\d{3,4})[-\s]?(\d{4})/g;

// 이메일
const EMAIL_PATTERN = /([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

// AES 암호화 데이터 (rrnBack)
const ENC_PATTERN = /ENC:[A-Za-z0-9+/=]{20,}/g;

export function scrubText(s) {
  if (s === null || s === undefined) return s;
  let str = String(s);
  if (!str) return str;

  // 길이 제한 (너무 긴 문자열은 자르고 PII 시도 안 함)
  if (str.length > 4000) str = str.slice(0, 4000) + '...[TRUNCATED]';

  // 주민번호 우선 처리 (사업자번호와 패턴 충돌 방지)
  str = str.replace(RRN_PATTERN, '$1-*******');
  str = str.replace(BIZ_PATTERN, '***-**-*****');
  str = str.replace(PHONE_PATTERN, '$1-****-****');
  str = str.replace(EMAIL_PATTERN, (_, local, domain) => {
    if (local.length <= 2) return local[0] + '*@' + domain;
    return local[0] + '****' + local.slice(-1) + '@' + domain;
  });
  str = str.replace(ENC_PATTERN, 'ENC:[REDACTED]');

  return str;
}

export function scrubObject(obj, depth = 0) {
  if (depth > 4) return '[DEPTH_LIMIT]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return scrubText(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 50).map(v => scrubObject(v, depth + 1));
  if (typeof obj === 'object') {
    const out = {};
    let i = 0;
    for (const k of Object.keys(obj)) {
      if (i++ > 50) { out._more = '...'; break; }
      // 키 이름이 명백히 민감하면 값 자체를 마스킹
      if (/password|pw|hash|token|secret|key|rrn|jumin/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = scrubObject(obj[k], depth + 1);
      }
    }
    return out;
  }
  return String(obj);
}

// 빠른 IP 해시 (가벼운 식별자, 역산 불가)
export function hashIp(ip) {
  if (!ip) return null;
  let h = 5381;
  const s = String(ip);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}
