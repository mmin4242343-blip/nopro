# CLAUDE.md - 노무관리 Pro v5 (HR Management System)

## 프로젝트 개요

노무관리 Pro v5는 중소기업을 위한 웹 기반 인사/급여 관리 시스템이다.
출퇴근 기록, 급여 계산, 연차 관리, 직원 관리, 안전교육 일지 등 HR 전반을 처리한다.

## 기술 스택

| 계층 | 기술 |
|------|------|
| 프론트엔드 | HTML5, CSS3, Vanilla JavaScript (SPA, 단일 index.html) |
| 백엔드 | Node.js, Netlify Functions (ES Modules) |
| 데이터베이스 | Supabase (PostgreSQL) |
| 인증 | JWT (jsonwebtoken) + bcryptjs |
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
├── index.html                          # 전체 SPA (HTML+CSS+JS, ~7700줄)
├── netlify.toml                        # Netlify 설정 (보안 헤더, 리다이렉트, 함수 경로)
├── package.json                        # 백엔드 의존성 (supabase, bcryptjs, jsonwebtoken)
├── CLAUDE.md                           # 이 파일
└── netlify/functions/
    ├── _shared/
    │   ├── auth.mjs                    # JWT 인증 유틸 (signToken, verifyToken, requireAdmin)
    │   ├── crypto.mjs                  # AES-256-GCM 암호화/복호화 (주민번호 뒷자리)
    │   └── supabase.mjs               # Supabase 클라이언트 초기화
    ├── auth-login.mjs                  # 로그인 (관리자/사용자)
    ├── auth-signup.mjs                 # 회사 가입
    ├── auth-verify.mjs                 # JWT 토큰 검증 및 자동 갱신
    ├── data-load.mjs                   # 회사 데이터 로드 (암호화 필드 복호화)
    ├── data-save.mjs                   # 회사 데이터 저장 (upsert)
    ├── admin-companies.mjs             # [관리자] 전체 회사 목록 조회
    ├── admin-delete.mjs                # [관리자] 회사 삭제
    └── migrate-passwords.mjs           # [관리자] SHA-256 → bcrypt 패스워드 마이그레이션
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
| `/auth-login` | POST | 없음 | 사용자/관리자 로그인 |
| `/auth-signup` | POST | 없음 | 회사 등록 |
| `/auth-verify` | POST | JWT | 세션 검증 + 토큰 갱신 |
| `/data-load` | POST | JWT(user) | 회사 데이터 로드 |
| `/data-save` | POST | JWT(user) | 회사 데이터 저장 |
| `/admin-companies` | GET | JWT(admin) | 전체 회사 목록 |
| `/admin-delete` | DELETE | JWT(admin) | 회사 및 데이터 삭제 |
| `/migrate-passwords` | POST | JWT(admin) | 패스워드 해시 마이그레이션 |

### 데이터 저장 3계층

1. **메모리** (JavaScript 전역 변수): `EMPS`, `POL`, `REC`, `BONUS_REC`, `ALLOWANCE_REC` 등 → 즉시 조작
2. **localStorage** (브라우저): `npm5_emps`, `npm5_rec`, `npm5_pol` 등 → 오프라인 지원, 즉시 저장
3. **Supabase** (`company_data` 테이블): JSON 문자열로 저장 → 디바이스 간 동기화

저장 흐름: 사용자 조작 → 전역 변수 업데이트 → `saveLS()` → localStorage → (수동) `sbSaveAll()` → Supabase

## Supabase 테이블 구조

