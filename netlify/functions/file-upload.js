import { supabase } from './_shared/supabase.js';
import { verifyToken, ok, err, options } from './_shared/auth.js';

const BUCKET = 'nopro-files';
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXTENSIONS = new Set([
  'jpg','jpeg','png','gif','webp','bmp','svg',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'txt','csv','hwp','hwpx','zip'
]);

// 🛡️ 확장자 → MIME 화이트리스트. 클라가 보낸 fileType은 신뢰 X (HTML/JS 등으로 위장 차단).
// SVG/HWP/ZIP은 브라우저에서 인라인 렌더링 시 XSS 위험 → 강제 octet-stream(다운로드만).
const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv',
  svg: 'application/octet-stream',
  hwp: 'application/octet-stream', hwpx: 'application/octet-stream',
  zip: 'application/octet-stream',
};

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  try {
    await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 5242880
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

    // 파일 확장자 화이트리스트 검증
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return err(400, `허용되지 않는 파일 형식입니다 (.${ext})`, event);
    }

    // category 검증
    const ALLOWED_CATEGORIES = ['safety', 'folder'];
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return err(400, '유효하지 않은 카테고리입니다', event);
    }

    const base64Data = fileData.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > MAX_SIZE) {
      return err(413, '파일 크기가 5MB를 초과합니다', event);
    }

    await ensureBucket();

    const timestamp = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
    // 🛡️ H-1: categoryId path traversal 차단 — `../`, `?`, `&` 등 모두 `_`로 normalize.
    // 정상 패턴(folderId 숫자, `${empId}_${YYYY}-${MM}` 등)은 영향 없음.
    const safeCategoryId = (String(categoryId || 'general').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)) || 'general';
    const path = `${companyId}/${category}/${safeCategoryId}/${timestamp}_${safeName}`;

    // 🛡️ H-2: 확장자 기반 MIME 강제 (클라가 보낸 fileType 무시) — HTML/JS 위장 업로드 차단.
    const safeContentType = MIME_BY_EXT[ext] || 'application/octet-stream';

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: safeContentType,
        upsert: false
      });

    if (uploadErr) {
      console.error('file-upload: storage upload failed');
      return err(500, '파일 업로드 실패', event);
    }

    return ok({ path, fileName: safeName, size: buffer.length }, event);

  } catch (e) {
    if (e.message.includes('토큰') || e.message.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    console.error('file-upload: unexpected error');
    return err(500, '서버 오류가 발생했습니다', event);
  }
};
