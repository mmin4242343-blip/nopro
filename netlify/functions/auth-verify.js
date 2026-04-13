import { supabase } from './_shared/supabase.js';
import { verifyToken, signToken, ok, okWithCookie, err, options } from './_shared/auth.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    const decoded = verifyToken(event);

    // 관리자
    if (decoded.role === 'admin') {
      if (shouldRefresh(decoded)) {
        const newToken = signToken({ email: decoded.email, role: 'admin' });
        return okWithCookie({ valid: true, session: { email: decoded.email, role: 'admin' } }, newToken, event);
      }
      return ok({ valid: true, session: { email: decoded.email, role: 'admin' } }, event);
    }

    // 일반 사용자 - 회사 정보 확인
    const { data: rows } = await supabase
      .from('companies')
      .select('id, company_name, manager_name, email, status')
      .eq('id', decoded.companyId);

    if (!rows || rows.length === 0) return err(401, '회사 정보를 찾을 수 없습니다', event);
    if (rows[0].status !== 'active') return err(401, '비활성 계정입니다', event);

    const company = rows[0];
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
    return err(401, '세션이 만료되었습니다', event);
  }
}

function shouldRefresh(decoded) {
  if (!decoded.exp) return false;
  const remaining = decoded.exp - Math.floor(Date.now() / 1000);
  return remaining < 21600; // 만료 6시간 전부터 갱신
}