### `companies` 테이블
```
id              BIGSERIAL PRIMARY KEY
company_name    VARCHAR         -- 회사명
manager_name    VARCHAR         -- 담당자명
phone           VARCHAR         -- 전화번호
email           VARCHAR UNIQUE  -- 로그인 이메일
password_hash   VARCHAR         -- bcrypt 해시
password_plain  VARCHAR         -- (deprecated, 마이그레이션 후 null)
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

## 핵심 전역 변수 (index.html)

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
2. `/auth-login` 또는 `/auth-signup` → JWT 토큰 발급
3. `localStorage['nopro_token']`에 토큰 저장, `localStorage['nopro_session']`에 세션 저장
4. 모든 API 요청에 `Authorization: Bearer {token}` 헤더 포함
5. `/auth-verify`로 토큰 유효성 검증, 만료 2시간 전 자동 갱신
6. 관리자(role='admin') vs 사용자(role='user') 분기

## 환경 변수 (Netlify에 설정)

```
SUPABASE_URL          # Supabase 프로젝트 URL
SUPABASE_SERVICE_KEY  # Supabase 서비스 키
JWT_SECRET            # JWT 서명 비밀키
ENCRYPTION_KEY        # AES-256-GCM 암호화 키 (32바이트 hex)
ADMIN_EMAIL           # 관리자 이메일
ADMIN_PASSWORD_HASH   # 관리자 비밀번호 bcrypt 해시
```

## 보안 사항

- 프론트엔드 → Supabase 직접 접근 차단 (Netlify Functions 프록시 필수)
- 주민번호 뒷자리 AES-256-GCM 암호화 (서버 측 암/복호화)
- 비밀번호 bcrypt 12라운드 해싱 (SHA-256 레거시 자동 마이그레이션)
- CSP, HSTS, X-Frame-Options 등 보안 헤더 (netlify.toml)
- CORS: `https://noprohr.netlify.app`, `http://localhost:8888`만 허용
- JWT HS256 알고리즘 고정

## 코딩 컨벤션

- **프론트엔드**: 단일 `index.html`에 모든 HTML/CSS/JS 포함 (모노리스 SPA)
- **백엔드**: ES Module (`.mjs` 확장자, `import/export` 사용)
- **함수명**: camelCase (`calcSession`, `renderTable`, `sbSaveAll`)
- **전역 변수**: 대문자 (`EMPS`, `POL`, `REC`, `BONUS_REC`)
- **localStorage 키**: `npm5_` 접두사 (`npm5_emps`, `npm5_rec`)
- **data_key**: snake_case (`leave_settings`, `leave_overrides`)
- **CSS 클래스**: 축약형 (`.pg`, `.sb`, `.nt`, `.ei`, `.tw`, `.et`, `.sc`, `.bk-box`)
- **날짜 형식**: `YYYY-MM-DD` (ISO)
- **시간 형식**: `HH:mm` (24시간)
- **Netlify Function 응답**: `{ statusCode, headers(CORS), body(JSON) }` 형식

## 주요 함수 (index.html)

### 데이터 관리
- `apiFetch(endpoint, method, body)` — API 호출 래퍼
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

## 관리자 패널

`#admin-overlay`에 별도 다크 테마 UI 존재:
- **대시보드**: 총 회사수, 활성 회사수, 월 매출 추정, 총 직원수 추정
- **가입 회사**: 회사 목록 테이블, 검색, 삭제
- **회원 관리**: 사용자 목록 (읽기 전용)

관리자 함수: `admPage(page)`, `admDeleteUser(id)`, `admFilter(val)`

## 작업 시 주의사항

1. `index.html`이 ~7700줄로 매우 크므로, 수정 시 정확한 위치를 파악한 후 편집할 것
2. Netlify Functions는 ES Module 형식 (`.mjs`, `export const handler`)
3. 프론트엔드에서 Supabase URL/키를 직접 참조하지 말 것 (보안)
4. `saveLS()` 호출을 빠뜨리면 데이터가 유실될 수 있음
5. 공휴일(`PH`) 객체는 매년 수동 업데이트 필요
6. CORS 허용 목록 변경 시 모든 Netlify Function의 `corsHeaders`를 일괄 수정할 것
7. 패스워드 관련 수정 시 bcrypt와 SHA-256 양쪽 호환 유지 고려
8. push 시 Netlify 자동 배포가 즉시 이루어지므로 main 브랜치 직접 push 주의
