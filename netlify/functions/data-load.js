import { supabase } from './_shared/supabase.js';
import { verifyToken, ok, err, options } from './_shared/auth.js';
import { decryptEmps } from './_shared/crypto.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    const decoded = verifyToken(event);
    if (decoded.role === 'admin') return err(403, '관리자는 이 엔드포인트 사용 불가', event);
    const companyId = decoded.companyId;

    let body = {};
    try { if (event.body) body = JSON.parse(event.body); } catch { return err(400, '잘못된 요청 형식입니다', event); }
    const key = body.key;
    const keys = body.keys; // 다중 키 fetch (폴링 경량화용)

    // data-save와 동일한 키 화이트리스트 적용
    const ALLOWED_KEYS = ['emps','pol','bk','tbk','rec','bonus','allow','tax','leave_settings','leave_overrides','folders','safety','pol_snapshots','pay_snapshots','bk_snapshots','company_info','custom_docs','saved_forms'];
    if (key && !ALLOWED_KEYS.includes(key)) {
      return err(400, '허용되지 않은 데이터 키입니다', event);
    }
    // keys 배열도 동일 화이트리스트 검증 (조용히 필터링하지 않고 잘못된 키는 거부)
    let filteredKeys = null;
    if (Array.isArray(keys)) {
      if (keys.length === 0) return err(400, 'keys 배열이 비어있습니다', event);
      if (keys.length > ALLOWED_KEYS.length) return err(400, '허용 범위를 초과한 keys 요청입니다', event);
      for (const k of keys) {
        if (typeof k !== 'string' || !ALLOWED_KEYS.includes(k)) {
          return err(400, '허용되지 않은 데이터 키입니다', event);
        }
      }
      filteredKeys = keys;
    }

    let query = supabase
      .from('company_data')
      .select('data_key, data_value, updated_at')
      .eq('company_id', companyId);

    if (key) {
      query = query.eq('data_key', key);
    } else if (filteredKeys) {
      query = query.in('data_key', filteredKeys);
    }

    const { data: rows, error: dbErr } = await query;
    if (dbErr) return err(500, '서버 오류가 발생했습니다', event);

    const map = {};
    const versions = {};  // 낙관적 잠금용: 각 키의 서버 updated_at
    (rows || []).forEach(r => {
      try { map[r.data_key] = JSON.parse(r.data_value); } catch (e) {}
      versions[r.data_key] = r.updated_at;
    });

    // emps 데이터의 주민번호 뒷자리 복호화
    if (map.emps) {
      map.emps = decryptEmps(map.emps);
    }

    // 클라이언트가 _versions로 인식 (data_key는 ALLOWED_KEYS에만 있으므로 충돌 없음)
    map._versions = versions;
    // 🏷️ 빌드 버전 — 클라가 옛 캐시된 JS 사용 중이면 감지 후 새로고침 안내
    // 배포 시 이 fallback 값을 js/app.js의 CLIENT_BUILD와 동일하게 갱신 필수
    // (Netlify env var SERVER_BUILD가 있으면 그것이 우선, 없으면 fallback 사용)
    map._serverBuild = process.env.SERVER_BUILD || '2026-05-07-14';

    return ok(map, event);

  } catch (e) {
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
