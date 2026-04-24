import { supabase } from './_shared/supabase.js';
import { verifyToken, signToken, ok, okWithCookie, err, options, cors } from './_shared/auth.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  // 쿠키 존재 여부 먼저 확인
  const rawCookie = event.headers.cookie || event.headers.Cookie || '';
  const hasCookie = rawCookie.includes('nopro_token=');

  let decoded;
  try {
    decoded = verifyToken(event);
  } catch (e) {
    // 토큰 검증 실패 — 상세 원인 전달
    const reason = !hasCookie
      ? 'cookie_missing'
      : e.message.includes('expired') ? 'token_expired'
      : e.message.includes('invalid') ? 'token_invalid'
      : 'token_error';
    console.log(`auth-verify: ${reason}`);
    return {
      statusCode: 401,
      headers: cors(event),
      body: JSON.stringify({ error: '세션이 만료되었습니다', reason })
    };
  }

  try {
    // 관리자
    if (decoded.role === 'admin') {
      if (shouldRefresh(decoded)) {
        const newToken = signToken({ email: decoded.email, role: 'admin' });
        return okWithCookie({ valid: true, session: { email: decoded.email, role: 'admin' } }, newToken, event);
      }
      return ok({ valid: true, session: { email: decoded.email, role: 'admin' } }, event);
    }

    // 일반 사용자 - 회사 정보 확인
    const { data: rows, error: dbErr } = await supabase
      .from('companies')
      .select('id, company_name, manager_name, email, status')
      .eq('id', decoded.companyId);

    if (dbErr) {
      console.error('auth-verify: DB query failed');
      // DB 오류는 401이 아닌 500 (세션 문제가 아님)
      return err(500, '서버 오류가 발생했습니다', event);
    }

    if (!rows || rows.length === 0) return err(401, '회사 정보를 찾을 수 없습니다', event);
    if (rows[0].status !== 'active') return err(401, '비활성 계정입니다', event);

    const company = rows[0];

    // 비밀번호 변경 후 발급된 토큰인지 확인 (이전 토큰 무효화)
    if (decoded.iat) {
      try {
        const { data: tva } = await supabase
          .from('company_data')
          .select('data_value')
          .eq('company_id', decoded.companyId)
          .eq('data_key', '_token_valid_after')
          .maybeSingle();
        if (tva) {
          const validAfter = JSON.parse(tva.data_value);
          if (decoded.iat < validAfter) {
            return err(401, '비밀번호가 변경되어 재로그인이 필요합니다', event);
          }
        }
      } catch { /* 검증 실패해도 기존 흐름 유지 */ }
    }

    const session = {
      email: company.email,
      company: company.company_name,
      name: company.manager_name,
      role: 'user',
      companyId: company.id
    };

    if (shouldRefresh(decoded)) {
      const newToken = signToken({ companyId: company.id, email: company.email, role: 'user' });
      return okWithCookie({ valid: true, session }, newToken, event);
    }

    return ok({ valid: true, session }, event);

  } catch (e) {
    console.error('auth-verify: unexpected error');
    return err(500, '서버 오류가 발생했습니다', event);
  }
}

function shouldRefresh(decoded) {
  if (!decoded.exp) return false;
  const remaining = decoded.exp - Math.floor(Date.now() / 1000);
  // 만료 3.5일 전부터 갱신 (토큰 수명 7d 기준 — 절반 이상 쓰이면 새 7일 발급)
  // 활동 기반 갱신과 결합되면 일주일에 한 번이라도 쓰면 사실상 영구 로그인
  return remaining < 3.5 * 24 * 3600;
}
