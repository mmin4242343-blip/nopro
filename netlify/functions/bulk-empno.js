import { supabase } from './_shared/supabase.js';
import { ok, err, options } from './_shared/auth.js';
import { decryptEmps, encryptEmps } from './_shared/crypto.js';
import jwt from 'jsonwebtoken';

// 사번코드 매핑 (이름 → 신규사번)
const MAPPING = {
  "오현숙":"12013AA001","이길호":"12013AA002","배수연":"12013AA003","김인자":"12013AA004",
  "김영웅":"12013AA005","윤정희":"12013AA006","김종훈":"12013AA007","이예진":"12013AA008",
  "정혜림":"12013AA009","정지수":"12013AA010","최경숙":"12013AB001","박성숙":"12013AB002",
  "강선자":"12013AB003","정옥심":"12013AB004","서정재":"12013AB005","신화경":"12013AB006",
  "유지순":"12013AB007","조옥순":"12013AB008","최교숙":"12013AB009","홍명숙":"12013AB010",
  "고준례":"12013AB011","이경자":"12013AB012","이은자":"12013AB013","김연숙":"12013AB014",
  "안인자":"12013AB015","이인숙":"12013AB016","김지왕":"12013AB017","김도원":"12013AB018",
  "오금옥":"12013AB019","이종규":"12013AB020","노창길":"12013AB021","이삼주":"12013AB022",
  "김용선":"12013AB023","신현창":"12013AB024","이승철":"12013AB025","윤성혁":"12013AB026",
  "윤강석":"12013AB027","이달영":"12013AB028","노효순":"12013AB029","김종선":"12013AB030",
  "주복실":"12013AB031","박광희":"12013AB032","정명희":"12013AB033","이연숙":"12013AB034",
  "문봉인":"12013AB035","조영자":"12013AB036","지익주":"12013AB037","염광일":"12013AB038",
  "나홈":"12013AB039","오마르":"12013AB040","아밋":"12013AB041","아이작":"12013AB042",
  "트레보":"12013AB043","프릭":"12013AB044","탁엘":"12013AB045","여만":"12013AB046",
  "모하메드":"12013AB047","장동현":"12013AA011","이혜원":"12013AA012","이광규":"12013AB048",
  "이열호":"12013AA013","장윤성":"12013AA014","람비":"12013AB049","나래쉬":"12013AB050",
  "폴":"12013AB051","로미":"12013AB052","메리클레어":"12013AB053","라작":"12013AB054",
  "아센":"12013AB055","모니카":"12013AB056","브라이트":"12013AB057","라울":"12013AB058",
  "신상희":"12013AB059","조나단":"12013AD001","존":"12013AD002","만자":"12013AD003",
  "앨리스":"12013AD004","안지":"12013AD005","알리안":"12013AD006","케니":"12013AD007",
  "피비":"12013AD008","칸테":"12013AD009","에릭":"12013AD010","프린스":"12013AD011",
  "로버트":"12013AD012","빅터":"12013AD013","마무드":"12013AD014","김지연":"12013AB060",
  "장감이":"12013AB061","샌딥":"12013AB062","슈드":"12013AD015","프린스쿠마르":"12013AD016",
  "요거쉬":"12013AB063","티기스트":"12013AB064","알라유":"12013AB065","아게리투":"12013AB066",
  "아타카":"12013AB067","무자미니":"12013AB068","체레":"12013AB069","메이라프":"12013AB070",
  "임마누엘":"12013AB071","세카":"12013AB072","미야탯몬":"12013AB073","에이미":"12013AB074",
  "조엘":"12013AB075","캐서린":"12013AB076","알렉산드라":"12013AB077","사피":"12013AB078",
  "길버트2":"12013AB079","리빙스톤":"12013AB080","압둘라":"12013AB081","타므라트":"12013AB082",
  "무케쉬":"12013AB083","산드라":"12013AB084","리아":"12013AB085","아슈":"12013AB086",
  "아이만":"12013AB087","몰루게타":"12013AD017","옴":"12013AB088","라찬드":"12013AD018",
  "찰스":"12013AD019","밀리":"12013AD020","치마":"12013AD021","길버트1":"12013AD022",
  "래디쉬암":"12013AD023","모리스":"12013AD024","부르스":"12013AD025","제프리":"12013AD026",
  "미젠":"12013AD027","아부나임":"12013AD028","합테셀라즈":"12013AD029","마리아":"12013AD030",
  "엔지":"12013AD031","젠":"12013AD032","파스칼":"12013AD033","셀레만":"12013AD034",
  "모이세":"12013AD035","아무자":"12013AD036","루감바":"12013AD037","아짓":"12013AD038",
  "물루게타":"12013AB089"
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);
  if (event.httpMethod !== 'POST') return err(405, 'POST only', event);

  try {
    // 관리자 인증 확인
    const body = event.body ? JSON.parse(event.body) : {};
    const companyId = body.companyId;
    if (!companyId) return err(400, 'companyId 필요', event);

    // JWT 검증 (쿠키 또는 Authorization 헤더)
    let token = null;
    const cookies = event.headers.cookie || '';
    const match = cookies.match(/nopro_token=([^;]+)/);
    if (match) token = match[1];
    if (!token) {
      const auth = event.headers.authorization || '';
      if (auth.startsWith('Bearer ')) token = auth.slice(7);
    }
    if (!token) return err(401, '인증 필요', event);

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.role !== 'admin') return err(403, '관리자만 가능', event);

    // 1) 현재 emps 로드
    const { data: row, error: loadErr } = await supabase
      .from('company_data')
      .select('data_value')
      .eq('company_id', companyId)
      .eq('data_key', 'emps')
      .single();

    if (loadErr || !row) return err(500, 'emps 로드 실패: ' + (loadErr?.message || 'no data'), event);

    let emps = JSON.parse(row.data_value);

    // 복호화 (주민번호)
    emps = decryptEmps(emps);

    // 2) 이름 매칭으로 empNo만 업데이트
    let updated = 0;
    let notFound = [];
    const mappingNames = Object.keys(MAPPING);

    for (const emp of emps) {
      const name = (emp.name || '').trim();
      if (MAPPING[name]) {
        emp.empNo = MAPPING[name];
        updated++;
      }
    }

    // 매핑에 있지만 DB에 없는 이름 찾기
    const dbNames = emps.map(e => (e.name || '').trim());
    for (const mName of mappingNames) {
      if (!dbNames.includes(mName)) notFound.push(mName);
    }

    // 3) 암호화 후 저장
    const encrypted = encryptEmps(emps);
    const dataStr = JSON.stringify(encrypted);

    const { error: saveErr } = await supabase
      .from('company_data')
      .upsert({
        company_id: companyId,
        data_key: 'emps',
        data_value: dataStr,
        updated_at: new Date().toISOString()
      }, { onConflict: 'company_id,data_key' });

    if (saveErr) return err(500, '저장 실패: ' + saveErr.message, event);

    return ok({
      message: '사번 일괄 업데이트 완료',
      totalEmps: emps.length,
      updated,
      notFoundInDB: notFound
    }, event);

  } catch (e) {
    return err(500, e.message, event);
  }
};
