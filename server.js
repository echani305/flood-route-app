require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const weatherService = require('./services/weatherService');
const kakaoRoute = require('./services/kakaoRoute');
const riskEngine = require('./services/riskEngine');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 대전 시청 부근 기상청 격자좌표 (필요시 지역별로 세분화 가능)
const DEFAULT_GRID = { nx: 67, ny: 100 };

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

  riskZonesCache = { riverPoints, historicalFloodPoints };
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
    });
  }
});

// 현재 강수 위험도 조회
app.get('/api/weather-risk', async (req, res) => {
  try {
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

/**
 * 안전 경로 추천
 * GET /api/route?originLat=&originLng=&destLat=&destLng=&mode=car|walk|bicycle|transit
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

    // 1) 현재 강수 위험도
    let rainfallRisk = 0;
    try {
      const forecast = await weatherService.getVilageForecast(nx || DEFAULT_GRID.nx, ny || DEFAULT_GRID.ny);
      rainfallRisk = weatherService.rainfallRiskFromForecast(forecast);
    } catch (e) {
      console.warn('기상청 API 호출 실패, 강수 위험도 0으로 진행:', e.message);
    }

    // 2) 선택한 이동수단으로 경로 후보 조회 (자동차는 대안 경로 포함, 도보/자전거/대중교통은 단일 경로)
    const routes = await kakaoRoute.getRoutes(mode, origin, destination);
    if (routes.length === 0) {
      return res.status(404).json({ error: `${mode} 경로를 찾을 수 없습니다.` });
    }

    // 3) 위험도 기준으로 경로 랭킹
    const ranked = riskEngine.rankRoutes(routes, rainfallRisk);

    res.json({
      mode,
      rainfallRisk,
      recommended: ranked[0],
      alternatives: ranked.slice(1),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`대전 안전 길 안내 서버 실행 중: http://localhost:${PORT}`);
});