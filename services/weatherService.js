const fetch = require('node-fetch');

const BASE_URL = 'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';

// 기상청 단기예보는 3시간 단위로 발표됩니다. 가장 최근 발표 시각을 계산합니다.
const BASE_TIMES = ['0200', '0500', '0800', '1100', '1400', '1700', '2000', '2300'];

function getLatestBaseDateTime(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000 - now.getTimezoneOffset() * 60 * 1000);
  const hh = kst.getUTCHours();
  const mm = kst.getUTCMinutes();
  const nowMinutes = hh * 60 + mm;

  let chosen = null;
  let baseDate = kst;
  for (let i = BASE_TIMES.length - 1; i >= 0; i--) {
    const [h, m] = [parseInt(BASE_TIMES[i].slice(0, 2)), parseInt(BASE_TIMES[i].slice(2))];
    // 발표 후 API 반영까지 약 10분 여유
    if (nowMinutes >= h * 60 + m + 10) {
      chosen = BASE_TIMES[i];
      break;
    }
  }
  if (!chosen) {
    // 오늘 첫 발표(02:00) 이전이면 전날 23:00 자료 사용
    chosen = '2300';
    baseDate = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
  }

  const yyyy = baseDate.getUTCFullYear();
  const mm2 = String(baseDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(baseDate.getUTCDate()).padStart(2, '0');
  return { base_date: `${yyyy}${mm2}${dd}`, base_time: chosen };
}

/**
 * 특정 격자(nx, ny)의 단기예보를 조회합니다.
 * nx, ny는 기상청 격자 좌표계 값입니다. (위경도 그대로 넣으면 안 됨 — 별도 변환 필요)
 * 대전 시청 부근 참고값: nx=67, ny=100
 */
async function getVilageForecast(nx, ny) {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!serviceKey) throw new Error('DATA_GO_KR_SERVICE_KEY가 .env에 설정되지 않았습니다.');

  const { base_date, base_time } = getLatestBaseDateTime();
  const params = new URLSearchParams({
    serviceKey,
    numOfRows: '1000',
    pageNo: '1',
    dataType: 'JSON',
    base_date,
    base_time,
    nx: String(nx),
    ny: String(ny),
  });

  const res = await fetch(`${BASE_URL}?${params.toString()}`);
  const json = await res.json();
  const items = json?.response?.body?.items?.item || [];

  // 항목을 카테고리별로 정리 (RN1: 1시간 강수량, PTY: 강수형태, POP: 강수확률)
  const summary = {};
  for (const it of items) {
    const key = `${it.fcstDate}_${it.fcstTime}`;
    if (!summary[key]) summary[key] = { date: it.fcstDate, time: it.fcstTime };
    summary[key][it.category] = it.fcstValue;
  }

  return Object.values(summary).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/**
 * 앞으로 3시간 이내 강수량(RN1, mm) 최댓값을 대략적인 "강수 위험 점수(0~1)"로 환산합니다.
 * RN1 값은 "1mm 미만", "30~50", "50 이상" 같은 문자열로 오는 경우가 있어 숫자만 추출합니다.
 */
function rainfallRiskFromForecast(forecastItems) {
  const next3h = forecastItems.slice(0, 1); // 가장 가까운 예보 슬롯
  let maxMm = 0;
  for (const item of next3h) {
    const raw = item.RN1 || '0';
    const num = parseFloat(String(raw).replace(/[^\d.]/g, ''));
    if (!isNaN(num)) maxMm = Math.max(maxMm, num);
  }
  // 0mm -> 0, 10mm -> 0.3, 30mm -> 0.7, 50mm+ -> 1.0 (간단한 구간 매핑, 필요시 조정)
  if (maxMm <= 0) return 0;
  if (maxMm < 10) return 0.2 + (maxMm / 10) * 0.1;
  if (maxMm < 30) return 0.3 + ((maxMm - 10) / 20) * 0.4;
  if (maxMm < 50) return 0.7 + ((maxMm - 30) / 20) * 0.3;
  return 1.0;
}

module.exports = { getVilageForecast, rainfallRiskFromForecast, getLatestBaseDateTime };
