import bcrypt from 'bcryptjs';
import { supabase } from './_shared/supabase.js';
import { verifyToken, okWithCookie, signToken, err, options } from './_shared/auth.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    // 요청 본문 크기 제한 (1MB)
    if (event.body && event.body.length > 1024 * 1024) {
      return err(413, '요청 데이터가 너무 큽니다', event);
    }

    const decoded = verifyToken(event);
    if (decoded.role !== 'user') return err(403, '사용자 권한이 필요합니다', event);

    let parsed;
    try { parsed = JSON.parse(event.body); } catch { return err(400, '잘못된 요청 형식입니다', event); }
    const { currentPassword, company, name, phone, email, password } = parsed;
    if (!currentPassword) return err(400, '현재 비밀번호를 입력해주세요', event);

    // 현재 회사 정보 조회
    const { data: rows, error: dbErr } = await supabase
      .from('companies')
      .select('id, password_hash, email')
      .eq('id', decoded.companyId);

    if (dbErr || !rows || rows.length === 0) return err(500, '회사 정보를 찾을 수 없습니다', event);
    const comp = rows[0];

    // 현재 비밀번호 검증
    if (!comp.password_hash || !comp.password_hash.startsWith('$2')) {
      return err(500, '비밀번호 설정 오류', event);
    }
    const match = await bcrypt.compare(currentPassword, comp.password_hash);
    if (!match) return err(401, '현재 비밀번호가 올바르지 않습니다', event);

    // 업데이트할 필드 구성
    const updates = {};
    if (company) updates.company_name = company;
    if (name) updates.manager_name = name;
    if (phone) updates.phone = phone;
    if (email && email !== comp.email) {
      // 이메일 중복 체크
      const { data: existing } = await supabase
        .from('companies')
        .select('id')
        .eq('email', email)
        .neq('id', comp.id);
      if (existing && existing.length > 0) {
        return err(409, '이미 사용 중인 이메일입니다', event);
      }
      updates.email = email;
    }
    if (password) {
      if (password.length < 8) return err(400, '비밀번호는 8자 이상이어야 합니다', event);
      if (password.length > 72) return err(400, '비밀번호는 72자 이내여야 합니다', event);
      updates.password_hash = await bcrypt.hash(password, 12);
    }

    if (Object.keys(updates).length === 0) {
      return err(400, '변경할 항목이 없습니다', event);
    }

    const { error: updateErr } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', comp.id);

    if (updateErr) return err(500, '정보 수정에 실패했습니다', event);

    // 이메일이 변경된 경우 새 토큰 발급
    const newEmail = updates.email || comp.email;
    const token = signToken({ companyId: comp.id, email: newEmail, role: 'user' });

    return okWithCookie({ success: true }, token, event);

  } catch (e) {
    if (e.message === '인증 토큰이 없습니다') return err(401, e.message, event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
};
