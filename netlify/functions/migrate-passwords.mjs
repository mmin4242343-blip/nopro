import bcrypt from 'bcryptjs';
import { supabase } from './_shared/supabase.mjs';
import { requireAdmin, ok, err, options } from './_shared/auth.mjs';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    requireAdmin(event);

    const { data: companies, error: dbErr } = await supabase
      .from('companies')
      .select('id, email, password_hash, password_plain');

    if (dbErr) return err(500, '서버 오류가 발생했습니다', event);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const c of (companies || [])) {
      // 이미 bcrypt 해시가 있으면 스킵
      if (c.password_hash && c.password_hash.startsWith('$2')) {
        skipped++;
        continue;
      }

      // password_plain이 있으면 bcrypt로 변환
      if (c.password_plain) {
        try {
          const newHash = await bcrypt.hash(c.password_plain, 12);
          await supabase
            .from('companies')
            .update({ password_hash: newHash, password_plain: null })
            .eq('id', c.id);
          migrated++;
        } catch (e) {
          failed++;
        }
        continue;
      }

      // SHA-256 해시만 있는 경우 - 사용자가 다음 로그인 시 자동 업그레이드됨
      skipped++;
    }

    // 관리자 비밀번호 해시 생성 안내
    const body = event.body ? JSON.parse(event.body) : {};
    let adminHashResult = null;
    if (body.adminPassword) {
      adminHashResult = await bcrypt.hash(body.adminPassword, 12);
    }

    return ok({
      total: (companies || []).length,
      migrated,
      skipped,
      failed,
      adminHash: adminHashResult,
      message: adminHashResult
        ? 'ADMIN_PASSWORD_HASH 환경변수를 이 값으로 설정하세요: ' + adminHashResult
        : '관리자 비밀번호를 bcrypt로 변환하려면 body에 adminPassword를 포함하세요'
    }, event);

  } catch (e) {
    if (e.message.includes('관리자')) return err(403, '관리자 권한이 필요합니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
