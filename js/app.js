// ══ API 설정 ══
const API_BASE = '/api';
const AUTH_REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 쿠키 수명 7d 대비 20분마다 /auth-verify 호출해 슬라이딩 갱신 (안전망)
// 활동 기반 자동 갱신: 일반 API 호출 성공 시 30분 쿨다운으로 백그라운드 verify 트리거.
// setInterval은 탭 백그라운드 throttle/슬립 영향을 받지만 활동 기반은 클릭/저장 직후 즉시 실행됨.
const AUTH_ACTIVITY_COOLDOWN_MS = 30 * 60 * 1000;
let _lastActivityRefresh = Date.now();

// 디버깅용: REC 쓰기 이력 추적 (콘솔에서 window.__recWrites 로 확인)
// "입력한 적 없는 데이터가 들어있다" 증상 재현 시 원인 경로 추적용 — 최대 500건 순환
window.__recWrites = window.__recWrites || [];
function __recWrite(source, eid, key, extra){
  try {
    window.__recWrites.push(Object.assign({ts: new Date().toISOString(), source, eid, key}, extra||{}));
    if(window.__recWrites.length > 500) window.__recWrites.shift();
  } catch(e){}
}

// API 호출 헬퍼 (httpOnly 쿠키 기반 인증)
async function apiFetch(endpoint, method='POST', body=null){
  const hdrs={'Content-Type':'application/json'};
  const opts={method,headers:hdrs,credentials:'include'};
  if(body) opts.body=JSON.stringify(body);
  let res;
  try{ res=await fetch(API_BASE+endpoint,opts); }catch(e){
    if(typeof showSyncToast==='function') showSyncToast('네트워크 연결 실패','error');
    throw new Error('네트워크 연결을 확인해주세요');
  }
  const text=await res.text();
  let data;
  try{data=JSON.parse(text);}catch(e){throw new Error('서버 응답 오류 (status:'+res.status+')');}
  const isAuthEndpoint=endpoint.startsWith('/auth-login')||endpoint.startsWith('/auth-signup')||endpoint.startsWith('/auth-verify');
  if(res.status===401 && !isAuthEndpoint){
    if(typeof showSyncToast==='function'){
      showSyncToast('⚠️ 세션이 만료되었습니다. 다시 로그인해주세요.\n저장되지 않은 값은 로컬에 남아있을 수 있습니다.','error',5000);
    }
    authLogout();
    throw new Error('세션이 만료되었습니다');
  }
  if(res.status===429) throw new Error(data.error||'요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
  if(!res.ok) throw new Error(data.error||'서버 오류');
  // 활동 기반 능동 갱신: 일반 API 호출 성공 후 쿨다운 경과 시 백그라운드로 verify 호출.
  // 서버의 shouldRefresh가 만족되면 Set-Cookie로 쿠키가 7일로 리셋됨. 실패해도 무시(fire-and-forget).
  if(!isAuthEndpoint && (Date.now() - _lastActivityRefresh) > AUTH_ACTIVITY_COOLDOWN_MS){
    _lastActivityRefresh = Date.now();
    fetch(API_BASE+'/auth-verify',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include'}).catch(()=>{});
  }
  return data;
}

// XSS 방지 이스케이프
function esc(s){
  if(s==null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// 숫자 입력 필드 콤마 자동 포맷팅 (시급/월급 등)
// oninput에서 호출: 입력 값에서 숫자만 추출 → toLocaleString으로 콤마 삽입, 캐럿 위치 보정
function formatNumInput(el){
  try {
    const caret = el.selectionStart;
    const oldLen = el.value.length;
    const raw = el.value.replace(/[^0-9]/g, '');
    el.value = raw ? parseInt(raw,10).toLocaleString() : '';
    const newLen = el.value.length;
    const diff = newLen - oldLen;
    el.setSelectionRange(caret + diff, caret + diff);
  } catch(e){}
}
// CSS injection 방지: style 속성에 들어가는 색상값 검증
function safeColor(c,fallback){
  if(!c) return fallback||'#DBEAFE';
  return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([0-9,.\s%]+\)|hsla?\([0-9,.\s%deg]+\))$/.test(c)?c:fallback||'#DBEAFE';
}

// ══════════════════════════════════════
// 공휴일 자동 생성 (2024~2040)
// ══════════════════════════════════════
// 음력 공휴일 양력 날짜 테이블: [설날 당일, 부처님오신날, 추석 당일] (MM-DD)
const _LUNAR_HOLIDAYS={
  2024:['02-10','05-15','09-17'],2025:['01-29','05-13','10-06'],2026:['02-17','05-24','09-25'],
  2027:['01-15','05-13','09-15'],2028:['02-04','05-02','10-03'],2029:['01-23','05-20','09-22'],
  2030:['02-12','05-09','09-12'],2031:['01-23','05-28','10-01'],2032:['02-11','05-16','09-19'],
  2033:['01-31','05-06','09-08'],2034:['02-20','05-25','09-27'],2035:['02-08','05-15','09-16'],
  2036:['01-28','05-03','10-04'],2037:['02-16','05-22','09-24'],2038:['02-04','05-11','09-13'],
  2039:['01-24','04-30','10-02'],2040:['02-13','05-18','09-20']
};
function _addDay(dateStr,n){const d=new Date(dateStr);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
function _dow(dateStr){return new Date(dateStr).getDay();}// 0=일,6=토
function _genPH(year){
  const h={};const y=year;
  const add=(d,name)=>{h[d]=h[d]?h[d]+'·'+name:name;};
  // 고정 공휴일
  add(y+'-01-01','신정');add(y+'-03-01','삼일절');add(y+'-05-05','어린이날');
  add(y+'-06-06','현충일');add(y+'-08-15','광복절');add(y+'-10-03','개천절');
  add(y+'-10-09','한글날');add(y+'-12-25','크리스마스');
  // 음력 공휴일
  const lunar=_LUNAR_HOLIDAYS[year];
  if(!lunar)return h;
  const [seol,buddha,chuseok]=lunar;
  const seolDate=y+'-'+seol, chuDate=y+'-'+chuseok;
  // 설날 연휴 (전날+당일+다음날)
  add(_addDay(seolDate,-1),'설날연휴');add(seolDate,'설날');add(_addDay(seolDate,1),'설날연휴');
  // 부처님오신날
  add(y+'-'+buddha,'부처님오신날');
  // 추석 연휴 (전날+당일+다음날)
  add(_addDay(chuDate,-1),'추석연휴');add(chuDate,'추석');add(_addDay(chuDate,1),'추석연휴');
  // 대체공휴일: 설날/추석 연휴 3일 중 일요일과 겹치면 연휴 다음 첫 평일
  [seolDate,chuDate].forEach(base=>{
    const days=[_addDay(base,-1),base,_addDay(base,1)];
    const overlap=days.filter(d=>_dow(d)===0).length; // 일요일 겹침 수
    if(overlap>0){
      let alt=_addDay(base,2);// 연휴 다음날부터
      let added=0;
      while(added<overlap){if(!h[alt]&&_dow(alt)!==0&&_dow(alt)!==6){add(alt,'대체공휴일');added++;}alt=_addDay(alt,1);}
    }
  });
  // 어린이날 대체공휴일: 토/일 겹치면 다음 월요일
  const kids=y+'-05-05';const kd=_dow(kids);
  if(kd===0)add(y+'-05-06','대체공휴일');
  else if(kd===6)add(y+'-05-07','대체공휴일');
  return h;
}
// PH 객체 빌드 (2024~2040)
const PH=(()=>{const all={};for(let y=2024;y<=2040;y++)Object.assign(all,_genPH(y));
  // 수동 보정: 2024 총선
  all['2024-04-10']='총선';
  return all;
})();

// ══ 공휴일 자동 동기화 (한국천문연구원 특일정보 API, 서버 프록시) ══
// 기존 _genPH 폴백은 유지되며, API 성공 시 해당 연도 공휴일이 최신 데이터로 교체됨.
// 대체공휴일·선거일·임시공휴일 등 누락분을 자동 반영.
async function loadHolidaysForYear(year){
  const cacheKey = `npm5_ph_${year}`;
  const TTL = 7 * 24 * 60 * 60 * 1000; // 7일
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && cached.ts && (Date.now() - cached.ts < TTL) && cached.data){
      _mergeHolidays(year, cached.data);
      return true;
    }
  } catch {}
  try {
    const res = await fetch(`/api/holidays-fetch?year=${year}`, { credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0){
      _mergeHolidays(year, data);
      try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data })); } catch {}
      return true;
    }
  } catch(e) { /* 네트워크 실패 시 폴백 유지 */ }
  return false;
}
function _mergeHolidays(year, data){
  const prefix = String(year) + '-';
  Object.keys(PH).forEach(k => { if (k.startsWith(prefix)) delete PH[k]; });
  Object.assign(PH, data);
}
function loadHolidaysAround(baseYear){
  Promise.all([baseYear-1, baseYear, baseYear+1].map(y => loadHolidaysForYear(y))).then(updated => {
    if (updated.some(Boolean)){
      try { if (typeof renderTable === 'function') renderTable(); } catch {}
      try { if (typeof renderMonthly === 'function') renderMonthly(); } catch {}
    }
  });
}

const pad=n=>String(n).padStart(2,'0');
function phKey(y,m,d){return`${y}-${pad(m)}-${pad(d)}`;}
function getPhName(y,m,d){return PH[phKey(y,m,d)]||null;}
function isAutoHol(y,m,d,emp){
  const dow=new Date(y,m-1,d).getDay();
  const ph=document.getElementById('tog-ph')?.checked;

  // 야간 근무자: POL.nightWeekend 기준
  if(emp && emp.shift==='night'){
    const nw = POL.nightWeekend || [5,6];
    if(nw.includes(dow)) return true;
    if(ph&&getPhName(y,m,d)) return true;
    return false;
  }

  // 주간 근무자: POL.dayWeekend 기준
  const dw = POL.dayWeekend || [0,6];
  if(dw.includes(dow)) return true;
  if(ph&&getPhName(y,m,d))return true;
  return false;
}

// ══════════════════════════════════════
// 유틸
// ══════════════════════════════════════
const DOW=['일','월','화','수','목','금','토'];
const dim=(y,m)=>new Date(y,m,0).getDate();
const fdow=(y,m)=>new Date(y,m-1,1).getDay();
const rk=(id,y,m,d)=>`${id}_${y}-${pad(m)}-${pad(d)}`;
const pT=t=>{if(!t||!t.includes(':'))return null;const[h,m]=t.split(':').map(Number);return h*60+m;};
const rEnd=(s,e)=>e<=s?e+1440:e;
// FP 보정 epsilon: 부동소수점 표현 오차(예: 32.98 → 32.979999...)로 인해
// 정확히 .5인 값이 .49999...로 저장되어 "내림"되는 문제 방지.
// 1e-9은 1경분의 1 수준. 정상 계산값엔 영향 없고, FP drift 케이스만 올바르게 올림.
const FP_EPS = 1e-9;
const fmt$=n=>(Math.round(Math.round(n)/10 + FP_EPS)*10).toLocaleString('ko-KR');
// 10원 단위 반올림 (일의 자리 반올림) — FP drift 보정
const r10=n=>Math.round(n/10 + FP_EPS)*10;
// 분→시간 변환: 소수점 셋째 자리에서 반올림 (10분=0.17, 20분=0.33, 40분=0.67) — FP 보정
const m2h=m=>Math.round(m/60*100 + FP_EPS)/100;
const fmtH=m=>{if(!m||m<=0)return '';const hrs=m2h(m);return hrs%1===0?`${hrs}h`:`${hrs.toFixed(2).replace(/0$/,'')}h`;};
function parseTimeInput(raw){
  if(!raw||!raw.trim())return '';
  const s=raw.trim().replace(/[^0-9]/g,'');
  if(!s)return '';
  let h,m;
  if(s.length<=2){h=parseInt(s);m=0;}
  else if(s.length===3){h=parseInt(s[0]);m=parseInt(s.slice(1));}
  else{h=parseInt(s.slice(0,-2));m=parseInt(s.slice(-2));}
  if(isNaN(h)||isNaN(m)||h>23||m>59)return '';
  return`${pad(h)}:${pad(m)}`;
}

// ══════════════════════════════════════
// 핸드폰 번호 자동 포맷 (숫자만 → 010-0000-0000)
// ══════════════════════════════════════
function formatPhone(val){
  const d=val.replace(/[^0-9]/g,'');
  if(d.length<=3) return d;
  if(d.length<=7) return d.slice(0,3)+'-'+d.slice(3);
  return d.slice(0,3)+'-'+d.slice(3,7)+'-'+d.slice(7,11);
}

// ══════════════════════════════════════
// 주민번호 → 나이 계산
// ══════════════════════════════════════
function rrn2age(front,back){
  if(!front||front.length<6)return '';
  const yy=parseInt(front.slice(0,2));
  const mm=parseInt(front.slice(2,4));
  const dd=parseInt(front.slice(4,6));
  if(isNaN(yy)||isNaN(mm)||isNaN(dd)||mm<1||mm>12||dd<1||dd>31)return '';
  const gen=back?parseInt(back[0]):0;
  let year;
  if(gen===1||gen===2)year=1900+yy;
  else if(gen===3||gen===4)year=2000+yy;
  else if(gen===5||gen===6)year=1900+yy;
  else if(gen===7||gen===8)year=2000+yy;
  else if(gen===9||gen===0)year=1800+yy;
  else year=yy<30?2000+yy:1900+yy; // 뒷자리 없으면 연도 추정
  const today=new Date();
  let age=today.getFullYear()-year;
  // 올해 생일이 아직 안 지났으면 -1
  const birthdayThisYear=new Date(today.getFullYear(),mm-1,dd);
  if(today<birthdayThisYear)age--;
  return age>=0&&age<120?age:'';
}
function rrn2gender(back){
  if(!back)return null;
  const g=parseInt(back[0]);
  if(g===1||g===3||g===5||g===7)return 'male';
  if(g===2||g===4||g===6||g===8)return 'female';
  return null;
}
function rrn2nation(back){
  if(!back)return null;
  const g=parseInt(back[0]);
  if(g>=5&&g<=8)return 'foreign';
  return 'local';
}

// ══════════════════════════════════════
// 연차 계산
// ══════════════════════════════════════
function calcAnnualLeave(emp, forYear){
  // calcLeaveForYear 기반 wrapper (지정 연도 또는 뷰 연도 기준)
  const year = forYear || cY || new Date().getFullYear();
  const lv = calcLeaveForYear(emp, year);
  return {total: lv.total, used: lv.used, remain: lv.remain};
}

// ══════════════════════════════════════
// LocalStorage
// ══════════════════════════════════════
const LS={E:'npm5_emps',R:'npm5_rec',P:'npm5_pol',B:'npm5_bk',T:'npm5_tbk',BN:'npm5_bonus',AL:'npm5_allow',TX:'npm5_tax',CL:'npm5_changelog'};
function load(k,def){try{const v=localStorage.getItem(k);return v?JSON.parse(v):def;}catch{return def;}}
let TAX_REC = JSON.parse(localStorage.getItem('npm5_tax')||'{}');
// 특정 날짜에 유효한 값 반환 (from 이하 최신)
// 변경 이력 등록
// 변경 적용 확인 모달 표시
// 전역 임시 저장소 (askChangeDate 콜백용)

// {empId: {'2026-03': {incomeTax:0, localTax:0, otherDed:0, bonusDed:0}}}
function getTaxRec(eid,y,m){
  const k=`${y}-${pad(m)}`;
  return (TAX_REC[eid]&&TAX_REC[eid][k]) ? Object.assign({incomeTax:'',localTax:'',pension:'',health:'',employment:'',otherDed:'',bonusDed:''},TAX_REC[eid][k]) : {incomeTax:'',localTax:'',pension:'',health:'',employment:'',otherDed:'',bonusDed:''};
}
function setTaxRec(eid,y,m,field,val){
  const k=`${y}-${pad(m)}`;
  if(!TAX_REC[eid])TAX_REC[eid]={};
  if(!TAX_REC[eid][k])TAX_REC[eid][k]={incomeTax:'',localTax:'',otherDed:'',bonusDed:''};
  TAX_REC[eid][k][field]=val;
  localStorage.setItem('npm5_tax',JSON.stringify(TAX_REC));
}

// ═══ 월별 정책 스냅샷 헬퍼 ═══
// "YYYY-MM" 키. 해당 월 계산 시 스냅샷이 있으면 그걸 사용, 없으면 현재 POL 사용.
function _polKey(y, m){ return y + '-' + String(m).padStart(2,'0'); }

function getPolForMonth(y, m){
  const snap = POL_SNAPSHOTS[_polKey(y, m)];
  return snap || POL;
}

// REC에서 데이터가 있는 모든 (y,m) 집합을 반환
function _monthsWithData(){
  const set = new Set();
  try {
    Object.keys(REC||{}).forEach(k=>{
      // rk 형식: "empId_YYYY-MM-DD"
      const m = String(k).match(/_(\d{4})-(\d{1,2})-\d{1,2}$/);
      if(m){ set.add(_polKey(parseInt(m[1]), parseInt(m[2]))); }
    });
  } catch(e){}
  return set;
}

// 주어진 POL을 "스냅샷 없는 과거 달(현재월 제외)"에 복사. 이미 스냅샷 있는 달은 건드리지 않음.
// 현재월·미래월은 라이브 POL을 그대로 사용해 변경이 즉시 반영됨.
function freezePastMonthsPol(polToSave){
  try {
    const src = polToSave || POL;
    const now = new Date();
    const curKey = _polKey(now.getFullYear(), now.getMonth()+1);
    const months = _monthsWithData();
    let changed = false;
    months.forEach(key => {
      if(key >= curKey) return; // 현재월·미래는 라이브 POL 사용
      if(!POL_SNAPSHOTS[key]){
        POL_SNAPSHOTS[key] = JSON.parse(JSON.stringify(src));
        changed = true;
      }
    });
    if(changed){
      localStorage.setItem('npm5_pol_snapshots', JSON.stringify(POL_SNAPSHOTS));
    }
    return changed;
  } catch(e){ console.warn('freezePastMonthsPol 실패:', e); return false; }
}

// ═══ 월 확정 급여 스냅샷 헬퍼 ═══
// 확정된 달의 저장된 직원 요약을 반환. 없으면 null.
function getStoredPayment(eid, y, m){
  const key = _polKey(y, m);
  const snap = PAY_SNAPSHOTS[key];
  if(!snap || !snap.confirmed || !snap.summaries) return null;
  return snap.summaries[eid] || null;
}
function isPayMonthConfirmed(y, m){
  const snap = PAY_SNAPSHOTS[_polKey(y, m)];
  return !!(snap && snap.confirmed);
}
function getPayMonthMeta(y, m){
  const snap = PAY_SNAPSHOTS[_polKey(y, m)];
  if(!snap || !snap.confirmed) return null;
  return { confirmedAt: snap.confirmedAt, confirmedBy: snap.confirmedBy };
}

// 지정 월 급여 확정: 현재 재직 중인 모든 직원의 monthSummary를 저장
function confirmPayMonth(y, m){
  // 버그 1 방지: POL 변경 직후 확정 시 미처 찍히지 못한 이전 POL을 과거 달에 먼저 복사.
  // 이렇게 해야 과거 달 계산은 변경 전 설정으로, 현재월 이상은 새 설정으로 확정됨.
  try { if(typeof syncPolSnapshot === 'function') syncPolSnapshot(); } catch(e){}
  const key = _polKey(y, m);
  const monthEnd = new Date(y, m, 0);
  const monthStart = new Date(y, m-1, 1);
  const activeEmps = EMPS.filter(e=>{
    if(e.join){const jd=new Date(e.join);if(jd>monthEnd)return false;}
    if(e.leave){const ld=new Date(e.leave);if(ld<monthStart)return false;}
    return true;
  });
  const summaries = {};
  const failed = [];
  activeEmps.forEach(e=>{
    // monthSummary는 이미 래핑돼 있어 POL 스냅샷 적용됨. 저장값 체크도 내부에 있지만
    // 저장 시에는 _bypassPayStore 플래그로 항상 신선 계산.
    _bypassPayStore = true;
    try { summaries[e.id] = monthSummary(e.id, y, m); }
    catch(ex){ console.error('월 확정 계산 실패 (empId='+e.id+'):', ex); failed.push(e.name||e.id); }
    finally { _bypassPayStore = false; }
  });
  if(failed.length){
    if(typeof showSyncToast==='function'){
      showSyncToast(`⚠️ 일부 직원 계산 실패 — 확정 중단\n${failed.slice(0,3).join(', ')}${failed.length>3?' 외 '+(failed.length-3)+'명':''}`,'error',5000);
    }
    return;
  }
  let sess = null; try { sess = JSON.parse(localStorage.getItem('nopro_session')||'null'); } catch(ex){}
  PAY_SNAPSHOTS[key] = {
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    confirmedBy: sess?.email || sess?.company || 'unknown',
    summaries
  };
  localStorage.setItem('npm5_pay_snapshots', JSON.stringify(PAY_SNAPSHOTS));
  saveLS();
  if(typeof showSyncToast==='function') showSyncToast(`${y}년 ${m}월 급여 확정 완료 (${Object.keys(summaries).length}명)`,'ok',3500);
  if(typeof renderPayroll==='function') renderPayroll();
}

function unconfirmPayMonth(y, m){
  const key = _polKey(y, m);
  if(!PAY_SNAPSHOTS[key]) return;
  if(!confirm(`${y}년 ${m}월 확정을 해제하시겠습니까?\n\n저장된 금액이 삭제되고, 현재 데이터 기반으로 다시 계산됩니다.`)) return;
  delete PAY_SNAPSHOTS[key];
  localStorage.setItem('npm5_pay_snapshots', JSON.stringify(PAY_SNAPSHOTS));
  saveLS();
  if(typeof showSyncToast==='function') showSyncToast(`${y}년 ${m}월 확정 해제됨`,'warn',3000);
  if(typeof renderPayroll==='function') renderPayroll();
}

function recalcPayMonth(y, m){
  const key = _polKey(y, m);
  if(!PAY_SNAPSHOTS[key] || !PAY_SNAPSHOTS[key].confirmed){
    // 확정 안 된 달: 그냥 확정 처리와 동일
    confirmPayMonth(y, m);
    return;
  }
  if(!confirm(`${y}년 ${m}월을 현재 데이터로 재계산하여 덮어쓸까요?\n\n기존에 확정된 금액은 사라집니다.`)) return;
  delete PAY_SNAPSHOTS[key]; // 재계산을 위해 일시 제거
  confirmPayMonth(y, m);
}

// monthSummary 래퍼에서 "저장값 우선" 로직을 건너뛰고 싶을 때 쓰는 플래그 (재계산 시 사용)
let _bypassPayStore = false;

// POL 변경 자동 감지. saveLS 진입 시 호출.
// 이전에 기억해둔 POL과 현재 POL을 비교, 다르면 "변경 직전 상태"를 과거 달에 복사.
let _prevPolForSnapshot = null;
function syncPolSnapshot(){
  try {
    if(!_prevPolForSnapshot){
      _prevPolForSnapshot = JSON.parse(JSON.stringify(POL));
      return;
    }
    if(JSON.stringify(POL) === JSON.stringify(_prevPolForSnapshot)) return;
    freezePastMonthsPol(_prevPolForSnapshot);
    _prevPolForSnapshot = JSON.parse(JSON.stringify(POL));
  } catch(e){ console.warn('syncPolSnapshot 실패:', e); }
}

// ═══ 일별 기본 휴게세트 스냅샷 헬퍼 ═══
// 키 형식: "YYYY-MM-DD". 해당 일 계산 시 스냅샷 있으면 그걸, 없으면 라이브 DEF_BK.
// 변경 직전 값을 과거 일에 freeze → 한 번 저장된 데이터는 새 값으로 절대 덮이지 않음.
// 호환성: 기존 월별("YYYY-MM") 키도 fallback으로 인식.
function _dayKey(y, m, d){ return y + '-' + String(m).padStart(2,'0') + '-' + String(d).padStart(2,'0'); }

// REC에서 데이터가 있는 모든 일자(YYYY-MM-DD) 집합 반환
function _daysWithRec(){
  const set = new Set();
  try {
    Object.keys(REC||{}).forEach(k=>{
      // rk 형식: "empId_YYYY-MM-DD" (zero-padded)
      const m = String(k).match(/_(\d{4}-\d{2}-\d{2})$/);
      if(m){ set.add(m[1]); }
    });
  } catch(e){}
  return set;
}

function getBkForDay(y, m, d){
  if(typeof BK_SNAPSHOTS === 'undefined') return DEF_BK;
  // 일별 스냅샷 우선
  const dKey = _dayKey(y, m, d);
  if(BK_SNAPSHOTS[dKey]) return BK_SNAPSHOTS[dKey];
  // 호환: 마이그레이션 전 월별 스냅샷이 있으면 그걸 사용
  const mKey = _polKey(y, m);
  if(BK_SNAPSHOTS[mKey]) return BK_SNAPSHOTS[mKey];
  return DEF_BK;
}

function freezePastDaysBk(bkToSave){
  try {
    if(typeof BK_SNAPSHOTS === 'undefined') return false;
    const src = bkToSave || DEF_BK;
    if(!Array.isArray(src) || src.length === 0) return false; // 빈값은 freeze 안 함
    const now = new Date();
    const todayKey = _dayKey(now.getFullYear(), now.getMonth()+1, now.getDate());
    const days = _daysWithRec();
    let changed = false;
    days.forEach(key => {
      if(key >= todayKey) return; // 오늘·미래 일자는 라이브 DEF_BK 사용
      if(!BK_SNAPSHOTS[key]){     // 🛡️ 이미 freeze된 일자는 절대 덮어쓰지 않음
        BK_SNAPSHOTS[key] = JSON.parse(JSON.stringify(src));
        changed = true;
      }
    });
    if(changed){
      localStorage.setItem('npm5_bk_snapshots', JSON.stringify(BK_SNAPSHOTS));
    }
    return changed;
  } catch(e){ console.warn('freezePastDaysBk 실패:', e); return false; }
}

let _prevBkForSnapshot = null;
function syncBkSnapshot(){
  try {
    if(typeof DEF_BK === 'undefined') return;
    if(!_prevBkForSnapshot){
      _prevBkForSnapshot = JSON.parse(JSON.stringify(DEF_BK));
      return;
    }
    if(JSON.stringify(DEF_BK) === JSON.stringify(_prevBkForSnapshot)) return;
    // 변경 감지: 이전 값(=과거 일이 사용했던 값)을 과거 일에 freeze
    freezePastDaysBk(_prevBkForSnapshot);
    _prevBkForSnapshot = JSON.parse(JSON.stringify(DEF_BK));
  } catch(e){ console.warn('syncBkSnapshot 실패:', e); }
}

// 서버에 아직 전송 안 된 로컬 변경이 있는지 추적 (beforeunload 경고용)
let _hasUnsavedChanges = false;

// 🛡️ 단일 키 서버 저장 래퍼 — 직접 /data-save 호출 시 반드시 이 함수 사용.
// sbSaveAll을 우회하는 경로에도 동일한 "빈값 덮어쓰기 차단" 가드 적용.
async function safeItemSave(key, value){
  const snap = (typeof _syncedSnapshot!=='undefined' && _syncedSnapshot) || null;
  const isEmpty = v => v==null || (Array.isArray(v)?v.length===0:(typeof v==='object' && Object.keys(v).length===0));
  const snapHas = s => {
    if(s==null) return false;
    try { const p = typeof s==='string'?JSON.parse(s):s; return Array.isArray(p)?p.length>0:(typeof p==='object' && Object.keys(p).length>0); } catch(e){ return false; }
  };
  const PROTECTED = new Set(['emps','rec','bonus','allow','tax','tbk','safety','bk']);
  // 🛡️ 우회 경로 없음 — 빈값 저장은 무조건 차단
  if(PROTECTED.has(key) && isEmpty(value)){
    if(snap === null){
      console.warn('🛡️ safeItemSave: 초기 로드 전 빈값 저장 차단 ('+key+')');
      return {blocked:true};
    }
    if(snapHas(snap[key])){
      console.warn('🛡️ safeItemSave: 빈값 덮어쓰기 차단 ('+key+')');
      return {blocked:true};
    }
  }
  return apiFetch('/data-save','POST',{key,value});
}

// ── 저장 상태 인디케이터 ──
// 'saved' = 🟢 저장됨, 'saving' = 🟡 저장 중, 'unsaved' = 🔴 미저장(서버 실패 또는 대기)
function setSyncStatus(state, msg){
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-text');
  if(!dot || !text) return;
  const conf = {
    saved:   {color:'#22C55E', glow:'rgba(34,197,94,.6)',  label:'저장됨'},
    saving:  {color:'#EAB308', glow:'rgba(234,179,8,.6)',  label:'저장 중...'},
    unsaved: {color:'#EF4444', glow:'rgba(239,68,68,.7)',  label:'미저장'}
  }[state] || {color:'#9CA3AF', glow:'rgba(156,163,175,.4)', label:state};
  dot.style.background = conf.color;
  dot.style.boxShadow = '0 0 6px ' + conf.glow;
  text.textContent = msg || conf.label;
}

function saveLS(){
  // POL/DEF_BK 변경 자동 감지 → 직전 상태를 과거 달에 복사 (변경 이후 과거 조회 시 옛 설정 사용 보장)
  try { syncPolSnapshot(); } catch(e){}
  try { if(typeof syncBkSnapshot === 'function') syncBkSnapshot(); } catch(e){}
  setSyncStatus('saving');
  try{
    localStorage.setItem(LS.E,JSON.stringify(EMPS));
    localStorage.setItem(LS.P,JSON.stringify(POL));
    localStorage.setItem(LS.B,JSON.stringify(DEF_BK));
    localStorage.setItem(LS.T,JSON.stringify(TBK));
    localStorage.setItem(LS.R,JSON.stringify(REC));
    localStorage.setItem(LS.BN,JSON.stringify(BONUS_REC));
    localStorage.setItem(LS.AL,JSON.stringify(ALLOWANCE_REC));
    sfSave();
  }catch(e){console.warn(e);}
  _hasUnsavedChanges = true;
  // Supabase 자동 동기화 (즉시 실행, debounce)
  try{
    const _sess = JSON.parse(localStorage.getItem('nopro_session')||'null');
    if(_sess && _sess.companyId){
      // debounce: 연속 저장 방지 (500ms)
      if(saveLS._timer) clearTimeout(saveLS._timer);
      saveLS._timer = setTimeout(async ()=>{
        try {
          await sbSaveAll(_sess.companyId);
          _hasUnsavedChanges = false;
          setSyncStatus('saved');
        } catch(e) {
          console.warn('Supabase 저장 오류:',e);
          setSyncStatus('unsaved', '미저장(재시도 대기)');
          if(typeof showSyncToast==='function'){
            showSyncToast('⚠️ 서버 저장 실패\n네트워크 상태를 확인해주세요. 로컬에는 저장됨.','error',5000);
          }
        }
      }, 500);
    }
  }catch(e){}
}

// 디바운스 중인 저장을 즉시 서버로 전송 (수당 추가/삭제 등 유실 방지 필요한 동작용)
function flushPendingSave(){
  try{
    if(saveLS._timer){ clearTimeout(saveLS._timer); saveLS._timer=null; }
    const _sess = JSON.parse(localStorage.getItem('nopro_session')||'null');
    if(_sess && _sess.companyId){
      return sbSaveAll(_sess.companyId)
        .then(()=>{ _hasUnsavedChanges = false; })
        .catch(e=>console.warn('즉시 저장 실패:',e));
    }
  }catch(e){}
}

// 페이지 이탈 직전 pending 저장을 beacon으로 신뢰성 있게 전송
// (beforeunload 시점엔 일반 fetch는 취소될 수 있으나 sendBeacon은 OS 레벨 큐에 적재)
function _flushSaveOnUnload(){
  if(!saveLS._timer) return;  // pending 없으면 스킵
  try{
    clearTimeout(saveLS._timer); saveLS._timer=null;
    const _sess = JSON.parse(localStorage.getItem('nopro_session')||'null');
    if(!_sess || !_sess.companyId) return;
    if(typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    let items = [
      {key:'emps', value:EMPS},
      {key:'pol', value:POL},
      {key:'bk', value:DEF_BK},
      {key:'bonus', value:BONUS_REC},
      {key:'allow', value:ALLOWANCE_REC},
      {key:'tax', value:JSON.parse(localStorage.getItem('npm5_tax')||'{}')},
      {key:'leave_settings', value:JSON.parse(localStorage.getItem('npm5_leave_settings')||'{}')},
      {key:'leave_overrides', value:JSON.parse(localStorage.getItem('npm5_leave_overrides')||'{}')},
    ];
    // 🛡️ 가드: sbSaveAll과 동일한 빈값 덮어쓰기 방어 (beacon이 sbSaveAll 우회 못하도록)
    const snap = (typeof _syncedSnapshot!=='undefined' && _syncedSnapshot) || {};
    const isEmpty = v => v==null || (Array.isArray(v)?v.length===0:(typeof v==='object' && Object.keys(v).length===0));
    const snapHas = s => {
      if(s==null) return false;
      try { const p = typeof s==='string'?JSON.parse(s):s; return Array.isArray(p)?p.length>0:(typeof p==='object' && Object.keys(p).length>0); } catch(e){ return false; }
    };
    // 🛡️ 우회 경로 없음 — 빈값 저장 조건 없이 무조건 차단
    const guardKeys = new Set(['emps','bonus','allow','tax']);
    const snapNull = (typeof _syncedSnapshot==='undefined' || _syncedSnapshot === null);
    items = items.filter(it => {
      if(!guardKeys.has(it.key)) return true;
      if(isEmpty(it.value)){
        if(snapNull){
          console.warn('🛡️ beacon: 초기 로드 전 빈값 저장 차단 ('+it.key+')');
          return false;
        }
        if(snapHas(snap[it.key])){
          console.warn('🛡️ beacon: 빈값 덮어쓰기 차단 ('+it.key+')');
          return false;
        }
      }
      return true;
    });
    if(!items.length) return;
    const blob = new Blob([JSON.stringify({items})], {type:'application/json'});
    navigator.sendBeacon((typeof API_BASE!=='undefined'?API_BASE:'')+'/data-save', blob);
  }catch(e){ console.warn('beacon 저장 실패:', e); }
}
window.addEventListener('pagehide', _flushSaveOnUnload);
window.addEventListener('beforeunload', _flushSaveOnUnload);
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden') _flushSaveOnUnload();
});

// 미저장 변경사항이 있으면 탭 닫기 전에 브라우저 네이티브 확인창 표시
window.addEventListener('beforeunload', (e)=>{
  if(_hasUnsavedChanges){
    e.preventDefault();
    e.returnValue = '변경사항이 아직 서버에 저장되지 않았습니다.';
    return e.returnValue;
  }
});

// 탭/창 복귀 시 서버 최신값 자동 반영 (동시 접속 반영 — 옵션 A)
// 내 편집 중 값이 덮어쓰이지 않도록: blur → pending flush → sbLoadAll 순서
async function reloadOnFocus(){
  if(document.hidden) return;
  const now = Date.now();
  if(now - (reloadOnFocus._lastAt||0) < 3000) return; // 중복 방지 (focus+visibilitychange 동시 발화)
  const _sess = (()=>{ try { return JSON.parse(localStorage.getItem('nopro_session')||'null'); } catch(e){ return null; }})();
  if(!_sess || !_sess.companyId) return;
  reloadOnFocus._lastAt = now;
  try {
    const ae = document.activeElement;
    if(ae && typeof ae.blur === 'function' && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')){
      ae.blur();
    }
    if(saveLS._timer && typeof flushPendingSave === 'function'){
      await flushPendingSave();
    }
    await sbLoadAll(_sess.companyId);
    // sbLoadAll이 메모리에 반영하지 않는 연차 override/settings도 동기화
    try { if(typeof loadLeaveOverrides === 'function') leaveOverrides = loadLeaveOverrides(); } catch(e){}
    try { leaveSettings = JSON.parse(localStorage.getItem('npm5_leave_settings')||'{}'); } catch(e){}
    const active = document.querySelector('.pg.on');
    if(!active) return;
    const p = active.id.replace('pg-','');
    if(p==='daily' && typeof renderTable==='function') renderTable();
    else if(p==='monthly' && typeof renderMonthly==='function') renderMonthly();
    else if(p==='payroll' && typeof renderPayroll==='function') renderPayroll();
    else if(p==='emps' && typeof renderEmps==='function') renderEmps();
    else if(p==='leave' && typeof renderLeave==='function') renderLeave();
    else if(p==='company' && typeof renderCompany==='function') renderCompany();
    else if(p==='shift' && typeof renderShiftList==='function') renderShiftList();
    else if(p==='safety' && typeof renderSafety==='function') renderSafety();
    else if(p==='folder' && typeof renderFolder==='function') renderFolder();
    else if(p==='settings'){
      if(typeof renderDefBk==='function') renderDefBk();
      if(typeof renderAllowanceList==='function') renderAllowanceList();
    }
    if(typeof renderSb==='function'){
      const sbInp = document.getElementById('sb-search-inp');
      renderSb(sbInp?.value||'');
    }
  } catch(e){
    console.warn('focus 재로드 실패:', e);
  }
}
window.addEventListener('focus', reloadOnFocus);
document.addEventListener('visibilitychange', ()=>{
  if(!document.hidden) reloadOnFocus();
});

// ══════════════════════════════════════
// 상태
// ══════════════════════════════════════
let cY=new Date().getFullYear(),cM=new Date().getMonth()+1,cD=new Date().getDate();
let vY=cY,vM=cM,vEid=1,vMode='cal',pY=cY,pM=cM,pvMode='card';
let bkNid=20,bkEdit=false,dragIdx=null,empDragIdx=null;

const DEF_EMPS=[];
const DEF_POL={
  basePayMode:'fixed',size:'u5',juhyu:false,
  baseRate:11750,baseMonthly:2455750,sot:209,
  nt:true,ot:true,hol:true,nightStart:22,
  ntFixed:true,otFixed:true,holFixed:true,extFixed:true,
  ntHourly:true,otHourly:true,holHourly:true,
  holMonthly:true,holMonthlyStd:true,holMonthlyOt:true,dedMonthly:true,
  dupMode:'legal',dedMode:'hour',
  alMode:'legal',alYear:15,alMonth:1,
  dayWeekend:[0,6],
  nightWeekend:[5,6],
  allowances:[
    {id:'ability',name:'능력수당',isDeduct:false},
    {id:'position',name:'직급수당',isDeduct:false},
    {id:'career',name:'경력수당',isDeduct:false},
    {id:'transport',name:'교통비',isDeduct:false},
    {id:'car',name:'차량유지비(비과세)',isDeduct:false},
    {id:'meal',name:'식대(비과세)',isDeduct:false},
    {id:'deduct',name:'기타공제(가불및선지급)',isDeduct:true}
  ]
};

let EMPS=load(LS.E,null)||[];
let POL=Object.assign({...DEF_POL},load(LS.P,{}));
// 월별 정책 스냅샷: "YYYY-MM" → POL 복사본. 과거 달 계산 시 그 달 스냅샷 사용.
let POL_SNAPSHOTS = JSON.parse(localStorage.getItem('npm5_pol_snapshots')||'{}');
let BK_SNAPSHOTS = JSON.parse(localStorage.getItem('npm5_bk_snapshots')||'{}');
// 월 확정 급여 스냅샷: "YYYY-MM" → { confirmed, confirmedAt, confirmedBy, summaries:{empId: monthSummary 결과} }
// 확정된 달은 monthSummary 대신 이 저장값을 그대로 사용 → 어떤 데이터 수정에도 금액 고정
let PAY_SNAPSHOTS = JSON.parse(localStorage.getItem('npm5_pay_snapshots')||'{}');
// 기본 수당항목 보장 (localStorage에 빈 배열 저장돼있어도 기본값 복원)
const DEF_ALLOW_IDS = ['ability','position','career','transport','car','meal','deduct'];
const FIXED_ALLOWS = ['능력수당','직급수당','경력수당','교통비','차량유지비(비과세)','식대(비과세)','기타공제(가불및선지급)'];

if(!POL.allowances||POL.allowances.length===0){
  POL.allowances=[...DEF_POL.allowances];
} else {
  // 기본 수당 중 없는 것만 앞에 추가
  DEF_POL.allowances.forEach(da=>{
    const existing = POL.allowances.find(a=>a.id===da.id);
    if(!existing) POL.allowances.unshift({...da});
    else if(existing.isDeduct===undefined) existing.isDeduct=da.isDeduct||false;
  });
  // 기존 수당에 isDeduct 없으면 false 기본값
  POL.allowances.forEach(a=>{ if(a.isDeduct===undefined) a.isDeduct=false; });
}
let DEF_BK=load(LS.B,null)||[{id:1,start:'12:00',end:'13:00'},{id:2,start:'18:00',end:'18:30'}];
let TBK=load(LS.T,{});
let REC=load(LS.R,{});
let BONUS_REC=load(LS.BN,{});
let ALLOWANCE_REC=load(LS.AL,{});

function getEmpPayMode(emp){const m=emp.payMode||POL.basePayMode;return m==='monthly'?'monthly':m==='hourly'?'hourly':m==='pohal'?'pohal':'fixed';}
function getEmpPayModeLabel(emp){
  const m=getEmpPayMode(emp);
  if(m==='fixed')return{text:'통상임금제',cls:'emb-fixed'};
  if(m==='hourly')return{text:'시급제',cls:'emb-hourly'};
  if(m==='monthly'||m==='pohal')return{text:'포괄임금제',cls:'emb-pohal'};
  return{text:'통상임금제',cls:'emb-fixed'};
}
function getEmpShiftLabel(emp){
  return emp.shift==='night'?{text:'야간',color:'#4C1D95',bg:'#EDE9FE'}:{text:'주간',color:'#92400E',bg:'#FEF3C7'};
}
// 특정 날짜에 유효한 변경 이력값 조회
function getEmpRate(emp){
  const mode=getEmpPayMode(emp);
  if(mode==='monthly'){
    // 통상시급 = 월급 ÷ 209h
    const monthly=emp.monthly!==null&&emp.monthly!==undefined?emp.monthly:POL.baseMonthly;
    return Math.round(monthly/209);
  }
  return emp.rate!==null&&emp.rate!==undefined?emp.rate:POL.baseRate;
}

function getEmpMonthly(emp){return emp.monthly!==null&&emp.monthly!==undefined?emp.monthly:POL.baseMonthly;}
function getMonthBonus(eid,y,m){
  const key=`${y}-${pad(m)}`;
  if(BONUS_REC[eid]&&BONUS_REC[eid][key]!==undefined)return BONUS_REC[eid][key];
  return 0;
}
function setMonthBonus(eid,y,m,val){
  if(!BONUS_REC[eid])BONUS_REC[eid]={};
  BONUS_REC[eid][`${y}-${pad(m)}`]=val;
  // 상여금은 선지급 처리 → 기타공제(가불및선지급)에 같은 금액 자동 연동
  setMonthAllowance(eid,y,m,'deduct', val||0);
  saveLS();
}
function getMonthAllowance(eid,y,m,aid){
  const key=`${y}-${pad(m)}`;
  // 해당 월에 값이 있으면 반환
  if(ALLOWANCE_REC[eid]&&ALLOWANCE_REC[eid][key]&&ALLOWANCE_REC[eid][key][aid]!==undefined)
    return ALLOWANCE_REC[eid][key][aid];
  // 없으면 이전 달에서 캐리포워드 (최대 24개월)
  let cy=y, cm=m;
  for(let i=0;i<24;i++){
    cm--;if(cm<1){cm=12;cy--;}
    const pk=`${cy}-${pad(cm)}`;
    if(ALLOWANCE_REC[eid]&&ALLOWANCE_REC[eid][pk]&&ALLOWANCE_REC[eid][pk][aid]!==undefined)
      return ALLOWANCE_REC[eid][pk][aid];
  }
  return 0;
}
// 해당 월에 직접 입력된 값인지 (캐리포워드가 아닌)
function hasDirectAllowance(eid,y,m,aid){
  const key=`${y}-${pad(m)}`;
  return !!(ALLOWANCE_REC[eid]&&ALLOWANCE_REC[eid][key]&&ALLOWANCE_REC[eid][key][aid]!==undefined);
}
function setMonthAllowance(eid,y,m,aid,val){
  const key=`${y}-${pad(m)}`;
  if(!ALLOWANCE_REC[eid])ALLOWANCE_REC[eid]={};
  if(!ALLOWANCE_REC[eid][key])ALLOWANCE_REC[eid][key]={};
  ALLOWANCE_REC[eid][key][aid]=val;saveLS();
}
// ══ 통상임금 포함 플래그 ══
function getAllowOrdinary(eid,aid){
  if(!ALLOWANCE_REC[eid]||!ALLOWANCE_REC[eid]['_ordinary']) return false;
  return !!ALLOWANCE_REC[eid]['_ordinary'][aid];
}
function setAllowOrdinary(eid,aid,val){
  if(!ALLOWANCE_REC[eid])ALLOWANCE_REC[eid]={};
  if(!ALLOWANCE_REC[eid]['_ordinary'])ALLOWANCE_REC[eid]['_ordinary']={};
  ALLOWANCE_REC[eid]['_ordinary'][aid]=!!val;
  saveLS();
}
// ══ 통상시급 계산 ══
function getOrdinaryRate(emp,y,m){
  const baseRate=getEmpRateAt(emp,y,m,1);
  let ordSum=0;
  (POL.allowances||[]).forEach(a=>{
    if(a.isDeduct) return;
    if(!getAllowOrdinary(emp.id,a.id)) return;
    ordSum+=getMonthAllowance(emp.id,y,m,a.id);
  });
  if(ordSum===0) return baseRate;
  return Math.round((baseRate*209+ordSum)/209);
}

// ══════════════════════════════════════
// 계산 엔진
// ══════════════════════════════════════
function getActiveBk(y,m,d,emp){
  const dayKey=`${y}-${pad(m)}-${pad(d)}`;
  // 우선순위: 일별 임시(TBK) > 일별 스냅샷(BK_SNAPSHOTS[YYYY-MM-DD]) > 월별 스냅샷(호환) > 라이브 DEF_BK
  let bks;
  if(TBK[dayKey]) bks = TBK[dayKey];
  else if(typeof getBkForDay === 'function') bks = getBkForDay(y, m, d);
  else bks = DEF_BK;
  // 직원이 지정된 경우 shift 필터 적용 — 'all' 또는 같은 shift만 통과 (필드 없으면 'all'로 간주)
  if(!emp || !Array.isArray(bks)) return bks;
  const empShift = emp.shift || 'day';
  return bks.filter(b => {
    const bs = b.shift || 'all';
    return bs === 'all' || bs === empShift;
  });
}
function calcBkDeduct(sMin,eMin,bks){
  let t=0;
  bks.forEach(b=>{
    // {start/end} 또는 {s/e} 두 형식 모두 지원
    let bs=pT(b.start!==undefined?b.start:b.s);
    let be=pT(b.end!==undefined?b.end:b.e);
    if(bs===null||be===null)return;
    // 자정 월담 근무 처리: 근무구간이 1440 넘는 경우
    // 휴게가 자정 이후(0~06시)라면 +1440해서 타임라인 맞춤
    if(eMin > 1440){
      // 휴게 시작이 근무 시작보다 작으면 (자정 이후 구간) +1440
      if(bs < sMin) bs += 1440;
      if(be <= bs && be < sMin) be += 1440;  // 종료도 같이 올림
      else if(be < bs) be += 1440;           // 00:00 같은 경우
    }
    // 휴게 내부 자정 월담 (예: 23:00~01:00)
    if(be < bs) be += 1440;
    const os=Math.max(sMin,bs), oe=Math.min(eMin,be);
    if(oe>os)t+=oe-os;
  });
  return t;
}
function calcNightMins(sMin,eMin,bks,outTimes){
  const ns=POL.nightStart*60;
  let n=0;
  for(let t=sMin;t<eMin;t++){
    // 이 분이 휴게시간이면 야간에서 제외
    if(bks){
      let inBk=false;
      for(let i=0;i<bks.length;i++){
        // {start/end} 또는 {s/e} 두 형식 모두 지원
        let bs=pT(bks[i].start!==undefined?bks[i].start:bks[i].s);
        let be=pT(bks[i].end!==undefined?bks[i].end:bks[i].e);
        if(bs===null||be===null)continue;
        // 자정 월담 처리
        if(eMin>1440){
          if(bs<sMin) bs+=1440;
          if(be<=bs&&be<sMin) be+=1440;
          else if(be<bs) be+=1440;
        }
        if(be<bs) be+=1440;
        if(t>=bs&&t<be){inBk=true;break;}
      }
      if(inBk)continue;
    }
    // 외출시간 제외
    if(outTimes&&outTimes.length){
      let inOut=false;
      for(let i=0;i<outTimes.length;i++){
        const os=pT(outTimes[i].s),oe=pT(outTimes[i].e);
        if(os===null||oe===null)continue;
        let oeAdj=oe<os?oe+1440:oe;
        if(t>=os&&t<oeAdj){inOut=true;break;}
      }
      if(inOut)continue;
    }
    const h=t%1440;
    if(h>=ns||h<360)n++;
  }
  return n;
}
// 휴게시간 중 야간대(22~06시)에 해당하는 분 계산
function calcNightBkMins(sMin,eMin,bks){
  const ns=(POL.nightStart||22)*60;
  let n=0;
  if(!bks||!bks.length) return 0;
  bks.forEach(b=>{
    let bs=pT(b.start!==undefined?b.start:b.s);
    let be=pT(b.end!==undefined?b.end:b.e);
    if(bs===null||be===null)return;
    if(eMin>1440){ if(bs<sMin) bs+=1440; if(be<=bs&&be<sMin) be+=1440; else if(be<bs) be+=1440; }
    if(be<bs) be+=1440;
    const os=Math.max(sMin,bs), oe=Math.min(eMin,be);
    if(oe<=os) return;
    for(let t=os;t<oe;t++){
      const h=t%1440;
      if(h>=ns||h<360) n++;
    }
  });
  return n;
}

function calcSession(start,end,rate,isHol,bks,outTimes,empMode,premiumRate){
  // premiumRate: 통상시급 (가산수당 계산용). 미지정 시 rate 사용
  const pRate=premiumRate||rate;
  const s=pT(start),eR=pT(end);if(s===null||eR===null)return null;
  const e=rEnd(s,eR);
  const gross=e-s;
  const bkMins=calcBkDeduct(s,e,bks);
  const nightBkMins=calcNightBkMins(s,e,bks);
  const deduct=bkMins+(calcOutMins(outTimes)||0);
  const work=Math.max(0,gross-deduct);
  const nightM=calcNightMins(s,e,bks,outTimes); // 22~06 야간 분
  const dayM=Math.max(0,work-nightM);
  const ot=Math.max(0,work-480);
  const crossed=eR<=s;
  const mode=empMode||POL.basePayMode;

  // 연장 구간 분리 (야간/주간)
  const otNight=Math.max(0, nightM - Math.max(0, 480-dayM));
  const otDay=Math.max(0, ot-otNight);

  if(mode==='pohal'){
    // 평일: 수당 미산출 (기존 동일)
    // 휴일 특근: 휴게시간(bks) 자동 공제된 실근무(work)로 계산
    let holDayStdPay=0,holDayOtPay=0;
    if(isHol){
      const _holMS=POL.holMonthlyStd??true;
      const _holMO=POL.holMonthlyOt??true;
      // 통상시급 = 포괄임금 월급 ÷ 209h
      const pohalRate=pRate||Math.round((POL.baseMonthly||2455750)/209);
      if(_holMS){
        const stdM=Math.min(work,480);
        holDayStdPay=r10(pohalRate*1.5*m2h(stdM));
      }
      if(_holMO){
        const otM=Math.max(0,work-480);
        holDayOtPay=r10(pohalRate*2.0*m2h(otM));
      }
    }
    const totalPay=holDayStdPay+holDayOtPay;
    return{gross,deduct,bkMins,nightBkMins,work,nightM,otDay,otNight,ot,crossed,
      basePay:0,nightPay:0,otDayPay:0,otNightPay:0,
      holDayStdPay,holNightStdPay:0,holDayOtPay,holNightOtPay:0,totalPay};
  }

  if(mode==='monthly'){
    // 월급제: 통상시급 = 월급÷209h (rate = monthly/209)
    let holDayStdPay=0,holDayOtPay=0;
    const _holM  = POL.holMonthly??true;
    const _holMS = POL.holMonthlyStd??true;
    const _holMO = POL.holMonthlyOt??true;
    if(isHol&&_holM){
      const stdM=Math.min(work,480);
      const otM=Math.max(0,work-480);
      if(_holMS) holDayStdPay=r10(pRate*1.5*m2h(stdM));
      if(_holMO) holDayOtPay =r10(pRate*2.0*m2h(otM));
    }
    const totalPay=holDayStdPay+holDayOtPay;
    return{gross,deduct,bkMins,nightBkMins,work,nightM:0,otDay:0,otNight:0,ot:Math.max(0,work-480),crossed,
      basePay:0,nightPay:0,otDayPay:0,otNightPay:0,
      holDayStdPay,holNightStdPay:0,holDayOtPay,holNightOtPay:0,totalPay};
  }

  const isU5 = POL.size === 'u5'; // 5인 미만: 가산수당 법적 의무 없음

  if(mode==='fixed'){
    // ── 통상임금제 새 계산 로직 ──
    // 소정근로외 실근무: 평일=8h초과분, 휴일=전체 근무시간 (×1.0)
    // 고정야간: 22~06시 전체 구간 (×0.5)
    // 초과연장: 8h초과 중 야간구간 겹치는 부분 (×0.5 추가)
    // 초과휴일: 휴일 전체 근무시간 (×0.5)

    const _ntF=POL.ntFixed??POL.nt??true;
    const _otF=POL.otFixed??POL.ot??true;
    const _holF=POL.holFixed??POL.hol??true;

    // 소정근로외 실근무시간
    const extraWork = isHol ? work : Math.max(0, work-480);
    // 초과연장시간 (8h초과 중 야간구간)
    const overNight = otNight; // 야간연장
    const overDay   = otDay;   // 주간연장

    // 수당 계산
    // 기본급 부분(소정 내)은 기본급에 포함
    let basePay = 0; // 통상임금제는 기본급 월합산으로 처리
    // 소정근로외 실근무수당 (×1.0) - 평일 8h초과 or 휴일 전체
    const _extF = POL.extFixed??true;
    let extraWorkPay = _extF ? r10(pRate*1.0*m2h(extraWork)) : 0;
    // 고정야간수당 (×0.5) - 야간 전체 구간
    let nightPay = _ntF ? r10(pRate*0.5*m2h(nightM)) : 0;
    // 주간연장 가산수당 (×0.5 추가) - 8h초과 주간 구간
    let otDayPay = (_otF&&overDay>0) ? r10(pRate*0.5*m2h(overDay)) : 0;
    // 야간연장 가산수당 (×0.5 추가) - 8h초과 야간 구간
    let otNightPay = (_otF&&_ntF&&overNight>0) ? r10(pRate*0.5*m2h(overNight)) : 0;
    // 초과휴일수당 (×0.5)
    let holPay = (_holF&&isHol) ? r10(pRate*0.5*m2h(work)) : 0;

    // holDayStdPay 등 기존 필드 호환용
    const holDayStdPay  = holPay;
    const holNightStdPay= 0;
    const holDayOtPay   = 0;
    const holNightOtPay = 0;

    const totalPay=extraWorkPay+otDayPay+nightPay+otNightPay+holPay;
    return{gross,deduct,bkMins,nightBkMins,work,nightM,otDay,otNight,ot,crossed,
      basePay,nightPay,otDayPay,otNightPay,
      holDayStdPay,holNightStdPay,holDayOtPay,holNightOtPay,
      extraWorkPay,holPay,totalPay};

  } else {
    // ── 시급제 ──
    let basePay=0,nightPay=0,otDayPay=0,otNightPay=0;
    let holDayStdPay=0,holNightStdPay=0,holDayOtPay=0,holNightOtPay=0;

    const _ntH=POL.ntHourly??true;
    const _otH=POL.otHourly??true;
    const _holH=POL.holHourly??true;
    if(isHol&&_holH){
      // 시급제 휴일 가산 (통상시급 기준)
      const holDayStd  = Math.min(dayM,480);
      const holNtStd   = Math.min(nightM, Math.max(0,480-dayM));
      holDayStdPay  = r10(pRate*1.5*m2h(holDayStd));
      holNightStdPay= r10(pRate*2.0*m2h(holNtStd));
      holDayOtPay   = r10(pRate*2.0*m2h(otDay));
      holNightOtPay = r10(pRate*2.5*m2h(otNight));
    } else {
      // 평일: basePay = 주간+야간 전체 실근무 ×1.0 (통상임���제와 동일 구조)
      basePay = r10(rate*1.0*m2h(Math.min(dayM,480)+Math.min(nightM,480)));
      // nightPay: 야간 ���산만 ×0.5 (토글 OFF시 0)
      nightPay = _ntH ? r10(pRate*0.5*m2h(Math.min(nightM,480))) : 0;
      if(_otH&&otDay>0)   otDayPay  = r10(pRate*1.5*m2h(otDay));
      if(_otH&&otNight>0) otNightPay= r10(pRate*2.0*m2h(otNight));
    }
    const totalPay=basePay+nightPay+otDayPay+otNightPay+holDayStdPay+holNightStdPay+holDayOtPay+holNightOtPay;
    return{gross,deduct,bkMins,nightBkMins,work,nightM,otDay,otNight,ot,crossed,
      basePay,nightPay,otDayPay,otNightPay,
      holDayStdPay,holNightStdPay,holDayOtPay,holNightOtPay,totalPay};
  }
}

function monthSummary(eid,y,m){
  // 월 확정 저장값이 있으면 계산 건너뛰고 저장값 그대로 반환 (확정 해제 전까지 금액 고정)
  if(!_bypassPayStore){
    const stored = getStoredPayment(eid, y, m);
    if(stored) return stored;
  }
  // 해당 월의 정책 스냅샷이 있으면 임시로 POL을 교체. 계산 끝나면 finally에서 복원.
  // 과거 달 조회 시 "그 달의 설정"으로 계산되도록 함.
  const _origPOL = POL;
  const _monthPOL = (typeof getPolForMonth==='function') ? getPolForMonth(y, m) : POL;
  const _polSwapped = _monthPOL !== _origPOL;
  if(_polSwapped) POL = _monthPOL;
  try {
  const emp=EMPS.find(e=>e.id===eid);
  if(!emp)return{wdays:0,adays:0,aldays:0,twkH:0,tNightH:0,tOtDayH:0,tOtNightH:0,tHolDayH:0,tHolNightH:0,tHolDayOtH:0,tHolNightOtH:0,tBase:0,tNightPay:0,tOtDayPay:0,tOtNightPay:0,tHolDayPay:0,tHolNightPay:0,tHolDayOtPay:0,tHolNightOtPay:0,annualPay:0,wkly:0,bonus:0,allowances:{},totalAllowance:0,deduction:0,total:0};
  // 입사일 이전 월이면 빈 결과
  if(emp.join){const jd=new Date(emp.join);if(jd>new Date(y,m,0))return{wdays:0,adays:0,aldays:0,twkH:0,tNightH:0,tOtDayH:0,tOtNightH:0,tHolDayH:0,tHolNightH:0,tHolDayOtH:0,tHolNightOtH:0,tBase:0,tNightPay:0,tOtDayPay:0,tOtNightPay:0,tHolDayPay:0,tHolNightPay:0,tHolDayOtPay:0,tHolNightOtPay:0,annualPay:0,wkly:0,bonus:0,allowances:{},totalAllowance:0,deduction:0,total:0};}
  // 퇴사일 이후 월이면 빈 결과
  if(emp.leave){const ld=new Date(emp.leave);if(ld<new Date(y,m-1,1))return{wdays:0,adays:0,aldays:0,twkH:0,tNightH:0,tOtDayH:0,tOtNightH:0,tHolDayH:0,tHolNightH:0,tHolDayOtH:0,tHolNightOtH:0,tBase:0,tNightPay:0,tOtDayPay:0,tOtNightPay:0,tHolDayPay:0,tHolNightPay:0,tHolDayOtPay:0,tHolNightOtPay:0,annualPay:0,wkly:0,bonus:0,allowances:{},totalAllowance:0,deduction:0,total:0};}
  const days=dim(y,m);
  const sot=emp.sot||POL.sot||209;
  let wdays=0,adays=0,aldays=0,tBase=0,tNightPay=0,tOtDayPay=0,tOtNightPay=0,tHolDayPay=0,tHolNightPay=0,tHolDayOtPay=0,tHolNightOtPay=0,deduction=0,dedShortMins=0;
  let tExtraWorkPay=0,tHolPayNew=0;
  let tMonthlyHolStdPay=0,tMonthlyHolOtPay=0;
  // 시간(hours) 합산: 매일 m2h 변환 후 누적 (출퇴근 기록 소수점 그대로 합산)
  let twkH=0,tAllNightH=0,tAllOtDayH=0,tAllOtNightH=0;
  let tHolDayH=0,tHolNightH=0,tHolDayOtH=0,tHolNightOtH=0;
  let tFixExtraH=0,tFixHolWorkH=0; // 통상임금제
  let tHrBaseH=0,tHrNightH=0,tHrOtDayH=0,tHrOtNightH=0; // 시급제 (비휴일, 일별 cap)
  let tMhHolStdH=0,tMhHolOtH=0; // 포괄/월급 휴일
  const empPayMode=getEmpPayModeAt(emp, y, m, 1);
  // 소정근로 1일 기준시간: 고정/월급제=8h, 시급제=sot기반
  const dailyStd = (empPayMode==='fixed'||empPayMode==='monthly') ? 8 : sot/4.345/5;
  // 해당 월 첫날 기준으로 시급/모드 이력 적용
  const rate = getEmpRateAt(emp, y, m, 1);
  const ordRate = getOrdinaryRate(emp, y, m); // 통상시급 (가산수당용)
  for(let d=1;d<=days;d++){
    // 퇴사일 이후 날짜는 근태/급여 집계 제외 (daily 필터와 동일 규칙: 퇴사일 당일까지 근무 인정)
    if(emp.leave){
      const ld=new Date(emp.leave);
      const curDate=new Date(y,m-1,d);
      if(ld<=curDate) continue;
    }
    const rec=REC[rk(eid,y,m,d)];if(!rec)continue;
    if(rec.annual){aldays+=1;continue;}
    if(rec.halfAnnual){
      aldays+=0.5;
      // 반차: 출퇴근 없으면 4h 기본 지급
      if(!rec.start||!rec.end){
        const halfPay=r10(rate*4);
        tBase+=halfPay; wdays++;
        continue;
      }
    }
    if(rec.absent){
      adays++;
      if(empPayMode==='monthly'){
        // 월급제: 주말/공휴일 결근은 공제 안 함 (원래 안 나와도 되는 날)
        const isHolDay = isAutoHol(y,m,d,emp);
        if(!isHolDay && (POL.dedMonthly??true)){
          const monthlyBase=getEmpMonthlyAt(emp, y, m, 1);
          const workDaysInMonth=Array.from({length:days},(_,i)=>i+1).filter(dd=>{
            return !isAutoHol(y,m,dd,emp);
          }).length;
          deduction+=r10(monthlyBase/(workDaysInMonth||1));
        }
      } else if(empPayMode==='hourly'){
        // 시급제: 결근은 단순 미근무 = 급여 미발생, 별도 공제 없음
      } else if(POL.dedMode==='hour'){
        deduction+=r10(rate*dailyStd);
      }
      continue;
    }
    const autoH=isAutoHol(y,m,d,emp);
    const bks=getActiveBk(y,m,d,emp);
    const msBks = rec.customBk ? (rec.customBkList||[]) : bks;
    const c=rec.start&&rec.end?calcSession(rec.start,rec.end,rate,autoH,msBks,rec.outTimes||[],empPayMode,ordRate):null;
    if(!c)continue;
    // 매일 m2h 변환 후 시간(hours) 누적 (출퇴근 기록 소수점 그대로 합산)
    twkH+=m2h(c.work); tAllNightH+=m2h(c.nightM); tAllOtDayH+=m2h(c.otDay); tAllOtNightH+=m2h(c.otNight);
    if(empPayMode==='fixed'){
      tFixExtraH += m2h(autoH ? c.work : Math.max(0,c.work-480));
      if(autoH) tFixHolWorkH += m2h(c.work);
    }
    if(empPayMode==='hourly' && !autoH){
      const dayM = Math.max(0, c.work - c.nightM);
      tHrBaseH += m2h(Math.min(dayM, 480) + Math.min(c.nightM, 480));
      tHrNightH += m2h(Math.min(c.nightM, 480));
      tHrOtDayH += m2h(c.otDay);
      tHrOtNightH += m2h(c.otNight);
    }
    if((empPayMode==='pohal'||empPayMode==='monthly') && autoH){
      tMhHolStdH += m2h(Math.min(c.work, 480));
      tMhHolOtH += m2h(Math.max(0, c.work - 480));
    }
    if(autoH){
      const holDayM=Math.max(0,c.work-c.nightM);
      tHolDayH   +=m2h(Math.min(holDayM,480));
      tHolNightH +=m2h(Math.min(c.nightM,Math.max(0,480-holDayM)));
      tHolDayOtH +=m2h(c.otDay);
      tHolNightOtH+=m2h(c.otNight);
    }
    wdays++;
    // 월급제·시급제는 시��기준 공제 없음
    // 시급제: 실��무시간 기��� 계산이라 별도 공제 불필요
    if(empPayMode!=='monthly' && empPayMode!=='hourly' && POL.dedMode==='hour'&&c.work<dailyStd*60&&!autoH){
      const sh=dailyStd*60-c.work;if(sh>10){deduction+=r10(rate*m2h(sh));dedShortMins+=sh;}
    }
  }
  // ── 누적 시간(hours) × 시급 → r10 한 번 (엑셀 방식) ──
  // 엑셀 수식과 정확히 일치시키려면 화면 표시 시간(각 구간 2자리 반올림 후 합산)을 그대로 사용.
  // rh 는 표시/계산 양쪽에서 동일하게 쓰이는 2자리 반올림.
  const _rh = v=>Math.round(v*100 + FP_EPS)/100;
  if(empPayMode==='fixed'){
    const _ntF=POL.ntFixed??true, _otF=POL.otFixed??true;
    tBase=r10(rate*sot);
    tNightPay=_ntF?r10(ordRate*0.5*_rh(tAllNightH)):0;
    // 초과연장: 엑셀 X = rh(주간연장) + rh(야간연장, ntF꺼지면 제외) → 1회 ROUND (주간/야간 배율 동일 0.5로 통합 가능)
    const otHExcel = _rh(tAllOtDayH) + (_ntF?_rh(tAllOtNightH):0);
    tOtDayPay=_otF?r10(ordRate*0.5*otHExcel):0;
    tOtNightPay=0;
    tExtraWorkPay=(POL.extFixed??true)?r10(ordRate*1.0*_rh(tFixExtraH)):0;
    // 초과휴일: 엑셀 Y = rh(주간휴일)+rh(야간휴일)+rh(주간휴일연장)+rh(야간휴일연장) → 1회 ROUND
    const holHExcel = _rh(tHolDayH)+_rh(tHolNightH)+_rh(tHolDayOtH)+_rh(tHolNightOtH);
    tHolPayNew=(POL.holFixed??true)?r10(ordRate*0.5*holHExcel):0;
  } else if(empPayMode==='hourly'){
    tBase=r10(rate*1.0*tHrBaseH);
    tNightPay=(POL.ntHourly??true)?r10(ordRate*0.5*tHrNightH):0;
    tOtDayPay=(POL.otHourly??true)?r10(ordRate*1.5*tHrOtDayH):0;
    tOtNightPay=(POL.otHourly??true)?r10(ordRate*2.0*tHrOtNightH):0;
    if(POL.holHourly??true){
      tHolDayPay=r10(ordRate*1.5*tHolDayH);
      tHolNightPay=r10(ordRate*2.0*tHolNightH);
      tHolDayOtPay=r10(ordRate*2.0*tHolDayOtH);
      tHolNightOtPay=r10(ordRate*2.5*tHolNightOtH);
    }
  } else if(empPayMode==='monthly'){
    tBase=r10(getEmpMonthlyAt(emp, y, m, 1));
    tMonthlyHolStdPay=(POL.holMonthlyStd??true)?r10(ordRate*1.5*tMhHolStdH):0;
    tMonthlyHolOtPay=(POL.holMonthlyOt??true)?r10(ordRate*2.0*tMhHolOtH):0;
  } else if(empPayMode==='pohal'){
    tBase=r10(rate*sot);
    const pohalRate=ordRate||Math.round((POL.baseMonthly||2455750)/209);
    tMonthlyHolStdPay=(POL.holMonthlyStd??true)?r10(pohalRate*1.5*tMhHolStdH):0;
    tMonthlyHolOtPay=(POL.holMonthlyOt??true)?r10(pohalRate*2.0*tMhHolOtH):0;
  }
  const annualPay=0;
  let wkly=0;
  if(POL.juhyu&&empPayMode==='hourly'){
    // 주휴수당: 실제 월~일 기준 주 + 근무형태 등록/미등록 분기
    const daysInMonth=dim(y,m);
    let weeklyPay=0;
    const DOW_KO=['일','월','화','수','목','금','토'];
    const workDays=emp.workDays||[];
    const isRegistered=workDays.length>0; // 근무형태 등록 여부
    // 실제 월~일 기준 주 계산
    const firstDow=new Date(y,m-1,1).getDay();
    const firstMonday=1-((firstDow+6)%7);
    for(let mon=firstMonday;mon<=daysInMonth;mon+=7){
      let weekWork=0;
      let hasAbsent=false;
      for(let offset=0;offset<7;offset++){
        const d=mon+offset;
        if(d<1||d>daysInMonth) continue;
        // 퇴사일 이후 날짜는 주휴수당 판정 제외
        if(emp.leave){const ld=new Date(emp.leave);if(ld<=new Date(y,m-1,d)) continue;}
        // 근무형태 등록된 경우만 소정근로일 체크
        if(isRegistered){
          const dowKo=DOW_KO[new Date(y,m-1,d).getDay()];
          if(!workDays.includes(dowKo)) continue; // 소정근로일 아니면 skip
        }
        const rec=REC[rk(eid,y,m,d)];
        // 등록된 경우: 소정근로일에 기록 없거나 결근이면 개근 실패
        if(isRegistered&&(!rec||rec.absent)){hasAbsent=true;continue;}
        if(!rec||rec.absent) continue; // 미등록은 그냥 skip
        if(rec.annual||rec.halfAnnual) continue; // 연차는 개근 인정
        const bks=getActiveBk(y,m,d,emp);
        const _whActiveBks = rec.customBk ? (rec.customBkList||[]) : bks;
        const c=rec.start&&rec.end
          ?calcSession(rec.start,rec.end,rate,isAutoHol(y,m,d,emp),_whActiveBks,rec.outTimes||[],empPayMode,ordRate)
          :null;
        if(c&&c.work>0) weekWork+=c.work;
      }
      // 등록: 개근+15h이상 / 미등록: 15h이상이면 지급
      if(!hasAbsent&&weekWork>=900) weeklyPay+=r10(rate*8);
    }
    wkly=weeklyPay;
  }
  const bonus=getMonthBonus(eid,y,m);
  const allowances={};
  let totalAllowance=0;
  POL.allowances.forEach(a=>{
    const v=getMonthAllowance(eid,y,m,a.id);
    // isDeduct인 항목은 입력값을 음수로 처리
    const effectiveV = (a.isDeduct && v>0) ? -v : v;
    allowances[a.id]=effectiveV;
    totalAllowance+=effectiveV;
  });
  // 총 가산수당 합계
  const tTotalBonus = empPayMode==='fixed'
    ? tExtraWorkPay + tNightPay + tOtDayPay + tOtNightPay + tHolPayNew
    : tNightPay + tOtDayPay + tOtNightPay + (tHolDayPay||0) + (tHolNightPay||0) + (tHolDayOtPay||0) + (tHolNightOtPay||0);
  // 결근차감: 통상시급(= 기본시급 + '통상' 체크된 수당만 반영) 기준으로 재계산
  // 근로기준법상 결근 1일=통상임금 1일분 공제
  if(empPayMode!=='monthly' && empPayMode!=='hourly'){
    deduction = Math.round(ordRate * (adays * dailyStd + m2h(dedShortMins)) / 10 + FP_EPS) * 10;
  }
  // 총급여 = 기본급 + 수당 + 주휴 + 연차 + 총가산수당 + 월급제휴일 + 상여 - 결근차감
  const total=r10((tBase+totalAllowance) + wkly + annualPay + tTotalBonus + tMonthlyHolStdPay + tMonthlyHolOtPay + bonus - deduction);

  const rh=v=>Math.round(v*100 + FP_EPS)/100; // 시간 소수점 2자리 (FP 보정)
  return{wdays,adays,aldays,twkH:rh(twkH),tNightH:rh(tAllNightH),tOtDayH:rh(tAllOtDayH),tOtNightH:rh(tAllOtNightH),tHolDayH:rh(tHolDayH),tHolNightH:rh(tHolNightH),tHolDayOtH:rh(tHolDayOtH),tHolNightOtH:rh(tHolNightOtH),
    tBase,tNightPay,tOtDayPay,tOtNightPay,tHolDayPay,tHolNightPay,tHolDayOtPay,tHolNightOtPay,
    tExtraWorkH:rh(tFixExtraH),tExtraWorkPay,tHolPayNew,tTotalBonus,
    tMonthlyHolStdPay,tMonthlyHolOtPay,
    annualPay,wkly,bonus,allowances,totalAllowance,deduction,dedShortH:dedShortMins/60,total};
  } finally {
    if(_polSwapped) POL = _origPOL;
  }
}


// ══════════════════════════════════════
// 연차 관리 시스템
// ══════════════════════════════════════
// leaveYear, companyYear: 아래 연차관리 블록에서 선언

// 연차 발생 계산 (회계연도 기준)
















// ══════════════════════════════════════
// 직원 현황 (월별)
// ══════════════════════════════════════



// ══════════════════════════════════════
// ══ 모바일 사이드바 토글 ══
function toggleMobSb(){
  document.querySelector('.sb').classList.toggle('mob-open');
  document.querySelector('.mob-sb-dim').classList.toggle('on');
}
function closeMobSb(){
  document.querySelector('.sb').classList.remove('mob-open');
  document.querySelector('.mob-sb-dim').classList.remove('on');
}

// ══ 데스크톱 사이드바 접기/펴기 ══
function toggleSb(){
  if(window.innerWidth <= 768) return; // 모바일에서는 무시 (햄버거 토글 사용)
  const sb = document.querySelector('.sb');
  if(!sb) return;
  const nowCollapsed = !sb.classList.contains('collapsed');
  sb.classList.toggle('collapsed', nowCollapsed);
  try { localStorage.setItem('npm5_sb_collapsed', nowCollapsed ? '1' : '0'); } catch(e){}
  const ic = sb.querySelector('.sb-toggle-ic');
  if(ic) ic.textContent = nowCollapsed ? '▶' : '◀';
}
function initSbCollapsed(){
  if(window.innerWidth <= 768) return; // 모바일 제외
  try {
    if(localStorage.getItem('npm5_sb_collapsed') === '1'){
      const sb = document.querySelector('.sb');
      if(sb){
        sb.classList.add('collapsed');
        const ic = sb.querySelector('.sb-toggle-ic');
        if(ic) ic.textContent = '▶';
      }
    }
  } catch(e){}
}

// 페이지
// ══════════════════════════════════════
const PAGES=['daily','monthly','payroll','leave','company','emps','shift','safety','folder','myinfo','settings'];
function gp(p){
  closeMobSb();
  if(p!=='safety'&&typeof sfStopPoll==='function')sfStopPoll();
  PAGES.forEach(x=>{
    const pe=document.getElementById('pg-'+x);if(pe)pe.classList.toggle('on',x===p);
    const ne=document.getElementById('nt-'+x);if(ne)ne.classList.toggle('on',x===p);
  });
  if(p==='monthly')renderMonthly();
  if(p==='payroll'){
    // 급여요약 진입 시 필터 버튼 상태 동기화
    document.querySelectorAll('.pf-btn').forEach(b=>{
      b.classList.toggle('on', b.dataset.f===payFilter);
    });
    renderPayroll();
  }
  if(p==='emps')renderEmps();
  if(p==='settings'){renderDefBk();renderAllowanceList();}
  if(p==='shift')renderShiftList();
  if(p==='safety')renderSafety();
  if(p==='leave')renderLeave();
  if(p==='company')renderCompany();
  if(p==='folder')renderFolder();
  if(p==='myinfo')renderMyInfo();
}
// ══ 사이드바 필터 상태 ══
const SBF = { shift:'all', nation:'all', pay:'all' };

function setSbFilter(key, val, btn){
  SBF[key] = val;
  if(btn){
    const grp = btn.closest('div');
    if(grp) grp.querySelectorAll('.sb-fb').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
  }
  renderSb(document.getElementById('sb-search-inp')?.value||'');
}

function renderSb(filter=''){
  const sbSorted=[...EMPS].filter(e=>{
    if(filter && !e.name.includes(filter)) return false;
    if(SBF.shift!=='all' && (e.shift||'day')!==SBF.shift) return false;
    const isFor = e.nation==='foreign' || e.foreigner===true;
    if(SBF.nation==='korean' && isFor) return false;
    if(SBF.nation==='foreign' && !isFor) return false;
    if(SBF.pay!=='all'){const ep=e.payMode||'fixed';if(SBF.pay==='monthly'){if(ep!=='monthly'&&ep!=='pohal')return false;}else{if(ep!==SBF.pay)return false;}}
    return true;
  });
  document.getElementById('sb-list').innerHTML=sbSorted.map((e,i)=>`
    <div class="ei ${e.id===vEid?'on':''}" draggable="true"
      ondragstart="dragIdx=${i};this.style.opacity='.4';this.style.background='var(--nbg)'"
      ondragend="this.style.opacity='';this.style.background=''"
      ondragover="event.preventDefault();this.style.borderTop='2px solid var(--navy2)'"
      ondragleave="this.style.borderTop=''"
      ondrop="sbDrop(event,${i});document.querySelectorAll('#sb-list .ei').forEach(r=>r.style.borderTop='')"
      onclick="vEid=${e.id};renderSb(document.getElementById('sb-search-inp')?.value||'')"
      style="transition:opacity .15s;">
      <span style="cursor:grab;color:var(--ink3);font-size:11px;margin-right:1px">⠿</span>
      <div class="av" style="width:28px;height:28px;font-size:12px;background:${safeColor(e.color,'#DBEAFE')};color:${safeColor(e.tc,'#1E3A5F')}">${e.name?esc(e.name)[0]:'?'}</div>
      <div><div class="en">${esc(e.name)}<span class="emp-mode-badge ${getEmpPayModeLabel(e).cls}">${getEmpPayModeLabel(e).text}</span>${e.nation==='foreign'?'<span style="font-size:9px;color:#92400E;background:var(--abg);padding:1px 5px;border-radius:5px;font-weight:700;margin-left:2px">외국인</span>':''} ${e.leave?'<span style="font-size:9px;color:var(--rose);font-weight:700;margin-left:3px">퇴사</span>':''}</div><div class="er">${esc(e.role)} · ${getEmpShiftLabel(e).text}</div></div>
    </div>`).join('');
}
function filterSb(v){renderSb(v);}
function mvSearch(v){
  const found=EMPS.find(e=>e.name.includes(v));
  if(found){vEid=found.id;renderMonthly();}
}
function sbDrop(ev,i){
  ev.preventDefault();
  if(dragIdx===null||dragIdx===i)return;
  const sbItems=document.querySelectorAll('#sb-list .ei');
  const fromId=sbItems[dragIdx]?parseInt(sbItems[dragIdx].dataset.eid):null;
  const toId=sbItems[i]?parseInt(sbItems[i].dataset.eid):null;
  if(fromId&&toId&&fromId!==toId){
    const fromIdx=EMPS.findIndex(e=>e.id===fromId);
    const toIdx=EMPS.findIndex(e=>e.id===toId);
    if(fromIdx>=0&&toIdx>=0){
      const mv=EMPS.splice(fromIdx,1)[0];
      EMPS.splice(toIdx,0,mv);
    }
  }
  dragIdx=null;
  saveLS();
  renderSb(document.getElementById('sb-search-inp')?.value||'');
  renderTable();
  renderEmps();
}

function nd(f,d){
  if(f==='year'){cY+=d;}
  if(f==='month'){cM+=d;if(cM>12){cM=1;cY++;}if(cM<1){cM=12;cY--;}}
  if(f==='day'){const mx=dim(cY,cM);cD+=d;if(cD>mx)cD=1;if(cD<1)cD=mx;}
  cD=Math.min(cD,dim(cY,cM));
  updDbar();renderBks();renderTable();
}
function updDbar(){
  document.getElementById('dy').textContent=cY;
  document.getElementById('dm').textContent=cM;
  document.getElementById('dd').textContent=cD;
  const dow=new Date(cY,cM-1,cD).getDay();
  const phName=getPhName(cY,cM,cD);
  const autoH=isAutoHol(cY,cM,cD);
  let dowText=DOW[dow]+'요일';if(phName)dowText+=' · '+phName;
  document.getElementById('ddow').textContent=dowText;
  document.getElementById('daily-sub').textContent=`${cY}년 ${cM}월 ${cD}일 ${DOW[dow]}요일`;
  const al=document.getElementById('hol-alert');
  if(autoH){al.style.display='block';al.textContent=`🎌 ${phName||(dow===6?'토요일':'일요일')} — 휴일 가산 자동 적용`;}
  else al.style.display='none';
}

function getDsBk(){const k=`${cY}-${pad(cM)}-${pad(cD)}`;return TBK[k]||DEF_BK.map(b=>({...b}));}
function renderBks(){
  const bks=getDsBk(),mod=!!TBK[`${cY}-${pad(cM)}-${pad(cD)}`];
  document.getElementById('bk-mod').style.display=mod?'inline':'none';
  document.getElementById('bk-rb').style.display=mod?'inline-block':'none';
  const el=document.getElementById('bk-body');
  if(!bkEdit){
    el.innerHTML=bks.map((b,i)=>`<div class="bk-pill"><span class="bk-lbl">세트${i+1}</span><span class="bk-val">${b.start}~${b.end}</span></div>`).join('')
      +(bks.length===0?'<span style="font-size:11px;color:var(--ink3)">휴게 없음</span>':'');
  } else {
    const MINS=[0,5,10,15,20,25,30,35,40,45,50,55];
    const mkHO=s=>Array.from({length:24},(_,h)=>`<option value="${h}"${h==s?' selected':''}>${pad(h)}</option>`).join('');
    const mkMO=s=>MINS.map(m=>`<option value="${m}"${m==s?' selected':''}>${pad(m)}</option>`).join('');
    el.innerHTML=bks.map((b,i)=>{
      const[sh,sm]=b.start.split(':').map(Number);const[eh,em]=b.end.split(':').map(Number);
      return`<div class="bk-ep"><span class="bk-lbl">세트${i+1}</span>
        <select class="bs" onchange="editBkH(${i},'start',this.value)">${mkHO(sh)}</select>:
        <select class="bs" onchange="editBkM(${i},'start',this.value)">${mkMO(sm)}</select>
        ~<select class="bs" onchange="editBkH(${i},'end',this.value)">${mkHO(eh)}</select>:
        <select class="bs" onchange="editBkM(${i},'end',this.value)">${mkMO(em)}</select>
        <button class="bk-del" onclick="delTBk(${i})">×</button></div>`;
    }).join('')+`<button class="bk-add" onclick="addTBk()">+ 추가</button>`;
  }
}
function toggleBkEdit(){bkEdit=!bkEdit;const k=`${cY}-${pad(cM)}-${pad(cD)}`;if(bkEdit&&!TBK[k])TBK[k]=DEF_BK.map(b=>({...b,id:b.id+1000}));document.getElementById('bk-eb').textContent=bkEdit?'완료':'오늘만 수정';if(!bkEdit){saveLS();renderTable();}renderBks();}
function editBkH(i,f,v){const k=`${cY}-${pad(cM)}-${pad(cD)}`;if(!TBK[k])return;const mn=TBK[k][i][f].split(':')[1];TBK[k][i][f]=`${pad(+v)}:${mn}`;saveLS();renderTable();}
function editBkM(i,f,v){const k=`${cY}-${pad(cM)}-${pad(cD)}`;if(!TBK[k])return;const hr=TBK[k][i][f].split(':')[0];TBK[k][i][f]=`${hr}:${pad(+v)}`;saveLS();renderTable();}
function delTBk(i){const k=`${cY}-${pad(cM)}-${pad(cD)}`;if(TBK[k]){TBK[k].splice(i,1);saveLS();renderBks();renderTable();}}
function addTBk(){const k=`${cY}-${pad(cM)}-${pad(cD)}`;if(!TBK[k])TBK[k]=[];TBK[k].push({id:bkNid++,start:'12:00',end:'13:00'});saveLS();renderBks();}
function resetBkToday(){delete TBK[`${cY}-${pad(cM)}-${pad(cD)}`];bkEdit=false;document.getElementById('bk-eb').textContent='오늘만 수정';saveLS();renderBks();renderTable();}

function setPohalAtt(eid, type){
  const k=rk(eid,cY,cM,cD);
  if(!REC[k])REC[k]={empId:eid,start:'',end:'',absent:false,annual:false,note:'',outTimes:[]};
  if(type==='work'){REC[k].absent=false;REC[k].annual=false;}
  else if(type==='annual'){REC[k].annual=!REC[k].annual;if(REC[k].annual)REC[k].absent=false;}
  else if(type==='absent'){REC[k].absent=!REC[k].absent;if(REC[k].absent)REC[k].annual=false;}
  saveLS();renderTable();
  // 연차/결근 변경 시 연차관리·근태현황·급여 탭 갱신
  const lvPage=document.getElementById('pg-leave');
  if(lvPage&&lvPage.classList.contains('on')) renderLeave();
  const mvPage=document.getElementById('pg-monthly');
  if(mvPage&&mvPage.classList.contains('on')) renderMonthly();
  const pvPage=document.getElementById('pg-payroll');
  if(pvPage&&pvPage.classList.contains('on')) renderPayroll();
}
function addOutTime(eid){
  const k=rk(eid,cY,cM,cD);
  if(!REC[k])REC[k]={empId:eid,start:'',end:'',absent:false,annual:false,note:'',outTimes:[]};
  if(!REC[k].outTimes)REC[k].outTimes=[];
  REC[k].outTimes.push({s:'',e:''});
  saveLS();renderTable();
}
function setOutTime(eid,idx,field,raw){
  const k=rk(eid,cY,cM,cD);
  if(!REC[k]||!REC[k].outTimes)return;
  REC[k].outTimes[idx][field]=parseTimeInput(raw)||'';
  // 역순(종료≤시작) 입력은 실근무가 과다 계산될 수 있어 경고
  const ot = REC[k].outTimes[idx];
  if(ot.s && ot.e){
    const s=pT(ot.s), e=pT(ot.e);
    if(s!==null && e!==null && e<=s){
      if(typeof showSyncToast==='function'){
        showSyncToast('⚠️ 외출 시간이 올바르지 않습니다 (종료 ≤ 시작)\n이 외출은 0분으로 처리됩니다','warn',4000);
      }
    }
  }
  saveLS();renderTable();
}
function delOutTime(eid,idx){
  const k=rk(eid,cY,cM,cD);
  if(!REC[k]||!REC[k].outTimes)return;
  REC[k].outTimes.splice(idx,1);
  saveLS();renderTable();
}
function calcOutMins(outTimes){
  if(!outTimes||!outTimes.length)return 0;
  return outTimes.reduce((sum,o)=>{
    const s=pT(o.s),e=pT(o.e);
    if(s===null||e===null)return sum;
    const diff=e>s?e-s:0;
    return sum+diff;
  },0);
}
function handleTimeInput(eid,field,raw){
  const parsed=parseTimeInput(raw);
  const k=rk(eid,cY,cM,cD);
  if(!REC[k])REC[k]={empId:eid,start:'',end:'',absent:false,annual:false,halfAnnual:false,note:'',outTimes:[],customBk:false,customBkList:[]};
  REC[k][field]=parsed;
  saveLS();
  // input 값 즉시 반영
  const inp=document.querySelector('#daily-tbody input.time-inp[data-eid="'+eid+'"][data-field="'+field+'"]');
  if(inp && inp!==document.activeElement) inp.value=parsed;
  // 실근무/야간/연장 셀 업데이트
  _updateDailyRowCells(eid);
}

function _updateDailyRowCells(eid){
  const k=rk(eid,cY,cM,cD);
  const rec=REC[k];
  if(!rec||!rec.start||!rec.end) return;
  if(rec.absent||rec.annual) return;
  const emp=EMPS.find(e=>e.id===eid);
  if(!emp) return;
  const autoH=isAutoHol(cY,cM,cD,emp);
  const bks=getActiveBk(cY,cM,cD,emp);
  const activeBks = rec.customBk ? (rec.customBkList||[]) : bks;
  try{
    const c=calcSession(rec.start,rec.end,getEmpRate(emp),autoH,activeBks,rec.outTimes||[],getEmpPayMode(emp),getOrdinaryRate(emp,cY,cM));
    if(!c) return;
    // row 찾기
    const rows=document.querySelectorAll('#daily-tbody tr');
    for(const tr of rows){
      if(!tr.querySelector('input.time-inp[data-eid="'+eid+'"]')) continue;
      const tdW=tr.querySelector('.td-w');
      if(tdW){
        const d=tdW.querySelector('div')||tdW;
        d.textContent=c.work>0?fmtH(c.work):'';
      }
      const tdNt=tr.querySelector('.td-nt');
      if(tdNt) tdNt.textContent=c.nightM>30?fmtH(c.nightM):'';
      const tdOt=tr.querySelector('.td-ot');
      if(tdOt) tdOt.textContent=c.ot>0?fmtH(c.ot):'';
      const tdHol=tr.querySelector('.td-hol');
      if(tdHol) tdHol.textContent=autoH&&c.work>0?fmtH(c.work):'';
      break;
    }
  }catch(err){console.warn('row update 오류:',err);}
}
function setR(eid,f,v){
  const k=rk(eid,cY,cM,cD);
  if(!REC[k])REC[k]={empId:eid,start:'',end:'',absent:false,annual:false,halfAnnual:false,note:'',outTimes:[]};
  // 상호 배타
  if(f==='annual'&&v){REC[k].absent=false;REC[k].halfAnnual=false;}
  if(f==='halfAnnual'&&v){REC[k].absent=false;REC[k].annual=false;}
  if(f==='absent'&&v){REC[k].annual=false;REC[k].halfAnnual=false;}
  REC[k][f]=v;
  // customBk 체크 시 customBkList 자동 초기화
  if(f==='customBk'&&v&&!REC[k].customBkList?.length){
    REC[k].customBkList=[{s:'',e:''}];
  }
  saveLS();renderTable();
  // 연차/반차 변경 시 관련 탭도 즉시 갱신
  if(f==='annual'||f==='halfAnnual'||f==='absent'){
    const lvPage=document.getElementById('pg-leave');
    if(lvPage&&lvPage.classList.contains('on')) renderLeave();
    const mvPage=document.getElementById('pg-monthly');
    if(mvPage&&mvPage.classList.contains('on')) renderMonthly();
    const pvPage=document.getElementById('pg-payroll');
    if(pvPage&&pvPage.classList.contains('on')) renderPayroll();
  }
}

// ══ 공통 필터 상태 ══
const F = {
  daily:   { shift:'all', nation:'all', pay:'all', dept:'all', search:'' },
  payroll: { shift:'all', nation:'all', pay:'all', dept:'all', search:'' },
  leave:   { shift:'all', nation:'all', pay:'all', dept:'all', search:'' },
  emps:    { shift:'all', nation:'all', pay:'all', dept:'all', search:'' },
};

function setFilter(tab, key, val, btn){
  F[tab][key] = val;
  if(btn){
    const grp = btn.closest('.filter-group');
    if(grp) grp.querySelectorAll('.fb').forEach(b=>b.classList.remove('on','on-night','on-foreign'));
    if(val==='night')   btn.classList.add('on-night');
    else if(val==='foreign') btn.classList.add('on-foreign');
    else if(val!=='all') btn.classList.add('on');
    else btn.classList.add('on');
  }
  if(tab==='daily')   renderTable();
  if(tab==='payroll') renderPayroll();
  if(tab==='leave')   renderLeave();
  if(tab==='emps')    renderEmps();
}

let _searchRenderT;
function setSearch(tab, val){
  F[tab].search = val.toLowerCase();
  // 급여관리 카드뷰: 재계산 없이 DOM 숨기기/보이기만 (즉시)
  if(tab==='payroll' && pvMode==='card'){
    fastSearchPayroll();
    return;
  }
  clearTimeout(_searchRenderT);
  _searchRenderT = setTimeout(()=>{
    if(tab==='daily')   renderTable();
    if(tab==='payroll') renderPayroll();
    if(tab==='leave')   renderLeave();
    if(tab==='emps')    renderEmps();
  }, 200);
}

function applyCommonFilter(emps, tab, refDate){
  const f = F[tab];
  return emps.filter(emp=>{
    // 퇴사자 필터: 기준일 이전 퇴사자 제외. 단, 직원관리(emps) 탭에서는 퇴사자도 하단에 표시하기 위해 필터 스킵
    if(emp.leave && tab!=='emps'){
      const ld=new Date(emp.leave);
      const ref=refDate||new Date();
      if(ld<ref) return false;
    }
    if(f.shift!=='all' && (emp.shift||'day')!==f.shift) return false;
    const isFor = emp.nation==='foreign' || emp.foreigner===true;
    if(f.nation==='korean'  && isFor)  return false;
    if(f.nation==='foreign' && !isFor) return false;
    if(f.pay!=='all'){
      const ep=emp.payMode||'fixed';
      // 포괄임금제 필터: monthly + pohal 모두 매칭
      if(f.pay==='monthly'){if(ep!=='monthly'&&ep!=='pohal')return false;}
      else{if(ep!==f.pay)return false;}
    }
    if(f.dept && f.dept!=='all' && (emp.dept||'').trim()!==(f.dept||'').trim()) return false;
    if(f.search && !(emp.name||'').toLowerCase().includes(f.search)) return false;
    return true;
  });
}

function makeFilterBar(tab){
  const f = F[tab];
  return `
  <div class="filter-bar">
    <div class="filter-group">
      <button class="fb${f.shift==='all'?' on':''}" onclick="setFilter('${tab}','shift','all',this)">전체</button>
      <button class="fb${f.shift==='day'?' on':''}" onclick="setFilter('${tab}','shift','day',this)">주간</button>
      <button class="fb${f.shift==='night'?' on-night':''}" onclick="setFilter('${tab}','shift','night',this)">야간</button>
    </div>
    <div class="filter-group">
      <button class="fb${f.nation==='all'?' on':''}" onclick="setFilter('${tab}','nation','all',this)">전체</button>
      <button class="fb${f.nation==='korean'?' on':''}" onclick="setFilter('${tab}','nation','korean',this)">내국인</button>
      <button class="fb${f.nation==='foreign'?' on-foreign':''}" onclick="setFilter('${tab}','nation','foreign',this)">외국인</button>
    </div>
    <div class="filter-group">
      <button class="fb${f.pay==='all'?' on':''}" onclick="setFilter('${tab}','pay','all',this)">전체</button>
      <button class="fb${f.pay==='fixed'?' on':''}" onclick="setFilter('${tab}','pay','fixed',this)">통상임금제</button>
      <button class="fb${f.pay==='hourly'?' on':''}" onclick="setFilter('${tab}','pay','hourly',this)">시급제</button>
      <button class="fb${f.pay==='monthly'?' on':''}" onclick="setFilter('${tab}','pay','monthly',this)">포괄임금제</button>
    </div>
    ${(()=>{
      const depts=[...new Set(EMPS.map(e=>(e.dept||'').trim()).filter(d=>d))].sort();
      if(!depts.length) return '';
      const cur=f.dept||'all';
      return '<div class="filter-group" style="display:flex;gap:3px;background:rgba(0,0,0,.05);border-radius:8px;padding:2px;">'
        +[['all','전체'],...depts.map(d=>[d,d])].map(([v,l])=>
          `<button class="fb${cur===v?' on':''}"
            style="padding:4px 10px;border-radius:6px;font-size:11px;border:none;cursor:pointer;font-family:inherit;
              background:${cur===v?'var(--navy)':'transparent'};color:${cur===v?'#fff':'var(--ink3)'};"
            onclick="setFilter('${tab}','dept','${v}',this)">${l}</button>`
        ).join('')+'</div>';
    })()}
    <div class="filter-search">
      <span class="fs-icon">🔍</span>
      <input placeholder="이름 검색..." value="${f.search}"
        oninput="setSearch('${tab}',this.value)">
    </div>
  </div>`;
}

function renderFilterBar(containerId, tab){
  const el = document.getElementById(containerId);
  if(!el) return;
  const existing = el.querySelector('.filter-search input');
  if(existing && document.activeElement === existing){
    // 검색 input에 포커스 중이면 버튼 상태만 업데이트하고 input은 보존
    const f = F[tab];
    el.querySelectorAll('.filter-group').forEach((grp, gi)=>{
      const key = ['shift','nation','pay'][gi];
      if(!key) return;
      grp.querySelectorAll('.fb').forEach(b=>{
        b.classList.remove('on','on-night','on-foreign');
        const vals = [['all','day','night'],['all','korean','foreign'],['all','fixed','hourly','monthly']][gi];
        const idx = Array.from(grp.children).indexOf(b);
        const bVal = vals[idx];
        if(bVal === f[key]){
          if(bVal==='night') b.classList.add('on-night');
          else if(bVal==='foreign') b.classList.add('on-foreign');
          else b.classList.add('on');
        }
      });
    });
    return;
  }
  el.innerHTML = makeFilterBar(tab);
}

let payFilter = 'all';
function setPayFilter(f){ payFilter=f; }
function filterEmpsByPay(emps){
  return applyCommonFilter(emps, 'payroll');
}
function renderTable(){
  // 과거 날짜 조회 시 그 달의 정책 스냅샷 사용
  const _origPOL = POL;
  const _monthPOL = (typeof getPolForMonth==='function') ? getPolForMonth(cY, cM) : POL;
  const _polSwapped = _monthPOL !== _origPOL;
  if(_polSwapped) POL = _monthPOL;
  try {
  renderFilterBar('daily-filter-bar','daily');
  const dayDate=new Date(cY,cM-1,cD);
  const activeDayEmps = applyCommonFilter(EMPS.filter(emp=>{
    if(emp.join){const jd=new Date(emp.join);if(jd>dayDate)return false;}
    if(emp.leave){const ld=new Date(emp.leave);if(ld<=dayDate)return false;}
    return true;
  }), 'daily', dayDate);
  document.getElementById('daily-tbody').innerHTML=activeDayEmps.map(emp=>{
    const k=rk(emp.id,cY,cM,cD);
    const todayStr = `${cY}-${pad(cM)}-${pad(cD)}`;
    const prevD = new Date(cY,cM-1,cD); prevD.setDate(prevD.getDate()-1);
    const prevKey = rk(emp.id,prevD.getFullYear(),prevD.getMonth()+1,prevD.getDate());
    // 저장된 기록만 사용 (자동 채우기 없음 - 최근 데이터 불러오기 버튼으로만 적용)
    const rec=REC[k]||{empId:emp.id,start:'',end:'',absent:false,annual:false,halfAnnual:false,note:'',outTimes:[],customBk:false,customBkList:[]};
    const autoH=isAutoHol(cY,cM,cD,emp);
    const rate=getEmpRate(emp);
    const al=calcAnnualLeave(emp);
    const empPayMode=getEmpPayMode(emp);
    const isPohalEmp=empPayMode==='pohal';
    // 직원 shift에 따라 다른 휴게세트 적용 (주간/야간 분리)
    const bks=getActiveBk(cY,cM,cD,emp);
    // 개별휴게 ON이면 개인 휴게시간 사용, 아니면 shift별 휴게시간
    const activeBks = rec.customBk ? (rec.customBkList||[]) : bks;
    let c=null;
    if(rec.annual){
      c={work:480,nightM:0,ot:0,crossed:false,basePay:rate*8,nightPay:0,otPay:0,holPay:0,totalPay:rate*8};
    } else if(rec.halfAnnual){
      // 반차: 4h 기본 지급, 출퇴근 있으면 실근무 추가 계산
      if(rec.start&&rec.end){
        c=calcSession(rec.start,rec.end,rate,autoH,activeBks,rec.outTimes||[],getEmpPayMode(emp),getOrdinaryRate(emp,cY,cM));
      } else {
        c={work:240,nightM:0,ot:0,crossed:false,basePay:rate*4,nightPay:0,otPay:0,holPay:0,totalPay:rate*4};
      }
    } else if(!rec.absent&&rec.start&&rec.end){
      c=calcSession(rec.start,rec.end,rate,autoH,activeBks,rec.outTimes||[],getEmpPayMode(emp),getOrdinaryRate(emp,cY,cM));
    }
    const chips=[];
    if(c&&!rec.annual&&!rec.halfAnnual){
      if(c.crossed)chips.push('<span class="chip ch-cr">익일</span>');
      if(autoH)chips.push('<span class="chip ch-hol">휴일</span>');
    }
    if(c&&rec.halfAnnual&&c.crossed)chips.push('<span class="chip ch-cr">익일</span>');
    if(rec.annual)chips.push('<span class="chip ch-al">연차</span>');
    if(rec.halfAnnual)chips.push('<span class="chip" style="background:#E0E7FF;color:#3730A3;font-weight:700">반차</span>');
    const rowCls=rec.absent?'ab-row':rec.annual?'al-row':rec.halfAnnual?'al-row':autoH?'hol-row':'';
    const phName=getPhName(cY,cM,cD);
    const holTag=autoH?`<span style="font-size:9px;color:#9A3412;background:#FED7AA;padding:1px 5px;border-radius:5px;font-weight:700;margin-left:3px">${esc(phName)||'휴일'}</span>`:'';
    const cbTd=`<td style="width:32px;text-align:center;">
  <input type="checkbox" class="daily-row-cb" data-eid="${emp.id}" style="accent-color:var(--navy);">
</td>`;
    const nameTd=`<td class="td-nm">
      <div style="display:flex;align-items:center;gap:5px">
        <div class="av" style="width:26px;height:26px;font-size:11px;background:${safeColor(emp.color,'#DBEAFE')};color:${safeColor(emp.tc,'#1E3A5F')}">${esc(emp.name)[0]}</div>
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--ink)">${esc(emp.name)}${holTag}<span class="emp-mode-badge ${getEmpPayModeLabel(emp).cls}">${getEmpPayModeLabel(emp).text}</span><span style="font-size:9px;padding:1px 5px;border-radius:5px;background:${getEmpShiftLabel(emp).bg};color:${getEmpShiftLabel(emp).color};font-weight:700;margin-left:2px">${getEmpShiftLabel(emp).text}</span></div>
          <div style="font-size:9px;color:var(--ink3)">${esc(emp.role)} · 연차<span style="color:${al.remain<0?'var(--rose)':'inherit'};font-weight:${al.remain<0?'700':'inherit'}">${al.remain}개</span></div>
        </div>
      </div>
    </td>`;

    if(isPohalEmp){
      const isWork=!rec.absent&&!rec.annual;
      const holPay=c?(c.holDayStdPay+c.holDayOtPay):0;
      // 개별휴게 UI (통상임금제와 동일)
      const pohalBkUI = rec.customBk ? `<div style="margin-top:4px;padding:5px 8px;background:var(--gbg);border:1px solid #BBF7D0;border-radius:6px">
        <div style="font-size:9px;font-weight:700;color:var(--green);margin-bottom:3px">개인 휴게시간</div>
        ${(rec.customBkList||[{s:'',e:''}]).map((b,bi)=>`<div style="display:flex;align-items:center;gap:3px;margin-bottom:2px">
          <input class="out-time" value="${b.s||''}" placeholder="1200" style="border-color:#BBF7D0" onblur="setCustomBk(${emp.id},${bi},'s',this.value)" onkeydown="if(event.key==='Enter')setCustomBk(${emp.id},${bi},'s',this.value)">
          <span style="font-size:10px;color:var(--ink3)">~</span>
          <input class="out-time" value="${b.e||''}" placeholder="1300" style="border-color:#BBF7D0" onblur="setCustomBk(${emp.id},${bi},'e',this.value)" onkeydown="if(event.key==='Enter')setCustomBk(${emp.id},${bi},'e',this.value)">
          <button class="out-x" onclick="delCustomBk(${emp.id},${bi})" style="color:#065F46">×</button>
        </div>`).join('')}
        <button class="bk-add" onclick="addCustomBk(${emp.id})" style="font-size:9px;margin-top:2px;padding:2px 8px">+ 세트 추가</button>
      </div>` : '';
      // 외출 UI (통상임금제와 동일)
      const pohalOutUI=(rec.outTimes&&rec.outTimes.length>0)?`<div style="margin-top:4px;padding:5px 7px;background:var(--abg);border-radius:6px;border:1px solid #FCD34D">
        ${(rec.outTimes||[]).map((o,oi)=>`<div class="out-row">
          <span style="font-size:9px;font-weight:700;color:var(--amber)">외출${oi+1}</span>
          <input class="out-time" value="${o.s||''}" placeholder="0900" onblur="setOutTime(${emp.id},${oi},'s',this.value)" onkeydown="if(event.key==='Enter')setOutTime(${emp.id},${oi},'s',this.value)">
          <span style="font-size:11px;color:var(--ink3)">~</span>
          <input class="out-time" value="${o.e||''}" placeholder="1000" onblur="setOutTime(${emp.id},${oi},'e',this.value)" onkeydown="if(event.key==='Enter')setOutTime(${emp.id},${oi},'e',this.value)">
          <button class="out-x" onclick="delOutTime(${emp.id},${oi})">×</button>
        </div>`).join('')}
      </div>`:'';
      return`<tr class="${rowCls}">
        ${cbTd}${nameTd}
        <td><input class="time-inp ${rec.absent||rec.annual?'dis':''}" value="${rec.start||''}" placeholder="0900"
          ${rec.absent||rec.annual?'disabled':''} data-eid="${emp.id}" data-field="start"
          onblur="handleTimeInput(${emp.id},'start',this.value)"></td>
        <td><input class="time-inp ${c&&c.crossed?'cross':autoH?'hol-t':''} ${rec.absent||rec.annual?'dis':''}" value="${rec.end||''}" placeholder="1800"
          ${rec.absent||rec.annual?'disabled':''} data-eid="${emp.id}" data-field="end"
          onblur="handleTimeInput(${emp.id},'end',this.value)"></td>
        <td class="td-w">${c&&isWork?`<div>${fmtH(c.work)}</div><div style="margin-top:1px">${chips.join('')}</div>`:rec.absent?'<span class="chip ch-ab">결근</span>':rec.annual?'<span class="chip ch-al">연차</span>':''}</td>
        <td class="td-bk" style="font-size:10px;color:#2D6A4F">${c&&c.bkMins>0?fmtH(c.bkMins)+(c.nightBkMins>0?`<div style="font-size:8px;color:#7C3AED;margin-top:1px">야간${fmtH(c.nightBkMins)}</div>`:''):''}</td>
        <td class="td-nt">${c&&c.nightM>30?fmtH(c.nightM):''}</td>
        <td class="td-ot">${c&&c.ot>0?fmtH(c.ot):''}</td>
        <td class="td-hol">${autoH&&holPay>0?`<span style="color:#854F0B;font-weight:700;font-size:11px">${Math.round(holPay/1000)}k</span>`:autoH&&c?fmtH(c.work):''}</td>
        <td>
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
            <label style="font-size:10px;color:var(--green);display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:600">
              <input type="checkbox" ${rec.annual?'checked':''} onchange="setR(${emp.id},'annual',this.checked)">연차
            </label>
            <label style="font-size:10px;color:var(--ink2);display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:500">
              <input type="checkbox" ${rec.absent?'checked':''} onchange="setR(${emp.id},'absent',this.checked)">결근
            </label>
            <label style="font-size:10px;color:var(--green);display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:600" title="전체 휴게시간 무시하고 개인 휴게시간 적용">
              <input type="checkbox" ${rec.customBk?'checked':''} onchange="setR(${emp.id},'customBk',this.checked)">개별휴게
            </label>
            <button class="out-btn ${(rec.outTimes&&rec.outTimes.length>0)?'active':''}" onclick="addOutTime(${emp.id})">+ 외출</button>
            <input class="note-inp" value="${esc(rec.note||'')}" placeholder="비고" oninput="setR(${emp.id},'note',this.value)">
          </div>
          ${pohalOutUI}
          ${pohalBkUI}
        </td>
        <td style="padding:4px 6px;font-size:10px">
          ${autoH&&holPay>0
            ?`<span style="color:#854F0B;font-weight:700">휴일수당 ${fmt$(holPay)}</span>`
            :isWork?'<span style="color:var(--green);font-weight:600">월급 지급</span>'
            :rec.annual?'<span style="color:var(--green)">연차</span>'
            :'<span style="color:var(--rose)">결근차감</span>'}
        </td>
      </tr>`;
    }

    // ── 월급제 행 ──
    if(empPayMode==='monthly'){
      const isWork=!rec.absent&&!rec.annual;
      const holPay=c?(c.holDayStdPay+c.holDayOtPay):0;
      const holWorkH=c&&autoH?fmtH(c.work):'';
      // 개별휴게 UI
      const monthlyBkUI = rec.customBk ? `<div style="margin-top:4px;padding:5px 8px;background:var(--gbg);border:1px solid #BBF7D0;border-radius:6px">
        <div style="font-size:9px;font-weight:700;color:var(--green);margin-bottom:3px">개인 휴게시간</div>
        ${(rec.customBkList||[{s:'',e:''}]).map((b,bi)=>`<div style="display:flex;align-items:center;gap:3px;margin-bottom:2px">
          <input class="out-time" value="${b.s||''}" placeholder="1200" style="border-color:#BBF7D0" onblur="setCustomBk(${emp.id},${bi},'s',this.value)" onkeydown="if(event.key==='Enter')setCustomBk(${emp.id},${bi},'s',this.value)">
          <span style="font-size:10px;color:var(--ink3)">~</span>
          <input class="out-time" value="${b.e||''}" placeholder="1300" style="border-color:#BBF7D0" onblur="setCustomBk(${emp.id},${bi},'e',this.value)" onkeydown="if(event.key==='Enter')setCustomBk(${emp.id},${bi},'e',this.value)">
          <button class="out-x" onclick="delCustomBk(${emp.id},${bi})" style="color:#065F46">×</button>
        </div>`).join('')}
        <button class="bk-add" onclick="addCustomBk(${emp.id})" style="font-size:9px;margin-top:2px;padding:2px 8px">+ 세트 추가</button>
      </div>` : '';
      // 외출 UI
      const monthlyOutUI=(rec.outTimes&&rec.outTimes.length>0)?`<div style="margin-top:4px;padding:5px 7px;background:var(--abg);border-radius:6px;border:1px solid #FCD34D">
        ${(rec.outTimes||[]).map((o,oi)=>`<div class="out-row">
          <span style="font-size:9px;font-weight:700;color:var(--amber)">외출${oi+1}</span>
          <input class="out-time" value="${o.s||''}" placeholder="0900" onblur="setOutTime(${emp.id},${oi},'s',this.value)" onkeydown="if(event.key==='Enter')setOutTime(${emp.id},${oi},'s',this.value)">
          <span style="font-size:11px;color:var(--ink3)">~</span>
          <input class="out-time" value="${o.e||''}" placeholder="1000" onblur="setOutTime(${emp.id},${oi},'e',this.value)" onkeydown="if(event.key==='Enter')setOutTime(${emp.id},${oi},'e',this.value)">
          <button class="out-x" onclick="delOutTime(${emp.id},${oi})">×</button>
        </div>`).join('')}
      </div>`:'';
      return`<tr class="${rowCls}">
        ${cbTd}${nameTd}
        <td><input class="time-inp ${rec.absent||rec.annual?'dis':''}" value="${rec.start||''}" placeholder="0900" ${rec.absent||rec.annual?'disabled':''} data-eid="${emp.id}" data-field="start"
          onblur="handleTimeInput(${emp.id},'start',this.value)"></td>
        <td><input class="time-inp ${c&&c.crossed?'cross':autoH?'hol-t':''} ${rec.absent||rec.annual?'dis':''}" value="${rec.end||''}" placeholder="1800" ${rec.absent||rec.annual?'disabled':''} data-eid="${emp.id}" data-field="end"
          onblur="handleTimeInput(${emp.id},'end',this.value)"></td>
        <td class="td-w">${c&&isWork?`<div>${holWorkH||fmtH(c.work)}</div><div style="margin-top:1px">${chips.join('')}</div>`:rec.absent?'<span class="chip ch-ab">결근</span>':rec.annual?'<span class="chip ch-al">연차</span>':''}</td>
        <td class="td-bk" style="font-size:10px;color:#2D6A4F">${c&&c.bkMins>0?fmtH(c.bkMins)+(c.nightBkMins>0?`<div style="font-size:8px;color:#7C3AED;margin-top:1px">야간${fmtH(c.nightBkMins)}</div>`:''):''}</td>
        <td class="td-nt" style="font-size:10px;color:var(--ink3)"></td>
        <td class="td-ot" style="font-size:10px;color:var(--ink3)"></td>
        <td class="td-hol">${autoH&&holPay>0?`<span style="color:#854F0B;font-weight:700;font-size:11px">${Math.round(holPay/1000)}k</span>`:autoH&&c?fmtH(c.work):''}</td>
        <td>
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
            <label style="font-size:10px;color:var(--green);display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:600">
              <input type="checkbox" ${rec.annual?'checked':''} onchange="setR(${emp.id},'annual',this.checked)">연차
            </label>
            <label style="font-size:10px;color:#0891B2;display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:600">
              <input type="checkbox" ${rec.halfAnnual?'checked':''} onchange="setR(${emp.id},'halfAnnual',this.checked)">반차
            </label>
            <label style="font-size:10px;color:var(--ink2);display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:500">
              <input type="checkbox" ${rec.absent?'checked':''} onchange="setR(${emp.id},'absent',this.checked)">결근
            </label>
            <label style="font-size:10px;color:var(--green);display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:600" title="전체 휴게시간 무시하고 개인 휴게시간 적용">
              <input type="checkbox" ${rec.customBk?'checked':''} onchange="setR(${emp.id},'customBk',this.checked)">개별휴게
            </label>
            <button class="out-btn ${(rec.outTimes&&rec.outTimes.length>0)?'active':''}" onclick="addOutTime(${emp.id})">+ 외출</button>
            <input class="note-inp" value="${esc(rec.note||'')}" placeholder="비고" oninput="setR(${emp.id},'note',this.value)">
          </div>
          ${monthlyOutUI}
          ${monthlyBkUI}
        </td>
        <td style="padding:4px 6px;font-size:10px">
          ${autoH&&holPay>0?`<span style="color:#854F0B;font-weight:700">휴일수당 ${fmt$(holPay)}</span>`:isWork?'<span style="color:var(--green);font-weight:600">월급 지급</span>':rec.annual?'<span style="color:var(--green)">연차</span>':rec.halfAnnual?'<span style="color:#0891B2">반차</span>':autoH?'<span style="color:var(--ink3)">휴일</span>':'<span style="color:var(--rose)">결근차감</span>'}
        </td>
      </tr>`;
    }
    const sCls=c&&!rec.annual&&c.nightM>30?'night':'';
    const eCls=c&&!rec.annual&&c.crossed?'cross':autoH?'hol-t':'';
    const outUI=(rec.outTimes&&rec.outTimes.length>0)?`<div style="margin-top:4px;padding:5px 7px;background:var(--abg);border-radius:6px;border:1px solid #FCD34D">
      ${(rec.outTimes||[]).map((o,oi)=>`<div class="out-row">
        <span style="font-size:9px;font-weight:700;color:var(--amber)">외출${oi+1}</span>
        <input class="out-time" value="${o.s||''}" placeholder="0900" onblur="setOutTime(${emp.id},${oi},'s',this.value)" onkeydown="if(event.key==='Enter')setOutTime(${emp.id},${oi},'s',this.value)">
        <span style="font-size:11px;color:var(--ink3)">~</span>
        <input class="out-time" value="${o.e||''}" placeholder="1000" onblur="setOutTime(${emp.id},${oi},'e',this.value)" onkeydown="if(event.key==='Enter')setOutTime(${emp.id},${oi},'e',this.value)">
        <button class="out-x" onclick="delOutTime(${emp.id},${oi})">×</button>
      </div>`).join('')}
    </div>`:'';
    const customBkUI = rec.customBk ? `<div style="margin-top:4px;padding:5px 8px;background:var(--gbg);border:1px solid #BBF7D0;border-radius:6px">
      <div style="font-size:9px;font-weight:700;color:var(--green);margin-bottom:3px">개인 휴게시간</div>
      ${(rec.customBkList||[{s:'',e:''}]).map((b,bi)=>`<div style="display:flex;align-items:center;gap:3px;margin-bottom:2px">
        <input class="out-time" value="${b.s||''}" placeholder="1200" style="border-color:#BBF7D0" onblur="setCustomBk(${emp.id},${bi},'s',this.value)" onkeydown="if(event.key==='Enter')setCustomBk(${emp.id},${bi},'s',this.value)">
        <span style="font-size:10px;color:var(--ink3)">~</span>
        <input class="out-time" value="${b.e||''}" placeholder="1300" style="border-color:#BBF7D0" onblur="setCustomBk(${emp.id},${bi},'e',this.value)" onkeydown="if(event.key==='Enter')setCustomBk(${emp.id},${bi},'e',this.value)">
        <button class="out-x" onclick="delCustomBk(${emp.id},${bi})" style="color:#065F46">×</button>
      </div>`).join('')}
      <button class="bk-add" onclick="addCustomBk(${emp.id})" style="font-size:9px;margin-top:2px;padding:2px 8px">+ 세트 추가</button>
    </div>` : '';
    return`<tr class="${rowCls}">
      ${cbTd}${nameTd}
      <td><input class="time-inp ${sCls} ${rec.absent||rec.annual?'dis':''}" value="${rec.start||''}" placeholder="0900" ${rec.absent||rec.annual?'disabled':''} data-eid="${emp.id}" data-field="start"
        onblur="handleTimeInput(${emp.id},'start',this.value)"></td>
      <td><input class="time-inp ${eCls} ${rec.absent||rec.annual?'dis':''}" value="${rec.end||''}" placeholder="1800" ${rec.absent||rec.annual?'disabled':''} data-eid="${emp.id}" data-field="end"
        onblur="handleTimeInput(${emp.id},'end',this.value)"></td>
      <td class="td-w">${c?`<div>${fmtH(c.work)}</div><div style="margin-top:1px">${chips.join('')}</div>`:rec.absent?'<span class="chip ch-ab">결근</span>':rec.halfAnnual?'<div><span class="chip" style="background:#E0E7FF;color:#3730A3;font-weight:700">반차</span></div><div style="font-size:9px;color:#0891B2;margin-top:2px">4h</div>':''}</td>
      <td class="td-bk" style="font-size:10px;color:#2D6A4F">${c&&c.bkMins>0?fmtH(c.bkMins)+(c.nightBkMins>0?`<div style="font-size:8px;color:#7C3AED;margin-top:1px">야간${fmtH(c.nightBkMins)}</div>`:''):''}</td>
      <td class="td-nt">${c&&!rec.annual&&c.nightM>30?fmtH(c.nightM):''}</td>
      <td class="td-ot">${c&&!rec.annual&&c.ot>0?fmtH(c.ot):''}</td>
      <td class="td-hol">${c&&!rec.annual&&autoH?fmtH(c.work):''}</td>
      <td>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <label style="font-size:10px;color:var(--green);display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:600">
            <input type="checkbox" ${rec.annual?'checked':''} onchange="setR(${emp.id},'annual',this.checked)">연차
          </label>
          <label style="font-size:10px;color:#0891B2;display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:600">
            <input type="checkbox" ${rec.halfAnnual?'checked':''} onchange="setR(${emp.id},'halfAnnual',this.checked)">반차
          </label>
          <label style="font-size:10px;color:var(--ink2);display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:500">
            <input type="checkbox" ${rec.absent?'checked':''} onchange="setR(${emp.id},'absent',this.checked)">결근
          </label>
          <label style="font-size:10px;color:var(--green);display:flex;align-items:center;gap:2px;cursor:pointer;font-weight:600" title="전체 휴게시간 무시하고 개인 휴게시간 적용">
            <input type="checkbox" ${rec.customBk?'checked':''} onchange="setR(${emp.id},'customBk',this.checked)">개별휴게
          </label>
          <button class="out-btn ${(rec.outTimes&&rec.outTimes.length>0)?'active':''}" onclick="addOutTime(${emp.id})">+ 외출</button>
          <input class="note-inp" value="${esc(rec.note||'')}" placeholder="비고" oninput="setR(${emp.id},'note',this.value)">
        </div>
        ${outUI}
        ${customBkUI}
      </td>
    </tr>`;
  }).join('');
  } finally {
    if(_polSwapped) POL = _origPOL;
  }
}

// ══ Tab 키 네비게이션 ══

function setMonthlyAtt(eid, type){
  const k=rk(eid,cY,cM,cD);
  if(!REC[k])REC[k]={empId:eid,start:'',end:'',absent:false,annual:false,halfAnnual:false,note:'',outTimes:[],customBk:false,customBkList:[]};
  REC[k].absent=false; REC[k].annual=false; REC[k].halfAnnual=false;
  if(type==='absent') REC[k].absent=true;
  else if(type==='annual') REC[k].annual=true;
  else if(type==='half') REC[k].halfAnnual=true;
  // 'work'는 모두 false = 출근
  saveLS(); renderTable();
  const lvPage=document.getElementById('pg-leave');
  if(lvPage&&lvPage.classList.contains('on')) renderLeave();
}

// ── 급여내용보기 Tab 네비게이션 ──
function xlTableKeyNav(e){
  if(e.key !== 'Tab') return;
  const active = document.activeElement;
  if(!active || !active.isContentEditable) return;
  e.preventDefault();
  const cells = Array.from(document.querySelectorAll('#xl-preview-wrap [contenteditable="true"]'));
  const curIdx = cells.indexOf(active);
  const nextIdx = e.shiftKey ? curIdx - 1 : curIdx + 1;
  const next = cells[nextIdx];
  if(next){
    next.focus();
    // 커서를 끝으로
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(next);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
// time-inp(출퇴근 시간) 입력에 Enter/Tab/화살표 키 위임 바인딩.
// 각 input에 onkeydown 직접 지정하지 않고 document 레벨에서 처리.
document.addEventListener('keydown', function(e){
  const el = e.target;
  if(!el || !el.classList || !el.classList.contains('time-inp')) return;
  if(el.disabled) return;
  const eid = parseInt(el.dataset.eid);
  const field = el.dataset.field;
  if(!eid || !field) return;
  timeKeyNav(e, el, eid, field);
});

function timeKeyNav(e, el, eid, field) {
  if (e.key === 'Tab' || e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();

    // 1. 값 파싱 + 포맷
    const parsed = parseTimeInput(el.value);
    el.value = parsed;

    // 2. 다음 input 먼저 찾기 (DOM 재생성 전에)
    const allInputs = Array.from(document.querySelectorAll('#daily-tbody input.time-inp'))
      .filter(inp => !inp.disabled && inp.offsetParent !== null);
    const curIdx = allInputs.indexOf(el);
    const nextIdx = e.shiftKey ? curIdx - 1 : curIdx + 1;
    const nextInput = (nextIdx >= 0 && nextIdx < allInputs.length) ? allInputs[nextIdx] : null;

    // 3. REC 업데이트 (renderTable 없이 직접)
    const k = rk(eid, cY, cM, cD);
    if(!REC[k]) REC[k]={empId:eid,start:'',end:'',absent:false,annual:false,halfAnnual:false,note:'',outTimes:[],customBk:false,customBkList:[]};
    REC[k][field] = parsed;

    // 4. localStorage만 저장 (renderTable X → DOM 재생성 방지)
    try{
      localStorage.setItem(LS.R, JSON.stringify(REC));
      // Supabase 비동기 저장 (포커스 이동 방해 안 함)
      const _sess = JSON.parse(localStorage.getItem('nopro_session')||'null');
      if(_sess && _sess.companyId){
        sbSaveAll(_sess.companyId).catch(e=>console.warn(e));
      }
    }catch(err){}

    // 5. 포커스 이동
    if(nextInput){
      nextInput.focus();
      nextInput.select();
    }

    // 6. 현재 행 수치만 업데이트 (전체 renderTable 없이)
    updateRowCalc(eid);

  } else if(e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const allInputs = Array.from(document.querySelectorAll('#daily-tbody input.time-inp'))
      .filter(inp => !inp.disabled && inp.offsetParent !== null);
    const curIdx = allInputs.indexOf(el);
    if(curIdx < 0) return;
    const step = e.key === 'ArrowDown' ? 2 : -2;
    const next = allInputs[curIdx + step];
    if(next){ next.focus(); next.select(); }
  }
}

// 행 수치만 갱신 (실근무/야간/연장 컬럼)
function updateRowCalc(eid){
  const k = rk(eid, cY, cM, cD);
  const rec = REC[k];
  if(!rec || !rec.start || !rec.end) return;
  const emp = EMPS.find(e=>e.id===eid);
  if(!emp) return;
  const autoH = isAutoHol(cY, cM, cD);
  const bks = getActiveBk(cY, cM, cD, emp);
  const activeBks = rec.customBk ? (rec.customBkList||[]) : bks;
  const c = calcSession(rec.start, rec.end, getEmpRate(emp), autoH, activeBks, rec.outTimes||[], getEmpPayMode(emp), getOrdinaryRate(emp,cY,cM));
  if(!c) return;
  // 해당 행의 수치 셀 업데이트
  const rows = document.querySelectorAll('#daily-tbody tr');
  rows.forEach(tr => {
    const inp = tr.querySelector('input.time-inp[data-eid="'+eid+'"]');
    if(!inp) return;
    const workCell = tr.querySelector('.work-cell');
    const nightCell = tr.querySelector('.night-cell');
    const otCell = tr.querySelector('.ot-cell');
    if(workCell) workCell.textContent = m2h(c.work).toFixed(2);
    if(nightCell) nightCell.textContent = c.nightM>0 ? m2h(c.nightM).toFixed(2) : '';
    if(otCell) otCell.textContent = c.ot>0 ? m2h(c.ot).toFixed(2) : '';
  });
}

// ══ 전날 출퇴근 자동 세팅 ══
function getPrevDayRec(empId) {
  // 오늘 이전 날짜 중 가장 최근 출퇴근 기록 탐색 (최대 60일 전까지)
  const today = new Date(cY, cM-1, cD);
  for(let i=1; i<=60; i++){
    const d = new Date(today); d.setDate(d.getDate()-i);
    const k = rk(empId, d.getFullYear(), d.getMonth()+1, d.getDate());
    const rec = REC[k];
    if(rec && rec.start && rec.end && !rec.absent && !rec.annual && !rec.halfAnnual)
      return rec;
  }
  return null;
}
function applyRecentAll() {
  const empsToApply = activeDayEmpsForCopy();
  if(empsToApply.length===0){
    const toast=document.createElement('div');
    toast.style.cssText='position:fixed;bottom:24px;right:24px;background:#B45309;color:#fff;padding:10px 18px;border-radius:9px;font-size:12px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2)';
    toast.textContent='⚠ 대상 직원이 없습니다 (사이드바 필터를 확인해주세요)';
    document.body.appendChild(toast); setTimeout(()=>toast.remove(),2500);
    return;
  }
  const dateStr=`${cY}-${pad(cM)}-${pad(cD)}`;
  const search=(document.getElementById('sb-search-inp')?.value||'').trim();
  const filterActive=SBF.shift!=='all'||SBF.nation!=='all'||SBF.pay!=='all'||!!search;
  const filterNote=filterActive?`\n(사이드바 필터 적용됨: shift=${SBF.shift}, nation=${SBF.nation}, pay=${SBF.pay}${search?`, 검색="${search}"`:''})`:'';
  const preview=empsToApply.slice(0,5).map(e=>e.name).join(', ')+(empsToApply.length>5?` 외 ${empsToApply.length-5}명`:'');
  const msg=`📋 ${dateStr}에 직원 ${empsToApply.length}명의 가장 최근 출퇴근 기록을 복사합니다.\n\n대상: ${preview}${filterNote}\n\n※ 이미 기록이 있는 직원은 건너뜁니다.\n진행하시겠습니까?`;
  if(!confirm(msg)) return;

  let cnt=0, skipped=0, noRecent=0;
  const applied=[];
  empsToApply.forEach(emp => {
    const k = rk(emp.id, cY, cM, cD);
    const prev = getPrevDayRec(emp.id);
    if (!prev || !prev.start || !prev.end){ noRecent++; return; }
    if (REC[k] && (REC[k].start || REC[k].absent || REC[k].annual || REC[k].halfAnnual)){ skipped++; return; }
    REC[k] = {
      empId: emp.id,
      start: prev.start,
      end: prev.end,
      absent: false, annual: false, halfAnnual: false,
      note: '', outTimes: [],
      customBk: false, customBkList: []
    };
    __recWrite('applyRecentAll', emp.id, k, {start:prev.start, end:prev.end, name:emp.name});
    cnt++;
    applied.push(emp.name);
  });
  saveLS(); renderTable();
  const toast=document.createElement('div');
  toast.style.cssText='position:fixed;bottom:24px;right:24px;background:var(--navy);color:#fff;padding:10px 18px;border-radius:9px;font-size:12px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2);max-width:320px;line-height:1.5';
  if(cnt>0){
    const preview2=applied.slice(0,3).join(', ')+(applied.length>3?` 외 ${applied.length-3}명`:'');
    toast.innerHTML=`📋 ${dateStr}에 ${cnt}명 불러옴<br><span style="font-size:10px;opacity:.85">${preview2}</span>${skipped?`<br><span style="font-size:10px;opacity:.7">기존 기록 유지: ${skipped}명</span>`:''}${noRecent?`<br><span style="font-size:10px;opacity:.7">최근 기록 없음: ${noRecent}명</span>`:''}`;
  } else {
    toast.textContent = '불러올 기록이 없거나 이미 입력됨';
  }
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(), 3200);
}

function activeDayEmpsForCopy(){
  // 현재 필터 + 입사일 + 퇴사일 조건 적용한 직원 목록 (퇴사일 이후엔 자동 복사 방지)
  const dayDate=new Date(cY,cM-1,cD);
  const search=(document.getElementById('sb-search-inp')?.value||'').trim();
  return EMPS.filter(emp=>{
    if(emp.join){const jd=new Date(emp.join);if(jd>dayDate) return false;}
    if(emp.leave){const ld=new Date(emp.leave);if(ld<=dayDate) return false;}
    // 사이드바 필터 반영 (renderSb와 동일 로직)
    if(SBF.shift!=='all' && (emp.shift||'day')!==SBF.shift) return false;
    const isFor = emp.nation==='foreign' || emp.foreigner===true;
    if(SBF.nation==='korean' && isFor) return false;
    if(SBF.nation==='foreign' && !isFor) return false;
    if(SBF.pay!=='all'){
      const ep=emp.payMode||'fixed';
      if(SBF.pay==='monthly'){ if(ep!=='monthly'&&ep!=='pohal') return false; }
      else if(ep!==SBF.pay) return false;
    }
    if(search && !(emp.name||'').includes(search)) return false;
    // 급여 관리 페이지용 payFilter 전역은 하위호환 유지
    if(payFilter!=='all' && emp.payMode && emp.payMode!==payFilter) return false;
    return true;
  });
}

function isToday(){
  const t=new Date();
  return cY===t.getFullYear()&&cM===t.getMonth()+1&&cD===t.getDate();
}
let dayEditMode=false; // 과거 날짜 수정 허용 여부

function updDailyMode(){ /* 수정/잠금 모드 제거 - 항상 편집 가능 */ }

function setTableLock(locked){ /* 제거됨 */ }

function startEditDay(){/* 제거됨 */}

function saveDay(){
  // 현재 화면 input 값 강제 파싱 저장
  document.querySelectorAll('#daily-tbody input.time-inp').forEach(inp=>{
    if(inp.disabled||!inp.value) return;
    const eid=parseInt(inp.dataset.eid);
    const field=inp.dataset.field;
    if(!eid||!field) return;
    const parsed=parseTimeInput(inp.value);
    if(!parsed) return;
    const k=rk(eid,cY,cM,cD);
    if(!REC[k])REC[k]={empId:eid,start:'',end:'',absent:false,annual:false,halfAnnual:false,note:'',outTimes:[],customBk:false,customBkList:[]};
    REC[k][field]=parsed;
    __recWrite('saveDay', eid, k, {field, value:parsed});
  });
  saveLS();
  const svMsg=document.getElementById('sv-msg');
  if(svMsg){svMsg.style.display='inline';setTimeout(()=>svMsg.style.display='none',2500);}
  // 모든 관련 탭 즉시 갱신
  try{const pvPage=document.getElementById('pg-payroll');if(pvPage&&pvPage.classList.contains('on'))renderPayroll();}catch(e){}
  try{const lvPage=document.getElementById('pg-leave');if(lvPage&&lvPage.classList.contains('on'))renderLeave();}catch(e){}
  try{const mvPage=document.getElementById('pg-monthly');if(mvPage&&mvPage.classList.contains('on'))renderMonthly();}catch(e){}
}

function clearDay(){EMPS.forEach(e=>delete REC[rk(e.id,cY,cM,cD)]);saveLS();renderTable();}

function openMoveDate(){
  const empCount=EMPS.filter(e=>{
    const k=rk(e.id,cY,cM,cD);const rec=REC[k]||{};
    return rec.start||rec.end||rec.absent||rec.annual;
  }).length;
  if(empCount===0){showSyncToast('이 날 입력된 데이터가 없습니다.','warn');return;}
  const fromStr=`${cY}년 ${cM}월 ${cD}일`;
  const bg=document.createElement('div');
  bg.id='move-date-modal';
  bg.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';
  bg.innerHTML=`
    <div style="background:var(--card);border-radius:16px;padding:24px;width:360px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
      <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">📅 날짜 이동</div>
      <div style="font-size:12px;color:var(--ink3);margin-bottom:16px;">
        <b style="color:var(--ink)">${fromStr}</b> 데이터를 다른 날짜로 이동합니다.<br>
        <span style="display:inline-block;margin-top:4px;padding:3px 8px;background:var(--nbg);border-radius:6px;font-size:11px;color:var(--navy2);">
          이동할 직원 수: ${empCount}명 (전체 통으로 이동)
        </span>
      </div>
      <div style="margin-bottom:16px;">
        <label style="font-size:12px;font-weight:600;color:var(--ink);display:block;margin-bottom:6px;">이동할 날짜 선택</label>
        <input type="date" id="move-date-input"
          style="width:100%;height:36px;border:1.5px solid var(--bd2);border-radius:8px;padding:0 10px;font-size:13px;font-family:inherit;background:var(--card);color:var(--ink);"
          value="${cY}-${String(cM).padStart(2,'0')}-${String(cD).padStart(2,'0')}">
      </div>
      <div id="move-date-conflict" style="display:none;background:#FFF8F0;border:1px solid #F59E0B;border-radius:8px;padding:10px 12px;font-size:12px;color:#854F0B;margin-bottom:14px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="closeMoveDate()" style="padding:7px 16px;border:1px solid var(--bd2);border-radius:8px;background:transparent;font-size:12px;color:var(--ink3);cursor:pointer;font-family:inherit;">취소</button>
        <button onclick="checkMoveDate()" style="padding:7px 16px;background:var(--navy);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">다음 →</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
}

function closeMoveDate(){
  const el=document.getElementById('move-date-modal');
  if(el) el.remove();
}

function checkMoveDate(){
  const inp=document.getElementById('move-date-input');
  if(!inp||!inp.value){showSyncToast('날짜를 선택해주세요.','warn');return;}
  const d=new Date(inp.value);
  const tY=d.getFullYear(),tM=d.getMonth()+1,tD=d.getDate();
  if(tY===cY&&tM===cM&&tD===cD){showSyncToast('현재와 같은 날짜입니다.','warn');return;}

  const srcEmps=EMPS.filter(e=>{const k=rk(e.id,cY,cM,cD);const rec=REC[k]||{};return rec.start||rec.end||rec.absent||rec.annual;});
  const conflictEmps=srcEmps.filter(e=>{const k=rk(e.id,tY,tM,tD);const rec=REC[k]||{};return rec.start||rec.end||rec.absent||rec.annual;});
  const toStr=`${tY}년 ${tM}월 ${tD}일`;

  if(conflictEmps.length>0){
    const div=document.getElementById('move-date-conflict');
    if(div){
      div.style.display='block';
      div.innerHTML=`
        ⚠️ <b>${toStr}</b>에 이미 ${conflictEmps.length}명의 데이터가 있습니다.<br>
        <span style="color:#6B7280">${conflictEmps.map(e=>e.name).join(', ')}</span><br>
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button onclick="execMoveDate(${tY},${tM},${tD},'overwrite')"
            style="padding:5px 12px;background:#EF4444;color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;">기존 데이터 덮어쓰기</button>
          <button onclick="execMoveDate(${tY},${tM},${tD},'keep')"
            style="padding:5px 12px;background:var(--navy);color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;">기존 데이터 유지</button>
        </div>`;
    }
  } else {
    execMoveDate(tY,tM,tD,'overwrite');
  }
}

function execMoveDate(tY,tM,tD,mode){
  const srcEmps=EMPS.filter(e=>{const k=rk(e.id,cY,cM,cD);const rec=REC[k]||{};return rec.start||rec.end||rec.absent||rec.annual;});
  const fromStr=`${cY}년 ${cM}월 ${cD}일`;
  const toStr=`${tY}년 ${tM}월 ${tD}일`;
  let moved=0;
  srcEmps.forEach(e=>{
    const srcKey=rk(e.id,cY,cM,cD);
    const dstKey=rk(e.id,tY,tM,tD);
    const srcRec=REC[srcKey];
    if(!srcRec) return;
    const dstExists=REC[dstKey]&&(REC[dstKey].start||REC[dstKey].end||REC[dstKey].absent||REC[dstKey].annual);
    if(!(dstExists&&mode==='keep')){ REC[dstKey]={...srcRec}; __recWrite('execMoveDate', e.id, dstKey, {from:srcKey, mode}); }
    delete REC[srcKey];
    moved++;
  });
  saveLS();
  closeMoveDate();
  showSyncToast(`${fromStr} → ${toStr} 이동 완료 (${moved}명)`,'ok');
  cY=tY;cM=tM;cD=tD;
  updDbar();renderBks();renderTable();
}

// 개별 휴게시간 함수
function setCustomBk(eid,idx,field,raw){
  const k=rk(eid,cY,cM,cD);
  if(!REC[k])REC[k]={empId:eid,start:'',end:'',absent:false,annual:false,note:'',outTimes:[],customBk:false,customBkList:[]};
  if(!REC[k].customBkList)REC[k].customBkList=[];
  if(!REC[k].customBkList[idx])REC[k].customBkList[idx]={s:'',e:''};
  REC[k].customBkList[idx][field]=parseTimeInput(raw)||'';
  saveLS();renderTable();
}
function addCustomBk(eid){
  const k=rk(eid,cY,cM,cD);
  if(!REC[k])REC[k]={empId:eid,start:'',end:'',absent:false,annual:false,note:'',outTimes:[],customBk:false,customBkList:[]};
  if(!REC[k].customBkList)REC[k].customBkList=[];
  REC[k].customBkList.push({s:'',e:''});
  saveLS();renderTable();
}
function delCustomBk(eid,idx){
  const k=rk(eid,cY,cM,cD);
  if(!REC[k]||!REC[k].customBkList)return;
  REC[k].customBkList.splice(idx,1);
  saveLS();renderTable();
}

// ══════════════════════════════════════
// 월별 현황
// ══════════════════════════════════════
function cvm(d){vM+=d;if(vM>12){vM=1;vY++;}if(vM<1){vM=12;vY--;}renderMonthly();}
function setMvMode(m){vMode=m;['mv-cal','mv-ov'].forEach((id,i)=>{const el=document.getElementById(id);if(!el)return;const a=(i===0&&m==='cal')||(i===1&&m==='ov');el.style.background=a?'var(--nbg)':'';el.style.color=a?'var(--navy2)':'';el.style.borderColor=a?'var(--navy2)':'var(--bd2)';});renderMonthly();}

let mvFilter = 'all';
const MF = { shift:'all', nation:'all', dept:'all' };
function setMvSubFilter(key, val, btn){
  MF[key] = val;
  if(btn){
    const grp = btn.closest('div');
    if(grp) grp.querySelectorAll('.mvf-sub').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
  }
  renderMonthly();
}
function setMvFilter(f){
  mvFilter = f;
  document.querySelectorAll('.mvf-btn').forEach(b=>{
    b.classList.toggle('on', b.dataset.f===f);
  });
  renderMonthly();
}
function renderMonthly(){
  // 과거 달 조회 시 그 달 정책 스냅샷 사용 (renderCal/renderOv 내부 calcSession에 전파)
  const _origPOL = POL;
  const _monthPOL = (typeof getPolForMonth==='function') ? getPolForMonth(vY, vM) : POL;
  const _polSwapped = _monthPOL !== _origPOL;
  if(_polSwapped) POL = _monthPOL;
  try {
  document.getElementById('mv-title').textContent=`${vY}년 ${vM}월 근태 현황`;
  // 소속 필터 동적 생성
  const mvDeptDiv = document.getElementById('mv-dept-filter');
  if(mvDeptDiv){
    const depts=[...new Set(EMPS.map(e=>(e.dept||'').trim()).filter(d=>d))].sort();
    if(depts.length){
      mvDeptDiv.style.display='flex';
      mvDeptDiv.innerHTML=['all',...depts].map(v=>`
        <button class="mvf-sub btn btn-xs${MF.dept===v?' on':''}"
          onclick="setMvSubFilter('dept','${v}',this)"
          style="font-size:10px;background:${MF.dept===v?'var(--navy)':'transparent'};color:${MF.dept===v?'#fff':'var(--ink3)'};">
          ${v==='all'?'전체':v}
        </button>`).join('');
    } else { mvDeptDiv.style.display='none'; }
  }
  const mvMonthEnd = new Date(vY, vM, 0); // 해당 월 마지막 날
  const mvMonthStart = new Date(vY, vM-1, 1);
  const mvEmps = EMPS.filter(e=>{
    // 퇴사자: 해당 월 시작 전에 퇴사했으면 제외
    if(e.leave){const ld=new Date(e.leave);if(ld<mvMonthStart)return false;}
    if(mvFilter!=='all'){const ep=e.payMode||'fixed';if(mvFilter==='monthly'){if(ep!=='monthly'&&ep!=='pohal')return false;}else{if(ep!==mvFilter)return false;}}
    if(MF.shift!=='all' && (e.shift||'day')!==MF.shift) return false;
    const isFor = e.nation==='foreign'||e.foreigner===true;
    if(MF.nation==='korean' && isFor) return false;
    if(MF.nation==='foreign' && !isFor) return false;
    if(MF.dept!=='all' && (e.dept||'').trim()!==MF.dept) return false;
    return true;
  });
  // 현재 선택 직원이 필터에 없으면 첫 번째로 리셋
  if(!mvEmps.find(e=>e.id===vEid) && mvEmps.length>0) vEid=mvEmps[0].id;
  document.getElementById('mv-tabs').innerHTML=mvEmps.map(e=>`
    <button onclick="vEid=${e.id};renderMonthly()"
      style="padding:2px 8px;font-size:10px;border:1px solid ${e.id===vEid?'var(--navy2)':'var(--bd2)'};border-radius:12px;background:${e.id===vEid?'var(--nbg)':'var(--card)'};color:${e.id===vEid?'var(--navy2)':'var(--ink2)'};cursor:pointer;font-family:inherit;font-weight:${e.id===vEid?'700':'500'}">${esc(e.name)}</button>`).join('');
  document.getElementById('mv-body').innerHTML=vMode==='cal'?renderCal():renderOv();
  if(vMode!=='cal' && typeof setupOvScrollSync==='function'){
    // innerHTML 설정 직후 레이아웃이 아직 없을 수 있으므로 다음 프레임에서 측정
    requestAnimationFrame(setupOvScrollSync);
  }
  } finally {
    if(_polSwapped) POL = _origPOL;
  }
}
function renderCal(){
  const emp=EMPS.find(e=>e.id===vEid);if(!emp)return'';
  const s=monthSummary(vEid,vY,vM),days=dim(vY,vM);
  const curBonus=getMonthBonus(vEid,vY,vM);
  const al=calcAnnualLeave(emp);
  let h=`<div class="sg5">
    <div class="sc"><div class="sc-l">근무일</div><div class="sc-v">${s.wdays}<span class="sc-u">일</span></div></div>
    <div class="sc"><div class="sc-l">연차사용</div><div class="sc-v" style="color:var(--green)">${s.aldays}<span class="sc-u">일</span></div></div>
    <div class="sc"><div class="sc-l">야간</div><div class="sc-v">${(s.tNightH||0).toFixed(2)}<span class="sc-u">h</span></div></div>
    <div class="sc"><div class="sc-l">연장</div><div class="sc-v">${((s.tOtDayH||0)+(s.tOtNightH||0)).toFixed(2)}<span class="sc-u">h</span></div></div>
    <div class="sc ok"><div class="sc-l">월 급여</div><div class="sc-v" style="font-size:15px;color:var(--green)">${Math.round(s.total/10000)}<span class="sc-u">만원</span></div></div>
  </div>
  <div style="background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:11px 15px;margin-bottom:11px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,.05)">
    <div>
      <div style="font-size:12px;font-weight:700;color:var(--ink)">${vY}년 ${vM}월 상여금</div>
      <div style="font-size:10px;color:${al.remain<0?'var(--rose)':'var(--ink3)'};margin-top:2px;font-weight:${al.remain<0?'700':'400'}">연차잔여 ${al.remain}개 (총 ${al.total}개 중 ${al.used}개 사용)</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <input type="number" value="${curBonus}" placeholder="0"
        style="width:120px;padding:6px 9px;font-size:13px;font-weight:700;border:1.5px solid var(--bd2);border-radius:8px;text-align:right;font-family:inherit;color:var(--purple)"
        onfocus="this.style.borderColor='var(--navy2)'"
        onblur="this.style.borderColor='var(--bd2)';setMonthBonus(${vEid},${vY},${vM},+this.value);clearTimeout(this._t);this._t=setTimeout(()=>renderMonthly(),500)">
      <span style="font-size:12px;color:var(--ink3);font-weight:500">원</span>
      ${curBonus>0?`<span style="font-size:11px;color:var(--purple);background:var(--pbg);padding:3px 9px;border-radius:8px;font-weight:600">${fmt$(curBonus)}원</span>`:''}
    </div>
  </div>
  <div class="cgrid">`;
  ['일','월','화','수','목','금','토'].forEach((x,i)=>h+=`<div class="cdh ${i===0?'su':i===6?'sa':''}">${x}</div>`);
  const fd=fdow(vY,vM);for(let i=0;i<fd;i++)h+=`<div class="cdc em"></div>`;
  const calEmpMode=emp?getEmpPayMode(emp):POL.basePayMode;
  const calLeaveDate = emp.leave ? new Date(emp.leave) : null;
  for(let d=1;d<=days;d++){
    const dow=(fd+d-1)%7,rec=REC[rk(vEid,vY,vM,d)];
    // 퇴사일 이후 날짜는 비활성 표시 (근무시간 미집계와 UI 일치)
    if(calLeaveDate){
      const curDate=new Date(vY,vM-1,d);
      if(calLeaveDate<=curDate){
        h+=`<div class="cdc em" style="opacity:.45;background:var(--rose-dim,#FEE2E2)"><div class="cdn ${dow===0?'su':dow===6?'sa':''}">${d}</div><div style="font-size:9px;color:var(--rose);font-weight:700">퇴사후</div></div>`;
        continue;
      }
    }
    const autoH=isAutoHol(vY,vM,d,emp),phName=getPhName(vY,vM,d);
    const rate=getEmpRate(emp);
    const isAl=rec&&rec.annual;
    const isHalf=rec&&rec.halfAnnual;
    const _calBks=getActiveBk(vY,vM,d,emp);
    const _calActiveBks = rec && rec.customBk ? (rec.customBkList||[]) : _calBks;
    const c=rec&&!rec.absent&&!isAl&&rec.start&&rec.end?calcSession(rec.start,rec.end,rate,autoH,_calActiveBks,rec.outTimes||[],calEmpMode,getOrdinaryRate(emp,vY,vM)):null;
    const isSel=vY===cY&&vM===cM&&d===cD;
    let cls='cdc '+(rec&&rec.absent?'abd':isAl?'ald':isHalf?'ald':phName?'phd':c?'hd':'')+(isSel?' sel':'');
    let inner=`<div class="cdn ${dow===0?'su':dow===6?'sa':phName?'ph':''}">${d}</div>`;
    if(phName)inner+=`<div class="ph-name">${phName}</div>`;
    if(rec&&rec.absent)inner+=`<div style="font-size:9px;color:#DC2626">결근</div>`;
    else if(isAl)inner+=`<div style="font-size:9px;color:var(--green);font-weight:700">연차</div>`;
    else if(isHalf){
      inner+=`<div style="font-size:9px;color:#0891B2;font-weight:700">반차</div>`;
      if(c){inner+=`<div class="cti">${rec.start}~${rec.end}</div><div class="cwk">${fmtH(c.work)}</div>`;}
      else{inner+=`<div style="font-size:8px;color:#0891B2">0.5일</div>`;}
    } else if(c){
      inner+=`<div class="cti">${rec.start}~${rec.end}</div><div class="cwk">${fmtH(c.work)}</div><div>`;
      if(c.crossed)inner+=`<span class="tch" style="background:var(--gbg);color:#065F46">익일</span>`;
      if(c.nightM>30)inner+=`<span class="tch" style="background:var(--abg);color:#92400E">야${m2h(c.nightM).toFixed(2)}h</span>`;
      if(c.ot>0)inner+=`<span class="tch" style="background:#EDE9FE;color:#4C1D95">연${m2h(c.ot).toFixed(2)}h</span>`;
      if(autoH)inner+=`<span class="tch" style="background:#FED7AA;color:#9A3412">휴</span>`;
      inner+=`</div>`;
    }
    h+=`<div class="${cls}" onclick="jumpDay(${vY},${vM},${d})">${inner}</div>`;
  }
  return h+'</div>';
}
function renderOv(){
  const days=dim(vY,vM);
  let th=`<th style="position:sticky;left:0;z-index:2;background:var(--navy);min-width:76px">직원</th>`;
  for(let d=1;d<=days;d++){const dow=(fdow(vY,vM)+d-1)%7;const ph=getPhName(vY,vM,d);const autoH=isAutoHol(vY,vM,d);th+=`<th style="${dow===0||autoH?'color:#FCA5A5':dow===6?'color:#93C5FD':''}" title="${ph||''}">${d}${ph?'🎌':''}<br><span style="font-weight:400;font-size:8px;opacity:.7">${DOW[dow]}</span></th>`;}
  th+=`<th style="background:#0E4D2E">근무일</th><th style="background:#0E4D2E">연차</th><th style="background:#0E4D2E">실근무</th><th style="background:#0E4D2E">월급여</th>`;
  const mvEmps = EMPS.filter(e=>{
    if(mvFilter!=='all'){const ep=e.payMode||'fixed';if(mvFilter==='monthly'){if(ep!=='monthly'&&ep!=='pohal')return false;}else{if(ep!==mvFilter)return false;}}
    if(MF.shift!=='all' && (e.shift||'day')!==MF.shift) return false;
    const isFor = e.nation==='foreign' || e.foreigner===true;
    if(MF.nation==='korean' && isFor) return false;
    if(MF.nation==='foreign' && !isFor) return false;
    if(MF.dept!=='all' && (e.dept||'').trim()!==MF.dept) return false;
    return true;
  });
  const rows=mvEmps.map(emp=>{
    const rate=getEmpRate(emp);
    const ovLeaveDate = emp.leave ? new Date(emp.leave) : null;
    let tr=`<td class="ec"><div style="display:flex;align-items:center;gap:4px"><div class="av" style="width:19px;height:19px;font-size:9px;background:${safeColor(emp.color,'#DBEAFE')};color:${safeColor(emp.tc,'#1E3A5F')}">${esc(emp.name)[0]}</div>${esc(emp.name)}${emp.leave?'<span style="font-size:8px;color:var(--rose);margin-left:2px">퇴사</span>':''}</div></td>`;
    for(let d=1;d<=days;d++){
      // 퇴사일 이후 셀은 비활성 표시
      if(ovLeaveDate){
        const curDate=new Date(vY,vM-1,d);
        if(ovLeaveDate<=curDate){ tr+=`<td class="mt" style="background:var(--rose-dim,#FEE2E2);color:var(--rose);opacity:.5">-</td>`; continue; }
      }
      const rec=REC[rk(emp.id,vY,vM,d)];
      const autoH=isAutoHol(vY,vM,d);
      const isAl=rec&&rec.annual;
      const _ovBks=getActiveBk(vY,vM,d,emp);
      const _ovActiveBks = rec && rec.customBk ? (rec.customBkList||[]) : _ovBks;
      const c=rec&&!rec.absent&&!isAl&&rec.start&&rec.end?calcSession(rec.start,rec.end,rate,autoH,_ovActiveBks,rec.outTimes||[],getEmpPayMode(emp),getOrdinaryRate(emp,vY,vM)):null;
      const ph=getPhName(vY,vM,d);
      if(rec&&rec.absent)tr+=`<td class="ab2">결근</td>`;
      else if(isAl)tr+=`<td class="al2">연차</td>`;
      else if(rec&&rec.halfAnnual)tr+=`<td class="al2" style="background:#E0F2FE;color:#0891B2">반차${c?'<br>'+fmtH(c.work):''}</td>`;
      else if(ph&&!c)tr+=`<td class="ph2" title="${ph}">🎌</td>`;
      else if(c)tr+=`<td class="${autoH?'ph2':'hd2'}">${fmtH(c.work)}</td>`;
      else tr+=`<td class="mt">-</td>`;
    }
    const s=monthSummary(emp.id,vY,vM);
    tr+=`<td class="sm">${s.wdays}일</td><td class="sm" style="background:var(--gbg);color:var(--green)">${s.aldays}일</td><td class="sm">${s.twkH.toFixed(2)}h</td><td class="sm">${Math.round(s.total/10000)}만</td>`;
    return`<tr>${tr}</tr>`;
  }).join('');
  return`<div class="ov-scroll-top" id="ov-scroll-top"><div class="ov-scroll-spacer" id="ov-scroll-spacer"></div></div>
<div class="ov-w" id="ov-w"><table class="ov-t"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// 전체현황표 상단 스크롤바 ↔ 본 테이블 가로 스크롤 양방향 동기화
function setupOvScrollSync(){
  const top = document.getElementById('ov-scroll-top');
  const w = document.getElementById('ov-w');
  const spacer = document.getElementById('ov-scroll-spacer');
  if(!top || !w || !spacer) return;
  const t = w.querySelector('.ov-t');
  if(!t) return;
  const apply = () => {
    // 항상 상단 스크롤바 표시 (가로 길이가 화면에 들어와도 시각적 일관성 유지)
    top.classList.add('on');
    w.classList.add('has-top');
    spacer.style.width = t.scrollWidth + 'px';
  };
  apply();
  let syncing = false;
  top.onscroll = () => { if(syncing) return; syncing = true; w.scrollLeft = top.scrollLeft; requestAnimationFrame(()=>{ syncing = false; }); };
  w.onscroll = () => { if(syncing) return; syncing = true; top.scrollLeft = w.scrollLeft; requestAnimationFrame(()=>{ syncing = false; }); };
  // 폰트/이미지 로드 후 너비 다시 계산
  requestAnimationFrame(apply);
  if(!window._ovScrollResizeBound){
    window._ovScrollResizeBound = true;
    window.addEventListener('resize', () => { try{ setupOvScrollSync(); }catch(e){} }, {passive:true});
  }
}
function jumpDay(y,m,d){cY=y;cM=m;cD=d;vY=y;vM=m;updDbar();renderBks();renderTable();gp('daily');}

// ══════════════════════════════════════
// 급여 요약
// ══════════════════════════════════════
function cpm(d){pM+=d;if(pM>12){pM=1;pY++;}if(pM<1){pM=12;pY--;}renderPayroll();}
function setPvMode(m){
  pvMode=m;
  const isCard=m==='card';
  document.getElementById('pay-card-view').style.display=isCard?'block':'none';
  document.getElementById('pay-xl-view').style.display=isCard?'none':'block';
  ['pv-tab-card','pv-tab-xl'].forEach((id,i)=>{
    const el=document.getElementById(id);if(!el)return;
    const a=(i===0&&isCard)||(i===1&&!isCard);
    el.style.background=a?'var(--nbg)':'';el.style.color=a?'var(--navy2)':'';el.style.borderColor=a?'var(--navy2)':'var(--bd2)';
  });
  if(!isCard)renderXlPreview();
}
// 급여관리 상단 "월 확정" 바 렌더
function _renderPayConfirmBar(){
  const bar = document.getElementById('pay-confirm-bar');
  if(!bar) return;
  const confirmed = isPayMonthConfirmed(pY, pM);
  if(confirmed){
    const meta = getPayMonthMeta(pY, pM);
    const dateStr = meta?.confirmedAt ? new Date(meta.confirmedAt).toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    bar.innerHTML = `
      <div style="background:var(--tbg);border:1.5px solid var(--teal);border-radius:10px;padding:8px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:700;color:var(--teal)">✔ ${pY}년 ${pM}월 확정됨</span>
        <span style="font-size:11px;color:var(--ink3)">${esc(dateStr)} · ${esc(meta?.confirmedBy||'')}</span>
        <span style="flex:1"></span>
        <button class="btn btn-xs" onclick="recalcPayMonth(${pY},${pM})" style="background:var(--card);color:var(--navy2);border:1px solid var(--bd2)" title="현재 데이터 기반으로 다시 계산해 덮어씀">↻ 재계산</button>
        <button class="btn btn-xs" onclick="unconfirmPayMonth(${pY},${pM})" style="background:var(--card);color:var(--rose);border:1px solid #FECDD3">확정 해제</button>
      </div>`;
  } else {
    bar.innerHTML = `
      <div style="background:var(--surf);border:1.5px dashed var(--bd2);border-radius:10px;padding:8px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:700;color:var(--ink3)">● ${pY}년 ${pM}월 미확정</span>
        <span style="font-size:11px;color:var(--ink3)">현재 데이터로 실시간 계산 중 · 설정/데이터 수정 시 금액 변동</span>
        <span style="flex:1"></span>
        <button class="btn btn-xs" onclick="confirmPayMonth(${pY},${pM})" style="background:var(--navy2);color:#fff;border:none;font-weight:700">💾 이 달 급여 확정</button>
      </div>`;
  }
}

// 급여관리 카드뷰 — 상여금/수당 입력에서 Enter 시 저장 + 다음 카드 같은 필드로 포커스 이동
function payCardNav(el){
  const field = el.dataset.cardField;
  if(!field) return;
  const all = Array.from(document.querySelectorAll('#pay-grid input.pay-card-inp[data-card-field="'+field+'"]'));
  const idx = all.indexOf(el);
  const nextEid = idx >= 0 && idx < all.length - 1 ? all[idx+1].dataset.eid : null;
  el.blur(); // 기존 onblur 로직 발동 → 저장 + 500ms 뒤 renderPayroll
  if(!nextEid) return;
  // renderPayroll(500ms) 완료 후 다시 쿼리해서 포커스
  setTimeout(()=>{
    const next = document.querySelector('#pay-grid input.pay-card-inp[data-card-field="'+field+'"][data-eid="'+nextEid+'"]');
    if(next){ next.focus(); next.select(); }
  }, 600);
}

// 급여관리 카드뷰 — 검색 시 재계산 생략, DOM 필터 + 캐시 합산
const _payrollSummaryCache = new Map();
function fastSearchPayroll(){
  const search = F.payroll.search || '';
  const grid = document.getElementById('pay-grid');
  if(!grid) return;
  const cards = grid.querySelectorAll('.pc');
  const gt = {base:0,nt:0,ot:0,hol:0,al:0,bonus:0,allow:0,ded:0,total:0};
  cards.forEach(card=>{
    const name = card.dataset.empName || '';
    const visible = !search || name.includes(search);
    card.style.display = visible ? '' : 'none';
    if(!visible) return;
    const s = _payrollSummaryCache.get(+card.dataset.empId);
    if(!s) return;
    gt.base+=s.tBase; gt.nt+=s.tNightPay; gt.ot+=s.tOtDayPay+s.tOtNightPay;
    gt.hol+=(s.tHolDayPay||0)+(s.tHolNightPay||0)+(s.tHolDayOtPay||0)+(s.tHolNightOtPay||0);
    gt.al+=s.annualPay; gt.bonus+=s.bonus; gt.allow+=s.totalAllowance; gt.ded+=s.deduction; gt.total+=s.total;
  });
  const el = document.getElementById('pay-total');
  if(el){
    el.innerHTML = [['기본급',gt.base],['야간수당',gt.nt],['연장수당',gt.ot],['휴일수당',gt.hol],['상여·수당',gt.bonus+gt.allow],['전체 합계',gt.total]]
      .map(([l,v],i)=>`<div class="sc ${i===5?'ok':''}"><div class="sc-l">${l}</div><div class="sc-v" style="font-size:15px;${i===5?'color:var(--green)':''}">${Math.round(v/10000)}<span class="sc-u">만원</span></div></div>`).join('');
  }
}

function renderPayroll(){
  // 과거 달 조회 시 그 달 정책 스냅샷 사용
  const _origPOL = POL;
  const _monthPOL = (typeof getPolForMonth==='function') ? getPolForMonth(pY, pM) : POL;
  const _polSwapped = _monthPOL !== _origPOL;
  if(_polSwapped) POL = _monthPOL;
  try {
  renderFilterBar('payroll-filter-bar','payroll');
  document.getElementById('pv-title').textContent=`${pY}년 ${pM}월 급여 요약`;
  _renderPayConfirmBar();
  _payrollSummaryCache.clear();
  // 확정된 달은 입력칸을 잠가 "입력해도 안 먹히는" 현상 방지
  const _monthLocked = (typeof isPayMonthConfirmed==='function') && isPayMonthConfirmed(pY, pM);
  let gt={base:0,nt:0,ot:0,hol:0,al:0,bonus:0,allow:0,ded:0,total:0};
  // 해당 월에 재직 중인 직원만
  const payMonthEnd=new Date(pY,pM,0);
  const activePayEmps = applyCommonFilter(EMPS.filter(emp=>{
    if(emp.join){const jd=new Date(emp.join);if(jd>payMonthEnd)return false;}
    if(emp.leave){const ld=new Date(emp.leave);if(ld<new Date(pY,pM-1,1))return false;}
    return true;
  }), 'payroll', payMonthEnd);
  document.getElementById('pay-grid').innerHTML=activePayEmps.map(emp=>{
    const s=monthSummary(emp.id,pY,pM);
    _payrollSummaryCache.set(emp.id, s);
    const rate=getEmpRate(emp);
    gt.base+=s.tBase;gt.nt+=s.tNightPay;gt.ot+=s.tOtDayPay+s.tOtNightPay;gt.hol+=(s.tHolDayPay||0)+(s.tHolNightPay||0)+(s.tHolDayOtPay||0)+(s.tHolNightOtPay||0);gt.al+=s.annualPay;gt.bonus+=s.bonus;gt.allow+=s.totalAllowance;gt.ded+=s.deduction;gt.total+=s.total;
    return`<div class="pc" data-emp-id="${emp.id}" data-emp-name="${esc((emp.name||'').toLowerCase())}">
      <div class="pch">
        <div class="av" style="width:32px;height:32px;font-size:12px;background:${safeColor(emp.color,'#DBEAFE')};color:${safeColor(emp.tc,'#1E3A5F')}">${esc(emp.name)[0]}</div>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--ink)">${esc(emp.name)}</div>
          <div style="font-size:10px;color:var(--ink3)">${esc(emp.role)} · ${s.wdays}일<span class="emp-mode-badge ${getEmpPayModeLabel(emp).cls}" style="margin-left:4px">${getEmpPayModeLabel(emp).text}</span><span style="font-size:9px;padding:1px 5px;border-radius:5px;background:${getEmpShiftLabel(emp).bg};color:${getEmpShiftLabel(emp).color};font-weight:700;margin-left:2px">${getEmpShiftLabel(emp).text}</span>${(()=>{const or=getOrdinaryRate(emp,pY,pM);const br=getEmpRate(emp);return or>br?`<span style="font-size:9px;padding:1px 5px;border-radius:5px;background:#EFF6FF;color:var(--navy2);font-weight:700;margin-left:2px">통상시급 ${or.toLocaleString()}원</span>`:''})()}</div>
        </div>
      </div>
      <div class="pcb">
        ${(()=>{
          const _pm=getEmpPayMode(emp);
          if(_pm==='monthly'){
            const holPay=(s.tHolDayPay||0)+(s.tHolDayOtPay||0);
            return `<div class="pr"><span class="prl">월급</span><span class="prv">${fmt$(s.tBase)}원</span></div>`
              +(holPay>0?`<div class="pr"><span class="prl" style="color:#854F0B">휴일수당</span><span class="prv" style="color:#854F0B">${fmt$(holPay)}원</span></div>`:'');
          }
          return s.tBase>0?`<div class="pr"><span class="prl">기본급</span><span class="prv">${fmt$(s.tBase)}원</span></div>`:'';
        })()}
        ${(()=>{const _pm=getEmpPayMode(emp);return(_pm==='hourly'&&s.wkly>0)?`<div class="pr"><span class="prl" style="color:var(--teal)">주휴수당</span><span class="prv" style="color:var(--teal)">${fmt$(s.wkly)}원</span></div>`:'';})()}

        ${(()=>{
          const _pm2=getEmpPayMode(emp);
          if(_pm2==='monthly') return ''; // 월급제: 가산수당 없음 (휴일수당은 위에서 처리)
          const _isFixed=_pm2==='fixed';
          const addPay=_isFixed
            ? (s.tExtraWorkPay||0)+(s.tNightPay||0)+(s.tOtDayPay||0)+(s.tOtNightPay||0)+(s.tHolPayNew||0)
            : (s.tNightPay||0)+(s.tOtDayPay||0)+(s.tOtNightPay||0)+(s.tHolDayPay||0)+(s.tHolNightPay||0)+(s.tHolDayOtPay||0)+(s.tHolNightOtPay||0);
          return addPay>0?`<div class="pr"><span class="prl">추가수당</span><span class="prv" style="color:#3C3489">${fmt$(addPay)}원</span></div>`:'';
        })()}
        ${s.annualPay>0?`<div class="pr"><span class="prl">연차수당</span><span class="prv" style="color:var(--green)">${fmt$(s.annualPay)}원<span class="prx">${s.aldays}일</span></span></div>`:''}
        <div class="pr">
          <span class="prl">상여금</span>
          <span style="display:flex;align-items:center;gap:5px">
            <input type="text" inputmode="numeric" value="${s.bonus?Number(s.bonus).toLocaleString():''}" placeholder="0" ${_monthLocked?'readonly title="확정된 달 — 입력하려면 확정 해제 먼저"':''}
              class="pay-card-inp" data-eid="${emp.id}" data-card-field="bonus"
              style="width:90px;padding:3px 6px;font-size:12px;border:1px solid ${_monthLocked?'var(--bd2)':'var(--bd2)'};border-radius:5px;text-align:right;font-family:inherit;font-weight:600;color:var(--purple)${_monthLocked?';background:var(--surf);cursor:not-allowed;opacity:.65':''}"
              oninput="formatNumInput(this)"
              onblur="setMonthBonus(${emp.id},pY,pM,+this.value.replace(/,/g,'')||0);clearTimeout(window._cardRefT);window._cardRefT=setTimeout(()=>renderPayroll(),500)"
              onkeydown="if(event.key==='Enter'){event.preventDefault();payCardNav(this);}">
            <span style="font-size:10px;color:var(--ink3)">원</span>
          </span>
        </div>
        ${POL.allowances.map(a=>{
          // s.allowances[a.id]는 이미 isDeduct 반영된 값 (음수)
          // 카드 입력창에는 절댓값 표시, isDeduct면 빨간색
          const effectiveV = s.allowances[a.id]!==undefined ? s.allowances[a.id] : 0;
          const rawV = getMonthAllowance(emp.id,pY,pM,a.id);
          const isDeduct = a.isDeduct===true;
          const isOrd = !isDeduct && getAllowOrdinary(emp.id,a.id);
          const isDirect = hasDirectAllowance(emp.id,pY,pM,a.id);
          return `<div class="pr" style="${isDeduct?'background:var(--rose-dim);margin:-2px -4px;padding:4px;border-radius:6px':''}">
          <span class="prl" style="${isDeduct?'color:var(--rose);font-weight:700':''}">
            ${isDeduct?'🔴 ':''}${a.name}${!isDirect&&rawV?'<span style="font-size:8px;color:var(--ink3);margin-left:3px">자동</span>':''}
          </span>
          <span style="display:flex;align-items:center;gap:4px">
            <input type="text" inputmode="numeric" value="${rawV?Number(rawV).toLocaleString():''}" placeholder="0" ${_monthLocked?'readonly title="확정된 달 — 입력하려면 확정 해제 먼저"':''}
              class="pay-card-inp" data-eid="${emp.id}" data-card-field="allow-${a.id}"
              style="width:80px;padding:3px 6px;font-size:12px;border:1px solid ${isDeduct?'#FECDD3':'var(--bd2)'};border-radius:5px;text-align:right;font-family:inherit;font-weight:600;color:${isDeduct?'var(--rose)':'var(--amber)'}${_monthLocked?';background:var(--surf);cursor:not-allowed;opacity:.65':''}"
              oninput="formatNumInput(this)"
              onblur="setMonthAllowance(${emp.id},pY,pM,'${a.id}',+this.value.replace(/,/g,'')||0);clearTimeout(window._cardRefT);window._cardRefT=setTimeout(()=>renderPayroll(),500)"
              onkeydown="if(event.key==='Enter'){event.preventDefault();payCardNav(this);}">
            <span style="font-size:10px;color:${isDeduct?'var(--rose)':'var(--ink3)'}">${isDeduct?'(공제)':'원'}</span>
            ${!isDeduct?`<label style="display:flex;align-items:center;gap:2px;cursor:pointer;white-space:nowrap" title="통상임금 포함 시 가산수당(야간/연장/휴일) 계산에 반영">
              <input type="checkbox" ${isOrd?'checked':''} style="accent-color:var(--navy2)"
                onchange="setAllowOrdinary(${emp.id},'${a.id}',this.checked);clearTimeout(window._cardRefT);window._cardRefT=setTimeout(()=>renderPayroll(),300)">
              <span style="font-size:9px;color:${isOrd?'var(--navy2)':'var(--ink3)'};font-weight:${isOrd?'700':'500'}">통상</span>
            </label>`:''}
          </span>
        </div>`;}).join('')}
        ${s.deduction>0?`<div class="pr"><span class="prl">${getEmpPayMode(emp)==='monthly'?'결근 일할공제':'결근 공제'}</span><span class="prv" style="color:var(--rose)">-${fmt$(s.deduction)}원</span></div>`:''}
        ${(()=>{const d=getMonthAllowance(emp.id,pY,pM,'deduct');return d!==0?`<div class="pr"><span class="prl">기타공제(가불)</span><span class="prv" style="color:var(--rose)">${fmt$(d)}원</span></div>`:'';})()}
        <div class="pr"><span class="prl">지급 합계</span><span class="prv" style="color:var(--teal);font-size:14px">${fmt$(s.total)}원</span></div>
      </div>
    </div>`;
  }).join('');
  // 합계도 activePayEmps 기준
  document.getElementById('pay-total').innerHTML=
    [['기본급',gt.base],['야간수당',gt.nt],['연장수당',gt.ot],['휴일수당',gt.hol],['상여·수당',gt.bonus+gt.allow],['전체 합계',gt.total]]
    .map(([l,v],i)=>`<div class="sc ${i===5?'ok':''}"><div class="sc-l">${l}</div><div class="sc-v" style="font-size:15px;${i===5?'color:var(--green)':''}">${Math.round(v/10000)}<span class="sc-u">만원</span></div></div>`).join('');
  if(pvMode==='xl')renderXlPreview();
  else if(F.payroll.search) fastSearchPayroll();
  } finally {
    if(_polSwapped) POL = _origPOL;
  }
}

function renderXlPreview(){
  const allowList = POL.allowances.filter(a => !a.isDeduct);
  const deductAllow = POL.allowances.filter(a => a.isDeduct===true);
  const sot = POL.sot || 209;
  const isMonthlyView = false;

  const payEmps = applyCommonFilter(EMPS.filter(emp=>{
    if(emp.join){const jd=new Date(emp.join);if(jd>new Date(pY,pM,0))return false;}
    if(emp.leave){const ld=new Date(emp.leave);if(ld<new Date(pY,pM-1,1))return false;}
    return true;
  }), 'payroll');

  // ── 헤더 ──
  const hdr = `<thead><tr>
    <th style="min-width:36px;background:#1a3a6e;color:#fff;position:sticky;left:0;z-index:5">순번</th>
    <th style="min-width:60px;background:#1a3a6e;color:#fff">근무지</th>
    <th style="min-width:60px;background:#1a3a6e;color:#fff">직무/직급</th>
    <th style="min-width:70px;background:#1a3a6e;color:#fff;position:sticky;left:36px;z-index:5">성명</th>
    <th style="min-width:64px;background:#1a3a6e;color:#fff">급여<br>방식</th>
    <th style="min-width:46px;background:#1a3a6e;color:#fff">연차<br>개수</th>
    <th style="min-width:46px;background:#1a3a6e;color:#fff">근무<br>일수</th>
    <th style="min-width:52px;background:#1a3a6e;color:#fff">소정근로<br>시간</th>
    <th style="min-width:72px;background:#1a3a6e;color:#fff">입사일</th>
    <th style="min-width:60px;background:#1a3a6e;color:#fff">시급</th>
    <th style="min-width:80px;background:#1a3a6e;color:#fff">기본급<br><span style="font-size:9px;opacity:.7">(월고정:209h / 시급:실근무)</span></th>
    <th style="min-width:72px;background:#0D9488;color:#fff">주휴수당<br><span style="font-size:9px;opacity:.7">(시간급 전용)</span></th>
    <th style="min-width:70px;background:#1a3a6e;color:#fff">연차수당</th>

    ${allowList.map(a=>`<th style="min-width:70px">${a.name}</th>`).join('')}
    <th style="min-width:80px;background:#1a3a6e;color:#fff">급여</th>
    <th style="min-width:46px">실근무<br>(h)</th>
    <th style="min-width:52px;background:#1565C0;color:#fff">소정근로외<br>실근무(h)<br><span style="font-size:8px;opacity:.8">×1.0</span></th>
    <th style="min-width:46px;background:#0C447C;color:#B5D4F4">야간<br>시간(h)<br><span style="font-size:8px;opacity:.8">×0.5</span></th>
    <th style="min-width:46px;background:#534AB7;color:#EEEDFE">초과연장<br>시간(h)<br><span style="font-size:8px;opacity:.8">×0.5</span></th>
    <th style="min-width:46px;background:#854F0B;color:#FAC775">초과휴일<br>시간(h)<br><span style="font-size:8px;opacity:.8">×0.5</span></th>
    <th style="min-width:46px">결근<br>일수</th>
    <th style="min-width:56px">공제시간<br><span style="font-size:9px;opacity:.7">(h) ×1.0</span></th>
    <th style="min-width:80px;background:#1565C0;color:#fff">소정근로외<br>실근무수당<br><span style="font-size:8px;opacity:.8">×1.0</span></th>
    <th style="min-width:72px;background:#0C447C;color:#B5D4F4">야간<br>수당<br><span style="font-size:8px;opacity:.8">×0.5</span></th>
    <th style="min-width:72px;background:#534AB7;color:#EEEDFE">초과연장<br>수당<br><span style="font-size:8px;opacity:.8">×0.5</span></th>
    <th style="min-width:72px;background:#854F0B;color:#FAC775">초과휴일<br>수당<br><span style="font-size:8px;opacity:.8">×0.5</span></th>
    <th style="min-width:72px;background:#854F0B;color:#FAC775">월급제<br>휴일수당<br><span style="font-size:8px;opacity:.8">8h이내×1.5</span></th>
    <th style="min-width:72px;background:#993C1D;color:#F5C4B3">월급제<br>휴일초과<br><span style="font-size:8px;opacity:.8">8h초과×2.0</span></th>
    <th style="min-width:90px;background:#065F46;color:#D1FAE5">총 가산수당 <button class="tip-btn" style="background:rgba(255,255,255,.2);border:none;cursor:pointer;font-size:11px;padding:0 3px;border-radius:50%;color:#fff" onclick="showBonusTip()">💡</button></th>
    <th style="min-width:72px;background:#A32D2D;color:#F7C1C1">결근차감</th>
    <th class="yw" style="min-width:80px">상여금<br>(선지급)</th>
    <th style="min-width:90px;background:#1a3a6e;color:#fff">총급여</th>
    ${deductAllow.map(a=>`<th style="min-width:72px">${a.name}</th>`).join('')}
    <th style="min-width:72px;background:#7C3AED;color:#EDE9FE">국민<br>연금</th>
    <th style="min-width:72px;background:#7C3AED;color:#EDE9FE">건강<br>보험</th>
    <th style="min-width:72px;background:#7C3AED;color:#EDE9FE">고용<br>보험</th>
    <th style="min-width:72px">소득세</th>
    <th style="min-width:72px">주민세</th>
    <th style="min-width:72px">총공제액 <span class="tip-wrap"><button class="tip-btn" style="background:none;border:none;cursor:pointer;font-size:12px;padding:0 2px;opacity:.7" onclick="showTip('총공제액','4대보험(국민연금·건강보험·고용보험) + 소득세 + 지방소득세 + 기타 공제 항목 합산\n총급여에서 이 금액을 빼면 실지급액이 됩니다.')">💡</button></span></th>
    <th style="min-width:90px;background:#085041;color:#9FE1CB">실지급액 <span class="tip-wrap"><button class="tip-btn" style="background:none;border:none;cursor:pointer;font-size:12px;padding:0 2px;opacity:.7" onclick="showTip('실지급액','총급여에서 4대보험·소득세·지방소득세·각종 공제를 뺀 금액입니다.\n근로자가 실제로 통장에 받는 금액입니다.')">💡</button></span></th>
  </tr></thead>`;

  // ── 데이터 행 ──
  let gt={base:0,nt:0,otDay:0,otNight:0,holDay:0,holNight:0,holDayOt:0,holNightOt:0,al:0,bonus:0,allow:0,ded:0,total:0};

  const rows = payEmps.map((emp,idx)=>{
    const s = monthSummary(emp.id, pY, pM);
    const rate = getEmpRate(emp);
    const tx = getTaxRec(emp.id, pY, pM);

    gt.base+=s.tBase; gt.nt+=s.tNightPay; gt.otDay+=s.tOtDayPay; gt.otNight+=s.tOtNightPay;
    gt.holDay+=s.tHolDayPay; gt.holNight+=s.tHolNightPay; gt.holDayOt+=s.tHolDayOtPay; gt.holNightOt+=s.tHolNightOtPay;
    gt.al+=s.annualPay; gt.bonus+=s.bonus; gt.allow+=s.totalAllowance; gt.ded+=s.deduction; gt.total+=s.total;

    const basePay = s.tBase + s.totalAllowance;
    const allowCells = allowList.map(a=>{
      const rawV = getMonthAllowance(emp.id,pY,pM,a.id);
      return `<td style="padding:2px 4px">
        <input type="text" inputmode="numeric" data-xl-inp="1" value="${rawV!==0?Number(rawV).toLocaleString():''}" placeholder="0"
          style="width:100%;border:none;background:transparent;font-size:11px;text-align:right;font-family:inherit;color:#1565C0;font-weight:600;outline:none;padding:2px 4px;"
          data-eid="${emp.id}" data-aid="${a.id}"
          oninput="formatNumInput(this)"
          onblur="xlSaveAllow(this)"
          onfocus="this.style.background='#EFF6FF';this.style.outline='2px solid #1565C0'"
          onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();this.blur();xlInputNav(this,event.shiftKey);}">
      </td>`;
    }).join('');
    const deductCells = deductAllow.map(a=>{
      const rawV = a.id==='deduct' ? (getMonthAllowance(emp.id,pY,pM,a.id)||0) : getMonthAllowance(emp.id,pY,pM,a.id);
      return `<td style="padding:2px 4px;background:#FFF1F2">
        <input type="text" inputmode="numeric" data-xl-inp="1" value="${rawV!==0?Number(rawV).toLocaleString():''}" placeholder="0"
          style="width:100%;border:none;background:transparent;font-size:11px;text-align:right;font-family:inherit;color:var(--rose);font-weight:700;outline:none;padding:2px 4px;"
          data-eid="${emp.id}" data-aid="${a.id}"
          oninput="formatNumInput(this)"
          onblur="xlSaveAllow(this)"
          onfocus="this.style.background='#FFF1F2';this.style.outline='2px solid var(--rose)'"
          onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();this.blur();xlInputNav(this,event.shiftKey);}">
      </td>`;
    }).join('');

    // 총급여 = 급여 + 주휴수당 + 연차수당 + 총가산수당 + 상여금 - 결근차감
    const totalPay = basePay + (s.wkly||0) + s.annualPay + (s.tTotalBonus||0) + (s.tMonthlyHolStdPay||0) + (s.tMonthlyHolOtPay||0) - s.deduction + s.bonus;
    const incomeTax = tx.incomeTax||0;
    const localTax = tx.localTax||0;
    const pension4 = +(tx.pension)||0;
    const health4 = +(tx.health)||0;
    const employ4 = +(tx.employment)||0;
    // 기타공제 합산 (상여선지급 공제 포함)
    const deductAllowTotal = deductAllow.reduce((sum,a)=>sum+(getMonthAllowance(emp.id,pY,pM,a.id)||0),0);
    // 총공제액 = 기타공제 + 세금/보험
    const totalDeduct = deductAllowTotal + pension4 + health4 + employ4 + incomeTax + localTax;
    // 실지급액 = 총급여 - 기타공제(상여선지급 포함) - 세금/보험
    const netPay = totalPay - deductAllowTotal - pension4 - health4 - employ4 - incomeTax - localTax;

    const joinStr = emp.join ? emp.join.substring(0,10) : '';
    const leaveCalc = calcLeaveForYear(emp, pY);
    const annualTotal = leaveCalc ? leaveCalc.total : 0;
    const annualUsed = countUsedLeave(emp.id, pY);

    return `<tr>
      <td class="num" style="position:sticky;left:0;z-index:2;background:#F8FAFC">${idx+1}</td>
      <td>${esc(emp.dept||'')}</td>
      <td>${esc(emp.role||'')}</td>
      <td style="font-weight:500;position:sticky;left:36px;z-index:2;background:#fff">${esc(emp.name||'')}</td>
      <td style="text-align:center"><span class="emp-mode-badge ${getEmpPayModeLabel(emp).cls}" style="font-size:9px;padding:2px 6px">${getEmpPayModeLabel(emp).text}</span></td>
      <td class="num">${annualTotal}</td>
      <td class="num">${s.wdays}</td>
      <td class="num">${(getEmpPayMode(emp)==='hourly'||getEmpPayMode(emp)==='monthly')?'':sot}</td>
      <td class="num" style="font-size:11px">${joinStr}</td>
      <td class="num">${getOrdinaryRate(emp, pY, pM).toLocaleString('ko-KR')}</td>
      <td class="num" style="font-weight:500">${s.tBase>0?fmt$(s.tBase):'-'}</td>
      <td class="num" style="${getEmpPayMode(emp)==='hourly'&&s.wkly>0?'color:#0D9488;font-weight:700':''}">${getEmpPayMode(emp)==='hourly'?(s.wkly>0?fmt$(s.wkly):''):''}</td>
      <td class="num xl-editable">${s.annualPay>0?fmt$(s.annualPay):''}</td>
      ${allowCells}
      <td class="num" style="font-weight:500;background:#EFF6FF">${fmt$(basePay)}</td>
      <td class="num">${s.twkH>0?s.twkH.toFixed(2):''}</td>
      <td class="num" style="${(s.tExtraWorkH||0)>0?'color:#1565C0;font-weight:500':''}">${(s.tExtraWorkH||0)>0?(s.tExtraWorkH).toFixed(2):''}</td>
      <td class="num" style="${s.tNightH>0?'color:#0C447C;font-weight:500':''}">${s.tNightH>0?s.tNightH.toFixed(2):''}</td>
      <td class="num" style="${((s.tOtDayH||0)+(s.tOtNightH||0))>0?'color:#534AB7;font-weight:500':''}">${((s.tOtDayH||0)+(s.tOtNightH||0))>0?((s.tOtDayH||0)+(s.tOtNightH||0)).toFixed(2):''}</td>
      <td class="num" style="${((s.tHolDayH||0)+(s.tHolNightH||0)+(s.tHolDayOtH||0)+(s.tHolNightOtH||0))>0?'color:#854F0B;font-weight:500':''}">${((s.tHolDayH||0)+(s.tHolNightH||0)+(s.tHolDayOtH||0)+(s.tHolNightOtH||0))>0?((s.tHolDayH||0)+(s.tHolNightH||0)+(s.tHolDayOtH||0)+(s.tHolNightOtH||0)).toFixed(2):''}</td>
      <td class="num">${s.adays>0?s.adays:''}</td>
      <td class="num" style="${s.dedShortH>0?'color:#A32D2D;font-weight:500':''}">${s.dedShortH>0?s.dedShortH.toFixed(2):''}</td>
      <td class="num" style="${(s.tExtraWorkPay||0)>0?'color:#1565C0;font-weight:700':''}">${(s.tExtraWorkPay||0)>0?fmt$(s.tExtraWorkPay):''}</td>
      <td class="num" style="${s.tNightPay>0?'color:#0C447C;font-weight:700':''}">${s.tNightPay>0?fmt$(s.tNightPay):''}</td>
      <td class="num" style="${((s.tOtDayPay||0)+(s.tOtNightPay||0))>0?'color:#534AB7;font-weight:700':''}">${((s.tOtDayPay||0)+(s.tOtNightPay||0))>0?fmt$((s.tOtDayPay||0)+(s.tOtNightPay||0)):''}</td>
      <td class="num" style="${(s.tHolPayNew||0)>0?'color:#854F0B;font-weight:700':''}">${(s.tHolPayNew||0)>0?fmt$(s.tHolPayNew):''}</td>
      <td class="num" style="${(s.tMonthlyHolStdPay||0)>0?'color:#854F0B;font-weight:700':''}">${(s.tMonthlyHolStdPay||0)>0?fmt$(s.tMonthlyHolStdPay):''}</td>
      <td class="num" style="${(s.tMonthlyHolOtPay||0)>0?'color:#993C1D;font-weight:700':''}">${(s.tMonthlyHolOtPay||0)>0?fmt$(s.tMonthlyHolOtPay):''}</td>
      <td class="num" style="font-weight:700;color:#065F46;background:#ECFDF5">${(s.tTotalBonus||0)>0?fmt$(s.tTotalBonus):''}</td>
      <td class="num" style="${s.deduction>0?'color:#A32D2D;font-weight:700':''}">${s.deduction>0?'-'+fmt$(s.deduction):''}</td>
      <td style="padding:2px 4px;background:#FEF3C7">
        <input type="text" inputmode="numeric" data-xl-inp="1" value="${s.bonus?Number(s.bonus).toLocaleString():''}" placeholder="0"
          style="width:100%;border:none;background:transparent;font-size:11px;text-align:right;font-family:inherit;color:#92400E;font-weight:700;outline:none;padding:2px 4px;"
          data-eid="${emp.id}" data-field="bonus"
          oninput="formatNumInput(this)"
          onblur="xlSaveBonus(this)"
          onfocus="this.style.background='#FEF3C7';this.style.outline='2px solid #F59E0B'"
          onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();this.blur();xlInputNav(this,event.shiftKey);}">
      </td>
      <td class="num" style="font-weight:700;background:#EFF6FF">${fmt$(totalPay)}</td>
      ${deductCells}
      <td style="padding:2px 4px;background:#F5F3FF">
        <input type="text" inputmode="numeric" data-xl-inp="1" value="${+(tx.pension)?Number(+(tx.pension)).toLocaleString():''}" placeholder="0"
          style="width:68px;border:none;background:transparent;font-size:11px;text-align:right;font-family:inherit;color:#7C3AED;font-weight:600;outline:none;padding:2px 4px;"
          data-eid="${emp.id}" data-tax="pension"
          oninput="formatNumInput(this)"
          onblur="xlSaveTax(this)"
          onfocus="this.style.outline='2px solid #7C3AED'"
          onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();this.blur();xlInputNav(this,event.shiftKey);}">
      </td>
      <td style="padding:2px 4px;background:#F5F3FF">
        <input type="text" inputmode="numeric" data-xl-inp="1" value="${+(tx.health)?Number(+(tx.health)).toLocaleString():''}" placeholder="0"
          style="width:68px;border:none;background:transparent;font-size:11px;text-align:right;font-family:inherit;color:#7C3AED;font-weight:600;outline:none;padding:2px 4px;"
          data-eid="${emp.id}" data-tax="health"
          oninput="formatNumInput(this)"
          onblur="xlSaveTax(this)"
          onfocus="this.style.outline='2px solid #7C3AED'"
          onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();this.blur();xlInputNav(this,event.shiftKey);}">
      </td>
      <td style="padding:2px 4px;background:#F5F3FF">
        <input type="text" inputmode="numeric" data-xl-inp="1" value="${+(tx.employment)?Number(+(tx.employment)).toLocaleString():''}" placeholder="0"
          style="width:68px;border:none;background:transparent;font-size:11px;text-align:right;font-family:inherit;color:#7C3AED;font-weight:600;outline:none;padding:2px 4px;"
          data-eid="${emp.id}" data-tax="employment"
          oninput="formatNumInput(this)"
          onblur="xlSaveTax(this)"
          onfocus="this.style.outline='2px solid #7C3AED'"
          onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();this.blur();xlInputNav(this,event.shiftKey);}">
      </td>
      <td style="padding:2px 4px">
        <input type="text" inputmode="numeric" data-xl-inp="1" value="${incomeTax?Number(incomeTax).toLocaleString():''}" placeholder="0"
          style="width:68px;border:none;background:transparent;font-size:11px;text-align:right;font-family:inherit;color:#A32D2D;font-weight:600;outline:none;padding:2px 4px;"
          data-eid="${emp.id}" data-tax="incomeTax"
          oninput="formatNumInput(this)"
          onblur="xlSaveTax(this)"
          onfocus="this.style.outline='2px solid #A32D2D'"
          onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();this.blur();xlInputNav(this,event.shiftKey);}">
      </td>
      <td style="padding:2px 4px">
        <input type="text" inputmode="numeric" data-xl-inp="1" value="${localTax?Number(localTax).toLocaleString():''}" placeholder="0"
          style="width:68px;border:none;background:transparent;font-size:11px;text-align:right;font-family:inherit;color:#A32D2D;font-weight:600;outline:none;padding:2px 4px;"
          data-eid="${emp.id}" data-tax="localTax"
          oninput="formatNumInput(this)"
          onblur="xlSaveTax(this)"
          onfocus="this.style.outline='2px solid #A32D2D'"
          onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();this.blur();xlInputNav(this,event.shiftKey);}">
      </td>
      <td class="num" style="${totalDeduct>0?'color:#A32D2D;font-weight:700':''}">${totalDeduct>0?'-'+fmt$(totalDeduct):''}</td>
      <td class="num" style="font-weight:700;color:#085041">${fmt$(netPay)}</td>
    </tr>`;
  });

  document.getElementById('xl-table').innerHTML = hdr + '<tbody>' + rows.join('') + '</tbody>';
  // 하단 스크롤바 미러 동기화
  setTimeout(()=>{
    const wrap = document.getElementById('xl-wrap-main');
    const mirror = document.getElementById('xl-scroll-mirror');
    const mirrorInner = document.getElementById('xl-scroll-mirror-inner');
    if(wrap && mirror && mirrorInner){
      mirrorInner.style.width = wrap.scrollWidth + 'px';
      // 미러 → 본체 동기화
      mirror.onscroll = ()=>{ if(!wrap._syncing){ wrap._syncing=true; wrap.scrollLeft=mirror.scrollLeft; wrap._syncing=false; }};
      // 본체 → 미러 동기화
      wrap.onscroll = ()=>{ if(!mirror._syncing){ mirror._syncing=true; mirror.scrollLeft=wrap.scrollLeft; mirror._syncing=false; }};
    }
  }, 50);
  // 클릭 즉시 편집 활성화
  document.querySelectorAll('#xl-table td.xl-editable').forEach(td=>{
    td.addEventListener('focus', function(){
      this.setAttribute('contenteditable','true');
      const range=document.createRange();
      range.selectNodeContents(this);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    td.addEventListener('blur', function(){
      this.setAttribute('contenteditable','false');
      _xlDispatchSave(this);
    });
    td.addEventListener('keydown', function(e){
      if(e.key==='Enter'){e.preventDefault();this.blur();}
      if(e.key==='Escape'){e.preventDefault();renderXlPreview();}
      if(e.key==='Tab'){e.preventDefault();
        const all=Array.from(document.querySelectorAll('#xl-table td.xl-editable'));
        const idx=all.indexOf(this); this.blur();
        const next=all[e.shiftKey?idx-1:idx+1];
        if(next) setTimeout(()=>next.focus(),50);
      }
    });
  });
}

function setupXlNav() {
  // renderXlPreview 호출될 때마다 실행 → grid 재빌드 + 초기 선택
  _xlBuildGrid();
  if (_xlR < 0) _xlSelect(0, 0);
  else _xlSelect(_xlR, _xlC, false); // 위치 유지
}

// ── 전역 상태 (재렌더 후에도 유지) ──
let _xlR = -1, _xlC = 0, _xlEditing = false, _xlGrid = [];

function _xlBuildGrid() {
  const tbl = document.getElementById('xl-table');
  if (!tbl) { _xlGrid = []; return; }
  // readonly 셀 제외, contenteditable 셀만 그리드에 포함
  _xlGrid = Array.from(tbl.querySelectorAll('tbody tr')).map(tr =>
    Array.from(tr.querySelectorAll('td[contenteditable]:not(.xl-readonly)'))
  );
}

function _xlCell(r, c) {
  return (_xlGrid[r] && _xlGrid[r][c]) ? _xlGrid[r][c] : null;
}

function _xlClamp(r, c) {
  const mr = _xlGrid.length - 1;
  if (mr < 0) return [0, 0];
  const nr = Math.max(0, Math.min(r, mr));
  const mc = _xlGrid[nr] ? _xlGrid[nr].length - 1 : 0;
  return [nr, Math.max(0, Math.min(c, mc))];
}

function _xlClearHighlight() {
  document.querySelectorAll('td.xl-selected,td.xl-editing').forEach(el => {
    el.classList.remove('xl-selected', 'xl-editing');
    if (el.getAttribute('contenteditable') === 'true') {
      el.setAttribute('contenteditable', 'false');
    }
  });
}

function _xlSelect(r, c, scroll=true) {
  _xlBuildGrid();
  [r, c] = _xlClamp(r, c);
  _xlClearHighlight();
  _xlR = r; _xlC = c; _xlEditing = false;
  const el = _xlCell(r, c);
  if (!el) return;
  el.classList.add('xl-selected');
  if (scroll) el.scrollIntoView({ block:'nearest', inline:'nearest' });
  el.focus();
  window.getSelection().removeAllRanges();
}

function _xlEdit(r, c, clearFirst=false) {
  _xlBuildGrid();
  [r, c] = _xlClamp(r, c);
  _xlClearHighlight();
  _xlR = r; _xlC = c; _xlEditing = true;
  const el = _xlCell(r, c);
  if (!el) return;
  el.setAttribute('contenteditable', 'true'); // 편집 허용
  el.classList.add('xl-editing');
  el.scrollIntoView({ block:'nearest', inline:'nearest' });
  if (clearFirst) el.textContent = '';
  el.focus();
  // 커서 끝으로
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}

function _xlCommit(dr, dc) {
  const el = _xlCell(_xlR, _xlC);
  if (el) el.blur();
  _xlBuildGrid();
  const [nr, nc] = _xlClamp(_xlR + dr, _xlC + dc);
  _xlSelect(nr, nc);
}

// ── 이벤트: 최초 1회만 등록 ──
(function initXlEvents() {
  // 클릭 (mousedown 대신 click 사용 → 브라우저 기본 포커스 동작 유지)
  document.addEventListener('click', function(e) {
    const tbl = document.getElementById('xl-table');
    if (!tbl || !tbl.offsetParent) return; // 테이블 안 보이면 무시
    const td = e.target.closest('td[contenteditable]');
    if (!td || !tbl.contains(td)) return;
    if (td.classList.contains('xl-readonly')) return; // readonly 클릭 무시
    _xlBuildGrid();
    let fr = -1, fc = -1;
    outer: for (let ri = 0; ri < _xlGrid.length; ri++) {
      for (let ci = 0; ci < _xlGrid[ri].length; ci++) {
        if (_xlGrid[ri][ci] === td) { fr = ri; fc = ci; break outer; }
      }
    }
    if (fr < 0) return;
    // 이미 선택된 셀 클릭 → 편집 모드
    if (_xlR === fr && _xlC === fc && !_xlEditing) {
      _xlEdit(fr, fc);
    } else {
      _xlR = fr; _xlC = fc; _xlEditing = false;
      _xlClearHighlight();
      td.classList.add('xl-selected');
      td.focus();
      window.getSelection().removeAllRanges();
    }
  });

  // 더블클릭 → 편집
  document.addEventListener('dblclick', function(e) {
    const tbl = document.getElementById('xl-table');
    if (!tbl || !tbl.offsetParent) return;
    const td = e.target.closest('td[contenteditable]');
    if (!td || !tbl.contains(td)) return;
    if (td.classList.contains('xl-readonly')) return; // readonly 더블클릭 무시
    _xlBuildGrid();
    for (let ri = 0; ri < _xlGrid.length; ri++) {
      for (let ci = 0; ci < _xlGrid[ri].length; ci++) {
        if (_xlGrid[ri][ci] === td) { _xlEdit(ri, ci); return; }
      }
    }
  });

  // 키보드 (capture로 스크롤 차단)
  document.addEventListener('keydown', function(e) {
    const tbl = document.getElementById('xl-table');
    if (!tbl) return;
    const pgPayroll = document.getElementById('pg-payroll');
    if (!pgPayroll || !pgPayroll.classList.contains('on')) return;
    try { if (typeof _xlR === 'undefined' || _xlR < 0) return; } catch(e) { return; }

    if (_xlEditing) {
      switch(e.key) {
        case 'Escape': e.preventDefault(); _xlSelect(_xlR, _xlC); break;
        case 'Enter':  if (!e.shiftKey) { e.preventDefault(); _xlCommit(1, 0); } break;
        case 'Tab':    e.preventDefault(); _xlCommit(0, e.shiftKey ? -1 : 1); break;
      }
    } else {
      switch(e.key) {
        case 'ArrowRight': e.preventDefault(); _xlSelect(_xlR, _xlC+1); break;
        case 'ArrowLeft':  e.preventDefault(); _xlSelect(_xlR, _xlC-1); break;
        case 'ArrowDown':  e.preventDefault(); _xlSelect(_xlR+1, _xlC); break;
        case 'ArrowUp':    e.preventDefault(); _xlSelect(_xlR-1, _xlC); break;
        case 'Tab':        e.preventDefault(); _xlSelect(_xlR, _xlC+(e.shiftKey?-1:1)); break;
        case 'Enter': case 'F2': e.preventDefault(); _xlEdit(_xlR, _xlC); break;
        case 'Delete': case 'Backspace':
          e.preventDefault();
          _xlBuildGrid();
          const el = _xlCell(_xlR, _xlC);
          if (el) { el.textContent=''; el.dispatchEvent(new Event('blur')); }
          break;
        default:
          if (e.key.length===1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            _xlEdit(_xlR, _xlC, true);
            _xlBuildGrid();
            const t = _xlCell(_xlR, _xlC);
            if (t) {
              t.textContent = e.key;
              const rng = document.createRange();
              rng.selectNodeContents(t);
              rng.collapse(false);
              window.getSelection().removeAllRanges();
              window.getSelection().addRange(rng);
            }
          }
      }
    }
  }, true);
})();



// ── xl 셀 저장 분기 함수 ──
function _xlDispatchSave(td){
  const empId = +td.dataset.empid;
  const field = td.dataset.field;
  const y = +td.dataset.y || pY;
  const m = +td.dataset.m || pM;
  if(!empId||!field) return;
  if(field==='allow'){
    const aid = td.dataset.aid;
    xlEditAllowanceTd(td, empId, aid, y, m);
  } else if(field==='bonus'){
    xlEditBonusTd(td, empId, y, m);
  } else if(field==='pension'){
    xlEditTaxTd(td, empId, y, m, 'pension');
  } else if(field==='health'){
    xlEditTaxTd(td, empId, y, m, 'health');
  } else if(field==='employment'){
    xlEditTaxTd(td, empId, y, m, 'employment');
  } else if(field==='incometax'){
    xlEditTaxTd(td, empId, y, m, 'incomeTax');
  } else if(field==='localtax'){
    xlEditTaxTd(td, empId, y, m, 'localTax');
  }
}

// ── xl 테이블 셀 blur 저장 함수들 ──
function xlEditAllowanceTd(td, empId, aid, y, m){
  const raw = td.textContent.replace(/,/g,'').replace(/[^0-9\-]/g,'').trim();
  const num = raw===''?0:parseInt(raw);
  if(isNaN(num))return;
  const a = POL.allowances.find(x=>x.id===aid);
  const storeVal = (a&&a.isDeduct) ? Math.abs(num) : num;
  setMonthAllowance(empId, y, m, aid, storeVal);
  renderPayroll();
}
function xlEditBonusTd(td, empId, y, m){
  const raw = td.textContent.replace(/,/g,'').replace(/[^0-9\-]/g,'').trim();
  const num = raw===''?0:parseInt(raw);
  setMonthBonus(empId, y, m, isNaN(num)?0:num);
  renderPayroll();
}
function xlEditTaxTd(td, empId, y, m, field){
  const raw = td.textContent.replace(/,/g,'').replace(/[^0-9\-]/g,'').trim();
  const num = raw===''?'':parseInt(raw);
  setTaxRec(empId, y, m, field, isNaN(num)?'':Math.abs(num));
  renderXlPreview();
}

// 세금 직접 입력
function xlEditTax(el, empId, y, m, field, val){
  const clean = val.replace(/,/g,'').replace(/[^0-9\-]/g,'').trim();
  const num = clean === '' ? '' : parseInt(clean);
  setTaxRec(empId, y, m, field, isNaN(num) ? '' : num);
  renderXlPreview(); // 공제합계, 실지급액 재계산
}

// 급여내용 셀 직접 수정 함수들
function xlEdit(el, empId, field, val){
  const clean = val.replace(/,/g,'').trim();
  updE(empId, field, clean);
  el.textContent = clean;
}
function xlEditAllowance(el, empId, name, y, m, val){
  const clean = val.replace(/,/g,'').trim();
  const num = clean===''?0:parseInt(clean.replace(/[^0-9\-]/g,''));
  if(isNaN(num))return;
  let a = POL.allowances.find(x=>x.name===name);
  if(!a){ POL.allowances.push({id:'custom_'+Date.now(),name,isDeduct:num<0}); a=POL.allowances[POL.allowances.length-1]; saveLS(); }
  // isDeduct 항목은 양수로 저장 (monthSummary에서 자동 음수 처리)
  const storeVal = a.isDeduct ? Math.abs(num) : num;
  setMonthAllowance(empId, y, m, a.id, storeVal);
  renderPayroll(); // 카드보기 동기화
  // 셀 표시는 renderXlPreview가 재렌더하므로 별도 처리 불필요
}
function xlEditBonus(el, empId, y, m, val){
  const clean = val.replace(/,/g,'').trim();
  const num = clean==='' ? 0 : parseInt(clean.replace(/[^0-9\-]/g,''));
  const finalNum = isNaN(num) ? 0 : num;
  setMonthBonus(empId, y, m, finalNum);
  renderPayroll(); // 카드 + 급여내용 동기화
}
function xlEditOT(el, empId, y, m, val){
  // 초과연장시간 직접 수정 → 수당 재계산은 기록 없으므로 메모만
  el.textContent = parseFloat(val)||0;
}

// 급여내용 셀 직접 수정
function xlEdit(empId, field, rawText) {
  const num = parseInt(rawText.replace(/[^0-9\-]/g,''))||0;
  setMonthAllowance(empId, pY, pM, field, num);
  renderPayroll(); // 총급여 등 재계산
}

// ══════════════════════════════════════
// 직원 관리
// ══════════════════════════════════════

function renderEmps(){
  renderFilterBar('emps-filter-bar','emps');
  let sorted=[...EMPS].sort((a,b)=>{
    // 퇴사자 맨 뒤
    if(!a.leave&&b.leave)return -1;
    if(a.leave&&!b.leave)return 1;
    // 주간 먼저, 야간 나중
    const aS=(a.shift||'day')==='day'?0:1;
    const bS=(b.shift||'day')==='day'?0:1;
    return aS-bS;
  });
  sorted = applyCommonFilter(sorted, 'emps');
  let _prevGroup = null;
  document.getElementById('emp-tbody').innerHTML=sorted.map((e,i)=>{
    const al=calcAnnualLeave(e);
    const rowNum = i+1;
    const _curGroup = e.leave ? 'leave' : (e.shift||'day');
    let _groupHdr = '';
    if(_curGroup !== _prevGroup){
      if(_curGroup==='day') _groupHdr=`<tr><td colspan="18" style="padding:5px 14px;background:linear-gradient(90deg,#FEF9C3,#FFF7ED);font-size:10px;font-weight:800;color:#D97706;letter-spacing:.5px;border-bottom:1px solid #FCD34D">☀️ 주간 근무자</td></tr>`;
      else if(_curGroup==='night') _groupHdr=`<tr><td colspan="18" style="padding:5px 14px;background:linear-gradient(90deg,#EDE9FE,#F5F3FF);font-size:10px;font-weight:800;color:#7C3AED;letter-spacing:.5px;border-bottom:1px solid #DDD6FE">🌙 야간 근무자</td></tr>`;
      else if(_curGroup==='leave') _groupHdr=`<tr><td colspan="18" style="padding:5px 14px;background:linear-gradient(90deg,#FEE2E2,#FFF1F2);font-size:10px;font-weight:800;color:#E11D48;letter-spacing:.5px;border-bottom:1px solid #FECDD3">🚪 퇴사자</td></tr>`;
    }
    _prevGroup = _curGroup;
    return _groupHdr+`<tr draggable="true" data-eid="${e.id}"
      ondragstart="empDragIdx=${i};this.style.opacity='.4';this.style.background='var(--nbg)';this.style.transform='scale(.98)'"
      ondragend="this.style.opacity='';this.style.background='';this.style.transform=''"
      ondragover="event.preventDefault();this.style.borderTop='2px solid var(--navy2)'"
      ondragleave="this.style.borderTop=''"
      ondrop="empDrop(event,${i});document.querySelectorAll('#emp-tbody tr').forEach(r=>r.style.borderTop='')"
      style="transition:all .15s;${e.leave?'opacity:.5;background:var(--rose-dim);':''}cursor:pointer;">
      <td><span style="cursor:grab;color:var(--ink3);font-size:14px;padding:0 4px;">⠿</span></td>
      <td style="text-align:center;font-size:11px;font-weight:700;color:#94A3B8;padding:0 4px">${rowNum}</td>
      <td><div style="display:flex;gap:2px;align-items:center">
        <input class="ei2" value="${esc(e.empNo||'')}" onchange="updE(${e.id},'empNo',this.value)" style="text-align:center;font-size:10px;flex:1" placeholder="사번" autocomplete="off">
        ${!e.empNo&&POL.empNoEnabled&&(POL.siteCode||'').length===5?`<button onclick="showGenEmpNo(${e.id})" style="padding:2px 4px;font-size:8px;border:1px solid var(--navy2);border-radius:4px;background:var(--nbg);color:var(--navy2);cursor:pointer;white-space:nowrap;font-weight:700" title="사번 자동 생성">생성</button>`:''}
      </div></td>
      <td><input class="ei2" value="${esc(e.name)}" onchange="updE(${e.id},'name',this.value)" placeholder="이름" autocomplete="off"></td>
      <td><input class="ei2" value="${esc(e.role)}" onchange="updE(${e.id},'role',this.value)" autocomplete="off"></td>
      <td><input class="ei2" value="${esc(e.grade||'')}" onchange="updE(${e.id},'grade',this.value)" placeholder="직급" autocomplete="off"></td>
      <td><input class="ei2" value="${esc(e.dept||'')}" onchange="updE(${e.id},'dept',this.value)" placeholder="인천본점" autocomplete="off"></td>
      <td>
        <div style="display:flex;gap:3px;align-items:center">
          <input class="ei2" value="${esc(e.rrnFront||'')}" maxlength="6" placeholder="앞6자리"
            oninput="updRrn(${e.id},'rrnFront',this.value)" id="rrn-front-${e.id}" style="text-align:center;letter-spacing:1px" autocomplete="off">
          <span style="color:var(--ink3);font-size:12px">-</span>
          <input class="ei2" type="password" value="${esc(e.rrnBack||'')}" maxlength="7" placeholder="뒷7자리"
            oninput="updRrn(${e.id},'rrnBack',this.value)" id="rrn-back-${e.id}" style="text-align:center;letter-spacing:2px" autocomplete="off">
          <button type="button" onclick="toggleRrnVis(${e.id})" id="rrn-eye-${e.id}"
            title="주민번호 뒷자리 보기/숨기기"
            style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;opacity:.7">👁</button>
        </div>
      </td>
      <td>
        ${(e.payMode||POL.basePayMode)==='monthly'
          ?`<div style="display:flex;align-items:center;gap:2px"><input class="ei2" type="text" inputmode="numeric" value="${e.monthly!==null&&e.monthly!==undefined?Number(e.monthly).toLocaleString():''}" oninput="formatNumInput(this)" onchange="updE(${e.id},'monthly',+this.value.replace(/,/g,'')||0)" style="text-align:right" placeholder="${Number(POL.baseMonthly||0).toLocaleString()}" autocomplete="off"><span style="font-size:9px;color:var(--ink3)">원/월</span></div>`
          :`<div style="display:flex;align-items:center;gap:2px"><input class="ei2" type="text" inputmode="numeric" value="${e.rate!==null&&e.rate!==undefined?Number(e.rate).toLocaleString():''}" oninput="formatNumInput(this)" onchange="updE(${e.id},'rate',+this.value.replace(/,/g,'')||0)" style="text-align:right" placeholder="${Number(POL.baseRate||0).toLocaleString()}" autocomplete="off"><span style="font-size:9px;color:var(--ink3)">원/h</span></div>`
        }
      </td>
      <td><input class="ei2" type="date" value="${esc(e.join||'')}" onchange="updE(${e.id},'join',this.value)"></td>
      <td>
        <div style="display:flex;gap:3px">
          <button class="gender-btn male ${(e.gender||'male')==='male'?'on':''}" onclick="updE(${e.id},'gender','male');renderEmps()">남</button>
          <button class="gender-btn female ${e.gender==='female'?'on':''}" onclick="updE(${e.id},'gender','female');renderEmps()">여</button>
        </div>
      </td>
      <td>
        <div style="display:flex;gap:3px">
          <button class="nation-btn local ${(e.nation||'local')==='local'?'on':''}" onclick="updE(${e.id},'nation','local');renderEmps()">내국인</button>
          <button class="nation-btn foreign ${e.nation==='foreign'?'on':''}" onclick="updE(${e.id},'nation','foreign');renderEmps()">외국인</button>
        </div>
      </td>
      <td><input class="ei2" type="number" value="${e.age||''}" onchange="updE(${e.id},'age',+this.value)" style="text-align:center" placeholder="자동" id="age-${e.id}"></td>
      <td><input class="ei2" value="${esc(e.phone||'')}" oninput="this.value=formatPhone(this.value);updE(${e.id},'phone',this.value)" placeholder="010-0000-0000" maxlength="13"></td>
      <td>
        <div class="rb-g" style="justify-content:center">
          <div class="rb ${!e.payMode||e.payMode==='fixed'?'on':''}" onclick="updE(${e.id},'payMode','fixed');renderEmps()" style="font-size:9px;padding:3px 6px">통상임금제</div>
          <div class="rb ${e.payMode==='hourly'?'on':''}" onclick="updE(${e.id},'payMode','hourly');renderEmps()" style="font-size:9px;padding:3px 6px">시급제</div>
          <div class="rb ${e.payMode==='monthly'?'on':''}" onclick="updE(${e.id},'payMode','monthly');renderEmps()" style="font-size:9px;padding:3px 6px">월급제</div>
        </div>
      </td>
      <td>
        <div style="display:flex;gap:4px;justify-content:center">
          <button class="shift-btn day ${(e.shift||'day')==='day'?'on':''}" onclick="updE(${e.id},'shift','day');renderEmps()">주간</button>
          <button class="shift-btn night ${e.shift==='night'?'on':''}" onclick="updE(${e.id},'shift','night');renderEmps()">야간</button>
        </div>
      </td>
      <td style="text-align:center"><span style="font-size:11px;font-weight:700;color:var(--green)">${al.remain}개</span><br><span style="font-size:9px;color:var(--ink3)">(총${al.total})</span></td>
      <td>
        <div style="display:flex;gap:3px;flex-direction:column;align-items:flex-start">
          ${e.leave
            ?`<div style="display:flex;align-items:center;gap:4px;background:#FEE2E2;border:1px solid #FECACA;border-radius:7px;padding:3px 7px">
                <span style="font-size:9px;color:var(--rose);font-weight:700">퇴사</span>
                <span style="font-size:10px;color:#991B1B;font-weight:600">${esc(e.leave)}</span>
              </div>
              <button class="btn btn-xs" onclick="cancelLeave(${e.id})" style="font-size:9px;color:var(--ink3);margin-top:2px">퇴사취소</button>`
            :`<button class="btn btn-xs" onclick="setLeave(${e.id})" style="color:var(--rose);border-color:#FECACA">퇴사처리</button>`
          }
          <button class="btn btn-xs" onclick="rmE(${e.id})" style="color:var(--ink3);font-size:9px;margin-top:2px">삭제</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  initColResize();
}

// 직원관리 테이블 헤더 드래그 리사이즈
function initColResize(){
  const table=document.querySelector('.emt');
  if(!table)return;
  const ths=table.querySelectorAll('thead th');
  ths.forEach(th=>{
    if(th.querySelector('.col-resize'))return;
    const handle=document.createElement('div');
    handle.className='col-resize';
    th.appendChild(handle);
    let startX,startW;
    handle.addEventListener('mousedown',function(e){
      e.preventDefault();
      startX=e.pageX;
      startW=th.offsetWidth;
      handle.classList.add('active');
      function onMove(ev){
        const diff=ev.pageX-startX;
        const newW=Math.max(30,startW+diff);
        th.style.width=newW+'px';
        th.style.minWidth=newW+'px';
      }
      function onUp(){
        handle.classList.remove('active');
        document.removeEventListener('mousemove',onMove);
        document.removeEventListener('mouseup',onUp);
      }
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    });
  });
}

// 주민번호 뒷자리 보기/숨기기 토글. 렌더마다 기본은 숨김(password).
function toggleRrnVis(id){
  const inp = document.getElementById('rrn-back-'+id);
  const btn = document.getElementById('rrn-eye-'+id);
  if(!inp) return;
  if(inp.type === 'password'){
    inp.type = 'text';
    if(btn) btn.textContent = '🙈';
  } else {
    inp.type = 'password';
    if(btn) btn.textContent = '👁';
  }
}

function updRrn(id,field,val){
  const e=EMPS.find(x=>x.id===id);if(!e)return;
  if(field==='rrnBack'){
    const digits=val.replace(/[^0-9]/g,'');
    e.rrnBack=digits;
    const firstDigit=digits[0]||'';
    const g=rrn2gender(firstDigit);
    const n=rrn2nation(firstDigit);
    if(g)e.gender=g;
    if(n)e.nation=n;
  } else {
    e[field]=val.replace(/[^0-9]/g,'');
  }
  // 입력 완성도 시각 피드백: 부분 입력 시 호박색 테두리, 완성/빈 상태면 기본
  const paint = (sel, expectedLen, actualLen)=>{
    const inp = document.querySelector(sel);
    if(!inp) return;
    const partial = actualLen>0 && actualLen<expectedLen;
    inp.style.borderColor = partial ? 'var(--amber)' : '';
    inp.title = partial ? `${expectedLen}자리를 모두 입력해주세요 (현재 ${actualLen}자리)` : '';
  };
  paint('#rrn-front-'+id, 6, (e.rrnFront||'').length);
  paint('#rrn-back-'+id, 7, (e.rrnBack||'').length);
  // 앞자리 6자리 이상이면 나이 즉시 계산
  const age=rrn2age(e.rrnFront,e.rrnBack);
  if(age!==''){
    e.age=age;
    const ageEl=document.getElementById('age-'+id);
    if(ageEl)ageEl.value=age;
  }
  saveLS();
}

// 매일 자정에 전체 직원 나이 재계산
function refreshAllAges(){
  let changed = false;
  EMPS.forEach(e=>{
    if(!e.rrnFront||e.rrnFront.length<6)return;
    const age=rrn2age(e.rrnFront,e.rrnBack);
    if(age!==''&&e.age!==age){ e.age=age; changed=true; }
  });
  // 🛡️ 나이 변경이 실제로 있을 때만 저장 (init 504 방지).
  // 나이는 사용자 편집 시 자연스럽게 saveLS로 저장되므로 자동 저장 불필요.
  if(changed) saveLS();
  // 다음 자정에 다시 실행
  const now=new Date();
  const msToMidnight=(new Date(now.getFullYear(),now.getMonth(),now.getDate()+1)-now)+1000;
  setTimeout(refreshAllAges,msToMidnight);
}
function empDrop(ev,i){
  ev.preventDefault();
  if(empDragIdx===null||empDragIdx===i)return;
  const rows=document.querySelectorAll('#emp-tbody tr[data-eid]');
  const fromId=rows[empDragIdx]?parseInt(rows[empDragIdx].dataset.eid):null;
  const toId=rows[i]?parseInt(rows[i].dataset.eid):null;
  if(fromId&&toId&&fromId!==toId){
    const fromIdx=EMPS.findIndex(e=>e.id===fromId);
    const toIdx=EMPS.findIndex(e=>e.id===toId);
    if(fromIdx>=0&&toIdx>=0){
      const mv=EMPS.splice(fromIdx,1)[0];
      EMPS.splice(toIdx,0,mv);
    }
  }
  empDragIdx=null;
  saveLS();
  renderEmps();
  renderSb(document.getElementById('sb-search-inp')?.value||'');
  renderTable();
}
// EMPS 배열 자체를 주간→야간→퇴사 순으로 정렬
function sortEMPS(){
  EMPS.sort((a,b)=>{
    // 퇴사자 맨 뒤
    if(!a.leave&&b.leave)return -1;
    if(a.leave&&!b.leave)return 1;
    // 주간 먼저, 야간 나중
    const aS=(a.shift||'day')==='day'?0:1;
    const bS=(b.shift||'day')==='day'?0:1;
    return aS-bS;
  });
}

function updE(id,f,v){
  const e=EMPS.find(x=>x.id===id);
  if(!e)return;
  // 숫자 필드는 음수 방지 (실수 입력으로 음의 급여가 들어가는 것 차단)
  if(f==='rate' || f==='monthly'){
    const n = +v;
    e[f] = isNaN(n) ? 0 : Math.max(0, n);
  } else {
    e[f] = v;
  }
  // 입사일/퇴사일 미래 날짜는 실수일 가능성 → 저장하되 경고
  if((f==='join' || f==='leave') && v){
    const d = new Date(v);
    if(!isNaN(d) && d > new Date()){
      if(typeof showSyncToast==='function'){
        showSyncToast(`⚠️ ${f==='join'?'입사일':'퇴사일'}이 미래 날짜입니다. 저장은 되지만 확인해주세요.`,'warn',4000);
      }
    }
  }
  // shift(주야간) 변경 시 EMPS 배열 자체 재정렬
  if(f==='shift'||f==='leave'){
    sortEMPS();
  }
  saveLS();renderSb();renderTable();renderEmps();
}

// ══════════════════════════════════════
// 📋 직원 등록
// ══════════════════════════════════════

const BULK_COLS = [
  { key:'empNo',   label:'사번',     type:'text',   w:64  },
  { key:'name',    label:'이름 *',   type:'text',   w:88  },
  { key:'role',    label:'직종',     type:'text',   w:80  },
  { key:'grade',   label:'직급',     type:'text',   w:72  },
  { key:'dept',    label:'소속',     type:'text',   w:80  },
  { key:'rrnFront',label:'주민번호(앞)',type:'text', w:80  },
  { key:'rrnBack', label:'주민번호(뒤)',type:'text', w:80  },
  { key:'payMode', label:'급여방식', type:'select', w:88,
    opts:[{v:'fixed',l:'통상임금제'},{v:'hourly',l:'시급'},{v:'monthly',l:'월급제'},{v:'pohal',l:'포괄임금'}] },
  { key:'rate',    label:'시급/월급',type:'number', w:96  },
  { key:'join',    label:'입사일',   type:'date',   w:116 },
  { key:'gender',  label:'성별',     type:'select', w:72,
    opts:[{v:'male',l:'남'},{v:'female',l:'여'}] },
  { key:'nation',  label:'내외국인', type:'select', w:82,
    opts:[{v:'local',l:'내국인'},{v:'foreign',l:'외국인'}] },
  { key:'shift',   label:'주야간',   type:'select', w:72,
    opts:[{v:'day',l:'주간'},{v:'night',l:'야간'}] },
  { key:'phone',   label:'연락처',   type:'text',   w:112 },
  { key:'age',     label:'나이',     type:'number', w:56  },
];

const BULK_ROWS = 20;
let bulkData = [];
let bulkSel = {r:-1, c:-1};
let bulkSelStart = null; // 다중선택 시작점
let bulkSelRange = null; // {r1,c1,r2,c2}
let bulkClipboard = null; // 복사된 2D 배열

// 날짜 자동 파싱 (20010125 → 2001-01-25, 2001.01.25 → 2001-01-25)
function parseDate(val){
  if(!val) return '';
  const s = val.replace(/\D/g,'');
  if(s.length===8){
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  }
  return val;
}

function openBulkAdd(){
  bulkData = Array.from({length:BULK_ROWS}, ()=>({}));
  bulkSel = {r:-1, c:-1};
  bulkSelRange = null;
  bulkClipboard = null;

  const existing = document.getElementById('bulk-modal');
  if(existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'bulk-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:20px 12px;overflow:hidden';

  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:1260px;box-shadow:0 24px 80px rgba(0,0,0,.3);display:flex;flex-direction:column;height:100%;max-height:calc(100vh - 40px)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:2px solid var(--bd2);flex-shrink:0;background:#F8FAFC;border-radius:16px 16px 0 0">
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--ink)">📋 직원 등록</div>
          <div style="font-size:10.5px;color:var(--ink3);margin-top:2px">
            Tab/→: 이동 · Enter: 아래 · Shift+클릭/드래그: 범위선택 · Ctrl+C: 복사 · Ctrl+V: 붙여넣기(엑셀 복붙 가능!) · Delete: 지우기
          </div>
          <div style="font-size:10.5px;color:var(--navy2);margin-top:3px;font-weight:600">
            💡 사번은 공란으로 두시면 직원 정보(직종·소속) 기반으로 자동 생성할 수 있습니다.
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span id="bulk-count" style="font-size:11px;color:var(--ink3);background:#F1F5F9;padding:4px 10px;border-radius:6px">0명 입력됨</span>
          <button onclick="bulkAddRows(10)" class="btn btn-xs" style="color:var(--navy2);border-color:var(--navy2)">+ 10행</button>
          <button onclick="closeBulkAdd()" class="btn btn-xs">✕</button>
          <button onclick="confirmBulkAdd()" class="btn btn-n btn-sm">✅ 추가하기</button>
        </div>
      </div>
      <div style="overflow:auto;flex:1;border-radius:0 0 16px 16px" id="bulk-scroll">
        <table id="bulk-table" style="border-collapse:collapse;width:100%;table-layout:fixed">
          <colgroup>
            <col style="width:36px">
            ${BULK_COLS.map(c=>`<col style="width:${c.w}px">`).join('')}
          </colgroup>
          <thead>
            <tr style="background:#F1F5F9;position:sticky;top:0;z-index:10">
              <th style="padding:9px 6px;font-size:10px;color:var(--ink3);border-bottom:2px solid var(--bd2);border-right:1px solid var(--bd2);text-align:center">#</th>
              ${BULK_COLS.map(c=>`
                <th style="padding:9px 10px;font-size:11px;font-weight:700;color:${c.key==='name'?'var(--rose)':'var(--ink2)'};border-bottom:2px solid var(--bd2);border-right:1px solid var(--bd2);text-align:left;white-space:nowrap;overflow:hidden">
                  ${c.label}
                </th>`).join('')}
            </tr>
          </thead>
          <tbody id="bulk-tbody"></tbody>
        </table>
      </div>
    </div>`;

  document.body.appendChild(modal);
  renderBulkTable();

  // 키보드 이벤트
  document.addEventListener('keydown', bulkKeyDown);
  modal.addEventListener('mousedown', (e)=>e.stopPropagation());
}

function cellBg(ri, ci){
  const inRange = bulkSelRange &&
    ri >= Math.min(bulkSelRange.r1,bulkSelRange.r2) &&
    ri <= Math.max(bulkSelRange.r1,bulkSelRange.r2) &&
    ci >= Math.min(bulkSelRange.c1,bulkSelRange.c2) &&
    ci <= Math.max(bulkSelRange.c1,bulkSelRange.c2);
  if(inRange) return '#DBEAFE';
  if(bulkSel.r===ri && bulkSel.c===ci) return '#EFF6FF';
  const col = BULK_COLS[ci];
  const val = bulkData[ri]?.[col?.key];
  if(val && col?.key==='name') return '#F0FFF4';
  return '#fff';
}

function renderBulkTable(){
  const tbody = document.getElementById('bulk-tbody');
  if(!tbody) return;

  tbody.innerHTML = bulkData.map((row, ri) => {
    const isSel = bulkSel.r===ri;
    return `<tr id="bulk-row-${ri}" style="border-bottom:1px solid #E2E8F0">
      <td style="text-align:center;padding:4px 4px;font-size:10px;color:var(--ink4);background:#F8FAFC;border-right:1px solid #E2E8F0;user-select:none">${ri+1}</td>
      ${BULK_COLS.map((col, ci) => {
        const val = row[col.key] !== undefined ? row[col.key] : '';
        const bg = cellBg(ri, ci);
        const isCurSel = bulkSel.r===ri && bulkSel.c===ci;

        let inp;
        if(col.type==='select'){
          // 버튼 토글 방식 - 클릭 또는 Space로 순환
          const curOpt = col.opts.find(o=>o.v===val);
          const curLabel = curOpt ? curOpt.l : '--';
          const isSet = !!val;
          inp = `<button
            onmousedown="event.stopPropagation()"
            onclick="bulkCycleSelect(${ri},${ci},event)"
            onfocus="bulkFocusCell(${ri},${ci},event)"
            style="width:100%;border:none;background:${isSet?'var(--nbg)':'transparent'};
              font-size:11.5px;font-weight:${isSet?'700':'400'};
              color:${isSet?'var(--navy2)':'var(--ink4)'};
              padding:4px 6px;cursor:pointer;text-align:center;
              border-radius:5px;font-family:inherit;outline:none;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${curLabel}${isSet?' ▾':' ▾'}
          </button>`;
        } else if(col.type==='date'){
          inp = `<input type="text" value="${val}" placeholder="YYYYMMDD"
            onchange="bulkSetDate(${ri},${ci},this.value)"
            onblur="bulkSetDate(${ri},${ci},this.value);renderBulkTable()"
            onfocus="bulkFocusCell(${ri},${ci},event)"
            style="width:100%;border:none;background:transparent;font-size:12px;color:var(--ink);padding:2px;outline:none;font-family:inherit">`;
        } else {
          inp = `<input type="${col.type==='number'?'number':'text'}" value="${val}"
            oninput="bulkSetVal(${ri},${ci},this.value)"
            onfocus="bulkFocusCell(${ri},${ci},event)"
            style="width:100%;border:none;background:transparent;font-size:12px;color:var(--ink);padding:2px;outline:none;font-family:inherit;${col.type==='number'?'text-align:right':''}">`;
        }

        return `<td id="bulk-cell-${ri}-${ci}"
          onmousedown="bulkMouseDown(${ri},${ci},event)"
          onmouseover="bulkMouseOver(${ri},${ci},event)"
          onmouseup="bulkMouseUp(${ri},${ci},event)"
          style="padding:0;border-right:1px solid #E2E8F0;background:${bg};
            ${isCurSel?'outline:2px solid var(--navy2);outline-offset:-2px;':''}
            position:relative;height:32px;box-sizing:border-box">
          <div style="padding:2px 8px;height:100%;display:flex;align-items:center">${inp}</div>
        </td>`;
      }).join('')}
    </tr>`;
  }).join('');

  updateBulkCount();
}

let _bulkDragging = false;

function bulkMouseDown(ri, ci, e){
  if(e.button !== 0) return;
  e.preventDefault(); // 텍스트 선택 방지
  if(e.shiftKey && bulkSel.r >= 0){
    // Shift+클릭: 범위 확장
    bulkSelRange = {r1:bulkSel.r, c1:bulkSel.c, r2:ri, c2:ci};
    bulkUpdateHighlight();
    return;
  }
  // 드래그 시작
  bulkSelRange = null;
  bulkSelStart = {r:ri, c:ci};
  bulkSel = {r:ri, c:ci};
  _bulkDragging = true;
  bulkUpdateHighlight();
}

function bulkMouseOver(ri, ci, e){
  if(!_bulkDragging || !bulkSelStart) return;
  bulkSelRange = {r1:bulkSelStart.r, c1:bulkSelStart.c, r2:ri, c2:ci};
  bulkUpdateHighlight();
}

function bulkMouseUp(ri, ci, e){
  if(!_bulkDragging) return;
  _bulkDragging = false;
  // 드래그 없이 단순 클릭이면 input 포커스
  const isSameCell = bulkSelStart && bulkSelStart.r===ri && bulkSelStart.c===ci;
  if(isSameCell && !bulkSelRange){
    bulkSel = {r:ri, c:ci};
    const cell = document.getElementById(`bulk-cell-${ri}-${ci}`);
    if(cell){ const inp = cell.querySelector('input,button'); if(inp) inp.focus(); }
  }
}

document.addEventListener('mouseup', ()=>{ _bulkDragging = false; });

// 하이라이트만 업데이트 (DOM 재생성 없이)
function bulkUpdateHighlight(){
  document.querySelectorAll('[id^="bulk-cell-"]').forEach(el=>{
    const parts = el.id.split('-');
    const r=+parts[2], c=+parts[3];
    const bg = cellBg(r,c);
    el.style.background = bg;
    const isCur = bulkSel.r===r && bulkSel.c===c && !bulkSelRange;
    el.style.outline = isCur ? '2px solid var(--navy2)' : 'none';
    el.style.outlineOffset = '-2px';
  });
}

function bulkFocusCell(ri, ci, e){
  if(_bulkDragging) return;
  bulkSel = {r:ri, c:ci};
  if(!e?.shiftKey) bulkSelRange = null;
  bulkUpdateHighlight();
  const cell = document.getElementById(`bulk-cell-${ri}-${ci}`);
  if(cell){ const inp = cell.querySelector('input,button'); if(inp) inp.focus(); }
}


function bulkCycleSelect(ri, ci, e){
  e.stopPropagation();
  const col = BULK_COLS[ci];
  if(!col.opts) return;
  const cur = bulkData[ri]?.[col.key] || '';
  const idx = col.opts.findIndex(o=>o.v===cur);
  const next = col.opts[(idx+1) % col.opts.length];
  bulkSetVal(ri, ci, next.v);
  // 해당 셀만 다시 렌더
  const cell = document.getElementById(`bulk-cell-${ri}-${ci}`);
  if(cell){
    const btn = cell.querySelector('button');
    if(btn){
      btn.textContent = next.l + ' ▾';
      btn.style.background = 'var(--nbg)';
      btn.style.color = 'var(--navy2)';
      btn.style.fontWeight = '700';
    }
  }
}
function bulkSetVal(ri, ci, val){
  if(!bulkData[ri]) bulkData[ri] = {};
  bulkData[ri][BULK_COLS[ci].key] = val;
  updateBulkCount();
  // 이름 셀이면 배경색만 업데이트
  if(BULK_COLS[ci].key==='name'){
    const cell = document.getElementById(`bulk-cell-${ri}-${ci}`);
    if(cell) cell.style.background = val ? '#F0FFF4' : '#fff';
  }
}

function bulkSetDate(ri, ci, val){
  const parsed = parseDate(val.trim());
  if(!bulkData[ri]) bulkData[ri] = {};
  bulkData[ri][BULK_COLS[ci].key] = parsed;
  updateBulkCount();
}

function updateBulkCount(){
  const count = bulkData.filter(r=>r.name&&r.name.trim()).length;
  const el = document.getElementById('bulk-count');
  if(el){
    el.textContent = `${count}명 입력됨`;
    el.style.background = count > 0 ? '#DCFCE7' : '#F1F5F9';
    el.style.color = count > 0 ? '#166534' : 'var(--ink3)';
  }
}

function bulkKeyDown(e){
  if(!document.getElementById('bulk-modal')) {
    document.removeEventListener('keydown', bulkKeyDown);
    return;
  }
  const {r, c} = bulkSel;
  const rows = bulkData.length;
  const cols = BULK_COLS.length;

  // Ctrl+C: 복사
  if(e.ctrlKey && e.key==='c'){
    bulkCopy(); return;
  }
  // Ctrl+V: 붙여넣기 (클립보드 API - 엑셀에서 복사한 텍스트도 처리)
  if(e.ctrlKey && e.key==='v'){
    e.preventDefault();
    navigator.clipboard.readText().then(text=>{
      if(text) bulkPasteText(text);
      else bulkPaste();
    }).catch(()=>bulkPaste());
    return;
  }
  // Delete/Backspace: 선택 범위 지우기
  if((e.key==='Delete') && bulkSelRange){
    e.preventDefault(); bulkClearRange(); return;
  }

  if(r < 0) return;

  if(e.key==='Tab'){
    e.preventDefault();
    bulkSelRange = null;
    if(e.shiftKey){ if(c>0) bulkFocusCell(r,c-1); else if(r>0) bulkFocusCell(r-1,cols-1); }
    else { if(c<cols-1) bulkFocusCell(r,c+1); else if(r<rows-1) bulkFocusCell(r+1,0); }
    return;
  }
  if(e.key==='Enter'){ e.preventDefault(); bulkSelRange=null; if(r<rows-1) bulkFocusCell(r+1,c); return; }
  if(e.key==='ArrowDown' && !e.shiftKey){
    // select 요소 열려있지 않을 때만 이동
    if(document.activeElement.tagName==='SELECT') return;
    e.preventDefault(); if(r<rows-1) bulkFocusCell(r+1,c); return;
  }
  if(e.key==='ArrowUp' && !e.shiftKey){
    if(document.activeElement.tagName==='SELECT') return;
    e.preventDefault(); if(r>0) bulkFocusCell(r-1,c); return;
  }
  if(e.key==='ArrowRight' && !e.shiftKey){
    // input에서 커서가 끝에 있을 때만 이동
    const ae=document.activeElement;
    if(ae.tagName==='SELECT') return;
    if(ae.tagName==='INPUT' && ae.selectionStart!==ae.value.length) return;
    e.preventDefault(); if(c<cols-1) bulkFocusCell(r,c+1); return;
  }
  if(e.key==='ArrowLeft' && !e.shiftKey){
    const ae=document.activeElement;
    if(ae.tagName==='SELECT') return;
    if(ae.tagName==='INPUT' && ae.selectionStart!==0) return;
    e.preventDefault(); if(c>0) bulkFocusCell(r,c-1); return;
  }
  // Shift+방향키: 범위 확장
  if(e.key==='ArrowDown' && e.shiftKey){
    e.preventDefault();
    if(!bulkSelRange) bulkSelRange={r1:r,c1:c,r2:r,c2:c};
    if(bulkSelRange.r2<rows-1) bulkSelRange.r2++;
    renderBulkTable(); return;
  }
  if(e.key==='ArrowUp' && e.shiftKey){
    e.preventDefault();
    if(!bulkSelRange) bulkSelRange={r1:r,c1:c,r2:r,c2:c};
    if(bulkSelRange.r2>0) bulkSelRange.r2--;
    renderBulkTable(); return;
  }
}

function bulkCopy(){
  const range = bulkSelRange || {r1:bulkSel.r,c1:bulkSel.c,r2:bulkSel.r,c2:bulkSel.c};
  if(range.r1<0) return;
  const r1=Math.min(range.r1,range.r2), r2=Math.max(range.r1,range.r2);
  const c1=Math.min(range.c1,range.c2), c2=Math.max(range.c1,range.c2);
  bulkClipboard = [];
  for(let r=r1;r<=r2;r++){
    const row=[];
    for(let c=c1;c<=c2;c++){
      row.push(bulkData[r]?.[BULK_COLS[c].key]||'');
    }
    bulkClipboard.push(row);
  }
  // 상태 표시
  const el=document.getElementById('bulk-count');
  if(el){ const orig=el.textContent; el.textContent=`📋 ${(r2-r1+1)}행 복사됨`; setTimeout(()=>updateBulkCount(),1200); }
}

function bulkPaste(){
  if(!bulkClipboard || bulkSel.r<0) return;
  const {r, c} = bulkSel;
  bulkClipboard.forEach((rowData, ri)=>{
    const tr = r+ri;
    if(tr>=bulkData.length) bulkData.push({});
    rowData.forEach((val, ci)=>{
      const tc = c+ci;
      if(tc<BULK_COLS.length){
        if(!bulkData[tr]) bulkData[tr]={};
        const key = BULK_COLS[tc].key;
        bulkData[tr][key] = key==='join' ? parseDate(String(val)) : val;
      }
    });
  });
  renderBulkTable();
}

function bulkPasteText(text){
  // 엑셀/구글시트에서 복사한 탭 구분 텍스트 파싱
  if(!text || bulkSel.r < 0) return;
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  // 마지막 빈 줄 제거
  while(lines.length && !lines[lines.length-1].trim()) lines.pop();
  if(!lines.length) return;

  const {r, c} = bulkSel;
  // 행이 부족하면 추가
  while(bulkData.length < r + lines.length) bulkData.push({});

  lines.forEach((line, ri)=>{
    const cells = line.split('\t');
    cells.forEach((val, ci)=>{
      const tc = c + ci;
      if(tc >= BULK_COLS.length) return;
      if(!bulkData[r+ri]) bulkData[r+ri] = {};
      const key = BULK_COLS[tc].key;
      const trimVal = val.trim();
      if(key === 'join') bulkData[r+ri][key] = parseDate(trimVal);
      else if(key === 'shift') bulkData[r+ri][key] = (trimVal==='야간'||trimVal==='night') ? 'night' : trimVal ? 'day' : '';
      else if(key === 'gender') bulkData[r+ri][key] = (trimVal==='여'||trimVal==='female') ? 'female' : trimVal ? 'male' : '';
      else if(key === 'nation') bulkData[r+ri][key] = (trimVal==='외국인'||trimVal==='foreign') ? 'foreign' : trimVal ? 'local' : '';
      else if(key === 'payMode'){
        if(trimVal==='시급'||trimVal==='hourly') bulkData[r+ri][key]='hourly';
        else if(trimVal==='월급제'||trimVal==='monthly') bulkData[r+ri][key]='monthly';
        else if(trimVal==='포괄임금'||trimVal==='pohal') bulkData[r+ri][key]='pohal';
        else if(trimVal) bulkData[r+ri][key]='fixed';
        else bulkData[r+ri][key]='';
      }
      else bulkData[r+ri][key] = trimVal;
    });
  });
  renderBulkTable();
  // 붙여넣기 완료 토스트
  const el=document.getElementById('bulk-count');
  if(el){ el.textContent=`📋 ${lines.length}행 붙여넣기 완료`; setTimeout(()=>updateBulkCount(),1500); }
}

function bulkClearRange(){
  const range = bulkSelRange;
  if(!range) return;
  const r1=Math.min(range.r1,range.r2), r2=Math.max(range.r1,range.r2);
  const c1=Math.min(range.c1,range.c2), c2=Math.max(range.c1,range.c2);
  for(let r=r1;r<=r2;r++){
    for(let c=c1;c<=c2;c++){
      if(bulkData[r]) bulkData[r][BULK_COLS[c].key]='';
    }
  }
  renderBulkTable();
}

function bulkAddRows(n){
  for(let i=0;i<n;i++) bulkData.push({});
  renderBulkTable();
}

function closeBulkAdd(){
  document.removeEventListener('keydown', bulkKeyDown);
  const modal = document.getElementById('bulk-modal');
  if(modal) modal.remove();
}

function confirmBulkAdd(){
  const valid = bulkData.filter(r=>r.name&&r.name.trim());
  if(valid.length===0){ alert('이름을 최소 1명 이상 입력하세요'); return; }

  const colors=['#DBEAFE','#FEF3C7','#D1FAE5','#EDE9FE','#FCE7F3','#FFF7ED'];
  const tcs=['#1E3A5F','#78350F','#064E3B','#4C1D95','#831843','#7C2D12'];
  let maxId = EMPS.length>0 ? Math.max(...EMPS.map(e=>e.id)) : 0;

  valid.forEach((row,i)=>{
    maxId++;
    const ci=(EMPS.length+i)%colors.length;
    const joinDate = row.join ? parseDate(row.join) : '';
    const pm=row.payMode||null;
    const isMonthly=pm==='monthly';
    EMPS.push({
      id:maxId, name:row.name.trim(),
      role:row.role||'', grade:row.grade||'', dept:row.dept||'',
      empNo:row.empNo||'',
      rate:(!isMonthly&&row.rate)?+row.rate:null,
      monthly:(isMonthly&&row.rate)?+row.rate:null,
      join:joinDate, leave:'',
      age:row.age?+row.age:'', phone:row.phone||'',
      rrnFront:row.rrnFront||'', rrnBack:row.rrnBack||'', sot:209,
      payMode:pm,
      shift:row.shift||'day',
      gender:row.gender||'male',
      nation:row.nation||'local',
      color:colors[ci], tc:tcs[ci]
    });
  });

  sortEMPS();
  saveLS(); renderEmps(); renderSb();
  closeBulkAdd();

  // Supabase 즉시 저장 (debounce 기다리지 않고)
  try{
    const _sess = JSON.parse(localStorage.getItem('nopro_session')||'null');
    if(_sess && _sess.companyId){
      if(saveLS._timer) clearTimeout(saveLS._timer);
      sbSaveAll(_sess.companyId).catch(e=>console.warn(e));
    }
  }catch(e){}

  const toast=document.createElement('div');
  toast.style.cssText='position:fixed;bottom:24px;right:24px;background:var(--navy);color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.2)';
  toast.textContent=`✅ ${valid.length}명 추가 완료`;
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(),2500);
}


// ══════════════════════════════════════
// 📂 엑셀 업로드 → 직원 일괄 등록
// ══════════════════════════════════════
function excelToast(msg){
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:24px;right:24px;background:var(--navy);color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.2)';
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2500);
}
function importEmpsExcel(input){
  const file=input.files[0];
  if(!file)return;
  input.value='';
  const reader=new FileReader();
  reader.onload=function(e){
    const data=new Uint8Array(e.target.result);
    const wb=XLSX.read(data,{type:'array',cellDates:true});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
    if(rows.length<2){excelToast('데이터가 없습니다');return;}

    // 헤더(1행) 기반 열 인덱스 자동 감지
    const hdr=rows[0].map(h=>String(h||'').trim());
    const colMap={};
    const colNames={
      empNo:['사원코드','사원번호','사번'],
      name:['사원명','이름','성명'],
      nation:['내외국인구분','내외국인','국적구분'],
      rrn:['주민(외국인)등록번호','주민등록번호','주민번호','등록번호'],
      age:['나이','연령'],
      gender:['성별'],
      join:['입사일자','입사일','입사날짜'],
      grade:['직급'],
      role:['직종','직무'],
      phone:['휴대폰번호','핸드폰','휴대폰','연락처','전화번호']
    };
    for(const[key,names]of Object.entries(colNames)){
      const idx=hdr.findIndex(h=>names.some(n=>h.includes(n)));
      if(idx>=0)colMap[key]=idx;
    }
    // 직급/직종 구분: 직급이 직종보다 앞에 있으면 순서대로 매핑
    // 별도 처리 불필요 - 헤더명으로 정확히 매칭됨

    if(colMap.name===undefined){excelToast('사원명 열을 찾을 수 없습니다');return;}

    const colors=['#DBEAFE','#FEF3C7','#D1FAE5','#EDE9FE','#FCE7F3','#FFF7ED'];
    const tcs=['#1E3A5F','#78350F','#064E3B','#4C1D95','#831843','#7C2D12'];
    let added=0, skipped=0;

    for(let i=1;i<rows.length;i++){
      const r=rows[i];
      const nm=String(r[colMap.name]||'').trim();
      if(!nm)continue;

      // 중복 체크: 사원코드 + 이름 일치 시 스킵
      const empNo=colMap.empNo!==undefined?String(r[colMap.empNo]||'').trim():'';
      const isDup=EMPS.some(x=>x.name===nm&&String(x.empNo||'')===empNo);
      if(isDup){skipped++;continue;}

      const nid=EMPS.length>0?Math.max(...EMPS.map(x=>x.id))+1:1;
      const ci=EMPS.length%colors.length;

      // 주민번호 파싱 (XXXXXX-XXXXXXX 또는 13자리 숫자)
      let rrnFront='',rrnBack='';
      if(colMap.rrn!==undefined){
        const raw=String(r[colMap.rrn]||'').replace(/\s/g,'');
        if(raw.includes('-')){
          const parts=raw.split('-');
          rrnFront=parts[0]||'';
          rrnBack=parts[1]||'';
        }else if(raw.length>=13){
          rrnFront=raw.slice(0,6);
          rrnBack=raw.slice(6,13);
        }else if(raw.length>=6){
          rrnFront=raw.slice(0,6);
        }
      }

      // 성별 변환
      let gender='male';
      if(colMap.gender!==undefined){
        const g=String(r[colMap.gender]||'').trim();
        if(g==='여'||g==='여성'||g==='F'||g==='female')gender='female';
      }else if(rrnBack){
        const g2=rrn2gender(rrnBack);
        if(g2)gender=g2;
      }

      // 내외국인 변환
      let nation='local';
      if(colMap.nation!==undefined){
        const n=String(r[colMap.nation]||'').trim();
        if(n==='외국인'||n==='외국'||n==='foreign'||n==='F')nation='foreign';
      }else if(rrnBack){
        const n2=rrn2nation(rrnBack);
        if(n2)nation=n2;
      }

      // 나이 계산 (주민번호 기반 만나이)
      let age='';
      if(rrnFront.length>=6){
        age=rrn2age(rrnFront,rrnBack);
      }

      // 입사일 파싱
      let joinDate='';
      if(colMap.join!==undefined){
        const jv=r[colMap.join];
        if(jv instanceof Date){
          joinDate=jv.toISOString().slice(0,10);
        }else{
          joinDate=parseDate(String(jv||''));
        }
      }

      // 전화번호 정리
      let phone='';
      if(colMap.phone!==undefined){
        phone=String(r[colMap.phone]||'').trim();
      }

      const emp={
        id:nid,
        name:nm,
        empNo:colMap.empNo!==undefined?String(r[colMap.empNo]||'').trim():'',
        role:colMap.role!==undefined?String(r[colMap.role]||'').trim():'',
        grade:colMap.grade!==undefined?String(r[colMap.grade]||'').trim():'',
        dept:'',
        rate:null,
        monthly:null,
        join:joinDate,
        leave:'',
        age:age,
        phone:phone,
        rrnFront:rrnFront,
        rrnBack:rrnBack,
        sot:209,
        payMode:null,
        shift:'day',
        gender:gender,
        nation:nation,
        color:colors[ci],
        tc:tcs[ci]
      };
      EMPS.push(emp);
      added++;
    }

    saveLS();renderEmps();renderSb();renderTable();
    const msg=added+'명 등록'+(skipped>0?' / '+skipped+'명 중복 스킵':'');
    excelToast(msg);
  };
  reader.readAsArrayBuffer(file);
}

// 📎 사번 엑셀 업로드 → 이름 매칭으로 empNo만 업데이트
function importEmpNoExcel(input){
  const file=input.files[0];
  input.value='';
  if(!file) return;
  const reader=new FileReader();
  reader.onload=function(e){
    const data=new Uint8Array(e.target.result);
    const wb=XLSX.read(data,{type:'array'});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});

    if(rows.length<2){excelToast('데이터가 없습니다');return;}

    // 헤더 행 찾기 (첫 10행 내에서 '이름' + '사번' 열이 모두 있는 행)
    const isNameH=h=>{const s=String(h).trim();const lc=s.toLowerCase();return s==='이름'||s==='사원명'||s==='성명'||lc==='name';};
    const isCodeH=h=>{const s=String(h).trim();const lc=s.toLowerCase();return s==='사번'||s==='신규사번'||s==='사원번호'||s==='사번코드'||lc==='empno'||lc==='employee id';};

    let nameCol=-1, codeCol=-1, headerRow=-1;
    for(let r=0;r<Math.min(10,rows.length);r++){
      let nc=-1, cc=-1;
      rows[r].forEach((cell,i)=>{
        if(isNameH(cell)) nc=i;
        if(isCodeH(cell)) cc=i;
      });
      if(nc!==-1&&cc!==-1){ nameCol=nc; codeCol=cc; headerRow=r; break; }
    }

    if(nameCol===-1||codeCol===-1){excelToast('이름 또는 사번 열을 찾을 수 없습니다');return;}

    // 매핑 구축 (헤더 다음 행부터)
    const mapping={};
    for(let r=headerRow+1;r<rows.length;r++){
      const name=String(rows[r][nameCol]||'').trim();
      const code=String(rows[r][codeCol]||'').trim();
      if(name&&code&&name!=='합 계') mapping[name]=code;
    }

    if(Object.keys(mapping).length===0){excelToast('매핑 데이터가 없습니다');return;}
    console.log('[사번 업로드] 매핑 '+Object.keys(mapping).length+'건 로드, 헤더행='+headerRow+', 이름열='+nameCol+', 사번열='+codeCol);

    // EMPS에서 이름 매칭 → empNo만 업데이트
    let updated=0;
    const used={};
    for(const emp of EMPS){
      const name=(emp.name||'').trim();
      if(mapping[name]&&!used[name]){
        const oldNo=emp.empNo||'(없음)';
        emp.empNo=mapping[name];
        console.log('[사번 업로드] '+name+': '+oldNo+' → '+emp.empNo);
        updated++;
        used[name]=true;
      }
    }
    const notFound=Object.keys(mapping).filter(n=>!used[n]);

    saveLS();renderEmps();renderSb();
    let msg=updated+'명 사번 업데이트 완료';
    if(notFound.length>0) msg+=' / '+notFound.length+'명 매칭 실패';
    excelToast(msg);

    if(notFound.length>0){
      console.log('[사번 업로드] 매칭 실패 목록:', notFound);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ══ 사번 자동 생성 ══
const EMPNO_CODES_DEFAULT=[
  {code:'AA',label:'재활용폐기장 · 직접고용/사무직'},
  {code:'AB',label:'재활용폐기장 · 직접고용/현장직'},
  {code:'AC',label:'재활용폐기장 · 아웃소싱/사무직'},
  {code:'AD',label:'재활용폐기장 · 아웃소싱/현장직'},
  {code:'BA',label:'대형폐기장 · 직접고용/사무직'},
  {code:'BB',label:'대형폐기장 · 직접고용/현장직'},
  {code:'BC',label:'대형폐기장 · 아웃소싱/사무직'},
  {code:'BD',label:'대형폐기장 · 아웃소싱/현장직'},
];
function getEmpNoCodes(){return POL.empNoCodes||EMPNO_CODES_DEFAULT;}

// 사번 자동 부여 ON/OFF 토글
function toggleEmpNoSetting(on){
  POL.empNoEnabled=on;
  const body=document.getElementById('empno-settings-body');
  const label=document.getElementById('empno-toggle-label');
  if(body)body.style.display=on?'block':'none';
  if(label){label.textContent=on?'ON':'OFF';label.style.color=on?'var(--navy)':'var(--ink3)';}
  saveLS();
}
function initEmpNoSetting(){
  const on=!!POL.empNoEnabled;
  const cb=document.getElementById('inp-empno-enabled');if(cb)cb.checked=on;
  toggleEmpNoSetting(on);
  renderEmpNoCodes();
}
// 구분코드 커스텀 목록 렌더
function renderEmpNoCodes(){
  const list=document.getElementById('empno-codes-list');if(!list)return;
  const codes=getEmpNoCodes();
  list.innerHTML=codes.map((c,i)=>`<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
    <input class="ni" value="${esc(c.code)}" style="width:50px;text-align:center;font-size:12px;font-weight:700;letter-spacing:1px" maxlength="4"
      onchange="updEmpNoCode(${i},'code',this.value)">
    <input class="ni" value="${esc(c.label)}" style="flex:1;font-size:11px"
      onchange="updEmpNoCode(${i},'label',this.value)">
    <button onclick="delEmpNoCode(${i})" style="background:none;border:none;color:var(--rose);cursor:pointer;font-size:14px;padding:2px 6px" title="삭제">×</button>
  </div>`).join('');
}
function updEmpNoCode(i,key,val){
  if(!POL.empNoCodes)POL.empNoCodes=[...EMPNO_CODES_DEFAULT];
  POL.empNoCodes[i][key]=val.trim();
  saveLS();
}
function addEmpNoCode(){
  if(!POL.empNoCodes)POL.empNoCodes=[...EMPNO_CODES_DEFAULT.map(c=>({...c}))];
  POL.empNoCodes.push({code:'',label:''});
  saveLS();renderEmpNoCodes();
}
function delEmpNoCode(i){
  if(!POL.empNoCodes)return;
  POL.empNoCodes.splice(i,1);
  saveLS();renderEmpNoCodes();
}
function genEmpNo(deptCode){
  const site=POL.siteCode||'';
  if(!site||site.length!==5)return '';
  const prefix=site+deptCode;
  // 기존 직원(퇴사자 포함)에서 같은 prefix의 최대 일련번호 찾기
  let maxSeq=0;
  EMPS.forEach(e=>{
    const no=String(e.empNo||'');
    if(no.length===10&&no.startsWith(prefix)){
      const seq=parseInt(no.slice(7),10);
      if(!isNaN(seq)&&seq>maxSeq) maxSeq=seq;
    }
  });
  return prefix+String(maxSeq+1).padStart(3,'0');
}

function addEmp(){
  doAddEmp('');
}
function doAddEmp(empNo){
  const nid=EMPS.length>0?Math.max(...EMPS.map(e=>e.id))+1:1;
  const colors=['#DBEAFE','#FEF3C7','#D1FAE5','#EDE9FE','#FCE7F3','#FFF7ED'];
  const tcs=['#1E3A5F','#78350F','#064E3B','#4C1D95','#831843','#7C2D12'];
  const ci=EMPS.length%colors.length;
  EMPS.push({id:nid,name:'',role:'',dept:'',empNo:empNo,rate:null,monthly:null,join:'',leave:'',age:'',phone:'',rrnFront:'',rrnBack:'',sot:209,payMode:null,shift:'day',gender:'male',nation:'local',color:colors[ci],tc:tcs[ci]});
  saveLS();renderEmps();renderSb();
}
// 직원 정보 기반 구분코드 자동 판별
function detectDeptCode(emp){
  const role=(emp.role||'').trim();
  const dept=(emp.dept||'').trim();
  // 둘째 자리: 고용형태+직무 (A=직접/사무, B=직접/현장, C=아웃소싱/사무, D=아웃소싱/현장)
  const isOutsource=/아웃소싱|파견|도급|외주|위탁/.test(dept);
  const isOffice=/사무|관리|경영|매니저|총무|회계|인사/.test(role);
  const isField=/현장|생산|선별|기사|운전|작업|노무/.test(role);
  let second='';
  if(isOutsource){
    second=isOffice?'C':(isField?'D':'D'); // 아웃소싱: 사무C, 현장D
  } else {
    second=isOffice?'A':(isField?'B':'B'); // 직접고용: 사무A, 현장B
  }
  return {second, isOutsource, isOffice, isField, roleTxt:role, deptTxt:dept};
}

function showGenEmpNo(empId){
  const emp=EMPS.find(e=>e.id===empId);
  if(!emp)return;
  const site=(POL.siteCode||'').trim();
  if(site.length!==5){alert('급여 설정에서 사이트코드(5자리)를 먼저 설정하세요.');return;}

  const det=detectDeptCode(emp);
  let old=document.getElementById('empno-modal');if(old)old.remove();
  const modal=document.createElement('div');
  modal.id='empno-modal';
  modal.dataset.empId=String(empId);
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';

  const codes=getEmpNoCodes();
  const hasDetection=!!(det.roleTxt||det.deptTxt);
  const secondLabels={A:'직접고용/사무직',B:'직접고용/현장직',C:'아웃소싱/사무직',D:'아웃소싱/현장직'};

  // 시설유형(첫째 자리) 그룹 추출
  const facilityMap=new Map();
  codes.filter(c=>c.code&&c.code.length>=2).forEach(c=>{
    const first=c.code[0];
    if(!facilityMap.has(first)){
      const fname=c.label.split('·')[0].trim()||first;
      facilityMap.set(first,fname);
    }
  });
  const facilities=[...facilityMap.entries()];

  // 감지 정보 있으면 → 시설유형만 선택, 없으면 → 전체 코드 표시
  let selectionHtml='';
  if(hasDetection){
    selectionHtml=`
      <div style="font-size:11px;font-weight:700;color:var(--ink);margin-bottom:8px">시설유형 선택 <span style="font-weight:500;color:var(--ink3)">(나머지는 감지 정보로 자동 적용)</span></div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${facilities.map(([first,fname])=>{
          const fullCode=first+det.second;
          const no=genEmpNo(fullCode);
          return `<div style="display:flex;gap:4px;align-items:stretch">
            <button onclick="confirmGenEmpNo(${empId},'${no}');document.getElementById('empno-modal').remove()"
              style="flex:1;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border:1.5px solid var(--bd);border-radius:10px;background:#fff;cursor:pointer;font-family:inherit;transition:all .14s"
              onmouseover="this.style.borderColor='var(--navy2)';this.style.background='var(--nbg)'"
              onmouseout="this.style.borderColor='var(--bd)';this.style.background='#fff'">
              <div>
                <div class="empno-fname" style="font-size:13px;font-weight:700;color:var(--ink)">${esc(fname)}</div>
                <div style="font-size:10px;color:var(--ink3)">${esc(fname)} · ${secondLabels[det.second]||det.second} · 코드: ${esc(fullCode)}</div>
              </div>
              <div style="font-size:14px;font-weight:800;color:var(--navy2);font-variant-numeric:tabular-nums;letter-spacing:.5px">${no}</div>
            </button>
            <button onclick="event.stopPropagation();empNoEditFacility('${first}')"
              style="padding:0 10px;border:1.5px solid var(--bd);border-radius:10px;background:#fff;cursor:pointer;font-size:14px;transition:all .14s"
              onmouseover="this.style.borderColor='var(--navy2)';this.style.background='var(--nbg)'"
              onmouseout="this.style.borderColor='var(--bd)';this.style.background='#fff'"
              title="이름 편집">✏️</button>
          </div>`;
        }).join('')}
      </div>`;
  } else {
    selectionHtml=`
      <div style="font-size:11px;font-weight:700;color:var(--ink);margin-bottom:4px">구분코드 선택 <span style="font-weight:500;color:var(--ink3)">(직종/소속 미입력 → 전체 표시)</span></div>
      <div style="font-size:10px;color:var(--amber);margin-bottom:8px;font-weight:600">💡 직원관리에서 직종·소속을 입력하면 자동 감지됩니다</div>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto">
        ${codes.filter(c=>c.code).map((c,ci)=>{
          const no=genEmpNo(c.code);
          return `<div style="display:flex;gap:4px;align-items:stretch">
            <button onclick="confirmGenEmpNo(${empId},'${no}');document.getElementById('empno-modal').remove()"
              style="flex:1;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1.5px solid var(--bd);border-radius:10px;background:#fff;cursor:pointer;font-family:inherit;transition:all .14s"
              onmouseover="this.style.borderColor='var(--navy2)';this.style.background='var(--nbg)'"
              onmouseout="this.style.borderColor='var(--bd)';this.style.background='#fff'">
              <div>
                <div class="empno-clabel" style="font-size:12px;font-weight:700;color:var(--ink)">${esc(c.label||c.code)}</div>
                <div style="font-size:10px;color:var(--ink3)">코드: ${esc(c.code)}</div>
              </div>
              <div style="font-size:13px;font-weight:800;color:var(--navy2);font-variant-numeric:tabular-nums;letter-spacing:.5px">${no}</div>
            </button>
            <button onclick="event.stopPropagation();empNoEditCode(${ci})"
              style="padding:0 10px;border:1.5px solid var(--bd);border-radius:10px;background:#fff;cursor:pointer;font-size:14px;transition:all .14s"
              onmouseover="this.style.borderColor='var(--navy2)';this.style.background='var(--nbg)'"
              onmouseout="this.style.borderColor='var(--bd)';this.style.background='#fff'"
              title="이름 편집">✏️</button>
          </div>`;
        }).join('')}
      </div>`;
  }

  modal.innerHTML=`<div style="background:#fff;border-radius:18px;padding:24px;min-width:320px;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
    <div style="font-size:15px;font-weight:800;color:var(--ink);margin-bottom:14px">사번 생성 — ${esc(emp.name||'이름없음')}</div>

    ${hasDetection?`<div style="background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;color:var(--ink3);margin-bottom:8px;letter-spacing:.5px">자동 감지된 정보</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span style="padding:4px 10px;border-radius:16px;font-size:11px;font-weight:700;background:${det.isOutsource?'#FEF3C7':'var(--nbg)'};color:${det.isOutsource?'#92400E':'var(--navy2)'};border:1px solid ${det.isOutsource?'#FCD34D':'var(--nbg2)'}">
          ${det.isOutsource?'아웃소싱':'직접고용'}${det.deptTxt?' ('+esc(det.deptTxt)+')':''}
        </span>
        <span style="padding:4px 10px;border-radius:16px;font-size:11px;font-weight:700;background:${det.isOffice?'#EDE9FE':'var(--gbg)'};color:${det.isOffice?'#5B21B6':'#065F46'};border:1px solid ${det.isOffice?'#DDD6FE':'#A7F3D0'}">
          ${det.isOffice?'사무직':'현장직'}${det.roleTxt?' ('+esc(det.roleTxt)+')':''}
        </span>
        <span style="padding:4px 10px;border-radius:16px;font-size:11px;font-weight:600;background:#E0F2FE;color:#0369A1;border:1px solid #BAE6FD">
          감지 코드: ${det.second} (${secondLabels[det.second]||det.second})
        </span>
      </div>
    </div>`:`<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:#92400E">⚠ 직종/소속 정보가 없어 전체 구분코드를 표시합니다</div>
    </div>`}

    ${selectionHtml}
    <button onclick="document.getElementById('empno-modal').remove()"
      style="margin-top:12px;width:100%;padding:8px;font-size:11px;border:1px solid var(--bd2);border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;color:var(--ink3)">취소</button>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
}

// 시설유형 이름 인라인 편집 (감지 모드)
function empNoEditFacility(firstChar){
  if(!POL.empNoCodes)POL.empNoCodes=[...EMPNO_CODES_DEFAULT.map(c=>({...c}))];
  // 해당 시설유형의 첫 번째 코드를 찾아서 label의 시설명 부분을 편집
  const idx=POL.empNoCodes.findIndex(c=>c.code&&c.code[0]===firstChar);
  if(idx===-1)return;
  const oldLabel=POL.empNoCodes[idx].label.split('·')[0].trim();
  const newName=prompt('시설유형 이름 편집',oldLabel);
  if(newName===null||!newName.trim())return;
  // 같은 첫째 자리를 가진 모든 코드의 시설명 일괄 변경
  POL.empNoCodes.forEach(c=>{
    if(c.code&&c.code[0]===firstChar){
      const parts=c.label.split('·');
      parts[0]=newName.trim()+' ';
      c.label=parts.join('·');
    }
  });
  saveLS();
  // 모달 닫고 다시 열어서 반영
  const modal=document.getElementById('empno-modal');
  if(modal){
    const eid=modal.dataset.empId;
    modal.remove();
    if(eid)showGenEmpNo(parseInt(eid));
  }
}
// 개별 코드 라벨 인라인 편집 (전체 표시 모드)
function empNoEditCode(ci){
  if(!POL.empNoCodes)POL.empNoCodes=[...EMPNO_CODES_DEFAULT.map(c=>({...c}))];
  const c=POL.empNoCodes[ci];
  if(!c)return;
  const newLabel=prompt('구분코드 이름 편집',c.label);
  if(newLabel===null||!newLabel.trim())return;
  c.label=newLabel.trim();
  saveLS();
  const modal=document.getElementById('empno-modal');
  if(modal){
    const eid=modal.dataset.empId;
    modal.remove();
    if(eid)showGenEmpNo(parseInt(eid));
  }
}

function confirmGenEmpNo(empId, empNo){
  const emp=EMPS.find(e=>e.id===empId);
  if(!emp)return;
  emp.empNo=empNo;
  saveLS();renderEmps();renderSb();
}
function setLeave(id){
  const existing=document.getElementById('leave-modal');
  if(existing)existing.remove();
  const today=new Date().toISOString().slice(0,10);
  const modal=document.createElement('div');
  modal.id='leave-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML=`<div style="background:var(--surface);border-radius:16px;padding:24px 28px;min-width:300px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
    <div style="font-size:15px;font-weight:700;color:#1C2B3A;margin-bottom:6px">퇴사 처리</div>
    <div style="font-size:11px;color:#8896A5;margin-bottom:14px">퇴사일을 선택하세요</div>
    <input type="date" id="leave-date-inp" value="${today}"
      style="width:100%;padding:9px 12px;font-size:14px;border:1.5px solid #C8D6E5;border-radius:9px;font-family:inherit;color:#1C2B3A;margin-bottom:16px">
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('leave-modal').remove()"
        style="padding:8px 16px;font-size:12px;border:1px solid #C8D6E5;border-radius:8px;background:var(--surface);cursor:pointer;font-family:inherit">취소</button>
      <button onclick="confirmLeave(${id})"
        style="padding:8px 18px;font-size:12px;border:none;border-radius:8px;background:#C0392B;color:#fff;cursor:pointer;font-family:inherit;font-weight:700">퇴사 처리</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
}
function confirmLeave(id){
  const inp=document.getElementById('leave-date-inp');
  if(!inp||!inp.value)return;
  const e=EMPS.find(x=>x.id===id);if(!e)return;
  e.leave=inp.value;
  document.getElementById('leave-modal').remove();
  saveLS();renderEmps();renderSb();
}
function cancelLeave(id){
  const e=EMPS.find(x=>x.id===id);if(!e)return;
  e.leave='';
  saveLS();renderEmps();renderSb();
}
function rmE(id){
  const emp=EMPS.find(e=>e.id===id);
  if(!emp)return;
  const nm = emp.name || '이름없음';
  if(!confirm(`"${nm}" 직원을 삭제하시겠습니까?\n\n이 직원의 출퇴근·급여·연차·수당 이력이 화면에서 사라집니다.\n\n※ 복구가 필요하면 관리자에게 문의 (감사 로그에 기록은 남습니다)`))return;
  if(!confirm(`⚠️ 최종 확인\n\n"${nm}" 을(를) 정말 삭제할까요?`))return;
  EMPS=EMPS.filter(e=>e.id!==id);
  saveLS();
  // 다른 기기에 30초 폴링을 기다리지 않고 즉시 반영
  if(typeof flushPendingSave==='function') flushPendingSave();
  renderEmps();renderSb();renderTable();
}
function rmAllEmps(){
  // 🛡️ 2026-04-23 사고 이후 "전직원 일괄 삭제" 비활성화.
  // 데이터 유실 방지 가드를 우회하는 유일한 경로였으므로 제거됨.
  // 전직원 삭제가 필요하면 직원 한 명씩 개별 삭제하거나 관리자 문의.
  alert('전직원 일괄 삭제 기능은 비활성화되었습니다.\n\n데이터 유실 방지를 위해 직원은 한 명씩 개별 삭제해주세요.\n필요 시 관리자에게 문의하세요.');
}

// ══════════════════════════════════════
// 정책 설정
// ══════════════════════════════════════
function setBasePay(m){
  POL.basePayMode=m;
  ['fixed','hourly','monthly','pohal'].forEach(x=>{const el=document.getElementById('rb-base-'+x);if(el)el.classList.toggle('on',x===m);});
  const badge=document.getElementById('mode-badge');
  const sotRow=document.getElementById('sr-sot');
  const juhyuTgl=document.getElementById('tgl-juhyu');
  const juhyuSs=document.getElementById('juhyu-ss');
  const prem=document.getElementById('premium-settings');
  const pohalInfo=document.getElementById('pohal-info');
  const monthlyRow=document.getElementById('sr-base-monthly');
  const infoEl=document.getElementById('base-pay-info');
  if(m==='fixed'){
    if(badge){badge.className='mode-badge mode-fixed';badge.textContent='통상임금제';}
    if(sotRow)sotRow.style.display='flex';
    if(juhyuTgl)juhyuTgl.classList.add('dis');
    if(juhyuSs){juhyuSs.textContent='통상임금제: 주휴 이미 209h에 포함';juhyuSs.style.color='var(--amber)';}
    if(prem)prem.style.display='block';if(pohalInfo)pohalInfo.style.display='none';
    if(monthlyRow)monthlyRow.style.display='none';
    if(infoEl){infoEl.textContent='통상임금제: 기본급=시급×209h / 야간·연장·휴일 가산 별도';infoEl.className='info green';}
    const rr=document.getElementById('sr-base-rate');if(rr)rr.style.display='flex';
  } else if(m==='hourly'){
    if(badge){badge.className='mode-badge mode-daily';badge.textContent='시급제';}
    if(sotRow)sotRow.style.display='none';
    if(juhyuTgl)juhyuTgl.classList.remove('dis');
    if(juhyuSs){juhyuSs.textContent='주 15h 이상, 해당 주 개근 시';juhyuSs.style.color='';}
    if(prem)prem.style.display='block';if(pohalInfo)pohalInfo.style.display='none';
    if(monthlyRow)monthlyRow.style.display='none';
    if(infoEl){infoEl.textContent='시급제: 실근무×시급 / 야간 ×1.5배 전체';infoEl.className='info';}
    const rr2=document.getElementById('sr-base-rate');if(rr2)rr2.style.display='flex';
  } else if(m==='monthly'){
    if(badge){badge.className='mode-badge mode-pohal';badge.textContent='월급제';}
    if(sotRow)sotRow.style.display='none';
    if(juhyuTgl)juhyuTgl.classList.add('dis');
    if(juhyuSs){juhyuSs.textContent='월급제: 주휴 월급에 포함';juhyuSs.style.color='var(--amber)';}
    if(prem)prem.style.display='block';if(pohalInfo)pohalInfo.style.display='none';
    if(monthlyRow)monthlyRow.style.display='flex';
    if(infoEl){infoEl.textContent='월급제: 월급 고정 / 휴일출근 시 1.5배(8h이내)·2배(초과)';infoEl.className='info green';}
    const rr4=document.getElementById('sr-base-rate');if(rr4)rr4.style.display='none';
    const mr=document.getElementById('sr-base-monthly');if(mr)mr.style.display='flex';
  } else {
    if(badge){badge.className='mode-badge mode-pohal';badge.textContent='포괄임금제';}
    if(sotRow)sotRow.style.display='none';
    if(juhyuTgl)juhyuTgl.classList.add('dis');
    if(juhyuSs){juhyuSs.textContent='포괄임금제: 주휴 월급에 포함';juhyuSs.style.color='var(--amber)';}
    if(prem)prem.style.display='none';if(pohalInfo)pohalInfo.style.display='block';
    if(monthlyRow)monthlyRow.style.display='flex';
    if(infoEl){infoEl.textContent='포괄임금제: 월급 고정, 가산수당 없음';infoEl.className='info amber';}
    const rr3=document.getElementById('sr-base-rate');if(rr3)rr3.style.display='none';
  }
  setTimeout(updNotes,0);
}
function setSize(s){POL.size=s;['u5','o5'].forEach(x=>{const el=document.getElementById('rb-'+x);if(el)el.classList.toggle('on',x===s);});const aw=document.getElementById('set-aw');if(s==='o5'){aw.style.display='flex';document.getElementById('set-aw-msg').textContent='5인 이상: 가산수당 50% 의무 (근기법 제56조)';}else aw.style.display='none';}
function onJuhyu(){POL.juhyu=document.getElementById('tog-juhyu').checked;}
function showLawModal(){
  const existing=document.getElementById('law-modal');
  if(existing){existing.remove();return;}
  const rate=POL.baseRate||11750;
  const modal=document.createElement('div');
  modal.id='law-modal';
  modal.className='law-modal-bg';
  modal.innerHTML=`
  <div class="law-modal">
    <div class="law-modal-title">📖 법정 가산수당 기준 (근로기준법 제56조)</div>
    <div class="law-modal-sub">5인 이상 사업장 의무 적용 · 시급 ${(rate).toLocaleString()}원 기준 예시</div>
    <div class="law-case">
      <div class="law-case-title"><span style="background:var(--teal-dim);color:#1E40AF;padding:2px 8px;border-radius:6px;font-size:11px">사례 1</span> 평일 주간 10시간 근무</div>
      <div class="law-row"><span style="color:var(--ink2)">기본 8h</span><span><span class="law-tag" style="background:var(--teal-dim);color:#1E40AF">기본 ×1.0</span></span><span style="color:var(--ink)">${(rate*8).toLocaleString()}원</span></div>
      <div class="law-row"><span style="color:var(--ink2)">연장 2h (8h 초과)</span><span><span class="law-tag" style="background:#EDE9FE;color:#4C1D95">연장 ×1.5</span></span><span style="color:var(--ink)">${(rate*1.5*2).toLocaleString()}원</span></div>
      <div class="law-row"><span>합계</span><span></span><span class="law-result">${(rate*8+rate*1.5*2).toLocaleString()}원</span></div>
    </div>
    <div class="law-case">
      <div class="law-case-title"><span style="background:#FFF0F3;color:#9D174D;padding:2px 8px;border-radius:6px;font-size:11px">사례 2</span> 공휴일 10시간 근무 (주간)</div>
      <div class="law-row"><span style="color:var(--ink2)">휴일 8h 이내</span><span><span class="law-tag" style="background:#FFF0F3;color:#9D174D">기본+휴일 ×1.5</span></span><span style="color:var(--ink)">${(rate*1.5*8).toLocaleString()}원</span></div>
      <div class="law-row"><span style="color:var(--ink2)">휴일 2h 초과 (8h↑)</span><span><span class="law-tag" style="background:#FEE2E2;color:#991B1B">기본+휴일+연장 ×2.0</span></span><span style="color:var(--ink)">${(rate*2.0*2).toLocaleString()}원</span></div>
      <div class="law-row"><span>합계</span><span></span><span class="law-result">${(rate*1.5*8+rate*2.0*2).toLocaleString()}원</span></div>
    </div>
    <div class="law-case">
      <div class="law-case-title"><span style="background:var(--abg);color:#92400E;padding:2px 8px;border-radius:6px;font-size:11px">사례 3</span> 공휴일 야간 10시간 (22:00~08:00) ← 최대</div>
      <div class="law-row"><span style="color:var(--ink2)">휴일 주간 구간</span><span><span class="law-tag" style="background:#FFF0F3;color:#9D174D">휴일 ×1.5</span></span><span style="color:var(--ink3);font-size:11px">기본+휴일</span></div>
      <div class="law-row"><span style="color:var(--ink2)">야간 가산 (22~06시)</span><span><span class="law-tag" style="background:var(--abg);color:#92400E">+0.5 추가</span></span><span style="color:var(--ink3);font-size:11px">→ 합계 ×2.0</span></div>
      <div class="law-row"><span style="color:var(--ink2)">8h 초과 연장 구간</span><span><span class="law-tag" style="background:#FEE2E2;color:#991B1B">+0.5 추가</span></span><span style="color:var(--ink3);font-size:11px">→ 합계 ×2.5</span></div>
      <div class="law-row"><span style="font-size:12px">법정 최대 배율</span><span></span><span style="color:var(--rose);font-size:16px;font-weight:700">× 2.5배</span></div>
    </div>
    <div style="background:var(--abg);border:1px solid #FCD34D;border-radius:10px;padding:10px 13px;margin-top:4px;font-size:11px;color:var(--amber);line-height:1.7">
      <strong>단일(1.5배) vs 법정(2.0배) 차이</strong><br>
      단일: 야간·연장·휴일 중복 관계없이 최대 1.5배 고정<br>
      법정: 중복 적용 → 최대 2.5배까지 가능 (5인 이상 의무)
    </div>
    <button onclick="document.getElementById('law-modal').remove()"
      style="margin-top:16px;width:100%;padding:10px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
      확인
    </button>
  </div>`;
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
  document.body.appendChild(modal);
}
function setDupMode(m){POL.dupMode=m;['legal','single'].forEach(x=>{const el=document.getElementById('rb-dup-'+x);if(el)el.classList.toggle('on',x===m);});updNotes();}
function setDedMode(m){POL.dedMode=m;['hour','day'].forEach(x=>{const el=document.getElementById('rb-ded-'+x);if(el)el.classList.toggle('on',x===m);});}
function setAlMode(m){POL.alMode=m;['legal','custom'].forEach(x=>{const el=document.getElementById('rb-al-'+x);if(el)el.classList.toggle('on',x===m);});}

// ── 주말 요일 설정 ──
function setPremTab(t){
  ['fixed','hourly','monthly'].forEach(tab=>{
    const btn=document.getElementById('prem-tab-'+tab);
    const panel=document.getElementById('prem-panel-'+tab);
    if(btn) btn.className='btn btn-sm'+(tab===t?' btn-n':'');
    if(panel) panel.style.display=tab===t?'block':'none';
  });
}

function setWeekendDow(type){
  const containerId = type==='day'?'day-weekend-checks':'night-weekend-checks';
  const polKey = type==='day'?'dayWeekend':'nightWeekend';
  const checked=[];
  document.querySelectorAll(`#${containerId} input[type=checkbox]`).forEach(cb=>{
    if(cb.checked) checked.push(+cb.dataset.dow);
  });
  POL[polKey]=checked;
  saveLS();
}

function initWeekendChecks(){
  const dw = POL.dayWeekend || [0,6];
  const nw = POL.nightWeekend || [5,6];
  document.querySelectorAll('#day-weekend-checks input[type=checkbox]').forEach(cb=>{
    cb.checked = dw.includes(+cb.dataset.dow);
  });
  document.querySelectorAll('#night-weekend-checks input[type=checkbox]').forEach(cb=>{
    cb.checked = nw.includes(+cb.dataset.dow);
  });
}
function updNightLabel(){const h=+document.getElementById('sel-ns').value;POL.nightStart=h;updNotes();}
function updNotes(){
  const ext=document.getElementById('tog-ext')?.checked;
  const nt=document.getElementById('tog-nt')?.checked;
  const ot=document.getElementById('tog-ot')?.checked;
  const hol=document.getElementById('tog-hol')?.checked;
  const ntH=document.getElementById('tog-nt-hourly')?.checked;
  const otH=document.getElementById('tog-ot-hourly')?.checked;
  const holH=document.getElementById('tog-hol-hourly')?.checked;
  // POL에 즉시 반영
  if(ext!==undefined) POL.extFixed=ext;
  if(nt!==undefined) POL.ntFixed=nt;
  if(ot!==undefined) POL.otFixed=ot;
  if(hol!==undefined) POL.holFixed=hol;
  if(ntH!==undefined) POL.ntHourly=ntH;
  if(otH!==undefined) POL.otHourly=otH;
  if(holH!==undefined) POL.holHourly=holH;
  // 하위 호환: nt/ot/hol도 월고정 기준으로 동기화
  POL.nt=POL.ntFixed; POL.ot=POL.otFixed; POL.hol=POL.holFixed;
  // 월급제 토글 반영
  const holM=document.getElementById('tog-hol-monthly')?.checked;
  const holMStd=document.getElementById('tog-hol-monthly-std')?.checked;
  const holMOt=document.getElementById('tog-hol-monthly-ot')?.checked;
  const dedM=document.getElementById('tog-ded-monthly')?.checked;
  if(holM!==undefined) POL.holMonthly=holM;
  if(holMStd!==undefined) POL.holMonthlyStd=holMStd;
  if(holMOt!==undefined) POL.holMonthlyOt=holMOt;
  if(dedM!==undefined) POL.dedMonthly=dedM;
  const ns=+(document.getElementById('sel-ns')?.value||22);
  const dupStr=POL.dupMode==='single'?'단일 최대 1.5배':'법정 최대 2.0배';
  const c=v=>v?'var(--teal)':'var(--rose)';
  const elExt=document.getElementById('ext-note');if(elExt){elExt.textContent=(ext??true)?'ON: ×1.0 (평일초과·휴일전체)':'OFF';elExt.style.color=c(ext??true);}
  const el1=document.getElementById('nt-note');if(el1){el1.textContent=nt?`ON: ×0.5 추가 (${pad(ns)}:00~06:00)`:'OFF';el1.style.color=c(nt);}
  const el2=document.getElementById('ot-note');if(el2){el2.textContent=ot?'ON: ×0.5 추가 (8h초과 주간연장)':'OFF';el2.style.color=c(ot);}
  const el3=document.getElementById('hol-note');if(el3){el3.textContent=hol?'ON: ×0.5 추가 (휴일 전체)':'OFF';el3.style.color=c(hol);}
  const el1h=document.getElementById('nt-hourly-note');if(el1h){el1h.textContent=ntH?`ON: ×1.5배 전체 (${pad(ns)}:00~06:00)`:'OFF';el1h.style.color=c(ntH);}
  const el2h=document.getElementById('ot-hourly-note');if(el2h){el2h.textContent=otH?`ON: ×1.5배 / ${dupStr}`:'OFF';el2h.style.color=c(otH);}
  const el3h=document.getElementById('hol-hourly-note');if(el3h){el3h.textContent=holH?`ON: ×1.5배 / ${dupStr}`:'OFF';el3h.style.color=c(holH);}
  const el_hm=document.getElementById('hol-monthly-note');if(el_hm){el_hm.textContent=(holM??true)?'ON':'OFF';el_hm.style.color=c(holM??true);}
  const el_hms=document.getElementById('hol-monthly-std-note');if(el_hms){el_hms.textContent=(holMStd??true)?'ON: ×150%':'OFF';el_hms.style.color=c(holMStd??true);}
  const el_hmo=document.getElementById('hol-monthly-ot-note');if(el_hmo){el_hmo.textContent=(holMOt??true)?'ON: ×200%':'OFF';el_hmo.style.color=c(holMOt??true);}
  const el_dm=document.getElementById('ded-monthly-note');if(el_dm){el_dm.textContent=(dedM??true)?'ON: 월급÷평일수':'OFF';el_dm.style.color=c(dedM??true);}
  const holDetail=document.getElementById('hol-monthly-detail');
  if(holDetail){
    const parentOn = (holM??true);
    holDetail.style.opacity = parentOn ? '1' : '0.4';
    holDetail.style.pointerEvents = parentOn ? '' : 'none';
    // 부모가 OFF면 자식 토글을 실제로 disabled 처리 (클릭되는 척 방지)
    holDetail.querySelectorAll('input[type=checkbox]').forEach(cb=>{
      cb.disabled = !parentOn;
    });
  }
  const el4=document.getElementById('night-info');if(el4)el4.innerHTML=`야간: <strong>${pad(ns)}:00~06:00</strong> / 월고정 ×0.5추가 / 시급제 ×1.5배`;
  const el5=document.getElementById('th-nt');if(el5)el5.textContent=`${pad(ns)}~06시`;
}
function renderAllowanceList(){
  const tipMsg = '이 항목에 입력한 금액은 자동으로 마이너스(공제)로 계산됩니다. 총급여에서 해당 금액만큼 차감됩니다.';
  document.getElementById('allowance-list').innerHTML = POL.allowances.map((a, i) => {
    const isFixed = FIXED_ALLOWS.includes(a.name);
    const isDeduct = a.isDeduct === true;
    const bgStyle = isDeduct ? 'background:var(--rbg);border-color:#FECDD3;' : '';
    const nameColor = isFixed ? 'color:var(--navy2);font-weight:700' : isDeduct ? 'color:var(--rose);font-weight:600' : '';
    const rightBtn = isFixed
      ? '<span style="font-size:9px;color:var(--ink3);padding:2px 6px;background:var(--surf);border-radius:4px;white-space:nowrap">기본</span>'
      : '<button class="bk-del" onclick="delAllowance(' + i + ')">×</button>';
    const deductCtrl = isDeduct
      ? '<button class="tip-btn" onclick="showTip(' + "'공제 항목'" + ',' + "'" + tipMsg + "'" + ')" style="background:var(--rbg);color:var(--rose);width:22px;height:22px">💡</button>'
      : '<label style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--ink3);cursor:pointer;white-space:nowrap"><input type="checkbox"' + (isDeduct ? ' checked' : '') + ' onchange="POL.allowances[' + i + '].isDeduct=this.checked;saveLS();renderAllowanceList();renderPayroll()">공제</label>';
    return '<div class="allowance-item" style="' + bgStyle + '">'
      + '<input class="allowance-name" value="' + a.name + '" placeholder="수당 이름" style="' + nameColor + '" onchange="POL.allowances[' + i + '].name=this.value;saveLS()">'
      + deductCtrl
      + rightBtn
      + '</div>';
  }).join('');
}

async function addAllowance(isDeduct=false){
  POL.allowances.push({id:'custom_'+Date.now(),name:isDeduct?'새 공제항목':'새 수당',isDeduct:isDeduct});
  saveLS();
  renderAllowanceList();renderPayroll();
  await flushPendingSave();  // DB 반영 완료까지 대기
}
async function delAllowance(i){
  POL.allowances.splice(i,1);
  saveLS();
  renderAllowanceList();renderPayroll();
  await flushPendingSave();
}
function renderDefBk(){
  const MINS=[0,5,10,15,20,25,30,35,40,45,50,55];
  const mkHO=s=>Array.from({length:24},(_,h)=>`<option value="${h}"${h==s?' selected':''}>${pad(h)}</option>`).join('');
  const mkMO=s=>MINS.map(m=>`<option value="${m}"${m==s?' selected':''}>${pad(m)}</option>`).join('');
  // shift 드롭다운: 'all'(전체) | 'day'(주간) | 'night'(야간) — 기존 데이터에 shift 필드 없으면 'all'로 처리
  const mkShiftO=s=>{
    const cur = s || 'all';
    return `<option value="all"${cur==='all'?' selected':''}>전체</option>`+
           `<option value="day"${cur==='day'?' selected':''}>주간</option>`+
           `<option value="night"${cur==='night'?' selected':''}>야간</option>`;
  };
  const shiftLabel = {all:'전체', day:'주간', night:'야간'};
  const shiftBg = {all:'#F5F5F7', day:'#FEF3C7', night:'#E0E7FF'};
  document.getElementById('def-bk').innerHTML=DEF_BK.map((b,i)=>{
    const[sh,sm]=(b.start||'12:00').split(':').map(Number);const[eh,em]=(b.end||'13:00').split(':').map(Number);
    const sft = b.shift || 'all';
    return`<div style="display:flex;align-items:center;gap:5px;padding:5px 8px;background:${shiftBg[sft]||'var(--surf)'};border:1px solid var(--bd);border-radius:7px">
      <span class="bk-lbl">세트${i+1}</span>
      <select class="bs" style="font-weight:600;min-width:54px" onchange="updDefBkShift(${i},this.value)" title="이 세트가 적용될 직원 분류">${mkShiftO(sft)}</select>
      <select class="bs" onchange="updDefBkH(${i},'start',this.value)">${mkHO(sh)}</select>:
      <select class="bs" onchange="updDefBkM(${i},'start',this.value)">${mkMO(sm)}</select>~
      <select class="bs" onchange="updDefBkH(${i},'end',this.value)">${mkHO(eh)}</select>:
      <select class="bs" onchange="updDefBkM(${i},'end',this.value)">${mkMO(em)}</select>
      <button class="bk-del" onclick="delDefBk(${i})">×</button>
    </div>`;}).join('');
}
function updDefBkShift(i, v){
  if(!DEF_BK[i]) return;
  const allowed = ['all','day','night'];
  DEF_BK[i].shift = allowed.includes(v) ? v : 'all';
  saveLS();
  renderDefBk();
}
function updDefBkH(i,f,v){
  const mn=DEF_BK[i][f].split(':')[1];
  const newVal=`${pad(+v)}:${mn}`;
  DEF_BK[i][f]=newVal;saveLS();
}
function updDefBkM(i,f,v){
  const hr=DEF_BK[i][f].split(':')[0];
  const newVal=`${hr}:${pad(+v)}`;
  DEF_BK[i][f]=newVal;saveLS();
}
function addDefBk(){DEF_BK.push({id:bkNid++,shift:'all',start:'12:00',end:'13:00'});saveLS();renderDefBk();}
// 🛡️ 마지막 1개 세트는 삭제 차단 — DEF_BK가 빈 배열이 되면 모든 직원 휴게시간이 0으로 계산됨
function delDefBk(i){
  if(!Array.isArray(DEF_BK)) return;
  if(DEF_BK.length <= 1){
    alert('기본 휴게세트는 최소 1개가 필요합니다.\n전부 삭제하려면 시간을 0으로 설정하세요.');
    return;
  }
  DEF_BK.splice(i,1);
  saveLS();
  renderDefBk();
}
// ── 정책설정 카드 수정/완료 ──

// askChangeDate 완료 후 버튼 복원
const _origApply = typeof applyChangeDate === 'function' ? applyChangeDate : null;


// ══════════════════════════════════════
// 📁 파일 스토리지 헬퍼 (Supabase Storage)
// ══════════════════════════════════════
const _fileUrlCache = {};
async function getFileUrls(paths) {
  if (!paths.length) return {};
  const now = Date.now();
  const uncached = paths.filter(p => !_fileUrlCache[p] || _fileUrlCache[p].expires < now);
  if (uncached.length > 0) {
    try {
      const res = await apiFetch('/file-url', 'POST', { paths: uncached });
      Object.entries(res.urls || {}).forEach(([path, url]) => {
        _fileUrlCache[path] = { url, expires: now + 50 * 60 * 1000 };
      });
    } catch (e) { console.warn('File URL fetch failed:', e); }
  }
  const result = {};
  paths.forEach(p => { if (_fileUrlCache[p]) result[p] = _fileUrlCache[p].url; });
  return result;
}

async function uploadFileToStorage(file, category, categoryId) {
  let processedFile = file;
  if (file.type.startsWith('image/') && file.size > 800 * 1024) {
    processedFile = await compressImage(file);
  }
  const base64 = await fileToBase64(processedFile);
  const res = await apiFetch('/file-upload', 'POST', {
    fileName: file.name,
    fileData: base64,
    fileType: processedFile.type || file.type || 'application/octet-stream',
    category,
    categoryId: String(categoryId || 'general')
  });
  return res;
}

async function deleteFileFromStorage(path) {
  if (!path) return;
  try { await apiFetch('/file-delete', 'POST', { path }); } catch (e) { console.warn('File delete failed:', e); }
}

function fileToBase64(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function compressImage(file, maxWidth = 1920, quality = 0.82) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w <= maxWidth && file.size <= 1.5 * 1024 * 1024) { URL.revokeObjectURL(img.src); resolve(file); return; }
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(img.src);
        if (blob) resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        else resolve(file);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); resolve(file); };
    img.src = URL.createObjectURL(file);
  });
}

function loadStorageImages(container) {
  const imgs = container.querySelectorAll('img[data-spath]');
  if (!imgs.length) return;
  const paths = Array.from(imgs).map(img => img.dataset.spath);
  getFileUrls(paths).then(urls => {
    imgs.forEach(img => {
      const url = urls[img.dataset.spath];
      if (url) {
        img.onerror = () => { img.style.opacity = '0.2'; img.alt = '파일 없음'; img.onerror = null; };
        img.src = url; img.style.opacity = '1';
      } else {
        img.style.opacity = '0.2'; img.alt = '파일 없음';
      }
    });
  });
}

// ══════════════════════════════════════
// 📁 폴더 관리
// ══════════════════════════════════════
let FOLDERS = JSON.parse(localStorage.getItem('npm5_folders')||'[]');
// 구조: [{id, name, parentId:null|id, files:[{name,storagePath,size,type,date}], open:bool}]

// localStorage에는 base64(dataUrl) 제거 후 메타데이터만 저장
function saveFolders(){
  const slim = FOLDERS.map(f=>({
    ...f,
    files:(f.files||[]).map(({dataUrl, ...rest})=>rest)
  }));
  try{localStorage.setItem('npm5_folders',JSON.stringify(slim));}
  catch(e){console.warn('폴더 저장 용량 초과, 정리 중...');
    // 그래도 실패하면 파일 메타만 최소한으로
    const minimal=slim.map(f=>({id:f.id,name:f.name,parentId:f.parentId,open:f.open,
      files:(f.files||[]).map(x=>({id:x.id,name:x.name,storagePath:x.storagePath,size:x.size,type:x.type,date:x.date}))}));
    try{localStorage.setItem('npm5_folders',JSON.stringify(minimal));}catch(e2){console.error('폴더 저장 실패',e2);}
  }
}
// 기존 base64 데이터 정리 (최초 1회)
(function cleanLegacyFolders(){
  let cleaned=false;
  FOLDERS.forEach(f=>{(f.files||[]).forEach(file=>{
    if(file.dataUrl){delete file.dataUrl;cleaned=true;}
  });});
  if(cleaned){saveFolders();console.log('레거시 base64 폴더 데이터 정리 완료');}
})();

function showFolderInput(title, defaultVal, onConfirm){
  // 기존 모달 제거
  const existing = document.getElementById('folder-input-modal');
  if(existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'folder-input-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;width:320px;box-shadow:0 20px 60px rgba(0,0,0,.2)">
      <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:14px">${title}</div>
      <input id="folder-name-inp" type="text" value="${defaultVal}"
        style="width:100%;padding:9px 12px;border:1.5px solid var(--bd2);border-radius:9px;font-size:13px;font-family:inherit;outline:none;margin-bottom:14px"
        onfocus="this.style.borderColor='var(--navy2)'" onblur="this.style.borderColor='var(--bd2)'"
        onkeydown="if(event.key==='Enter')document.getElementById('folder-confirm-btn').click()">
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('folder-input-modal').remove()"
          style="flex:1;padding:9px;border:1.5px solid var(--bd2);border-radius:8px;background:#fff;font-size:13px;cursor:pointer;font-weight:600;color:var(--ink3)">취소</button>
        <button id="folder-confirm-btn"
          style="flex:1;padding:9px;border:none;border-radius:8px;background:var(--navy);font-size:13px;cursor:pointer;font-weight:700;color:#fff">확인</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const inp = document.getElementById('folder-name-inp');
  inp.select(); inp.focus();
  document.getElementById('folder-confirm-btn').onclick = () => {
    const val = inp.value.trim();
    if(!val) return;
    modal.remove();
    onConfirm(val);
  };
}

function addRootFolder(){
  showFolderInput('📁 폴더 이름', '새 폴더', (name)=>{
    FOLDERS.push({id:Date.now(),name,parentId:null,files:[],open:true});
    saveFolders(); renderFolder();
  });
}

function addSubFolder(parentId){
  showFolderInput('📁 하위 폴더 이름', '새 폴더', (name)=>{
    FOLDERS.push({id:Date.now(),name,parentId,files:[],open:true});
    saveFolders(); renderFolder();
  });
}

function toggleFolder(id){
  const f=FOLDERS.find(f=>f.id===id);
  if(f) f.open=!f.open;
  saveFolders(); renderFolder();
}

function renameFolder(id){
  const f=FOLDERS.find(x=>x.id===id);
  if(!f) return;
  showFolderInput('✏️ 폴더 이름 변경', f.name, (name)=>{
    f.name=name;
    saveFolders(); renderFolder();
  });
}

function deleteFolder(id){
  const folder=FOLDERS.find(f=>f.id===id);
  if(!folder) return;
  const toDelete=[id];
  let changed=true;
  while(changed){
    changed=false;
    FOLDERS.forEach(f=>{if(!toDelete.includes(f.id)&&toDelete.includes(f.parentId)){toDelete.push(f.id);changed=true;}});
  }
  const subCount=toDelete.length-1;
  const fileCount=FOLDERS.filter(f=>toDelete.includes(f.id)).reduce((n,f)=>n+((f.files||[]).length),0);
  const detail=(subCount||fileCount)?`\n\n하위 폴더 ${subCount}개, 파일 ${fileCount}개가 함께 삭제됩니다.`:'';
  if(!confirm(`"${folder.name||'이름없음'}" 폴더를 삭제하시겠습니까?${detail}`)) return;
  if(!confirm(`⚠️ 최종 확인\n\n폴더와 파일은 복구할 수 없습니다. 정말 삭제할까요?`)) return;
  // 삭제 대상 폴더의 파일들을 스토리지에서도 삭제
  const storagePaths=[];
  FOLDERS.filter(f=>toDelete.includes(f.id)).forEach(f=>{
    (f.files||[]).forEach(file=>{if(file.storagePath) storagePaths.push(file.storagePath);});
  });
  if(storagePaths.length) apiFetch('/file-delete','POST',{paths:storagePaths}).catch(e=>console.warn(e));
  FOLDERS=FOLDERS.filter(f=>!toDelete.includes(f.id));
  saveFolders(); renderFolder();
}

function uploadFile(folderId){
  const input=document.createElement('input');
  input.type='file'; input.multiple=true;
  input.onchange=async()=>{
    const folder=FOLDERS.find(f=>f.id===folderId);
    if(!folder) return;
    if(typeof showSyncToast==='function') showSyncToast('파일 업로드 중...','info');
    for(const file of Array.from(input.files)){
      try{
        const res=await uploadFileToStorage(file,'folder',folderId);
        folder.files.push({
          id:Date.now()+Math.random(),
          name:file.name,
          storagePath:res.path,
          size:res.size||file.size,
          type:file.type,
          date:new Date().toLocaleDateString('ko-KR')
        });
        saveFolders();
      }catch(e){
        console.error('Upload failed:',e);
        if(typeof showSyncToast==='function') showSyncToast(file.name+' 업로드 실패','warn');
      }
    }
    if(typeof showSyncToast==='function') showSyncToast('업로드 완료','ok');
    renderFolder();
  };
  input.click();
}

async function downloadFile(folderId, fileId){
  const folder=FOLDERS.find(f=>f.id===folderId);
  if(!folder) return;
  const file=folder.files.find(f=>f.id===fileId);
  if(!file) return;
  if(file.dataUrl){
    const a=document.createElement('a');
    a.href=file.dataUrl; a.download=file.name; a.click();
    return;
  }
  if(file.storagePath){
    try{
      const urls=await getFileUrls([file.storagePath]);
      const url=urls[file.storagePath];
      if(url){const a=document.createElement('a');a.href=url;a.download=file.name;a.target='_blank';a.click();}
    }catch(e){if(typeof showSyncToast==='function') showSyncToast('다운로드 실패','warn');}
  }
}

async function previewFile(folderId, fileId){
  const folder=FOLDERS.find(f=>f.id===folderId);
  if(!folder) return;
  const file=folder.files.find(f=>f.id===fileId);
  if(!file) return;
  let url=file.dataUrl||'';
  if(file.storagePath){
    const urls=await getFileUrls([file.storagePath]);
    url=urls[file.storagePath]||'';
  }
  if(!url||/^javascript:/i.test(url)) return;
  const safeUrl=esc(url);
  const lb=document.createElement('div');
  lb.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(4px)';
  if(file.type&&file.type.startsWith('image/')){
    lb.innerHTML=`<img src="${safeUrl}" style="max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.4)">`;
  }else{
    lb.innerHTML=`<div style="background:#fff;border-radius:16px;padding:32px;text-align:center;max-width:400px">
      <div style="font-size:48px;margin-bottom:12px">${getFileIcon(file.type)}</div>
      <div style="font-size:14px;font-weight:700;margin-bottom:8px">${esc(file.name)}</div>
      <div style="font-size:12px;color:#666;margin-bottom:16px">${fmtSize(file.size)}</div>
      <a href="${safeUrl}" download="${esc(file.name)}" target="_blank" onclick="event.stopPropagation()"
        style="display:inline-block;padding:10px 24px;background:var(--navy);color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">다운로드</a>
    </div>`;
  }
  lb.addEventListener('click',e=>{if(e.target===lb)lb.remove();});
  document.body.appendChild(lb);
}

function deleteFile(folderId, fileId){
  const folder=FOLDERS.find(f=>f.id===folderId);
  if(!folder) return;
  const file=folder.files.find(f=>f.id===fileId);
  if(file&&file.storagePath) deleteFileFromStorage(file.storagePath);
  folder.files=folder.files.filter(f=>f.id!==fileId);
  saveFolders(); renderFolder();
}

function fmtSize(bytes){
  if(bytes<1024) return bytes+'B';
  if(bytes<1024*1024) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/1024/1024).toFixed(1)+'MB';
}

function getFileIcon(type){
  if(!type) return '📄';
  if(type.includes('image')) return '🖼️';
  if(type.includes('pdf')) return '📕';
  if(type.includes('spreadsheet')||type.includes('excel')||type.endsWith('xlsx')||type.endsWith('xls')) return '📊';
  if(type.includes('word')||type.endsWith('docx')) return '📝';
  if(type.includes('zip')||type.includes('compressed')) return '🗜️';
  return '📄';
}

function renderFolderNode(folderId, depth=0){
  // 레거시 - 사용 안 함 (renderFolder에서 직접 처리)
  return '';
}

// ── 현재 열려있는 폴더 ID (null=루트) ──
let currentFolderId = null;

function openFolder(folderId){
  currentFolderId = folderId;
  renderFolder();
}

function goUp(){
  if(currentFolderId===null) return;
  const cur = FOLDERS.find(f=>f.id===currentFolderId);
  currentFolderId = cur ? cur.parentId : null;
  renderFolder();
}

function renderFolder(){
  const body = document.getElementById('folder-body');
  if(!body) return;

  const cur = currentFolderId ? FOLDERS.find(f=>f.id===currentFolderId) : null;

  // ── 브레드크럼 경로 ──
  function getBreadcrumb(folderId){
    const path = [];
    let id = folderId;
    while(id){
      const f = FOLDERS.find(x=>x.id===id);
      if(!f) break;
      path.unshift(f);
      id = f.parentId;
    }
    return path;
  }
  const breadcrumb = currentFolderId ? getBreadcrumb(currentFolderId) : [];

  const breadcrumbHtml = `
    <div style="display:flex;align-items:center;gap:4px;margin-bottom:16px;flex-wrap:wrap">
      <span onclick="openFolder(null)" style="font-size:12px;font-weight:600;color:${currentFolderId?'var(--navy2)':'var(--ink)'};cursor:${currentFolderId?'pointer':'default'};padding:4px 8px;border-radius:6px;${currentFolderId?'hover:background:var(--nbg)':''}">
        🏠 폴더 관리
      </span>
      ${breadcrumb.map((f,i)=>`
        <span style="color:var(--ink3);font-size:11px">›</span>
        <span onclick="openFolder(${f.id})" style="font-size:12px;font-weight:600;color:${i===breadcrumb.length-1?'var(--ink)':'var(--navy2)'};cursor:${i===breadcrumb.length-1?'default':'pointer'};padding:4px 8px;border-radius:6px">
          ${f.name}
        </span>
      `).join('')}
    </div>`;

  // 현재 폴더 안의 하위 폴더들
  const subFolders = FOLDERS.filter(f=>f.parentId===currentFolderId);
  // 현재 폴더의 파일들
  const files = cur ? (cur.files||[]) : [];

  // ── 빈 상태 ──
  if(subFolders.length===0 && files.length===0){
    // 상단 버튼 업데이트
    const addBtn0 = document.querySelector('#pg-folder .btn-n');
    if(addBtn0){
      if(currentFolderId){ addBtn0.onclick=()=>addSubFolder(currentFolderId); addBtn0.textContent='+ 하위 폴더 추가'; }
      else { addBtn0.onclick=addRootFolder; addBtn0.textContent='+ 폴더 추가'; }
    }
    body.innerHTML = breadcrumbHtml + `
      <div style="text-align:center;padding:40px 20px 24px;color:var(--ink3)">
        <div style="font-size:48px;margin-bottom:10px">📁</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px;color:var(--ink2)">
          ${currentFolderId ? '이 폴더가 비어 있습니다' : '폴더가 없습니다'}
        </div>
        <div style="font-size:12px;margin-bottom:16px">폴더나 파일을 추가해보세요</div>
        ${currentFolderId ? `
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="addSubFolder(${currentFolderId})" style="color:var(--navy2);border-color:var(--navy2)">📁 하위 폴더 추가</button>
          <button class="btn btn-n btn-sm" onclick="uploadFile(${currentFolderId})">⬆️ 파일 업로드</button>
        </div>` : ''}
      </div>`;
    return;
  }

  // 상단 버튼 업데이트
  const addBtn = document.querySelector('#pg-folder .btn-n');
  if(addBtn){
    if(currentFolderId){
      addBtn.onclick = ()=>addSubFolder(currentFolderId);
      addBtn.textContent = '+ 하위 폴더 추가';
    } else {
      addBtn.onclick = addRootFolder;
      addBtn.textContent = '+ 폴더 추가';
    }
  }

  // ── 폴더 그리드 ──
  const foldersHtml = subFolders.length > 0 ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:20px">
      ${subFolders.map(f=>`
        <div onclick="openFolder(${f.id})"
          style="background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px 14px;cursor:pointer;transition:all .15s;text-align:center;position:relative"
          onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.1)';this.style.borderColor='var(--navy2)'"
          onmouseout="this.style.boxShadow='';this.style.borderColor='var(--bd)'">
          <div style="font-size:32px;margin-bottom:8px">📁</div>
          <div style="font-size:12px;font-weight:700;color:var(--ink);margin-bottom:4px;word-break:break-all">${f.name}</div>
          <div style="font-size:10px;color:var(--ink3)">${FOLDERS.filter(x=>x.parentId===f.id).length}개 폴더 · ${(f.files||[]).length}개 파일</div>
          <div style="position:absolute;top:8px;right:8px;display:flex;gap:3px" onclick="event.stopPropagation()">
            <button class="btn btn-xs" onclick="addSubFolder(${f.id})" title="하위 폴더">+</button>
            <button class="btn btn-xs" onclick="uploadFile(${f.id})" title="업로드">⬆</button>
            <button class="btn btn-xs" onclick="renameFolder(${f.id})" title="이름변경">✏️</button>
            <button class="btn btn-xs" onclick="deleteFolder(${f.id})" title="삭제" style="color:var(--rose)">🗑</button>
          </div>
        </div>
      `).join('')}
    </div>` : '';

  // ── 파일 목록 ──
  // 파일 섹션 (항상 표시 - 파일 없어도 업로드 가능)
  const filesHtml = currentFolderId ? `
    <div style="background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow:hidden;margin-top:${subFolders.length>0?'0':'0'}">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:rgba(0,0,0,.02);border-bottom:1px solid var(--bd)">
        <span style="font-size:11px;font-weight:700;color:var(--ink3);letter-spacing:.4px;text-transform:uppercase">파일 ${files.length}개</span>
        <button class="btn btn-sm btn-n" onclick="uploadFile(${currentFolderId})" style="font-size:11px;padding:4px 12px">⬆️ 파일 업로드</button>
      </div>
      ${files.length > 0 ? files.map(file=>`
        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(0,0,0,.04);transition:background .1s"
          onmouseover="this.style.background='var(--nbg)'" onmouseout="this.style.background=''">
          <span style="font-size:20px;flex-shrink:0">${getFileIcon(file.type)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${file.name}</div>
            <div style="font-size:10px;color:var(--ink3)">${fmtSize(file.size)} · ${file.date}</div>
          </div>
          <button class="btn btn-xs" onclick="previewFile(${currentFolderId},${file.id})" title="미리보기">👁️</button>
          <button class="btn btn-xs" onclick="downloadFile(${currentFolderId},${file.id})" title="다운로드">⬇️</button>
          <button class="btn btn-xs" onclick="deleteFile(${currentFolderId},${file.id})" style="color:var(--rose)" title="삭제">✕</button>
        </div>`).join('') : `
        <div style="text-align:center;padding:24px;color:var(--ink4);font-size:12px">
          파일을 업로드하세요
        </div>`}
    </div>` : ''
  body.innerHTML = breadcrumbHtml + foldersHtml + filesHtml;
}


// ══════════════════════════════════════════════════════
// ☁️ 구글 스프레드시트 클라우드 동기화
// ══════════════════════════════════════════════════════
// 사용법:
// 1. Google Sheets 새 시트 생성
// 2. 확장 > Apps Script > 아래 코드 붙여넣기 후 배포
// 3. 정책설정 > 클라우드 동기화에 URL 입력

let SYNC_URL = localStorage.getItem('npm5_sync_url') || '';
let syncStatus = 'idle'; // idle | syncing | ok | error

function setSyncUrl(url){
  const trimmed = url.trim();
  // SSRF 방어: https만 허용, localhost/내부IP 차단
  if(trimmed && !/^https:\/\//i.test(trimmed)){
    showSyncToast('⚠️ HTTPS URL만 허용됩니다', 'warn'); return;
  }
  if(trimmed && /^https?:\/\/(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i.test(trimmed)){
    showSyncToast('⚠️ 내부 네트워크 URL은 사용할 수 없습니다', 'warn'); return;
  }
  SYNC_URL = trimmed;
  localStorage.setItem('npm5_sync_url', SYNC_URL);
}

// 전체 데이터를 JSON으로 묶기
function getFullData(){
  return {
    emps: EMPS,
    pol: POL,
    bk: DEF_BK,
    tbk: TBK,
    rec: REC,
    bonus: BONUS_REC,
    allow: ALLOWANCE_REC,
    tax: JSON.parse(localStorage.getItem('npm5_tax')||'{}'),
    leave: JSON.parse(localStorage.getItem('npm5_leave_settings')||'{}'),
    leaveOv: JSON.parse(localStorage.getItem('npm5_leave_overrides')||'{}'),
    folders: JSON.parse(localStorage.getItem('npm5_folders')||'[]'),
    users: JSON.parse(localStorage.getItem('nopro_users')||'[]'),
    ts: Date.now()
  };
}

// 클라우드에 저장
async function syncSave(){
  if(!SYNC_URL){ showSyncToast('⚠️ 동기화 URL을 먼저 설정하세요', 'warn'); return; }
  // 데이터 유출 방지: 전송 전 경고
  const empCount=EMPS.length;
  const recCount=Object.keys(REC).length;
  if(!confirm(`⚠️ 외부 서버로 데이터를 전송합니다.\n\n전송 대상: 직원 ${empCount}명, 출퇴근 기록 ${recCount}건, 급여·수당·세금 전체\n전송 URL: ${SYNC_URL}\n\n계속하시겠습니까?`)) return;
  syncStatus='syncing';
  updateSyncBadge();
  try{
    const data = getFullData();
    const res = await fetch(SYNC_URL, {
      method:'POST',
      headers:{'Content-Type':'text/plain'},
      body: JSON.stringify({action:'save', data})
    });
    const result = await res.json();
    if(result.ok){
      syncStatus='ok';
      updateSyncBadge();
      showSyncToast('☁️ 클라우드 저장 완료', 'ok');
      localStorage.setItem('npm5_last_sync', new Date().toLocaleString('ko-KR'));
      updateSyncInfo();
    } else {
      throw new Error(result.error||'저장 실패');
    }
  }catch(e){
    syncStatus='error';
    updateSyncBadge();
    showSyncToast('❌ 동기화 실패: '+e.message, 'error');
  }
}

// 클라우드에서 불러오기
async function syncLoad(){
  if(!SYNC_URL){ showSyncToast('⚠️ 동기화 URL을 먼저 설정하세요', 'warn'); return; }
  if(!confirm('클라우드 데이터로 덮어씁니다. 현재 데이터는 사라집니다. 계속할까요?')) return;
  syncStatus='syncing';
  updateSyncBadge();
  try{
    const res = await fetch(SYNC_URL+'?action=load');
    const result = await res.json();
    if(result.ok && result.data){
      const d = result.data;
      // localStorage 복원
      if(d.emps) localStorage.setItem('npm5_emps', JSON.stringify(d.emps));
      if(d.pol)  localStorage.setItem('npm5_pol',  JSON.stringify(d.pol));
      if(d.bk)   localStorage.setItem('npm5_bk',   JSON.stringify(d.bk));
      if(d.tbk)  localStorage.setItem('npm5_tbk',  JSON.stringify(d.tbk));
      if(d.rec)  localStorage.setItem('npm5_rec',  JSON.stringify(d.rec));
      if(d.bonus)localStorage.setItem('npm5_bonus',JSON.stringify(d.bonus));
      if(d.allow)localStorage.setItem('npm5_allow',JSON.stringify(d.allow));
      if(d.tax)  localStorage.setItem('npm5_tax',  JSON.stringify(d.tax));
      if(d.leave)localStorage.setItem('npm5_leave_settings',JSON.stringify(d.leave));
      if(d.leaveOv)localStorage.setItem('npm5_leave_overrides',JSON.stringify(d.leaveOv));
      if(d.folders)localStorage.setItem('npm5_folders',JSON.stringify(d.folders));
      if(d.users)localStorage.setItem('nopro_users',JSON.stringify(d.users));
      syncStatus='ok';
      updateSyncBadge();
      const ts = d.ts ? new Date(d.ts).toLocaleString('ko-KR') : '-';
      showSyncToast(`☁️ 불러오기 완료 (저장 시각: ${ts})`, 'ok');
      localStorage.setItem('npm5_last_sync', new Date().toLocaleString('ko-KR'));
      // 페이지 새로고침으로 데이터 반영
      setTimeout(()=>location.reload(), 1200);
    } else {
      throw new Error(result.error||'데이터 없음');
    }
  }catch(e){
    syncStatus='error';
    updateSyncBadge();
    showSyncToast('❌ 불러오기 실패: '+e.message, 'error');
  }
}

function updateSyncBadge(){
  const badge = document.getElementById('sync-badge');
  if(!badge) return;
  const map = {
    idle: {text:'☁️ 동기화', color:'var(--ink3)', bg:'transparent', border:'var(--bd)'},
    syncing: {text:'⟳ 동기화 중...', color:'var(--amber)', bg:'var(--abg)', border:'rgba(217,119,6,.3)'},
    ok:  {text:'✓ 동기화됨', color:'var(--green)', bg:'var(--gbg)', border:'rgba(5,150,105,.3)'},
    error:{text:'✕ 오류', color:'var(--rose)', bg:'var(--rbg)', border:'rgba(225,29,72,.3)'},
  };
  const s = map[syncStatus]||map.idle;
  badge.textContent=s.text;
  badge.style.color=s.color;
  badge.style.background=s.bg;
  badge.style.borderColor=s.border;
}

function updateSyncInfo(){
  const el=document.getElementById('sync-last-time');
  if(el) el.textContent=localStorage.getItem('npm5_last_sync')||'-';
}

function showSyncToast(msg, type='ok', duration=3000){
  const colors = {ok:'var(--teal)',warn:'var(--amber)',error:'var(--rose)',info:'var(--navy2)'};
  const t=document.createElement('div');
  t.style.cssText=`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:var(--card);border:2px solid ${colors[type]||'var(--bd)'};
    color:var(--ink);padding:12px 22px;border-radius:12px;font-size:13px;font-weight:600;
    z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.2);max-width:90vw;white-space:pre-wrap;text-align:center`;
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), duration);
}

// ── Apps Script 코드 복사 버튼 ──
function showSyncSetup(){
  const gasCode = `// Google Apps Script 코드
// 새 시트에서: 확장 > Apps Script > 붙여넣기 > 배포 > 웹앱으로 배포

const SHEET_NAME = '노프로데이터';

function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents);
    if(body.action==='save'){
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(SHEET_NAME);
      if(!sheet) sheet = ss.insertSheet(SHEET_NAME);
      sheet.clearContents();
      sheet.getRange(1,1).setValue(JSON.stringify(body.data));
      sheet.getRange(2,1).setValue(new Date().toLocaleString('ko-KR'));
      return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
    }
  }catch(err){
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e){
  try{
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if(!sheet) return ContentService.createTextOutput(JSON.stringify({ok:false,error:'데이터 없음'})).setMimeType(ContentService.MimeType.JSON);
    const val = sheet.getRange(1,1).getValue();
    const data = val ? JSON.parse(val) : null;
    return ContentService.createTextOutput(JSON.stringify({ok:true,data})).setMimeType(ContentService.MimeType.JSON);
  }catch(err){
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}`;

  const existing = document.getElementById('sync-setup-modal');
  if(existing) existing.remove();

  const modal = document.createElement('div');
  modal.id='sync-setup-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML=`
    <div style="background:var(--card);border:1px solid var(--bd);border-radius:20px;padding:28px;width:100%;max-width:600px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div style="font-size:16px;font-weight:700;color:var(--ink)">☁️ 클라우드 동기화 설정</div>
        <button onclick="document.getElementById('sync-setup-modal').remove()" style="background:none;border:none;color:var(--ink3);cursor:pointer;font-size:18px">✕</button>
      </div>

      <div style="background:var(--blue-dim,rgba(29,78,216,.08));border:1px solid rgba(29,78,216,.2);border-radius:10px;padding:14px;margin-bottom:20px;font-size:12px;color:var(--ink2);line-height:1.8">
        <b style="color:var(--ink)">📋 설정 방법</b><br>
        1. <a href="https://sheets.google.com" target="_blank" style="color:var(--navy2)">Google Sheets</a> 새 스프레드시트 생성<br>
        2. <b>확장 프로그램 → Apps Script</b> 클릭<br>
        3. 아래 코드 전체 복사 후 붙여넣기<br>
        4. <b>배포 → 새 배포 → 웹 앱</b> 선택<br>
        5. 액세스: <b>"모든 사용자"</b> 로 설정 후 배포<br>
        6. 생성된 URL을 아래에 붙여넣기
      </div>

      <div style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--ink3);margin-bottom:6px;letter-spacing:.3px">APPS SCRIPT 코드</div>
        <div style="position:relative">
          <textarea readonly style="width:100%;height:160px;background:var(--surf);border:1px solid var(--bd);border-radius:9px;padding:12px;font-family:monospace;font-size:11px;color:var(--ink2);resize:none;outline:none">${gasCode}</textarea>
          <button onclick="navigator.clipboard.writeText(document.querySelector('#sync-setup-modal textarea').value);this.textContent='✓ 복사됨';setTimeout(()=>this.textContent='복사',1500)"
            style="position:absolute;top:8px;right:8px;padding:4px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--card);color:var(--ink2);font-size:10px;font-weight:600;cursor:pointer">복사</button>
        </div>
      </div>

      <div style="margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;color:var(--ink3);margin-bottom:6px;letter-spacing:.3px">배포 URL 입력</div>
        <div style="display:flex;gap:8px">
          <input id="sync-url-input" type="text" value="${SYNC_URL}" placeholder="https://script.google.com/macros/s/..."
            style="flex:1;padding:10px 12px;border-radius:9px;background:var(--surf);border:1px solid var(--bd);color:var(--ink);font-size:12px;outline:none;font-family:inherit">
          <button onclick="setSyncUrl(document.getElementById('sync-url-input').value);document.getElementById('sync-setup-modal').remove();showSyncToast('✅ URL 저장됨','ok')"
            style="padding:10px 18px;border-radius:9px;background:var(--navy);border:none;color:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">저장</button>
        </div>
      </div>

      <div id="sync-last-time-modal" style="font-size:11px;color:var(--ink3);text-align:center">
        마지막 동기화: ${localStorage.getItem('npm5_last_sync')||'없음'}
      </div>
    </div>`;
  document.body.appendChild(modal);
}


// ── 일일근태 Tab 전역 캡처 ──
document.addEventListener('keydown', function(e) {
  if(e.key !== 'Tab' && e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const el = document.activeElement;
  if(!el) return;
  const isTimeInp = el.classList.contains('time-inp');
  if(!isTimeInp) return;
  const tbody = document.getElementById('daily-tbody');
  if(!tbody || !tbody.contains(el)) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const eid = parseInt(el.dataset.eid);
  const field = el.dataset.field;

  if(e.key === 'Tab' || e.key === 'Enter') {
    // 값 저장 (renderTable 없이)
    const parsed = parseTimeInput(el.value);
    el.value = parsed;
    const k = rk(eid, cY, cM, cD);
    if(!REC[k]) REC[k]={empId:eid,start:'',end:'',absent:false,annual:false,halfAnnual:false,note:'',outTimes:[],customBk:false,customBkList:[]};
    REC[k][field] = parsed;
    __recWrite('keyTab', eid, k, {field, value:parsed});
    try { localStorage.setItem(LS.R, JSON.stringify(REC)); } catch(err){}
    // Supabase 비동기
    try{const s=JSON.parse(localStorage.getItem('nopro_session')||'null');if(s&&s.companyId)sbSaveAll(s.companyId).catch(()=>{});}catch(err){}

    // 다음 input 포커스
    const all = Array.from(tbody.querySelectorAll('input.time-inp')).filter(i=>!i.disabled);
    const idx = all.indexOf(el);
    const next = all[e.shiftKey ? idx-1 : idx+1];
    if(next){ next.focus(); next.select(); }

  } else if(e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const all = Array.from(tbody.querySelectorAll('input.time-inp')).filter(i=>!i.disabled);
    const idx = all.indexOf(el);
    const step = e.key === 'ArrowDown' ? 2 : -2;
    const next = all[idx + step];
    if(next){ next.focus(); next.select(); }
  }
}, true);

function saveSettings(){
  POL.ntFixed=document.getElementById('tog-nt')?.checked??true;
  POL.otFixed=document.getElementById('tog-ot')?.checked??true;
  POL.holFixed=document.getElementById('tog-hol')?.checked??true;
  POL.ntHourly=document.getElementById('tog-nt-hourly')?.checked??true;
  POL.otHourly=document.getElementById('tog-ot-hourly')?.checked??true;
  POL.holHourly=document.getElementById('tog-hol-hourly')?.checked??true;
  POL.nt=POL.ntFixed; POL.ot=POL.otFixed; POL.hol=POL.holFixed;
  POL.juhyu=document.getElementById('tog-juhyu').checked;
  POL.sot=+document.getElementById('inp-sot').value;
  const newBaseMonthly=+document.getElementById('inp-base-monthly')?.value||0;
  if(newBaseMonthly&&newBaseMonthly!==POL.baseMonthly) POL.baseMonthly=newBaseMonthly;
  const newBaseRate=+document.getElementById('inp-base-rate').value;
  if(newBaseRate && newBaseRate!==POL.baseRate){
    POL.baseRate=newBaseRate;
    saveLS();renderPayroll();
  }
  POL.nightStart=+document.getElementById('sel-ns').value;
  // 사이트코드
  const scInp=document.getElementById('inp-site-code');
  if(scInp){
    POL.siteCode=(scInp.value||'').trim();
    console.log('[saveSettings] siteCode 저장:', POL.siteCode);
  }
  // alYear, alMonth는 연차관리 탭에서 별도 관리
  saveLS();renderTable();renderEmps();
  const btn=event.target;btn.textContent='저장됨 ✓';btn.style.background='var(--teal)';
  setTimeout(()=>{btn.textContent='저장';btn.style.background='';},1600);
}

// ── 데이터 백업 (JSON 다운로드) ──
function exportBackup(){
  const sess=JSON.parse(localStorage.getItem('nopro_session')||'null');
  const data={
    _meta:{exportedAt:new Date().toISOString(),company:sess?.company||'',email:sess?.email||''},
    emps:EMPS,pol:POL,bk:DEF_BK,tbk:TBK,rec:REC,
    bonus:BONUS_REC,allow:ALLOWANCE_REC,
    tax:JSON.parse(localStorage.getItem('npm5_tax')||'{}'),
    leave_settings:JSON.parse(localStorage.getItem('npm5_leave_settings')||'{}'),
    leave_overrides:JSON.parse(localStorage.getItem('npm5_leave_overrides')||'{}'),
    folders:JSON.parse(localStorage.getItem('npm5_folders')||'[]'),
    safety:(()=>{const s={};Object.entries(SAFETY_REC).forEach(([k,v])=>{s[k]=Array.isArray(v)?v.map(({data,...r})=>r):v;});return s;})()
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const date=new Date().toISOString().slice(0,10);
  a.href=url;a.download=`노프로_백업_${sess?.company||'data'}_${date}.json`;
  a.click();URL.revokeObjectURL(url);
  if(typeof showSyncToast==='function') showSyncToast('백업 파일 다운로드 완료','ok');
}

// ══════════════════════════════════════
// 엑셀 내보내기 (3개 시트)
// ══════════════════════════════════════
function exportExcel(){
  const wb = XLSX.utils.book_new();
  const month = `${pY}년 ${pM}월`;
  const C = XLS.C; const S = XLS.S;
  const allowList = POL.allowances.filter(a=>!a.isDeduct);
  const deductList = POL.allowances.filter(a=>a.isDeduct===true);

  function writePaySheet(emps, sheetName, isMonthly){
    if(!emps.length) return;
    const ws = {}; let R=0;

    // ── 타이틀 블록 ──
    const payMode = isMonthly?'월급제':sheetName==='통상임금제'?'통상임금제':'시급제';
    xlsWrite(ws,XLSX.utils.encode_cell({r:0,c:0}),`${month} 급여 명세서`,{
      font:{bold:true,sz:18,color:{rgb:C.navy},name:'맑은 고딕'},
      fill:{fgColor:{rgb:'EFF6FF'}},
      alignment:{horizontal:'left',vertical:'center'},
    });
    xlsMerge(ws,0,0,0,8);
    xlsWrite(ws,XLSX.utils.encode_cell({r:1,c:0}),
      `${sheetName}  ·  총 ${emps.length}명  ·  출력일: ${new Date().toLocaleDateString('ko-KR')}`,{
      font:{sz:9,color:{rgb:C.gray2},italic:true,name:'맑은 고딕'},
      fill:{fgColor:{rgb:'EFF6FF'}},
      alignment:{horizontal:'left',vertical:'center'},
    });
    xlsMerge(ws,1,0,1,8);
    ws['!rows']=[{hpt:30},{hpt:16}];
    R=2;

    // ── 헤더 정의 (스프레드시트 동일) ──
    const allHdrs = [
      '순번','근무지','직급','성명','급여유형','연차개수','근무일수','소정근로시간','입사일','시급',
      '기본급','주휴수당','연차수당',
      ...allowList.map(a=>a.name),
      '급여',
      '실근무(h)','소정근로외(h)','야간(h)','초과연장(h)','초과휴일(h)','결근일수','공제시간(h)',
      '소정근로외수당','야간수당','초과연장수당','초과휴일수당',
      '월급제휴일수당','월급제휴일초과','결근차감','총가산수당',
      '상여금','총급여',
      ...deductList.map(a=>a.name),
      '국민연금','건강보험','고용보험','소득세','주민세','공제합계','실지급액'
    ];

    // 헤더 색상 그룹
    const getHdrStyle = (h) => {
      if(['순번','근무지','직급','성명','급여유형','연차개수','근무일수','소정근로시간','입사일','시급'].includes(h)) return S.mainHdr(C.navy,'FFFFFF','center');
      if(h==='기본급'||h==='급여') return S.mainHdr(C.navy,'FFFFFF','center');
      if(h==='주휴수당') return S.mainHdr(C.teal,'FFFFFF','center');
      if(h==='연차수당') return S.mainHdr(C.navy,'FFFFFF','center');
      if(allowList.find(a=>a.name===h)) return S.mainHdr('00695C','FFFFFF','center');
      if(h.includes('(h)')||h==='결근일수') return S.mainHdr('4527A0','FFFFFF','center');
      if(h==='소정근로외수당') return S.mainHdr('1565C0','FFFFFF','center');
      if(h==='야간수당') return S.mainHdr('0C447C','B5D4F4','center');
      if(h==='초과연장수당') return S.mainHdr('534AB7','EEEDFE','center');
      if(h==='초과휴일수당'||h.includes('월급제')) return S.mainHdr('854F0B','FAC775','center');
      if(h==='총가산수당') return S.mainHdr('065F46','D1FAE5','center');
      if(h==='상여금') return S.mainHdr(C.orange2,'FFFFFF','center');
      if(h==='총급여') return S.mainHdr('0D47A1','FFFFFF','center');
      if(h.includes('공제')||h.includes('세')||h.includes('보험')||h==='결근차감') return S.mainHdr(C.rose,'FFFFFF','center');
      if(h==='실지급액') return S.mainHdr('1B5E20','FFFFFF','center');
      return S.mainHdr(C.gray,'FFFFFF','center');
    };

    allHdrs.forEach((h,ci)=>xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci}),h,getHdrStyle(h)));
    ws['!rows'].push({hpt:28});
    R++;

    // ── 데이터 행 ──
    let grandTotal=0, grandNet=0;
    emps.forEach((emp,ei)=>{
      const s = monthSummary(emp.id,pY,pM);
      const rate = getEmpRate(emp);
      const tx = getTaxRec(emp.id,pY,pM);
      const bg = xlsRowBg(ei);

      let allowTotal=0;
      allowList.forEach(a=>{allowTotal+=(s.allowances[a.id]||0);});
      let deductTotal=0;
      deductList.forEach(a=>{deductTotal+=(s.allowances[a.id]||0);});
      const basePay = s.tBase + allowTotal;
      const totalPay = basePay + (s.wkly||0) + s.annualPay + (s.tTotalBonus||0) + (s.tMonthlyHolStdPay||0) + (s.tMonthlyHolOtPay||0) - s.deduction + s.bonus;
      const itax=parseFloat(tx.incomeTax)||0;
      const ltax=parseFloat(tx.localTax)||0;
      const bonusDed=s.bonus;
      const dedTot=(+(tx.pension)||0)+(+(tx.health)||0)+(+(tx.employment)||0)+itax+ltax+Math.abs(deductTotal)+bonusDed;
      const netPay=totalPay+deductTotal-bonusDed-(+(tx.pension)||0)-(+(tx.health)||0)-(+(tx.employment)||0)-itax-ltax;
      grandTotal+=totalPay; grandNet+=netPay;

      const halfCnt=(()=>{let h=0;for(let d=1;d<=dim(pY,pM);d++){const r2=REC[rk(emp.id,pY,pM,d)];if(r2&&r2.halfAnnual)h++;}return h;})();

      const _pm=getEmpPayMode(emp);
      const sot=emp.sot||POL.sot||209;
      const leaveCalc=calcLeaveForYear(emp,pY);
      const annualTotal=leaveCalc?leaveCalc.total:0;
      const extraWorkH=(s.tExtraWorkH||0);
      const otH=(s.tOtDayH||0)+(s.tOtNightH||0);
      const holH=(s.tHolDayH||0)+(s.tHolNightH||0)+(s.tHolDayOtH||0)+(s.tHolNightOtH||0);
      const W=(_c,v,st)=>xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:_c}),v,st);
      let ci=0;

      // 기본정보
      W(ci++,ei+1,S.cell(C.gray,bg,false,'center'));
      W(ci++,emp.dept||'',S.cell(C.gray,bg,false,'center'));
      W(ci++,emp.role||'',S.cell(C.gray,bg,false,'center'));
      W(ci++,emp.name,S.cell(C.navy,bg,true,'center'));
      W(ci++,getEmpPayModeLabel(emp).text,S.cell(C.blue,bg,false,'center'));
      W(ci++,annualTotal,S.num(C.gray,bg));
      W(ci++,s.wdays||0,S.num(C.navy,bg));
      W(ci++,(_pm==='hourly'||_pm==='monthly')?'':sot,S.num(C.gray,bg));
      W(ci++,emp.join||'',S.cell(C.gray,bg,false,'center'));
      W(ci++,getOrdinaryRate(emp, pY, pM),S.num(C.blue,C.blue4||bg,true));

      // 기본급 + 주휴 + 연차수당
      W(ci++,Math.round(s.tBase)||'',s.tBase?S.num(C.navy,bg):S.empty(bg));
      W(ci++,Math.round(s.wkly)||'',s.wkly?S.num(C.teal,'E0F2F1'):S.empty(bg));
      W(ci++,Math.round(s.annualPay)||'',s.annualPay?S.num(C.green,bg):S.empty(bg));

      // 수당 항목
      allowList.forEach(a=>{
        const v=s.allowances[a.id]||0;
        W(ci++,v||'',v?S.num(v<0?C.rose:C.gray,v<0?C.rose4:bg):S.empty(bg));
      });

      // 급여 (기본급+수당합계)
      W(ci++,Math.round(basePay),S.num(C.teal,'E0F2F1',true));

      // 시간 컬럼
      W(ci++,s.twkH>0?+s.twkH.toFixed(2):'',s.twkH>0?S.numDec(C.navy,bg):S.empty(bg));
      W(ci++,extraWorkH>0?+extraWorkH.toFixed(2):'',extraWorkH>0?S.numDec('1565C0',bg):S.empty(bg));
      W(ci++,s.tNightH>0?+s.tNightH.toFixed(2):'',s.tNightH>0?S.numDec('0C447C',bg):S.empty(bg));
      W(ci++,otH>0?+otH.toFixed(2):'',otH>0?S.numDec(C.purple2,bg):S.empty(bg));
      W(ci++,holH>0?+holH.toFixed(2):'',holH>0?S.numDec(C.orange2,bg):S.empty(bg));
      W(ci++,s.adays||'',s.adays?S.num(C.rose,bg):S.empty(bg));
      W(ci++,s.dedShortH>0?+s.dedShortH.toFixed(2):'',s.dedShortH>0?S.numDec(C.rose,bg):S.empty(bg));

      // 수당 금액
      W(ci++,Math.round(s.tExtraWorkPay)||'',(s.tExtraWorkPay||0)?S.num('1565C0',bg):S.empty(bg));
      W(ci++,Math.round(s.tNightPay)||'',s.tNightPay?S.num('0C447C',bg):S.empty(bg));
      W(ci++,Math.round((s.tOtDayPay||0)+(s.tOtNightPay||0))||'',(s.tOtDayPay+s.tOtNightPay)?S.num(C.purple2,C.purple4):S.empty(bg));
      W(ci++,Math.round(s.tHolPayNew||0)||'',(s.tHolPayNew||0)?S.num(C.orange2,C.orange4):S.empty(bg));
      W(ci++,Math.round(s.tMonthlyHolStdPay||0)||'',(s.tMonthlyHolStdPay||0)?S.num(C.orange2,C.orange4):S.empty(bg));
      W(ci++,Math.round(s.tMonthlyHolOtPay||0)||'',(s.tMonthlyHolOtPay||0)?S.num(C.rose,C.rose4):S.empty(bg));
      W(ci++,s.deduction>0?-Math.round(s.deduction):'',s.deduction?S.num(C.rose,C.rose4):S.empty(bg));
      W(ci++,Math.round(s.tTotalBonus||0)||'',(s.tTotalBonus||0)?S.num('065F46','ECFDF5',true):S.empty(bg));

      // 상여금 + 총급여
      W(ci++,s.bonus||'',s.bonus?S.num(C.orange2,C.orange4):S.empty(bg));
      W(ci++,Math.round(totalPay),S.num('FFFFFF','1565C0',true));

      // 공제
      deductList.forEach(a=>{
        const v=s.allowances[a.id]||0;
        W(ci++,v||'',v?S.num(C.rose,C.rose4):S.empty(bg));
      });
      const pension4x=+(tx.pension)||0; const health4x=+(tx.health)||0; const employ4x=+(tx.employment)||0;
      W(ci++,pension4x||'',pension4x?S.num('7C3AED','F5F3FF'):S.empty(bg));
      W(ci++,health4x||'',health4x?S.num('7C3AED','F5F3FF'):S.empty(bg));
      W(ci++,employ4x||'',employ4x?S.num('7C3AED','F5F3FF'):S.empty(bg));
      W(ci++,itax||'',itax?S.num(C.rose,C.rose4):S.empty(bg));
      W(ci++,ltax||'',ltax?S.num(C.rose,C.rose4):S.empty(bg));
      W(ci++,dedTot||'',dedTot?S.num(C.rose2,C.rose4,true):S.empty(bg));

      // 실지급액
      W(ci++,Math.round(netPay),{
        font:{bold:true,sz:11,color:{rgb:'FFFFFF'},name:'맑은 고딕'},
        fill:{fgColor:{rgb:'1B5E20'}},
        alignment:{horizontal:'right',vertical:'center'},
        border:XLS.B.thin('0A3D0A'),
        numFmt:'#,##0',
      });

      ws['!rows'].push({hpt:22});
      R++;
    });

    // ── 합계행 ──
    const C_=XLS.C; const ci2=allHdrs.length-1;
    // 좌측 병합 타이틀
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:0}),'합 계',S.mainHdr(C_.navy));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:1}),'',S.mainHdr(C_.navy));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:2}),'',S.mainHdr(C_.navy));
    xlsMerge(ws,R,0,R,2);
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:3}),`${emps.length}명`,{
      font:{bold:true,sz:10,color:{rgb:'FFFFFF'},name:'맑은 고딕'},
      fill:{fgColor:{rgb:C_.navy}},alignment:{horizontal:'center',vertical:'center'},
      border:XLS.B.thin('1E3A5F'),
    });
    // 빈 셀들
    for(let c=4;c<ci2-1;c++) xlsWrite(ws,XLSX.utils.encode_cell({r:R,c}),'',(c===allHdrs.indexOf('총 급여'))?S.total('FFFFFF','0D47A1'):{fill:{fgColor:{rgb:C_.gray4}},border:XLS.B.thin()});
    // 총급여 합계
    const totalIdx=allHdrs.indexOf('총 급여');
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:totalIdx}),Math.round(grandTotal),S.total('FFFFFF','0D47A1'));
    // 실지급액 합계
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci2}),Math.round(grandNet),{
      font:{bold:true,sz:12,color:{rgb:'FFFFFF'},name:'맑은 고딕'},
      fill:{fgColor:{rgb:'1B5E20'}},alignment:{horizontal:'right',vertical:'center'},
      border:XLS.B.medium('0A3D0A'),numFmt:'#,##0',
    });
    ws['!rows'].push({hpt:26});
    R++;

    ws['!cols'] = allHdrs.map((h,i)=>({
      wch: i===3?10:i===4?12:h.includes('급여')||h==='실지급액'?11:h.includes('수당')||h.includes('공제')?10:8
    }));
    xlsRange(ws,0,0,R-1,allHdrs.length-1);
    XLSX.utils.book_append_sheet(wb,ws,sheetName);
  }

  // 3개 시트
  const getEmps = mode => applyCommonFilter(EMPS.filter(e=>{
    if((e.payMode||'fixed')!==mode) return false;
    if(e.join&&new Date(e.join)>new Date(pY,pM,0)) return false;
    if(e.leave&&new Date(e.leave)<new Date(pY,pM-1,1)) return false;
    return true;
  }), 'payroll');

  writePaySheet(getEmps('fixed'), '통상임금제', false);
  writePaySheet(getEmps('hourly'), '시급제', false);
  writePaySheet(getEmps('monthly'), '월급제', true);

  XLSX.writeFile(wb, `급여명세_${pY}년${pM}월_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function exportDailyExcel(){
  const C = XLS.C; const S = XLS.S;
  const wb = XLSX.utils.book_new();
  const ws = {};
  const dateStr = `${cY}-${String(cM).padStart(2,'0')}-${String(cD).padStart(2,'0')}`;
  const dowNames = ['일','월','화','수','목','금','토'];
  const dow = dowNames[new Date(cY,cM-1,cD).getDay()];

  // 타이틀
  xlsWrite(ws,XLSX.utils.encode_cell({r:0,c:0}),`${cY}년 ${cM}월 ${cD}일 (${dow}) 출퇴근 기록`,{
    font:{bold:true,sz:16,color:{rgb:C.navy},name:'맑은 고딕'},
    fill:{fgColor:{rgb:'EFF6FF'}},
    alignment:{horizontal:'left',vertical:'center'},
  });
  xlsMerge(ws,0,0,0,12);
  xlsWrite(ws,XLSX.utils.encode_cell({r:1,c:0}),
    `출력일: ${new Date().toLocaleDateString('ko-KR')}`,{
    font:{sz:9,color:{rgb:C.gray2},italic:true,name:'맑은 고딕'},
    fill:{fgColor:{rgb:'EFF6FF'}},
    alignment:{horizontal:'left',vertical:'center'},
  });
  xlsMerge(ws,1,0,1,12);
  ws['!rows']=[{hpt:28},{hpt:16}];

  // 헤더
  const hdrs=['순번','이름','급여형태','출근','퇴근','근무시간','휴게h','야간h','연장h','휴일h','상태','급여','비고'];
  let R=2;
  hdrs.forEach((h,ci)=>xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci}),h,S.mainHdr(C.navy,'FFFFFF','center')));
  ws['!rows'].push({hpt:26});
  R++;

  // 직원 필터링 (renderTable과 동일)
  const dayDate2=new Date(cY,cM-1,cD);
  const activeDayEmps = applyCommonFilter(EMPS.filter(emp=>{
    if(emp.join){const jd=new Date(emp.join);if(jd>dayDate2)return false;}
    if(emp.leave){const ld=new Date(emp.leave);if(ld<=dayDate2)return false;}
    return true;
  }), 'daily', dayDate2);

  const payModeLabel={fixed:'통상임금제',hourly:'시급제',monthly:'월급제',pohal:'포괄임금'};

  activeDayEmps.forEach((emp,ei)=>{
    const k=rk(emp.id,cY,cM,cD);
    const rec=REC[k]||{start:'',end:'',absent:false,annual:false,halfAnnual:false,note:'',outTimes:[],customBk:false,customBkList:[]};
    const autoH=isAutoHol(cY,cM,cD,emp);
    const rate=getEmpRate(emp);
    const empPayMode=getEmpPayMode(emp);
    // 직원 shift별 휴게세트
    const bks=getActiveBk(cY,cM,cD,emp);
    const activeBks = rec.customBk ? (rec.customBkList||[]) : bks;

    let c=null;
    if(rec.annual){
      c={work:480,nightM:0,ot:0,basePay:rate*8,nightPay:0,otPay:0,holPay:0,totalPay:rate*8};
    } else if(rec.halfAnnual){
      if(rec.start&&rec.end){
        c=calcSession(rec.start,rec.end,rate,autoH,activeBks,rec.outTimes||[],empPayMode,getOrdinaryRate(emp,pY,pM));
      } else {
        c={work:240,nightM:0,ot:0,basePay:rate*4,nightPay:0,otPay:0,holPay:0,totalPay:rate*4};
      }
    } else if(!rec.absent&&rec.start&&rec.end){
      c=calcSession(rec.start,rec.end,rate,autoH,activeBks,rec.outTimes||[],empPayMode,getOrdinaryRate(emp,pY,pM));
    }

    let status='';
    if(rec.annual) status='연차';
    else if(rec.halfAnnual) status='반차';
    else if(rec.absent) status='결근';
    else if(c) status='출근';
    else status='-';

    const bg = xlsRowBg(ei);
    let ci=0;
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),ei+1,S.cell(C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),emp.name||'',S.cell(C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),payModeLabel[empPayMode]||empPayMode,S.cell(C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),rec.start||'',S.cell(C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),rec.end||'',S.cell(C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),c?m2h(c.work):0,S.num(C.gray,bg,false,'center'));
    const bkVal = c&&c.bkMins ? m2h(c.bkMins) : 0;
    const nightBkVal = c&&c.nightBkMins ? Math.round(c.nightBkMins/60*100)/100 : 0;
    const bkText = nightBkVal > 0 ? `${bkVal}h (야간${nightBkVal}h)` : (bkVal > 0 ? bkVal : 0);
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),bkText,S.num('#2D6A4F',bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),c?Math.round(c.nightM/60*100)/100:0,S.num(C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),c?Math.round(c.ot/60*100)/100:0,S.num(C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),c&&autoH?Math.round(c.work/60*100)/100:0,S.num(C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),status,S.cell(
      status==='연차'||status==='반차'?C.green:status==='결근'?C.rose:C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),c?Math.round(c.totalPay/10)*10:0,S.num(C.gray,bg,false,'right'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci++}),rec.note||'',S.cell(C.gray,bg,false,'left'));
    ws['!rows'].push({hpt:22});
    R++;
  });

  xlsRange(ws,0,0,R-1,hdrs.length-1);
  ws['!cols']=hdrs.map((_,i)=>({wch:i===1?12:i===2?12:i===10?14:i===11?16:10}));
  XLSX.utils.book_append_sheet(wb,ws,`${cM}M${cD}D`);
  XLSX.writeFile(wb,`출퇴근기록_${dateStr}.xlsx`,{bookType:'xlsx',type:'binary'});
}


function exportFile(){
  const html=document.documentElement.outerHTML;
  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`노무관리Pro_v5_${new Date().toISOString().slice(0,10)}.html`;
  a.click();
}

// ══════════════════════════════════════
// 안전교육 일지 v2
// ══════════════════════════════════════
let sfY=new Date().getFullYear(),sfM=new Date().getMonth()+1,sfD=new Date().getDate();
const SF_KEY='npm5_safety';
let SAFETY_REC=load(SF_KEY,{});
let SF2_PHOTOS={};
let sf2StF='all',sf2NaF='all',sf2ShF='all',sf2DpF='all',sf2PmF='all';
let sfMY=new Date().getFullYear(),sfMMo=new Date().getMonth()+1,sfMStF='all';

function sfSave(){
  // localStorage에는 base64(data) 제거 후 메타데이터만 저장
  const slim={};
  Object.entries(SAFETY_REC).forEach(([k,v])=>{
    if(Array.isArray(v)){
      slim[k]=v.map(({data, ...rest})=>rest);
    } else { slim[k]=v; }
  });
  try{localStorage.setItem(SF_KEY,JSON.stringify(slim));}
  catch(e){console.warn('안전교육 저장 용량 초과:',e);}
}
function sfKey(){return`${sfY}-${pad(sfM)}-${pad(sfD)}`;}

// 탭 전환
function sfSwitchTab(id){
  ['daily','monthly','summary'].forEach(t=>{
    document.getElementById('sf-page-'+t).style.display='none';
    const tab=document.getElementById('sf-tab-'+t);
    if(tab){tab.style.color='var(--ink3)';tab.style.borderBottomColor='transparent';tab.style.fontWeight='500';}
  });
  document.getElementById('sf-page-'+id).style.display=(id==='daily'?'flex':'block');
  const on=document.getElementById('sf-tab-'+id);
  if(on){on.style.color='var(--navy)';on.style.borderBottomColor='var(--navy)';on.style.fontWeight='700';}
  // 일일현황만 일자/요일 표시, 나머지는 숨김
  const daySec=document.getElementById('sf-day-sec');
  const dowSec=document.getElementById('sf-dow-sec');
  if(daySec)daySec.style.display=id==='daily'?'':'none';
  if(dowSec)dowSec.style.display=id==='daily'?'':'none';
  if(id==='monthly')sfRenderM();
  if(id==='summary')sfRenderSummary();
}
// 날짜 네비게이션
function sfNd(f,d){
  if(f==='year')sfY+=d;
  if(f==='month'){sfM+=d;if(sfM>12){sfM=1;sfY++;}if(sfM<1){sfM=12;sfY--;}}
  if(f==='day'){const mx=new Date(sfY,sfM,0).getDate();sfD+=d;if(sfD>mx)sfD=1;if(sfD<1)sfD=mx;}
  sfD=Math.min(sfD,new Date(sfY,sfM,0).getDate());
  sfUpdBar2();
  sfLoadTbm();
  sfRenderList();
  sfRenderRecent();
  sf2RenderPhotos();
  // 현재 보이는 탭도 갱신
  const mPage=document.getElementById('sf-page-monthly');
  if(mPage&&mPage.style.display!=='none')sfRenderM();
  const sPage=document.getElementById('sf-page-summary');
  if(sPage&&sPage.style.display!=='none')sfRenderSummary();
}
function sfUpdBar2(){
  document.getElementById('sf-dy').textContent=sfY;
  document.getElementById('sf-dm').textContent=sfM;
  document.getElementById('sf-dd').textContent=sfD;
  const dow=new Date(sfY,sfM-1,sfD).getDay();
  document.getElementById('sf-dow').textContent=DOW[dow]+'요일';
  const key=sfKey();
  const tok=SAFETY_REC[key+'_token']||'';
  const sess=JSON.parse(localStorage.getItem('nopro_session')||'null');
  const cid=sess?.companyId||'';
  const url=tok&&cid?`noprohr.netlify.app/tbm_sign.html?c=${cid}&t=${tok}&d=${key}`:'링크를 생성해주세요 (🔄 재생성 버튼 클릭)';
  const urlEl=document.getElementById('sf-link-url');
  if(urlEl)urlEl.textContent=url;
  const kakaoEl=document.getElementById('sf-kakao-msg');
  if(tok&&cid){
    kakaoEl&&(kakaoEl.textContent=`[노프로 TBM 서명]\n${sfM}월 ${sfD}일 TBM 교육 서명 부탁드립니다.\n링크 클릭 → 이름 선택 → 동의 → 서명\n\nhttps://${url}\n\n외국인분들도 영어 버튼 누르면 됩니다.`);
  } else {
    kakaoEl&&(kakaoEl.textContent='먼저 🔄 재생성 버튼을 눌러 서명 링크를 생성해주세요.');
  }
}

// TBM 내용 저장/로드
function sfSaveTbm(){
  const key=sfKey();
  const val=document.getElementById('sf-tbm-content').value;
  SAFETY_REC[key+'_tbm']=val;
  sfSave();
  // 한국어가 바뀌면 번역이 구버전임을 표시
  sfUpdTranslateStatus();
}
function sfLoadTbm(){
  const key=sfKey();
  const ta=document.getElementById('sf-tbm-content');
  if(ta)ta.value=SAFETY_REC[key+'_tbm']||'';
  // 영문 번역 표시
  sfShowTranslation();
}
function sfShowTranslation(){
  const key=sfKey();
  const en=SAFETY_REC[key+'_tbm_en']||'';
  const box=document.getElementById('sf-tbm-en-box');
  const txt=document.getElementById('sf-tbm-en-text');
  const time=document.getElementById('sf-tr-time');
  if(!box||!txt)return;
  if(en){
    box.style.display='block';
    txt.textContent=en;
    const ts=SAFETY_REC[key+'_tbm_en_at']||0;
    if(ts&&time) time.textContent=new Date(ts).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 번역';
  } else {
    box.style.display='none';
  }
  sfUpdTranslateStatus();
}
function sfUpdTranslateStatus(){
  const key=sfKey();
  const ko=SAFETY_REC[key+'_tbm']||'';
  const en=SAFETY_REC[key+'_tbm_en']||'';
  const src=SAFETY_REC[key+'_tbm_en_src']||'';
  const statusEl=document.getElementById('sf-tr-status');
  const btnEl=document.getElementById('sf-tr-btn');
  if(!statusEl||!btnEl)return;
  if(!ko){
    statusEl.style.display='none';
    btnEl.textContent='🌐 영어 번역';
    return;
  }
  if(!en){
    statusEl.textContent='번역 없음';
    statusEl.style.display='inline';
    statusEl.style.color='var(--rose)';
    btnEl.textContent='🌐 영어 번역';
  } else if(src!==ko){
    statusEl.textContent='내용 수정됨 — 재번역 필요';
    statusEl.style.display='inline';
    statusEl.style.color='#D97706';
    btnEl.textContent='🔄 재번역';
  } else {
    statusEl.textContent='✓ 번역 완료';
    statusEl.style.display='inline';
    statusEl.style.color='#059669';
    btnEl.textContent='🔄 재번역';
  }
}
async function sfTranslateTbm(){
  const key=sfKey();
  const ko=SAFETY_REC[key+'_tbm']||'';
  if(!ko){alert('먼저 TBM 교육내용을 입력해주세요.');return;}
  const btn=document.getElementById('sf-tr-btn');
  if(btn){btn.disabled=true;btn.textContent='번역 중...';}
  try{
    const res=await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q='+encodeURIComponent(ko));
    const json=await res.json();
    const translated=json[0].map(s=>s[0]).join('');
    SAFETY_REC[key+'_tbm_en']=translated;
    SAFETY_REC[key+'_tbm_en_src']=ko;  // 번역 원본 기록 (변경 감지용)
    SAFETY_REC[key+'_tbm_en_at']=Date.now();
    sfSave();
    sfShowTranslation();
    // 서버에도 저장
    const safetyValue=(()=>{const s={};Object.entries(SAFETY_REC).forEach(([k,v])=>{s[k]=Array.isArray(v)?v.map(({data,...r})=>r):v;});return s;})();
    safeItemSave('safety',safetyValue).catch(()=>{});
  }catch(e){
    alert('번역에 실패했습니다. 인터넷 연결을 확인해주세요.');
  }finally{
    if(btn){btn.disabled=false;sfUpdTranslateStatus();}
  }
}

// 링크
function sfCopyLink(){
  let url=(document.getElementById('sf-link-url')||{}).textContent||'';
  if(!url||url.includes('링크를 생성')){alert('먼저 🔄 재생성 버튼을 눌러 링크를 생성해주세요.');return;}
  if(!url.startsWith('http'))url='https://'+url;
  if(navigator.clipboard)navigator.clipboard.writeText(url);
  const t=document.getElementById('sf-toast');
  if(t){t.style.display='block';setTimeout(()=>t.style.display='none',2500);}
}
async function sfGenLink(){
  const sess=JSON.parse(localStorage.getItem('nopro_session')||'null');
  if(!sess||!sess.companyId){alert('로그인이 필요합니다.');return;}
  const urlEl=document.getElementById('sf-link-url');
  if(urlEl)urlEl.textContent='링크 생성 중...';
  // 암호학적 난수로 24자 토큰 생성 (무차별 대입 방지)
  const chars='abcdefghijklmnopqrstuvwxyz0123456789';
  const rnd=new Uint8Array(24);crypto.getRandomValues(rnd);
  let tok='';for(let i=0;i<24;i++)tok+=chars[rnd[i]%chars.length];
  const key=sfKey();
  SAFETY_REC[key+'_token']=tok;
  sfSave();
  // safety 데이터만 서버에 즉시 저장 (전체 저장보다 훨씬 빠름)
  const safetyValue=(()=>{const s={};Object.entries(SAFETY_REC).forEach(([k,v])=>{s[k]=Array.isArray(v)?v.map(({data,...r})=>r):v;});return s;})();
  try{
    await safeItemSave('safety',safetyValue);
  }catch(e){
    console.error('토큰 저장 실패:',e);
    if(urlEl)urlEl.textContent='저장 실패 — 다시 시도해주세요';
    alert('서버 저장에 실패했습니다. 인터넷 연결을 확인 후 다시 시도해주세요.');
    return;
  }
  const cid=sess.companyId;
  const url=`noprohr.netlify.app/tbm_sign.html?c=${cid}&t=${tok}&d=${key}`;
  if(urlEl)urlEl.textContent=url;
  const kakaoEl=document.getElementById('sf-kakao-msg');
  if(kakaoEl)kakaoEl.textContent=`[노프로 TBM 서명]\n${sfM}월 ${sfD}일 TBM 교육 서명 부탁드립니다.\n링크 클릭 → 이름 선택 → 동의 → 서명\n\nhttps://${url}\n\n외국인분들도 영어 버튼 누르면 됩니다.`;
  const t=document.getElementById('sf-toast');
  if(t){t.textContent='✓ 링크가 생성되었습니다!';t.style.display='block';setTimeout(()=>{t.style.display='none';t.textContent='✓ 복사 완료! 단톡방에 붙여넣기 하세요.';},2500);}
}
async function sfSaveDay2(){
  sfSave();
  // safety 키만 서버에 저장 (빠름)
  const safetyValue=(()=>{const s={};Object.entries(SAFETY_REC).forEach(([k,v])=>{s[k]=Array.isArray(v)?v.map(({data,...r})=>r):v;});return s;})();
  try{await safeItemSave('safety',safetyValue);}catch(e){console.warn('safety 서버 저장 실패:',e);}
  const msg=document.getElementById('sf-sv-msg');
  if(msg){msg.style.display='inline';setTimeout(()=>msg.style.display='none',2500);}
}
function sfSendAlert(){
  const signs=SAFETY_REC[sfKey()+'_signs']||{};
  const unsigned=EMPS.filter(e=>!e.leave&&!signs[String(e.id)]);
  if(unsigned.length===0){alert('모든 직원이 서명을 완료했습니다!');return;}
  const names=unsigned.map(e=>e.name).join(', ');
  alert(`미서명 인원 (${unsigned.length}명):\n${names}\n\n카카오 단톡방 링크를 다시 공유해주세요.`);
}

function sfGetFilteredEmps(){
  const sh=(document.getElementById('sf-f-sh')||{}).value||'all';
  const na=(document.getElementById('sf-f-na')||{}).value||'all';
  const pm=(document.getElementById('sf-f-pm')||{}).value||'all';
  const dp=(document.getElementById('sf-f-dp')||{}).value||'all';
  return EMPS.filter(e=>{
    if(e.leave)return false;
    if(sh!=='all'&&(e.shift||'day')!==sh)return false;
    const isFor=e.nation==='foreign'||e.foreigner===true;
    if(na==='korean'&&isFor)return false;
    if(na==='foreign'&&!isFor)return false;
    if(dp!=='all'&&(e.dept||'')!==dp)return false;
    if(pm!=='all'&&(e.payMode||'fixed')!==pm)return false;
    return true;
  });
}

function sfMakeRec(e){
  return sfGetMonthDays(sfMY,sfMMo).map(d=>{
    const dateKey=`${sfMY}-${pad(sfMMo)}-${pad(d)}`;
    const signs=SAFETY_REC[dateKey+'_signs']||{};
    return signs[String(e.id)]?1:0;
  });
}

function sfDoExcel(){
  if(typeof ExcelJS==='undefined'){
    const btn=event?.target;
    if(btn){btn.textContent='⏳ 로딩중...';btn.disabled=true;}
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload=()=>{if(btn){btn.textContent='📊 엑셀 내보내기';btn.disabled=false;}sfExcelCore();};
    s.onerror=()=>{if(btn){btn.textContent='📊 엑셀 내보내기';btn.disabled=false;}alert('엑셀 라이브러리 로드 실패');};
    document.head.appendChild(s);
  } else { sfExcelCore(); }
}

function sf_b64toAB(b64){const bin=atob(b64);const buf=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i);return buf.buffer;}
function sf_imgExt(b64){if(b64.includes('image/png'))return'png';if(b64.includes('image/gif'))return'gif';return'jpeg';}

// 사진 data 확보 (p.data 우선, 없으면 storagePath fetch, 재시도 1회 포함)
async function sfFetchPhotoBuffer(p, retry=1){
  if(p.data && typeof p.data==='string' && p.data.startsWith('data:image')){
    return {buf: sf_b64toAB(p.data.split(',')[1]), ext: sf_imgExt(p.data)};
  }
  if(!p.storagePath) return null;
  for(let attempt=0; attempt<=retry; attempt++){
    try{
      const urls = await getFileUrls([p.storagePath]);
      const imgUrl = urls[p.storagePath];
      if(!imgUrl) { if(attempt<retry) await new Promise(r=>setTimeout(r,300)); continue; }
      const resp = await fetch(imgUrl);
      if(!resp.ok) { if(attempt<retry) await new Promise(r=>setTimeout(r,300)); continue; }
      const buf = await resp.arrayBuffer();
      if(buf.byteLength === 0){ if(attempt<retry) await new Promise(r=>setTimeout(r,300)); continue; }
      const ext = (p.name||'').toLowerCase().includes('.png') ? 'png'
                : (p.name||'').toLowerCase().includes('.gif') ? 'gif' : 'jpeg';
      return {buf, ext};
    }catch(e){
      console.warn('[엑셀 사진] 시도'+(attempt+1)+' 실패:', e.message);
    }
  }
  return null;
}

async function sfExcelCore(){
  const wb=new ExcelJS.Workbook();
  const emps=sfGetFilteredEmps();
  const days=sfGetMonthDays(sfMY,sfMMo);
  const DNW=['일','월','화','수','목','금','토'];
  const NAVY={argb:'FF1E3A5F'};const WHITE={argb:'FFFFFFFF'};const GREEN_BG={argb:'FFC6EFCE'};
  const RED_BG={argb:'FFFFC7CE'};const BLUE_BG={argb:'FFDDEBF7'};const GRAY_BG={argb:'FFF2F2F2'};
  const GREEN_FT={argb:'FF276221'};const RED_FT={argb:'FF9C0006'};const TEAL_BG={argb:'FF059669'};

  // 모든 사진 storagePath를 한번에 병렬 prefetch (캐시 warmup)
  try{
    const allPaths = [];
    for(const d of days){
      const k = sfMY+'-'+pad(sfMMo)+'-'+pad(d);
      const photos = SAFETY_REC[k]||[];
      photos.forEach(p=>{ if(p.storagePath && !(p.data&&p.data.startsWith('data:image'))) allPaths.push(p.storagePath); });
    }
    if(allPaths.length) await getFileUrls([...new Set(allPaths)]);
  }catch(e){ console.warn('[엑셀 사진] prefetch 실패:', e); }

  // ── 시트1: 월별 서명현황 매트릭스 (기존 시트1+시트2 서명부분 통합, 자동필터+색상+고정) ──
  const ws1=wb.addWorksheet(sfMMo+'월 현황');
  // 타이틀
  ws1.addRow([sfMY+'년 '+sfMMo+'월 TBM 서명 현황표']);
  ws1.getRow(1).font={bold:true,size:14,color:{argb:'FF1E3A5F'}};
  ws1.mergeCells(1,1,1,6+days.length+3);
  // 헤더
  const hdr=['직원명','영문명','주야간','국적','소속','급여방식'];
  days.forEach(d=>hdr.push(sfMMo+'/'+d+'('+DNW[new Date(sfMY,sfMMo-1,d).getDay()]+')'));
  hdr.push('완료수','전체','완료율');
  const hRow=ws1.addRow(hdr);
  hRow.eachCell((c,i)=>{
    c.fill={type:'pattern',pattern:'solid',fgColor:NAVY};
    c.font={bold:true,size:9,color:WHITE};
    c.alignment={horizontal:'center',vertical:'middle'};
    c.border={bottom:{style:'thin',color:{argb:'FF94A3B8'}}};
    // 요일별 색상
    if(i>6&&i<=6+days.length){
      const dw=new Date(sfMY,sfMMo-1,days[i-7]).getDay();
      if(dw===0)c.font={bold:true,size:9,color:{argb:'FFEF4444'}};
      else if(dw===6)c.font={bold:true,size:9,color:{argb:'FF93C5FD'}};
      else c.font={bold:true,size:9,color:WHITE};
      c.fill={type:'pattern',pattern:'solid',fgColor:NAVY};
    }
    if(i>6+days.length){c.fill={type:'pattern',pattern:'solid',fgColor:TEAL_BG};c.font={bold:true,size:9,color:WHITE};}
  });
  // 데이터
  emps.forEach(e=>{
    const rec=sfMakeRec(e);
    const total=rec.reduce((a,b)=>a+b,0);
    const pct=days.length?Math.round(total/days.length*100):0;
    const pm2=sfPmLabel(e).t;
    const row=[e.name||'',e.nameEn||'',e.shift==='night'?'야간':'주간',
      (e.nation==='foreign'||e.foreigner)?'외국인':'내국인',e.dept||'',pm2];
    rec.forEach(v=>row.push(v===1?'✓':'—'));
    row.push(total,days.length,pct/100);
    const r=ws1.addRow(row);
    r.eachCell((c,i)=>{
      c.alignment={horizontal:'center',vertical:'middle'};
      c.font={size:9};
      c.border={bottom:{style:'hair',color:{argb:'FFE2E8F0'}}};
      if(i===1){c.alignment={horizontal:'left'};c.font={size:10,bold:true};}
      if(i>6&&i<=6+days.length){
        const v=rec[i-7];
        if(v===1){c.fill={type:'pattern',pattern:'solid',fgColor:GREEN_BG};c.font={size:9,bold:true,color:GREEN_FT};}
      }
      if(i===6+days.length+3){
        c.numFmt='0%';
        const pc=pct;
        c.font={size:10,bold:true,color:{argb:pc>=90?'FF059669':pc>=60?'FF1D4ED8':'FFE11D48'}};
      }
    });
  });
  // 열 너비
  ws1.getColumn(1).width=14;ws1.getColumn(2).width=18;
  for(let i=3;i<=6;i++)ws1.getColumn(i).width=9;
  for(let i=7;i<=6+days.length;i++)ws1.getColumn(i).width=6;
  ws1.getColumn(6+days.length+1).width=7;ws1.getColumn(6+days.length+2).width=5;ws1.getColumn(6+days.length+3).width=8;
  // 틀 고정 + 자동 필터 (주간/야간/내외국인/소속/급여방식 필터링 가능)
  ws1.views=[{state:'frozen',xSplit:6,ySplit:2}];
  ws1.autoFilter={from:{row:2,column:1},to:{row:2+emps.length,column:6+days.length+3}};

  // ── 시트2: 일자별 사진 (가로 형태) ──
  // 각 날짜 1행, 사진을 오른쪽 컬럼으로 펼침
  const ws2=wb.addWorksheet(sfMMo+'월 일자별 사진');
  // 최대 사진 수 파악 (컬럼 수 결정용)
  let maxPhotos = 0;
  for(const d of days){
    const k = sfMY+'-'+pad(sfMMo)+'-'+pad(d);
    const photos = SAFETY_REC[k]||[];
    if(photos.length > maxPhotos) maxPhotos = photos.length;
  }
  if(maxPhotos < 1) maxPhotos = 1;
  // 컬럼 너비
  ws2.getColumn(1).width = 10;  // 날짜
  ws2.getColumn(2).width = 6;   // 요일
  ws2.getColumn(3).width = 9;   // 서명자
  ws2.getColumn(4).width = 42;  // 교육내용
  for(let i=0;i<maxPhotos;i++) ws2.getColumn(5+i).width = 22;
  // 타이틀
  ws2.addRow([sfMY+'년 '+sfMMo+'월 일자별 교육내용 및 현장 사진']);
  ws2.getRow(1).font={bold:true,size:14,color:{argb:'FF1E3A5F'}};
  ws2.mergeCells(1,1,1,4+maxPhotos);
  ws2.getRow(1).height=26;
  // 헤더
  const ws2Hdr=['날짜','요일','서명자','교육내용'];
  for(let i=1;i<=maxPhotos;i++) ws2Hdr.push('사진'+i);
  const hRow2=ws2.addRow(ws2Hdr);
  hRow2.eachCell(c=>{
    c.fill={type:'pattern',pattern:'solid',fgColor:NAVY};
    c.font={bold:true,size:10,color:WHITE};
    c.alignment={horizontal:'center',vertical:'middle'};
    c.border={bottom:{style:'thin',color:{argb:'FF94A3B8'}}};
  });
  hRow2.height=24;
  let r2=3;
  // 데이터 행
  for(const d of days){
    const k=sfMY+'-'+pad(sfMMo)+'-'+pad(d);
    const tbm=SAFETY_REC[k+'_tbm']||'';
    const photos=SAFETY_REC[k]||[];
    const signs=SAFETY_REC[k+'_signs']||{};
    const signedCount=Object.values(signs).filter(v=>v).length;
    // 사진/TBM/서명 모두 없는 날짜는 생략
    if(!tbm && photos.length===0 && signedCount===0) continue;
    const dw=new Date(sfMY,sfMMo-1,d).getDay();
    const dowKo=DNW[dw];
    const dowColor=dw===0?{argb:'FFDC2626'}:dw===6?{argb:'FF2563EB'}:{argb:'FF1E293B'};
    // 날짜 행: [날짜, 요일, 서명자수, 교육내용, '', '', ...(사진칸 공란)]
    const rowData=[sfMMo+'/'+d, dowKo, signedCount+'명', tbm];
    for(let i=0;i<maxPhotos;i++) rowData.push('');
    const dataRow=ws2.addRow(rowData);
    dataRow.height=110;  // 사진 높이 맞춤
    // 셀 스타일
    dataRow.getCell(1).font={bold:true,size:11,color:{argb:'FF1E3A5F'}};
    dataRow.getCell(1).alignment={horizontal:'center',vertical:'middle'};
    dataRow.getCell(2).font={bold:true,size:10,color:dowColor};
    dataRow.getCell(2).alignment={horizontal:'center',vertical:'middle'};
    dataRow.getCell(3).font={size:10,color:{argb:'FF059669'}};
    dataRow.getCell(3).alignment={horizontal:'center',vertical:'middle'};
    dataRow.getCell(4).font={size:10,color:{argb:'FF1D4ED8'}};
    dataRow.getCell(4).alignment={wrapText:true,vertical:'middle',horizontal:'left',indent:1};
    // 테두리
    for(let c=1;c<=4+maxPhotos;c++){
      dataRow.getCell(c).border={top:{style:'hair',color:{argb:'FFE2E8F0'}},bottom:{style:'hair',color:{argb:'FFE2E8F0'}},left:{style:'hair',color:{argb:'FFE2E8F0'}},right:{style:'hair',color:{argb:'FFE2E8F0'}}};
    }
    // 사진 삽입 (가로로 펼침): col 5부터
    for(let pi=0;pi<photos.length;pi++){
      const p=photos[pi];
      let inserted=false;
      try{
        const img = await sfFetchPhotoBuffer(p);
        if(img && img.buf && img.buf.byteLength>0){
          const imgId=wb.addImage({buffer:img.buf,extension:img.ext});
          ws2.addImage(imgId,{
            tl:{col:4+pi, row:r2-1},   // 0-indexed: col 4+pi = 엑셀 5+pi열, row r2-1 = 엑셀 r2행
            ext:{width:140, height:100}
          });
          inserted=true;
        }
      }catch(e){console.warn('[엑셀 사진] 삽입 실패:',e);}
      if(!inserted){
        const cell=dataRow.getCell(5+pi);
        cell.value='[사진'+(pi+1)+'] 로드 실패';
        cell.font={size:8,color:{argb:'FFDC2626'},italic:true};
        cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};
      }
    }
    r2++;
  }
  // 좌측 4열 + 상단 2행 고정 (스크롤 시 기준 유지)
  ws2.views=[{state:'frozen',xSplit:4,ySplit:2}];

  // ── 시트3: 요약통계 ──
  const ws3=wb.addWorksheet('요약통계');
  ws3.getColumn(1).width=20;ws3.getColumn(2).width=20;ws3.getColumn(3).width=10;
  ws3.getColumn(4).width=8;ws3.getColumn(5).width=10;ws3.getColumn(6).width=8;
  ws3.getColumn(7).width=8;ws3.getColumn(8).width=12;ws3.getColumn(9).width=12;
  let r3=1;
  ws3.addRow([sfMY+'년 '+sfMMo+'월 안전교육 요약통계']);
  ws3.getRow(r3).font={bold:true,size:14,color:{argb:'FF1E3A5F'}};
  ws3.mergeCells(r3,1,r3,4);r3++;r3++;
  // KPI
  const tbmCount=days.filter(d=>{const k=sfMY+'-'+pad(sfMMo)+'-'+pad(d);return SAFETY_REC[k+'_tbm']||SAFETY_REC[k+'_signs'];}).length;
  const avg=emps.length?Math.round(emps.map(e=>{const r=sfMakeRec(e);return r.reduce((a,b)=>a+b,0)/days.length*100;}).reduce((a,b)=>a+b,0)/emps.length):0;
  const kpis=[['TBM 실시',tbmCount+'회'],['필터 인원',emps.length+'명'],['평균 완료율',avg+'%']];
  kpis.forEach(([label,val])=>{
    const row=ws3.addRow([label,val]);
    row.getCell(1).font={bold:true,size:11,color:{argb:'FF1E3A5F'}};
    row.getCell(1).fill={type:'pattern',pattern:'solid',fgColor:BLUE_BG};
    row.getCell(2).font={bold:true,size:12,color:{argb:'FF059669'}};
    row.getCell(2).alignment={horizontal:'center'};
    r3++;
  });
  r3++;ws3.addRow([]);r3++;
  // 개인별 완료율
  const hdrRow=ws3.addRow(['직원명','영문명','완료수','전체','완료율','주야간','국적','소속','급여방식']);
  hdrRow.eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:NAVY};c.font={bold:true,size:9,color:WHITE};c.alignment={horizontal:'center'};});
  r3++;
  emps.forEach(e=>{
    const rec=sfMakeRec(e);
    const total=rec.reduce((a,b)=>a+b,0);
    const pct=days.length?total/days.length:0;
    const pm2=sfPmLabel(e).t;
    const row=ws3.addRow([e.name||'',e.nameEn||'',total,days.length,pct,
      e.shift==='night'?'야간':'주간',(e.nation==='foreign'||e.foreigner)?'외국인':'내국인',
      e.dept||'',pm2]);
    row.getCell(5).numFmt='0%';
    row.getCell(5).font={bold:true,color:{argb:pct>=0.9?'FF059669':pct>=0.6?'FF1D4ED8':'FFE11D48'}};
    row.eachCell(c=>{c.alignment={horizontal:'center',vertical:'middle'};if(!c.font)c.font={size:9};});
    row.getCell(1).alignment={horizontal:'left'};
    r3++;
  });

  // 다운로드
  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;
  a.download='노프로_안전교육_'+sfMY+'년'+sfMMo+'월.xlsx';
  a.click();URL.revokeObjectURL(url);
}

// 사진 업로드
async function sf2HandleFiles(files){
  if(!files||files.length===0){console.log('[사진] 파일 없음');return;}
  const fileArr=Array.from(files);
  console.log('[사진] 파일 선택됨:', fileArr.length+'개', fileArr.map(f=>f.name));
  const key=sfKey();
  console.log('[사진] 저장 키:', key);
  if(!SAFETY_REC[key])SAFETY_REC[key]=[];
  const imgExts=/\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|tiff?)$/i;
  // 타입 또는 확장자로 이미지 판별, 둘 다 없으면 그냥 허용 (카메라 촬영 등)
  const imageFiles=fileArr.filter(f=>f.type.startsWith('image/')||imgExts.test(f.name)||(!f.type&&f.size>0));
  if(!imageFiles.length){console.log('[사진] 이미지 파일 없음:', fileArr.map(f=>({type:f.type,name:f.name,size:f.size})));return;}
  if(typeof showSyncToast==='function') showSyncToast('사진 업로드 중... ('+imageFiles.length+'장)','info');
  let success=0;
  for(const file of imageFiles){
    try{
      console.log('[사진] 업로드 시작:', file.name, Math.round(file.size/1024)+'KB');
      // base64 먼저 생성 (로컬 표시용 + 엑셀 삽입용)
      const b64=await fileToBase64(file);
      const entry={
        id:'sf_'+Date.now()+'_'+Math.random().toString(36).slice(2),
        name:file.name,
        data:b64,
        ts:Date.now()
      };
      // 서버 업로드 시도
      try{
        const res=await uploadFileToStorage(file,'safety',key);
        console.log('[사진] 서버 업로드 성공:', res.path);
        entry.storagePath=res.path;
      }catch(e2){
        console.warn('[사진] 서버 업로드 실패 (로컬 저장됨):', e2.message);
      }
      // async 중 SAFETY_REC이 폴링 머지로 재할당됐을 수 있어 재확인
      if(typeof SAFETY_REC!=='object'||!SAFETY_REC) SAFETY_REC={};
      if(!Array.isArray(SAFETY_REC[key])) SAFETY_REC[key]=[];
      SAFETY_REC[key].push(entry);
      success++;
    }catch(e){
      console.error('[사진] 처리 실패:', file.name, e);
      if(typeof showSyncToast==='function') showSyncToast(file.name+' 실패: '+e.message,'warn');
    }
  }
  sfSave();
  if(success>0){
    if(typeof showSyncToast==='function') showSyncToast(success+'장 업로드 완료','ok');
    // 서버에 즉시 저장
    try{
      const safetyValue=(()=>{const s={};Object.entries(SAFETY_REC).forEach(([k,v])=>{s[k]=Array.isArray(v)?v.map(({data,...r})=>r):v;});return s;})();
      await safeItemSave('safety',safetyValue);
    }catch(e){console.warn('safety 서버 저장 실패:',e);}
  } else {
    if(typeof showSyncToast==='function') showSyncToast('업로드 실패 - Console(F12) 확인','warn');
  }
  sf2RenderPhotos();
  // 파일 input 초기화 (동일 파일 재선택 허용 — 처리 완료 후 초기화)
  const inp=document.getElementById('sf-file-inp2');if(inp)inp.value='';
  const cam=document.getElementById('sf-file-camera');if(cam)cam.value='';
}
function sf2RenderPhotos(){
  const key=sfKey();
  const photos=SAFETY_REC[key]||[];
  const g=document.getElementById('sf-photo-grid2');if(!g)return;
  g.innerHTML='';
  photos.forEach((p,i)=>{
    const dt=new Date(p.ts);
    const timeStr=`${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    const c=document.createElement('div');c.className='sf-img-card';
    const img=document.createElement('img');
    if(p.data) img.src=p.data;
    else if(p.storagePath){img.dataset.spath=p.storagePath;img.src='';img.style.opacity='0.3';img.style.transition='opacity .3s';}
    img.alt=`사진${i+1}`;img.style.cursor='zoom-in';
    img.addEventListener('click',()=>sf2Zoom(p.id,key));
    c.appendChild(img);
    const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;padding:7px 9px;background:#f8fafc;border-top:1px solid var(--bd)';
    const zb=document.createElement('button');zb.style.cssText='flex:1;padding:5px;font-size:10px;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:700;border:none;background:var(--nbg);color:var(--navy)';zb.textContent='🔍 확대';
    zb.addEventListener('click',e=>{e.stopPropagation();sf2Zoom(p.id,key);});
    const db=document.createElement('button');db.style.cssText='flex:1;padding:5px;font-size:10px;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:700;border:none;background:var(--rbg);color:var(--rose)';db.textContent='🗑 삭제';
    let delReady=false;
    db.addEventListener('click',e=>{
      e.stopPropagation();
      if(!delReady){
        delReady=true;db.textContent='✓ 확인';db.style.background='var(--rose)';db.style.color='#fff';
        setTimeout(()=>{if(delReady){delReady=false;db.textContent='🗑 삭제';db.style.background='var(--rbg)';db.style.color='var(--rose)';}},2500);
      } else {
        if(p.storagePath) deleteFileFromStorage(p.storagePath);
        // async 중 SAFETY_REC이 재할당됐을 수 있어 재확인
        if(typeof SAFETY_REC!=='object'||!SAFETY_REC) SAFETY_REC={};
        if(!Array.isArray(SAFETY_REC[key])) SAFETY_REC[key]=[];
        SAFETY_REC[key]=SAFETY_REC[key].filter(ph=>ph.id!==p.id);
        if(SAFETY_REC[key].length===0)delete SAFETY_REC[key];
        sfSave();sf2RenderPhotos();
        // 서버에도 삭제 상태 반영
        const safetyValue=(()=>{const s={};Object.entries(SAFETY_REC).forEach(([k,v])=>{s[k]=Array.isArray(v)?v.map(({data,...r})=>r):v;});return s;})();
        safeItemSave('safety',safetyValue).catch(()=>{});
      }
    });
    row.appendChild(zb);row.appendChild(db);c.appendChild(row);
    const badge=document.createElement('div');
    badge.className='sf-date-badge';
    badge.textContent=`📷 ${i+1}번 · ${timeStr} 등록`;
    c.appendChild(badge);
    g.appendChild(c);
  });
  // Storage 이미지 URL 로딩
  loadStorageImages(g);
  const icon=document.getElementById('sf-drop-icon2');
  const txt=document.getElementById('sf-drop-t2');
  if(icon&&txt){if(photos.length>0){icon.textContent='➕';txt.textContent=`${photos.length}장 등록됨 · 추가 가능`;}else{icon.textContent='📁';txt.textContent='교육 사진 드래그 또는 클릭';}}
}
// 사진 확대 (Storage URL 지원)
async function sf2Zoom(id,key){
  if(!key)key=sfKey();
  const photos=SAFETY_REC[key]||[];
  const p=photos.find(x=>x.id===id);
  if(!p)return;
  let src=p.data||'';
  if(p.storagePath&&!src){
    const urls=await getFileUrls([p.storagePath]);
    src=urls[p.storagePath]||'';
  }
  if(!src)return;
  const lb=document.createElement('div');lb.className='sf-lightbox';
  const img=document.createElement('img');img.src=src;img.alt='확대';
  lb.appendChild(img);lb.addEventListener('click',()=>lb.remove());
  document.body.appendChild(lb);
}

// 드래그앤드롭 초기화 (중복 리스너 방지)
let _sfDropInited=false;
function sfInitDrop(){
  const dz=document.getElementById('sf-drop-zone2');
  if(!dz||_sfDropInited)return;
  _sfDropInited=true;
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');sf2HandleFiles(e.dataTransfer.files);});
}

// KPI 클릭 필터
function sfSetKpi(v,el){
  document.querySelectorAll('[id^="sf-kpi-"]').forEach(k=>{k.style.background='var(--surf)';k.style.borderColor='transparent';});
  el.style.background=v==='all'?'var(--nbg)':v==='done'?'var(--gbg)':v==='wait'?'var(--rbg)':'var(--abg)';
  el.style.borderColor=v==='all'?'var(--navy)':v==='done'?'#6EE7B7':v==='wait'?'#FCA5A5':'#FCD34D';
  sf2StF='all';sf2NaF='all';sf2ShF='all';sf2DpF='all';sf2PmF='all';
  if(v==='done')sf2StF='done';else if(v==='wait')sf2StF='wait';else if(v==='foreign')sf2NaF='foreign';
  sfResetChips();sfRenderList();
}
function sfFc(key,val,el){
  const row=el.closest('[id^="sf-chips-"]');
  if(row)row.querySelectorAll('.sf-chip').forEach(c=>c.classList.remove('sf-chip-on'));
  el.classList.add('sf-chip-on');
  if(key==='st')sf2StF=val;
  else if(key==='na')sf2NaF=val;
  else if(key==='sh')sf2ShF=val;
  else if(key==='dp')sf2DpF=val;
  else if(key==='pm')sf2PmF=val;
  sfRenderList();
}
function sfResetChips(){
  ['sf-chips-st','sf-chips-na','sf-chips-sh','sf-chips-dp','sf-chips-pm'].forEach(id=>{
    const row=document.getElementById(id);
    if(row)row.querySelectorAll('.sf-chip').forEach((c,i)=>{c.classList.remove('sf-chip-on');if(i===0)c.classList.add('sf-chip-on');});
  });
}

// 소속 칩/셀렉트 동적 생성
function sfInitDeptChips(){
  const dpts=[...new Set(EMPS.filter(e=>!e.leave).map(e=>e.dept||'').filter(Boolean))].sort();
  const chipRow=document.getElementById('sf-chips-dp');
  if(chipRow){
    chipRow.innerHTML='<span class="sf-chip sf-chip-on" onclick="sfFc(\'dp\',\'all\',this)">전체</span>'
      +dpts.map(d=>`<span class="sf-chip" onclick="sfFc('dp','${d}',this)">${d}</span>`).join('');
  }
  const sel=document.getElementById('sf-f-dp');
  if(sel){
    sel.innerHTML='<option value="all">소속 전체</option>'
      +dpts.map(d=>`<option value="${d}">${d}</option>`).join('');
  }
}

// 급여방식 레이블/색상
function sfPmLabel(e){
  const m=e.payMode||'fixed';
  if(m==='pohal')  return{t:'포괄임금',c:'#7C3AED',bg:'#F5F3FF'};
  if(m==='monthly')return{t:'월급제',  c:'#854F0B',bg:'#FEF3C7'};
  if(m==='hourly') return{t:'시급제',  c:'#0891B2',bg:'#CFFAFE'};
  return               {t:'통상임금제',c:'#059669',bg:'#ECFDF5'};
}

// 인원 리스트 렌더 (EMPS 배열 + 실제 서명 데이터)
function sfRenderList(){
  const srch=(document.getElementById('sf-srch')||{}).value||'';
  const q=srch.trim().toLowerCase();
  const signs=SAFETY_REC[sfKey()+'_signs']||{};
  const list=EMPS.filter(e=>{
    if(e.leave)return false;
    const isFor=e.nation==='foreign'||e.foreigner===true;
    if(sf2NaF==='korean'&&isFor)return false;
    if(sf2NaF==='foreign'&&!isFor)return false;
    if(sf2ShF!=='all'&&(e.shift||'day')!==sf2ShF)return false;
    if(sf2DpF!=='all'&&(e.dept||'')!==sf2DpF)return false;
    if(sf2PmF!=='all'){const ep=e.payMode||'fixed';if(sf2PmF==='monthly'){if(ep!=='monthly'&&ep!=='pohal')return false;}else{if(ep!==sf2PmF)return false;}}
    if(sf2StF==='done'&&!signs[String(e.id)])return false;
    if(sf2StF==='wait'&&signs[String(e.id)])return false;
    if(q&&!(e.name||'').toLowerCase().includes(q))return false;
    return true;
  });
  const active=EMPS.filter(e=>!e.leave);
  const total=active.length;
  const signedCount=active.filter(e=>signs[String(e.id)]).length;
  const foreignCount=active.filter(e=>e.nation==='foreign'||e.foreigner===true).length;
  // KPI 업데이트
  const kvAll=document.getElementById('sf-kv-all');if(kvAll)kvAll.textContent=total;
  const kvDone=document.getElementById('sf-kv-done');if(kvDone)kvDone.textContent=signedCount;
  const kvWait=document.getElementById('sf-kv-wait');if(kvWait)kvWait.textContent=total-signedCount;
  const kvFo=document.getElementById('sf-kv-fo');if(kvFo)kvFo.textContent=foreignCount;
  // 진행률 바 업데이트
  const dayEmps=active.filter(e=>(e.shift||'day')==='day');
  const nightEmps=active.filter(e=>e.shift==='night');
  const foEmps=active.filter(e=>e.nation==='foreign'||e.foreigner===true);
  const dayDone=dayEmps.filter(e=>signs[String(e.id)]).length;
  const nightDone=nightEmps.filter(e=>signs[String(e.id)]).length;
  const foDone=foEmps.filter(e=>signs[String(e.id)]).length;
  const barDay=document.getElementById('sf-bar-day');if(barDay)barDay.style.width=(dayEmps.length?Math.round(dayDone/dayEmps.length*100):0)+'%';
  const barNight=document.getElementById('sf-bar-night');if(barNight)barNight.style.width=(nightEmps.length?Math.round(nightDone/nightEmps.length*100):0)+'%';
  const barFo=document.getElementById('sf-bar-fo');if(barFo)barFo.style.width=(foEmps.length?Math.round(foDone/foEmps.length*100):0)+'%';
  const lblDay=document.getElementById('sf-lbl-day');if(lblDay)lblDay.textContent=`${dayDone}/${dayEmps.length}`;
  const lblNight=document.getElementById('sf-lbl-night');if(lblNight)lblNight.textContent=`${nightDone}/${nightEmps.length}`;
  const lblFo=document.getElementById('sf-lbl-fo');if(lblFo)lblFo.textContent=`${foDone}/${foEmps.length}`;
  const cntEl=document.getElementById('sf-lcnt');
  const listEl=document.getElementById('sf-nlist');
  if(!listEl)return;
  if(cntEl)cntEl.textContent=`${list.length}명 표시 (전체 ${total}명)`;
  if(list.length===0){
    listEl.innerHTML='<div style="text-align:center;color:var(--ink3);padding:16px;font-size:11px;">검색 결과 없음</div>';
    return;
  }
  listEl.innerHTML=list.map(e=>{
    const nm=e.name||'';
    const shLabel=e.shift==='night'?'야간':'주간';
    const naLabel=e.nation==='foreign'?'외국인':'내국인';
    const dp=e.dept||'';
    const pm=sfPmLabel(e);
    const signed=!!signs[String(e.id)];
    return`<div class="sf-ni" style="margin-bottom:3px">
      <div style="width:7px;height:7px;border-radius:50%;background:${signed?'#059669':'#E11D48'};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;font-weight:700;color:var(--ink)">${nm} <span style="font-size:8px;color:${signed?'#059669':'#E11D48'};font-weight:600">${signed?'✓':'—'}</span></div>
        <div style="font-size:8px;color:var(--ink3)">${shLabel} · ${naLabel} · ${dp}</div>
      </div>
      <span style="font-size:8px;padding:1px 5px;border-radius:20px;background:${pm.bg};color:${pm.c};font-weight:700">${pm.t}</span>
    </div>`;
  }).join('');
  sfMatchSidebarHeight();
}

// 사이드바 높이를 왼쪽 메인 컨텐츠에 맞춤
function sfMatchSidebarHeight(){
  const main=document.querySelector('#sf-page-daily > div:first-child');
  const sidebar=document.getElementById('sf-sidebar');
  if(!main||!sidebar)return;
  requestAnimationFrame(()=>{
    const h=main.offsetHeight;
    if(h>0) sidebar.style.maxHeight=h+'px';
  });
}

// 최근 일지
function sfRenderRecent(){
  const el=document.getElementById('sf-recent-list');if(!el)return;
  const today=new Date(sfY,sfM-1,sfD);
  const days=[];
  for(let i=1;i<=7;i++){
    const d=new Date(today);d.setDate(today.getDate()-i);
    const k=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const tbm=SAFETY_REC[k+'_tbm']||'';
    const photos=(SAFETY_REC[k]||[]).length;
    if(tbm||photos>0){
      days.push({date:`${d.getMonth()+1}/${d.getDate()}일`,tbm:tbm.slice(0,30)+(tbm.length>30?'...':''),photos});
    }
  }
  if(days.length===0){el.innerHTML='<div style="font-size:11px;color:var(--ink3);text-align:center;padding:12px">아직 기록된 일지가 없습니다</div>';return;}
  el.innerHTML=days.map(d=>`<div style="display:flex;align-items:center;gap:9px;padding:7px 9px;background:var(--surf);border-radius:8px;margin-bottom:4px">
    <span style="font-size:10px;font-weight:700;color:var(--ink);min-width:46px">${d.date}</span>
    <span style="flex:1;font-size:10px;color:var(--ink3)">${d.tbm||'교육내용 없음'}</span>
    ${d.photos>0?`<span style="font-size:10px;color:var(--teal);font-weight:700">📷${d.photos}</span>`:''}
  </div>`).join('');
  sfMatchSidebarHeight();
}

// 월별 현황표 — 해당 월 전체 일수 동적 생성
function sfGetMonthDays(y,m){
  const total=new Date(y,m,0).getDate();
  const days=[];
  for(let d=1;d<=total;d++) days.push(d);
  return days;
}
const SF_TBM_CONT={1:'고소작업 안전수칙',2:'화기작업 허가절차',3:'중량물 취급',6:'전기작업 감전예방',7:'개인보호구 착용',8:'작업장 정리정돈',9:'화학물질 취급',10:'추락 방지',13:'비상구 대피요령',14:'폐수처리 안전점검',15:'고압가스 취급',16:'안전점검 체크리스트',17:'협착사고 예방',20:'소음·진동 안전수칙',21:'방호장치 점검',22:'안전보건 표지판'};

function sfChgM(d){
  // 상단 날짜 바의 월을 변경
  sfM+=d;if(sfM>12){sfM=1;sfY++;}if(sfM<1){sfM=12;sfY--;}
  sfD=Math.min(sfD,new Date(sfY,sfM,0).getDate());
  sfUpdBar2();sfLoadTbm();sfRenderList();sfRenderRecent();
  sfRenderM();
}
function sfSetMF(v,btn){
  sfMStF=v;
  document.querySelectorAll('.sf-fbtn').forEach(b=>{b.classList.remove('sf-fbtn-on');});
  btn.classList.add('sf-fbtn-on');sfRenderM();
}
function sfRenderM(){
  // 상단 날짜 바와 동기화
  sfMY=sfY; sfMMo=sfM;
  const lbl=document.getElementById('sf-m-lbl');
  if(lbl)lbl.textContent=`${sfMY}년 ${sfMMo}월`;
  let emps=sfGetFilteredEmps();
  if(sfMStF!=='all'){
    emps=emps.filter(e=>{
      const rec=sfMakeRec(e);
      const total=rec.reduce((a,b)=>a+b,0);
      return sfMStF==='done'?total===rec.length:total<rec.length;
    });
  }
  const DNW=['일','월','화','수','목','금','토'];
  const days=sfGetMonthDays(sfMY,sfMMo);
  const t=document.getElementById('sf-mt');if(!t)return;
  let h=`<thead><tr><th style="padding:7px 9px;background:var(--navy);color:#fff;font-weight:700;white-space:nowrap;text-align:left;font-size:9px;position:sticky;left:0;z-index:3;min-width:110px">직원 (${emps.length}명)</th>`;
  days.forEach(d=>{
    const dw=new Date(sfMY,sfMMo-1,d).getDay();
    const c=dw===0?'color:#EF4444':dw===6?'color:#93C5FD':'';
    h+=`<th style="padding:7px 6px;background:var(--navy);color:#fff;font-size:9px;text-align:center;white-space:nowrap;min-width:34px;${c}">${d}일<br><span style="font-size:8px;opacity:.7">${DNW[dw]}</span></th>`;
  });
  h+=`<th style="padding:7px 9px;background:#059669;color:#fff;font-size:9px;text-align:center;min-width:50px">완료율</th></tr></thead><tbody>`;
  if(emps.length===0){
    h+=`<tr><td colspan="${days.length+2}" style="text-align:center;padding:24px;color:var(--ink3);font-size:11px">표시할 인원이 없습니다</td></tr>`;
  }
  emps.forEach(e=>{
    const rec=sfMakeRec(e);
    const total=rec.reduce((a,b)=>a+b,0);
    const pct=days.length?Math.round(total/days.length*100):0;
    const pc=pct===100?'#059669':pct>=70?'#1D4ED8':'#E11D48';
    const shLabel=e.shift==='night'?'야간':'주간';
    const naLabel=e.nation==='foreign'?'외국인':'내국인';
    const pm2=sfPmLabel(e);
    h+=`<tr><td style="padding:6px 9px;border-bottom:1px solid var(--bd);position:sticky;left:0;z-index:1;background:var(--card);border-right:1px solid var(--bd)">
      <div style="font-size:10px;font-weight:700">${e.name||''}</div>
      <div style="font-size:8px;color:var(--ink3)">${shLabel} · ${naLabel} · ${e.dept||''}</div>
      <span style="font-size:7px;padding:1px 4px;border-radius:20px;background:${pm2.bg};color:${pm2.c};font-weight:700">${pm2.t}</span>
    </td>`;
    rec.forEach(v=>{h+=v===1?`<td style="padding:6px 9px;border-bottom:1px solid var(--bd);text-align:center"><span style="background:var(--gbg);color:#065F46;border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700">✓</span></td>`:`<td style="padding:6px 9px;border-bottom:1px solid var(--bd);text-align:center;color:var(--ink3);font-size:9px">—</td>`;});
    h+=`<td style="padding:6px 9px;border-bottom:1px solid var(--bd);text-align:center;font-weight:700;color:${pc};font-size:10px">${pct}%<br><span style="font-size:8px;color:var(--ink3)">${total}/${days.length}</span></td></tr>`;
  });
  h+=`</tbody>`;t.innerHTML=h;
}

// 월간 현황
function sfRenderSummary(){
  // 달력
  const cal=document.getElementById('sf-cal');if(!cal)return;
  cal.innerHTML='';
  const y=sfY,mo=sfM,days=new Date(y,mo,0).getDate(),fd=new Date(y,mo-1,1).getDay();
  const today=new Date();
  // TBM 기록이 있는 날짜 (교육내용 또는 서명 존재)
  const tbmSet=new Set();
  const photoSet=new Set();
  for(let d=1;d<=days;d++){
    const k=`${y}-${pad(mo)}-${pad(d)}`;
    if(SAFETY_REC[k+'_tbm']||SAFETY_REC[k+'_signs'])tbmSet.add(d);
    const photos=SAFETY_REC[k];
    if(Array.isArray(photos)&&photos.length>0)photoSet.add(d);
  }
  for(let i=0;i<fd;i++){const e=document.createElement('div');e.style.cssText='visibility:hidden';e.textContent='x';cal.appendChild(e);}
  for(let d=1;d<=days;d++){
    const e=document.createElement('div');
    const isToday=y===today.getFullYear()&&mo===today.getMonth()+1&&d===today.getDate();
    const has=tbmSet.has(d),hasP=photoSet.has(d),fut=d>today.getDate()&&y===today.getFullYear()&&mo===today.getMonth()+1;
    if(isToday)e.style.cssText='padding:4px 2px;border-radius:6px;text-align:center;background:var(--navy);color:#fff;font-weight:700;font-size:10px;min-height:34px;cursor:pointer';
    else if((has||hasP)&&!fut)e.style.cssText='padding:4px 2px;border-radius:6px;text-align:center;background:#DBEAFE;color:#1D4ED8;font-weight:700;border:1px solid #93C5FD;font-size:10px;min-height:34px;cursor:pointer';
    else if(fut)e.style.cssText='padding:4px 2px;border-radius:6px;text-align:center;color:var(--bd2);font-size:10px;min-height:34px';
    else e.style.cssText='padding:4px 2px;border-radius:6px;text-align:center;font-size:10px;min-height:34px;border:1px solid transparent';
    const hasPhoto=photoSet.has(d);
    let cellSub='';
    if(!fut){
      if(has&&hasPhoto)cellSub=`<div style="font-size:7px;color:#1D4ED8">✓TBM</div><div style="font-size:7px;color:#059669;font-weight:700">이미지완료</div>`;
      else if(has)cellSub=`<div style="font-size:8px;color:#1D4ED8">✓TBM</div>`;
      else if(hasPhoto)cellSub=`<div style="font-size:7px;color:#059669;font-weight:700">이미지완료</div>`;
    }
    e.innerHTML=`<div>${d}</div>${cellSub}`;
    if(!fut){
      e.style.cursor='pointer';
      e.addEventListener('click',(()=>{const dd=d;return()=>{sfD=dd;sfUpdBar2();sfLoadTbm();sfRenderList();sfRenderRecent();sf2RenderPhotos();sfSwitchTab('daily');}})());
    }
    cal.appendChild(e);
  }
  // 일별 목록
  const rows=document.getElementById('sf-sum-rows');
  if(rows){
    // TBM 기록이 있는 날짜만 최근 6개 표시
    const allDays=sfGetMonthDays(sfY,sfM);
    const recent=allDays.filter(d=>{
      if(d>sfD)return false;
      const k=`${sfY}-${pad(sfM)}-${pad(d)}`;
      return SAFETY_REC[k+'_tbm']||SAFETY_REC[k+'_signs'];
    }).reverse().slice(0,6);
    rows.innerHTML=recent.length?recent.map(d=>{
      const k=`${sfY}-${pad(sfM)}-${pad(d)}`;
      const tbm=SAFETY_REC[k+'_tbm']||'';
      return`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--bd)">
      <span style="font-size:10px;font-weight:700;min-width:40px">${sfM}/${d}일</span>
      <span style="flex:1;font-size:10px;color:var(--ink3)">${tbm||SF_TBM_CONT[d]||''}</span>
    </div>`;}).join(''):'<div style="font-size:10px;color:var(--ink3);text-align:center;padding:8px">이번 달 기록 없음</div>';
  }
  // 개인별 이수율 (실제 서명 데이터 기반)
  const prog=document.getElementById('sf-sum-prog');
  if(prog&&EMPS.length>0){
    const show=EMPS.filter(e=>!e.leave).slice(0,8);
    const pastDays=sfGetMonthDays(sfY,sfM).filter(d=>d<=sfD);
    const daysCount=pastDays.length;
    prog.innerHTML=show.map(e=>{
      let done=0;
      pastDays.forEach(d=>{
        const dateKey=`${sfY}-${pad(sfM)}-${pad(d)}`;
        const signs=SAFETY_REC[dateKey+'_signs']||{};
        if(signs[String(e.id)])done++;
      });
      const pct=daysCount?Math.min(100,Math.round(done/daysCount*100)):0;
      const pc=pct===100?'var(--green)':pct>=70?'#1D4ED8':'var(--rose)';
      return`<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
        <span style="font-size:9px;color:var(--ink3);min-width:68px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name)}</span>
        <div style="flex:1;height:4px;background:var(--surf);border-radius:99px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${pc};border-radius:99px"></div></div>
        <span style="font-size:9px;font-weight:600;min-width:26px;text-align:right;color:${pc}">${pct}%</span>
      </div>`;
    }).join('');
  }
  // 요약 건수
  const cnt=document.getElementById('sf-sum-cnt');
  // TBM 실시 횟수 = 기록이 있는 날짜 수
  if(cnt){
    const allD=sfGetMonthDays(sfY,sfM);
    const tbmCount=allD.filter(d=>{
      if(d>sfD)return false;
      const k=`${sfY}-${pad(sfM)}-${pad(d)}`;
      return SAFETY_REC[k+'_tbm']||SAFETY_REC[k+'_signs'];
    }).length;
    cnt.textContent=tbmCount+'회';
  }
}

// 실시간 서명 폴링
let sfPollTimer=null;
function sfStartPoll(){
  sfStopPoll();
  sfPollTimer=setInterval(async()=>{
    try{
      const res=await fetch('/api/data-load',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'include',
        body:JSON.stringify({key:'safety'})
      });
      if(!res.ok)return;
      const map=await res.json();
      if(map&&map.safety){
        Object.keys(map.safety).forEach(k=>{
          if(k.endsWith('_signs'))SAFETY_REC[k]=map.safety[k];
        });
        sfRenderList();
      }
    }catch(e){}
  },10000);
}
function sfStopPoll(){if(sfPollTimer){clearInterval(sfPollTimer);sfPollTimer=null;}}

// renderSafety (gp('safety') 호출용)
function renderSafety(){
  sfUpdBar2();sfLoadTbm();sfInitDeptChips();sfRenderList();sfRenderRecent();
  sf2RenderPhotos();
  sfInitDrop();
  sfSwitchTab('daily');
  sfStartPoll();
}

function sfGoDate(dateStr){const[y,m,d]=dateStr.split('-').map(Number);sfY=y;sfM=m;sfD=d;renderSafety();}


// ══════════════════════════════════════
// 연차 관리
// ══════════════════════════════════════
let leaveYear = new Date().getFullYear();
let leaveSettings = JSON.parse(localStorage.getItem('npm5_leave_settings')||'{}');

// leaveOverrides 로드 + 유효하지 않은 값 정리
function loadLeaveOverrides() {
  const raw = JSON.parse(localStorage.getItem('npm5_leave_overrides')||'{}');
  // used가 null/undefined인 항목 정리
  Object.keys(raw).forEach(empId => {
    Object.keys(raw[empId]).forEach(yr => {
      if (raw[empId][yr].used === null) delete raw[empId][yr].used;
      if (Object.keys(raw[empId][yr]).length === 0) delete raw[empId][yr];
    });
    if (Object.keys(raw[empId]).length === 0) delete raw[empId];
  });
  return raw;
}
// {payMode:'hourly', overrides:{empId:{year:{total,used}}}}
let leaveOverrides = loadLeaveOverrides();

function saveLeaveCustomAmount(val){
  leaveSettings.customAmount = parseFloat(val) || 0;
  localStorage.setItem("npm5_leave_settings", JSON.stringify(leaveSettings));
  saveLS(); // Supabase DB 동기화
  renderLeave();
}
function saveLeaveSettings(){
  leaveSettings.payMode = document.getElementById("leave-pay-mode")?.value || "hourly";
  const calcSel = document.getElementById("leave-calc-mode");
  if (calcSel) leaveSettings.calcMode = calcSel.value || 'fiscal';
  localStorage.setItem("npm5_leave_settings", JSON.stringify(leaveSettings));
  saveLS(); // Supabase DB 동기화
  var wrap = document.getElementById("leave-custom-wrap");
  if(wrap) wrap.style.display = leaveSettings.payMode === "custom" ? "flex" : "none";
  renderLeave();
}

function leaveYearNav(d){ leaveYear += d; renderLeave(); }

// ── 연차 계산 핵심 로직 ──
// calcMode: 'fiscal' (회계연도 기준, 기본) / 'joinDate' (입사일 기준)
function calcLeaveForYear(emp, year) {
  const mode = leaveSettings.calcMode || 'fiscal';
  if (mode === 'joinDate') return calcLeaveByJoinDate(emp, year);
  return calcLeaveByFiscal(emp, year);
}

// ── 회계연도(1/1~12/31) 기준 ──
// nodong.kr 연차계산기 로직 준용
// 1년차(입사년): 매월 1개씩 (최대 11개)
// 2년차(첫 회계연도): 비례배분 15 × (첫회계일-입사일)/365 (일 기준)
// 3년차: 15일
// 4년차~: 15 + floor((회계연수)/2), 최대 25일
// 월별 만근 판정: 해당 calendar 월에 REC.absent=true인 날이 있으면 false
// 연차·반차는 만근 인정. REC 없는 날(미입력)은 결근 아님으로 간주.
function hadFullAttendance(emp, year, month) {
  if (month < 1 || month > 12) return true;
  const days = dim(year, month);
  for (let d = 1; d <= days; d++) {
    const rec = REC[rk(emp.id, year, month, d)];
    if (rec && rec.absent) return false;
  }
  return true;
}

function calcLeaveByFiscal(emp, year) {
  const r2 = v => Math.round(v * 10) / 10;
  // Override: 엑셀 기반 {baselineTotal, baselineRemain, untilMonth}
  // OR 수동 사용 override {used} — 엑셀 미업로드 시 사용자가 직접 입력한 사용일수
  const ov = (leaveOverrides[emp.id] && leaveOverrides[emp.id][year]) || null;
  const hasBaseline = ov && ov.baselineTotal !== undefined && ov.untilMonth;

  if (!emp.join) {
    const u = (ov && ov.used !== undefined && ov.used !== null) ? ov.used : 0;
    return { total: 0, accrued: 0, used: r2(u), remain: r2(0 - u), monthly: [] };
  }

  const joinDate = new Date(emp.join);
  const joinY = joinDate.getFullYear();
  const joinM = joinDate.getMonth(); // 0-indexed

  const yearStart = new Date(year, 0, 1);
  const today = new Date();

  if (emp.leave) {
    const leaveDate = new Date(emp.leave);
    if (leaveDate < yearStart) {
      const u = (ov && ov.used !== undefined && ov.used !== null) ? ov.used : 0;
      return { total: 0, accrued: 0, used: r2(u), remain: r2(0 - u), monthly: [] };
    }
  }
  if (year < joinY) {
    const u = (ov && ov.used !== undefined && ov.used !== null) ? ov.used : 0;
    return { total: 0, accrued: 0, used: r2(u), remain: r2(0 - u), monthly: [] };
  }

  const yearsWorked = year - joinY;
  let total = 0;
  let monthly = [];

  if (yearsWorked === 0) {
    // 1년차(입사년): 월 만근 시 매월 1개씩 적립
    for (let m = 0; m < 12; m++) {
      const accrueDate = new Date(joinY, joinM + m + 1, joinDate.getDate());
      if (accrueDate.getFullYear() !== year) {
        monthly.push({ month: m + 1, count: 0, date: null });
        continue;
      }
      const cutoff = emp.leave ? new Date(emp.leave) : today;
      let earned = 0;
      if (accrueDate <= cutoff) {
        // accrueDate 전 calendar 월 = 만근 체크 대상월 (1-indexed)
        const workMonth = accrueDate.getMonth(); // Feb(getMonth=1) → 1(Jan, 1-indexed)
        const workYear = accrueDate.getFullYear();
        if (workMonth >= 1 && hadFullAttendance(emp, workYear, workMonth)) earned = 1;
      }
      monthly.push({ month: m + 1, count: earned, date: accrueDate });
      total += earned;
    }
  } else {
    let baseLeave;
    if (yearsWorked === 1) {
      // 2년차: 비례배분 15 × (첫회계일 - 입사일) / 365 (일 기준, nodong.kr 방식)
      const firstFiscal = new Date(year, 0, 1);
      const daysDiff = Math.round((firstFiscal - joinDate) / (1000 * 60 * 60 * 24));
      baseLeave = 15 * daysDiff / 365;
      baseLeave = Math.max(0, Math.min(baseLeave, 15));
    } else if (yearsWorked === 2) {
      // 3년차: 15일 고정
      baseLeave = 15;
    } else {
      // 4년차~: nodong.kr 엑셀 수식 준용
      // 입사일이 1/1인 경우: 15 + floor((yw-1)/2) → 4년차부터 가산 시작
      // 입사일이 1/1 외인 경우: 15 + floor((yw-2)/2) → 5년차부터 가산 시작
      const isJoinOnFiscalStart = (joinM === 0 && joinDate.getDate() === 1);
      const extra = isJoinOnFiscalStart
        ? Math.floor((yearsWorked - 1) / 2)
        : Math.floor((yearsWorked - 2) / 2);
      baseLeave = Math.min(15 + extra, 25);
    }
    total = baseLeave;
    for (let m = 0; m < 12; m++) {
      monthly.push({ month: m + 1, count: 0, date: null });
    }
    monthly[0].count = total;
    monthly[0].date = new Date(year, 0, 1);
  }

  // 1) 엑셀 baseline 있음: baselineTotal/Remain 기준 + 기준월 이후 적립/사용
  if (hasBaseline) {
    // postAccrued: 엑셀 기준월 이후 = 만근 기반 적립 (work month > untilMonth인 것만)
    const postAccrued = monthly.reduce((sum, mv) => {
      if (!mv.date || !mv.count) return sum;
      const workMonth = mv.date.getMonth(); // 1-indexed prev calendar month
      if (workMonth <= ov.untilMonth) return sum; // 엑셀이 이미 반영
      return sum + mv.count;
    }, 0);
    const tTotal = ov.baselineTotal + postAccrued;
    // 수동 used가 있으면 우선. 없으면 엑셀 사용분(baselineTotal-baselineRemain) + 이후 REC 사용분.
    const tUsed = (ov.used !== undefined && ov.used !== null)
      ? ov.used
      : (ov.baselineTotal - ov.baselineRemain) + countUsedLeave(emp.id, year, ov.untilMonth + 1);
    const tRemain = tTotal - tUsed;
    return { total: r2(tTotal), accrued: r2(tTotal), used: r2(tUsed), remain: r2(tRemain), monthly };
  }
  // 2) 수동 used override (Excel 없이 사용자가 직접 수정한 값)
  if (ov && ov.used !== undefined && ov.used !== null) {
    const used = ov.used;
    return { total: r2(total), accrued: r2(total), used: r2(used), remain: r2(total - used), monthly };
  }
  // 3) 자동계산 (override 없음)
  const autoUsed = countUsedLeave(emp.id, year, 1);
  return { total: r2(total), accrued: r2(total), used: r2(autoUsed), remain: r2(total - autoUsed), monthly };
}

// ── 입사일 기준 ──
// 입사 첫해: 입사 다음달부터 매월 1개씩 (최대 11개)
// 1년차(입사기념일): 15일 일괄 발생
// 2년차 이후: 15개 + 2년마다 1개 추가 (최대 25개), 입사기념일에 일괄 발생
function calcLeaveByJoinDate(emp, year) {
  const r2 = v => Math.round(v * 10) / 10;
  const ov = (leaveOverrides[emp.id] && leaveOverrides[emp.id][year]) || null;
  const hasBaseline = ov && ov.baselineTotal !== undefined && ov.untilMonth;

  if (!emp.join) {
    const u = (ov && ov.used !== undefined && ov.used !== null) ? ov.used : 0;
    return { total: 0, accrued: 0, used: r2(u), remain: r2(0 - u), monthly: [] };
  }

  const joinDate = new Date(emp.join);
  const joinY = joinDate.getFullYear();
  const joinM = joinDate.getMonth(); // 0-indexed
  const joinD = joinDate.getDate();

  const yearStart = new Date(year, 0, 1);
  const today = new Date();

  if (emp.leave) {
    const leaveDate = new Date(emp.leave);
    if (leaveDate < yearStart) {
      const u = (ov && ov.used !== undefined && ov.used !== null) ? ov.used : 0;
      return { total: 0, accrued: 0, used: r2(u), remain: r2(0 - u), monthly: [] };
    }
  }
  if (year < joinY) {
    const u = (ov && ov.used !== undefined && ov.used !== null) ? ov.used : 0;
    return { total: 0, accrued: 0, used: r2(u), remain: r2(0 - u), monthly: [] };
  }

  let total = 0;
  let monthly = [];

  if (year === joinY) {
    // 입사 첫해: 월 만근 시 매월 1개씩 적립 (입사 다음달부터)
    for (let m = 0; m < 12; m++) {
      const accrueDate = new Date(joinY, joinM + m + 1, joinD);
      if (accrueDate.getFullYear() !== year) {
        monthly.push({ month: m + 1, count: 0, date: null });
        continue;
      }
      const cutoff = emp.leave ? new Date(emp.leave) : today;
      let earned = 0;
      if (accrueDate <= cutoff) {
        const workMonth = accrueDate.getMonth(); // 1-indexed prev calendar month
        const workYear = accrueDate.getFullYear();
        if (workMonth >= 1 && hadFullAttendance(emp, workYear, workMonth)) earned = 1;
      }
      monthly.push({ month: m + 1, count: earned, date: accrueDate });
      total += earned;
    }
  } else {
    // 1년차 이상: 입사기념일에 일괄 발생
    const yearsAtAnniv = year - joinY; // 해당 연도 기념일 시점 근속연수
    let baseLeave;
    if (yearsAtAnniv === 1) {
      baseLeave = 15; // 입사일 기준: 1년 만근 시 15일 전체 발생
    } else {
      const extra = Math.floor((yearsAtAnniv - 1) / 2);
      baseLeave = Math.min(15 + extra, 25);
    }
    total = baseLeave;

    // monthly: 입사 기념월에 일괄 발생
    for (let m = 0; m < 12; m++) {
      monthly.push({ month: m + 1, count: 0, date: null });
    }
    monthly[joinM].count = total;
    monthly[joinM].date = new Date(year, joinM, joinD);
  }

  // 1) 엑셀 baseline
  if (hasBaseline) {
    const postAccrued = monthly.reduce((sum, mv) => {
      if (!mv.date || !mv.count) return sum;
      const workMonth = mv.date.getMonth();
      if (workMonth <= ov.untilMonth) return sum;
      return sum + mv.count;
    }, 0);
    const tTotal = ov.baselineTotal + postAccrued;
    const tUsed = (ov.used !== undefined && ov.used !== null)
      ? ov.used
      : (ov.baselineTotal - ov.baselineRemain) + countUsedLeave(emp.id, year, ov.untilMonth + 1);
    const tRemain = tTotal - tUsed;
    return { total: r2(tTotal), accrued: r2(tTotal), used: r2(tUsed), remain: r2(tRemain), monthly };
  }
  // 2) 수동 used override
  if (ov && ov.used !== undefined && ov.used !== null) {
    const used = ov.used;
    return { total: r2(total), accrued: r2(total), used: r2(used), remain: r2(total - used), monthly };
  }
  // 3) 자동계산
  const autoUsed = countUsedLeave(emp.id, year, 1);
  return { total: r2(total), accrued: r2(total), used: r2(autoUsed), remain: r2(total - autoUsed), monthly };
}

function countUsedLeave(empId, year, fromMonth) {
  let used = 0;
  const startM = Math.max(1, fromMonth || 1);
  for (let m = startM; m <= 12; m++) {
    const days = dim(year, m);
    for (let d = 1; d <= days; d++) {
      const rec = REC[rk(empId, year, m, d)];
      if (!rec) continue;
      if (rec.annual) used += 1;
      else if (rec.halfAnnual) used += 0.5;
    }
  }
  return used;
}

function importLeaveFromExcel(){// 미사용 (제거 예정)
  // 한국인(38명) + 외국인(20명) 2026년 1~3월 연차/반차 데이터 (224건)
  // 메리 클레어2 → 메리클레어 매핑 적용됨
  const LEAVE_DATA=[{"n":"정혜림","m":1,"d":12,"v":0.5},{"n":"이혜원","m":1,"d":16,"v":1},{"n":"이혜원","m":1,"d":30,"v":1},{"n":"이종규","m":1,"d":2,"v":1},{"n":"심치섭","m":1,"d":22,"v":1},{"n":"김지왕","m":1,"d":5,"v":1},{"n":"이승철","m":1,"d":21,"v":0.5},{"n":"노효순","m":1,"d":9,"v":1},{"n":"신현창","m":1,"d":8,"v":1},{"n":"박성숙","m":1,"d":8,"v":1},{"n":"서정재","m":1,"d":8,"v":0.5},{"n":"신화경","m":1,"d":8,"v":1},{"n":"유지순","m":1,"d":5,"v":0.5},{"n":"유지순","m":1,"d":26,"v":1},{"n":"조옥순","m":1,"d":2,"v":1},{"n":"홍명숙","m":1,"d":21,"v":1},{"n":"김연숙","m":1,"d":14,"v":0.5},{"n":"이인숙","m":1,"d":9,"v":0.5},{"n":"오금옥","m":1,"d":13,"v":1},{"n":"오금옥","m":1,"d":19,"v":1},{"n":"오금옥","m":1,"d":27,"v":1},{"n":"오금옥","m":1,"d":29,"v":0.5},{"n":"주복실","m":1,"d":5,"v":1},{"n":"김지연","m":1,"d":16,"v":1},{"n":"김지연","m":1,"d":19,"v":1},{"n":"김지연","m":1,"d":20,"v":1},{"n":"박광희","m":1,"d":12,"v":1},{"n":"박광희","m":1,"d":23,"v":0.5},{"n":"이연숙","m":1,"d":13,"v":0.5},{"n":"이연숙","m":1,"d":14,"v":1},{"n":"이연숙","m":1,"d":15,"v":1},{"n":"이연숙","m":1,"d":16,"v":1},{"n":"이연숙","m":1,"d":19,"v":1},{"n":"이연숙","m":1,"d":20,"v":1},{"n":"이연숙","m":1,"d":21,"v":1},{"n":"이연숙","m":1,"d":22,"v":1},{"n":"이연숙","m":1,"d":23,"v":1},{"n":"이연숙","m":1,"d":26,"v":1},{"n":"이연숙","m":1,"d":27,"v":1},{"n":"이연숙","m":1,"d":28,"v":1},{"n":"이연숙","m":1,"d":29,"v":1},{"n":"이연숙","m":1,"d":30,"v":1},{"n":"정지수","m":2,"d":10,"v":0.5},{"n":"장동현","m":2,"d":13,"v":1},{"n":"노창길","m":2,"d":15,"v":1},{"n":"심치섭","m":2,"d":26,"v":1},{"n":"심치섭","m":2,"d":27,"v":1},{"n":"이삼주","m":2,"d":9,"v":0.5},{"n":"윤성혁","m":2,"d":27,"v":1},{"n":"이달영","m":2,"d":13,"v":0.5},{"n":"이광규","m":2,"d":26,"v":1},{"n":"강선자","m":2,"d":4,"v":1},{"n":"신화경","m":2,"d":4,"v":1},{"n":"신화경","m":2,"d":27,"v":1},{"n":"유지순","m":2,"d":9,"v":1},{"n":"유지순","m":2,"d":10,"v":1},{"n":"유지순","m":2,"d":24,"v":1},{"n":"최교숙","m":2,"d":6,"v":1},{"n":"최교숙","m":2,"d":20,"v":1},{"n":"최교숙","m":2,"d":23,"v":1},{"n":"홍명숙","m":2,"d":10,"v":1},{"n":"홍명숙","m":2,"d":11,"v":1},{"n":"홍명숙","m":2,"d":25,"v":1},{"n":"이은자","m":2,"d":27,"v":1},{"n":"이인숙","m":2,"d":9,"v":1},{"n":"이인숙","m":2,"d":10,"v":1},{"n":"오금옥","m":2,"d":23,"v":1},{"n":"오금옥","m":2,"d":24,"v":0.5},{"n":"오금옥","m":2,"d":25,"v":1},{"n":"오금옥","m":2,"d":26,"v":1},{"n":"주복실","m":2,"d":9,"v":1},{"n":"주복실","m":2,"d":25,"v":1},{"n":"김지연","m":2,"d":2,"v":1},{"n":"김지연","m":2,"d":25,"v":1},{"n":"박광희","m":2,"d":4,"v":0.5},{"n":"박광희","m":2,"d":6,"v":1},{"n":"박광희","m":2,"d":9,"v":1},{"n":"박광희","m":2,"d":10,"v":1},{"n":"박광희","m":2,"d":11,"v":1},{"n":"박광희","m":2,"d":12,"v":1},{"n":"박광희","m":2,"d":13,"v":1},{"n":"박광희","m":2,"d":19,"v":1},{"n":"박광희","m":2,"d":20,"v":1},{"n":"박광희","m":2,"d":23,"v":1},{"n":"박광희","m":2,"d":24,"v":1},{"n":"박광희","m":2,"d":25,"v":1},{"n":"박광희","m":2,"d":26,"v":1},{"n":"박광희","m":2,"d":27,"v":1},{"n":"이연숙","m":2,"d":2,"v":1},{"n":"이연숙","m":2,"d":3,"v":1},{"n":"문봉인","m":2,"d":2,"v":1},{"n":"문봉인","m":2,"d":9,"v":1},{"n":"문봉인","m":2,"d":10,"v":1},{"n":"문봉인","m":2,"d":11,"v":1},{"n":"문봉인","m":2,"d":12,"v":1},{"n":"문봉인","m":2,"d":13,"v":1},{"n":"문봉인","m":2,"d":19,"v":1},{"n":"문봉인","m":2,"d":20,"v":1},{"n":"문봉인","m":2,"d":23,"v":1},{"n":"문봉인","m":2,"d":24,"v":1},{"n":"문봉인","m":2,"d":25,"v":1},{"n":"문봉인","m":2,"d":26,"v":1},{"n":"문봉인","m":2,"d":27,"v":1},{"n":"정지수","m":3,"d":18,"v":1},{"n":"정혜림","m":3,"d":3,"v":0.5},{"n":"정혜림","m":3,"d":25,"v":0.5},{"n":"이혜원","m":3,"d":12,"v":1},{"n":"이혜원","m":3,"d":13,"v":1},{"n":"이혜원","m":3,"d":16,"v":1},{"n":"이혜원","m":3,"d":17,"v":1},{"n":"장감이","m":3,"d":24,"v":1},{"n":"장감이","m":3,"d":25,"v":1},{"n":"심치섭","m":3,"d":1,"v":1},{"n":"심치섭","m":3,"d":3,"v":1},{"n":"심치섭","m":3,"d":22,"v":1},{"n":"심치섭","m":3,"d":23,"v":1},{"n":"심치섭","m":3,"d":24,"v":1},{"n":"심치섭","m":3,"d":25,"v":1},{"n":"심치섭","m":3,"d":26,"v":1},{"n":"심치섭","m":3,"d":29,"v":1},{"n":"심치섭","m":3,"d":30,"v":1},{"n":"심치섭","m":3,"d":31,"v":1},{"n":"김지왕","m":3,"d":4,"v":0.5},{"n":"김지왕","m":3,"d":28,"v":1},{"n":"염광일","m":3,"d":14,"v":1},{"n":"이승철","m":3,"d":3,"v":1},{"n":"이승철","m":3,"d":4,"v":1},{"n":"이승철","m":3,"d":5,"v":1},{"n":"이승철","m":3,"d":6,"v":1},{"n":"이승철","m":3,"d":9,"v":1},{"n":"이승철","m":3,"d":10,"v":1},{"n":"이승철","m":3,"d":11,"v":1},{"n":"이승철","m":3,"d":12,"v":1},{"n":"이승철","m":3,"d":13,"v":1},{"n":"이승철","m":3,"d":16,"v":1},{"n":"이승철","m":3,"d":17,"v":1},{"n":"이승철","m":3,"d":18,"v":1},{"n":"이승철","m":3,"d":19,"v":1},{"n":"이승철","m":3,"d":20,"v":1},{"n":"이승철","m":3,"d":23,"v":1},{"n":"이승철","m":3,"d":24,"v":1},{"n":"이승철","m":3,"d":25,"v":1},{"n":"이승철","m":3,"d":26,"v":0.5},{"n":"이광규","m":3,"d":13,"v":1},{"n":"최경숙","m":3,"d":6,"v":0.5},{"n":"박성숙","m":3,"d":12,"v":1},{"n":"서정재","m":3,"d":27,"v":1},{"n":"신화경","m":3,"d":19,"v":1},{"n":"유지순","m":3,"d":11,"v":0.5},{"n":"조옥순","m":3,"d":11,"v":1},{"n":"조옥순","m":3,"d":12,"v":1},{"n":"조옥순","m":3,"d":13,"v":1},{"n":"조옥순","m":3,"d":23,"v":1},{"n":"조옥순","m":3,"d":24,"v":1},{"n":"조옥순","m":3,"d":25,"v":1},{"n":"조옥순","m":3,"d":26,"v":1},{"n":"조옥순","m":3,"d":27,"v":1},{"n":"홍명숙","m":3,"d":3,"v":1},{"n":"홍명숙","m":3,"d":4,"v":1},{"n":"홍명숙","m":3,"d":13,"v":1},{"n":"홍명숙","m":3,"d":16,"v":1},{"n":"홍명숙","m":3,"d":17,"v":1},{"n":"홍명숙","m":3,"d":25,"v":1},{"n":"김연숙","m":3,"d":19,"v":1},{"n":"김연숙","m":3,"d":31,"v":1},{"n":"안인자","m":3,"d":12,"v":1},{"n":"이인숙","m":3,"d":9,"v":1},{"n":"이인숙","m":3,"d":10,"v":1},{"n":"이인숙","m":3,"d":11,"v":1},{"n":"이인숙","m":3,"d":12,"v":1},{"n":"이인숙","m":3,"d":13,"v":1},{"n":"오금옥","m":3,"d":11,"v":1},{"n":"오금옥","m":3,"d":16,"v":1},{"n":"주복실","m":3,"d":24,"v":0.5},{"n":"정명희","m":3,"d":5,"v":1},{"n":"이연숙","m":3,"d":10,"v":1},{"n":"이연숙","m":3,"d":16,"v":0.5},{"n":"문봉인","m":3,"d":3,"v":1},{"n":"문봉인","m":3,"d":4,"v":1},{"n":"조영자","m":3,"d":4,"v":1},{"n":"조영자","m":3,"d":26,"v":1},{"n":"아타카","m":1,"d":14,"v":0.5},{"n":"아타카","m":1,"d":26,"v":1},{"n":"오마르","m":1,"d":5,"v":1},{"n":"오마르","m":1,"d":6,"v":1},{"n":"체레","m":1,"d":15,"v":1},{"n":"체레","m":1,"d":30,"v":0.5},{"n":"알라유","m":1,"d":12,"v":0.5},{"n":"아게리투","m":1,"d":30,"v":0.5},{"n":"세세그마","m":1,"d":23,"v":1},{"n":"메이라프","m":1,"d":7,"v":1},{"n":"모하메드","m":1,"d":5,"v":1},{"n":"모하메드","m":1,"d":12,"v":1},{"n":"무자미니","m":1,"d":5,"v":0.5},{"n":"옴","m":2,"d":19,"v":0.5},{"n":"옴","m":2,"d":23,"v":1},{"n":"옴","m":2,"d":24,"v":1},{"n":"옴","m":2,"d":25,"v":1},{"n":"옴","m":2,"d":26,"v":1},{"n":"옴","m":2,"d":27,"v":1},{"n":"나홈","m":2,"d":20,"v":1},{"n":"아센","m":2,"d":24,"v":1},{"n":"람비","m":2,"d":12,"v":1},{"n":"모하메드","m":2,"d":5,"v":1},{"n":"아이작","m":2,"d":12,"v":0.5},{"n":"메리클레어","m":2,"d":11,"v":0.5},{"n":"아타카","m":3,"d":19,"v":1},{"n":"티기스트","m":3,"d":9,"v":1},{"n":"아게리투","m":3,"d":10,"v":1},{"n":"여만","m":3,"d":6,"v":1},{"n":"여만","m":3,"d":9,"v":1},{"n":"탁엘","m":3,"d":11,"v":1},{"n":"나홈","m":3,"d":25,"v":1},{"n":"나홈","m":3,"d":26,"v":1},{"n":"나홈","m":3,"d":27,"v":1},{"n":"아센","m":3,"d":3,"v":1},{"n":"아센","m":3,"d":5,"v":1},{"n":"아센","m":3,"d":9,"v":0.5},{"n":"모하메드","m":3,"d":3,"v":0.5},{"n":"무자미니","m":3,"d":9,"v":1},{"n":"라울","m":3,"d":25,"v":1},{"n":"라울","m":3,"d":26,"v":1},{"n":"리아","m":3,"d":4,"v":1},{"n":"메리클레어","m":3,"d":23,"v":1}];
  const year=2026;
  // 이름 별칭 매핑 (노프로 EMPS와 엑셀 이름이 다른 경우)
  const ALIAS={'메리 클레어2':'메리클레어'};
  let ok=0, skip=0, noMatch=0;
  const matched=new Map(), unmatched=new Set();
  LEAVE_DATA.forEach(l=>{
    const searchName = ALIAS[l.n] || l.n;
    const emp=EMPS.find(e=>(e.name||'').trim()===searchName);
    if(!emp){noMatch++;unmatched.add(l.n);return;}
    if(!matched.has(searchName)) matched.set(searchName, {id:emp.id, days:[]});
    matched.get(searchName).days.push(`${l.m}/${l.d}=${l.v}`);
    const k=rk(emp.id,year,l.m,l.d);
    if(!REC[k])REC[k]={empId:emp.id,start:'',end:'',absent:false,annual:false,halfAnnual:false,note:'',outTimes:[]};
    if(REC[k].annual||REC[k].halfAnnual){skip++;return;}
    if(l.v===1){REC[k].annual=true;REC[k].halfAnnual=false;REC[k].absent=false;}
    else if(l.v===0.5){REC[k].halfAnnual=true;REC[k].annual=false;REC[k].absent=false;}
    ok++;
  });
  saveLS();
  // 검증 리포트
  let report='=== 엑셀 연차 임포트 결과 ===\n';
  report+=`총 데이터: ${LEAVE_DATA.length}건 (한국인+외국인)\n`;
  report+=`반영: ${ok}건 / 이미체크: ${skip}건 / 미매칭: ${noMatch}건\n`;
  if(unmatched.size) report+=`\n⚠ 미매칭 이름 (노프로에 없음):\n  ${[...unmatched].join(', ')}\n`;
  report+='\n=== 직원별 사용연차 검증 (엑셀 vs 노프로) ===\n';
  report+='이름 | 엑셀건수 | 노프로사용 | 총연차 | 잔여\n';
  report+='----|----|----|----|----\n';
  [...matched.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([name,info])=>{
    const xlCount = info.days.reduce((s,d)=>s+parseFloat(d.split('=')[1]),0);
    const used=countUsedLeave(info.id,year);
    const lv=calcLeaveForYear(EMPS.find(e=>e.id===info.id),year);
    const mark = Math.abs(xlCount - used) > 0.1 ? ' ⚠' : ' ✓';
    report+=`${name} | ${xlCount}일 | ${used}일 | ${lv.total}일 | ${lv.remain}일${mark}\n`;
  });
  alert(report);
  console.log(report);
  renderTable();renderLeave();
}

function getLeavePayAmount(emp, year) {
  const rate = getEmpRate(emp);
  return rate * 8;
}

function renderLeave() {
  renderFilterBar('leave-filter-bar','leave');
  document.getElementById('leave-year-disp').textContent = leaveYear;

  // calcMode select 동기화
  const calcSel = document.getElementById('leave-calc-mode');
  if (calcSel) calcSel.value = leaveSettings.calcMode || 'fiscal';

  // payMode select 동기화
  const sel = document.getElementById('leave-pay-mode');
  if (sel) sel.value = leaveSettings.payMode || 'hourly';

  // 설명 텍스트
  const desc = document.getElementById('leave-pay-desc');
  const calcModeLabel = (leaveSettings.calcMode || 'fiscal') === 'fiscal' ? '회계연도(1/1~12/31) 기준' : '입사일 기준';
  const modeLabels = { hourly: '시급 × 8h', daily: '일급 (소정근로시간 기준)', custom: '직접 입력 금액' };
  if (desc) desc.textContent = `${calcModeLabel} · 연차수당: ${modeLabels[leaveSettings.payMode || 'hourly']}`;

  // 직접입력 금액 입력란 동기화
  var customWrap = document.getElementById("leave-custom-wrap");
  var customInput = document.getElementById("leave-custom-amount");
  if(customWrap) customWrap.style.display = (leaveSettings.payMode === "custom") ? "flex" : "none";
  if(customInput && leaveSettings.customAmount) customInput.value = leaveSettings.customAmount;

  const tbody = document.getElementById('leave-tbody');
  if (!tbody) return;

  const filteredLeaveEmps = applyCommonFilter([...EMPS].filter(e=>{
    // 퇴사자: 퇴사일 지난 직원 제외
    if(e.leave) return false;
    return true;
  }), 'leave');
  tbody.innerHTML = filteredLeaveEmps.map(emp => {
    const lv = calcLeaveForYear(emp, leaveYear);
    const payAmt = getLeavePayAmount(emp, leaveYear);
    const totalPay = lv.used * payAmt;
    const leaveType = leaveSettings['type_' + emp.id] || 'payout'; // payout | promote

    // 월별 적립 미니 뱃지
    const monthBadges = lv.monthly.map(mv => {
      if (!mv.count) return `<span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;font-size:8px;border-radius:4px;background:var(--bg3);color:var(--ink3);margin:1px">${mv.month}</span>`;
      return `<span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;font-size:8px;border-radius:4px;background:var(--gbg);color:#065F46;font-weight:700;margin:1px" title="${mv.count}개 적립">${mv.month}</span>`;
    }).join('');

    // override 여부 (사용연차 수동 입력 시에만 표시)
    // "수정됨" 뱃지: 엑셀 baseline 또는 수동 used override 있으면 표시
    const _ov = leaveOverrides[emp.id] && leaveOverrides[emp.id][leaveYear];
    const hasUsedOverride = !!_ov && (
      (_ov.baselineTotal !== undefined && _ov.untilMonth) ||
      (_ov.used !== undefined && _ov.used !== null)
    );

    return `<tr style="border-bottom:1px solid var(--bd);${emp.leave ? 'opacity:.55;background:var(--rose-dim)' : ''}">
      <td style="padding:10px 14px;font-size:12px;font-weight:700">
        <div style="display:flex;align-items:center;gap:6px">
          <div class="av" style="width:26px;height:26px;font-size:11px;background:${safeColor(emp.color,'#DBEAFE')};color:${safeColor(emp.tc,'#1E3A5F')}">${esc(emp.name)[0]}</div>
          ${esc(emp.name)}${emp.leave ? '<span style="font-size:9px;color:var(--rose);margin-left:3px">퇴사</span>' : ''}
        </div>
      </td>
      <td style="padding:10px 8px;font-size:11px;text-align:center;color:var(--ink3)">${emp.join||'-'}</td>
      <td style="padding:10px 8px;text-align:center">
        <span style="font-size:15px;font-weight:700;color:var(--navy)">${lv.total}</span>
        <span style="font-size:9px;color:var(--ink3)">개</span>
      </td>
      <td style="padding:10px 8px;text-align:center;background:var(--gbg)">
        <span style="font-size:15px;font-weight:700;color:var(--green)">${lv.used}</span>
        <span style="font-size:9px;color:var(--ink3)">일</span>
        ${hasUsedOverride ? '<span style="font-size:8px;background:var(--abg);color:#92400E;padding:1px 4px;border-radius:4px;font-weight:700;display:block;margin-top:2px">수정됨</span>' : ''}
      </td>
      <td style="padding:10px 8px;text-align:center;background:${lv.remain<0?'#FFF1F2':'var(--teal-dim)'}">
        <span style="font-size:15px;font-weight:700;color:${lv.remain<0?'var(--rose)':'var(--navy2)'}">${lv.remain}</span>
        <span style="font-size:9px;color:var(--ink3)">일</span>
      </td>
      <td style="padding:10px 8px;text-align:center">
        <div style="display:flex;gap:3px;justify-content:center">
          <button onclick="setLeaveType(${emp.id},'payout')"
            style="padding:3px 7px;font-size:9px;border-radius:6px;cursor:pointer;border:1px solid ${leaveType==='payout'?'var(--teal)':'var(--bd)'};background:${leaveType==='payout'?'var(--tbg)':'#fff'};color:${leaveType==='payout'?'var(--teal)':'var(--ink3)'};font-weight:700">연차수당</button>
          <button onclick="setLeaveType(${emp.id},'promote')"
            style="padding:3px 7px;font-size:9px;border-radius:6px;cursor:pointer;border:1px solid ${leaveType==='promote'?'var(--amber)':'var(--bd)'};background:${leaveType==='promote'?'var(--abg)':'#fff'};color:${leaveType==='promote'?'var(--amber)':'var(--ink3)'};font-weight:700">연차촉진</button>
        </div>
      </td>
      <td style="padding:10px 8px;text-align:center;background:#0d2a40">
        ${(()=>{
          const hr = getEmpRate(emp);
          return `<div style="font-size:12px;font-weight:700;color:#7dd3fc">${hr.toLocaleString()}원</div>
                  <div style="font-size:9px;color:rgba(255,255,255,.5)">시급</div>`;
        })()}
      </td>
      <td style="padding:10px 8px;text-align:center;background:#1e0a33">
        ${(()=>{
          const hr = getEmpRate(emp);
          const remainPay = Math.round(lv.remain * hr * 8);
          return `<div style="font-size:12px;font-weight:700;color:#c4b5fd">${remainPay.toLocaleString()}원</div>
                  <div style="font-size:9px;color:rgba(255,255,255,.5)">잔여${lv.remain}일×시급×8h</div>`;
        })()}
      </td>
      <td style="padding:10px 8px;text-align:center">
        <div style="font-size:12px;font-weight:700;color:var(--purple)">${Math.round(payAmt).toLocaleString()}원</div>
        <div style="font-size:9px;color:var(--ink3)">1일 기준</div>
      </td>
      <td style="padding:10px 8px;text-align:center">
        <div style="display:flex;gap:3px;flex-direction:column;align-items:center">
          <div style="display:flex;align-items:center;gap:2px">
            <input type="number"
              value="${leaveOverrides[emp.id]&&leaveOverrides[emp.id][leaveYear]&&leaveOverrides[emp.id][leaveYear].used!==undefined?leaveOverrides[emp.id][leaveYear].used:''}"
              placeholder="${lv.used}" min="0" max="30"
              style="width:44px;padding:3px;font-size:11px;border:1px solid var(--bd2);border-radius:5px;text-align:center;font-weight:700;color:var(--green)"
              onchange="overrideLeaveUsed(${emp.id},${leaveYear},this.value===''?null:+this.value)"
              title="비워두면 자동계산. 직접 입력 시 해당값 사용">
            ${leaveOverrides[emp.id]&&leaveOverrides[emp.id][leaveYear]&&leaveOverrides[emp.id][leaveYear].used!==undefined
              ?`<button onclick="overrideLeaveUsed(${emp.id},${leaveYear},null)" style="width:14px;height:14px;border-radius:50%;background:var(--rose);color:#fff;border:none;cursor:pointer;font-size:9px;line-height:14px;text-align:center" title="자동계산으로 복귀">×</button>`
              :''}
          </div>
          <span style="font-size:8px;color:var(--ink3)">사용</span>
        </div>
      </td>
      <td style="padding:10px 8px">
        <div style="display:flex;flex-wrap:wrap;max-width:120px">${monthBadges}</div>
        <div onclick="toggleLeaveDetail(${emp.id})" style="font-size:9px;color:var(--navy2);cursor:pointer;margin-top:3px;font-weight:600">▸ 상세보기</div>
      </td>
    </tr>`;
  }).join('');
}

function setLeaveType(empId, type) {
  leaveSettings['type_' + empId] = type;
  localStorage.setItem('npm5_leave_settings', JSON.stringify(leaveSettings));
  saveLS(); // Supabase DB 동기화
  renderLeave();
}

function overrideLeaveTotal(empId, year, val) {
  if (!leaveOverrides[empId]) leaveOverrides[empId] = {};
  if (!leaveOverrides[empId][year]) leaveOverrides[empId][year] = {};
  leaveOverrides[empId][year].total = val;
  localStorage.setItem('npm5_leave_overrides', JSON.stringify(leaveOverrides));
  saveLS(); // Supabase DB 동기화
  renderLeave();
}

function overrideLeaveUsed(empId, year, val) {
  if (!leaveOverrides[empId]) leaveOverrides[empId] = {};
  if (!leaveOverrides[empId][year]) leaveOverrides[empId][year] = {};
  if (val === null) {
    // 수동 used만 제거. 엑셀 baseline(baselineTotal/baselineRemain/untilMonth)은 보존.
    delete leaveOverrides[empId][year].used;
    if (Object.keys(leaveOverrides[empId][year]).length === 0) {
      delete leaveOverrides[empId][year];
      if (Object.keys(leaveOverrides[empId]).length === 0) delete leaveOverrides[empId];
    }
  } else {
    // 수동 used 설정. 엑셀 baseline이 있으면 그 위에 덮어씀 (객체 교체 X).
    leaveOverrides[empId][year].used = val;
  }
  localStorage.setItem('npm5_leave_overrides', JSON.stringify(leaveOverrides));
  saveLS(); // Supabase DB 동기화
  renderLeave();
}

// ── 연차 엑셀 업로드 ──
let _leaveUploadWB=null, _leaveUploadMatches=[];
// 두 pg-leave에 중복 UI가 있으므로 양쪽 모두 업데이트
function _luEl(id){return [document.getElementById(id),document.getElementById(id+'1')].filter(Boolean);}
function _luSet(id,fn){_luEl(id).forEach(fn);}

function leaveUploadFile(files){
  if(!files||!files.length)return;
  const file=files[0];
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      _leaveUploadWB=XLSX.read(e.target.result,{type:'array'});
      // 시트 드롭다운 채우기 (월별 시트만)
      const monthSheets=_leaveUploadWB.SheetNames.filter(n=>/^\d{1,2}월$/.test(n));
      if(!monthSheets.length){
        if(typeof showSyncToast==='function') showSyncToast('월별 시트(1월~12월)를 찾을 수 없습니다','error');
        return;
      }
      _luSet('leave-upload-sheet',sel=>{
        sel.innerHTML='';
        monthSheets.forEach(n=>{
          const opt=document.createElement('option');opt.value=n;opt.textContent=n;sel.appendChild(opt);
        });
        const curMonth=(new Date().getMonth()+1)+'월';
        const prevMonth=(new Date().getMonth()||12)+'월';
        if(monthSheets.includes(prevMonth))sel.value=prevMonth;
        else if(monthSheets.includes(curMonth))sel.value=curMonth;
      });
      _luSet('leave-upload-preview',el=>{el.style.display='block';});
      leaveUploadParseSheet();
    }catch(err){
      console.error('엑셀 파싱 오류:',err);
      if(typeof showSyncToast==='function') showSyncToast('엑셀 파일을 읽을 수 없습니다','error');
    }
  };
  reader.readAsArrayBuffer(file);
  // input 초기화
  _luSet('leave-upload-inp',el=>{el.value='';});
}

function _excelDateToISO(serial){
  if(typeof serial==='string'){
    // YYYY-MM-DD or YYYY.MM.DD or YYYY/MM/DD
    const m=serial.match(/(\d{4})[\-\.\/](\d{1,2})[\-\.\/](\d{1,2})/);
    if(m) return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
    return serial;
  }
  if(typeof serial!=='number') return '';
  // 엑셀 시리얼 넘버 → Date
  const d=new Date((serial-25569)*86400*1000);
  return d.toISOString().slice(0,10);
}

function leaveUploadParseSheet(){
  if(!_leaveUploadWB)return;
  const sels=_luEl('leave-upload-sheet');
  const sheetName=sels.length?sels[0].value:'';
  // 양쪽 셀렉트 동기화
  sels.forEach(s=>{if(s.value!==sheetName)s.value=sheetName;});
  const ws=_leaveUploadWB.Sheets[sheetName];
  if(!ws)return;
  const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
  const _pMonthMatch=sheetName.match(/^(\d{1,2})월$/);
  const _pSheetMonth=_pMonthMatch?parseInt(_pMonthMatch[1]):0;

  // 헤더 자동 탐색 (이름, 총연차, 잔여연차 필수 / 입사일·사용 선택)
  let nameCol=-1,joinCol=-1,totalCol=-1,remainCol=-1,usedCol=-1,dataStartRow=-1;
  for(let r=0;r<Math.min(6,data.length);r++){
    const row=data[r];
    for(let c=0;c<row.length;c++){
      const v=String(row[c]||'').replace(/\s/g,'');
      if(v==='이름'||v==='성명') nameCol=c;
      if(v==='입사일') joinCol=c;
      if(v.includes('총연차')||v==='총월차'||v.includes('총월차')||v==='발생연차'||v==='부여연차') totalCol=c;
      else if(v.includes('잔여')) remainCol=c;
      else if(v.includes('사용')) usedCol=c;
    }
    if(nameCol>=0&&totalCol>=0&&remainCol>=0) {dataStartRow=r+1; break;}
  }
  // 날짜 행(1,2,3...) 건너뛰기
  if(dataStartRow>=0&&dataStartRow<data.length){
    const firstVal=data[dataStartRow][nameCol];
    if(typeof firstVal==='number'||firstVal==='') dataStartRow++;
  }

  if(nameCol<0||totalCol<0||remainCol<0){
    const missing=[];
    if(nameCol<0) missing.push('이름');
    if(totalCol<0) missing.push('총연차');
    if(remainCol<0) missing.push('잔여연차');
    _luSet('leave-upload-result',el=>{el.innerHTML=`<div style="color:var(--rose);font-weight:600">헤더를 찾을 수 없습니다 — 필수 열: ${missing.join(', ')}</div>`;});
    _leaveUploadMatches=[];
    return;
  }

  // 직원 매칭 — 이름 only + 별칭(ALIAS) 매핑
  // 엑셀의 다른 이름 → 시스템 이름 매핑
  const LEAVE_NAME_ALIAS = {
    '메리 클레어2': '메리클레어',
  };
  _leaveUploadMatches=[];
  const matchedIds=new Set();
  for(let r=dataStartRow;r<data.length;r++){
    const row=data[r];
    const xlName=String(row[nameCol]||'').trim();
    const xlJoin=joinCol>=0?_excelDateToISO(row[joinCol]):'';
    const xlTotal=parseFloat(row[totalCol]);
    const xlRemain=parseFloat(row[remainCol]);
    const xlUsed=usedCol>=0?parseFloat(row[usedCol]):NaN;
    if(!xlName)continue;

    // 별칭 우선 적용
    const searchName = LEAVE_NAME_ALIAS[xlName] || xlName;

    // 이름만으로 매칭
    const nameMatches = EMPS.filter(e =>
      (e.name||'').trim() === searchName && !matchedIds.has(e.id));
    const emp = nameMatches.length ? nameMatches[0] : null;

    // 자동계산 유지 대상 (입사일 기준 계산 고정)
    const LEAVE_AUTO_NAMES=['배수연','김인자'];
    const skipAuto = emp && LEAVE_AUTO_NAMES.includes(searchName);

    _leaveUploadMatches.push({
      xlName, xlJoin, xlTotal, xlRemain, xlUsed,
      empId:emp?emp.id:null,
      empName:emp?emp.name:null,
      matched:!!emp,
      skip:skipAuto
    });
    if(emp) matchedIds.add(emp.id);
  }

  // 미리보기 렌더링
  const matched=_leaveUploadMatches.filter(m=>m.matched&&!m.skip);
  const skipped=_leaveUploadMatches.filter(m=>m.matched&&m.skip);
  const unmatched=_leaveUploadMatches.filter(m=>!m.matched);
  let html=`<div style="margin-bottom:8px;font-weight:600;color:var(--green)">✓ 적용 대상 ${matched.length}명</div>`;
  if(matched.length){
    html+='<table style="width:100%;border-collapse:collapse;margin-bottom:10px"><tr style="background:var(--surf)"><th style="padding:4px 8px;font-size:10px;text-align:left">이름</th><th style="padding:4px 8px;font-size:10px;text-align:center">엑셀 총연차</th><th style="padding:4px 8px;font-size:10px;text-align:center">엑셀 잔여</th><th style="padding:4px 8px;font-size:10px;text-align:center" title="오늘 기준 = 엑셀 총연차 + 이후 월 만근 적립">적용후 총연차</th><th style="padding:4px 8px;font-size:10px;text-align:center" title="오늘 기준 = 엑셀 잔여 + 이후 적립 − 이후 REC 사용">적용후 잔여</th></tr>';
    matched.forEach(m=>{
      const emp=EMPS.find(e=>e.id===m.empId);
      const lv=emp?calcLeaveForYear(emp,leaveYear):{total:0, monthly:[]};
      // 적용 후 예상치 = 엑셀값 + (기준월 이후 만근 적립) - (기준월 이후 REC 사용)
      let projTotal='—', projRemain='—';
      if(emp && !isNaN(m.xlTotal) && !isNaN(m.xlRemain) && _pSheetMonth){
        const _pa = (lv.monthly||[]).reduce((s,mv)=>{
          if(!mv.date||!mv.count) return s;
          const wm = mv.date.getMonth(); // 1-indexed 전달
          if(wm <= _pSheetMonth) return s;
          return s + mv.count;
        }, 0);
        const _pu = countUsedLeave(emp.id, leaveYear, _pSheetMonth+1);
        projTotal = Math.round((m.xlTotal + _pa)*10)/10;
        projRemain = Math.round((m.xlRemain + _pa - _pu)*10)/10;
      }
      const projColor = (typeof projRemain==='number' && projRemain<0) ? 'var(--rose)' : 'var(--navy2)';
      html+=`<tr style="border-bottom:1px solid var(--bd)"><td style="padding:4px 8px;font-size:11px">${esc(m.xlName)}</td><td style="padding:4px 8px;font-size:11px;text-align:center;font-weight:600">${isNaN(m.xlTotal)?'—':m.xlTotal}</td><td style="padding:4px 8px;font-size:11px;text-align:center;color:var(--green);font-weight:700">${isNaN(m.xlRemain)?'—':m.xlRemain}</td><td style="padding:4px 8px;font-size:11px;text-align:center;font-weight:600">${projTotal}</td><td style="padding:4px 8px;font-size:11px;text-align:center;color:${projColor};font-weight:700">${projRemain}</td></tr>`;
    });
    html+='</table>';
  }
  if(skipped.length){
    html+=`<div style="margin-bottom:8px;font-weight:600;color:var(--navy)">⏭ 자동계산 유지 ${skipped.length}명 <span style="font-weight:400;font-size:10px;color:var(--ink3)">(입사일 기준 자동계산)</span></div>`;
    html+='<table style="width:100%;border-collapse:collapse;margin-bottom:10px"><tr style="background:var(--nbg)"><th style="padding:4px 8px;font-size:10px;text-align:left">이름</th><th style="padding:4px 8px;font-size:10px;text-align:center">입사일</th><th style="padding:4px 8px;font-size:10px;text-align:center">총연차</th><th style="padding:4px 8px;font-size:10px;text-align:center">잔여연차</th><th style="padding:4px 8px;font-size:10px;text-align:center">사용</th></tr>';
    skipped.forEach(m=>{
      const emp=EMPS.find(e=>e.id===m.empId);
      const lv=emp?calcLeaveForYear(emp,leaveYear):{total:0,used:0,remain:0};
      html+=`<tr style="border-bottom:1px solid var(--bd)"><td style="padding:4px 8px;font-size:11px">${esc(m.xlName)}</td><td style="padding:4px 8px;font-size:11px;text-align:center">${esc(m.xlJoin)}</td><td style="padding:4px 8px;font-size:11px;text-align:center;font-weight:600">${lv.total}</td><td style="padding:4px 8px;font-size:11px;text-align:center;color:var(--navy);font-weight:700">${lv.remain}</td><td style="padding:4px 8px;font-size:11px;text-align:center">${lv.used}</td></tr>`;
    });
    html+='</table>';
  }
  if(unmatched.length){
    html+=`<div style="margin-bottom:4px;font-weight:600;color:var(--rose)">✗ 미매칭 ${unmatched.length}명 <span style="font-weight:400;font-size:10px;color:var(--ink3)">(이름 불일치 — 건너뜀)</span></div>`;
    html+='<div style="display:flex;flex-wrap:wrap;gap:4px">';
    unmatched.forEach(m=>{
      html+=`<span style="padding:2px 8px;background:var(--rbg);border-radius:6px;font-size:10px;color:var(--rose)">${esc(m.xlName)} (${esc(m.xlJoin)})</span>`;
    });
    html+='</div>';
  }
  _luSet('leave-upload-result',el=>{el.innerHTML=html;});
  _luSet('leave-upload-apply-btn',el=>{el.disabled=matched.length===0;});
}

function leaveUploadApply(){
  const matched=_leaveUploadMatches.filter(m=>m.matched&&!m.skip);
  if(!matched.length)return;
  const year=leaveYear;
  // 업로드한 시트 월 추출 (예: "3월" → 3). 엑셀값은 해당 월 말 기준 누적 사용분
  const sels=_luEl('leave-upload-sheet');
  const sheetName=sels.length?sels[0].value:'';
  const monthMatch=sheetName.match(/^(\d{1,2})월$/);
  const sheetMonth=monthMatch?parseInt(monthMatch[1]):0;
  // 자동계산 대상은 override 제거 (항상 입사일 기준 계산 유지)
  _leaveUploadMatches.filter(m=>m.skip&&m.empId).forEach(m=>{
    if(leaveOverrides[m.empId]&&leaveOverrides[m.empId][year]){
      delete leaveOverrides[m.empId][year];
      if(!Object.keys(leaveOverrides[m.empId]).length) delete leaveOverrides[m.empId];
    }
  });
  // 먼저 기존 override 초기화 (꼬임 방지)
  matched.forEach(m=>{
    if(leaveOverrides[m.empId]&&leaveOverrides[m.empId][year]) delete leaveOverrides[m.empId][year];
  });
  let count=0;
  // sheetMonth 필수 (시트명이 "N월" 형태여야 함)
  if(!sheetMonth){
    if(typeof showSyncToast==='function') showSyncToast('시트명은 "3월", "4월" 같은 형식이어야 합니다','error');
    return;
  }
  matched.forEach(m=>{
    if(isNaN(m.xlTotal) || isNaN(m.xlRemain)) return;
    // 엑셀이 진실의 원천. 기준월까지는 엑셀 값, 이후 월은 calcLeave가 만근 기반 적립 + REC 사용 차감.
    leaveOverrides[m.empId] = leaveOverrides[m.empId] || {};
    leaveOverrides[m.empId][year] = {
      baselineTotal: m.xlTotal,
      baselineRemain: m.xlRemain,
      untilMonth: sheetMonth,
    };
    count++;
  });
  localStorage.setItem('npm5_leave_overrides',JSON.stringify(leaveOverrides));
  saveLS();
  // 서버에 즉시 저장 (leave_overrides)
  safeItemSave('leave_overrides',JSON.parse(localStorage.getItem('npm5_leave_overrides')||'{}')).catch(()=>{});
  renderLeave();
  leaveUploadCancel();
  if(typeof showSyncToast==='function') showSyncToast(count+'명 연차 데이터 반영 완료','ok');
}

function leaveUploadCancel(){
  _luSet('leave-upload-preview',el=>{el.style.display='none';});
  _leaveUploadWB=null;_leaveUploadMatches=[];
}

function toggleLeaveDetail(empId) {
  const emp = EMPS.find(e => e.id === empId);
  if (!emp) return;
  const panel = document.getElementById('leave-monthly-detail');
  const grid = document.getElementById('leave-monthly-grid');
  const title = document.getElementById('leave-detail-title');
  panel.style.display = 'block';
  title.textContent = `${emp.name} — ${leaveYear}년 월별 연차 현황`;

  const lv = calcLeaveForYear(emp, leaveYear);
  const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

  grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:6px">
    ${lv.monthly.map((mv, i) => {
      // 해당 월 사용 연차 수
      const usedM = countUsedLeaveMonth(empId, leaveYear, i+1);
      return `<div style="background:${mv.count?'#EFF6FF':'var(--surf)'};border:1px solid ${mv.count?'#BFDBFE':'var(--bd)'};border-radius:8px;padding:7px;text-align:center">
        <div style="font-size:10px;font-weight:700;color:var(--ink3)">${months[i]}</div>
        <div style="font-size:14px;font-weight:700;color:${mv.count?'var(--navy2)':'var(--ink3)'};margin:3px 0">${mv.count||0}</div>
        <div style="font-size:8px;color:var(--ink3)">적립</div>
        ${usedM > 0 ? `<div style="font-size:11px;font-weight:700;color:var(--rose);margin-top:2px">-${usedM}</div><div style="font-size:8px;color:var(--rose)">사용</div>` : ''}
      </div>`;
    }).join('')}
  </div>
  <div style="margin-top:8px;display:flex;gap:16px;font-size:11px;color:var(--ink2)">
    <span>총 연차: <strong>${lv.total}개</strong></span>
    <span>사용: <strong style="color:var(--rose)">${lv.used}일</strong></span>
    <span>잔여: <strong style="color:var(--navy2)">${lv.remain}일</strong></span>
    <span>연차수당(1일): <strong style="color:var(--purple)">${Math.round(getLeavePayAmount(emp,leaveYear)).toLocaleString()}원</strong></span>
  </div>`;
}

function countUsedLeaveMonth(empId, year, month) {
  let used = 0;
  const days = dim(year, month);
  for (let d = 1; d <= days; d++) {
    const rec = REC[rk(empId, year, month, d)];
    if (!rec) continue;
    if (rec.annual) used += 1;
    else if (rec.halfAnnual) used += 0.5;
  }
  return used;
}


// ══════════════════════════════════════════════════════
// 🎨 스타일 엑셀 내보내기 공통 유틸
// ══════════════════════════════════════════════════════

// 공통 스타일 상수
// ══════════════════════════════════════════════════════
// 🎨 엑셀 스타일 유틸 - 프리미엄 디자인
// ══════════════════════════════════════════════════════

const XLS = {
  // ── 색상 팔레트 ──
  C: {
    navy:    '0F2952',  navy2:   '1D3557',  blue:    '1565C0',
    blue2:   '1976D2',  blue3:   'BBDEFB',  blue4:   'E3F2FD',
    teal:    '00695C',  teal2:   '00897B',  teal3:   'B2DFDB',  teal4:   'E0F2F1',
    green:   '2E7D32',  green2:  '388E3C',  green3:  'C8E6C9',  green4:  'E8F5E9',
    rose:    'C62828',  rose2:   'D32F2F',  rose3:   'FFCDD2',  rose4:   'FFEBEE',
    orange:  'E65100',  orange2: 'F57C00',  orange3: 'FFE0B2',  orange4: 'FFF3E0',
    purple:  '4A148C',  purple2: '6A1B9A',  purple3: 'E1BEE7',  purple4: 'F3E5F5',
    gray:    '455A64',  gray2:   '607D8B',  gray3:   'ECEFF1',  gray4:   'F8FAFC',
    white:   'FFFFFF',  dark:    '1A1A2E',
  },

  // ── 폰트 ──
  F: {
    title:  (sz=18) => ({bold:true, sz, color:{rgb:'0F2952'}, name:'맑은 고딕'}),
    sub:    (sz=10) => ({sz, color:{rgb:'607D8B'}, name:'맑은 고딕', italic:true}),
    hdr:    (rgb='FFFFFF', sz=10) => ({bold:true, sz, color:{rgb}, name:'맑은 고딕'}),
    body:   (rgb='1A1A2E', sz=10, bold=false) => ({sz, color:{rgb}, bold, name:'맑은 고딕'}),
    num:    (rgb='1A1A2E', sz=10, bold=false) => ({sz, color:{rgb}, bold, name:'맑은 고딕'}),
    accent: (rgb, sz=10, bold=true) => ({sz, color:{rgb}, bold, name:'맑은 고딕'}),
  },

  // ── 테두리 ──
  B: {
    none: {},
    thin: (rgb='D1D5DB') => {
      const s = {style:'thin', color:{rgb}};
      return {top:s, bottom:s, left:s, right:s};
    },
    medium: (rgb='9CA3AF') => {
      const s = {style:'medium', color:{rgb}};
      return {top:s, bottom:s, left:s, right:s};
    },
    thick: (rgb='374151') => {
      const s = {style:'thick', color:{rgb}};
      return {top:s, bottom:s, left:s, right:s};
    },
    bottom_thick: (rgb='1565C0') => ({
      top:{style:'thin',color:{rgb:'D1D5DB'}},
      bottom:{style:'medium',color:{rgb}},
      left:{style:'thin',color:{rgb:'D1D5DB'}},
      right:{style:'thin',color:{rgb:'D1D5DB'}},
    }),
    outer_medium: (rgb='374151') => ({
      top:{style:'medium',color:{rgb}},
      bottom:{style:'medium',color:{rgb}},
      left:{style:'medium',color:{rgb}},
      right:{style:'medium',color:{rgb}},
    }),
  },

  // ── 셀 스타일 빌더 ──
  S: {
    // 메인 헤더 (진한 배경)
    mainHdr: (bg='0F2952', fg='FFFFFF', align='center') => ({
      font: XLS.F.hdr(fg, 10),
      fill: {fgColor:{rgb:bg}},
      alignment: {horizontal:align, vertical:'center', wrapText:true},
      border: XLS.B.thin('1E3A5F'),
    }),

    // 서브 헤더 (중간 배경)
    subHdr: (bg, fg='FFFFFF', align='center') => ({
      font: XLS.F.hdr(fg, 9),
      fill: {fgColor:{rgb:bg}},
      alignment: {horizontal:align, vertical:'center', wrapText:true},
      border: XLS.B.thin(),
    }),

    // 일반 셀
    cell: (fg='1A1A2E', bg='FFFFFF', bold=false, align='left') => ({
      font: XLS.F.body(fg, 10, bold),
      fill: {fgColor:{rgb:bg}},
      alignment: {horizontal:align, vertical:'center'},
      border: XLS.B.thin(),
    }),

    // 숫자 셀
    num: (fg='1A1A2E', bg='FFFFFF', bold=false, fmt='#,##0') => ({
      font: XLS.F.num(fg, 10, bold),
      fill: {fgColor:{rgb:bg}},
      alignment: {horizontal:'right', vertical:'center'},
      border: XLS.B.thin(),
      numFmt: fmt,
    }),

    // 소수점 숫자
    numDec: (fg='1A1A2E', bg='FFFFFF', bold=false) => ({
      font: XLS.F.num(fg, 10, bold),
      fill: {fgColor:{rgb:bg}},
      alignment: {horizontal:'right', vertical:'center'},
      border: XLS.B.thin(),
      numFmt: '#,##0.00',
    }),

    // 합계 셀
    total: (fg='FFFFFF', bg='1565C0') => ({
      font: XLS.F.accent(fg, 11),
      fill: {fgColor:{rgb:bg}},
      alignment: {horizontal:'right', vertical:'center'},
      border: XLS.B.medium('0D47A1'),
      numFmt: '#,##0',
    }),

    // 타이틀 셀
    title: (sz=16) => ({
      font: XLS.F.title(sz),
      fill: {fgColor:{rgb:'FFFFFF'}},
      alignment: {horizontal:'left', vertical:'center'},
    }),

    // 빈 셀 (행 구분용)
    empty: (bg='FFFFFF') => ({
      fill: {fgColor:{rgb:bg}},
      border: XLS.B.thin(),
    }),

    // 강조 셀 (색상 배경 + 굵은 글씨)
    accent: (fg, bg, bold=true) => ({
      font: XLS.F.accent(fg, 10, bold),
      fill: {fgColor:{rgb:bg}},
      alignment: {horizontal:'center', vertical:'center'},
      border: XLS.B.thin(),
    }),
  },
};

// ── 셀 쓰기 ──
function xlsWrite(ws, addr, v, s){
  ws[addr] = {v, t: typeof v==='number'?'n':'s'};
  if(s) ws[addr].s = s;
}

// ── 범위 설정 ──
function xlsRange(ws, r1,c1,r2,c2){
  ws['!ref'] = XLSX.utils.encode_range({s:{r:r1,c:c1},e:{r:r2,c:c2}});
}

// ── 셀 병합 ──
function xlsMerge(ws, r1,c1,r2,c2){
  if(!ws['!merges']) ws['!merges']=[];
  ws['!merges'].push({s:{r:r1,c:c1},e:{r:r2,c:c2}});
}

// ── 타이틀 블록 (병합 타이틀 + 부제목) ──
function xlsTitleBlock(ws, title, sub, colCount, row=0){
  xlsWrite(ws, XLSX.utils.encode_cell({r:row,c:0}), title, {
    font:{bold:true,sz:16,color:{rgb:'0F2952'},name:'맑은 고딕'},
    fill:{fgColor:{rgb:'EFF6FF'}},
    alignment:{horizontal:'left',vertical:'center'},
  });
  xlsMerge(ws, row,0,row,Math.min(colCount-1,5));
  xlsWrite(ws, XLSX.utils.encode_cell({r:row+1,c:0}), sub, {
    font:{sz:9,color:{rgb:'94A3B8'},name:'맑은 고딕'},
    fill:{fgColor:{rgb:'EFF6FF'}},
    alignment:{horizontal:'left',vertical:'center'},
  });
  xlsMerge(ws, row+1,0,row+1,Math.min(colCount-1,5));
  return row+2;
}

// ── 행 배경색 (짝수/홀수) ──
function xlsRowBg(ei){ return ei%2===0?'FFFFFF':'F8FAFC'; }



// ══════════════════════════════════════════════════════
// 📅 월별현황 엑셀 - 프리미엄
// ══════════════════════════════════════════════════════
function exportMonthlyExcel(){
  const wb = XLSX.utils.book_new();
  const days = dim(vY, vM);
  const dowKo = ['일','월','화','수','목','금','토'];
  const monthStr = `${vY}년 ${vM}월`;
  const C = XLS.C; const S = XLS.S;

  // ── 시트1: 전체 현황표 ──
  {
    const ws = {}; let R=0;
    const colCount = days+10;

    // 타이틀 블록
    R = xlsTitleBlock(ws, `📊 ${monthStr} 근태 전체 현황`, `출력일: ${new Date().toLocaleDateString('ko-KR')} · 총 ${(()=>{return EMPS.filter(e=>{if(mvFilter!=='all'&&(e.payMode||'fixed')!==mvFilter)return false;if(MF.shift!=='all'&&(e.shift||'day')!==MF.shift)return false;const isFor=e.nation==='foreign'||e.foreigner===true;if(MF.nation==='korean'&&isFor)return false;if(MF.nation==='foreign'&&!isFor)return false;if(MF.dept!=='all'&&(e.dept||'').trim()!==MF.dept)return false;return !e.leave;}).length})()}명`, colCount, R);
    ws['!rows'] = [{hpt:28},{hpt:16}];

    // 헤더행
    const fixedHdrs = ['직원','직종/직급'];
    const tailHdrs = ['출근','결근','연차','총h','야간h','연장h','급여'];
    const allHdrs = [...fixedHdrs, ...Array.from({length:days},(_,i)=>`${i+1}`), ...tailHdrs];

    // 헤더 스타일
    fixedHdrs.forEach((h,ci)=>{
      xlsWrite(ws, XLSX.utils.encode_cell({r:R,c:ci}), h, S.mainHdr(C.navy,'FFFFFF','center'));
    });
    for(let d=1;d<=days;d++){
      const ci=d+1;
      const dow=new Date(vY,vM-1,d).getDay();
      const isHol=isAutoHol(vY,vM,d);
      const isSat=dow===6; const isSun=dow===0;
      const bg=isHol||isSun?'B71C1C':isSat?'1565C0':C.navy2;
      const label=`${d}\n${dowKo[dow]}`;
      xlsWrite(ws, XLSX.utils.encode_cell({r:R,c:ci}), label, S.mainHdr(bg,'FFFFFF','center'));
    }
    const tailBgs=[C.teal,C.rose,'2E7D32','1565C0',C.purple2,'4527A0','0F2952'];
    tailHdrs.forEach((h,i)=>{
      xlsWrite(ws, XLSX.utils.encode_cell({r:R,c:days+2+i}), h, S.mainHdr(tailBgs[i],'FFFFFF','center'));
    });
    ws['!rows'].push({hpt:30});
    R++;

    // 데이터
    const emps = EMPS.filter(e=>{
      if(!e.join||new Date(e.join)>new Date(vY,vM,0)) return false;
      if(e.leave&&new Date(e.leave)<new Date(vY,vM-1,1)) return false;
      if(mvFilter!=='all'){const ep=e.payMode||'fixed';if(mvFilter==='monthly'){if(ep!=='monthly'&&ep!=='pohal')return false;}else{if(ep!==mvFilter)return false;}}
      if(MF.shift!=='all'&&(e.shift||'day')!==MF.shift) return false;
      const isFor=e.nation==='foreign'||e.foreigner===true;
      if(MF.nation==='korean'&&isFor) return false;
      if(MF.nation==='foreign'&&!isFor) return false;
      if(MF.dept!=='all'&&(e.dept||'').trim()!==MF.dept) return false;
      return true;
    });

    emps.forEach((emp,ei)=>{
      const s=monthSummary(emp.id,vY,vM);
      const bg=xlsRowBg(ei);
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:0}),emp.name,S.cell(C.navy,bg,true,'center'));
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:1}),`${emp.role}${emp.grade?'/'+emp.grade:''}`,S.cell(C.gray,bg,false,'center'));

      const empLeaveDate = emp.leave ? new Date(emp.leave) : null;
      for(let d=1;d<=days;d++){
        const dow=new Date(vY,vM-1,d).getDay();
        const isWe=[0,6].includes(dow);
        const autoH=isAutoHol(vY,vM,d);
        // 퇴사일 이후 날짜는 빈 셀
        if(empLeaveDate && empLeaveDate<=new Date(vY,vM-1,d)){
          xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:d+1}),'',S.cell(C.gray,'F5F5F5',false,'center'));
          continue;
        }
        const rec=REC[rk(emp.id,vY,vM,d)];
        let val='', cellBg=bg, fg=C.gray;
        if(autoH||isWe) cellBg=ei%2===0?'FFEBEE':'FFCDD2';
        if(rec){
          if(rec.absent){val='결근';cellBg='FFCDD2';fg=C.rose;}
          else if(rec.annual){val='연차';cellBg='C8E6C9';fg=C.green;}
          else if(rec.halfAnnual){val='반차';cellBg='B3E5FC';fg='01579B';}
          else if(rec.start&&rec.end){
            const _s1Bks=getActiveBk(vY,vM,d,emp);
            const _s1ActiveBks = rec.customBk ? (rec.customBkList||[]) : _s1Bks;
            const c2=calcSession(rec.start,rec.end,getEmpRate(emp),autoH,_s1ActiveBks,rec.outTimes||[],getEmpPayMode(emp),getOrdinaryRate(emp,vY,vM));
            // m2h가 이미 2자리 반올림 처리. toFixed로 추가 절삭하지 않음 → UI(6.83) ≡ 엑셀(6.83)
            if(c2){val=m2h(c2.work);fg=C.navy;}
          }
        }
        const isNum=typeof val==='number';
        xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:d+1}),val||'',
          isNum?S.numDec(val>=8?C.green:val>0?C.navy:C.gray,cellBg):S.accent(fg,cellBg,true));
      }

      // 집계
      const totalPay=Math.round(monthSummary(emp.id,vY,vM).tBase);
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:days+2}),s.wdays,S.num(C.green,ei%2===0?C.green4:'E8F5E9',true));
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:days+3}),s.adays,S.num(s.adays>0?C.rose:C.gray,s.adays>0?(ei%2===0?C.rose4:'FFEBEE'):bg,s.adays>0));
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:days+4}),+s.aldays.toFixed(1),S.numDec(C.orange2,ei%2===0?C.orange4:'FFF3E0'));
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:days+5}),+s.twkH.toFixed(2),S.numDec(C.navy,bg,true));
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:days+6}),+(s.tNightH||0).toFixed(2),S.numDec(C.purple2,ei%2===0?C.purple4:'F3E5F5'));
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:days+7}),+((s.tOtDayH||0)+(s.tOtNightH||0)).toFixed(2),S.numDec(C.blue,ei%2===0?C.blue4:'E3F2FD'));
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:days+8}),totalPay,S.num('FFFFFF','0F2952',true));
      ws['!rows'].push({hpt:20});
      R++;
    });

    ws['!cols']=[{wch:10},{wch:10},...Array(days).fill({wch:5.5}),...[{wch:6},{wch:6},{wch:6},{wch:7},{wch:7},{wch:7},{wch:11}]];
    xlsRange(ws,0,0,R-1,days+8);
    XLSX.utils.book_append_sheet(wb,ws,`전체현황`);
  }

  // ── 시트2~N: 직원별 캘린더 ──
  const calEmps=EMPS.filter(e=>{
    if(!e.join||new Date(e.join)>new Date(vY,vM,0)) return false;
    if(e.leave&&new Date(e.leave)<new Date(vY,vM-1,1)) return false;
    if(mvFilter!=='all'){const ep=e.payMode||'fixed';if(mvFilter==='monthly'){if(ep!=='monthly'&&ep!=='pohal')return false;}else{if(ep!==mvFilter)return false;}}
    return true;
  });

  calEmps.forEach(emp=>{
    const ws={}; let R=0;
    const C=XLS.C; const S=XLS.S;
    const s=monthSummary(emp.id,vY,vM);

    // 타이틀
    xlsWrite(ws,XLSX.utils.encode_cell({r:0,c:0}),`${emp.name}`, {
      font:{bold:true,sz:18,color:{rgb:C.navy},name:'맑은 고딕'},
      fill:{fgColor:{rgb:'EFF6FF'}}, alignment:{horizontal:'left',vertical:'center'},
    });
    xlsMerge(ws,0,0,0,4);
    xlsWrite(ws,XLSX.utils.encode_cell({r:1,c:0}),`${monthStr} 근태 현황  ·  ${emp.role}${emp.dept?' · '+emp.dept:''}  ·  입사 ${emp.join||''}${emp.leave?' · 퇴사 '+emp.leave:''}`, {
      font:{sz:9,color:{rgb:C.gray2},name:'맑은 고딕'},
      fill:{fgColor:{rgb:'EFF6FF'}}, alignment:{horizontal:'left',vertical:'center'},
    });
    xlsMerge(ws,1,0,1,10);
    R=2;

    // 요약 카드 행
    const cards=[
      ['출근일',s.wdays,'일',C.green,C.green4],
      ['결근일',s.adays,'일',C.rose,C.rose4],
      ['연차',+s.aldays.toFixed(1),'일',C.orange2,C.orange4],
      ['총근무',+s.twkH.toFixed(2),'h',C.navy,C.blue4],
      ['야간',+(s.tNightH||0).toFixed(2),'h',C.purple2,C.purple4],
      ['연장',+((s.tOtDayH||0)+(s.tOtNightH||0)).toFixed(2),'h',C.blue,C.blue3],
    ];
    cards.forEach((card,i)=>{
      const col=i*2;
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:col}),card[0],{
        font:{bold:true,sz:9,color:{rgb:card[3]},name:'맑은 고딕'},
        fill:{fgColor:{rgb:card[4]}},alignment:{horizontal:'center',vertical:'center'},
        border:XLS.B.thin(card[3]),
      });
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:col+1}),`${card[1]}${card[2]}`,{
        font:{bold:true,sz:12,color:{rgb:card[3]},name:'맑은 고딕'},
        fill:{fgColor:{rgb:card[4]}},alignment:{horizontal:'center',vertical:'center'},
        border:XLS.B.thin(card[3]),
      });
      xlsMerge(ws,R,col,R,col+1);
    });
    ws['!rows']=[{hpt:28},{hpt:16},{hpt:28}];
    R++;
    R++; // 공백행

    // 테이블 헤더 (휴게(h) 칼럼 신설)
    const tHdrs=['날짜','요일','출근','퇴근','휴게(h)','실근무(h)','야간(h)','연장(h)','휴일(h)','연차/결근','비고'];
    const tBgs=[C.navy,C.navy,C.navy2,C.navy2,'2D6A4F',C.teal2,C.purple2,C.blue,C.orange2,'2E7D32',C.gray];
    tHdrs.forEach((h,ci)=>{
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci}),h,S.mainHdr(tBgs[ci],'FFFFFF','center'));
    });
    ws['!rows'].push({hpt:8},{hpt:26});
    R++;

    const empLeaveDate2 = emp.leave ? new Date(emp.leave) : null;
    let totalBk = 0;
    for(let d=1;d<=days;d++){
      const autoH=isAutoHol(vY,vM,d);
      const dow=new Date(vY,vM-1,d).getDay();
      const isSun=dow===0; const isSat=dow===6;
      const phName=getPhName&&getPhName(vY,vM,d)||'';

      let rowBg=xlsRowBg(d-1);
      if(autoH||isSun) rowBg='FFEBEE';
      else if(isSat) rowBg='EFF6FF';

      const dateStr=`${vM}/${d}`;
      const dowLabel=dowKo[dow];
      const dowColor=isSun?C.rose:isSat?C.blue:C.navy;

      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:0}),dateStr,S.cell(C.navy,rowBg,false,'center'));
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:1}),phName||dowLabel,S.cell(autoH?C.rose:dowColor,rowBg,autoH||isSun||isSat,'center'));

      // 퇴사일 이후 날짜는 빈 행 (REC 무시)
      if(empLeaveDate2 && empLeaveDate2<=new Date(vY,vM-1,d)){
        [2,3,4,5,6,7,8,9,10].forEach(ci=>xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci}),'',S.empty('F5F5F5')));
        ws['!rows'].push({hpt:18});
        R++;
        continue;
      }

      const rec=REC[rk(emp.id,vY,vM,d)];
      if(rec){
        const bks=getActiveBk(vY,vM,d,emp);
        const activeBks = rec.customBk ? (rec.customBkList||[]) : bks;
        const c2=rec.start&&rec.end?calcSession(rec.start,rec.end,getEmpRate(emp),autoH,activeBks,rec.outTimes||[],getEmpPayMode(emp),getOrdinaryRate(emp,vY,vM)):null;
        const note=rec.absent?'결근':rec.annual?'연차':rec.halfAnnual?'반차':'';
        const noteBg=rec.absent?C.rose3:rec.annual?C.green3:rec.halfAnnual?C.blue3:rowBg;
        const noteFg=rec.absent?C.rose:rec.annual?C.green:rec.halfAnnual?C.blue:C.gray;
        const bkH = c2 && c2.bkMins ? +m2h(c2.bkMins).toFixed(2) : 0;
        if(c2 && c2.bkMins) totalBk += c2.bkMins;

        xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:2}),rec.start||'',S.cell(C.navy,rec.start?C.teal4:rowBg,!!rec.start,'center'));
        xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:3}),rec.end||'',S.cell(C.navy,rec.end?C.teal4:rowBg,!!rec.end,'center'));
        xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:4}),bkH,S.numDec('2D6A4F',bkH>0?'E8F5E9':rowBg,bkH>0));
        xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:5}),c2?+m2h(c2.work).toFixed(2):0,S.numDec(c2?.work>=480?C.green:C.navy,c2?.work>=480?C.green4:rowBg,c2?.work>=480));
        xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:6}),c2&&c2.nightM>0?+m2h(c2.nightM).toFixed(2):0,S.numDec(C.purple2,c2?.nightM>0?C.purple4:rowBg));
        xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:7}),c2&&c2.ot>0?+m2h(c2.ot).toFixed(2):0,S.numDec(C.blue,c2?.ot>0?C.blue4:rowBg));
        xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:8}),autoH&&c2?+m2h(c2.work).toFixed(2):0,S.numDec(C.orange2,autoH&&c2?C.orange4:rowBg));
        xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:9}),note,S.accent(noteFg,noteBg,!!note));
        xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:10}),rec.note||'',S.cell(C.gray,rowBg,false,'left'));
      } else {
        [2,3,4,5,6,7,8,9,10].forEach(ci=>xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci}),'',S.empty(rowBg)));
      }
      ws['!rows'].push({hpt:18});
      R++;
    }

    // 합계행 (휴게 칼럼 추가로 인한 인덱스 shift)
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:0}),'합 계',S.mainHdr(C.teal,'FFFFFF','center'));
    xlsMerge(ws,R,0,R,3);
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:1}),'',S.mainHdr(C.teal));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:2}),'',S.mainHdr(C.teal));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:3}),'',S.mainHdr(C.teal));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:4}),+m2h(totalBk).toFixed(2),XLS.S.total('FFFFFF','2D6A4F'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:5}),+s.twkH.toFixed(2),XLS.S.total('FFFFFF',C.teal));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:6}),+(s.tNightH||0).toFixed(2),XLS.S.total('FFFFFF',C.purple));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:7}),+((s.tOtDayH||0)+(s.tOtNightH||0)).toFixed(2),XLS.S.total('FFFFFF',C.blue));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:8}),+((s.tHolDayH||0)+(s.tHolNightH||0)+(s.tHolDayOtH||0)+(s.tHolNightOtH||0)).toFixed(2),XLS.S.total('FFFFFF',C.orange2));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:9}),+s.aldays.toFixed(1),XLS.S.total('FFFFFF',C.green));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:10}),'',S.mainHdr(C.gray));
    ws['!rows'].push({hpt:24});

    ws['!cols']=[{wch:7},{wch:6},{wch:7},{wch:7},{wch:8},{wch:10},{wch:8},{wch:8},{wch:8},{wch:8},{wch:16}];
    xlsRange(ws,0,0,R,10);
    XLSX.utils.book_append_sheet(wb,ws,emp.name.slice(0,8));
  });

  XLSX.writeFile(wb,`월별현황_${monthStr}.xlsx`);
}

// ══════════════════════════════════════════════════════
// 👥 직원관리 엑셀 - 프리미엄
// ══════════════════════════════════════════════════════
let empFilter = 'all';
function exportEmpsExcel(){
  const wb = XLSX.utils.book_new();
  const ws = {}; let R=0;
  const C=XLS.C; const S=XLS.S;
  const activeEmps = EMPS.filter(e=>!e.leave);
  const leftEmps = EMPS.filter(e=>e.leave);

  // ── 타이틀 ──
  xlsWrite(ws,XLSX.utils.encode_cell({r:0,c:0}),'직원 관리 명부',{
    font:{bold:true,sz:18,color:{rgb:C.navy},name:'맑은 고딕'},
    fill:{fgColor:{rgb:'EFF6FF'}},
    alignment:{horizontal:'left',vertical:'center'},
  });
  xlsMerge(ws,0,0,0,9);
  xlsWrite(ws,XLSX.utils.encode_cell({r:1,c:0}),
    `기준일: ${new Date().toLocaleDateString('ko-KR')}  ·  재직 ${activeEmps.length}명  ·  퇴사 ${leftEmps.length}명  ·  총 ${EMPS.length}명`,{
    font:{sz:9,color:{rgb:C.gray2},italic:true,name:'맑은 고딕'},
    fill:{fgColor:{rgb:'EFF6FF'}},
    alignment:{horizontal:'left',vertical:'center'},
  });
  xlsMerge(ws,1,0,1,13);
  ws['!rows']=[{hpt:30},{hpt:16}];
  R=2;

  // ── 헤더 ──
  const hdrs = ['사번','이름','직종','직급','소속','급여방식','시급/월급','입사일','성별','내외국인','주야간','연락처','나이','재직상태'];
  const hdrColors = {
    '사번':C.gray,  '이름':C.navy,  '직종':C.navy2, '직급':C.navy2,
    '소속':C.teal,  '급여방식':C.orange2,'시급/월급':C.orange2,'입사일':C.teal,
    '성별':C.blue,  '내외국인':C.blue,   '주야간':C.blue,
    '연락처':C.gray,'나이':C.gray,  '재직상태':C.navy,
  };
  hdrs.forEach((h,ci)=>xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci}),h,S.mainHdr(hdrColors[h]||C.navy,'FFFFFF','center')));
  ws['!rows'].push({hpt:26});
  R++;

  // ── 데이터 ──
  const sortedEmps = [...EMPS].sort((a,b)=>{
    if(!a.leave&&b.leave) return -1;
    if(a.leave&&!b.leave) return 1;
    return 0;
  }).filter(e=>empFilter==='all'||(e.payMode||'fixed')===empFilter);

  sortedEmps.forEach((e,ei)=>{
    const isLeft=!!e.leave;
    const bg = isLeft ? 'FFF5F5' : xlsRowBg(ei);
    const payMode=(e.payMode||'fixed');
    const payLabel=payMode==='fixed'?'통상임금제':payMode==='hourly'?'시급제':'월급제';
    const payVal=payMode==='monthly'?(e.monthly||POL.baseMonthly):(e.rate||POL.baseRate);
    const payBg=payMode==='fixed'?C.blue4:payMode==='hourly'?C.green4:C.orange4;
    const payFg=payMode==='fixed'?C.blue:payMode==='hourly'?C.green:C.orange2;

    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:0}),e.empNo||'',S.cell(C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:1}),e.name,S.cell(isLeft?C.gray:C.navy,bg,!isLeft,'left'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:2}),e.role||'',S.cell(C.gray2,bg,false,'left'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:3}),e.grade||'',S.cell(C.gray2,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:4}),e.dept||'',S.cell(C.gray2,bg,false,'center'));

    // 급여방식 - 색상 구분
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:5}),payLabel,{
      font:{bold:true,sz:10,color:{rgb:payFg},name:'맑은 고딕'},
      fill:{fgColor:{rgb:payBg}},
      alignment:{horizontal:'center',vertical:'center'},
      border:XLS.B.thin(),
    });
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:6}),payVal||0,S.num(C.navy,bg));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:7}),e.join||'',S.cell(C.gray2,bg,false,'center'));

    // 성별 - 남/여 색상
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:8}),e.gender==='female'?'여':'남',{
      font:{bold:true,sz:10,color:{rgb:e.gender==='female'?C.rose:C.blue},name:'맑은 고딕'},
      fill:{fgColor:{rgb:e.gender==='female'?C.rose4:C.blue4}},
      alignment:{horizontal:'center',vertical:'center'},
      border:XLS.B.thin(),
    });
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:9}),e.nation==='foreign'?'외국인':'내국인',S.cell(C.gray2,bg,false,'center'));

    // 주야간 - 색상
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:10}),e.shift==='night'?'야간':'주간',{
      font:{bold:true,sz:10,color:{rgb:e.shift==='night'?C.purple2:C.orange2},name:'맑은 고딕'},
      fill:{fgColor:{rgb:e.shift==='night'?C.purple4:C.orange4}},
      alignment:{horizontal:'center',vertical:'center'},
      border:XLS.B.thin(),
    });
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:11}),e.phone||'',S.cell(C.gray2,bg,false,'left'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:12}),e.age||'',S.num(C.gray2,bg));

    // 재직상태 - 재직/퇴사 색상
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:13}),isLeft?`퇴사 ${e.leave}`:'재직 중',{
      font:{bold:true,sz:10,color:{rgb:isLeft?C.rose:C.green},name:'맑은 고딕'},
      fill:{fgColor:{rgb:isLeft?C.rose4:C.green4}},
      alignment:{horizontal:'center',vertical:'center'},
      border:XLS.B.thin(),
    });
    ws['!rows'].push({hpt:20});
    R++;
  });

  // ── 요약 행 ──
  xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:0}),'합 계',S.mainHdr(C.navy));
  xlsMerge(ws,R,0,R,4);
  [1,2,3,4].forEach(c=>xlsWrite(ws,XLSX.utils.encode_cell({r:R,c}),'',S.mainHdr(C.navy)));
  xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:5}),`총 ${sortedEmps.length}명`,{
    font:{bold:true,sz:11,color:{rgb:'FFFFFF'},name:'맑은 고딕'},
    fill:{fgColor:{rgb:C.teal}},alignment:{horizontal:'center',vertical:'center'},
    border:XLS.B.thin(C.teal),
  });
  xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:13}),`재직 ${activeEmps.length} / 퇴사 ${leftEmps.length}`,{
    font:{bold:true,sz:10,color:{rgb:'FFFFFF'},name:'맑은 고딕'},
    fill:{fgColor:{rgb:C.navy}},alignment:{horizontal:'center',vertical:'center'},
    border:XLS.B.thin(),
  });
  ws['!rows'].push({hpt:24});
  R++;

  ws['!cols']=[{wch:7},{wch:11},{wch:11},{wch:8},{wch:11},{wch:8},{wch:11},{wch:12},{wch:5},{wch:8},{wch:6},{wch:14},{wch:5},{wch:14}];
  xlsRange(ws,0,0,R-1,13);
  XLSX.utils.book_append_sheet(wb,ws,'직원 명부');
  XLSX.writeFile(wb,`직원관리_${new Date().toISOString().slice(0,10)}.xlsx`);
}


// ══════════════════════════════════════════════════════
// 📊 직원현황 엑셀 - 프리미엄
// ══════════════════════════════════════════════════════
let companyFilter = 'all';
function exportCompanyExcel(){
  const wb = XLSX.utils.book_new();
  const ws = {}; let R=0;
  const C=XLS.C; const S=XLS.S;
  const months=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

  // ── 타이틀 ──
  xlsWrite(ws,XLSX.utils.encode_cell({r:0,c:0}),`${companyYear}년 직원 현황`,{
    font:{bold:true,sz:18,color:{rgb:C.navy},name:'맑은 고딕'},
    fill:{fgColor:{rgb:'EFF6FF'}},
    alignment:{horizontal:'left',vertical:'center'},
  });
  xlsMerge(ws,0,0,0,9);
  xlsWrite(ws,XLSX.utils.encode_cell({r:1,c:0}),
    `기준연도: ${companyYear}년  ·  출력일: ${new Date().toLocaleDateString('ko-KR')}`,{
    font:{sz:9,color:{rgb:C.gray2},italic:true,name:'맑은 고딕'},
    fill:{fgColor:{rgb:'EFF6FF'}},
    alignment:{horizontal:'left',vertical:'center'},
  });
  xlsMerge(ws,1,0,1,17);
  ws['!rows']=[{hpt:30},{hpt:16}];
  R=2;

  // ── 헤더 ──
  const fixHdrs=['직원','직종','입사일'];
  const m1Hdrs=months.slice(0,6);  // 1~6월 (틸2)
  const m2Hdrs=months.slice(6,12); // 7~12월 (틸)
  const totHdrs=['연간출근','연간결근','연간연차','연간급여'];
  const allHdrs=[...fixHdrs,...m1Hdrs,...m2Hdrs,...totHdrs];

  const getHdrBg=(h)=>{
    if(['직원','직종','입사일'].includes(h)) return C.navy;
    if(months.slice(0,6).includes(h)) return C.teal2;
    if(months.slice(6,12).includes(h)) return C.teal;
    if(h==='연간출근') return C.green;
    if(h==='연간결근') return C.rose;
    if(h==='연간연차') return C.orange2;
    if(h==='연간급여') return '0D47A1';
    return C.gray;
  };

  allHdrs.forEach((h,ci)=>xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci}),h,S.mainHdr(getHdrBg(h),'FFFFFF','center')));
  ws['!rows'].push({hpt:26});
  R++;

  // ── 데이터 ──
  const emps=EMPS.filter(e=>{
    if(companyFilter!=='all'){const ep=e.payMode||'fixed';if(companyFilter==='monthly'){if(ep!=='monthly'&&ep!=='pohal')return false;}else{if(ep!==companyFilter)return false;}}
    if(!e.join||new Date(e.join)>new Date(companyYear,11,31)) return false;
    return true;
  });

  const monthTotals = Array(12).fill(0);
  let grandWork=0, grandAbsent=0, grandLeave=0, grandPay=0;

  emps.forEach((emp,ei)=>{
    const bg=xlsRowBg(ei);
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:0}),emp.name,S.cell(C.navy,bg,true,'left'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:1}),`${emp.role||''}${emp.grade?' / '+emp.grade:''}`,S.cell(C.gray2,bg,false,'left'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:2}),emp.join||'',S.cell(C.gray2,bg,false,'center'));

    let totalWork=0,totalAbsent=0,totalLeave=0,totalPay=0;
    for(let m=1;m<=12;m++){
      const s=monthSummary(emp.id,companyYear,m);
      totalWork+=s.wdays; totalAbsent+=s.adays; totalLeave+=s.aldays;
      totalPay+=s.tBase;
      monthTotals[m-1]+=s.wdays;

      const wdays=s.wdays||0;
      const wBg=wdays>=20?C.green4:wdays>0?C.teal4:bg;
      const wFg=wdays>=20?C.green:wdays>0?C.teal:C.gray;
      xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:m+2}),wdays||'',
        wdays?{font:{bold:wdays>=20,sz:10,color:{rgb:wFg},name:'맑은 고딕'},fill:{fgColor:{rgb:wBg}},alignment:{horizontal:'center',vertical:'center'},border:XLS.B.thin()}:S.empty(bg));
    }

    grandWork+=totalWork; grandAbsent+=totalAbsent; grandLeave+=totalLeave; grandPay+=totalPay;

    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:15}),totalWork,{
      font:{bold:true,sz:11,color:{rgb:C.green},name:'맑은 고딕'},
      fill:{fgColor:{rgb:C.green4}},alignment:{horizontal:'right',vertical:'center'},
      border:XLS.B.thin(),numFmt:'#,##0',
    });
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:16}),totalAbsent||'',
      totalAbsent?{font:{bold:true,sz:10,color:{rgb:C.rose},name:'맑은 고딕'},fill:{fgColor:{rgb:C.rose4}},alignment:{horizontal:'right',vertical:'center'},border:XLS.B.thin()}:S.empty(bg));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:17}),+totalLeave.toFixed(1)||'',
      totalLeave?{font:{sz:10,color:{rgb:C.orange2},name:'맑은 고딕'},fill:{fgColor:{rgb:C.orange4}},alignment:{horizontal:'right',vertical:'center'},border:XLS.B.thin(),numFmt:'#,##0.0'}:S.empty(bg));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:18}),Math.round(totalPay),S.num('FFFFFF','1565C0',true));
    ws['!rows'].push({hpt:20});
    R++;
  });

  // ── 합계행 ──
  xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:0}),'합 계',S.mainHdr(C.navy));
  xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:1}),`${emps.length}명`,{
    font:{bold:true,sz:10,color:{rgb:'FFFFFF'},name:'맑은 고딕'},
    fill:{fgColor:{rgb:C.navy2}},alignment:{horizontal:'center',vertical:'center'},border:XLS.B.thin(),
  });
  xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:2}),'',S.mainHdr(C.navy));
  for(let m=1;m<=12;m++){
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:m+2}),monthTotals[m-1],{
      font:{bold:true,sz:10,color:{rgb:'FFFFFF'},name:'맑은 고딕'},
      fill:{fgColor:{rgb:C.teal}},alignment:{horizontal:'center',vertical:'center'},
      border:XLS.B.thin(C.teal),numFmt:'#,##0',
    });
  }
  xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:15}),grandWork,S.total('FFFFFF',C.green));
  xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:16}),grandAbsent||'',grandAbsent?S.total('FFFFFF',C.rose):S.empty('ECEFF1'));
  xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:17}),+grandLeave.toFixed(1),S.total('FFFFFF',C.orange2));
  xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:18}),Math.round(grandPay),S.total('FFFFFF','0D47A1'));
  ws['!rows'].push({hpt:26});
  R++;

  ws['!cols']=[{wch:11},{wch:12},{wch:12},...Array(12).fill({wch:6}),{wch:8},{wch:8},{wch:8},{wch:12}];
  xlsRange(ws,0,0,R-1,18);
  XLSX.utils.book_append_sheet(wb,ws,`${companyYear}년 직원현황`);
  XLSX.writeFile(wb,`직원현황_${companyYear}년.xlsx`);
}


// ══════════════════════════════════════════════════════
// 📋 연차관리 엑셀 - 프리미엄
// ══════════════════════════════════════════════════════
function exportLeaveExcel(){
  const wb=XLSX.utils.book_new(); const ws={}; let R=0;
  const C=XLS.C; const S=XLS.S;

  xlsWrite(ws,XLSX.utils.encode_cell({r:0,c:0}),`${leaveYear}년 연차 관리 현황`,{
    font:{bold:true,sz:18,color:{rgb:C.navy},name:'맑은 고딕'},
    fill:{fgColor:{rgb:'EFF6FF'}},alignment:{horizontal:'left',vertical:'center'},
  });
  xlsMerge(ws,0,0,0,6);
  xlsWrite(ws,XLSX.utils.encode_cell({r:1,c:0}),`기준연도: ${leaveYear}년  ·  출력일: ${new Date().toLocaleDateString('ko-KR')}`,{
    font:{sz:9,color:{rgb:C.gray2},name:'맑은 고딕'},
    fill:{fgColor:{rgb:'EFF6FF'}},alignment:{horizontal:'left',vertical:'center'},
  });
  xlsMerge(ws,1,0,1,8);
  ws['!rows']=[{hpt:28},{hpt:16}];
  R=2;

  const hdrs=['이름','직종','입사일','총연차','사용연차','잔여연차','연차형태','1일수당(원)','연차수당합계(원)'];
  const hdrBgs=[C.navy,C.navy2,C.teal,C.blue,C.orange2,C.green,C.gray,C.purple2,C.teal];
  hdrs.forEach((h,ci)=>xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:ci}),h,S.mainHdr(hdrBgs[ci],'FFFFFF','center')));
  ws['!rows'].push({hpt:26});
  R++;

  const leaveEmps=EMPS.filter(e=>{
    if(payFilter!=='all'&&(e.payMode||'fixed')!==payFilter) return false;
    return true;
  });

  leaveEmps.forEach((emp,ei)=>{
    const lv=calcLeaveForYear(emp,leaveYear);
    const payAmt=getLeavePayAmount(emp,leaveYear);
    const type=leaveSettings['type_'+emp.id]==='promote'?'연차촉진':'연차수당';
    const bg=xlsRowBg(ei);
    const total=Math.round(lv.used*payAmt);

    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:0}),emp.name,S.cell(C.navy,bg,true,'left'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:1}),emp.role||'',S.cell(C.gray,bg,false,'left'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:2}),emp.join||'',S.cell(C.gray,bg,false,'center'));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:3}),lv.total,S.num(C.blue,C.blue4,true));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:4}),lv.used,S.num(lv.used>0?C.orange2:C.gray,lv.used>0?C.orange4:bg,lv.used>0));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:5}),lv.remain,S.num(lv.remain>5?C.green:lv.remain>0?C.orange2:C.rose,lv.remain>0?C.green4:C.rose4,true));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:6}),type,S.accent(type==='연차촉진'?C.orange2:C.teal,type==='연차촉진'?C.orange4:C.teal4));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:7}),Math.round(payAmt),S.num(C.navy,bg));
    xlsWrite(ws,XLSX.utils.encode_cell({r:R,c:8}),total,S.total('FFFFFF',total>0?C.teal:C.gray));
    ws['!rows'].push({hpt:20});
    R++;
  });

  ws['!cols']=[{wch:10},{wch:8},{wch:12},{wch:7},{wch:7},{wch:7},{wch:10},{wch:12},{wch:14}];
  xlsRange(ws,0,0,R-1,8);
  XLSX.utils.book_append_sheet(wb,ws,`${leaveYear}년 연차현황`);
  XLSX.writeFile(wb,`연차관리_${leaveYear}년.xlsx`);
}


// ══════════════════════════════════════════════════════
// 💰 급여요약(카드) 엑셀 - exportExcel() 개선판은 별도
// ══════════════════════════════════════════════════════



// ══════════════════════════════════════
// 직원 현황 (회사 월별 현황)
// ══════════════════════════════════════
let companyYear = new Date().getFullYear();
let companyTab = 'all';

function companyYearNav(d) { companyYear += d; renderCompany(); }

function setCompanyTab(t) {
  companyTab = t;
  const btnAll=document.getElementById('cp-tab-all');
  const btnEmp=document.getElementById('cp-tab-emp');
  if(btnAll) btnAll.className='btn btn-sm'+(t==='all'?' btn-n':'');
  if(btnEmp) btnEmp.className='btn btn-sm'+(t==='emp'?' btn-n':'');
  const sel=document.getElementById('cp-emp-sel');
  if(sel){ sel.style.display=t==='emp'?'block':'none'; }
  if(t==='emp'){
    const empSel=document.getElementById('cp-emp-sel');
    if(empSel){ const cur=empSel.value; empSel.innerHTML='<option value="">직원 선택</option>'+EMPS.map(e=>`<option value="${e.id}" ${String(e.id)===cur?'selected':''}>${esc(e.name)}</option>`).join(''); }
  }
  renderCompany();
}


function setCompanyFilter(f){
  companyFilter = f;
  document.querySelectorAll('.cpf-btn').forEach(b=>{
    b.classList.toggle('on', b.dataset.f===f);
  });
  renderCompany();
}
function renderCompany() {
  document.getElementById('company-year-disp').textContent = companyYear;
  const cpYrEl=document.getElementById('cp-year'); if(cpYrEl) cpYrEl.textContent=companyYear;
  const body = document.getElementById('company-body');
  if (!body) return;

  if(companyTab === 'emp') {
    const empSel=document.getElementById('cp-emp-sel');
    const empId=empSel?+empSel.value:0;
    if(!empId){body.innerHTML='<div style="padding:40px;text-align:center;color:var(--ink3);font-size:13px">위에서 직원을 선택하세요.</div>';return;}
    const emp=EMPS.find(e=>e.id===empId);
    if(!emp){body.innerHTML='';return;}
    const months=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    const _isFixed2=getEmpPayMode(emp)==='fixed';
    const rows=months.map((_,mi)=>{
      const m=mi+1;
      const s=monthSummary(emp.id,companyYear,m);
      const addPay=_isFixed2
        ? (s.tExtraWorkPay||0)+(s.tNightPay||0)+(s.tOtDayPay||0)+(s.tOtNightPay||0)+(s.tHolPayNew||0)
        : (s.tNightPay||0)+(s.tOtDayPay||0)+(s.tOtNightPay||0)+(s.tHolDayPay||0)+(s.tHolNightPay||0)+(s.tHolDayOtPay||0)+(s.tHolNightOtPay||0);
      return{m,s,addPay};
    });
    const totBase=rows.reduce((a,r)=>a+r.s.tBase,0);
    const totAdd=rows.reduce((a,r)=>a+r.addPay,0);
    const totBonus=rows.reduce((a,r)=>a+r.s.bonus,0);
    const totAllow=rows.reduce((a,r)=>a+r.s.totalAllowance,0);
    const totDed=rows.reduce((a,r)=>a+r.s.deduction,0);
    const totTotal=rows.reduce((a,r)=>a+r.s.total,0);
    const totDays=rows.reduce((a,r)=>a+r.s.wdays,0);
    const mode=getEmpPayMode(emp);
    body.innerHTML=`
    <div style="background:var(--nbg);border:1.5px solid var(--nbg2);border-radius:12px;padding:12px 16px;margin-bottom:14px;display:flex;gap:16px;flex-wrap:wrap;align-items:center">
      <div style="font-size:15px;font-weight:800;color:var(--navy)">${esc(emp.name)}</div>
      <div style="font-size:11px;color:var(--ink3)">${esc(emp.role||'')} · ${esc(emp.dept||'')}</div>
      <span class="emp-mode-badge ${getEmpPayModeLabel(emp).cls}">${getEmpPayModeLabel(emp).text}</span>
      <span style="font-size:9px;padding:1px 6px;border-radius:5px;background:${getEmpShiftLabel(emp).bg};color:${getEmpShiftLabel(emp).color};font-weight:700">${getEmpShiftLabel(emp).text}</span>
      ${emp.join?`<div style="font-size:11px;color:var(--ink3)">입사: ${emp.join.substring(0,10)}</div>`:''}
    </div>
    <div style="background:var(--card);border:1px solid var(--bd);border-radius:16px;overflow:hidden;overflow-x:auto;box-shadow:var(--shadow-sm)">
      <table style="width:100%;border-collapse:collapse;min-width:680px">
        <thead><tr style="background:var(--navy)">
          <th style="padding:10px 14px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);text-align:left;min-width:56px">월</th>
          <th style="padding:10px 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);text-align:center">근무일수</th>
          ${mode!=='hourly'?'<th style="padding:10px 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);text-align:center">기본급</th>':''}
          <th style="padding:10px 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);text-align:center">추가수당</th>
          <th style="padding:10px 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);text-align:center">상여금</th>
          <th style="padding:10px 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);text-align:center">기타수당</th>
          <th style="padding:10px 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);text-align:center">공제</th>
          <th style="padding:10px 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);text-align:center;background:#0E4D2E;min-width:90px">실지급액</th>
        </tr></thead>
        <tbody>
          ${rows.map(({m,s,addPay})=>`
          <tr style="border-bottom:1px solid var(--bd)${s.wdays===0?';opacity:.35':''}">
            <td style="padding:9px 14px;font-size:12px;font-weight:700;color:var(--navy2);background:var(--surf)">${m}월</td>
            <td style="padding:9px 6px;font-size:11px;text-align:center;color:var(--ink2)">${s.wdays?s.wdays+'일':'-'}</td>
            ${mode!=='hourly'?`<td style="padding:9px 6px;font-size:11px;text-align:center;font-weight:600;color:var(--ink)">${s.tBase?fmt$(s.tBase)+'원':'-'}</td>`:''}
            <td style="padding:9px 6px;font-size:11px;text-align:center;font-weight:600;color:#3C3489">${addPay?fmt$(addPay)+'원':'-'}</td>
            <td style="padding:9px 6px;font-size:11px;text-align:center;color:var(--purple)">${s.bonus?fmt$(s.bonus)+'원':'-'}</td>
            <td style="padding:9px 6px;font-size:11px;text-align:center;color:var(--amber)">${s.totalAllowance?fmt$(s.totalAllowance)+'원':'-'}</td>
            <td style="padding:9px 6px;font-size:11px;text-align:center;color:var(--rose)">${s.deduction?'-'+fmt$(s.deduction)+'원':'-'}</td>
            <td style="padding:9px 6px;font-size:12px;text-align:center;font-weight:700;color:var(--green);background:var(--gbg)">${s.total?fmt$(s.total)+'원':'-'}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:var(--navy);color:#fff">
          <td style="padding:10px 14px;font-size:11px;font-weight:700">합계</td>
          <td style="padding:10px 6px;font-size:11px;text-align:center;font-weight:700">${totDays}일</td>
          ${mode!=='hourly'?`<td style="padding:10px 6px;font-size:11px;text-align:center;font-weight:700">${fmt$(totBase)}원</td>`:''}
          <td style="padding:10px 6px;font-size:11px;text-align:center;font-weight:700">${fmt$(totAdd)}원</td>
          <td style="padding:10px 6px;font-size:11px;text-align:center;font-weight:700">${fmt$(totBonus)}원</td>
          <td style="padding:10px 6px;font-size:11px;text-align:center;font-weight:700">${fmt$(totAllow)}원</td>
          <td style="padding:10px 6px;font-size:11px;text-align:center;font-weight:700">-${fmt$(totDed)}원</td>
          <td style="padding:10px 6px;font-size:12px;text-align:center;font-weight:800;background:#0E4D2E">${fmt$(totTotal)}원</td>
        </tr></tfoot>
      </table>
    </div>
    <div style="margin-top:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      <div class="sc ok"><div class="sc-l">연간 실지급 합계</div><div class="sc-v" style="color:var(--green)">${Math.round(totTotal/10000).toLocaleString()}<span class="sc-u">만원</span></div></div>
      <div class="sc"><div class="sc-l">가산수당 합계</div><div class="sc-v" style="color:#3C3489">${Math.round(totAdd/10000).toLocaleString()}<span class="sc-u">만원</span></div></div>
      <div class="sc"><div class="sc-l">총 근무일수</div><div class="sc-v">${totDays}<span class="sc-u">일</span></div></div>
    </div>`;
    return;
  }

  const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

  const monthData = months.map((_, mi) => {
    const m = mi + 1;
    const daysInMonth = dim(companyYear, m);
    const monthStart = new Date(companyYear, mi, 1);
    const monthEnd   = new Date(companyYear, m, 0);

    // 재직 직원
    const activeEmps = EMPS.filter(emp => {
      if (!emp.join) return false;
      const jd = new Date(emp.join);
      if (jd > monthEnd) return false;
      if (emp.leave && new Date(emp.leave) < monthStart) return false;
      return true;
    });

    // 입사/퇴사
    const newEmps  = EMPS.filter(emp => emp.join  && new Date(emp.join).getFullYear()===companyYear  && new Date(emp.join).getMonth()+1===m);
    const leftEmps = EMPS.filter(emp => emp.leave && new Date(emp.leave).getFullYear()===companyYear && new Date(emp.leave).getMonth()+1===m);

    // 급여 합계
    let totalPay = 0, totalWorkDays = 0;
    activeEmps.forEach(emp => {
      const s = monthSummary(emp.id, companyYear, m);
      totalPay += s.total;
      totalWorkDays += s.wdays;
    });

    // 회사 평일 영업일수 (토/일/공휴일 제외)
    let weekDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (!isAutoHol(companyYear, m, d)) weekDays++;
    }

    // 공휴일/휴일 근무일수: 일일근태에서 휴일(토/일/공휴일)에 실제 출퇴근 입력된 날
    let holWorkDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (!isAutoHol(companyYear, m, d)) continue; // 휴일 아니면 스킵
      // 한 명이라도 그날 출퇴근 입력하면 카운트
      const anyWorked = EMPS.some(emp => {
        const rec = REC[rk(emp.id, companyYear, m, d)];
        return rec && rec.start && rec.end && !rec.absent && !rec.annual;
      });
      if (anyWorked) holWorkDays++;
    }

    return { activeCount: activeEmps.length, newCount: newEmps.length,
      leftCount: leftEmps.length, totalPay, totalWorkDays, weekDays, holWorkDays };
  });

  // 합계
  const totals = {
    activeCount: '-',
    newCount:      monthData.reduce((s,d)=>s+d.newCount,0),
    leftCount:     monthData.reduce((s,d)=>s+d.leftCount,0),
    totalPay:      monthData.reduce((s,d)=>s+d.totalPay,0),
    totalWorkDays: monthData.reduce((s,d)=>s+d.totalWorkDays,0),
    weekDays:      monthData.reduce((s,d)=>s+d.weekDays,0),
    holWorkDays:   monthData.reduce((s,d)=>s+d.holWorkDays,0),
  };

  const rows = [
    { label:'재직 직원 수',       key:'activeCount',  fmt:v=>v==='-'?'-':`${v}명`,      cls:'var(--navy)' },
    { label:'입사 직원 수',       key:'newCount',     fmt:v=>v?`+${v}명`:'-',           cls:'var(--teal)' },
    { label:'퇴사 직원 수',       key:'leftCount',    fmt:v=>v?`${v}명`:'-',            cls:'var(--rose)' },
    { label:'급여지급액(세전)',    key:'totalPay',     fmt:v=>v?`${Math.round(v/10000).toLocaleString()}만원`:'-', cls:'var(--purple)' },
    { label:'직원 총 근무일수',   key:'totalWorkDays',fmt:v=>v?`${v}일`:'-',            cls:'var(--ink2)' },
    { label:'평일 영업일수',      key:'weekDays',     fmt:v=>`${v}일`,                  cls:'var(--navy2)',  bg:'#EFF6FF' },
    { label:'휴일 출근일수',      key:'holWorkDays',  fmt:v=>v?`${v}일`:'-',            cls:'var(--amber)', bg:'#FFFBEB' },
  ];

  body.innerHTML = `
  <div style="background:var(--card);border:1px solid var(--bd);border-radius:16px;overflow:hidden;overflow-x:auto;box-shadow:var(--shadow-sm)">
    <table style="width:100%;border-collapse:collapse;min-width:900px">
      <thead>
        <tr style="background:var(--navy)">
          <th style="padding:10px 14px;font-size:11px;font-weight:700;color:rgba(255,255,255,.9);text-align:left;min-width:140px;position:sticky;left:0;z-index:2;background:var(--navy)">구분</th>
          ${months.map(mn=>`<th style="padding:10px 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);text-align:center;min-width:64px">${mn}</th>`).join('')}
          <th style="padding:10px 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);text-align:center;background:#0E4D2E;min-width:68px">합계</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row,ri)=>`
        <tr style="border-bottom:1px solid var(--bd)">
          <td style="padding:10px 14px;font-size:11px;font-weight:700;color:${row.cls};background:${row.bg||'var(--surf)'};position:sticky;left:0;z-index:1;border-right:2px solid var(--bd)">
            ${row.key==='weekDays'?'📅 ':''}${row.key==='holWorkDays'?'🏖️ ':''}${row.label}
            ${row.key==='holWorkDays'?'<div style="font-size:9px;color:var(--ink3);font-weight:400;margin-top:1px">일일근태 입력 기준</div>':''}
            ${row.key==='weekDays'?'<div style="font-size:9px;color:var(--ink3);font-weight:400;margin-top:1px">토/일/공휴일 제외</div>':''}
          </td>
          ${monthData.map(d=>`<td style="padding:8px 6px;font-size:11px;text-align:center;font-weight:600;color:${row.cls};background:${d[row.key]>0&&row.key==='holWorkDays'?'#FFFBEB':''}">${row.fmt(d[row.key])}</td>`).join('')}
          <td style="padding:8px 6px;font-size:11px;text-align:center;font-weight:700;color:${row.cls};background:var(--gbg)">${row.fmt(totals[row.key])}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div style="margin-top:12px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
    <div class="sc ok"><div class="sc-l">연간 총 급여지급액</div><div class="sc-v" style="color:var(--green)">${Math.round(totals.totalPay/10000).toLocaleString()}<span class="sc-u">만원</span></div></div>
    <div class="sc"><div class="sc-l">입사 / 퇴사</div><div class="sc-v">${totals.newCount}<span class="sc-u">명</span> / ${totals.leftCount}<span class="sc-u">명</span></div></div>
    <div class="sc" style="border-color:#BFDBFE;background:var(--teal-dim)"><div class="sc-l">평일 영업일수</div><div class="sc-v" style="color:var(--navy2)">${totals.weekDays}<span class="sc-u">일</span></div></div>
    <div class="sc" style="border-color:#FCD34D;background:var(--abg)"><div class="sc-l">🏖️ 휴일 출근일수</div><div class="sc-v" style="color:var(--amber)">${totals.holWorkDays}<span class="sc-u">일</span></div></div>
  </div>`;
}

// ══════════════════════════════════════
// 💡 툴팁 팝업
// ══════════════════════════════════════
// 상세명세 input 셀 Tab/Enter 네비게이션
// 상세명세 입력 저장: blur 시 즉시 저장 + 디바운스로 테이블 갱신
let _xlRefreshTimer=null;
function _xlDebouncedRefresh(){
  if(_xlRefreshTimer) clearTimeout(_xlRefreshTimer);
  _xlRefreshTimer=setTimeout(()=>renderXlPreview(),800);
}
// 확정된 달에는 xl뷰 쓰기도 차단 (readonly 속성이 없어도 최종 방어선)
function _xlLockedGuard(){
  if(typeof isPayMonthConfirmed==='function' && isPayMonthConfirmed(pY, pM)){
    if(typeof showSyncToast==='function') showSyncToast('⚠️ 확정된 달입니다. "확정 해제" 후 입력하세요','warn',3500);
    return true;
  }
  return false;
}
function xlSaveAllow(inp){
  if(_xlLockedGuard()){ _xlDebouncedRefresh(); return; }
  const eid=+inp.dataset.eid, aid=inp.dataset.aid;
  setMonthAllowance(eid,pY,pM,aid,+String(inp.value).replace(/,/g,'')||0);
  _xlDebouncedRefresh();
}
function xlSaveBonus(inp){
  if(_xlLockedGuard()){ _xlDebouncedRefresh(); return; }
  const eid=+inp.dataset.eid;
  setMonthBonus(eid,pY,pM,+String(inp.value).replace(/,/g,'')||0);
  _xlDebouncedRefresh();
}
function xlSaveTax(inp){
  if(_xlLockedGuard()){ _xlDebouncedRefresh(); return; }
  const eid=+inp.dataset.eid, field=inp.dataset.tax;
  const raw = String(inp.value).replace(/,/g,'');
  setTaxRec(eid,pY,pM,field,raw===''?'':(+raw||0));
  _xlDebouncedRefresh();
}

function xlInputNav(inp, shiftKey){
  // type이 text로 변경되어 data-xl-inp 속성 기반으로 네비게이션
  const allInputs = Array.from(document.querySelectorAll('#xl-table input[data-xl-inp]'));
  const idx = allInputs.indexOf(inp);
  if(idx < 0) return;
  const next = allInputs[shiftKey ? idx-1 : idx+1];
  if(next){ next.focus(); next.select(); }
}

function showBonusTip(){
  var msg = '【통상임금제 가산수당 계산 방식】\n\n기본급(시급×209h)에는 평일 8h가 이미 포함되어 있어\n추가 근무에 대해서만 아래 컬럼별로 가산됩니다.\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📌 컬럼 1 — 소정근로외 실근무 (×1.0)\n   · 소정근로시간(하루 8h) 밖의 실제 근무시간\n   · 평일: 8h 초과분\n   · 휴일(공휴일·주말): 근무 전체시간\n   → 시급 전액(×1.0) 추가 지급\n\n📌 컬럼 2 — 고정야간시간 (×0.5)\n   · 22:00~06:00 구간의 실근무시간 전체\n   · 기본 1.0은 기본급에 포함 → 0.5만 추가\n   → ON/OFF 설정 가능 (급여설정 → 야간 가산)\n\n📌 컬럼 3 — 초과연장시간 (×0.5)\n   · 8h 초과분 중 야간(22~06시) 구간이 겹치는 시간\n   · 연장(+0.5) + 야간(+0.5) 중 야간연장에 해당\n   → ON/OFF 설정 가능 (급여설정 → 연장 가산)\n\n📌 컬럼 4 — 초과휴일시간 (×0.5)\n   · 휴일 전체 근무시간에 휴일가산 0.5 추가\n   → ON/OFF 설정 가능 (급여설정 → 휴일 가산)\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【케이스별 예시 (시급 11,750원 기준)】\n\n▶ 평일 09:00~18:00 (휴게1h → 실8h)\n   소정근로외:   0h × 1.0 =       0원\n   고정야간:     0h × 0.5 =       0원\n   총 가산수당:              0원\n   총급여: 2,455,750원\n\n▶ 평일 09:00~20:00 (휴게1h → 실10h, 연장2h)\n   소정근로외:   2h × 1.0 =  23,500원\n   고정야간:     0h × 0.5 =       0원\n   초과연장:     0h × 0.5 =       0원\n   총 가산수당:         23,500원 → 주간연장가산 11,750원 별도\n   총급여: 2,491,000원\n\n▶ 평일 14:00~24:00 (휴게없음 → 실10h, 야간2h, 연장2h)\n   소정근로외:   2h × 1.0 =  23,500원\n   고정야간:     2h × 0.5 =  11,750원\n   초과연장:     2h × 0.5 =  11,750원\n   총 가산수당:         47,000원\n   총급여: 2,502,750원\n\n▶ 평일 21:00~06:00 (휴게없음 → 실9h, 야간8h, 연장1h)\n   소정근로외:   1h × 1.0 =  11,750원\n   고정야간:     8h × 0.5 =  47,000원\n   초과연장:     1h × 0.5 =   5,875원\n   총 가산수당:         64,625원\n   총급여: 2,520,375원\n\n▶ 공휴일 21:00~06:00 (휴게없음 → 실9h)\n   소정근로외:   9h × 1.0 = 105,750원 (휴일=전체)\n   고정야간:     8h × 0.5 =  47,000원\n   초과연장:     1h × 0.5 =   5,875원\n   초과휴일:     9h × 0.5 =  52,875원\n   총 가산수당:        211,500원\n   총급여: 2,667,250원';
  showTip('💡 가산수당 계산 로직', msg);
}


function showTip(title, msg) {
  const existing = document.getElementById('tip-popup-layer');
  if (existing) existing.remove();
  const bg = document.createElement('div');
  bg.id = 'tip-popup-layer';
  bg.className = 'tip-popup-bg';
  bg.innerHTML = `<div class="tip-popup">
    <button class="tip-popup-close" onclick="document.getElementById('tip-popup-layer').remove()">×</button>
    <div style="font-size:15px;font-weight:700;color:#1C2B3A;margin-bottom:10px;padding-right:24px">💡 ${title}</div>
    <div style="font-size:13px;line-height:1.8;color:#4A5568;white-space:pre-line">${msg}</div>
  </div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
}

// ══════════════════════════════════════
// 초기화
// ══════════════════════════════════════
function init(){
  // DOM 요소 존재 확인 후 안전하게 세팅
  const safe = (id, fn) => { const el=document.getElementById(id); if(el) fn(el); };
  safe('tog-ext',  el=>el.checked=POL.extFixed??true);
  safe('tog-nt',   el=>el.checked=POL.ntFixed??POL.nt??true);
  safe('tog-ot',   el=>el.checked=POL.otFixed??POL.ot??true);
  safe('tog-hol',  el=>el.checked=POL.holFixed??POL.hol??true);
  safe('tog-nt-hourly',  el=>el.checked=POL.ntHourly??true);
  safe('tog-ot-hourly',  el=>el.checked=POL.otHourly??true);
  safe('tog-hol-hourly', el=>el.checked=POL.holHourly??true);
  safe('tog-hol-monthly',     el=>el.checked=POL.holMonthly??true);
  safe('tog-hol-monthly-std', el=>el.checked=POL.holMonthlyStd??true);
  safe('tog-hol-monthly-ot',  el=>el.checked=POL.holMonthlyOt??true);
  safe('tog-ded-monthly',     el=>el.checked=POL.dedMonthly??true);
  setPremTab('fixed');
  safe('tog-juhyu',el=>el.checked=POL.juhyu);
  safe('inp-sot',       el=>el.value=POL.sot);
  safe('inp-base-rate', el=>el.value=POL.baseRate);
  safe('inp-site-code', el=>el.value=POL.siteCode||'');
  initEmpNoSetting();
  safe('sel-ns',        el=>el.value=POL.nightStart);
  setSize(POL.size||'u5');
  setDupMode(POL.dupMode||'single');
  setDedMode(POL.dedMode||'hour');
  setBasePay(POL.basePayMode||'fixed');
  const initMonthlyRow=document.getElementById('sr-base-monthly');
  if(initMonthlyRow&&POL.basePayMode!=='monthly')initMonthlyRow.style.display='none';
  const initMonthlyInp=document.getElementById('inp-base-monthly');
  if(initMonthlyInp)initMonthlyInp.value=POL.baseMonthly||2455750;
  initWeekendChecks();
  sortEMPS(); // 시작 시 주간→야간 정렬
  renderSb();updDbar();renderBks();renderTable();updNotes();
  updDailyMode();
  refreshAllAges();
  leaveYear = new Date().getFullYear();
  companyYear = new Date().getFullYear();
}
init();

// ── 세션 회사명 표시 ──
(function(){
  try{
    const sess = JSON.parse(localStorage.getItem('nopro_session')||'{}');
    const urlParams = new URLSearchParams(window.location.search);
    const company = urlParams.get('company') || sess.company || '';
    if(company){
      const badge = document.getElementById('company-name-badge');
      if(badge){ badge.textContent = company; badge.style.display='inline'; }
    }
  }catch(e){}
})();

// ══════════════════════════════════════
// 🔐 인증 시스템 (서버사이드)
// ══════════════════════════════════════

function getNoproUsers(){ return JSON.parse(localStorage.getItem('nopro_users')||'[]'); }
function saveNoproUsers(u){ localStorage.setItem('nopro_users', JSON.stringify(u)); }
function getNoproSession(){ return JSON.parse(localStorage.getItem('nopro_session')||'null'); }
function setNoproSession(s){ localStorage.setItem('nopro_session', JSON.stringify(s)); }

function authTab(tab){
  const isLogin = tab==='login';
  document.getElementById('auth-login-form').style.display = isLogin?'block':'none';
  document.getElementById('auth-signup-form').style.display = isLogin?'none':'block';
  // 탭 버튼 스타일
  const tl=document.getElementById('auth-tab-login');
  const ts=document.getElementById('auth-tab-signup');
  if(tl){
    tl.style.background=isLogin?'linear-gradient(135deg,#5B5EFF,#7B3AED)':'transparent';
    tl.style.color=isLogin?'#fff':'rgba(240,244,255,.45)';
    tl.style.boxShadow=isLogin?'0 2px 0 rgba(255,255,255,.15) inset,0 2px 8px rgba(91,94,255,.3)':'none';
    tl.style.fontWeight=isLogin?'700':'600';
  }
  if(ts){
    ts.style.background=isLogin?'transparent':'linear-gradient(135deg,#5B5EFF,#7B3AED)';
    ts.style.color=isLogin?'rgba(240,244,255,.45)':'#fff';
    ts.style.boxShadow=isLogin?'none':'0 2px 0 rgba(255,255,255,.15) inset,0 2px 8px rgba(91,94,255,.3)';
    ts.style.fontWeight=isLogin?'600':'700';
  }
  // 하단 전환 텍스트
  const sw1=document.getElementById('auth-switch-to-signup');
  const sw2=document.getElementById('auth-switch-to-login');
  if(sw1) sw1.style.display=isLogin?'block':'none';
  if(sw2) sw2.style.display=isLogin?'none':'block';
}

async function doAuthLogin(){
  const email=document.getElementById('al-email').value.trim();
  const pw=document.getElementById('al-pw').value;
  const errEl=document.getElementById('al-error');
  const btn=document.querySelector('#auth-login-form button.form-submit, #auth-login-form button[onclick*="doAuthLogin"]');
  errEl.style.display='none';

  if(btn){ btn.textContent='로그인 중...'; btn.disabled=true; }

  try{
    const res=await apiFetch('/auth-login','POST',{email,password:pw});
    setNoproSession(res.session);
    if(res.session.role==='admin'){
      enterAdmin();
    } else {
      await sbLoadAll(res.session.companyId);
      enterApp(res.session.company);
      if(typeof startAutoPoll === 'function') startAutoPoll();
    }
    startAuthRefreshTimer();
  } catch(e){
    errEl.textContent=e.message||'로그인 실패';
    errEl.style.display='block';
  } finally {
    if(btn){ btn.textContent='로그인'; btn.disabled=false; }
  }
}

async function doAdminAuthLogin(){
  return doAuthLogin();
}

async function doAuthSignup(){
  const company=document.getElementById('as-company').value.trim();
  const name=document.getElementById('as-name').value.trim();
  const phone=document.getElementById('as-phone').value.trim();
  const email=document.getElementById('as-email').value.trim();
  const pw=document.getElementById('as-pw').value;
  const size=document.getElementById('as-size').value;
  const errEl=document.getElementById('as-error');
  errEl.style.display='none';
  if(!company||!name||!phone||!email||!pw){ errEl.textContent='필수 항목을 모두 입력해주세요'; errEl.style.display='block'; return; }

  const btns=document.querySelectorAll('#auth-signup-form button[onclick*="doAuthSignup"]');
  btns.forEach(b=>{b.textContent='가입 중...';b.disabled=true;});

  try{
    const res=await apiFetch('/auth-signup','POST',{company,name,phone,email,password:pw,size});
    setNoproSession(res.session);
    // 새 회사 기본 데이터 저장
    await sbSaveAll(res.session.companyId);
    admSendNotify('signup', {company, name, email, phone, size});
    enterApp(company);
    if(typeof startAutoPoll === 'function') startAutoPoll();
    startAuthRefreshTimer();
  } catch(e){
    errEl.textContent=e.message||'회원가입 실패';
    errEl.style.display='block';
  } finally {
    btns.forEach(b=>{b.textContent='회원가입 완료';b.disabled=false;});
  }
}

function enterApp(company){
  document.getElementById('landing-overlay').style.display='none';
  document.getElementById('auth-overlay').style.display='none';
  document.getElementById('admin-overlay').style.display='none';
  const badge=document.getElementById('company-name-badge');
  if(badge&&company){badge.textContent=company;badge.style.display='inline';}
  document.querySelector('.app').style.display='flex';
  initSbCollapsed(); // 사이드바 접힘 상태 복원
  loadHolidaysAround(new Date().getFullYear()); // 공휴일 최신화 (작년·올해·내년)
  // 데이터 로드 후 전체 화면 갱신
  setTimeout(()=>{
    try{ sortEMPS(); }catch(e){} // 앱 진입 시 정렬
    try{ renderSb(); }catch(e){}
    try{ renderTable(); }catch(e){}
    try{ updateSyncBadge(); updateSyncInfo(); }catch(e){}
    try{ initWeekendChecks(); }catch(e){}
    try{ setDupMode(POL.dupMode||'single'); setDedMode(POL.dedMode||'hour'); }catch(e){}
  }, 300);
}

function enterAdmin(){
  document.getElementById('landing-overlay').style.display='none';
  document.getElementById('auth-overlay').style.display='none';
  document.getElementById('admin-overlay').style.display='block';
  document.querySelector('.app').style.display='none';
  admPage('dashboard');
  setTimeout(admUpdateAlertBadge, 300);
}

function admLogout(){
  apiFetch('/auth-logout','POST').catch(()=>{});
  localStorage.removeItem('nopro_session');
  document.getElementById('admin-overlay').style.display='none';
  document.getElementById('auth-overlay').style.display='flex';
  document.querySelector('.app').style.display='none';
}

function authLogout(){
  stopAuthRefreshTimer();
  if(typeof stopAutoPoll === 'function') stopAutoPoll();
  apiFetch('/auth-logout','POST').catch(()=>{});
  localStorage.removeItem('nopro_session');
  localStorage.removeItem('nopro_jwt'); // 레거시 토큰 정리
  clearLocalData(); // 로그아웃 시 데이터 초기화
  document.querySelector('.app').style.display='none';
  const badge=document.getElementById('company-name-badge');
  if(badge){badge.textContent='';badge.style.display='none';}
  showLanding();
}

function admPage(page){
  document.querySelectorAll('.adm-sb-item,.adm-menu').forEach(m=>{
    m.classList.remove('on');
  });
  const active=document.getElementById('adm-m-'+page);
  if(active) active.classList.add('on');
  let users=getNoproUsers(); // 로컬 캐시 먼저
  apiFetch('/admin-companies','GET').then(rows=>{
    if(rows&&rows.length){
      saveNoproUsers(rows);
      if(page==='companies') admRenderCompanies(rows, document.getElementById('adm-search')?.value||'');
    }
  }).catch(e=>console.warn('관리자 데이터 로드 오류:',e));
  const cont=document.getElementById('adm-content');
  const planLabel={'10이하':'5만원/월','50이하':'15만원/월','100이하':'20만원/월','100초과':'25만원/월'};
  const planRevenue={'10이하':5,'50이하':15,'100이하':20,'100초과':25};

  if(page==='dashboard'){
    const revenue=users.reduce((s,u)=>s+(planRevenue[u.size]||0),0);
    const recent=[...users].sort((a,b)=>(b.joinDate||'').localeCompare(a.joinDate||'')).slice(0,10);
    cont.innerHTML=`
      <div style="font-size:24px;font-weight:800;color:#fff;margin-bottom:4px;letter-spacing:-.5px">대시보드</div>
      <div style="font-size:13px;color:rgba(240,244,255,.35);margin-bottom:28px;font-weight:500">노프로 서비스 전체 현황</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px">
        ${[
          ['🏢 총 가입 회사',users.length,'#60A5FA'],
          ['✅ 활성 회사',users.filter(u=>u.status==='active').length,'#6EE7B7'],
          ['💰 월 매출(만원)',revenue,'#FCD34D'],
          ['👥 총 직원(추정)',users.reduce((s,u)=>s+({'10이하':8,'50이하':30,'100이하':70,'100초과':120}[u.size]||0),0),'#F9A8D4'],
        ].map(([l,v,c])=>`
          <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:22px;transition:all .2s" onmouseover="this.style.background='rgba(255,255,255,.07)'" onmouseout="this.style.background='rgba(255,255,255,.04)'">
            <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:12px;font-weight:600;letter-spacing:.3px">${l}</div>
            <div style="font-size:32px;font-weight:900;color:${c};letter-spacing:-1px">${v}</div>
          </div>`).join('')}
      </div>
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden">
        <div style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px;font-weight:700;color:#fff">최근 가입 회사</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:rgba(255,255,255,.03)">
            ${['회사명','담당자','연락처','가입일','요금제','상태'].map(h=>`<th style="padding:10px 16px;font-size:10px;font-weight:700;color:#64748B;text-align:left;letter-spacing:.3px;border-bottom:1px solid rgba(255,255,255,.04)">${h}</th>`).join('')}
          </tr></thead>
          <tbody>${recent.length?recent.map(u=>`<tr style="border-bottom:1px solid rgba(255,255,255,.04)">
            <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#fff">${esc(u.company)}</td>
            <td style="padding:12px 16px;font-size:12px;color:#94A3B8">${esc(u.name)}</td>
            <td style="padding:12px 16px;font-size:12px;color:#94A3B8">${esc(u.phone)}</td>
            <td style="padding:12px 16px;font-size:11px;color:#64748B">${esc(u.joinDate||'-')}</td>
            <td style="padding:12px 16px"><span style="padding:3px 10px;border-radius:999px;background:rgba(245,158,11,.15);color:#FCD34D;font-size:10px;font-weight:700">${planLabel[u.size]||u.size}</span></td>
            <td style="padding:12px 16px"><span style="padding:3px 10px;border-radius:999px;background:rgba(16,185,129,.15);color:#6EE7B7;font-size:10px;font-weight:700">● 활성</span></td>
          </tr>`).join(''):'<tr><td colspan="6" style="padding:40px;text-align:center;color:#64748B">가입 회사가 없습니다</td></tr>'}</tbody>
        </table>
      </div>`;
  }
  else if(page==='companies'){
    cont.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
        <div>
          <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px">🏢 가입 회사</div>
          <div style="font-size:12px;color:#94A3B8">전체 ${users.length}개 회사</div>
        </div>
        <input id="adm-search" placeholder="🔍 회사명·담당자·이메일 검색..." oninput="admFilter(this.value)"
          style="padding:9px 16px;border-radius:10px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:12px;outline:none;width:260px;font-family:inherit">
      </div>
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:rgba(255,255,255,.04)">
            ${['#','회사명','담당자','연락처','이메일','비밀번호','직원수','요금제','상태','삭제'].map(h=>`
              <th style="padding:11px 14px;font-size:10px;font-weight:700;color:#64748B;text-align:left;letter-spacing:.3px;border-bottom:1px solid rgba(255,255,255,.06);white-space:nowrap">${h}</th>
            `).join('')}
          </tr></thead>
          <tbody id="adm-companies-tbody"></tbody>
        </table>
      </div>`;
    admRenderCompanies(users);
  }
  else if(page==='alerts'){
    const alerts = JSON.parse(localStorage.getItem('nopro_admin_alerts')||'[]').reverse();
    cont.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
        <div>
          <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px;">🔔 알림</div>
          <div style="font-size:13px;color:rgba(240,244,255,.35);">회원가입 및 정보 변경 알림</div>
        </div>
        <button onclick="admClearAlerts()"
          style="padding:7px 14px;border-radius:8px;border:1px solid rgba(239,68,68,.3);
                 background:rgba(239,68,68,.1);color:#FCA5A5;font-size:11px;font-weight:600;cursor:pointer;">
          전체 삭제
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${alerts.length ? alerts.map(a=>`
          <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,${a.type==='signup'?'.12':'.07'});
                      border-radius:14px;padding:16px 20px;display:flex;gap:14px;align-items:flex-start;">
            <div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;
                        font-size:16px;flex-shrink:0;background:${a.type==='signup'?'rgba(16,185,129,.15)':'rgba(245,158,11,.15)'};">
              ${a.type==='signup'?'🏢':'✏️'}
            </div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:4px;">${a.title}</div>
              <div style="font-size:12px;color:#94A3B8;line-height:1.6;">${a.body}</div>
              <div style="font-size:10px;color:#64748B;margin-top:6px;">${a.time}</div>
            </div>
            <span style="padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;
                         background:${a.type==='signup'?'rgba(16,185,129,.15)':'rgba(245,158,11,.15)'};
                         color:${a.type==='signup'?'#6EE7B7':'#FCD34D'};">
              ${a.type==='signup'?'신규 가입':'정보 변경'}
            </span>
          </div>`).join('')
        : '<div style="text-align:center;padding:60px;color:#64748B;font-size:14px;">알림이 없습니다</div>'}
      </div>`;
    localStorage.setItem('nopro_admin_alert_unread','0');
    admUpdateAlertBadge();
  }
  else if(page==='users'){
    cont.innerHTML=`
      <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px">👤 회원 관리</div>
      <div style="font-size:12px;color:#94A3B8;margin-bottom:24px">전체 ${users.length}명</div>
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:rgba(255,255,255,.04)">
            ${['이름','이메일','회사','연락처','직원규모','가입일','상태'].map(h=>`<th style="padding:10px 14px;font-size:10px;font-weight:700;color:#64748B;text-align:left;letter-spacing:.3px;border-bottom:1px solid rgba(255,255,255,.06)">${h}</th>`).join('')}
          </tr></thead>
          <tbody>${users.length?users.map(u=>`<tr style="border-bottom:1px solid rgba(255,255,255,.04)">
            <td style="padding:11px 14px;font-size:13px;font-weight:700;color:#fff">${esc(u.name)}</td>
            <td style="padding:11px 14px;font-size:11px;color:#64748B">${esc(u.email)}</td>
            <td style="padding:11px 14px;font-size:12px;color:#94A3B8">${esc(u.company)}</td>
            <td style="padding:11px 14px;font-size:12px;color:#94A3B8">${esc(u.phone)}</td>
            <td style="padding:11px 14px;font-size:11px;color:#94A3B8">${u.size}</td>
            <td style="padding:11px 14px;font-size:11px;color:#64748B">${u.joinDate||'-'}</td>
            <td style="padding:11px 14px"><span style="padding:2px 8px;border-radius:999px;background:rgba(16,185,129,.15);color:#6EE7B7;font-size:10px;font-weight:700">활성</span></td>
          </tr>`).join(''):'<tr><td colspan="7" style="padding:40px;text-align:center;color:#64748B">회원이 없습니다</td></tr>'}</tbody>
        </table>
      </div>`;
  }
}

function admRenderCompanies(users, filter=''){
  const tbody=document.getElementById('adm-companies-tbody');
  if(!tbody) return;
  const filtered=filter?users.filter(u=>
    (u.company||'').includes(filter)||
    (u.name||'').includes(filter)||
    (u.email||'').includes(filter)
  ):users;
  const planLabel={'10이하':'5만원','50이하':'15만원','100이하':'20만원','100초과':'25만원'};

  tbody.innerHTML=filtered.length?filtered.map((u,i)=>{
    // 직원 수: Supabase company_data에서 가져온 emps 개수
    const empCount = u.empCount !== undefined ? u.empCount : '-';
    return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);transition:background .1s" onmouseover="this.style.background='rgba(255,255,255,.03)'" onmouseout="this.style.background=''">
      <td style="padding:10px 14px;font-size:11px;color:#64748B">${i+1}</td>
      <td style="padding:10px 14px">
        <div style="font-size:13px;font-weight:700;color:#fff">${esc(u.company||u.company_name||'-')}</div>
        <div style="font-size:10px;color:#64748B;margin-top:2px">${esc(u.joinDate||u.join_date||'-')} 가입</div>
      </td>
      <td style="padding:10px 14px;font-size:12px;color:#94A3B8">${esc(u.name||u.manager_name||'-')}</td>
      <td style="padding:10px 14px;font-size:12px;color:#94A3B8">${esc(u.phone||'-')}</td>
      <td style="padding:10px 14px">
        <div style="font-size:11px;color:#94A3B8">${esc(u.email||'-')}</div>
      </td>
      <td style="padding:10px 14px">
        <div style="display:flex;align-items:center;gap:6px;">
          <span id="pw-${u.id}" style="font-size:11px;color:#94A3B8;font-family:monospace;">••••••••</span>
          <button onclick="admTogglePw('${u.id}','${esc(u.password||u.pw||'-')}')"
            style="padding:2px 7px;border-radius:5px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#94A3B8;font-size:10px;cursor:pointer;">보기</button>
        </div>
      </td>
      <td style="padding:10px 14px;text-align:center">
        <span style="font-size:14px;font-weight:900;color:#6EE7B7">${empCount}</span>
        <span style="font-size:10px;color:#64748B">명</span>
      </td>
      <td style="padding:10px 14px">
        <span style="padding:3px 9px;border-radius:999px;background:rgba(245,158,11,.15);color:#FCD34D;font-size:10px;font-weight:700">${planLabel[u.size||'50이하']||u.size}</span>
      </td>
      <td style="padding:10px 14px">
        <span style="padding:3px 9px;border-radius:999px;background:rgba(16,185,129,.12);color:#6EE7B7;font-size:10px;font-weight:700">● 활성</span>
      </td>
      <td style="padding:10px 14px">
        <button onclick="admDeleteUser(${u.id})"
          style="padding:5px 12px;border-radius:7px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.1);color:#FCA5A5;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s"
          onmouseover="this.style.background='rgba(239,68,68,.25)'" onmouseout="this.style.background='rgba(239,68,68,.1)'">
          🗑 삭제
        </button>
      </td>
    </tr>`;
  }).join(''):`<tr><td colspan="10" style="padding:50px;text-align:center;color:#64748B;font-size:13px">
    ${filter?'검색 결과가 없습니다':'가입 회사가 없습니다'}
  </td></tr>`;
}

function admFilter(val){
  admRenderCompanies(getNoproUsers(), val);
}

function admTogglePw(id, pw){
  const el = document.getElementById('pw-'+id);
  if(!el) return;
  if(el.textContent.trim() === '••••••••'){
    el.textContent = pw;
    el.style.color = '#FCD34D';
  } else {
    el.textContent = '••••••••';
    el.style.color = '#94A3B8';
  }
}

async function admDeleteUser(id){
  const users = getNoproUsers();
  const target = users.find(u=>u.id===id);
  if(!target) return;
  
  // 확인 모달
  const confirmed = confirm(`⚠️ "${target.company}" 계정을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.\n- 회사 계정 삭제\n- 모든 직원/근태/급여 데이터 삭제\n- 해당 이메일로 로그인 불가`);
  if(!confirmed) return;

  try {
    const numId = Number(id);
    await apiFetch('/admin-delete','DELETE',{companyId:numId});
    
    // 3. 로컬 캐시 업데이트
    saveNoproUsers(users.filter(u=>Number(u.id)!==numId));
    
    // 4. 성공 토스트
    const t=document.createElement('div');
    t.style.cssText='position:fixed;bottom:24px;right:24px;background:#059669;color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:700;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,.3)';
    t.textContent=`✅ "${target.company}" 삭제 완료`;
    document.body.appendChild(t);
    setTimeout(()=>t.remove(),3000);
    admPage('companies');
  } catch(e) {
    console.error('삭제 오류 상세:', e);
    alert('삭제 실패: '+e.message);
  }
}

// ── 앱 초기 로드 시 세션 체크 (httpOnly 쿠키 기반) ──
(async function initAuth(){
  document.querySelector('.app').style.display='none';
  const sess=getNoproSession();
  if(!sess){ showLanding(); return; }
  document.getElementById('landing-overlay').style.display='none';
  try{
    // httpOnly 쿠키 기반 세션 검증
    const res=await fetch('/api/auth-verify',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include'
    });
    if(!res.ok){
      if(res.status>=500){
        // 서버 오류면 로컬 세션으로 진입 (로그아웃 안 함)
        if(sess.role==='admin'){ enterAdmin(); }
        else { enterApp(sess.company||''); }
        return;
      }
      throw new Error('verify-failed');
    }
    const data=await res.json();
    if(!data.valid) throw new Error('invalid');
    setNoproSession(data.session);
    if(data.session.role==='admin'){
      enterAdmin();
    } else {
      await sbLoadAll(data.session.companyId);
      enterApp(data.session.company||'');
      if(typeof startAutoPoll === 'function') startAutoPoll();
    }
    startAuthRefreshTimer();
  } catch(e){
    console.warn('initAuth 실패:', e.message);
    localStorage.removeItem('nopro_session');
    localStorage.removeItem('nopro_jwt'); // 레거시 토큰 정리
    showLanding();
  }
})();

// ── 주기적 토큰 갱신 (쿠키 수명 2h, 30분 전부터 서버가 Set-Cookie로 갱신) ──
let _authRefreshTimer = null;
function startAuthRefreshTimer(){
  if(_authRefreshTimer) clearInterval(_authRefreshTimer);
  _authRefreshTimer = setInterval(async ()=>{
    try{
      const res = await fetch('/api/auth-verify',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'include'
      });
      if(!res.ok && res.status===401){
        // 쿠키 만료 — 타이머 정지 후 로그아웃. 사용자에게 알림 후 시간 두고 로그아웃.
        stopAuthRefreshTimer();
        if(typeof showSyncToast==='function'){
          showSyncToast('⚠️ 세션이 만료되어 로그아웃됩니다.\n입력 중인 값이 있으면 잠시 기다린 뒤 복사해두세요.','error',5000);
        }
        setTimeout(()=>authLogout(), 4000);
      }
    }catch(e){ /* 네트워크 일시 장애는 무시 */ }
  }, AUTH_REFRESH_INTERVAL_MS);
}
function stopAuthRefreshTimer(){
  if(_authRefreshTimer){ clearInterval(_authRefreshTimer); _authRefreshTimer=null; }
}

function showLanding(){
  document.getElementById('landing-overlay').style.display='block';
  document.getElementById('auth-overlay').style.display='none';
  document.getElementById('admin-overlay').style.display='none';
  document.querySelector('.app').style.display='none';
  setTimeout(initLandingEffects, 100);
}

function showAuthModal(tab){
  document.getElementById('landing-overlay').style.display='none';
  document.getElementById('auth-overlay').style.display='flex';
  if(tab) authTab(tab);
}


// ══════════════════════════════════════════════════════
// 🗄️ 서버 API 연동 (Supabase는 서버에서만 접근)
// ══════════════════════════════════════════════════════

// ── 로컬 데이터 완전 초기화 (계정 전환 시) ──
function clearLocalData(){
  const keys = [
    'npm5_emps','npm5_rec','npm5_pol','npm5_bk','npm5_tbk',
    'npm5_bonus','npm5_allow','npm5_tax','npm5_leave_settings',
    'npm5_leave_overrides','npm5_folders','npm5_safety',
    'npm5_pol_snapshots','npm5_pay_snapshots','npm5_bk_snapshots'
  ];
  keys.forEach(k => localStorage.removeItem(k));
  EMPS = [];
  POL  = {...DEF_POL};
  DEF_BK = [{id:1,start:'12:00',end:'13:00'},{id:2,start:'18:00',end:'18:30'}];
  TBK  = {};
  REC  = {};
  BONUS_REC = {};
  ALLOWANCE_REC = {};
  SAFETY_REC = {};
  if(typeof TAX_REC !== 'undefined') TAX_REC = {};
  if(typeof POL_SNAPSHOTS !== 'undefined') POL_SNAPSHOTS = {};
  if(typeof PAY_SNAPSHOTS !== 'undefined') PAY_SNAPSHOTS = {};
  if(typeof BK_SNAPSHOTS !== 'undefined') BK_SNAPSHOTS = {};
  // 🛡️ 스냅샷도 초기화 — 재로그인 직후 가드가 "이전에 데이터 있었다"로 오판 방지
  if(typeof _syncedSnapshot !== 'undefined') _syncedSnapshot = null;
  // 🛡️ 대기 중인 saveLS 타이머도 취소 — logout race로 빈값 저장되는 경로 차단
  if(typeof saveLS !== 'undefined' && saveLS._timer){ clearTimeout(saveLS._timer); saveLS._timer = null; }
}

// ── 전체 저장 (서버 프록시) ──
async function sbSaveAll(companyId) {
  // 소형 키: 한 번에 저장
  const smallItems = [
    {key:'emps', value:EMPS},
    {key:'pol', value:POL},
    {key:'bk', value:DEF_BK},
    {key:'bonus', value:BONUS_REC},
    {key:'allow', value:ALLOWANCE_REC},
    {key:'tax', value:JSON.parse(localStorage.getItem('npm5_tax')||'{}')},
    {key:'leave_settings', value:JSON.parse(localStorage.getItem('npm5_leave_settings')||'{}')},
    {key:'leave_overrides', value:JSON.parse(localStorage.getItem('npm5_leave_overrides')||'{}')},
    {key:'pol_snapshots', value:POL_SNAPSHOTS||{}},
    {key:'pay_snapshots', value:PAY_SNAPSHOTS||{}},
    {key:'bk_snapshots', value:BK_SNAPSHOTS||{}},
  ];
  // 대형 키: 각각 별도 저장 (타임아웃 방지 + old_value 감사로그 저장)
  const largeItems = [
    {key:'rec', value:REC},
    {key:'tbk', value:TBK},
    {key:'folders', value:FOLDERS.map(f=>({...f,files:(f.files||[]).map(({dataUrl,...r})=>r)}))},
    {key:'safety', value:(()=>{const s={};Object.entries(SAFETY_REC).forEach(([k,v])=>{s[k]=Array.isArray(v)?v.map(({data,...r})=>r):v;});return s;})()},
  ];

  // 🛡️ 빈 데이터 덮어쓰기 방어: 어떤 경로로도 빈값으로 보호 키를 덮어쓰지 못함.
  // 우회 경로 없음. 스냅샷이 없는 초기 로드 구간도 동일하게 차단.
  const snap = (typeof _syncedSnapshot!=='undefined' && _syncedSnapshot) || null;
  const _isEmpty = v => v==null || (Array.isArray(v)?v.length===0:(typeof v==='object' && Object.keys(v).length===0));
  const _snapHasData = (snapVal) => {
    if(snapVal==null) return false;
    try {
      const p = typeof snapVal === 'string' ? JSON.parse(snapVal) : snapVal;
      if(Array.isArray(p)) return p.length > 0;
      if(typeof p === 'object') return Object.keys(p).length > 0;
      return false;
    } catch(e){ return false; }
  };
  const _guardKeys = new Set(['emps','rec','bonus','allow','tax','tbk','safety','bk']);
  const _blockedOverwrite = [];  // 실제 덮어쓰기 시도 (사용자 토스트)
  const _filter = (items) => items.filter(it => {
    if(!_guardKeys.has(it.key)) return true;
    if(_isEmpty(it.value)){
      // 🛡️ 스냅샷이 아직 없으면(sbLoadAll 미완): 빈값 저장 절대 금지. 콘솔만 로그.
      if(snap === null){
        console.warn('🛡️ 초기 로드 전 빈값 저장 차단:', it.key, '(스냅샷 없음 → 데이터 안전 우선)');
        return false;
      }
      // 스냅샷에 데이터가 있었는데 지금 비어있으면 차단. 사용자에게도 알림.
      if(_snapHasData(snap[it.key])){
        _blockedOverwrite.push(it.key);
        console.warn('🛡️ 빈 값 덮어쓰기 차단:', it.key, '(이전 스냅샷에 데이터 있음)');
        return false;
      }
    }
    return true;
  });
  const safeSmall = _filter(smallItems);
  const safeLarge = _filter(largeItems);
  if(_blockedOverwrite.length && typeof showSyncToast==='function'){
    showSyncToast('⚠️ 빈 값 덮어쓰기 차단: '+_blockedOverwrite.join(', ')+'\n서버 데이터 보호 (새로고침으로 재로드 권장)','warn',6000);
  }

  // 소형 키 먼저 저장, 대형 키는 병렬로 개별 저장
  if(safeSmall.length) await apiFetch('/data-save','POST',{items:safeSmall});
  if(safeLarge.length) await Promise.all(safeLarge.map(item=>
    apiFetch('/data-save','POST',{items:[item]}).catch(e=>console.warn('대형 키 저장 오류('+item.key+'):',e))
  ));
  // 서버 동기화 완료 시점 스냅샷 (폴링 머지 기준값)
  if(typeof _takeSyncedSnapshot === 'function') _takeSyncedSnapshot();
}

// ══════════════════════════════════════════════════════
// 📡 자동 동기화 폴링 (방법 2: 30초마다 필드 단위 머지)
// 목적: 동시 접속 시 서로 다른 필드 편집이 덮어써지지 않도록 함
// ══════════════════════════════════════════════════════
let _syncedSnapshot = null;
let _pollTimerId = null;
// 폴링 간격: 데이터가 커질수록 /data-load 응답 시간이 길어져 504 빈도 증가.
// 2분 기본, 504 발생 시 지수 백오프로 최대 10분까지 늘림 (_pollBackoffMs).
const POLL_INTERVAL_MS = 120000;
const POLL_BACKOFF_MAX = 600000;
let _pollBackoffMs = 0;

function _deepCopy(x){ try { return JSON.parse(JSON.stringify(x||{})); } catch(e){ return {}; } }

function _takeSyncedSnapshot(){
  try {
    _syncedSnapshot = {
      emps: JSON.stringify(EMPS),
      pol:  JSON.stringify(POL),
      bk:   JSON.stringify(DEF_BK),
      tbk:  _deepCopy(TBK),
      rec:  _deepCopy(REC),
      bonus: _deepCopy(BONUS_REC),
      allow: _deepCopy(ALLOWANCE_REC),
      leave_overrides: _deepCopy(typeof leaveOverrides!=='undefined'?leaveOverrides:{}),
      safety: _deepCopy(typeof SAFETY_REC!=='undefined'?SAFETY_REC:{}),
    };
  } catch(e){ console.warn('스냅샷 실패:', e); }
}

// 서버 블롭과 로컬 블롭을 필드 단위로 머지.
// 규칙: 서버값 우선 → 내가 편집 중인 필드(스냅샷과 다름)는 로컬 유지 →
//       로컬에서 지운 필드는 서버값 무시.
function _mergeByField(local, server, snapshot){
  const L = local || {}; const S = server || {}; const snap = snapshot || {};
  const merged = {};
  Object.keys(S).forEach(k => {
    // 로컬에서 삭제된 필드는 서버에서 부활시키지 않음
    if((k in snap) && !(k in L)) return;
    merged[k] = S[k];
  });
  Object.keys(L).forEach(k => {
    const dirty = JSON.stringify(L[k]) !== JSON.stringify(snap[k]);
    if(dirty || !(k in S)) merged[k] = L[k];
  });
  return merged;
}

async function pollForUpdates(){
  if(document.hidden) return;
  const _sess = (()=>{ try { return JSON.parse(localStorage.getItem('nopro_session')||'null'); } catch(e){ return null; }})();
  if(!_sess || !_sess.companyId) return;
  try {
    const server = await apiFetch('/data-load','POST',{});
    if(!server) return;
    let changed = false;
    const snap = _syncedSnapshot || {};
    // 키 기반 블롭 — 필드 단위 머지
    const mergeKeyed = (name, getLocal, setLocal, lsKey)=>{
      if(server[name] === undefined) return;
      const local = getLocal();
      const m = _mergeByField(local, server[name]||{}, snap[name]);
      if(JSON.stringify(m) !== JSON.stringify(local)){
        setLocal(m);
        if(lsKey) localStorage.setItem(lsKey, JSON.stringify(m));
        changed = true;
      }
    };
    // 🛡️ 서버가 비어있는데 로컬에 데이터가 있으면 서버 wipe 전파 방지 (로컬 보호)
    const _serverHasData = n => {
      const v = server[n];
      if(v==null) return false;
      if(Array.isArray(v)) return v.length > 0;
      if(typeof v === 'object') return Object.keys(v).length > 0;
      return false;
    };
    const _localHasData = v => {
      if(v==null) return false;
      if(Array.isArray(v)) return v.length > 0;
      if(typeof v === 'object') return Object.keys(v).length > 0;
      return false;
    };
    const _guardedMerge = (name, getLocal, setLocal, lsKey)=>{
      if(!_serverHasData(name) && _localHasData(getLocal())){
        console.warn('🛡️ poll: 서버 빈값 + 로컬 데이터 있음 → 로컬 보호('+name+')');
        return;
      }
      mergeKeyed(name, getLocal, setLocal, lsKey);
    };
    _guardedMerge('rec',   ()=>REC,           v=>{REC=v;},          'npm5_rec');
    _guardedMerge('bonus', ()=>BONUS_REC,     v=>{BONUS_REC=v;},    'npm5_bonus');
    _guardedMerge('allow', ()=>ALLOWANCE_REC, v=>{ALLOWANCE_REC=v;},'npm5_allow');
    _guardedMerge('tbk',   ()=>TBK,           v=>{TBK=v;},          'npm5_tbk');
    if(typeof leaveOverrides !== 'undefined'){
      mergeKeyed('leave_overrides', ()=>leaveOverrides, v=>{leaveOverrides=v;}, 'npm5_leave_overrides');
    }
    if(typeof SAFETY_REC !== 'undefined'){
      mergeKeyed('safety', ()=>SAFETY_REC, v=>{SAFETY_REC=v;}, 'npm5_safety');
    }
    // 비키 블롭 — 내 편집 없을 때만 교체 (스냅샷과 로컬이 같으면 미편집)
    const replaceIfClean = (name, getStr, apply)=>{
      if(server[name] === undefined) return;
      const localStr = getStr();
      const serverStr = JSON.stringify(server[name]);
      if(localStr !== serverStr && localStr === snap[name]){
        apply(server[name]);
        changed = true;
      }
    };
    // 🛡️ EMPS는 빈 배열로 전파 차단 (로컬에 데이터 있으면 서버 빈값 무시)
    const _guardedReplace = (name, getStr, apply)=>{
      if(!_serverHasData(name)){
        // 서버가 비었는데 로컬이 비어있지 않으면 교체 스킵
        try {
          const localParsed = JSON.parse(getStr());
          if(_localHasData(localParsed)){
            console.warn('🛡️ poll: 서버 빈값 + 로컬 데이터 있음 → 로컬 보호('+name+')');
            return;
          }
        } catch(e){}
      }
      replaceIfClean(name, getStr, apply);
    };
    _guardedReplace('emps', ()=>JSON.stringify(EMPS), v=>{
      EMPS = v; if(typeof sortEMPS==='function') sortEMPS();
      localStorage.setItem('npm5_emps', JSON.stringify(EMPS));
    });
    replaceIfClean('pol', ()=>JSON.stringify(POL), v=>{
      POL = Object.assign({...(typeof DEF_POL!=='undefined'?DEF_POL:{})}, v);
      localStorage.setItem('npm5_pol', JSON.stringify(POL));
    });
    _guardedReplace('bk', ()=>JSON.stringify(DEF_BK), v=>{
      DEF_BK = v;
      localStorage.setItem('npm5_bk', JSON.stringify(DEF_BK));
    });
    // 월별 POL/PAY 스냅샷: 다른 기기에서 확정/해제·정책변경한 내용 반영
    if(server.pol_snapshots !== undefined){
      const sv = JSON.stringify(server.pol_snapshots);
      if(sv !== JSON.stringify(POL_SNAPSHOTS||{})){
        POL_SNAPSHOTS = server.pol_snapshots || {};
        localStorage.setItem('npm5_pol_snapshots', sv);
        changed = true;
      }
    }
    if(server.pay_snapshots !== undefined){
      const sv = JSON.stringify(server.pay_snapshots);
      if(sv !== JSON.stringify(PAY_SNAPSHOTS||{})){
        PAY_SNAPSHOTS = server.pay_snapshots || {};
        localStorage.setItem('npm5_pay_snapshots', sv);
        changed = true;
      }
    }
    // BK_SNAPSHOTS 머지: 다른 기기에서 freeze된 월별 휴게세트 동기화
    // 🛡️ 새 값으로 덮여씌워지면 안 됨 — 서버 키와 로컬 키를 합치되, 동일 키는 로컬 우선
    if(server.bk_snapshots !== undefined && typeof BK_SNAPSHOTS !== 'undefined'){
      const merged = {...(server.bk_snapshots||{}), ...BK_SNAPSHOTS};
      const mv = JSON.stringify(merged);
      if(mv !== JSON.stringify(BK_SNAPSHOTS||{})){
        BK_SNAPSHOTS = merged;
        localStorage.setItem('npm5_bk_snapshots', mv);
        changed = true;
      }
    }

    if(!changed) return;
    _takeSyncedSnapshot();
    // 편집 중인 input이 있으면 재렌더 생략 (타이핑 끊기 방지)
    const ae = document.activeElement;
    const editing = ae && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA' || ae.tagName==='SELECT');
    if(editing) return;
    const active = document.querySelector('.pg.on');
    if(!active) return;
    const p = active.id.replace('pg-','');
    if(p==='daily' && typeof renderTable==='function') renderTable();
    else if(p==='monthly' && typeof renderMonthly==='function') renderMonthly();
    else if(p==='payroll' && typeof renderPayroll==='function') renderPayroll();
    else if(p==='emps' && typeof renderEmps==='function') renderEmps();
    else if(p==='leave' && typeof renderLeave==='function') renderLeave();
    else if(p==='company' && typeof renderCompany==='function') renderCompany();
    else if(p==='shift' && typeof renderShiftList==='function') renderShiftList();
    else if(p==='safety' && typeof renderSafety==='function') renderSafety();
    else if(p==='folder' && typeof renderFolder==='function') renderFolder();
    if(typeof renderSb==='function'){
      const sbInp = document.getElementById('sb-search-inp');
      renderSb(sbInp?.value||'');
    }
    // 성공 시 백오프 리셋
    _pollBackoffMs = 0;
  } catch(e){
    // 504/500 등: 지수 백오프 (2분 → 4 → 8 → 최대 10분)
    const msg = String(e && e.message || e);
    const isTimeout = msg.includes('504') || msg.includes('timeout') || msg.includes('Gateway');
    if(isTimeout){
      _pollBackoffMs = Math.min((_pollBackoffMs||POLL_INTERVAL_MS) * 2, POLL_BACKOFF_MAX);
      console.warn('poll 504/timeout — 백오프:', Math.round(_pollBackoffMs/1000)+'초 후 재시도');
      // setInterval 대신 setTimeout으로 재스케줄
      if(_pollTimerId){ clearInterval(_pollTimerId); _pollTimerId = null; }
      _pollTimerId = setTimeout(()=>{ _pollTimerId = null; startAutoPoll(); }, _pollBackoffMs);
    } else {
      console.warn('poll 실패:', e);
    }
  }
}

function startAutoPoll(){
  if(_pollTimerId) return;
  _pollTimerId = setInterval(pollForUpdates, POLL_INTERVAL_MS);
}
function stopAutoPoll(){
  if(_pollTimerId){
    // setInterval/setTimeout 둘 다 clearInterval/clearTimeout 가능 (내부 ID 공유)
    clearInterval(_pollTimerId); clearTimeout(_pollTimerId);
    _pollTimerId = null;
  }
  _pollBackoffMs = 0;
}

// ── 전체 불러오기 (서버 프록시) ──
// 규칙: 서버 응답에 키가 명시적으로 포함된 경우에만 메모리/localStorage 덮어씀.
// 키가 누락된 경우(네트워크/파셜 응답)에는 기존 값 유지 → 연쇄 wipe 방지.
async function sbLoadAll(companyId) {
  const map = await apiFetch('/data-load','POST',{});

  if('emps' in map)            { EMPS = map.emps || []; localStorage.setItem('npm5_emps', JSON.stringify(EMPS)); }
  sortEMPS();
  if('pol' in map && map.pol)  { POL = Object.assign({...DEF_POL}, map.pol); localStorage.setItem('npm5_pol', JSON.stringify(POL)); }
  if('bk' in map)              { DEF_BK = map.bk || []; localStorage.setItem('npm5_bk', JSON.stringify(DEF_BK)); }
  if('tbk' in map)             { TBK = map.tbk || {}; localStorage.setItem('npm5_tbk', JSON.stringify(TBK)); }
  if('rec' in map)             { REC = map.rec || {}; localStorage.setItem('npm5_rec', JSON.stringify(REC)); }
  if('bonus' in map)           { BONUS_REC = map.bonus || {}; localStorage.setItem('npm5_bonus', JSON.stringify(BONUS_REC)); }
  if('allow' in map)           { ALLOWANCE_REC = map.allow || {}; localStorage.setItem('npm5_allow', JSON.stringify(ALLOWANCE_REC)); }
  if('tax' in map)             { TAX_REC = map.tax || {}; localStorage.setItem('npm5_tax', JSON.stringify(TAX_REC)); }
  if('leave_settings' in map)  localStorage.setItem('npm5_leave_settings', JSON.stringify(map.leave_settings||{}));
  if('leave_overrides' in map) localStorage.setItem('npm5_leave_overrides', JSON.stringify(map.leave_overrides||{}));
  if('folders' in map)         localStorage.setItem('npm5_folders', JSON.stringify(map.folders||[]));
  if('safety' in map)          { SAFETY_REC = map.safety || {}; localStorage.setItem('npm5_safety', JSON.stringify(SAFETY_REC)); }
  if('pol_snapshots' in map)   { POL_SNAPSHOTS = map.pol_snapshots || {}; localStorage.setItem('npm5_pol_snapshots', JSON.stringify(POL_SNAPSHOTS)); }
  if('pay_snapshots' in map)   { PAY_SNAPSHOTS = map.pay_snapshots || {}; localStorage.setItem('npm5_pay_snapshots', JSON.stringify(PAY_SNAPSHOTS)); }
  if('bk_snapshots' in map)    { BK_SNAPSHOTS = map.bk_snapshots || {}; localStorage.setItem('npm5_bk_snapshots', JSON.stringify(BK_SNAPSHOTS)); }

  // 최초 1회: POL_SNAPSHOTS가 비어있고 REC 데이터가 있으면 현재 POL을 과거 달에 복사해 시작점 확보
  try {
    if(Object.keys(POL_SNAPSHOTS).length === 0 && Object.keys(REC||{}).length > 0){
      freezePastMonthsPol();
    }
  } catch(e){}
  // 동일하게 BK_SNAPSHOTS도 시드: 비어있고 REC 있으면 현재 DEF_BK를 과거 일자에 freeze
  try {
    if(typeof BK_SNAPSHOTS!=='undefined' && Object.keys(BK_SNAPSHOTS).length === 0 && Object.keys(REC||{}).length > 0){
      freezePastDaysBk();
    }
  } catch(e){}
  // BK 변경 감지 기준값 업데이트 (로드 직후 변경 오인 방지)
  try { _prevBkForSnapshot = JSON.parse(JSON.stringify(DEF_BK)); } catch(e){}
  // 서버에서 POL 로드 후 변경 감지 기준값 업데이트 (로드 후 즉시 변경으로 오인 방지)
  _prevPolForSnapshot = JSON.parse(JSON.stringify(POL));

  // 서버 로드 완료 시점 스냅샷 (폴링 머지 기준값)
  if(typeof _takeSyncedSnapshot === 'function') _takeSyncedSnapshot();
  return map;
}


// ── 랜딩 노이즈 + 스크롤 애니메이션 ──
function initLandingEffects(){
  const obs=new IntersectionObserver((entries)=>{
    entries.forEach(en=>{
    if(en.isIntersecting){en.target.style.opacity='1';en.target.style.transform='translateY(0)';}
  });
},{threshold:.1,rootMargin:'0px 0px -50px 0px'});
  setTimeout(()=>{
    document.querySelectorAll('#landing-overlay .lf-card,#landing-overlay .lpr-card,#landing-overlay .lhow-step').forEach(el=>{
      el.style.opacity='0';el.style.transform='translateY(24px)';
      el.style.transition='opacity .6s cubic-bezier(.16,1,.3,1),transform .6s cubic-bezier(.16,1,.3,1)';
      obs.observe(el);
    });
  },300);
}

// ══ 근무형태 관리 ══
let shiftSelected=new Set(),shiftFilter='전체',shiftSubF={shift:'all',nation:'all'};

function renderShiftList(){
  const search=(document.getElementById('shift-search')?.value||'').toLowerCase();
  const list=document.getElementById('shift-list');
  if(!list)return;
  const counts={'전체':0,'미등록':0,'fixed':0,'hourly':0,'monthly':0};
  let html='',visible=0;
  EMPS.forEach(emp=>{
    const mode=emp.payMode||'fixed';
    const hasShift=!!(emp.workStart&&emp.workEnd);
    const fk=hasShift?mode:'미등록';
    counts['전체']++;counts[fk]=(counts[fk]||0)+1;
    if(shiftFilter!=='전체'&&fk!==shiftFilter)return;
    if(search&&!(emp.name||'').toLowerCase().includes(search))return;
    if(shiftSubF.shift!=='all'&&(emp.shift||'day')!==shiftSubF.shift)return;
    const isFor=emp.nation==='foreign'||emp.foreigner===true;
    if(shiftSubF.nation==='korean'&&isFor)return;
    if(shiftSubF.nation==='foreign'&&!isFor)return;
    visible++;
    const isNight=emp.shift==='night';
    const sBadge=isNight
      ?`<span style="background:#26215c;color:#afa9ec;font-size:11px;padding:2px 8px;border-radius:100px;">야간</span>`
      :`<span style="background:#e8eef9;color:#1a2f6e;font-size:11px;padding:2px 8px;border-radius:100px;">주간</span>`;
    const pC={fixed:'background:#e1f5ee;color:#0f6e56',hourly:'background:#faeeda;color:#854f0b',monthly:'background:#eeedfe;color:#534ab7'};
    const pL={fixed:'통상임금제',hourly:'시급제',monthly:'포괄임금제'};
    const pBadge=hasShift
      ?`<span style="${pC[mode]||''};font-size:11px;padding:2px 8px;border-radius:100px;">${pL[mode]||mode}</span>`
      :`<span style="background:#f1efe8;color:#5f5e5a;font-size:11px;padding:2px 8px;border-radius:100px;">미등록</span>`;
    const mini=hasShift
      ?`<strong style="color:var(--ink);font-size:11px;">${emp.shiftName||emp.workStart+'~'+emp.workEnd}</strong><br><span style="color:var(--ink3);font-size:10px;">${(emp.workBks||[]).map(b=>b.start+'~'+b.end).join(', ')||'휴게 미설정'}</span>`
      :`<span class="shift-unreg">미등록</span>`;
    const days=(emp.workDays||[]).join('');
    const dBtn=hasShift
      ?`<button onclick="event.stopPropagation();openShiftDetail(${emp.id})" style="font-size:11px;color:var(--navy2);border:1px solid var(--navy2);border-radius:4px;padding:3px 8px;background:transparent;cursor:pointer;font-family:inherit;">상세보기</button>
         <button onclick="event.stopPropagation();clearEmpShift(${emp.id})" style="font-size:11px;color:#DC2626;border:1px solid #FECACA;border-radius:4px;padding:3px 8px;background:transparent;cursor:pointer;font-family:inherit;margin-left:4px;" title="근무형태 할당 해제">🗑 삭제</button>`
      :`<button onclick="event.stopPropagation();shiftSelected.add(${emp.id});updateShiftToolbar();openShiftModal('register')" style="font-size:11px;color:#e97d2b;border:1px solid #e97d2b;border-radius:4px;padding:3px 8px;background:transparent;cursor:pointer;font-family:inherit;">등록</button>`;
    const chk=shiftSelected.has(emp.id);
    html+=`<div class="shift-emp-row${chk?' checked':''}" id="shift-row-${emp.id}" onclick="shiftToggleRow(${emp.id})">
      <input type="checkbox" ${chk?'checked':''} style="accent-color:var(--navy);" onclick="event.stopPropagation();shiftCheckRow(${emp.id},this)">
      <span style="color:var(--ink3);">${esc(emp.empNo||'')}</span>
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="width:26px;height:26px;border-radius:50%;background:var(--nbg);color:var(--navy2);font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;">${(emp.name||'?')[0]}</div>
        <span style="font-weight:500;">${emp.name||''}</span>
      </div>
      <div>${sBadge}</div><div>${pBadge}</div>
      <div style="font-size:11px;color:var(--ink3);">${days||'—'}</div>
      <div style="font-size:11px;line-height:1.5;">${mini}</div>
      <div style="text-align:center;">${dBtn}</div>
    </div>`;
  });
  if(!visible)html=`<div style="padding:32px;text-align:center;font-size:12px;color:var(--ink3);">검색 결과가 없습니다.</div>`;
  list.innerHTML=html;
  const rc=document.getElementById('shift-result-count');if(rc)rc.textContent=`총 ${visible}명`;
  Object.keys(counts).forEach(k=>{const el=document.getElementById('sf-cnt-'+k);if(el)el.textContent=counts[k];});
}

function setShiftSubFilter(key, val, btn){
  shiftSubF[key] = val;
  if(btn){
    const grp = btn.closest('div');
    if(grp) grp.querySelectorAll('.shift-ftab').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
  }
  renderShiftList();
}
function setShiftFilter(btn){
  btn.closest('div').querySelectorAll('.shift-ftab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');shiftFilter=btn.dataset.f;shiftSelected.clear();updateShiftToolbar();renderShiftList();
}
function shiftToggleRow(id){const row=document.getElementById('shift-row-'+id);const cb=row?.querySelector('input[type=checkbox]');if(cb){cb.checked=!cb.checked;shiftCheckRow(id,cb);}}
function shiftCheckRow(id,cb){const row=document.getElementById('shift-row-'+id);if(cb.checked){shiftSelected.add(id);row?.classList.add('checked');}else{shiftSelected.delete(id);row?.classList.remove('checked');}updateShiftToolbar();}
function shiftSelectAll(cb){document.querySelectorAll('#shift-list .shift-emp-row').forEach(row=>{const id=parseInt(row.id.replace('shift-row-',''));const c=row.querySelector('input[type=checkbox]');if(c){c.checked=cb.checked;shiftCheckRow(id,c);}});}
function updateShiftToolbar(){
  const cnt=shiftSelected.size;
  const si=document.getElementById('shift-sel-info');if(si)si.textContent=cnt+'명 선택';
  ['shift-btn-register','shift-btn-edit'].forEach(id=>{
    const btn=document.getElementById(id);if(!btn)return;
    btn.disabled=cnt===0;btn.style.opacity=cnt>0?'1':'0.4';btn.style.cursor=cnt>0?'pointer':'not-allowed';
  });
}
function openShiftModal(type){
  document.getElementById('shift-modal-title').textContent=type==='register'?'근무형태 등록':'근무형태 수정';
  document.getElementById('shift-modal-notice').textContent=`선택한 ${shiftSelected.size}명에게 아래 근무형태가 일괄 적용됩니다.`;
  const fromInput=document.getElementById('shift-history-from');
  if(fromInput)fromInput.value=new Date().toISOString().slice(0,10);
  if(type==='edit'&&shiftSelected.size>0){
    const emp=EMPS.find(e=>e.id===[...shiftSelected][0]);
    if(emp){
      document.getElementById('sm-name').value=emp.shiftName||'';
      document.getElementById('sm-start').value=emp.workStart||'09:00';
      document.getElementById('sm-end').value=emp.workEnd||'18:00';
      document.querySelectorAll('.sm-day-btn:not(.hol)').forEach(btn=>{
        const on=(emp.workDays||[]).includes(btn.textContent);
        btn.classList.toggle('on',on);
        btn.style.background=on?'var(--navy)':'transparent';
        btn.style.borderColor=on?'var(--navy)':'var(--bd2)';
        btn.style.color=on?'#fff':'var(--ink3)';
      });
      const bkList=document.getElementById('sm-bk-list');bkList.innerHTML='';
      (emp.workBks||[{start:'12:00',end:'13:00'}]).forEach(bk=>addSmBkWithVal(bk.start,bk.end));
      const shiftRadio=document.querySelector(`input[name="sm-shift"][value="${emp.shift||'day'}"]`);
      if(shiftRadio)shiftRadio.checked=true;
    }
  }
  document.getElementById('shift-modal').style.display='flex';
}
function saveShiftModal(){
  const name=document.getElementById('sm-name').value||'';
  const start=document.getElementById('sm-start').value;
  const end=document.getElementById('sm-end').value;
  const isNight=document.querySelector('input[name="sm-shift"]:checked')?.value==='night';
  const days=[...document.querySelectorAll('.sm-day-btn.on')].map(b=>b.textContent);
  const bks=[...document.querySelectorAll('.sm-bk-row')].map(row=>({
    start:row.querySelector('.sm-bk-s')?.value||'12:00',
    end:row.querySelector('.sm-bk-e')?.value||'13:00'
  }));
  if(!name){if(typeof showSyncToast==='function')showSyncToast('형태명을 입력해주세요.','warn');else alert('형태명을 입력해주세요.');return;}
  shiftSelected.forEach(id=>{
    saveEmpWithHistory(id, {
      shiftName: name,
      workStart: start,
      workEnd: end,
      shift: isNight ? 'night' : 'day',
      workDays: days,
      workBks: bks,
    });
  });
  saveLS();renderShiftList();renderTable();
  document.getElementById('shift-modal').style.display='none';
  shiftSelected.clear();updateShiftToolbar();
  if(typeof showSyncToast==='function')showSyncToast('근무형태가 저장되었습니다.','ok');
}
function openShiftDetail(id){
  const emp=EMPS.find(e=>e.id===id);if(!emp)return;
  document.getElementById('sd-name').textContent=(emp.name||'')+'  근무형태 상세';
  document.getElementById('sd-shift-name').textContent=emp.shiftName||'—';
  document.getElementById('sd-pay').textContent={fixed:'통상임금제',hourly:'시급제',monthly:'포괄임금제'}[emp.payMode]||'—';
  document.getElementById('sd-days').textContent=(emp.workDays||[]).join(' ')||'—';
  document.getElementById('sd-time').textContent=(emp.workStart||'—')+' ~ '+(emp.workEnd||'—');
  document.getElementById('sd-bks').textContent=(emp.workBks||[]).map(b=>b.start+'~'+b.end).join(', ')||'—';
  shiftSelected.clear();shiftSelected.add(id);updateShiftToolbar();
  document.getElementById('shift-detail-modal').style.display='flex';
}
// 직원의 근무형태 할당 해제 (shiftName/workStart/workEnd/workDays/workBks 초기화)
function clearEmpShift(empId){
  const emp = EMPS.find(e => e.id === empId);
  if(!emp) return;
  const name = emp.name || '이름 없음';
  if(!confirm(`"${name}" 직원의 근무형태를 삭제하시겠습니까?\n\n상태가 "미등록"으로 변경되고 저장된 shiftName·출퇴근 시간·소정근로일·휴게시간 설정이 제거됩니다.`)) return;
  if(!confirm(`⚠️ 최종 확인\n\n"${name}" 근무형태를 정말 삭제할까요?`)) return;
  saveEmpWithHistory(empId, {
    shiftName: '',
    workStart: '',
    workEnd: '',
    workDays: [],
    workBks: [],
  });
  saveLS();
  renderShiftList();
  try{ renderTable(); }catch(e){}
  if(typeof showSyncToast==='function') showSyncToast(`"${name}" 근무형태 삭제 완료`,'ok');
}

function addSmBk(){addSmBkWithVal('12:00','13:00');}
function addSmBkWithVal(s,e){
  const list=document.getElementById('sm-bk-list');
  const row=document.createElement('div');row.className='sm-bk-row';
  row.innerHTML=`<input class="sm-bk-s shift-time-input" type="time" value="${s}"><span style="font-size:12px;color:var(--ink3);">~</span><input class="sm-bk-e shift-time-input" type="time" value="${e}"><button onclick="this.closest('.sm-bk-row').remove()" class="shift-bk-del">✕</button>`;
  list.appendChild(row);
}
function toggleSmDay(el){
  if(el.classList.contains('hol'))return;
  el.classList.toggle('on');const on=el.classList.contains('on');
  el.style.background=on?'var(--navy)':'transparent';
  el.style.borderColor=on?'var(--navy)':'var(--bd2)';
  el.style.color=on?'#fff':'var(--ink3)';
}

// ══ 출퇴근 기록 체크박스 + 정상출퇴근 ══
function dailySelectAll(cb){
  document.querySelectorAll('.daily-row-cb').forEach(c=>c.checked=cb.checked);
}
function fillNormalAttendSelected(){
  const checked=[...document.querySelectorAll('.daily-row-cb:checked')].map(c=>parseInt(c.dataset.eid));
  if(checked.length===0){
    if(typeof showSyncToast==='function')showSyncToast('직원을 선택해주세요.','warn');
    return;
  }
  fillNormalAttend(checked);
}
function fillNormalAttend(empIds){
  const targets=empIds||EMPS.map(e=>e.id);
  let blocked=[],filled=0;
  targets.forEach(id=>{
    const emp=EMPS.find(e=>e.id===id);
    if(!emp||!emp.workStart||!emp.workEnd)return;
    const autoH=isAutoHol(cY,cM,cD,emp);
    if(autoH){blocked.push(emp.name);return;}
    const k=rk(id,cY,cM,cD);
    if(!REC[k])REC[k]={empId:id,start:'',end:'',absent:false,annual:false,note:'',outTimes:[]};
    REC[k].start=emp.workStart;REC[k].end=emp.workEnd;
    REC[k].absent=false;REC[k].annual=false;
    if(emp.workBks && emp.workBks.length > 0){
      REC[k].customBk = true;
      REC[k].customBkList = emp.workBks.map(b=>({start:b.start||b.s, end:b.end||b.e}));
    }
    __recWrite('fillNormalAttend', id, k, {start:emp.workStart, end:emp.workEnd, name:emp.name});
    filled++;
  });
  if(blocked.length>0&&typeof showSyncToast==='function')
    showSyncToast('휴일 입력 불가: '+blocked.join(', '),'warn');
  if(filled>0){
    saveLS();renderTable();
    if(typeof showSyncToast==='function')showSyncToast(filled+'명 정상출퇴근 완료','ok');
  }
}

// ══ 직원 정보 이력 관리 ══
function getEmpHistoryAt(emp, y, m, d) {
  const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  if (!emp.history || emp.history.length === 0) return null;
  const valid = emp.history
    .filter(h => h.from <= dateStr)
    .sort((a, b) => b.from.localeCompare(a.from));
  return valid[0] || null;
}

function getEmpRateAt(emp, y, m, d) {
  const hist = getEmpHistoryAt(emp, y, m, d);
  if (hist && hist.rate) return hist.rate;
  // 월급제: 월급/209를 시급 상당으로 환산 (getEmpRate와 동일 로직)
  const mode = (hist && hist.payMode) || emp.payMode;
  if (mode === 'monthly') {
    const monthly = (hist && hist.monthly) || emp.monthly || POL.baseMonthly || 0;
    if (monthly > 0) return Math.round(monthly / 209);
  }
  return emp.rate || POL.baseRate || 0;
}

function getEmpPayModeAt(emp, y, m, d) {
  const hist = getEmpHistoryAt(emp, y, m, d);
  const mode = hist ? (hist.payMode || emp.payMode) : emp.payMode;
  return mode === 'monthly' ? 'monthly' : mode === 'hourly' ? 'hourly' : mode === 'pohal' ? 'pohal' : 'fixed';
}

function getEmpMonthlyAt(emp, y, m, d) {
  const hist = getEmpHistoryAt(emp, y, m, d);
  if (hist && hist.monthly) return hist.monthly;
  return emp.monthly || 0;
}

function getEmpShiftAt(emp, y, m, d) {
  const hist = getEmpHistoryAt(emp, y, m, d);
  if (hist) return {
    shift: hist.shift || emp.shift,
    shiftName: hist.shiftName || emp.shiftName,
    workStart: hist.workStart || emp.workStart,
    workEnd: hist.workEnd || emp.workEnd,
    workBks: hist.workBks || emp.workBks || [],
    workDays: hist.workDays || emp.workDays || [],
  };
  return {
    shift: emp.shift,
    shiftName: emp.shiftName,
    workStart: emp.workStart,
    workEnd: emp.workEnd,
    workBks: emp.workBks || [],
    workDays: emp.workDays || [],
  };
}

function saveEmpWithHistory(empId, newData) {
  const emp = EMPS.find(e => e.id === empId);
  if (!emp) return;

  const fromDate = document.getElementById('shift-history-from')?.value
    || document.getElementById('emp-history-from')?.value
    || new Date().toISOString().slice(0, 10);

  if (!emp.history) {
    emp.history = [{
      from: emp.join || '2020-01-01',
      payMode: emp.payMode,
      rate: emp.rate,
      monthly: emp.monthly,
      shift: emp.shift,
      shiftName: emp.shiftName,
      workStart: emp.workStart,
      workEnd: emp.workEnd,
      workBks: emp.workBks || [],
      workDays: emp.workDays || [],
    }];
  }

  const existing = emp.history.findIndex(h => h.from === fromDate);
  const histEntry = {
    from: fromDate,
    payMode: newData.payMode ?? emp.payMode,
    rate: newData.rate ?? emp.rate,
    monthly: newData.monthly ?? emp.monthly,
    shift: newData.shift ?? emp.shift,
    shiftName: newData.shiftName ?? emp.shiftName,
    workStart: newData.workStart ?? emp.workStart,
    workEnd: newData.workEnd ?? emp.workEnd,
    workBks: newData.workBks ?? emp.workBks ?? [],
    workDays: newData.workDays ?? emp.workDays ?? [],
  };

  if (existing >= 0) {
    emp.history[existing] = histEntry;
  } else {
    emp.history.push(histEntry);
    emp.history.sort((a, b) => a.from.localeCompare(b.from));
  }

  Object.assign(emp, newData);
  saveLS();
}

function renderEmpHistory(emp) {
  if (!emp.history || emp.history.length === 0) return '<div style="color:var(--ink3);font-size:12px;">이력 없음</div>';
  return emp.history
    .slice().reverse()
    .map(h => `
      <div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--bd);font-size:11px;">
        <span style="color:var(--navy2);font-weight:600;white-space:nowrap;">${h.from}</span>
        <span style="color:var(--ink3);">${{fixed:'소정',hourly:'시급',monthly:'포괄'}[h.payMode]||h.payMode||''}</span>
        <span style="color:var(--ink3);">${h.shiftName||''}</span>
        <span style="color:var(--ink3);">${h.rate ? h.rate.toLocaleString()+'원/h' : ''}</span>
      </div>`).join('');
}

// ══ 휴게���간 우선순위 팝업 ══
function showBkPriorityTip(){
  const existing = document.getElementById('bk-priority-layer');
  if(existing){ existing.remove(); return; }
  const bg = document.createElement('div');
  bg.id = 'bk-priority-layer';
  bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
  bg.onclick = e => { if(e.target===bg) bg.remove(); };
  bg.innerHTML = `
    <div style="background:var(--card);border-radius:14px;width:460px;max-width:100%;max-height:85vh;overflow-y:auto;border:1px solid var(--bd);">
      <div style="padding:14px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:var(--card);z-index:1;">
        <span style="font-size:14px;font-weight:700;color:var(--ink);">휴게시간 적용 우선순위</span>
        <button onclick="document.getElementById('bk-priority-layer').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--ink3);">×</button>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:#EFF6FF;border-radius:8px;border-left:3px solid #2347b5;">
          <span style="font-size:14px;font-weight:700;color:#2347b5;flex-shrink:0;min-width:44px;">1순위</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:#1a2f6e;">개별휴게 (직원 개인 설정)</div>
            <div style="font-size:11px;color:#6b7280;margin-top:3px;line-height:1.6;">직원 개인에게 지정된 ���정 휴게시간</div>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:#F0FFF8;border-radius:8px;border-left:3px solid #0f6e56;">
          <span style="font-size:14px;font-weight:700;color:#0f6e56;flex-shrink:0;min-width:44px;">2순위</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:#085041;">오늘만 수정</div>
            <div style="font-size:11px;color:#6b7280;margin-top:3px;line-height:1.6;">당일 임시로 변경한 휴게시간 (다음�� 자동 복원)</div>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:#FAEEDA;border-radius:8px;border-left:3px solid #854f0b;">
          <span style="font-size:14px;font-weight:700;color:#854f0b;flex-shrink:0;min-width:44px;">3순위</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:#633806;">근무형태 기본 휴게시간</div>
            <div style="font-size:11px;color:#6b7280;margin-top:3px;line-height:1.6;">근무형태 탭에서 등록한 근로계약서 기준 휴게</div>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:#F1EFE8;border-radius:8px;border-left:3px solid #5f5e5a;">
          <span style="font-size:14px;font-weight:700;color:#5f5e5a;flex-shrink:0;min-width:44px;">4순위</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:#444441;">급여설정 기본값</div>
            <div style="font-size:11px;color:#6b7280;margin-top:3px;line-height:1.6;">급여 설정에서 지정한 회사 전체 기본 휴게시간</div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(bg);
}

// ══ 내 정보 ══
function renderMyInfo(){
  const sess = JSON.parse(localStorage.getItem('nopro_session')||'null');
  const cont = document.getElementById('myinfo-content');
  if(!cont) return;
  if(!sess){
    cont.innerHTML='<div style="color:var(--ink3);padding:40px;text-align:center;">로그인 정보를 불러올 수 없습니다.</div>';
    return;
  }

  // 세션 키 정규화
  const co = sess.company || sess.company_name || '-';
  const nm = sess.name || sess.manager_name || '-';
  const ph = sess.phone || sess.manager_phone || '-';
  const em = sess.email || '-';
  const sz = sess.size || sess.employee_size || '-';
  const jd = sess.joinDate || sess.join_date || sess.created_at || '-';

  // 통계 데이터
  const activeEmps = EMPS.filter(e=>!e.leave);
  const leftEmps = EMPS.filter(e=>e.leave);
  const dayEmps = activeEmps.filter(e=>(e.shift||'day')==='day');
  const nightEmps = activeEmps.filter(e=>e.shift==='night');
  const fixedCnt = activeEmps.filter(e=>(e.payMode||'fixed')==='fixed').length;
  const hourlyCnt = activeEmps.filter(e=>e.payMode==='hourly').length;
  const monthlyCnt = activeEmps.filter(e=>e.payMode==='monthly').length;
  const korCnt = activeEmps.filter(e=>e.nation!=='foreign'&&e.foreigner!==true).length;
  const forCnt = activeEmps.filter(e=>e.nation==='foreign'||e.foreigner===true).length;
  const totalActive = activeEmps.length||1;

  // 입사연도 분포
  const yearMap={};
  activeEmps.forEach(e=>{if(e.join){const y=e.join.slice(0,4);yearMap[y]=(yearMap[y]||0)+1;}});
  const yearEntries=Object.entries(yearMap).sort((a,b)=>a[0].localeCompare(b[0])).slice(-5);
  const yearMax=Math.max(...yearEntries.map(e=>e[1]),1);

  const statCard = (num, lbl, color, bg) => `
    <div style="background:${bg};border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:6px;">
      <div style="font-size:28px;font-weight:900;color:${color};letter-spacing:-1.5px;line-height:1;">${num}</div>
      <div style="font-size:10px;font-weight:700;color:${color};opacity:.6;letter-spacing:.08em;text-transform:uppercase;">${lbl}</div>
    </div>`;

  function barHtml(label, cnt, maxV, color, labelColor){
    const pct=Math.round(cnt/maxV*100);
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <span style="font-size:11px;font-weight:600;color:${labelColor||'var(--ink3)'};min-width:34px;text-align:right;">${label}</span>
      <div style="flex:1;height:8px;background:var(--bd);border-radius:100px;overflow:hidden;position:relative;">
        <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${color};border-radius:100px;transition:width .8s cubic-bezier(.4,0,.2,1);"></div>
      </div>
      <span style="font-size:11px;font-weight:700;color:var(--ink2);min-width:28px;text-align:right;">${cnt}<span style="font-size:9px;font-weight:500;color:var(--ink3);margin-left:1px;">명</span></span>
    </div>`;
  }

  cont.innerHTML=`
  <style>
  .mi-section{background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow:hidden;margin-bottom:16px;}
  .mi-section-hd{padding:14px 20px;font-size:12px;font-weight:700;color:var(--ink3);letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid var(--bd);background:var(--surf);}
  .mi-row{display:flex;align-items:center;padding:14px 20px;border-bottom:1px solid var(--bd);gap:12px;}
  .mi-row:last-child{border-bottom:none;}
  .mi-label{font-size:13px;font-weight:500;color:var(--ink);min-width:100px;}
  .mi-value{font-size:13px;color:var(--ink2);flex:1;}
  .mi-edit-btn{font-size:12px;color:var(--navy2);border:1px solid var(--bd2);border-radius:7px;padding:4px 12px;background:transparent;cursor:pointer;font-family:inherit;white-space:nowrap;}
  .mi-edit-btn:hover{background:var(--surf);}
  .mi-input{flex:1;height:34px;border:1.5px solid var(--bd2);border-radius:8px;padding:0 10px;font-size:13px;font-family:inherit;background:var(--card);color:var(--ink);outline:none;transition:border-color .15s;}
  .mi-input:focus{border-color:var(--navy2);}
  .mi-save-btn{padding:5px 14px;background:var(--navy);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;}
  .mi-cancel-btn{padding:5px 12px;background:transparent;color:var(--ink3);border:1px solid var(--bd2);border-radius:7px;font-size:12px;cursor:pointer;font-family:inherit;}
  @media(max-width:768px){
    .mi-wrap{grid-template-columns:1fr!important;gap:12px!important;padding:12px!important}
    .mi-row{padding:10px 14px;gap:8px;flex-wrap:wrap;}
    .mi-label{min-width:70px;font-size:12px;}
    .mi-value{font-size:12px;}
    .mi-section-hd{padding:10px 14px;font-size:11px;}
    .mi-edit-btn{padding:3px 8px;font-size:11px;}
  }
  </style>

  <div class="mi-wrap" style="padding:24px;display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;">
    <!-- 좌측 -->
    <div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;">
        <div style="width:60px;height:60px;border-radius:50%;background:var(--nbg);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:var(--navy2);">
          ${(co)[0]}
        </div>
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--ink);">${esc(co)}</div>
          <div style="font-size:13px;color:var(--ink3);margin-top:3px;">${esc(em)}</div>
        </div>
      </div>

      <div id="mi-edit-panel" style="display:none;background:var(--card);border:1.5px solid var(--navy2);border-radius:14px;padding:20px;margin-bottom:16px;">
        <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:14px;" id="mi-edit-title"></div>
        <div id="mi-edit-body"></div>
        <div id="mi-status" style="font-size:12px;padding:6px 12px;border-radius:7px;display:none;margin-top:8px;"></div>
      </div>

      <div class="mi-section">
        <div class="mi-section-hd">회사 정보</div>
        <div class="mi-row">
          <span class="mi-label">회사명</span>
          <span class="mi-value" id="disp-company">${esc(co)}</span>
          <button class="mi-edit-btn" onclick="miStartEdit('company','${esc(co)}')">수정</button>
        </div>
        <div class="mi-row">
          <span class="mi-label">담당자</span>
          <span class="mi-value" id="disp-name">${esc(nm)}</span>
          <button class="mi-edit-btn" onclick="miStartEdit('name','${esc(nm)}')">수정</button>
        </div>
        <div class="mi-row">
          <span class="mi-label">연락처</span>
          <span class="mi-value" id="disp-phone">${esc(ph)}</span>
          <button class="mi-edit-btn" onclick="miStartEdit('phone','${esc(ph)}')">수정</button>
        </div>
        <div class="mi-row">
          <span class="mi-label">직원수</span>
          <span class="mi-value">${sz==='undefined'||!sz||sz==='-'?'미입력':esc(sz)}</span>
        </div>
        <div class="mi-row">
          <span class="mi-label">가입일</span>
          <span class="mi-value">${jd==='undefined'||!jd||jd==='-'?'미입력':esc(String(jd).slice(0,10))}</span>
        </div>
      </div>

      <div class="mi-section">
        <div class="mi-section-hd">계정 정보</div>
        <div class="mi-row">
          <span class="mi-label">이메일</span>
          <span class="mi-value" id="disp-email">${esc(em)}</span>
          <button class="mi-edit-btn" onclick="miStartEdit('email','${esc(em)}')">수정</button>
        </div>
        <div class="mi-row">
          <span class="mi-label">비밀번호</span>
          <span class="mi-value" id="disp-pw">••••••••</span>
          <button class="mi-edit-btn" onclick="miTogglePw()">보기</button>
          <button class="mi-edit-btn" onclick="miStartEdit('password','')">변경</button>
        </div>
      </div>
    </div>

    <!-- 우측: 통계 대시보드 -->
    <div>
      ${(()=>{
        const active = activeEmps;
        const retired = leftEmps.length;
        const total = EMPS.length||1;
        const foreign = forCnt;

        const avgRate = active.length ? Math.round(active.reduce((s,e)=>s+getEmpRate(e),0)/active.length) : 0;
        const monthlyLabor = Math.round(active.reduce((s,e)=>{
          const m = getEmpPayMode(e)==='monthly' ? (e.monthly||0) : getEmpRate(e)*209;
          return s+m;
        },0)/10000);
        const now2=new Date(); const thisY2=now2.getFullYear(); const thisM2=now2.getMonth()+1;
        const newHires = EMPS.filter(e=>{
          if(!e.join) return false;
          const d=new Date(e.join);
          return d.getFullYear()===thisY2 && d.getMonth()+1===thisM2;
        }).length;
        const turnoverRate = EMPS.length ? Math.round(retired/EMPS.length*100) : 0;
        const foreignRate = Math.round(foreign/totalActive*100);

        const kpiBig = (val, lbl, sub, color) => `
          <div style="background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px 18px;position:relative;overflow:hidden;">
            <div style="position:absolute;top:0;left:0;width:3px;height:100%;background:${color};border-radius:14px 0 0 14px;"></div>
            <div style="font-size:26px;font-weight:900;color:${color};letter-spacing:-1.5px;line-height:1;margin-bottom:4px;">${val}</div>
            <div style="font-size:11px;font-weight:700;color:var(--ink);">${lbl}</div>
            ${sub ? `<div style="font-size:10px;color:var(--ink3);margin-top:2px;">${sub}</div>` : ''}
          </div>`;

        const kpiSmall = (val, lbl, color, bg) => `
          <div style="background:${bg};border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;color:var(--ink3);font-weight:500;">${lbl}</span>
            <span style="font-size:14px;font-weight:800;color:${color};">${val}</span>
          </div>`;

        const bar2 = (label, cnt, maxV, color, labelColor, pctOverride) => {
          const pct = pctOverride !== undefined ? pctOverride : Math.round(cnt/maxV*100);
          return `<div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-size:11px;font-weight:600;color:${labelColor};">${label}</span>
              <span style="font-size:11px;font-weight:700;color:var(--ink2);">${cnt}명 <span style="font-size:9px;color:var(--ink3);">(${pct}%)</span></span>
            </div>
            <div style="height:7px;background:var(--bd);border-radius:100px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${color};border-radius:100px;transition:width .8s cubic-bezier(.4,0,.2,1);"></div>
            </div>
          </div>`;
        };

        const fixPct=Math.round(fixedCnt/totalActive*100);
        const hourPct=Math.round(hourlyCnt/totalActive*100);
        const monPct=Math.round(monthlyCnt/totalActive*100);
        const korPct=Math.round(korCnt/totalActive*100);
        const forPct=Math.round(forCnt/totalActive*100);

        return `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
            ${kpiBig(active.length+'명','재직 인원','퇴사 '+retired+'명 포함 총 '+EMPS.length+'명','#2347b5')}
            ${kpiBig(monthlyLabor.toLocaleString()+'만','월 인건비 추정','시급×209h / 월급 기준','#0F766E')}
            ${kpiBig(dayEmps.length+'명','주간 근무','전체 재직의 '+Math.round(dayEmps.length/totalActive*100)+'%','#0891b2')}
            ${kpiBig(avgRate.toLocaleString()+'원','평균 통상시급','재직자 기준','#D97706')}
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
            ${kpiSmall(newHires+'명','이번달 신규입사','#059669','#ECFDF5')}
            ${kpiSmall(turnoverRate+'%','퇴사율','#DC2626','#FEF2F2')}
            ${kpiSmall(foreignRate+'%','외국인 비율','#D97706','#FFFBEB')}
          </div>

          <div class="mi-section">
            <div class="mi-section-hd">급여형태 분포</div>
            <div style="padding:14px 20px;">
              <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
                <span style="font-size:10px;font-weight:700;color:#0F766E;background:#F0FDF4;padding:3px 9px;border-radius:20px;">소정근무 ${fixedCnt}명 (${fixPct}%)</span>
                <span style="font-size:10px;font-weight:700;color:#D97706;background:#FFFBEB;padding:3px 9px;border-radius:20px;">시급제 ${hourlyCnt}명 (${hourPct}%)</span>
                <span style="font-size:10px;font-weight:700;color:#7C3AED;background:#F5F3FF;padding:3px 9px;border-radius:20px;">월급제 ${monthlyCnt}명 (${monPct}%)</span>
              </div>
              ${bar2('소정근무',fixedCnt,totalActive,'#0F766E','#0F766E',fixPct)}
              ${bar2('시급제',hourlyCnt,totalActive,'#D97706','#D97706',hourPct)}
              ${bar2('월급제',monthlyCnt,totalActive,'#7C3AED','#7C3AED',monPct)}
              <div style="height:6px;border-radius:100px;overflow:hidden;display:flex;margin-top:4px;">
                <div style="width:${fixPct}%;background:#0F766E;"></div>
                <div style="width:${hourPct}%;background:#D97706;"></div>
                <div style="flex:1;background:#7C3AED;"></div>
              </div>
            </div>
          </div>

          <div class="mi-section">
            <div class="mi-section-hd">내/외국인 현황</div>
            <div style="padding:14px 20px;">
              ${bar2('내국인',korCnt,totalActive,'var(--navy)','var(--navy)',korPct)}
              ${bar2('외국인',forCnt,totalActive,'#D97706','#D97706',forPct)}
              <div style="height:6px;border-radius:100px;overflow:hidden;display:flex;margin-top:4px;">
                <div style="width:${korPct}%;background:var(--navy);transition:width .8s;"></div>
                <div style="flex:1;background:#f59e0b;"></div>
              </div>
            </div>
          </div>

          <div class="mi-section">
            <div class="mi-section-hd">주/야간 현황</div>
            <div style="padding:14px 20px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div style="background:rgba(8,145,178,.07);border-radius:12px;padding:14px;text-align:center;">
                <div style="font-size:24px;font-weight:900;color:#0891b2;">${dayEmps.length}명</div>
                <div style="font-size:11px;font-weight:600;color:#0891b2;margin-top:2px;">주간 (${Math.round(dayEmps.length/totalActive*100)}%)</div>
              </div>
              <div style="background:rgba(124,58,237,.07);border-radius:12px;padding:14px;text-align:center;">
                <div style="font-size:24px;font-weight:900;color:#7c3aed;">${nightEmps.length}명</div>
                <div style="font-size:11px;font-weight:600;color:#7c3aed;margin-top:2px;">야간 (${Math.round(nightEmps.length/totalActive*100)}%)</div>
              </div>
            </div>
          </div>

          ${yearEntries.length?`<div class="mi-section">
            <div class="mi-section-hd">입사 연도별 현황</div>
            <div style="padding:14px 20px;">
              ${yearEntries.map(([y,c])=>{
                const isRecent=parseInt(y)>=new Date().getFullYear()-1;
                return bar2(y+'년',c,yearMax,isRecent?'var(--navy)':'var(--bd2)',isRecent?'var(--navy)':'var(--ink3)');
              }).join('')}
            </div>
          </div>`:''}
        `;
      })()}
    </div>
  </div>`;
}

let miEditField = '';
let miPwVisible = false;

function miTogglePw(){
  if(miPwVisible){
    miPwVisible = false;
    const el = document.getElementById('disp-pw');
    if(el){ el.textContent='••••••••'; el.style.color=''; el.style.fontFamily=''; }
    const btn = document.querySelector('[onclick="miTogglePw()"]');
    if(btn) btn.textContent='보기';
    document.getElementById('mi-pw-panel')?.remove();
    return;
  }

  const panel = document.createElement('div');
  panel.id = 'mi-pw-panel';
  panel.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;';
  panel.innerHTML = `
    <div style="background:var(--card);border-radius:16px;padding:24px;width:320px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
      <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">🔑 비밀번호 확인</div>
      <div style="font-size:12px;color:var(--ink3);margin-bottom:16px;">본인 확인을 위해 현재 비밀번호를 입력해주세요.</div>
      <input id="mi-pw-check-inp" type="password" placeholder="현재 비밀번호 입력"
        style="width:100%;height:36px;border:1.5px solid var(--bd2);border-radius:9px;padding:0 12px;font-size:13px;font-family:inherit;background:var(--card);color:var(--ink);outline:none;margin-bottom:8px;box-sizing:border-box;"
        onkeydown="if(event.key==='Enter') miConfirmPwView()">
      <div id="mi-pw-check-err" style="font-size:11px;color:#DC2626;display:none;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;margin-top:4px;">
        <button onclick="miConfirmPwView()"
          style="flex:1;padding:8px;background:var(--navy);color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">확인</button>
        <button onclick="document.getElementById('mi-pw-panel').remove()"
          style="padding:8px 14px;background:transparent;color:var(--ink3);border:1px solid var(--bd2);border-radius:9px;font-size:12px;cursor:pointer;font-family:inherit;">취소</button>
      </div>
    </div>`;
  document.body.appendChild(panel);
  setTimeout(()=>document.getElementById('mi-pw-check-inp')?.focus(), 100);
}

async function miConfirmPwView(){
  const inp = document.getElementById('mi-pw-check-inp');
  const errEl = document.getElementById('mi-pw-check-err');
  const pw = inp?.value?.trim();
  if(!pw){ if(errEl){errEl.textContent='비밀번호를 입력해주세요.';errEl.style.display='block';} return; }

  try {
    const sess = JSON.parse(localStorage.getItem('nopro_session')||'null');
    await apiFetch('/auth-update','POST',{
      currentPassword: pw,
      company: sess?.company||sess?.company_name||''
    });

    document.getElementById('mi-pw-panel')?.remove();
    miPwVisible = true;
    const el = document.getElementById('disp-pw');
    if(el){
      el.textContent = sess?.password||sess?.pw||pw;
      el.style.color = 'var(--navy2)';
      el.style.fontFamily = 'monospace';
    }
    const btn = document.querySelector('[onclick="miTogglePw()"]');
    if(btn) btn.textContent='숨기기';

  } catch(e){
    if(errEl){
      errEl.textContent = '비밀번호가 올바르지 않습니다.';
      errEl.style.display='block';
    }
    inp?.select();
  }
}

function miStartEdit(field, currentVal){
  miEditField = field;
  const panel = document.getElementById('mi-edit-panel');
  const title = document.getElementById('mi-edit-title');
  const body  = document.getElementById('mi-edit-body');
  const status= document.getElementById('mi-status');
  if(!panel||!body) return;
  status.style.display='none';

  const labels={company:'회사명',name:'담당자 이름',phone:'연락처',email:'이메일',password:'비밀번호'};
  title.textContent = labels[field]+' 수정';

  let fields='';
  if(field==='password'){
    fields=`
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:110px;font-size:12px;color:var(--ink3);flex-shrink:0;">현재 비밀번호</span>
          <input id="mi-cur-pw" type="password" placeholder="현재 비밀번호 입력" class="mi-input">
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:110px;font-size:12px;color:var(--ink3);flex-shrink:0;">새 비밀번호</span>
          <input id="mi-new-val" type="password" placeholder="새 비밀번호 (6자 이상)" class="mi-input">
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:110px;font-size:12px;color:var(--ink3);flex-shrink:0;">비밀번호 확인</span>
          <input id="mi-confirm-pw" type="password" placeholder="새 비밀번호 재입력" class="mi-input">
        </div>
      </div>`;
  } else {
    fields=`
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:110px;font-size:12px;color:var(--ink3);flex-shrink:0;">현재 비밀번호</span>
          <input id="mi-cur-pw" type="password" placeholder="본인 확인을 위해 입력" class="mi-input">
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:110px;font-size:12px;color:var(--ink3);flex-shrink:0;">${labels[field]}</span>
          <input id="mi-new-val" type="${field==='email'?'email':'text'}" value="${currentVal}"
            placeholder="새 ${labels[field]} 입력" class="mi-input">
        </div>
      </div>`;
  }

  body.innerHTML = fields + `
    <div style="display:flex;gap:8px;">
      <button class="mi-save-btn" onclick="miSaveField()">저장</button>
      <button class="mi-cancel-btn" onclick="miCancelEdit()">취소</button>
    </div>`;

  panel.style.display='block';
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  document.getElementById('mi-cur-pw')?.focus();
}

function miCancelEdit(){
  const panel=document.getElementById('mi-edit-panel');
  if(panel) panel.style.display='none';
  miEditField='';
}

function miShowStatus(msg, ok){
  const el=document.getElementById('mi-status');
  if(!el) return;
  el.textContent=msg;
  el.style.display='block';
  el.style.background=ok?'var(--tbg)':'#FEF2F2';
  el.style.color=ok?'var(--teal)':'#DC2626';
  el.style.border='1px solid '+(ok?'#6EE7B7':'#FECACA');
}

async function miSaveField(){
  const sess=JSON.parse(localStorage.getItem('nopro_session')||'null');
  if(!sess) return;
  const curPw=document.getElementById('mi-cur-pw')?.value;
  const newVal=document.getElementById('mi-new-val')?.value?.trim();
  const confirmPw=document.getElementById('mi-confirm-pw')?.value;
  const btn=document.querySelector('.mi-save-btn');

  if(!curPw){ miShowStatus('현재 비밀번호를 입력해주세요.',false); return; }
  if(!newVal){ miShowStatus('새 값을 입력해주세요.',false); return; }
  if(miEditField==='password'&&newVal!==confirmPw){ miShowStatus('새 비밀번호가 일치하지 않습니다.',false); return; }
  if(miEditField==='password'&&newVal.length<6){ miShowStatus('비밀번호는 6자 이상이어야 합니다.',false); return; }

  if(btn){ btn.disabled=true; btn.textContent='저장 중...'; }
  try {
    const reqBody={currentPassword:curPw};
    reqBody[miEditField]=newVal;
    const res = await apiFetch('/auth-update','POST',reqBody);

    let updatedSess={...sess,[miEditField]:newVal};
    if(res && res.session) updatedSess={...sess,...res.session};
    setNoproSession(updatedSess);

    const dispMap={company:'disp-company',name:'disp-name',phone:'disp-phone',email:'disp-email'};
    if(dispMap[miEditField]){
      const el=document.getElementById(dispMap[miEditField]);
      if(el) el.textContent=newVal;
    }

    const labels={company:'회사명',name:'담당자명',phone:'연락처',email:'이메일',password:'비밀번호'};
    admSendNotify('profile_change',{
      company:updatedSess.company||updatedSess.company_name,
      email:updatedSess.email,
      fields:labels[miEditField]||miEditField
    });

    miShowStatus('저장되었습니다!',true);
    setTimeout(()=>{ miCancelEdit(); renderMyInfo(); },1500);

  } catch(e){
    miShowStatus(e.message||'현재 비밀번호가 올바르지 않습니다.',false);
  } finally {
    if(btn){ btn.disabled=false; btn.textContent='저장'; }
  }
}

// ══ 관리자 알림 ══
function admPushAlert(type, title, body){
  const alerts = JSON.parse(localStorage.getItem('nopro_admin_alerts')||'[]');
  alerts.push({type, title, body, time: new Date().toLocaleString('ko-KR')});
  localStorage.setItem('nopro_admin_alerts', JSON.stringify(alerts));
  const unread = parseInt(localStorage.getItem('nopro_admin_alert_unread')||'0') + 1;
  localStorage.setItem('nopro_admin_alert_unread', String(unread));
  admUpdateAlertBadge();
}

function admClearAlerts(){
  localStorage.setItem('nopro_admin_alerts','[]');
  localStorage.setItem('nopro_admin_alert_unread','0');
  admUpdateAlertBadge();
  admPage('alerts');
}

function admUpdateAlertBadge(){
  const badge = document.getElementById('adm-alert-badge');
  if(!badge) return;
  const unread = parseInt(localStorage.getItem('nopro_admin_alert_unread')||'0');
  badge.textContent = unread;
  badge.style.display = unread > 0 ? 'inline' : 'none';
}

function admSendNotify(type, data){
  if(type==='signup'){
    admPushAlert('signup',
      `새 회원 가입: ${data.company}`,
      `담당자: ${data.name} | 이메일: ${data.email} | 연락처: ${data.phone} | 직원수: ${data.size}`
    );
  } else if(type==='profile_change'){
    admPushAlert('change',
      `회원 정보 변경: ${data.company}`,
      `변경 항목: ${data.fields} | 이메일: ${data.email}`
    );
  }
}

// ── 랜딩 서비스 화면 탭 (랜딩페이지 inline script로 이동됨) ──

// ══════════════════════════════════════
// TBM 서명 오버레이 제어
// ══════════════════════════════════════
function openTbmSign(token){
  document.getElementById('tbm-sign-overlay').classList.add('show');
  document.body.style.overflow='hidden';
  if(typeof tbmRenderEmps==='function') tbmRenderEmps();
}
function closeTbmSign(){
  document.getElementById('tbm-sign-overlay').classList.remove('show');
  document.body.style.overflow='';
}
// URL ?tbm=토큰 으로 들어오면 자동 오픈
(function(){
  const p=new URLSearchParams(location.search);
  if(p.has('tbm')) window.addEventListener('DOMContentLoaded',()=>openTbmSign(p.get('tbm')));
})();

// ══ 전역 ESC 핸들러: 열려있는 모달/팝업 중 z-index 최대 것 닫기 ══
// 제외 대상: auth-overlay(로그인 전 진입점), landing-overlay(랜딩페이지 본체)
(function(){
  const EXCLUDE_IDS = new Set(['auth-overlay','landing-overlay','app','sidebar']);
  const isVisible = (el) => {
    if(!el) return false;
    const s = getComputedStyle(el);
    if(s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  document.addEventListener('keydown', (e) => {
    if(e.key !== 'Escape') return;
    // input/textarea에 포커스되어 있고 값이 차 있는 상태면 ESC는 기본 브라우저 동작(포커스 해제)에 맡김
    const ae = document.activeElement;
    if(ae && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA') && ae.value){
      // value 초기화가 아닌 포커스만 날려주기 위해 blur 호출 후 모달은 닫지 않음
      ae.blur();
      return;
    }
    // 후보: id*="modal"/"overlay"/"popup" + .modal/.overlay/.popup 클래스
    const candidates = Array.from(document.querySelectorAll(
      '[id$="-modal"], [id$="-overlay"], #popup'
    )).filter(el => !EXCLUDE_IDS.has(el.id) && isVisible(el));
    if(!candidates.length) return;
    // z-index 큰 순으로 정렬
    candidates.sort((a,b) => {
      const za = parseInt(getComputedStyle(a).zIndex) || 0;
      const zb = parseInt(getComputedStyle(b).zIndex) || 0;
      return zb - za;
    });
    const top = candidates[0];
    // 기존 닫기 버튼이 있으면 우선 클릭 시도 (상태 정리 목적)
    const closeBtn = top.querySelector('[onclick*="display=\'none\'"], [onclick*="closeModal"], .close, .modal-close');
    if(closeBtn){
      closeBtn.click();
    } else {
      top.style.display = 'none';
      top.classList.remove('show','open','active');
    }
    e.preventDefault();
  });
})();

let tbmCurLang='ko';
let tbmShiftF='all',tbmNatF='all',tbmDeptF='all';
let tbmSelectedPerson=null;
let tbmAgrees=[false,false,false,false];
let TBM_SIGNED={};

// 직원 목록 (실제 구현 시 EMPS에서 불러옴)
const TBM_PEOPLE=[
  {n:'김민준',en:'Kim Minjun',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'강민호',en:'Kang Minho',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'한상훈',en:'Han Sanghoon',sh:'야간',na:'내국인',dp:'인천본점'},
  {n:'정지수',en:'Jung Jisu',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'최경숙',en:'Choi Kyungsook',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'홍명숙',en:'Hong Myungsook',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'고준례',en:'Ko Junrye',sh:'야간',na:'내국인',dp:'인천본점'},
  {n:'이경자',en:'Lee Kyungja',sh:'야간',na:'내국인',dp:'인천본점'},
  {n:'이은자',en:'Lee Eunja',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'서정재',en:'Seo Jungjae',sh:'야간',na:'내국인',dp:'인천본점'},
  {n:'신화경',en:'Shin Hwakyung',sh:'야간',na:'내국인',dp:'인천본점'},
  {n:'강선자',en:'Kang Seonja',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'정옥심',en:'Jung Oksim',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'박성숙',en:'Park Sungsook',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'유지수',en:'Yoo Jisu',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'조옥순',en:'Jo Oksoon',sh:'야간',na:'내국인',dp:'인천본점'},
  {n:'이철수',en:'Lee Cheolsu',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'박수진',en:'Park Sujin',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'최지우',en:'Choi Jiwoo',sh:'야간',na:'내국인',dp:'인천본점'},
  {n:'안인자',en:'An Inja',sh:'야간',na:'내국인',dp:'인천본점'},
  {n:'이인숙',en:'Lee Insook',sh:'야간',na:'내국인',dp:'인천본점'},
  {n:'최교숙',en:'Choi Kyosook',sh:'주간',na:'내국인',dp:'인천본점'},
  {n:'왕웨이',en:'Wang Wei',sh:'주간',na:'외국인',dp:'아웃소싱'},
  {n:'Tran Thi Lan',en:'Tran Thi Lan',sh:'야간',na:'외국인',dp:'아웃소싱'},
  {n:'Nguyen Van An',en:'Nguyen Van An',sh:'야간',na:'외국인',dp:'아웃소싱'},
  {n:'Ahmad Farhan',en:'Ahmad Farhan',sh:'주간',na:'외국인',dp:'아웃소싱'},
  {n:'Liu Yang',en:'Liu Yang',sh:'주간',na:'외국인',dp:'아웃소싱'},
  {n:'Mohammed Ali',en:'Mohammed Ali',sh:'야간',na:'외국인',dp:'아웃소싱'},
];

// 초기 서명 상태
['김민준','강민호','한상훈','정지수','홍명숙','이은자','서정재','신화경','강선자','왕웨이'].forEach(n=>{
  TBM_SIGNED[n]={time:`08:${String(Math.floor(Math.random()*29)+1).padStart(2,'0')}`};
});

// 날짜 세팅
(function(){
  const now=new Date();
  const DOW_KO=['일','월','화','수','목','금','토'];
  const DOW_EN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const y=now.getFullYear(),m=now.getMonth()+1,d=now.getDate(),dw=now.getDay();
  const hdrDate=document.getElementById('hdr-date');
  if(hdrDate)hdrDate.textContent=`${y}년 ${m}월 ${d}일 ${DOW_KO[dw]}요일 / ${DOW_EN[dw]}, ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${d}, ${y}`;
  const sdko=document.getElementById('sign-date-ko');
  const sden=document.getElementById('sign-date-en');
  if(sdko)sdko.textContent=`${y}년 ${m}월 ${d}일`;
  if(sden)sden.textContent=`${['January','February','March','April','May','June','July','August','September','October','November','December'][m-1]} ${d}, ${y}`;
})();

// 언어 전환
function tbmSetLang(lang){
  tbmCurLang=lang;
  const overlay=document.getElementById('tbm-sign-overlay');
  if(overlay)overlay.className=lang==='en'?'show lang-en':'show lang-ko';
  document.getElementById('btn-ko').classList.toggle('act',lang==='ko');
  document.getElementById('btn-en').classList.toggle('act',lang==='en');
  tbmRenderEmps();
}

// 스텝 UI
function tbmSetStep(n){
  [1,2,3].forEach(i=>{
    const sn=document.getElementById('sn'+i);
    const sl=document.getElementById('sl'+i);
    if(!sn||!sl)return;
    sn.className='step-num'+(i<n?' done-st':i===n?' act-st':'');
    sl.className='step-lbl'+(i===n?' act-st':'');
    if(i<n) sn.textContent='✓';
    else sn.textContent=i;
  });
}

// 필터
function tbmSetF(group,v,el){
  if(group==='shift') tbmShiftF=v;
  else if(group==='nat') tbmNatF=v;
  else if(group==='dept') tbmDeptF=v;
  const row=el.closest('.filter-row');
  if(row) row.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
  tbmRenderEmps();
}

function tbmClearSrch(){
  document.getElementById('tbm-srch').value='';
  document.getElementById('tbm-srch-clear').style.display='none';
  tbmRenderEmps();
}

// 직원 목록 렌더
function tbmRenderEmps(){
  const srch=(document.getElementById('tbm-srch')||{value:''}).value.trim().toLowerCase();
  const clearEl=document.getElementById('tbm-srch-clear');
  if(clearEl)clearEl.style.display=srch?'block':'none';

  const list=TBM_PEOPLE.filter(p=>{
    if(tbmShiftF!=='all'&&p.sh!==tbmShiftF)return false;
    if(tbmNatF!=='all'&&p.na!==tbmNatF)return false;
    if(tbmDeptF!=='all'&&p.dp!==tbmDeptF)return false;
    if(srch&&!p.n.toLowerCase().includes(srch)&&!p.en.toLowerCase().includes(srch))return false;
    return true;
  });

  const el=document.getElementById('tbm-emp-list');
  if(!el)return;
  if(list.length===0){
    el.innerHTML=`<div class="empty-msg">${tbmCurLang==='ko'?'검색 결과가 없습니다':'No results found'}</div>`;
    return;
  }

  // 미서명 위, 완료 아래
  const wait=list.filter(p=>!TBM_SIGNED[p.n]);
  const done=list.filter(p=>TBM_SIGNED[p.n]);
  const sorted=[...wait,...done];

  el.innerHTML=sorted.map(p=>{
    const isSigned=!!TBM_SIGNED[p.n];
    const initials=(p.en||p.n).split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const isF=p.na==='외국인';
    const nameMain=tbmCurLang==='en'?p.en:p.n;
    const nameSub=tbmCurLang==='en'?p.n:p.en;
    const shKo=p.sh, shEn=p.sh==='주간'?'Day':'Night';
    const naKo=p.na, naEn=p.na==='내국인'?'Korean':'Foreign Worker';
    const subKo=`${shKo} · ${naKo} · ${p.dp}`;
    const subEn=`${shEn} · ${naEn} · ${p.dp}`;
    const subTxt=tbmCurLang==='en'?subEn:subKo;

    if(isSigned){
      return`<div class="emp-item signed-done">
        <div class="emp-avt avt-done">${initials}</div>
        <div class="emp-info">
          <div class="emp-nm" style="color:var(--green);">${nameMain}</div>
          <div class="emp-nm-en">${nameSub}</div>
          <div class="emp-sub">${subTxt}</div>
        </div>
        <div class="done-badge">${tbmCurLang==='ko'?'✓ 서명완료':'✓ Signed'}<br><small>${TBM_SIGNED[p.n].time}</small></div>
      </div>`;
    }
    return`<div class="emp-item" data-n="${p.n}" data-en="${p.en}" onclick="tbmSelectPerson('${p.n}','${p.en}')">
      <div class="emp-avt ${isF?'avt-f':'avt-n'}">${initials}</div>
      <div class="emp-info">
        <div class="emp-nm">${nameMain}</div>
        <div class="emp-nm-en">${nameSub}</div>
        <div class="emp-sub">${subTxt}</div>
      </div>
      <div class="emp-sel-icon">›</div>
    </div>`;
  }).join('');
}

// 이름 선택 → step2
function tbmSelectPerson(nameKo, nameEn){
  tbmSelectedPerson={n:nameKo,en:nameEn};
  document.getElementById('sel-nm-ko').textContent=nameKo;
  document.getElementById('sel-nm-en').textContent=nameEn;
  tbmAgrees=[false,false,false,false];
  [0,1,2,3].forEach(i=>{
    const chk=document.getElementById('chk'+i);
    if(chk){chk.className='agree-chk';chk.closest('.agree-item').classList.remove('checked');}
  });
  // 교육내용 재확인 동적 채우기
  const koTxt=document.getElementById('tbm-ko')?.textContent||'';
  const enEl=document.getElementById('tbm-en');
  const enTxt=enEl?enEl.textContent.replace(/🇺🇸\s*English/,'').trim():'';
  const reviewEl=document.getElementById('tbm-review-content');
  if(reviewEl){
    reviewEl.innerHTML=`<div class="tbm-ko" style="font-size:14px;font-weight:600;color:#0F172A;line-height:1.75">${esc(koTxt)}</div>`
      +(enTxt?`<div class="tbm-en" style="display:block;margin-top:8px;padding-top:8px;border-top:1px dashed #E2E8F0"><div class="tbm-en-lbl">🇺🇸 English</div><span style="font-size:12px;color:#334155;line-height:1.7">${esc(enTxt)}</span></div>`:'');
  }
  // 체크박스1 서브텍스트에 교육내용 요약
  const chk0sub=document.getElementById('chk0-sub');
  if(chk0sub){
    if(tbmCurLang==='en'&&enTxt) chk0sub.textContent=enTxt;
    else chk0sub.textContent=koTxt;
  }
  tbmUpdateSubmitBtn();
  document.getElementById('page1').classList.remove('on');
  document.getElementById('page2').classList.add('on');
  tbmSetStep(2);
  document.getElementById('tbm-sign-overlay').scrollTo(0,0);
}

// 동의 토글
function tbmToggleAgree(idx,el){
  tbmAgrees[idx]=!tbmAgrees[idx];
  const chk=document.getElementById('chk'+idx);
  if(chk)chk.className='agree-chk'+(tbmAgrees[idx]?' on':'');
  el.classList.toggle('checked',tbmAgrees[idx]);
  tbmUpdateSubmitBtn();
}

function tbmUpdateSubmitBtn(){
  const checked=tbmAgrees.filter(a=>a).length;
  const allChecked=checked===4;
  const btn=document.getElementById('btn-submit');
  if(btn){btn.disabled=!allChecked;btn.className=allChecked?'btn-submit ready':'btn-submit';}
  const cnt=document.getElementById('tbm-agree-count');
  if(cnt){cnt.textContent=checked+'/4';cnt.style.color=allChecked?'#059669':'#1D4ED8';}
}

// 서명 제출
function tbmSubmitSign(){
  if(!tbmAgrees.every(a=>a))return;
  const now=new Date();
  const t=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  TBM_SIGNED[tbmSelectedPerson.n]={time:t};
  document.getElementById('popup-name').textContent=
    tbmCurLang==='ko'?tbmSelectedPerson.n:tbmSelectedPerson.en;
  const y=now.getFullYear(),m=now.getMonth()+1,d=now.getDate();
  document.getElementById('popup-time').textContent=
    tbmCurLang==='ko'?`서명 시간: ${t} · ${y}년 ${m}월 ${d}일`:`Signed at ${t} · ${['January','February','March','April','May','June','July','August','September','October','November','December'][m-1]} ${d}, ${y}`;
  document.getElementById('popup').classList.add('show');
  tbmSetStep(3);
}

// 팝업 닫기
function tbmClosePopup(){
  document.getElementById('popup').classList.remove('show');
  tbmSelectedPerson=null;
  document.getElementById('page2').classList.remove('on');
  document.getElementById('page1').classList.add('on');
  document.getElementById('tbm-srch').value='';
  tbmSetStep(1);
  tbmRenderEmps();
  document.getElementById('tbm-sign-overlay').scrollTo(0,0);
}

// 뒤로가기
function tbmGoBack(){
  document.getElementById('page2').classList.remove('on');
  document.getElementById('page1').classList.add('on');
  tbmSetStep(1);
  document.getElementById('tbm-sign-overlay').scrollTo(0,0);
}
