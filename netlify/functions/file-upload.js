import { supabase } from './_shared/supabase.js';
import { verifyToken, ok, err, options } from './_shared/auth.js';

const BUCKET = 'nopro-files';
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  try {
    await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 10485760
    });
  } catch (e) {
    // bucket already exists - fine
  }
  bucketReady = true;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed', event);

  try {
    const decoded = verifyToken(event);
    if (decoded.role === 'admin') return err(403, '관리자는 파일 업로드 불가', event);
    const companyId = decoded.companyId;

    const body = JSON.parse(event.body);
    const { fileName, fileData, fileType, category, categoryId } = body;

    if (!fileName || !fileData || !category) {
      return err(400, '필수 파라미터 누락', event);
    }

    const base64Data = fileData.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > MAX_SIZE) {
      return err(413, '파일 크기가 5MB를 초과합니다', event);
    }

    await ensureBucket();

    const timestamp = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
    const path = `${companyId}/${category}/${categoryId || 'general'}/${timestamp}_${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: fileType || 'application/octet-stream',
        upsert: false
      });

    if (uploadErr) {
      console.error('Upload error:', uploadErr);
      return err(500, '파일 업로드 실패: ' + uploadErr.message, event);
    }

    return ok({ path, fileName: safeName, size: buffer.length }, event);

  } catch (e) {
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    console.error('File upload error:', e);
    return err(500, '서버 오류가 발생했습니다', event);
  }
};
