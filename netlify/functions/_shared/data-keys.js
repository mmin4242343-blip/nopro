// 🔑 데이터 키 단일 진실 소스 (Single Source of Truth)
//
// 이전: data-save.js, data-load.js, js/app.js 등 5+곳에 ALLOWED_KEYS·PROTECTED 배열이 분산.
//       → 2026-05-14 사고: safety_records/safety_config가 일부에 누락되어 silent skip 발생.
// 현재: 백엔드 두 함수는 이 파일을 import. 클라이언트도 응답으로 받아 자체 정의와 비교.
//
// 새 data_key 추가 시:
//   1. 아래 ALLOWED_KEYS에 추가 (백엔드 자동 반영)
//   2. CLAUDE.md "data_key 종류" 목록 갱신
//   3. js/app.js sbLoadAll에 `if('새키' in map)` 분기 추가 (C-1 가드)
//   4. js/app.js sbSaveAll에 smallItems/largeItems 포함
//   5. 데이터 유실 위험 있으면 PROTECTED_KEYS에도 추가
//
// 절대 새 배열을 다른 파일에 만들지 말 것. 이 파일에서만 export.

export const ALLOWED_KEYS = Object.freeze([
  'emps',
  'pol',
  'bk',
  'tbk',
  'rec',
  'bonus',
  'allow',
  'tax',
  'leave_settings',
  'leave_overrides',
  'folders',
  'safety',
  'safety_records',
  'safety_config',
  'pol_snapshots',
  'pay_snapshots',
  'bk_snapshots',
  'company_info',
  'custom_docs',
  'saved_forms',
]);

// 빈값 저장 가드·낙관적 잠금·사이즈 급감 차단의 보호 대상 키.
// 사고 시 복구가 어렵거나 사용자 입력값이 즉시 사라지는 키만 포함.
export const PROTECTED_KEYS = Object.freeze(
  new Set(['emps', 'rec', 'bonus', 'allow', 'tax', 'tbk', 'safety', 'bk'])
);

// 헬퍼 — Set이 아닌 배열로 받고 싶을 때
export const PROTECTED_KEYS_ARRAY = Object.freeze([...PROTECTED_KEYS]);

// 유효성 검증 헬퍼 — ALLOWED_KEYS에 포함되는지 빠르게 체크
const _allowedSet = new Set(ALLOWED_KEYS);
export function isAllowedKey(key) {
  return typeof key === 'string' && _allowedSet.has(key);
}
