import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { supabase } from './_shared/supabase.js';
import { signToken, okWithCookie, err, options, cors } from './_shared/auth.js';
import { checkRateLimit, recordLoginAttempt, clearLoginAttempts } from './_shared/rate-limit.js';

// 단일 로그인 idle timeout — 1시간 (마지막 활동 후 1시간 지나면 다른 곳에서 새 로그인 허용)
const SESSION_IDLE_MS = 60 * 60 * 1000;

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

    // 관리자 로그인 (bcrypt only) — 단일 세션 정책 면제 (개발자 편의, 여러 곳 동시 OK)
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
      .select('id, email, company_name, manager_name, password_hash, active_session_id, active_session_at')
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

    // 🔒 단일 로그인 차단 — 활성 세션이 있고 idle timeout 이내면 새 로그인 거부
    const activeAt = company.active_session_at ? new Date(company.active_session_at).getTime() : 0;
    const isActiveSession = company.active_session_id && (Date.now() - activeAt < SESSION_IDLE_MS);
    if (isActiveSession) {
      const idleMin = Math.floor((Date.now() - activeAt) / 60000);
      const remainMin = Math.max(0, Math.ceil((SESSION_IDLE_MS - (Date.now() - activeAt)) / 60000));
      // 비밀번호는 맞췄으니 로그인 시도 카운트는 초기화 (Rate Limit 정상 사용자 보호)
      await clearLoginAttempts(email);
      return {
        statusCode: 409,
        headers: cors(event),
        body: JSON.stringify({
          error: '이미 다른 기기/브라우저에서 사용 중입니다',
          reason: 'session_active',
          idle_minutes: idleMin,
          retry_after_minutes: remainMin
        })
      };
    }

    // 로그인 성공 → 새 세션 ID 발급 + DB 업데이트 + Rate Limit 초기화
    const sid = randomUUID();
    const { error: updErr } = await supabase
      .from('companies')
      .update({ active_session_id: sid, active_session_at: new Date().toISOString() })
      .eq('id', company.id);
    if (updErr) {
      console.error('auth-login: active_session 업데이트 실패', updErr);
      return err(500, '세션 등록 실패. 잠시 후 재시도해주세요.', event);
    }

    await clearLoginAttempts(email);

    const token = signToken({
      companyId: company.id,
      email: company.email,
      role: 'user',
      sid
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
