require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const weatherService = require('./services/weatherService');
const kakaoRoute = require('./services/kakaoRoute');
const riskEngine = require('./services/riskEngine');
const riverService = require('./services/riverService');
const roadControlService = require('./services/roadControlService');
const airQualityService = require('./services/airQualityService');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 대전 시청 부근 기상청 격자좌표 (필요시 지역별로 세분화 가능)
const DEFAULT_GRID = { nx: 67, ny: 100 };

// 최근에 조회한 실시간 하천 수위 (디버그 확인용, /api/river-levels 에서 그대로 보여줌)
let lastRiverLevels = [];

// 시연용 데모 모드 - 켜져 있는 동안은 실시간 갱신을 건너뛰고 아래 시뮬레이션 값을 유지함
let demoModeActive = false;
// null이면 실제 기상청 강수 위험도를 그대로 씀. 숫자(0~1)면 그 값으로 강제 (폭우 시나리오용)
let forcedRainfallRisk = null;

const DEMO_RIVER_LEVELS = [
  { name: '갑천-정림', level: 0.25 },
  { name: '갑천-원촌', level: 0.55 },
  { name: '유등천-도마', level: 0.85 },
  { name: '대전천-대전역인근', level: 0.45 },
  { name: '대전천-중구', level: 0.7 },
];

// "폭우가 극단적으로 심하게 온다" 시나리오 - 강수 위험도 100% + 5개 관측소 전부 심각 수위 근처로
const STORM_RIVER_LEVELS = [
  { name: '갑천-정림', level: 0.95 },
  { name: '갑천-원촌', level: 0.97 },
  { name: '유등천-도마', level: 1.0 },
  { name: '대전천-대전역인근', level: 0.96 },
  { name: '대전천-중구', level: 0.98 },
];

/** HRFCO에서 최신 수위를 받아와 riskEngine.RIVER_MONITOR_POINTS.level을 갱신 */
async function refreshRiverLevels() {
  if (demoModeActive) {
    console.log('[river] 데모 모드 활성 중 - 실시간 갱신 건너뜀');
    return;
  }
  try {
    const liveData = await riverService.getLiveRiverLevels();
    riskEngine.updateRiverLevels(liveData);
    lastRiverLevels = liveData;
    console.log(`[river] 수위 갱신 완료 (${new Date().toLocaleTimeString('ko-KR')})`);
  } catch (e) {
    console.warn('[river] 수위 갱신 실패, 기존 값 유지:', e.message);
  }
}

// 서버 시작 시 1회 조회 + 이후 10분마다 자동 갱신
refreshRiverLevels();
setInterval(refreshRiverLevels, 10 * 60 * 1000);

// 최근에 조회한 도로 통제 구역 (디버그 확인용)
let lastRoadControlZones = [];
let demoRoadBlockActive = false;

/** ITS 재난상황정보에서 대전 지역 도로 통제 구역을 받아와 riskEngine에 반영 */
async function refreshRoadControlZones() {
  if (demoRoadBlockActive) {
    console.log('[road-control] 시연 모드 활성 중 - 실시간 갱신 건너뜀');
    return;
  }
  try {
    const zones = await roadControlService.getActiveRoadControlZones();
    riskEngine.setRoadControlZones(zones);
    lastRoadControlZones = zones;
    riskZonesCache = null; // /api/risk-zones가 지도에 최신 통제구역을 바로 반영하도록 캐시 무효화
    console.log(`[road-control] 통제구역 갱신 완료 (${zones.length}건, ${new Date().toLocaleTimeString('ko-KR')})`);
  } catch (e) {
    console.warn('[road-control] 통제구역 갱신 실패, 기존 값 유지:', e.message);
  }
}

refreshRoadControlZones();
setInterval(refreshRoadControlZones, 10 * 60 * 1000);

// 디버그용: 지금 riskEngine이 쓰고 있는 실제 도로 통제 구역 확인
app.get('/api/road-control-zones', (req, res) => {
  res.json({ demoRoadBlockActive, lastRoadControlZones });
});

// 디버그용: 지금 riskEngine이 쓰고 있는 실제 하천 수위 값을 그대로 확인
app.get('/api/river-levels', (req, res) => {
  res.json({ demoModeActive, forcedRainfallRisk, lastRiverLevels, currentPoints: riskEngine.RIVER_MONITOR_POINTS });
});

// 시연 모드 켜기: 하천 위험도를 강제로 높게 세팅 (실제 데이터 아님, 색상 표시 시연용 - 초록/주황/빨강 섞임)
app.get('/api/demo/on', (req, res) => {
  demoModeActive = true;
  riskEngine.updateRiverLevels(DEMO_RIVER_LEVELS);
  res.json({ demoModeActive, message: '⚠️ 시연 모드 ON — 실제 수위가 아닌 시뮬레이션 값입니다. /api/demo/off 로 끄세요.' });
});

