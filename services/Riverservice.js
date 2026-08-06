const fetch = require('node-fetch');

/**
 * 한강홍수통제소(HRFCO) 오픈API — 이름은 "한강"이지만 전국 통합 수문 데이터를 제공한다.
 * (공식 안내: "낙동강, 금강, 영산강 권역의 자료는 한강 권역의 자료보다 늦게 수집됩니다"
 *  → 금강 권역(대전 포함)도 이 API로 커버됨)
 *
 * .env에 HRFCO_API_KEY 필요. 발급: https://www.hrfco.go.kr/web/openapiPage/openApi.do
 * (신청 후 이메일 인증 링크를 눌러야 키가 활성화됨 — Gmail/네이버/다음/한메일은 메일이
 *  안 갈 수 있다고 공식 안내에 명시되어 있으니 다른 메일도 안 오면 학교 메일 등으로 재시도)
 */
const BASE_URL = 'http://api.hrfco.go.kr';

/**
 * 대전 갑천/유등천/대전천 실제 수위관측소 매칭.
 * ⚠️ HRFCO API 응답에는 하천명이 따로 없어서, 좌표 근접도 + 다리 이름으로 매칭했음.
 * ⚠️ 원래 riskEngine.js의 '유등천-대전역인근'은 실제로는 대전역 근처가 대전천 유역이라
 *    '대전천-대전역인근'으로 이름을 바로잡음 (실제 관측소 좌표 기준 재확인).
 * 나중에 지도로 직접 확인해서 더 정확한 관측소로 바꿔도 됨.
 */
const STATIONS = [
  { name: '갑천-정림', wlobscd: '3009670', obsName: '만년교' },
  { name: '갑천-원촌', wlobscd: '3009680', obsName: '원촌교' },
  { name: '유등천-도마', wlobscd: '3009630', obsName: '복수교' },
  { name: '대전천-대전역인근', wlobscd: '3009645', obsName: '철갑교' },
  { name: '대전천-중구', wlobscd: '3009640', obsName: '인창교' },
];

// 관측소 메타정보(임계수위 등)는 자주 안 바뀌므로 1시간 캐싱
let stationInfoCache = null;
let stationInfoCacheTime = 0;
const STATION_INFO_CACHE_MS = 60 * 60 * 1000;

async function getStationInfoMap() {
  const now = Date.now();
  if (stationInfoCache && now - stationInfoCacheTime < STATION_INFO_CACHE_MS) {
    return stationInfoCache;
  }

  const apiKey = process.env.HRFCO_API_KEY;
  if (!apiKey) throw new Error('HRFCO_API_KEY가 .env에 설정되지 않았습니다.');

  const res = await fetch(`${BASE_URL}/${apiKey}/waterlevel/info.json`);
  const json = await res.json();
  const map = {};
  for (const item of json.content || []) {
    map[item.wlobscd] = item;
  }
  stationInfoCache = map;
  stationInfoCacheTime = now;
  return map;
}

/**
 * 원본 수위(m)를 0~1 위험도로 정규화.
 * HRFCO가 관측소별로 제공하는 공식 기준수위를 그대로 사용:
 *   attwl(관심수위) ~ srswl(심각수위) 구간을 0~1로 매핑.
 * 기준수위 정보가 없는 관측소는 null 반환 (임의로 0 처리하지 않음 — 데이터 없다고 "안전"으로
 * 잘못 표시하는 게 더 위험하므로, 이 경우 riskEngine에서 기존 값을 유지하도록 함).
 */
function normalizeLevel(wl, attwl, srswl) {
  if (isNaN(wl) || isNaN(attwl) || isNaN(srswl) || srswl <= attwl) return null;
  const level = (wl - attwl) / (srswl - attwl);
  return Math.max(0, Math.min(1, level));
}

/**
 * 등록된 대전 관측소들의 실시간 수위를 조회해서
 * [{ name, wlobscd, obsName, wl, level, observedAt }, ...] 형태로 반환.
 * 개별 관측소 조회가 실패해도 나머지는 계속 진행 (level: null로 표시).
 */
async function getLiveRiverLevels() {
  const apiKey = process.env.HRFCO_API_KEY;
  if (!apiKey) throw new Error('HRFCO_API_KEY가 .env에 설정되지 않았습니다.');

  const infoMap = await getStationInfoMap();

  const results = await Promise.all(
    STATIONS.map(async (station) => {
      try {
        const res = await fetch(`${BASE_URL}/${apiKey}/waterlevel/list/10M/${station.wlobscd}.json`);
        const json = await res.json();
        const latest = (json.content || [])[0];
        const info = infoMap[station.wlobscd];

        if (!latest) {
          return { ...station, level: null, error: '관측 데이터 없음' };
        }

        const wl = parseFloat(latest.wl);
        const attwl = info ? parseFloat(info.attwl) : NaN;
        const srswl = info ? parseFloat(info.srswl) : NaN;
        const level = normalizeLevel(wl, attwl, srswl);

        return {
          ...station,
          wl,
          attwl: isNaN(attwl) ? null : attwl,
          srswl: isNaN(srswl) ? null : srswl,
          level, // null이면 riskEngine에서 기존 값 유지
          observedAt: latest.ymdhm,
        };
      } catch (e) {
        console.warn(`HRFCO 수위 조회 실패 (${station.name}, 관측소 ${station.wlobscd}):`, e.message);
        return { ...station, level: null, error: e.message };
      }
    })
  );

  return results;
}

module.exports = { getLiveRiverLevels, STATIONS };