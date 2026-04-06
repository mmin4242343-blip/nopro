import { supabase } from './_shared/supabase.mjs';
import { verifyToken, signToken, ok, err, options } from './_shared/auth.mjs';

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

  try {
    const decoded = verifyToken(event);

    // 관리자
    if (decoded.role === 'admin') {
      // 만료 2시간 이내면 토큰 갱신
      const newToken = shouldRefresh(decoded) ? signToken({ email: decoded.email, role: 'admin' }) : null;
      return ok({ valid: true, session: { email: decoded.email, role: 'admin' }, newToken });
    }

    // 일반 사용자 - 회사 정보 확인
    const { data: rows } = await supabase
      .from('companies')
      .select('id, company_name, manager_name, email, status')
      .eq('id', decoded.companyId);

    if (!rows || rows.length === 0) return err(401, '회사 정보를 찾을 수 없습니다');
    if (rows[0].status !== 'active') return err(401, '비활성 계정입니다');

    const company = rows[0];
    const newToken = shouldRefresh(decoded) ? signToken({ companyId: company.id, email: company.email, role: 'user' }) : null;

    return ok({
      valid: true,
      session: {
        email: company.email,
        company: company.company_name,
        name: company.manager_name,
        role: 'user',
        companyId: company.id
      },
      newToken
    });

  } catch (e) {
    return err(401, '세션이 만료되었습니다');
  }
}

function shouldRefresh(decoded) {
  if (!decoded.exp) return false;
  const remaining = decoded.exp - Math.floor(Date.now() / 1000);
  return remaining < 7200; // 2시간 이내
}