// "폭우가 극단적으로 심하게 온다" 시나리오: 강수 위험도 100% + 하천 전부 심각 수위 근처로 강제
app.get('/api/demo/storm/on', (req, res) => {
  demoModeActive = true;
  forcedRainfallRisk = 1.0;
  riskEngine.updateRiverLevels(STORM_RIVER_LEVELS);
  res.json({
    demoModeActive,
    forcedRainfallRisk,
    message: '⛈️ 폭우 극한 시나리오 ON — 강수 위험도 100% + 하천 5곳 전부 심각 수위 근처로 강제 설정했습니다. 실제 데이터 아님. /api/demo/off 로 끄세요.',
  });
});

// 시연 모드(일반/폭우 공통) 끄기: 즉시 실제 실시간 데이터로 복구
app.get('/api/demo/off', async (req, res) => {
  demoModeActive = false;
  forcedRainfallRisk = null;
  demoRoadBlockActive = false;
  riskZonesCache = null;
  await refreshRiverLevels();
  await refreshRoadControlZones();
  res.json({ demoModeActive, forcedRainfallRisk, demoRoadBlockActive, message: '실시간 실제 데이터로 복구되었습니다.' });
});

// 시연용 도로 통제구역 강제 삽입: 갑천-정림(만년교) 근처를 통제구역으로 만들어 경로가 실제로 피해가는지 확인
const DEMO_ROAD_BLOCK_ZONES = [
  { lat: 36.3517, lng: 127.3497, radiusM: 500, reason: '⚠️ 시연용 — 폭우로 인한 도로 침수 통제 (실제 데이터 아님)' },
];

app.get('/api/demo/road-block/on', (req, res) => {
  demoRoadBlockActive = true;
  riskEngine.setRoadControlZones(DEMO_ROAD_BLOCK_ZONES);
  lastRoadControlZones = DEMO_ROAD_BLOCK_ZONES;
  riskZonesCache = null; // /api/risk-zones가 지도에 새 통제구역을 바로 반영하도록 캐시 무효화
  res.json({
    demoRoadBlockActive,
    zones: DEMO_ROAD_BLOCK_ZONES,
    message: '⚠️ 도로 통제 시연 모드 ON — 만년교 근처 500m가 강제로 통제구역이 됩니다. /api/demo/off 로 끄세요.',
  });
});

// 위험구간을 "실제 도로 경로"로 변환한 결과를 잠깐 캐싱 (매 요청마다 카카오 API를 다시 부르지 않도록)
let riskZonesCache = null;
let riskZonesCacheTime = 0;
const RISK_ZONES_CACHE_MS = 10 * 60 * 1000; // 10분

/** roadSegment(from, to)가 있으면 자동차 길찾기 API로 실제 도로 경로를 받아온다. 실패 시 직선으로 대체. */
async function resolveRoadPath(point) {
  if (!point.roadSegment) return [{ lat: point.lat, lng: point.lng }];
  try {
    const routes = await kakaoRoute.getCarRoutes(point.roadSegment.from, point.roadSegment.to);
    if (routes.length > 0 && routes[0].path.length > 0) {
      return routes[0].path;
    }
  } catch (e) {
    console.warn(`위험구간 도로 조회 실패 (${point.name || '침수이력지점'}):`, e.message);
  }
  return [point.roadSegment.from, point.roadSegment.to]; // 실패 시 직선으로라도 표시
}

async function buildRoadBasedRiskZones() {
  const now = Date.now();
  if (riskZonesCache && now - riskZonesCacheTime < RISK_ZONES_CACHE_MS) {
    return riskZonesCache;
  }

  const riverPoints = await Promise.all(
    riskEngine.RIVER_MONITOR_POINTS.map(async (p) => ({
      name: p.name,
      level: p.level,
      lat: p.lat,
      lng: p.lng,
      roadPath: await resolveRoadPath(p),
    }))
  );

  const historicalFloodPoints = await Promise.all(
    riskEngine.HISTORICAL_FLOOD_POINTS.map(async (p) => ({
      weight: p.weight,
      lat: p.lat,
      lng: p.lng,
      roadPath: await resolveRoadPath(p),
    }))
  );

  // 통제구역: 중심점 남북으로 짧은 도로 구간을 만들어서, 하천/침수 지점과 똑같이 실제 도로 경로로 표시
  const roadControlZones = await Promise.all(
    lastRoadControlZones.map(async (z) => {
      const offsetDeg = Math.min(0.006, Math.max(0.002, z.radiusM / 111000)); // 반경에 비례해 표시 구간 길이 조정
      const roadSegment = {
        from: { lat: z.lat - offsetDeg, lng: z.lng },
        to: { lat: z.lat + offsetDeg, lng: z.lng },
      };
      return {
        lat: z.lat,
        lng: z.lng,
        radiusM: z.radiusM,
        reason: z.reason || '통제구역',
        roadPath: await resolveRoadPath({ ...z, roadSegment }),
      };
    })
  );

  riskZonesCache = { riverPoints, historicalFloodPoints, roadControlZones };
  riskZonesCacheTime = now;
  return riskZonesCache;
}

