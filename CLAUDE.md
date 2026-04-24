# CLAUDE.md - 노무관리 Pro v5 (HR Management System)

## 프로젝트 개요

노무관리 Pro v5는 중소기업을 위한 웹 기반 인사/급여 관리 시스템이다.
출퇴근 기록, 급여 계산, 연차 관리, 직원 관리, 안전교육 일지 등 HR 전반을 처리한다.

## 기술 스택

| 계층 | 기술 |
|------|------|
| 프론트엔드 | HTML5, CSS3, Vanilla JavaScript (SPA, index.html + js/app.js) |
| 백엔드 | Node.js, Netlify Functions (ES Modules) |
| 데이터베이스 | Supabase (PostgreSQL) |
| 인증 | JWT (jsonwebtoken) + bcryptjs + httpOnly 쿠키 |
| 암호화 | AES-256-GCM (주민번호 뒷자리 암호화) |
| 배포 | Netlify (GitHub 연동 자동 배포) |
| 버전 관리 | Git / GitHub |

## 외부 서비스 링크

- **Supabase**: https://rjddrkrbuwbplhwdlotb.supabase.com
- **Netlify 배포 URL**: https://noprohr.netlify.app/
- **GitHub 레포지토리**: https://github.com/mmin4242343-blip/nopro

## 배포 프로세스

1. 코드 수정 후 `git add` → `git commit` → `git push origin main`
2. Netlify가 GitHub push를 감지하여 자동 빌드/배포
3. Claude가 push까지 직접 수행해왔음

## 디렉토리 구조

```
nopro/
├── index.html                          # SPA HTML+CSS (~1600줄, JS는 외부 파일로 분리)
├── js/
│   └── app.js                          # 메인 애플리케이션 JS (~6000줄+)
├── images/                             # 랜딩페이지 스크린샷 이미지
│   ├── 출퇴근기록입력.png
│   ├── 근태현황.png
│   ├── 급여관리.png
│   ├── 연차관리.png
│   └── 직원관리.png
├── netlify.toml                        # Netlify 설정 (보안 헤더, 리다이렉트, 함수 경로)
├── package.json                        # 백엔드 의존성 (supabase, bcryptjs, jsonwebtoken)
├── CLAUDE.md                           # 이 파일
└── netlify/functions/
    ├── _shared/
    │   ├── auth.js                     # JWT 인증 + httpOnly 쿠키 + CORS 유틸
    │   ├── crypto.js                   # AES-256-GCM 암호화/복호화 (주민번호 뒷자리)
    │   ├── rate-limit.js               # 로그인 Rate Limiting (in-memory + DB)
    │   └── supabase.js                 # Supabase 클라이언트 초기화
    ├── auth-login.js                   # 로그인 (bcrypt only, Rate Limiting 적용)
    ├── auth-signup.js                  # 회사 가입
    ├── auth-verify.js                  # JWT 토큰 검증 및 자동 갱신 (쿠키 기반)
    ├── auth-logout.js                  # 로그아웃 (httpOnly 쿠키 클리어)
    ├── auth-update.js                  # 회사 정보/비밀번호 변경
    ├── data-load.js                    # 회사 데이터 로드 (암호화 필드 복호화)
    ├── data-save.js                    # 회사 데이터 저장 (atomic upsert + 감사 로그)
    ├── audit-log.js                    # 감사 로그 조회 API
    ├── file-upload.js                  # 파일 업로드 (Supabase Storage, 5MB 제한)
    ├── file-delete.js                  # 파일 삭제 (본인 회사 파일만)
    ├── file-url.js                     # 파일 서명 URL 발급 (1시간 유효)
    ├── tbm-sign.js                     # TBM 안전교육 서명 API (외부 링크용)
    ├── admin-companies.js              # [관리자] 전체 회사 목록 조회
    ├── admin-delete.js                 # [관리자] 회사 삭제
    └── migrate-passwords.js            # [관리자] SHA-256 → bcrypt 패스워드 마이그레이션
```

## 아키텍처 패턴

### 프론트엔드는 Supabase에 직접 접근하지 않는다
모든 DB 접근은 Netlify Functions를 프록시로 경유한다.
```
Frontend → /api/* → Netlify Function → Supabase
```

### API 엔드포인트 (`/api/*` → `/.netlify/functions/*`)

