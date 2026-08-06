/**
 * ⚠️ HISTORICAL_FLOOD_POINTS/ROAD_CONTROL_ZONES는 아직 데모 좌표 (실서비스: 침수흔적도/재난상황정보 API로 교체).
 * RIVER_MONITOR_POINTS.level은 riverService.js가 HRFCO 실시간 수위로 갱신함(초기값은 임시 기본값).
 */

// 대전 주요 하천 관측 지점 (실제 HRFCO 수위관측소 매칭). roadSegment: 위험구간을 실제 도로로 표시할 때 쓰는 남북 700m 구간
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

/** liveData로 RIVER_MONITOR_POINTS[i].level 갱신. level이 null(조회 실패)이면 기존값 유지 (없다고 "안전"으로 오판 방지) */
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
 * 경로 좌표만으로 유턴 지점 탐지 (카카오 guides 데이터 불필요): 앞뒤 15m 지점의 방위각 차이가
 * 150도 이상이면 후보로 보되, 실제로 위치도 가까워야(=제자리 회전) 진짜 유턴으로 인정한다.
 * (그냥 각도만 보면 "우회전 후 바로 또 회전" 같은 경우도 유턴으로 오탐될 수 있어서 이 조건이 필요함)
 */
function detectUTurns(path) {
  const LOOKAROUND_M = 15;
  const U_TURN_ANGLE_DEG = 150;
  const NET_DISPLACEMENT_MAX_M = 18; // 진짜 유턴이면 앞뒤 지점이 거의 같은 자리여야 함
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
    if (angleDiff(inBearing, outBearing) < U_TURN_ANGLE_DEG) continue;

    // 각도만으론 "우회전 후 바로 또 회전"도 유턴처럼 보일 수 있어, 실제 위치도 가까운 경우만 인정
    if (haversineMeters(before, after) > NET_DISPLACEMENT_MAX_M) continue;

    candidates.push(path[i]);
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