// 위험구간(하천 관측점 + 침수이력 + 통제구간) 조회 - 프론트에서 지도 위에 표시할 때 사용
app.get('/api/risk-zones', async (req, res) => {
  try {
    const zones = await buildRoadBasedRiskZones();
    res.json(zones);
  } catch (err) {
    console.error(err);
    // 도로 조회가 통째로 실패해도 최소한 점 데이터로는 서비스가 되게 폴백
    res.json({
      riverPoints: riskEngine.RIVER_MONITOR_POINTS,
      historicalFloodPoints: riskEngine.HISTORICAL_FLOOD_POINTS,
      roadControlZones: lastRoadControlZones,
    });
  }
});

// 현재 강수 위험도 조회
app.get('/api/weather-risk', async (req, res) => {
  try {
    if (forcedRainfallRisk !== null) {
      return res.json({ rainfallRisk: forcedRainfallRisk, forecast: [], forced: true });
    }
    const nx = req.query.nx || DEFAULT_GRID.nx;
    const ny = req.query.ny || DEFAULT_GRID.ny;
    const forecast = await weatherService.getVilageForecast(nx, ny);
    const rainfallRisk = weatherService.rainfallRiskFromForecast(forecast);
    res.json({ rainfallRisk, forecast: forecast.slice(0, 4) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 오늘 날씨(기온/하늘상태/강수형태/강수확률) - 강수 위험도 계산용으로 이미 받아오던 데이터를 그대로 재사용
app.get('/api/weather-today', async (req, res) => {
  try {
    const nx = req.query.nx || DEFAULT_GRID.nx;
    const ny = req.query.ny || DEFAULT_GRID.ny;
    const forecast = await weatherService.getVilageForecast(nx, ny);
    const hours = forecast.slice(0, 8).map((item) => ({
      date: item.date,
      time: item.time, // "HHMM"
      tempC: item.TMP !== undefined ? Math.round(parseFloat(item.TMP)) : null,
      sky: item.SKY !== undefined ? parseInt(item.SKY, 10) : null, // 1:맑음 3:구름많음 4:흐림
      pty: item.PTY !== undefined ? parseInt(item.PTY, 10) : null, // 0:없음 1:비 2:비/눈 3:눈 4:소나기
      pop: item.POP !== undefined ? parseInt(item.POP, 10) : null, // 강수확률(%)
      humidity: item.REH !== undefined ? parseInt(item.REH, 10) : null,
    }));
    res.json({ hours });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 대전 지역 미세먼지(PM10)/초미세먼지(PM2.5) - 에어코리아 API, 대전 시도 단위 평균값
let lastAirQuality = null;
app.get('/api/air-quality', async (req, res) => {
  try {
    const data = await airQualityService.getDaejeonAirQuality();
    lastAirQuality = data;
    res.json(data);
  } catch (err) {
    console.error(err);
    // 실패해도 마지막으로 받아온 값이라도 있으면 그거라도 내려줌 (완전히 빈 위젯보다 나음)
    if (lastAirQuality) return res.json({ ...lastAirQuality, stale: true });
    res.status(500).json({ error: err.message });
  }
});

/**
 * 안전 경로 추천: GET /api/route?originLat=&originLng=&destLat=&destLng=&mode=car|walk|bicycle|transit
 */
app.get('/api/route', async (req, res) => {
  try {
    const { originLat, originLng, destLat, destLng, nx, ny } = req.query;
    const mode = ['car', 'walk', 'bicycle', 'transit'].includes(req.query.mode) ? req.query.mode : 'car';

    if (!originLat || !originLng || !destLat || !destLng) {
      return res.status(400).json({ error: 'originLat, originLng, destLat, destLng는 필수입니다.' });
    }

    const origin = { lat: parseFloat(originLat), lng: parseFloat(originLng) };
    const destination = { lat: parseFloat(destLat), lng: parseFloat(destLng) };

    // 강수 위험도 (폭우 시나리오면 강제값)
    let rainfallRisk = 0;
    if (forcedRainfallRisk !== null) {
      rainfallRisk = forcedRainfallRisk;
    } else {
      try {
        const forecast = await weatherService.getVilageForecast(nx || DEFAULT_GRID.nx, ny || DEFAULT_GRID.ny);
        rainfallRisk = weatherService.rainfallRiskFromForecast(forecast);
      } catch (e) {
        console.warn('기상청 API 호출 실패, 강수 위험도 0으로 진행:', e.message);
      }
    }

    const routes = await kakaoRoute.getRoutes(mode, origin, destination);
    if (routes.length === 0) {
      return res.status(404).json({ error: `${mode} 경로를 찾을 수 없습니다.` });
    }

    const ranked = riskEngine.rankRoutes(routes, rainfallRisk);
    res.json({ mode, rainfallRisk, recommended: ranked[0], alternatives: ranked.slice(1) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
// HACK@THON 26 배포 환경은 0.0.0.0 리슨 필수 (127.0.0.1이면 빌드는 성공해도 접속 안 됨)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`대전 안전 길 안내 서버 실행 중: http://localhost:${PORT}`);
});