| 엔드포인트 | 메서드 | 인증 | 용도 |
|------------|--------|------|------|
| `/auth-login` | POST | 없음 | 사용자/관리자 로그인 (bcrypt only) |
| `/auth-signup` | POST | 없음 | 회사 등록 |
| `/auth-verify` | POST | JWT(cookie) | 세션 검증 + 토큰 갱신 |
| `/auth-logout` | POST | 없음 | httpOnly 쿠키 클리어 |
| `/auth-update` | POST | JWT(cookie) | 회사 정보/비밀번호 변경 |
| `/data-load` | POST | JWT(cookie) | 회사 데이터 로드 |
| `/data-save` | POST | JWT(cookie) | 회사 데이터 저장 + 감사 로그 |
| `/audit-log` | GET | JWT(cookie) | 감사 로그 조회 |
| `/file-upload` | POST | JWT(cookie) | 파일 업로드 (Supabase Storage) |
| `/file-delete` | POST | JWT(cookie) | 파일 삭제 |
| `/file-url` | POST | JWT(cookie) | 파일 서명 URL 발급 |
| `/tbm-sign` | GET/POST | 토큰(쿼리) | TBM 안전교육 서명 (외부 링크) |
| `/admin-companies` | GET | JWT(admin) | 전체 회사 목록 |
| `/admin-delete` | DELETE | JWT(admin) | 회사 및 데이터 삭제 |
| `/migrate-passwords` | POST | JWT(admin) | 패스워드 해시 마이그레이션 |

### 데이터 저장 3계층

1. **메모리** (JavaScript 전역 변수): `EMPS`, `POL`, `REC`, `BONUS_REC`, `ALLOWANCE_REC` 등 → 즉시 조작
2. **localStorage** (브라우저): `npm5_emps`, `npm5_rec`, `npm5_pol` 등 → 오프라인 지원, 즉시 저장
3. **Supabase** (`company_data` 테이블): JSON 문자열로 저장 → 디바이스 간 동기화

저장 흐름: 사용자 조작 → 전역 변수 업데이트 → `saveLS()` → localStorage → (자동, 500ms 디바운스) `sbSaveAll()` → Supabase
- 별도 저장 버튼 없음. `saveLS()` 호출 시 500ms 디바운스 후 자동으로 Supabase 서버 저장
- 출퇴근 시간 입력 등 일부 동작은 디바운스 없이 즉시 `sbSaveAll()` 호출

### 감사 로그 (audit_log)

데이터 저장 시 자동으로 변경 이력이 기록된다.
- **기록 내용**: 변경 전 값(old_value), 변경 후 값(new_value), 변경자(changed_by), 시각(changed_at)
- **대용량 키 예외**: `rec`, `tbk`는 저장 공간 절약을 위해 old/new_value 생략
- **조회**: `GET /api/audit-log?key=emps&limit=50`
- **롤백**: audit_log의 old_value를 company_data에 복원하여 수동 롤백 가능
- **보존 기간**: 무제한 (직접 삭제 전까지 영구 저장)

## Supabase 테이블 구조

### `companies` 테이블
```
id              BIGSERIAL PRIMARY KEY
company_name    VARCHAR         -- 회사명
manager_name    VARCHAR         -- 담당자명
phone           VARCHAR         -- 전화번호
email           VARCHAR UNIQUE  -- 로그인 이메일
password_hash   VARCHAR         -- bcrypt 해시 (bcrypt only, SHA-256/평문 폴백 제거됨)
size            VARCHAR         -- '10이하', '50이하', '100이하', '100초과'
address         VARCHAR         -- 주소
join_date       DATE            -- 가입일
status          VARCHAR         -- 'active' | 'inactive'
created_at      TIMESTAMP
```

### `company_data` 테이블
```
id              BIGSERIAL PRIMARY KEY
company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE
data_key        VARCHAR         -- 데이터 종류 키
data_value      TEXT            -- JSON 문자열
updated_at      TIMESTAMP
UNIQUE(company_id, data_key)    -- atomic upsert용 유니크 제약
```

