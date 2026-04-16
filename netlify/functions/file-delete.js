import { supabase } from './_shared/supabase.js';
import { verifyToken, ok, err, options } from './_shared/auth.js';

const BUCKET = 'nopro-files';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    const decoded = verifyToken(event);
    if (decoded.role === 'admin') return err(403, '관리자는 파일 삭제 불가', event);
    const companyId = decoded.companyId;

    const body = JSON.parse(event.body);
    const paths = body.paths || (body.path ? [body.path] : []);

    if (!paths.length) return err(400, '경로가 필요합니다', event);

    const validPaths = paths.filter(p => p.startsWith(`${companyId}/`));
    if (validPaths.length !== paths.length) {
      return err(403, '권한이 없는 파일입니다', event);
    }

    const { error: delErr } = await supabase.storage
      .from(BUCKET)
      .remove(validPaths);

    if (delErr) {
      console.error('file-delete: storage operation failed');
      return err(500, '파일 삭제 실패', event);
    }

    return ok({ success: true }, event);

  } catch (e) {
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
};
