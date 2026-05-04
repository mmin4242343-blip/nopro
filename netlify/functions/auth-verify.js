import { randomUUID } from 'crypto';
import { supabase } from './_shared/supabase.js';
import { verifyToken, signToken, ok, okWithCookie, err, options, cors } from './_shared/auth.js';

// 단일 로그인 idle timeout — auth-login.js와 동일 (1시간)
const SESSION_IDLE_MS = 60 * 60 * 1000;

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
    // 관리자 — 단일 세션 정책 면제
    if (decoded.role === 'admin') {
      if (shouldRefresh(decoded)) {
        const newToken = signToken({ email: decoded.email, role: 'admin' });
        return okWithCookie({ valid: true, session: { email: decoded.email, role: 'admin' } }, newToken, event);
      }
      return ok({ valid: true, session: { email: decoded.email, role: 'admin' } }, event);
    }

    // 일반 사용자 - 회사 정보 + 활성 세션 확인
    const { data: rows, error: dbErr } = await supabase
      .from('companies')
      .select('id, company_name, manager_name, email, status, active_session_id, active_session_at')
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

    // 🔒 단일 로그인 차단 — 토큰의 sid vs DB의 active_session_id 비교
    const tokenSid = decoded.sid || null;
    const dbSid = company.active_session_id || null;
    const dbActiveAt = company.active_session_at ? new Date(company.active_session_at).getTime() : 0;
    const dbIdleExpired = dbSid && (Date.now() - dbActiveAt >= SESSION_IDLE_MS);

    let assignedSid = null;  // 새로 발급한 sid (있으면 새 JWT 발행)

    if (tokenSid && dbSid && tokenSid === dbSid) {
      // 정상 — heartbeat 갱신 (best-effort, 실패해도 세션 유지)
      try {
        await supabase
          .from('companies')
          .update({ active_session_at: new Date().toISOString() })
          .eq('id', decoded.companyId)
          .eq('active_session_id', tokenSid);
      } catch (e) { /* 갱신 실패는 치명적이지 않음 */ }
    } else if (tokenSid && dbSid && tokenSid !== dbSid) {
      // 다른 곳에서 새 로그인됨 → 강제 종료
      return {
        statusCode: 401,
        headers: cors(event),
        body: JSON.stringify({ error: '다른 기기에서 로그인되어 종료됩니다', reason: 'session_replaced' })
      };
    } else if (!tokenSid && !dbSid) {
      // 레거시 JWT (sid 없음) + DB도 비어있음 → 무중단 전환:
      // 새 sid 발급 + DB에 채움 + 새 JWT 발급
      assignedSid = randomUUID();
      const { error: updErr } = await supabase
        .from('companies')
        .update({ active_session_id: assignedSid, active_session_at: new Date().toISOString() })
        .eq('id', decoded.companyId)
        .is('active_session_id', null);  // 동시성 안전: 다른 요청이 먼저 채웠으면 실패
      if (updErr) {
        console.warn('auth-verify: 레거시 sid 발급 실패 (다른 요청이 먼저 채웠을 수 있음)', updErr);
        // 다시 조회해서 누가 가져갔는지 확인
        const { data: r2 } = await supabase
          .from('companies').select('active_session_id').eq('id', decoded.companyId).maybeSingle();
        if (r2 && r2.active_session_id) {
          // 다른 요청이 먼저 가져감 → 이 사용자는 session_replaced
          return {
            statusCode: 401,
            headers: cors(event),
            body: JSON.stringify({ error: '다른 기기에서 로그인되어 종료됩니다', reason: 'session_replaced' })
          };
        }
        // 그래도 비었으면 silent fail — assignedSid는 남기고 다음 요청에 재시도
      }
    } else if (!tokenSid && dbSid && dbIdleExpired) {
      // 레거시 JWT + DB 세션 만료 → 새 sid 발급 + DB 갱신 (옛 세션 인계)
      assignedSid = randomUUID();
      await supabase
        .from('companies')
        .update({ active_session_id: assignedSid, active_session_at: new Date().toISOString() })
        .eq('id', decoded.companyId);
    } else if (!tokenSid && dbSid && !dbIdleExpired) {
      // 레거시 JWT + DB에 다른 활성 세션 있음 → session_replaced
      return {
        statusCode: 401,
        headers: cors(event),
        body: JSON.stringify({ error: '다른 기기에서 로그인되어 종료됩니다', reason: 'session_replaced' })
      };
    } else if (tokenSid && !dbSid) {
      // 토큰엔 sid 있는데 DB는 비어있음 → 명시적 로그아웃됐거나 비상 클리어됨
      // 안전하게 session_replaced 처리 (재로그인 유도)
      return {
        statusCode: 401,
        headers: cors(event),
        body: JSON.stringify({ error: '세션이 종료되었습니다. 다시 로그인해주세요.', reason: 'session_replaced' })
      };
    }

    const session = {
      email: company.email,
      company: company.company_name,
      name: company.manager_name,
      role: 'user',
      companyId: company.id
    };

    // 새 sid 발급했거나 만료 임박이면 새 JWT 발행
    const finalSid = assignedSid || tokenSid;
    if (assignedSid || shouldRefresh(decoded)) {
      const newToken = signToken({ companyId: company.id, email: company.email, role: 'user', sid: finalSid });
      return okWithCookie({ valid: true, session }, newToken, event);
    }

    return ok({ valid: true, session }, event);

  } catch (e) {
    console.error('auth-verify: unexpected error', e);
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