**data_key 종류:**
- `emps` — 직원 목록
- `pol` — 급여 정책/설정
- `bk` — 기본 휴게시간
- `tbk` — 일별 임시 휴게시간
- `rec` — 출퇴근 기록
- `bonus` — 월별 상여금
- `allow` — 월별 수당
- `tax` — 세금 기록
- `leave_settings` — 연차 설정
- `leave_overrides` — 직원별 연차 오버라이드
- `bk_snapshots` — 월별 기본 휴게세트 스냅샷 (DEF_BK 변경 시 변경 직전 값을 과거 달에 freeze)

### `audit_log` 테이블
```
id              BIGSERIAL PRIMARY KEY
company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE
data_key        VARCHAR NOT NULL
action          VARCHAR NOT NULL    -- 'create', 'update', 'snapshot'
changed_by      VARCHAR             -- 변경자 이메일
old_value       TEXT                -- 변경 전 JSON (롤백용)
new_value       TEXT                -- 변경 후 JSON
changed_at      TIMESTAMP NOT NULL DEFAULT now()
```

### `login_attempts` 테이블
```
id              BIGSERIAL PRIMARY KEY
email           VARCHAR NOT NULL
ip              VARCHAR NOT NULL DEFAULT 'unknown'
attempted_at    TIMESTAMP NOT NULL DEFAULT now()
```

## 핵심 전역 변수 (js/app.js)

```javascript
EMPS = []           // 직원 배열 [{id, name, phone, rrnFront, rrnBack, rate, payMode, monthly, position, ...}]
POL = {}            // 급여 정책 {basePayMode, baseRate, sot, nightStart, extFixed, ntFixed, ...}
REC = {}            // 출퇴근 기록 {"{empId}_{YYYY-MM-DD}": {start, end, pohal, att, outTimes, customBk}}
BONUS_REC = {}      // 상여금 {"{empId}_{YYYY}_{MM}": amount}
ALLOWANCE_REC = {}  // 수당 {"{empId}_{YYYY}_{MM}": {ability, position, career, ...}}
TAX_REC = {}        // 세금 {"{empId}_{YYYY}_{MM}": {incomeMin, incomeMax, ...}}
DEF_BK = []         // 기본 휴게시간 [{id, start, end}]
TBK = {}            // 임시 휴게시간 {"{YYYY-MM-DD}": [{id, start, end}]}
PH = {}             // 공휴일 {"{YYYY-MM-DD}": "공휴일명"}
leaveSettings = {}  // 연차 설정
leaveOverrides = {} // 직원별 연차 오버라이드
SAFETY_REC = {}     // 안전교육 기록
```

## 주요 페이지 (탭)

| 탭 ID | 이름 | 기능 |
|--------|------|------|
| `pg-daily` | 출퇴근 기록 | 일별 출퇴근 시간 입력, 야간/연장/휴일 자동 계산, 결근/휴가/외출 관리 |
| `pg-monthly` | 근태 현황 | 월별 캘린더 뷰, 직원별 필터링, 야간/연장/휴일 수당 집계 |
| `pg-payroll` | 급여 관리 | 카드뷰/스프레드시트뷰, 상여금/수당 입력, 세금 계산, 엑셀 내보내기 |
| `pg-leave` | 연차 관리 | 연차 잔여일수, 직원별 연차 오버라이드 |
| `pg-company` | 인원 현황 | 월별/연도별 인원수, 급여 분포 분석 |
| `pg-emps` | 직원 관리 | 직원 추가/수정/삭제, 주민번호 암호화, 드래그 정렬 |
| `pg-safety` | 안전교육 일지 | 교육 일자 기록, 파일 업로드, 사진 갤러리 |
| `pg-folder` | 폴더 관리 | 문서 폴더 정리 |
| `pg-settings` | 급여 설정 | 기본급 설정, 야간/연장/휴일 수당 토글, 주말/공휴일 기준, 휴게시간 기본값 |

## 급여 계산 로직 (`calcSession`)

```
1. 출퇴근 시간 파싱 (start, end)
2. 휴게시간 차감
3. 야간근무 시간 계산 (22:00~06:00)
4. 정규/연장/휴일 시간 분류
5. 급여 모드별 계산:
   - fixed: 고정 금액
   - hourly: 시간 × 시급 × 배율
   - monthly: 월급에서 일할 계산
6. 수당 배율 적용:
   - 야간: 0.5x 또는 1.0x (설정 가능)
   - 연장: 0.5x 또는 1.0x
   - 휴일: 1.5x
```

## 인증 흐름

