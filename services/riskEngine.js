/**
 * ⚠️ 아래 좌표들은 데모/개발용 예시 좌표입니다.
 * 실서비스에서는 다음 실제 API 응답으로 교체하세요:
 *  - RIVER_MONITOR_POINTS.level  <-  금강홍수통제소 수위 관측 API (관측소별 시계열)
 *  - HISTORICAL_FLOOD_POINTS      <-  행안부 침수흔적도 API (공간데이터)
 *  - ROAD_CONTROL_ZONES           <-  국토교통부 재난상황정보 API (실시간 통제 구간)
 */

// 대전 주요 하천 관측 지점 예시 (갑천/유등천/대전천 합류부 등)
// ⚠️ level 값은 데모용 임시 숫자입니다. 실제 서비스에서는 금강홍수통제소 수위 API 응답으로
//    주기적으로 갱신해야 합니다 (예: 0.2m 이하 0.1, 위험수위 근접 시 0.8~1.0 등으로 정규화).
// roadSegment: 이 지점 근처의 "위험 도로 구간"을 표시하기 위해 자동차 길찾기 API로 실제
//    도로 경로를 조회할 때 쓰는 시작/끝 좌표. (지점을 관통하도록 남북으로 약 700m 간격을 둠)
const RIVER_MONITOR_POINTS = [
  {
    name: '갑천-정림', lat: 36.3372, lng: 127.3652, level: 0.55,
    roadSegment: { from: { lat: 36.3339, lng: 127.3652 }, to: { lat: 36.3405, lng: 127.3652 } },
  },
  {
    name: '갑천-원촌', lat: 36.3689, lng: 127.3611, level: 0.35,
    roadSegment: { from: { lat: 36.3656, lng: 127.3611 }, to: { lat: 36.3722, lng: 127.3611 } },
  },
  {
    name: '유등천-도마', lat: 36.3183, lng: 127.4012, level: 0.7,
    roadSegment: { from: { lat: 36.3150, lng: 127.4012 }, to: { lat: 36.3216, lng: 127.4012 } },
  },
  {
    name: '유등천-대전역인근', lat: 36.3327, lng: 127.4189, level: 0.6,
    roadSegment: { from: { lat: 36.3294, lng: 127.4189 }, to: { lat: 36.3360, lng: 127.4189 } },
  },
  {
    name: '대전천-중구', lat: 36.3256, lng: 127.4258, level: 0.45,
    roadSegment: { from: { lat: 36.3223, lng: 127.4258 }, to: { lat: 36.3289, lng: 127.4258 } },
  },
];

// 과거 침수 이력 지점 예시 (가중치는 침수 빈도/심각도에 비례)
const HISTORICAL_FLOOD_POINTS = [
  {
    lat: 36.3300, lng: 127.3700, weight: 0.6,
    roadSegment: { from: { lat: 36.3267, lng: 127.3700 }, to: { lat: 36.3333, lng: 127.3700 } },
  },
  {
    lat: 36.3400, lng: 127.4100, weight: 0.4,
    roadSegment: { from: { lat: 36.3367, lng: 127.4100 }, to: { lat: 36.3433, lng: 127.4100 } },
  },
];

// 실시간 도로 통제 구간 예시 (반경 내 진입 시 해당 경로는 '통제'로 간주해 회피)
let ROAD_CONTROL_ZONES = [
  // { lat: 36.335, lng: 127.37, radiusM: 300, reason: '하천 범람 통제' }
];

function setRoadControlZones(zones) {
  ROAD_CONTROL_ZONES = zones;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 한 지점의 위험도(0~1, 1이 가장 위험)를 계산.
 * rainfallRisk(0~1)는 기상청 예보 기반 전역 강수 위험도 (weatherService.rainfallRiskFromForecast 결과)
 */
function riskAtPoint(point, rainfallRisk) {
  let risk = 0;

  // 1) 하천 수위 위험 - 가까울수록, 수위가 높을수록 위험 가중
  for (const river of RIVER_MONITOR_POINTS) {
    const dist = haversineMeters(point, river);
    const proximity = Math.max(0, 1 - dist / 1500); // 1.5km 밖이면 영향 없음
    risk += proximity * river.level * 0.5;
  }

  // 2) 과거 침수 이력 가중
  for (const hp of HISTORICAL_FLOOD_POINTS) {
    const dist = haversineMeters(point, hp);
    const proximity = Math.max(0, 1 - dist / 800);
    risk += proximity * hp.weight * 0.3;
  }

  // 3) 강수 위험 - 하천 인근일수록 강수의 영향을 더 크게 반영
  const nearestRiverDist = Math.min(...RIVER_MONITOR_POINTS.map((r) => haversineMeters(point, r)));
  const riverProximityFactor = Math.max(0, 1 - nearestRiverDist / 1500);
  risk += rainfallRisk * (0.2 + riverProximityFactor * 0.3);

  return Math.min(1, risk);
}

/** 통제구간 안에 들어가는지 확인 */
function isBlocked(point) {
  return ROAD_CONTROL_ZONES.some((zone) => haversineMeters(point, zone) <= zone.radiusM);
}

/**
 * 경로(path: [{lat,lng}, ...])의 위험도를 계산.
 * - blocked: 통제구간을 지나면 true (이 경로는 원칙적으로 제외)
 * - riskScore: 경로 전체 평균 위험도 (0~1)
 * - maxRisk: 경로 중 가장 위험한 지점의 위험도
 */
function scoreRoute(path, rainfallRisk) {
  if (!path || path.length === 0) {
    return { blocked: true, riskScore: 1, maxRisk: 1, sampledPoints: [] };
  }

  // 경로가 길 수 있으므로 일정 간격으로 샘플링 (최대 60개 지점)
  const step = Math.max(1, Math.floor(path.length / 60));
  const sampled = [];
  let blocked = false;
  let sum = 0;
  let max = 0;

  for (let i = 0; i < path.length; i += step) {
    const p = path[i];
    if (isBlocked(p)) blocked = true;
    const r = riskAtPoint(p, rainfallRisk);
    sum += r;
    max = Math.max(max, r);
    sampled.push({ ...p, risk: r });
  }

  return {
    blocked,
    riskScore: sum / sampled.length,
    maxRisk: max,
    sampledPoints: sampled,
  };
}

/**
 * 여러 경로 후보를 위험도 기준으로 정렬해 반환.
 * 통제구간을 지나는 경로는 최우선으로 배제(맨 뒤로 정렬)하고,
 * 나머지는 riskScore 오름차순(안전한 순)으로 정렬.
 */
function rankRoutes(routes, rainfallRisk) {
  return routes
    .map((route) => ({ ...route, ...scoreRoute(route.path, rainfallRisk) }))
    .sort((a, b) => {
      if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
      return a.riskScore - b.riskScore;
    });
}

module.exports = {
  RIVER_MONITOR_POINTS,
  HISTORICAL_FLOOD_POINTS,
  setRoadControlZones,
  riskAtPoint,
  scoreRoute,
  rankRoutes,
};