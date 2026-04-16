import bcrypt from 'bcryptjs';
import { supabase } from './_shared/supabase.js';
import { signToken, okWithCookie, err, options, cors } from './_shared/auth.js';
import { checkRateLimit, recordLoginAttempt, clearLoginAttempts } from './_shared/rate-limit.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    let parsed;
    try { parsed = JSON.parse(event.body); } catch { return err(400, '잘못된 요청 형식입니다', event); }
    const { email, password } = parsed;
    if (!email || !password) return err(400, '이메일과 비밀번호를 입력해주세요', event);

    // Rate limiting 체크 (이메일 기반, IP는 로그용으로만 기록)
    const rawIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    // X-Forwarded-For 첫 번째 값만 사용 (프록시 체인에서 원본 IP)
    const clientIp = rawIp.split(',')[0].trim();
    const isAdmin = email === process.env.ADMIN_EMAIL;
    const rateCheck = await checkRateLimit(email, clientIp, isAdmin);
    if (!rateCheck.allowed) {
      const wait = Math.ceil((rateCheck.retryAfter || 60) / 60);
      return {
        statusCode: 429,
        headers: { ...cors(event), 'Retry-After': String(rateCheck.retryAfter || 60) },
        body: JSON.stringify({ error: `로그인 시도가 너무 많습니다. ${wait}분 후에 다시 시도해주세요.` })
      };
    }

    // 관리자 로그인 (bcrypt only)
    if (email === process.env.ADMIN_EMAIL) {
      const adminHash = process.env.ADMIN_PASSWORD_HASH;
      if (!adminHash || !adminHash.startsWith('$2')) {
        return err(500, '관리자 비밀번호 설정 오류', event);
      }
      const match = await bcrypt.compare(password, adminHash);
      if (!match) {
        await recordLoginAttempt(email, clientIp);
        return err(401, '이메일 또는 비밀번호가 올바르지 않습니다', event);
      }

      await clearLoginAttempts(email);
      const token = signToken({ email, role: 'admin' });
      return okWithCookie({ session: { email, role: 'admin' } }, token, event);
    }

    // 일반 사용자 로그인
    const { data: rows, error: dbErr } = await supabase
      .from('companies')
      .select('id, email, company_name, manager_name, password_hash')
      .eq('email', email);

    if (dbErr) return err(500, '서버 오류가 발생했습니다', event);
    if (!rows || rows.length === 0) {
      await recordLoginAttempt(email, clientIp);
      return err(401, '이메일 또는 비밀번호가 올바르지 않습니다', event);
    }

    const company = rows[0];

    // bcrypt 해시 비교 (bcrypt only)
    if (!company.password_hash || !company.password_hash.startsWith('$2')) {
      return err(401, '비밀번호 마이그레이션이 필요합니다. 관리자에게 문의하세요.', event);
    }

    const passwordMatch = await bcrypt.compare(password, company.password_hash);
    if (!passwordMatch) {
      await recordLoginAttempt(email, clientIp);
      return err(401, '이메일 또는 비밀번호가 올바르지 않습니다', event);
    }

    // 로그인 성공 → 시도 기록 초기화
    await clearLoginAttempts(email);

    const token = signToken({
      companyId: company.id,
      email: company.email,
      role: 'user'
    });

    return okWithCookie({
      session: {
        email: company.email,
        company: company.company_name,
        name: company.manager_name,
        role: 'user',
        companyId: company.id
      }
    }, token, event);

  } catch (e) {
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