1. 랜딩 페이지 → 로그인/회원가입
2. `/auth-login` 또는 `/auth-signup` → JWT 토큰을 **httpOnly 쿠키**(`nopro_token`)로 설정
3. 쿠키는 브라우저가 자동으로 API 요청에 포함 (`credentials: 'include'`)
4. 세션 정보(role, company name 등)만 `localStorage['nopro_session']`에 저장 (화면 표시용)
5. **프론트엔드는 JWT 토큰에 직접 접근 불가** (httpOnly, JS에서 읽기 불가)
6. `/auth-verify`로 토큰 유효성 검증, 만료 6시간 전 자동 갱신 (Set-Cookie)
7. 로그아웃: `/auth-logout` 호출 → 쿠키 클리어 + localStorage 세션 삭제
8. 관리자(role='admin') vs 사용자(role='user') 분기

### Rate Limiting
- **In-memory**: 동일 이메일+IP로 1분 내 5회 초과 시 차단 (burst 보호)
- **DB-backed**: 동일 이메일로 15분 내 10회 초과 시 차단 (persistent)
- 로그인 성공 시 시도 기록 초기화
- 429 응답 + Retry-After 헤더

## 환경 변수 (Netlify에 설정)

```
SUPABASE_URL          # Supabase 프로젝트 URL
SUPABASE_SERVICE_KEY  # Supabase 서비스 키
JWT_SECRET            # JWT 서명 비밀키
ENCRYPTION_KEY        # AES-256-GCM 암호화 키 (32바이트 hex)
ADMIN_EMAIL           # 관리자 이메일
ADMIN_PASSWORD_HASH   # 관리자 비밀번호 bcrypt 해시
ALLOWED_ORIGINS       # CORS 허용 도메인 (쉼표 구분, 기본값: https://noprohr.netlify.app,http://localhost:8888)
```

## 보안 사항

- 프론트엔드 → Supabase 직접 접근 차단 (Netlify Functions 프록시 필수)
- JWT 토큰은 **httpOnly 쿠키**로 저장 (JS에서 접근 불가, XSS 토큰 탈취 방지)
- 주민번호 뒷자리 AES-256-GCM 암호화 (서버 측 암/복호화)
- 비밀번호 **bcrypt 12라운드만 허용** (SHA-256, 평문 폴백 완전 제거)
- 로그인 에러 메시지 통일 ("이메일 또는 비밀번호가 올바르지 않습니다") — 이메일 열거 공격 방지
- 로그인 Rate Limiting (in-memory + DB-backed)
- CSP, HSTS, X-Frame-Options 등 보안 헤더 (netlify.toml)
- CORS: 환경변수 `ALLOWED_ORIGINS`로 관리 + `Access-Control-Allow-Credentials: true`
- JWT HS256 알고리즘 고정
- 데이터 변경 시 감사 로그 자동 기록 (audit_log 테이블)

### 보안 개선 이력 (2026-04-08)
- `password_plain` 컬럼 및 폴백 코드 완전 제거
- SHA-256 해시 비교 폴백 및 `sha256()` 함수 완전 제거
- Rate Limiting 추가 (`_shared/rate-limit.js` + `login_attempts` 테이블)
- localStorage 토큰 → httpOnly 쿠키 전환
- 인라인 JS 6000줄 → 외부 파일(`js/app.js`)로 분리
- CORS origins 환경변수화
- 감사 로그(audit_log) 구현
- data-save.js: select+insert/update → atomic upsert 전환

### 보안 개선 이력 (2026-04-14)
- localStorage JWT(`nopro_jwt`) 완전 제거 → httpOnly 쿠키만으로 인증
- 서버 응답 body에서 token 필드 제거 (Set-Cookie만 사용)
- innerHTML value 속성에 XSS 이스케이프(`esc()`) 적용
- 서버 에러 메시지에서 시스템 정보 노출 제거
- xlsx CDN에 SRI(Subresource Integrity) 해시 추가
- tbm-sign CORS fallback `'*'` → `ALLOWED_ORIGINS[0]` 통일
- 백엔드 7개 함수에 JSON.parse try-catch 보호 추가
- audit-log limit/offset 음수·NaN 방어
- file-upload 버킷 크기 제한 5MB 통일
- 이미지 로드 실패 시 onerror 핸들러 추가
- 안전교육 드래그앤드롭 중복 리스너 방지 + 사진 삭제 시 서버 반영

