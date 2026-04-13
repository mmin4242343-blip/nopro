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

  const params = event.queryStringParameters || {};
  let companyId, token, date;

  if (event.httpMethod === 'GET') {
    companyId = params.c;
    token = params.t;
    date = params.d;
  } else if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    companyId = body.c || params.c;
    token = body.t || params.t;
    date = body.d || params.d;
    var empId = body.empId;
  }

  if (!companyId || !token || !date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '잘못된 요청입니다' }) };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '잘못된 날짜 형식입니다' }) };
  }

  try {
    // Load safety data
    const { data: safetyRow } = await supabase
      .from('company_data')
      .select('data_value')
      .eq('company_id', companyId)
      .eq('data_key', 'safety')
      .single();

    const safety = safetyRow ? JSON.parse(safetyRow.data_value) : {};

    // Verify token
    if (safety[date + '_token'] !== token) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: '유효하지 않은 링크입니다. 관리자에게 새 링크를 요청하세요.' }) };
    }

    if (event.httpMethod === 'GET') {
      // Load employee list (names + basic info only, no sensitive data)
      const { data: empsRow } = await supabase
        .from('company_data')
        .select('data_value')
        .eq('company_id', companyId)
        .eq('data_key', 'emps')
        .single();

      const emps = empsRow ? JSON.parse(empsRow.data_value) : [];
      const empList = emps
        .filter(e => !e.leave)
        .map(e => ({ id: e.id, name: e.name, nameEn: e.nameEn || '', shift: e.shift || 'day', dept: e.dept || '' }));

      const tbm = safety[date + '_tbm'] || '';
      const signs = safety[date + '_signs'] || {};

      // Load company name
      const { data: compRow } = await supabase
        .from('companies')
        .select('company_name')
        .eq('id', companyId)
        .single();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          company: compRow?.company_name || '',
          date,
          tbm,
          emps: empList,
          signs
        })
      };
    }

    if (event.httpMethod === 'POST') {
      if (!empId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: '직원을 선택해주세요' }) };
      }

      // Prevent duplicate signature
      const existingSigns = safety[date + '_signs'] || {};
      if (existingSigns[String(empId)]) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: '이미 서명을 완료하였습니다', signs: existingSigns }) };
      }

      // Add signature
      if (!safety[date + '_signs']) safety[date + '_signs'] = {};
      safety[date + '_signs'][String(empId)] = Date.now();

      // Save back to Supabase
      const { error } = await supabase
        .from('company_data')
        .upsert({
          company_id: companyId,
          data_key: 'safety',
          data_value: JSON.stringify(safety),
          updated_at: new Date().toISOString()
        }, { onConflict: 'company_id,data_key' });

      if (error) {
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: '서버 오류가 발생했습니다' }) };
  }
};
