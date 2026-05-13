import { supabase } from './_shared/supabase.js';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://noprohr.netlify.app,http://localhost:8888').split(',').map(s => s.trim());

// TBM 엔드포인트 Rate Limit (토큰 무차별 대입 방지)
const tbmAttempts = new Map();
const TBM_WINDOW_MS = 60_000; // 1분
const TBM_MAX = 10; // 1분당 10회
function checkTbmRate(key) {
  const now = Date.now();
  const rec = tbmAttempts.get(key);
  if (!rec || now - rec.start > TBM_WINDOW_MS) {
    tbmAttempts.set(key, { count: 1, start: now });
    return true;
  }
  rec.count++;
  return rec.count <= TBM_MAX;
}

function corsHeaders(event) {
  const origin = event?.headers?.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

export const handler = async (event) => {
  const headers = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  try {
    const params = event.queryStringParameters || {};
    let companyId, token, date, empId, eduKey;

    if (event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: '잘못된 요청 형식입니다' }) }; }
      companyId = body.c || params.c;
      token = body.t || params.t;
      date = body.d || params.d;
      empId = body.empId;
      eduKey = body.e || params.e;  // v4: 교육 키 (없으면 옛 모드)
    } else {
      companyId = params.c;
      token = params.t;
      date = params.d;
      eduKey = params.e;
    }

    if (!companyId || !token || !date) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '필수 파라미터가 누락되었습니다 (c, t, d)' }) };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '잘못된 날짜 형식입니다' }) };
    }
    // v4: eduKey 형식 검증 (영문/숫자/언더스코어만)
    if (eduKey && !/^[a-zA-Z0-9_]+$/.test(eduKey)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '잘못된 교육 키 형식입니다' }) };
    }

    // Load safety + safety_records (v4 호환)
    const { data: rows, error: dbErr } = await supabase
      .from('company_data')
      .select('data_key, data_value')
      .eq('company_id', companyId)
      .in('data_key', ['safety', 'safety_records']);

    if (dbErr) {
      console.error('tbm-sign: DB query failed');
      return { statusCode: 500, headers, body: JSON.stringify({ error: '서버 오류가 발생했습니다' }) };
    }

    let safety = {}, safetyRecords = {};
    (rows || []).forEach(r => {
      try {
        const v = JSON.parse(r.data_value);
        if (r.data_key === 'safety') safety = v || {};
        if (r.data_key === 'safety_records') safetyRecords = v || {};
      } catch {}
    });

    // Rate limit 체크 (토큰 무차별 대입 방지)
    const rateKey = `${companyId}_${date}_${eduKey || 'tbm'}`;
    if (!checkTbmRate(rateKey)) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }) };
    }

    // Verify token — v4 모드: safety_records[date][edu].token / 옛 모드: safety[date+'_token']
    // eduKey 있는 v4 요청도 옛 위치 fallback 허용 (호환성)
    let storedToken;
    let v4Rec = null;
    if (eduKey && safetyRecords[date] && safetyRecords[date][eduKey]) {
      v4Rec = safetyRecords[date][eduKey];
      storedToken = v4Rec.token;
    }
    // v4 토큰 없거나 안 맞으면 옛 위치(safety[date+'_token']) 시도
    if (!storedToken || storedToken !== token) {
      const legacyToken = safety[date + '_token'];
      if (legacyToken === token) storedToken = legacyToken;
    }
    if (storedToken !== token) {
      return { statusCode: 403, headers, body: JSON.stringify({
        error: '유효하지 않은 링크입니다. 관리자에게 새 링크를 요청하세요.'
      })};
    }
    const isV4Mode = !!(v4Rec && v4Rec.token === token);

    // ── GET: 직원 목록 + 서명 현황 로드 ──
    if (event.httpMethod === 'GET') {
      const { data: empsRows } = await supabase
        .from('company_data')
        .select('data_value')
        .eq('company_id', companyId)
        .eq('data_key', 'emps');

      const emps = empsRows && empsRows.length > 0 ? JSON.parse(empsRows[0].data_value) : [];
      const empList = emps
        .filter(e => !e.leave)
        .map(e => ({ id: e.id, name: e.name, nameEn: e.nameEn || '', shift: e.shift || 'day', dept: e.dept || '' }));

      let content, contentEn, signs, eduName, eduLaw;
      if (isV4Mode) {
        // v4: 교육별 데이터
        content = v4Rec.content || '';
        contentEn = v4Rec.content_en || '';
        signs = v4Rec.signs || {};
        // 교육명·법령은 클라이언트 SAFETY_EDU에서 알 수 있지만, 안전을 위해 서버에서도 알려주려면 별도 매핑 필요. 일단 키만 전달.
      } else {
        // 옛 모드 (TBM)
        content = safety[date + '_tbm'] || '';
        contentEn = safety[date + '_tbm_en'] || '';
        signs = safety[date + '_signs'] || {};
      }

      const { data: compRows } = await supabase
        .from('companies')
        .select('company_name')
        .eq('id', companyId);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          company: compRows && compRows.length > 0 ? compRows[0].company_name : '',
          date,
          eduKey: eduKey || 'tbm',
          isV4: isV4Mode,
          // 옛 클라이언트 호환 필드명 + v4 신규 필드명 둘 다 제공
          tbm: content, content,
          tbmEn: contentEn, content_en: contentEn,
          emps: empList,
          signs
        })
      };
    }

    // ── POST: 서명 저장 ──
    if (event.httpMethod === 'POST') {
      if (!empId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: '직원을 선택해주세요' }) };
      }

      let existingSigns, saveTarget;
      if (isV4Mode) {
        existingSigns = v4Rec.signs || {};
      } else {
        existingSigns = safety[date + '_signs'] || {};
      }
      if (existingSigns[String(empId)]) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: '이미 서명을 완료하였습니다', signs: existingSigns }) };
      }

      if (isV4Mode) {
        // v4 위치에 저장
        if (!safetyRecords[date]) safetyRecords[date] = {};
        if (!safetyRecords[date][eduKey]) safetyRecords[date][eduKey] = {};
        if (!safetyRecords[date][eduKey].signs) safetyRecords[date][eduKey].signs = {};
        safetyRecords[date][eduKey].signs[String(empId)] = Date.now();
        const { error: saveErr } = await supabase
          .from('company_data')
          .upsert({
            company_id: companyId,
            data_key: 'safety_records',
            data_value: JSON.stringify(safetyRecords),
            updated_at: new Date().toISOString()
          }, { onConflict: 'company_id,data_key' });
        if (saveErr) {
          console.error('tbm-sign: v4 signature save failed');
          return { statusCode: 500, headers, body: JSON.stringify({ error: '서명 저장에 실패했습니다' }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, signs: safetyRecords[date][eduKey].signs }) };
      } else {
        // 옛 위치 저장 (호환)
        if (!safety[date + '_signs']) safety[date + '_signs'] = {};
        safety[date + '_signs'][String(empId)] = Date.now();
        const { error: saveErr } = await supabase
          .from('company_data')
          .upsert({
            company_id: companyId,
            data_key: 'safety',
            data_value: JSON.stringify(safety),
            updated_at: new Date().toISOString()
          }, { onConflict: 'company_id,data_key' });
        if (saveErr) {
          console.error('tbm-sign: legacy signature save failed');
          return { statusCode: 500, headers, body: JSON.stringify({ error: '서명 저장에 실패했습니다' }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, signs: safety[date + '_signs'] }) };
      }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (e) {
    console.error('tbm-sign: unexpected error');
    return { statusCode: 500, headers, body: JSON.stringify({ error: '서버 오류가 발생했습니다' }) };
  }
};