### 데이터 유실 방지 4중 가드 (2026-04-23 도입, 같은 날 확장)

**사고 이력**:
- **1차 wipe (01:40 UTC)**: 단일 `sbSaveAll()` 호출이 EMPS·REC·BONUS·ALLOW·TAX 5개 키를 동시에 빈값으로 덮어씀. 근본 원인: `sbLoadAll`의 `else { EMPS = []; }` 분기가 서버 파셜 응답 시 메모리 리셋 → 후속 saveLS가 빈값을 서버에 저장.
- **2차 wipe (02:58 UTC, 1차 가드 배포 후 재발)**: 하드 새로고침 직후 초기 로드 구간에 save가 트리거되었고, `_syncedSnapshot=null` 상태에서 클라 가드가 "스냅샷 없음 = 데이터 없음"으로 오인해 빈값 저장을 허용. 서버 가드는 `oldValue` 존재 시에만 검사하던 로직 결함으로 함께 실패.
- 복구는 두 사고 모두 감사 로그 `old_value` 역추적으로 수행 성공 (최종 상태: EMPS 145명, REC 2117건, BONUS 4건, ALLOW 57건, TAX 1건).

**최종 방어선 (4중 가드)** — 커밋 `faedc4f` → `ccbbfaa` → `d01bd4a` → `7cc5eba` → `513bc7d` → `30607d5`:

#### 가드 1: `sbLoadAll` 단언적 교체 제거
- `if('key' in map)` 패턴만 사용. 서버 응답에 키가 없으면 메모리·localStorage **그대로 유지**.
- `else { X = []; }` 또는 `if(map.x)` 분기 **영구 금지**.

#### 가드 2: `sbSaveAll` / `safeItemSave` / `_flushSaveOnUnload` 빈값 차단 (우회 불가)
- 보호 대상: `emps`, `rec`, `bonus`, `allow`, `tax`, `tbk`, `safety`, `bk`
- 조건 1 (**초기 로드 전**): `_syncedSnapshot === null` → 빈값 저장 **무조건 차단** (console만, 토스트 X)
- 조건 2 (**덮어쓰기 시도**): 스냅샷에 데이터 있음 + 현재 빈값 → 차단 + 사용자 토스트
- **우회 플래그 없음.** `rmAllEmps` 같은 "전체 삭제" 기능은 **완전 비활성화**(alert만 표시).
- 직접 `apiFetch('/data-save', ...)` 호출 금지 → `safeItemSave(key, value)` 또는 `sbSaveAll()` 사용.

#### 가드 3: `pollForUpdates` 서버 wipe 전파 차단
- `_guardedMerge` / `_guardedReplace` 래퍼: 서버 값이 비었고 로컬에 데이터 있으면 해당 키 동기화 스킵 → 다른 기기/서버의 빈값이 로컬을 덮어쓸 수 없음.

#### 가드 4 (서버측): `data-save.js` 빈값 저장 무조건 거부
- `PROTECTED = new Set(['emps','rec','bonus','allow','tax','tbk','safety','bk'])` 키는 빈 배열/객체이면 **`oldValue` 존재 여부 불문 `continue`로 스킵** (upsert도 감사 로그 insert도 안 함).
- 클라이언트 코드가 어떤 식으로 해킹/버그돼도 **빈값은 서버 DB에 도달 불가**.

#### clearLocalData / 로그아웃 경쟁 조건 방어
- `clearLocalData()`는 로컬 전역 리셋 시 **반드시** `_syncedSnapshot = null` + `clearTimeout(saveLS._timer)` 동반.
- logout 중 대기 타이머가 유효 쿠키로 빈값 저장하던 race window 봉쇄.

### 알려진 부수 이슈

#### `/data-load` 504 Gateway Timeout (2026-04-23 확인)
**원인**: 데이터가 커질수록 응답 시간 증가 → Netlify 함수 10초 타임아웃 초과.
- emps 145명 × AES-256-GCM 복호화 + rec 355KB JSON.parse/stringify + 전체 payload 400~500KB
- 30초 폴링이 매번 전체 덤프를 요청해 부하 가중

**영향**: 없음 (읽기 실패만 발생, 메모리·서버 데이터 무영향).

