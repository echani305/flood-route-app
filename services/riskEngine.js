/**
 * ⚠️ HISTORICAL_FLOOD_POINTS / ROAD_CONTROL_ZONES는 아직 데모/개발용 예시 좌표입니다.
 * 실서비스에서는 다음 실제 API 응답으로 교체하세요:
 *  - HISTORICAL_FLOOD_POINTS      <-  행안부 침수흔적도 API (공간데이터)
 *  - ROAD_CONTROL_ZONES           <-  국토교통부 재난상황정보 API (실시간 통제 구간)
 *
 * RIVER_MONITOR_POINTS.level 은 더 이상 데모 값이 아니라, services/riverService.js가
 * HRFCO(한강홍수통제소) 오픈API의 실제 수위를 가져와 updateRiverLevels()로 갱신합니다.
 * (초기값은 API 응답이 오기 전 잠깐 쓰이는 안전한 기본값일 뿐입니다.)
 */

// 대전 주요 하천 관측 지점 (실제 HRFCO 수위관측소와 매칭됨 — services/riverService.js 참고)
// lat/lng: 실제 관측소 좌표. level: 초기 기본값(서버 시작 직후 API 응답 오기 전까지만 사용).
// roadSegment: 이 지점 근처의 "위험 도로 구간"을 표시하기 위해 자동차 길찾기 API로 실제
//    도로 경로를 조회할 때 쓰는 시작/끝 좌표. (지점을 관통하도록 남북으로 약 700m 간격을 둠)
const RIVER_MONITOR_POINTS = [
  {
    name: '갑천-정림', lat: 36.3517, lng: 127.3497, level: 0.3,
    roadSegment: { from: { lat: 36.3484, lng: 127.3497 }, to: { lat: 36.3550, lng: 127.3497 } },
  },
  {
    name: '갑천-원촌', lat: 36.3783, lng: 127.4100, level: 0.3,
    roadSegment: { from: { lat: 36.3750, lng: 127.4100 }, to: { lat: 36.3816, lng: 127.4100 } },
  },
  {
    name: '유등천-도마', lat: 36.2992, lng: 127.3844, level: 0.3,
    roadSegment: { from: { lat: 36.2959, lng: 127.3844 }, to: { lat: 36.3025, lng: 127.3844 } },
  },
  {
    name: '대전천-대전역인근', lat: 36.3350, lng: 127.4381, level: 0.3,
    roadSegment: { from: { lat: 36.3317, lng: 127.4381 }, to: { lat: 36.3383, lng: 127.4381 } },
  },
  {
    name: '대전천-중구', lat: 36.3236, lng: 127.4344, level: 0.3,
    roadSegment: { from: { lat: 36.3203, lng: 127.4344 }, to: { lat: 36.3269, lng: 127.4344 } },
  },
];

/**
 * riverService.getLiveRiverLevels()의 결과로 RIVER_MONITOR_POINTS[i].level을 갱신.
 * level이 null인 항목(조회 실패/기준수위 정보 없음)은 건드리지 않고 기존 값을 유지함
 * — "데이터를 못 받았다"를 "안전하다(0)"로 잘못 표시하지 않기 위함.
 */
function updateRiverLevels(liveData) {
  if (!Array.isArray(liveData)) return;
  for (const live of liveData) {
    if (live.level === null || live.level === undefined) continue;
    const point = RIVER_MONITOR_POINTS.find((p) => p.name === live.name);
    if (point) point.level = live.level;
  }
}

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

function bearingBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleDiff(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * 경로(path)에서 방향이 거의 반대로 꺾이는 지점(유턴)을 찾는다.
 * - 카카오 API의 guides(안내 문구) 데이터에 의존하지 않고, 우리가 이미 갖고 있는 좌표(path)만으로
 *   기하학적으로 판단한다: 각 지점 앞뒤로 약 15m 떨어진 지점과 비교해 진입 방위각과 진출 방위각의
 *   차이가 150도 이상이면 유턴으로 본다.
 * - 실제 유턴 구간은 곡선이라 후보가 여러 개 연달아 잡히므로, 30m 이내로 가까운 후보는 하나로 묶는다.
 */
function detectUTurns(path) {
  const LOOKAROUND_M = 15;
  const U_TURN_ANGLE_DEG = 150;
  const CLUSTER_DIST_M = 30;

  if (!path || path.length < 3) return [];

  const cumDist = [0];
  for (let i = 1; i < path.length; i++) {
    cumDist.push(cumDist[i - 1] + haversineMeters(path[i - 1], path[i]));
  }

  function findPointAtOffset(i, offsetM) {
    const target = cumDist[i] + offsetM;
    if (offsetM < 0) {
      for (let j = i; j >= 0; j--) if (cumDist[j] <= target) return path[j];
      return null; // 경로 시작 근처라 뒤쪽 비교 지점이 없음
    }
    for (let j = i; j < path.length; j++) if (cumDist[j] >= target) return path[j];
    return null; // 경로 끝 근처라 앞쪽 비교 지점이 없음
  }

  const candidates = [];
  for (let i = 1; i < path.length - 1; i++) {
    const before = findPointAtOffset(i, -LOOKAROUND_M);
    const after = findPointAtOffset(i, LOOKAROUND_M);
    if (!before || !after) continue;

    const inBearing = bearingBetween(before, path[i]);
    const outBearing = bearingBetween(path[i], after);
    if (angleDiff(inBearing, outBearing) >= U_TURN_ANGLE_DEG) {
      candidates.push(path[i]);
    }
  }

  const clustered = [];
  for (const c of candidates) {
    const near = clustered.some((g) => haversineMeters(g, c) <= CLUSTER_DIST_M);
    if (!near) clustered.push(c);
  }

  return clustered.map(({ lat, lng }) => ({ lat, lng }));
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
    .map((route) => ({
      ...route,
      ...scoreRoute(route.path, rainfallRisk),
      uTurns: detectUTurns(route.path),
    }))
    .sort((a, b) => {
      if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
      return a.riskScore - b.riskScore;
    });
}

module.exports = {
  RIVER_MONITOR_POINTS,
  HISTORICAL_FLOOD_POINTS,
  setRoadControlZones,
  updateRiverLevels,
  riskAtPoint,
  scoreRoute,
  rankRoutes,
};