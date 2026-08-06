const fetch = require('node-fetch');

/**
 * ITS 국가교통정보센터 재난상황정보 API (침수/하천범람/지반침하/산불로 인한 도로 통제).
 * 문서: https://www.its.go.kr/opendata/opendataList?service=disaster
 * .env에 ROAD_DISASTER_API_KEY 필요.
 */
const DISASTER_URL = 'https://openapi.its.go.kr:9443/disasterInfo';

// 대전 지역만 조회 (여유 있게 잡은 사각형 범위)
const DAEJEON_BBOX = { minX: 127.25, maxX: 127.55, minY: 36.15, maxY: 36.50 };

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** "128.95 37.33,128.93 37.34,..." (경도 위도, 콤마로 여러 점) -> [{lat,lng}, ...] */
function parseLocationInfo(locationInfoStr) {
  if (!locationInfoStr) return [];
  return locationInfoStr
    .split(',')
    .map((pair) => {
      const [lngStr, latStr] = pair.trim().split(/\s+/);
      return { lat: parseFloat(latStr), lng: parseFloat(lngStr) };
    })
    .filter((p) => !isNaN(p.lat) && !isNaN(p.lng));
}

/** 여러 좌표(지점/선/면)를 하나의 원(중심+반경) 통제구역으로 근사 변환 */
function pointsToZone(points) {
  if (points.length === 0) return null;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  const center = { lat, lng };
  let maxDist = 0;
  for (const p of points) maxDist = Math.max(maxDist, haversineMeters(center, p));
  return { lat, lng, radiusM: Math.max(300, Math.round(maxDist + 200)) }; // 최소 300m, 여유 200m 추가
}

/**
 * 대전 지역의 현재 활성화된(아직 안 끝난) 재난 관련 도로 통제 구역을 가져옴.
 * riskEngine.setRoadControlZones()에 바로 넣을 수 있는 { lat, lng, radiusM, reason } 배열로 반환.
 */
async function getActiveRoadControlZones() {
  const apiKey = process.env.ROAD_DISASTER_API_KEY;
  if (!apiKey) throw new Error('ROAD_DISASTER_API_KEY가 .env에 설정되지 않았습니다.');

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    apiKey,
    category: 'D',
    eventType: 'all',
    startDate: formatDate(yesterday),
    endDate: formatDate(tomorrow),
    minX: DAEJEON_BBOX.minX,
    maxX: DAEJEON_BBOX.maxX,
    minY: DAEJEON_BBOX.minY,
    maxY: DAEJEON_BBOX.maxY,
    getType: 'json',
  });

  const res = await fetch(`${DISASTER_URL}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`ITS 재난상황정보 API 오류 (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();

  // ⚠️ 문서 예시는 감싸지지 않은 평평한 구조({resultCode, data})였는데, 실제 에러 응답은
  // header/body로 감싸진 구조({header:{resultCode}, body:{...}})였음. 둘 다 대응.
  const resultCode = json.resultCode ?? json.header?.resultCode;
  const resultMsg = json.resultMsg ?? json.header?.resultMsg;
  if (String(resultCode) !== '0') {
    console.warn('[road-control] ITS API 원본 응답:', JSON.stringify(json));
    throw new Error(`ITS 재난상황정보 API 응답 오류 (resultCode=${resultCode}): ${resultMsg}`);
  }

  const items = json.data ?? json.body?.data ?? json.body?.items ?? [];

  const zones = [];
  for (const item of items) {
    // endDate가 이미 채워져 있으면(과거 값) 이미 종료된 상황 -> 제외. null/빈 값이면 아직 진행중으로 간주.
    if (item.endDate) continue;

    const points = parseLocationInfo(item.LocationInfo);
    const zone = pointsToZone(points);
    if (!zone) continue;

    zones.push({
      ...zone,
      reason: item.message || `재난상황(${item.eventType || '미상'})`,
      eventId: item.eventId,
      socName: item.socName,
    });
  }
  return zones;
}

module.exports = { getActiveRoadControlZones };