**완화책** (커밋 `30607d5` 적용):
- `POLL_INTERVAL_MS`: 30s → 120s 로 상향
- 504 발생 시 지수 백오프: 2분 → 4 → 8 → 최대 10분
- 성공 시 백오프 리셋
- 장기 과제: lightweight "changed-since" 체크 엔드포인트로 전환, 또는 rec/tbk 폴링 제외

#### `refreshAllAges` 자동 저장 제거 (커밋 `30607d5`)
- 나이 재계산 시 값이 **실제로 변경됐을 때만** `saveLS()` 호출.
- 이전: init 시점마다 자동 저장 → 부하 가중 + 불필요한 504 발생.
- 나이는 사용자 편집 시 자연스럽게 저장되므로 자동 저장 불필요.

**개발 시 지켜야 할 규칙**:
1. **새 data_key 추가 시**: `sbLoadAll`에 `if('key' in map) { ... }` 패턴 사용. 다른 패턴 영구 금지.
2. **"전체 삭제" 기능 절대 추가 금지**.
3. **`clearLocalData` 확장 시**: `_syncedSnapshot = null` + `saveLS._timer` 취소 동반 필수.
4. **서버 직접 저장(`/data-save`) 금지**: `sbSaveAll()` 또는 `safeItemSave(key, value)` 만 사용.
5. **init 시점 자동 저장 로직 추가 금지**: 504 재발 원인. 변경 감지 후 조건부 저장만 허용.
6. **복구 절차**: 감사 로그 `old_value`에서 복원. `/api/audit-log?key=X&limit=1&offset=N` 페이징으로 `old` 크고 `new` 작은 시점 찾기 → `old_value` JSON.parse → `/api/data-save` 재저장. `emps`의 경우 `rrnBack`이 암호화된 상태라 이중 암호화 방지 위해 `rrnBack=''`로 비우고 저장 필요(rrnBack 재입력 별도 요구).

### 남은 보안 작업 (선택)
- CSP `script-src 'unsafe-inline'` 제거: 인라인 이벤트 핸들러 336개를 addEventListener로 전환 필요 (대규모 리팩토링)
- CSP `style-src 'unsafe-inline'` 제거: 인라인 스타일 분리 필요
- httpOnly 쿠키 전환으로 토큰 탈취는 이미 방지되어 있으므로 긴급도 낮음
- `encryptEmps` 이중 암호화 방지: `e.rrnBack.startsWith('ENC:')` 체크 추가 시 감사 로그 직접 복원 가능 (현재는 rrnBack 스트립 필요)

## 코딩 컨벤션

- **프론트엔드**: `index.html`(HTML+CSS) + `js/app.js`(JavaScript) 분리 구조
- **백엔드**: ES Module (`.js` 확장자, `import/export` 사용)
- **함수명**: camelCase (`calcSession`, `renderTable`, `sbSaveAll`)
- **전역 변수**: 대문자 (`EMPS`, `POL`, `REC`, `BONUS_REC`)
- **localStorage 키**: `npm5_` 접두사 (`npm5_emps`, `npm5_rec`)
- **data_key**: snake_case (`leave_settings`, `leave_overrides`)
- **CSS 클래스**: 축약형 (`.pg`, `.sb`, `.nt`, `.ei`, `.tw`, `.et`, `.sc`, `.bk-box`)
- **랜딩페이지 CSS**: `#lo` 스코핑 접두사로 스타일 충돌 방지
- **날짜 형식**: `YYYY-MM-DD` (ISO)
- **시간 형식**: `HH:mm` (24시간)
- **Netlify Function 응답**: `{ statusCode, headers(CORS+Set-Cookie), body(JSON) }` 형식

## 주요 함수 (js/app.js)

### 데이터 관리
- `apiFetch(endpoint, method, body)` — API 호출 래퍼 (credentials:'include', httpOnly 쿠키 자동 전송, Authorization 헤더 없음)
- `saveLS()` — 전역 변수 → localStorage 저장
- `sbLoadAll(companyId)` — Supabase에서 전체 데이터 로드
- `sbSaveAll(companyId)` — Supabase에 전체 데이터 저장

### 직원 관리
- `renderSb(filter)` — 사이드바 직원 목록 렌더링
- `addEmp()` / `delEmp(id)` / `editEmp(id)` — 직원 CRUD
- `sortEMPS()` — 직원 정렬 (주간→야간)
- `rrn2age(front,back)` — 주민번호 → 나이 계산

