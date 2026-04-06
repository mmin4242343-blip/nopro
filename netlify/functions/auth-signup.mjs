import bcrypt from 'bcryptjs';
import { supabase } from './_shared/supabase.mjs';
import { signToken, ok, err, options } from './_shared/auth.mjs';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    const { company, name, phone, email, password, size, addr } = JSON.parse(event.body);

    if (!company || !name || !phone || !email || !password) {
      return err(400, '필수 항목을 모두 입력해주세요', event);
    }
    if (password.length < 8) {
      return err(400, '비밀번호는 8자 이상이어야 합니다', event);
    }

    // 이메일 중복 체크
    const { data: existing } = await supabase
      .from('companies')
      .select('id')
      .eq('email', email);

    if (existing && existing.length > 0) {
      return err(409, '이미 등록된 이메일입니다', event);
    }

    // bcrypt 해싱 (솔트 자동 포함, 12라운드)
    const passwordHash = await bcrypt.hash(password, 12);

    const { data: result, error: dbErr } = await supabase
      .from('companies')
      .insert({
        company_name: company,
        manager_name: name,
        phone,
        email,
        password_hash: passwordHash,
        // password_plain 저장하지 않음
        size: size || '50이하',
        address: addr || '',
        join_date: new Date().toISOString().slice(0, 10),
        status: 'active'
      })
      .select();

    if (dbErr) return err(500, '서버 오류가 발생했습니다', event);

    const newCompany = result[0];
    const token = signToken({
      companyId: newCompany.id,
      email: newCompany.email,
      role: 'user'
    });

    return ok({
      token,
      session: {
        email: newCompany.email,
        company: newCompany.company_name,
        name: newCompany.manager_name,
        role: 'user',
        companyId: newCompany.id
      }
    }, event);

  } catch (e) {
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
