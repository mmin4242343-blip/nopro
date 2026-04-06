import bcrypt from 'bcryptjs';
import { supabase } from './_shared/supabase.mjs';
import { signToken, ok, err, options } from './_shared/auth.mjs';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

  try {
    const { email, password } = JSON.parse(event.body);
    if (!email || !password) return err(400, '이메일과 비밀번호를 입력해주세요');

    // 관리자 로그인
    if (email === process.env.ADMIN_EMAIL) {
      const adminHash = process.env.ADMIN_PASSWORD_HASH;
      // bcrypt 해시 비교
      if (adminHash && adminHash.startsWith('$2')) {
        try {
          if (await bcrypt.compare(password, adminHash)) {
            const token = signToken({ email, role: 'admin' });
            return ok({ token, session: { email, role: 'admin' } });
          }
        } catch(e) {}
      }
      // SHA-256 비교 (마이그레이션 전 호환)
      const sha = await sha256(password);
      if (adminHash && sha === adminHash) {
        const token = signToken({ email, role: 'admin' });
        return ok({ token, session: { email, role: 'admin' } });
      }
      return err(401, '비밀번호가 올바르지 않습니다');
    }

    // 일반 사용자 로그인
    const { data: rows, error: dbErr } = await supabase
      .from('companies')
      .select('*')
      .eq('email', email);

    if (dbErr) return err(500, 'DB 오류: ' + dbErr.message);
    if (!rows || rows.length === 0) return err(401, '등록되지 않은 이메일입니다');

    const company = rows[0];

    // bcrypt 해시 비교 시도
    let passwordMatch = false;
    if (company.password_hash) {
      if (company.password_hash.startsWith('$2')) {
        // bcrypt 해시
        passwordMatch = await bcrypt.compare(password, company.password_hash);
      } else {
        // SHA-256 해시 (마이그레이션 전 호환)
        const sha = await sha256(password);
        passwordMatch = (sha === company.password_hash);
        // 성공하면 bcrypt로 업그레이드
        if (passwordMatch) {
          const newHash = await bcrypt.hash(password, 12);
          await supabase.from('companies').update({ password_hash: newHash, password_plain: null }).eq('id', company.id);
        }
      }
    }

    // password_plain 폴백 (마이그레이션 전)
    if (!passwordMatch && company.password_plain) {
      passwordMatch = (password === company.password_plain);
      if (passwordMatch) {
        const newHash = await bcrypt.hash(password, 12);
        await supabase.from('companies').update({ password_hash: newHash, password_plain: null }).eq('id', company.id);
      }
    }

    if (!passwordMatch) return err(401, '비밀번호가 올바르지 않습니다');

    const token = signToken({
      companyId: company.id,
      email: company.email,
      role: 'user'
    });

    return ok({
      token,
      session: {
        email: company.email,
        company: company.company_name,
        name: company.manager_name,
        role: 'user',
        companyId: company.id
      }
    });

  } catch (e) {
    return err(500, e.message);
  }
}

async function sha256(text) {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(text).digest('hex');
}