### 급여 계산
- `calcSession(start,end,rate,isHol,bks,outTimes,empMode)` — 일별 급여 계산
- `monthSummary(eid,y,m)` — 월별 급여 요약
- `calcBkDeduct(sMin,eMin,bks)` — 휴게시간 차감
- `calcNightMins(sMin,eMin,bks,outTimes)` — 야간근무 시간 계산

### 화면 렌더링
- `gp(page)` — 페이지 전환
- `renderTable()` — 출퇴근 기록 테이블
- `renderMonthly()` — 근태 현황 캘린더
- `renderPayroll()` — 급여 관리 뷰
- `renderCompany()` — 인원 현황

### 시간 입력
- `handleTimeInput(eid,field,raw)` — 시간 파싱 (예: "9" → "09:00")
- `parseTimeInput(raw)` — 유연한 시간 파싱
- `timeKeyNav(e,el,eid,field)` — 화살표키 셀 이동

### 인증
- `showAuthModal(tab)` — 로그인/회원가입 모달 표시
- `doAuthLogin()` — 로그인 실행
- `doAuthSignup()` — 회원가입 실행
- `authLogout()` — 로그아웃 (서버 쿠키 클리어 + 세션 삭제)
- `initAuth()` — 앱 초기 로드 시 세션 검증

## 관리자 패널

`#admin-overlay`에 별도 다크 테마 UI 존재:
- **대시보드**: 총 회사수, 활성 회사수, 월 매출 추정, 총 직원수 추정
- **가입 회사**: 회사 목록 테이블, 검색, 삭제
- **회원 관리**: 사용자 목록 (읽기 전용)

관리자 함수: `admPage(page)`, `admDeleteUser(id)`, `admFilter(val)`

## !!! 절대 삭제/수정 금지 파일 !!!

> **이 섹션에 나열된 파일을 삭제하거나 내용을 임의로 변경하면 서비스가 즉시 장애 상태에 빠집니다.**
> 기능 추가/수정 작업 시 이 파일들이 "필요 없어 보인다"고 판단하더라도 절대 건드리지 마세요.
> 확신이 없으면 반드시 프로젝트 관리자에게 먼저 확인하세요.

### 1. `netlify.toml` — 삭제 금지, 함부로 수정 금지

이 파일이 없으면 **사이트 전체가 작동하지 않습니다.**

| 설정 | 삭제/변경 시 발생하는 장애 |
|------|--------------------------|
| `[[redirects]]` `/api/*` → `/.netlify/functions/:splat` | **로그인, 회원가입, 데이터 저장/로드 등 모든 API 호출 실패.** 브라우저에 `"Unexpected token '<'"` JSON 파싱 에러 발생 |
| `[build] functions = "netlify/functions"` | Netlify가 백엔드 함수를 인식하지 못해 **모든 서버 기능 중단** |
| `[functions] node_bundler = "esbuild"` | 함수 번들링 실패로 **배포 자체가 실패** |
| `[[headers]]` 보안 헤더 | CSP, HSTS, XSS 보호 해제로 **보안 취약점 노출** |

> **실제 사고 이력**: 2026-04-06 이 파일이 삭제되어 로그인 기능이 완전히 마비됨. 복구에 불필요한 시간 소모.

### 2. `netlify/functions/` 폴더 전체 — 삭제 금지

| 파일 | 삭제 시 장애 |
|------|-------------|
| `_shared/auth.js` | **모든 API 인증 실패** — 로그인, 데이터 접근 전부 불가 |
| `_shared/supabase.js` | **DB 연결 불가** — 서버 기능 전체 중단 |
| `_shared/crypto.js` | **주민번호 암호화/복호화 불가** — 직원 데이터 읽기/쓰기 실패 |
| `_shared/rate-limit.js` | **Rate Limiting 비활성화** — 무차별 로그인 공격에 취약 |
| `auth-login.js` | **로그인 불가** |
| `auth-signup.js` | **회원가입 불가** |
| `auth-verify.js` | **세션 유지 불가** — 로그인해도 즉시 튕김 |
| `auth-logout.js` | **로그아웃 불가** — httpOnly 쿠키 클리어 불가 |
| `data-load.js` | **저장된 데이터 불러오기 불가** — 빈 화면 |
| `data-save.js` | **데이터 서버 저장 불가** — 작업 내용 유실 |
| `audit-log.js` | 감사 로그 조회 불가 |
| `admin-companies.js` | 관리자 페이지 회사 목록 불가 |
| `admin-delete.js` | 관리자 회사 삭제 불가 |
| `migrate-passwords.js` | 패스워드 마이그레이션 불가 |

