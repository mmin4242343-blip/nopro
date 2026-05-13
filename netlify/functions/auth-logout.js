import { supabase } from './_shared/supabase.js';
import { verifyToken, logoutResponse, options } from './_shared/auth.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);

  // 🔒 단일 로그인 — 명시적 로그아웃 시 DB의 active_session_id 클리어
  // (다른 곳에서 즉시 로그인 가능하도록)
  // 토큰 검증 실패해도 쿠키는 클리어 — 토큰 없는 사용자도 깔끔하게 로그아웃되도록.
  try {
    const decoded = verifyToken(event);
    if (decoded.role === 'user' && decoded.companyId && decoded.sid) {
      // sid 일치할 때만 클리어 (다른 세션의 로그아웃이 본인 세션을 끄지 못하도록)
      await supabase
        .from('companies')
        .update({ active_session_id: null, active_session_at: null })
        .eq('id', decoded.companyId)
        .eq('active_session_id', decoded.sid);
    } else if (decoded.role === 'user' && decoded.companyId && !decoded.sid) {
      // 레거시 JWT (sid 없음): 본인 회사의 active_session 클리어
      await supabase
        .from('companies')
        .update({ active_session_id: null, active_session_at: null })
        .eq('id', decoded.companyId);
    }
  } catch (e) {
    // 토큰 검증 실패해도 로그아웃은 정상 처리 (쿠키만 클리어)
  }

  return logoutResponse(event);
}
