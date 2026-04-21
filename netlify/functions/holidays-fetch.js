import { cors, options } from './_shared/auth.js';

// 한국천문연구원 특일정보 API
const API_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: cors(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const year = parseInt(event.queryStringParameters?.year || '0', 10);
  if (!year || year < 2000 || year > 2100) {
    return { statusCode: 400, headers: cors(event), body: JSON.stringify({ error: 'Invalid year' }) };
  }

  const apiKey = process.env.KASI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: cors(event), body: JSON.stringify({ error: '공휴일 API 키가 설정되지 않았습니다' }) };
  }

  try {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const results = await Promise.all(months.map(async (m) => {
      const url = `${API_URL}?ServiceKey=${encodeURIComponent(apiKey)}&solYear=${year}&solMonth=${String(m).padStart(2, '0')}&_type=json&numOfRows=100`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { return []; }
      const items = json?.response?.body?.items;
      if (!items || items === '') return [];
      const arr = Array.isArray(items.item) ? items.item : (items.item ? [items.item] : []);
      return arr
        .filter(it => it.isHoliday === 'Y')
        .map(it => {
          const d = String(it.locdate);
          return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, name: it.dateName };
        });
    }));

    // 같은 날짜에 여러 이름이면 '·'로 연결 (예: 설날·설날연휴)
    const ph = {};
    results.flat().forEach(({ date, name }) => {
      ph[date] = ph[date] ? ph[date] + '·' + name : name;
    });

    return {
      statusCode: 200,
      headers: { ...cors(event), 'Cache-Control': 'public, max-age=86400' },
      body: JSON.stringify(ph)
    };
  } catch (e) {
    console.error('holidays-fetch error');
    return { statusCode: 500, headers: cors(event), body: JSON.stringify({ error: '공휴일 조회 실패' }) };
  }
};
