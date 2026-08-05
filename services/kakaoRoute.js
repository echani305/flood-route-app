const fetch = require('node-fetch');

const CAR_DIRECTIONS_URL = 'https://apis-navi.kakaomobility.com/v1/directions';
const WALK_URL = 'https://dapi.kakao.com/v2/routing/walk';
const BICYCLE_URL = 'https://dapi.kakao.com/v2/routing/bicycle';
const TRANSIT_URL = 'https://dapi.kakao.com/v2/routing/publictraffic';

function authHeader() {
  const restKey = process.env.KAKAO_REST_API_KEY;
  if (!restKey) throw new Error('KAKAO_REST_API_KEY가 .env에 설정되지 않았습니다.');
  return { Authorization: `KakaoAK ${restKey}` };
}

/**
 * 카카오 길찾기류 API의 공통 응답 형태(routes[].summary + sections[].roads[].vertexes)를
 * { distance, duration, path } 배열로 변환.
 * 자동차 API에서 검증된 형태이며, 도보/자전거 API도 같은 "카카오맵 API" 패밀리라 동일한 구조일
 * 가능성이 높아 재사용합니다. 실제 응답 구조가 다르면 이 함수만 고치면 됩니다.
 */
function parseStandardRoutes(json) {
  return (json.routes || [])
    .filter((r) => r.result_code === 0)
    .map((route) => {
      const path = [];
      for (const section of route.sections || []) {
        for (const road of section.roads || []) {
          const v = road.vertexes || [];
          for (let i = 0; i < v.length; i += 2) {
            path.push({ lng: v[i], lat: v[i + 1] });
          }
        }
      }
      return {
        distance: route.summary?.distance ?? 0,
        duration: route.summary?.duration ?? 0,
        path,
      };
    });
}

/** 카카오모빌리티 자동차 길찾기 API 호출 (검증된 API). */
async function getCarRoutes(origin, destination, { waypoints = [] } = {}) {
  const params = new URLSearchParams({
    origin: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
    priority: 'RECOMMEND',
    alternatives: 'true', // 대안 경로 포함 -> 위험도 비교 후 더 안전한 경로 선택
    road_details: 'false',
  });

  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.map((w) => `${w.lng},${w.lat}`).join('|'));
  }

  const res = await fetch(`${CAR_DIRECTIONS_URL}?${params.toString()}`, { headers: authHeader() });
  if (!res.ok) {
    throw new Error(`카카오모빌리티 자동차 길찾기 오류 (${res.status}): ${await res.text()}`);
  }
  return parseStandardRoutes(await res.json());
}

/**
 * 도보 길찾기 (2026-07-21 신규 카카오맵 API).
 * 파라미터명 확인됨: start_x, start_y(출발지 경도/위도), end_x, end_y(도착지 경도/위도)
 */
async function getWalkRoutes(origin, destination) {
  const params = new URLSearchParams({
    start_x: origin.lng,
    start_y: origin.lat,
    end_x: destination.lng,
    end_y: destination.lat,
  });
  const res = await fetch(`${WALK_URL}?${params.toString()}`, { headers: authHeader() });
  if (!res.ok) {
    throw new Error(`도보 길찾기 API 오류 (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  const routes = parseStandardRoutes(json);
  if (routes.length === 0) {
    // 표준 형태로 파싱이 안 됨 -> 실제 응답 구조를 서버 콘솔에 출력해서 확인
    console.warn('[도보] 파싱 결과가 비어있습니다. 실제 응답 구조:');
    console.warn(JSON.stringify(json).slice(0, 3000));
  }
  return routes;
}

/** 자전거 길찾기 (2026-07-21 신규 카카오맵 API). 도보와 동일한 파라미터 형식. */
async function getBicycleRoutes(origin, destination) {
  const params = new URLSearchParams({
    start_x: origin.lng,
    start_y: origin.lat,
    end_x: destination.lng,
    end_y: destination.lat,
  });
  const res = await fetch(`${BICYCLE_URL}?${params.toString()}`, { headers: authHeader() });
  if (!res.ok) {
    throw new Error(`자전거 길찾기 API 오류 (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  const routes = parseStandardRoutes(json);
  if (routes.length === 0) {
    console.warn('[자전거] 파싱 결과가 비어있습니다. 실제 응답 구조:');
    console.warn(JSON.stringify(json).slice(0, 3000));
  }
  return routes;
}

/**
 * 대중교통 길찾기 (2026-07-21 신규 카카오맵 API).
 * 도보-대중교통-도보가 섞인 다구간 응답이라 자동차/도보 API와 구조가 다를 가능성이 높습니다.
 * 표준 파싱을 먼저 시도하고, 실패하면 서버 콘솔에 원본 응답을 출력해 디버깅할 수 있게 합니다.
 */
async function getTransitRoutes(origin, destination) {
  const params = new URLSearchParams({
    start_x: origin.lng,
    start_y: origin.lat,
    end_x: destination.lng,
    end_y: destination.lat,
  });
  const res = await fetch(`${TRANSIT_URL}?${params.toString()}`, { headers: authHeader() });
  if (!res.ok) {
    throw new Error(`대중교통 길찾기 API 오류 (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();

  const standard = parseStandardRoutes(json);
  if (standard.some((r) => r.path.length > 0)) return standard;

  console.warn('[대중교통] 표준 형태로 경로를 못 찾았습니다. 실제 응답 구조를 확인하세요:');
  console.warn(JSON.stringify(json).slice(0, 2000));
  return [];
}

/** 이동수단(mode)에 맞는 경로 조회 함수로 위임. */
async function getRoutes(mode, origin, destination) {
  switch (mode) {
    case 'walk':
      return getWalkRoutes(origin, destination);
    case 'bicycle':
      return getBicycleRoutes(origin, destination);
    case 'transit':
      return getTransitRoutes(origin, destination);
    case 'car':
    default:
      return getCarRoutes(origin, destination);
  }
}

module.exports = { getCarRoutes, getWalkRoutes, getBicycleRoutes, getTransitRoutes, getRoutes };