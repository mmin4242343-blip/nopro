import { supabase } from './_shared/supabase.js';
import { requireAdmin, ok, err, options, cors } from './_shared/auth.js';
import zlib from 'zlib';

// 관리자 전용 — 단일 회사 전체 데이터 백업
// companies(비밀번호 제외) + company_data(전체 키) + audit_log(전체) 포함
// 주민번호는 AES 암호화된 상태 그대로 (복호화 안 함)
//
// 응답 6MB 제한 회피: 본문을 gzip 압축 + base64 인코딩 + Content-Encoding:gzip 헤더로 전송.
// 브라우저가 자동 해제하므로 프론트 변경 불필요. JSON 응답 형식은 v1.0 그대로.
// 압축 후에도 6MB 초과 시 별도 분할 호출 구조 도입 검토.

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'GET') return err(405, 'Method not allowed', event);

  try {
    requireAdmin(event);

    const companyId = parseInt(event.queryStringParameters?.companyId || '0', 10);
    if (!companyId || companyId < 1) return err(400, 'companyId 파라미터가 필요합니다', event);

    const { data: companyRows, error: cErr } = await supabase
      .from('companies')
      .select('id, company_name, manager_name, phone, email, size, address, join_date, status, created_at')
      .eq('id', companyId)
      .limit(1);
    if (cErr) return err(500, '회사 정보 조회 실패', event);
    if (!companyRows || companyRows.length === 0) return err(404, '회사를 찾을 수 없습니다', event);
    const company = companyRows[0];

    const { data: dataRows, error: dErr } = await supabase
      .from('company_data')
      .select('data_key, data_value, updated_at')
      .eq('company_id', companyId);
    if (dErr) return err(500, '회사 데이터 조회 실패', event);

    const company_data = {};
    const company_data_versions = {};
    (dataRows || []).forEach(r => {
      company_data[r.data_key] = r.data_value;
      company_data_versions[r.data_key] = r.updated_at;
    });

    const { data: auditRows, error: aErr } = await supabase
      .from('audit_log')
      .select('id, data_key, action, changed_by, old_value, new_value, changed_at')
      .eq('company_id', companyId)
      .order('changed_at', { ascending: true });
    if (aErr) return err(500, '감사 로그 조회 실패', event);

    const payload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      companyId,
      company,
      company_data,
      company_data_versions,
      audit_log: auditRows || [],
      _notes: {
        rrnBack_state: 'AES-256-GCM 암호화 상태 (복호화 안 함). 복원 시 ENCRYPTION_KEY 필요.',
        password_state: '비밀번호 해시 미포함 (보안상 의도적 제외).',
        audit_log_use: '데이터 손실 시 old_value 컬럼으로 시점 복원 가능. recovery-2026-04-27.sql 참고.'
      }
    };

    // gzip 압축으로 6MB 한도 회피. 큰 audit_log를 가진 회사에서 502 방지.
    // 브라우저가 Content-Encoding 헤더 보고 자동 해제 → 프론트 변경 불필요.
    const json = JSON.stringify(payload);
    try {
      const gz = zlib.gzipSync(json, { level: 6 });
      return {
        statusCode: 200,
        headers: { ...cors(event), 'Content-Encoding': 'gzip' },
        body: gz.toString('base64'),
        isBase64Encoded: true,
      };
    } catch (zerr) {
      // 압축 실패 시 평문 폴백 (작은 회사는 그대로 통과)
      return ok(payload, event);
    }

  } catch (e) {
    if (e.message?.includes('관리자')) return err(403, '관리자 권한이 필요합니다', event);
    if (e.message?.includes('토큰') || e.message?.includes('jwt')) return err(401, '세션이 만료되었습니다', event);
    return err(500, '서버 오류가 발생했습니다', event);
  }
}
