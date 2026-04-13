import { supabase } from './_shared/supabase.js';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://noprohr.netlify.app,http://localhost:8888').split(',').map(s => s.trim());

function corsHeaders(event) {
  const origin = event?.headers?.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : '*';
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
    let companyId, token, date, empId;

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      companyId = body.c || params.c;
      token = body.t || params.t;
      date = body.d || params.d;
      empId = body.empId;
    } else {
      companyId = params.c;
      token = params.t;
      date = params.d;
    }

    if (!companyId || !token || !date) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '필수 파라미터가 누락되었습니다 (c, t, d)' }) };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '잘못된 날짜 형식입니다' }) };
    }

    // Load safety data (maybeSingle 패턴 — 데이터 없어도 에러 안 남)
    const { data: rows, error: dbErr } = await supabase
      .from('company_data')
      .select('data_value')
      .eq('company_id', companyId)
      .eq('data_key', 'safety');

    if (dbErr) {
      console.error('DB 조회 실패:', dbErr);
      return { statusCode: 500, headers, body: JSON.stringify({ error: '서버 오류가 발생했습니다' }) };
    }

    const safetyRow = rows && rows.length > 0 ? rows[0] : null;
    const safety = safetyRow ? JSON.parse(safetyRow.data_value) : {};

    // Verify token
    const storedToken = safety[date + '_token'];
    if (storedToken !== token) {
      console.log(`Token mismatch: stored=${storedToken}, received=${token}, date=${date}, company=${companyId}`);
      return { statusCode: 403, headers, body: JSON.stringify({
        error: '유효하지 않은 링크입니다. 관리자에게 새 링크를 요청하세요.',
        hint: !storedToken ? '이 날짜의 서명 링크가 아직 생성되지 않았습니다.' : '토큰이 일치하지 않습니다.'
      })};
    }

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

      const tbm = safety[date + '_tbm'] || '';
      const signs = safety[date + '_signs'] || {};

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
          tbm,
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

      const existingSigns = safety[date + '_signs'] || {};
      if (existingSigns[String(empId)]) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: '이미 서명을 완료하였습니다', signs: existingSigns }) };
      }

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
        console.error('서명 저장 실패:', saveErr);
        return { statusCode: 500, headers, body: JSON.stringify({ error: '서명 저장에 실패했습니다' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, signs: safety[date + '_signs'] })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (e) {
    console.error('tbm-sign error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: '서버 오류가 발생했습니다: ' + e.message }) };
  }
};
