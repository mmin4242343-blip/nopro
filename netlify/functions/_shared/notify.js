// ═══════════════════════════════════════════════════════════════════════
// 관리자 알림 헬퍼 — admin_notifications 테이블에 알림 추가
//
// 사용처: auth-signup, auth-update 등에서 회원 이벤트 발생 시 호출
// 보존: 영구 (어드민이 직접 삭제 전까지)
// 무결성: 별도 테이블이라 21중 가드 영역과 완전 무관 + 실패해도 본 흐름 영향 없음
// ═══════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';

/**
 * 관리자 알림 추가
 * @param {string} type        - 'signup' | 'profile_change' | 확장
 * @param {string} title       - 알림 제목 (255자 이내)
 * @param {string} body        - 알림 본문 (longtext)
 * @param {object} options     - { companyId, meta }
 * @returns {Promise<void>}
 */
export async function pushAdminNotif(type, title, body, options = {}) {
  // 실패해도 본 흐름(회원가입·정보변경)은 정상 처리되어야 하므로 try-catch로 봉쇄
  try {
    const row = {
      type,
      title: String(title || '').slice(0, 255),
      body: body == null ? null : String(body),
      company_id: options.companyId || null,
      meta: options.meta || null
    };
    const { error } = await supabase.from('admin_notifications').insert(row);
    if (error) {
      // 알림 실패는 콘솔에만 기록 (서버 에러 로그 무한 루프 회피)
      console.warn('[notify] admin_notifications insert 실패:', error.message);
    }
  } catch (e) {
    console.warn('[notify] 예외:', e?.message || e);
  }
}
