const fetch = require('node-fetch');

/**
 * 한국환경공단_에어코리아 대기오염정보 API (시도별 실시간 측정정보).
 * data.go.kr에서 별도로 "활용신청" 필요 — 승인되면 기존 DATA_GO_KR_SERVICE_KEY 그대로 재사용 가능
 * (기상청 키랑 같은 data.go.kr 계정 키지만, 데이터셋마다 활용신청이 따로 필요함).
 * 문서: https://www.data.go.kr/data/15073861/openapi.do
 *
 * 정확한 특정 좌표 대신 "대전" 시도 단위 평균을 씀 — 미세먼지는 홍수 위험도와 달리 동네 단위로
 * 크게 차이 나지 않고, 좌표->관측소 매칭까지 하기엔 시간 대비 실익이 적어서 단순하게 감.
 */
const BASE_URL = 'http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty';

const GRADE_LABEL = { 1: '좋음', 2: '보통', 3: '나쁨', 4: '매우나쁨' };

async function getDaejeonAirQuality() {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!serviceKey) throw new Error('DATA_GO_KR_SERVICE_KEY가 .env에 설정되지 않았습니다.');

  const params = new URLSearchParams({
    serviceKey,
    returnType: 'json',
    numOfRows: '20',
    pageNo: '1',
    sidoName: '대전',
    ver: '1.3',
  });

  const res = await fetch(`${BASE_URL}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`에어코리아 대기오염정보 API 오류 (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  const header = json?.response?.header;
  if (header && header.resultCode !== '00') {
    throw new Error(`에어코리아 API 응답 오류 (${header.resultCode}): ${header.resultMsg}`);
  }

  const items = json?.response?.body?.items || [];
  // 관측소마다 값이 조금씩 다르므로, 숫자 값이 있는 것들의 평균을 대전 대표값으로 사용
  const pm10Values = items.map((i) => parseFloat(i.pm10Value)).filter((v) => !isNaN(v));
  const pm25Values = items.map((i) => parseFloat(i.pm25Value)).filter((v) => !isNaN(v));
  const pm10Grades = items.map((i) => parseInt(i.pm10Grade, 10)).filter((v) => !isNaN(v));
  const pm25Grades = items.map((i) => parseInt(i.pm25Grade, 10)).filter((v) => !isNaN(v));

  const avg = (arr) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const worstGrade = (arr) => (arr.length > 0 ? Math.max(...arr) : null); // 등급 숫자가 클수록 나쁨 -> 최댓값 = 가장 나쁜 상태

  const pm10Grade = worstGrade(pm10Grades);
  const pm25Grade = worstGrade(pm25Grades);

  return {
    pm10Value: avg(pm10Values),
    pm10Grade,
    pm10Label: pm10Grade ? GRADE_LABEL[pm10Grade] : null,
    pm25Value: avg(pm25Values),
    pm25Grade,
    pm25Label: pm25Grade ? GRADE_LABEL[pm25Grade] : null,
    stationCount: items.length,
  };
}

module.exports = { getDaejeonAirQuality };