### 3. `package.json` — 삭제 금지, 의존성 함부로 제거 금지

| 의존성 | 제거 시 장애 |
|--------|-------------|
| `@supabase/supabase-js` | DB 연결 라이브러리 없음 → **서버 함수 전체 실행 실패** |
| `bcryptjs` | 비밀번호 검증 불가 → **로그인 불가** |
| `jsonwebtoken` | JWT 발급/검증 불가 → **인증 전체 불가** |
| `"type": "module"` | ES Module import 구문 실패 → **모든 함수 실행 에러** |

### 4. `index.html` — 삭제 금지

이 파일이 서비스의 **HTML/CSS 구조 전체**입니다. 삭제하면 사이트에 아무것도 표시되지 않습니다.

### 5. `js/app.js` — 삭제 금지

이 파일이 서비스의 **모든 프론트엔드 로직**입니다. 삭제하면 어떤 기능도 동작하지 않습니다.

### 파일 삭제/수정 전 체크리스트

작업 전에 아래를 반드시 확인하세요:

- [ ] 삭제하려는 파일이 위 목록에 포함되어 있지 않은가?
- [ ] 해당 파일을 `import`하거나 참조하는 다른 파일이 없는가?
- [ ] 수정 후에도 `netlify.toml`의 리다이렉트, 보안 헤더가 그대로 유지되는가?
- [ ] `package.json`의 의존성을 제거하기 전에 해당 패키지를 사용하는 함수가 없는지 확인했는가?
- [ ] **확신이 없으면 프로젝트 관리자에게 먼저 물어봤는가?**

---

## 작업 시 주의사항

1. `index.html`과 `js/app.js`를 함께 수정할 때, HTML ID/클래스와 JS 셀렉터의 정합성 유지
2. Netlify Functions는 ES Module 형식 (`.js`, `export const handler`, `package.json`에 `"type":"module"`)
3. 프론트엔드에서 Supabase URL/키를 직접 참조하지 말 것 (보안)
4. `saveLS()` 호출을 빠뜨리면 데이터가 유실될 수 있음
5. 공휴일(`PH`) 객체는 매년 수동 업데이트 필요
6. CORS 허용 목록 변경 시 Netlify 환경변수 `ALLOWED_ORIGINS` 수정
7. 비밀번호는 **bcrypt만 지원** (SHA-256, 평문 폴백 없음)
8. push 시 Netlify 자동 배포가 즉시 이루어지므로 main 브랜치 직접 push 주의
9. **파일을 삭제하기 전에 반드시 "절대 삭제 금지 파일" 섹션을 확인할 것**
10. **"이 파일 필요 없는 것 같은데?" 라는 생각이 들면, 그 파일은 십중팔구 필요한 파일이다. 삭제하지 말 것**
11. httpOnly 쿠키 기반 인증이므로, 프론트엔드에서 JWT를 직접 다루지 말 것 (localStorage에 토큰 저장 금지)
12. API 호출 시 `credentials: 'include'` 필수 (쿠키 자동 전송), Authorization 헤더 사용하지 않음
13. Supabase Storage 버킷명: `nopro-files` (파일 업로드/삭제/URL 발급에 사용)
14. **⚠️ 데이터 유실 방지 가드 절대 우회 금지** (2026-04-23 사고 이후 도입)
    - `sbLoadAll`은 반드시 `if('key' in map)` 패턴만 사용. `else { X = []; }` 분기 절대 추가 금지.
    - `sbSaveAll`의 빈값 가드는 수정·제거 금지. 필요 시 `window._allowEmptyXxxSave` 플래그로 명시적 우회.
    - `pollForUpdates`의 `_guardedMerge`/`_guardedReplace` 래퍼 제거 금지.
    - `clearLocalData`를 authLogout 외 다른 곳에서 호출 시 반드시 `_syncedSnapshot = null` 동반.
    - 상세 규칙은 "데이터 유실 방지 3중 가드" 섹션 참조.
