// 대전시청 부근을 기본 중심으로 지도 초기화
const DAEJEON_CENTER = { lat: 36.3504, lng: 127.3845 };

const map = new kakao.maps.Map(document.getElementById('map'), {
  center: new kakao.maps.LatLng(DAEJEON_CENTER.lat, DAEJEON_CENTER.lng),
  level: 6,
});

// ---------- 모바일: 검색 패널 접기/펼치기 ----------
const sidebarEl = document.getElementById('sidebar');
const sidebarToggleBtn = document.getElementById('sidebarToggle');
const sidebarToggleIcon = document.getElementById('sidebarToggleIcon');
const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

function setSidebarCollapsed(collapsed) {
  sidebarEl.classList.toggle('collapsed', collapsed);
  sidebarToggleBtn.textContent = ''; // 아이콘/텍스트 다시 구성
  const label = document.createElement('span');
  label.textContent = collapsed ? '검색창 펼치기 ' : '🗺️ 지도 크게 보기 ';
  sidebarToggleBtn.appendChild(label);
  const icon = document.createElement('span');
  icon.textContent = collapsed ? '▸' : '▾';
  sidebarToggleBtn.appendChild(icon);
  // 컨테이너 크기가 바뀌면 카카오맵이 스스로 다시 그리지 못하는 경우가 있어 relayout으로 강제 갱신
  setTimeout(() => map.relayout(), 260);
}

sidebarToggleBtn.addEventListener('click', () => {
  setSidebarCollapsed(!sidebarEl.classList.contains('collapsed'));
});

const geocoder = new kakao.maps.services.Geocoder();
const places = new kakao.maps.services.Places();

// ---------- 장소 검색 결과를 "내 위치에서 가까운 순"으로 정렬하기 위한 기준 좌표 ----------
// 프랜차이즈(맥도날드 등)처럼 전국에 여러 곳이 있는 키워드를 검색하면 카카오 기본 정렬(정확도순)은
// 지역과 상관없이 아무 지점이나 잡을 수 있어서, 위치 기준 정렬(sort: DISTANCE)을 쓰기 위해 필요함.
// 처음엔 대전 중심 좌표로 시작했다가, GPS 위치를 받아오면 그걸로 갱신한다(실패하면 대전 중심 유지).
let searchBiasLocation = new kakao.maps.LatLng(DAEJEON_CENTER.lat, DAEJEON_CENTER.lng);
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      searchBiasLocation = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
    },
    () => {}, // 권한 거부/실패 시: 그냥 대전 중심 기준으로 계속 검색
    { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 8000 }
  );
}

let routeOverlays = []; // 현재 지도에 그려진 경로선/마커를 추적해서 다음 검색 때 지움
let riskZoneOverlays = [];
let activeInfoOverlay = null; // 위험구간 클릭 시 뜨는 CustomOverlay (한 번에 하나만 표시)

function clearOverlays(list) {
  list.forEach((o) => o.setMap(null));
  list.length = 0;
}

function riskColor(risk) {
  if (risk < 0.35) return '#2a9d8f'; // 안전
  if (risk < 0.65) return '#f4a261'; // 주의
  return '#e63946'; // 위험
}

// 위험구간 원을 클릭했을 때 정보를 보여주는 말풍선(CustomOverlay)
function attachInfoOverlay(circle, position, html) {
  kakao.maps.event.addListener(circle, 'click', () => {
    if (activeInfoOverlay) activeInfoOverlay.setMap(null);

    const content = document.createElement('div');
    content.innerHTML = html;
    content.style.cssText = `
      background: white; border: 1px solid #ccc; border-radius: 6px;
      padding: 8px 10px; font-size: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      white-space: nowrap;
    `;
    // 닫기: 말풍선 자체를 다시 클릭하면 닫힘
    content.addEventListener('click', () => {
      activeInfoOverlay.setMap(null);
      activeInfoOverlay = null;
    });

    activeInfoOverlay = new kakao.maps.CustomOverlay({
      map,
      position,
      content,
      yAnchor: 1.3,
      clickable: true,
    });
  });
}

// ---------- 위험구간(하천 관측점 / 침수 이력) 지도에 표시 - 실제 도로 경로를 따라 색칠 ----------
async function loadRiskZones() {
  try {
    const res = await fetch('/api/risk-zones');
    const data = await res.json();

    clearOverlays(riskZoneOverlays);

    data.riverPoints.forEach((p) => {
      const path = (p.roadPath && p.roadPath.length > 1) ? p.roadPath : [p, p];
      const polyline = new kakao.maps.Polyline({
        path: path.map((pt) => new kakao.maps.LatLng(pt.lat, pt.lng)),
        strokeWeight: 6,
        strokeColor: riskColor(p.level),
        strokeOpacity: 0.55,
        strokeStyle: 'solid',
      });
      polyline.setMap(map);
      riskZoneOverlays.push(polyline);

      const mid = path[Math.floor(path.length / 2)];
      attachInfoOverlay(polyline, new kakao.maps.LatLng(mid.lat, mid.lng),
        `<b>${p.name}</b><br/>하천 수위 위험도: ${(p.level * 100).toFixed(0)}%<br/><span style="color:#999">(클릭하면 닫힘)</span>`);
    });

    data.historicalFloodPoints.forEach((p) => {
      const path = (p.roadPath && p.roadPath.length > 1) ? p.roadPath : [p, p];
      const polyline = new kakao.maps.Polyline({
        path: path.map((pt) => new kakao.maps.LatLng(pt.lat, pt.lng)),
        strokeWeight: 5,
        strokeColor: '#e63946',
        strokeOpacity: 0.4,
        strokeStyle: 'shortdash',
      });
      polyline.setMap(map);
      riskZoneOverlays.push(polyline);

      const mid = path[Math.floor(path.length / 2)];
      attachInfoOverlay(polyline, new kakao.maps.LatLng(mid.lat, mid.lng),
        `<b>과거 침수 이력 도로</b><br/>가중치: ${(p.weight * 100).toFixed(0)}%<br/><span style="color:#999">(클릭하면 닫힘)</span>`);
    });

    // 통제구역: 하천/침수 지점과 동일하게, 실제 도로를 따라 굵은 빨간 선 + "🚧 통제구간" 뱃지로 표시
    (data.roadControlZones || []).forEach((z) => {
      const path = (z.roadPath && z.roadPath.length > 1) ? z.roadPath : [z, z];
      const polyline = new kakao.maps.Polyline({
        path: path.map((pt) => new kakao.maps.LatLng(pt.lat, pt.lng)),
        strokeWeight: 8,
        strokeColor: '#e63946',
        strokeOpacity: 0.85,
        strokeStyle: 'solid',
      });
      polyline.setMap(map);
      riskZoneOverlays.push(polyline);

      const mid = path[Math.floor(path.length / 2)];
      const midPos = new kakao.maps.LatLng(mid.lat, mid.lng);

      const badge = document.createElement('div');
      badge.textContent = '🚧 통제구간';
      badge.style.cssText = `
        background: #e63946; color: white; font-size: 11px; font-weight: bold;
        padding: 3px 7px; border-radius: 10px; white-space: nowrap;
        box-shadow: 0 1px 4px rgba(0,0,0,0.35);
      `;
      const badgeOverlay = new kakao.maps.CustomOverlay({ map, position: midPos, content: badge, yAnchor: 2.2 });
      riskZoneOverlays.push(badgeOverlay);

      attachInfoOverlay(polyline, midPos, `<b>🚧 통제구간</b><br/>${z.reason}<br/><span style="color:#999">(클릭하면 닫힘)</span>`);
    });
  } catch (e) {
    console.warn('위험구간 로드 실패', e);
  }
}
loadRiskZones();

// ---------- 주소 -> 좌표 변환 ----------
function geocodeAddress(query) {
  return new Promise((resolve, reject) => {
    // 먼저 키워드 장소 검색(건물명, 지명 등)을 시도하고, 실패하면 주소 검색으로 재시도
    // location + sort:DISTANCE 를 줘서, "맥도날드"처럼 여러 지역에 있는 곳을 검색해도
    // 내 위치(또는 대전 중심)에서 가장 가까운 지점이 1순위로 나오게 한다.
    places.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK && data.length > 0) {
        // sort:DISTANCE는 "이름이 정확한지"보다 "가까운 정도"를 우선하므로, 검색어랑 이름이
        // 정확히 일치하는 곳이 있으면 그걸 최우선으로 쓰고, 없으면 이름에 포함된 곳,
        // 그래도 없으면 거리순 1위를 그대로 씀 (자동완성 드롭다운과 동일한 우선순위 규칙)
        const best =
          data.find((d) => d.place_name === query) ||
          data.find((d) => d.place_name.includes(query)) ||
          data[0];
        resolve({ lat: parseFloat(best.y), lng: parseFloat(best.x), name: best.place_name });
        return;
      }
      geocoder.addressSearch(query, (result, addrStatus) => {
        if (addrStatus === kakao.maps.services.Status.OK && result.length > 0) {
          resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x), name: query });
        } else {
          reject(new Error(`"${query}" 위치를 찾을 수 없습니다.`));
        }
      });
    }, {
      location: searchBiasLocation,
      sort: kakao.maps.services.SortBy.DISTANCE,
      radius: 20000,
    });
  });
}

// ---------- 출발지/도착지 자동완성(연관검색어) ----------
const selectedLocations = { origin: null, destination: null }; // 드롭다운에서 클릭 선택하면 좌표를 바로 저장해 재검색 시 지오코딩을 건너뜀

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function setupAutocomplete(inputEl, listEl, storeKey) {
  function closeSuggestions() {
    listEl.classList.remove('open');
    listEl.innerHTML = '';
  }

  function renderSuggestions(items) {
    listEl.innerHTML = items.map((item, i) => `
      <div class="suggestion-item" data-index="${i}">
        <div class="s-name">${item.place_name}</div>
        <div class="s-addr">${item.road_address_name || item.address_name || ''}</div>
      </div>
    `).join('');
    listEl.classList.add('open');

    listEl.querySelectorAll('.suggestion-item').forEach((el) => {
      el.addEventListener('click', () => {
        const item = items[Number(el.dataset.index)];
        inputEl.value = item.place_name;
        selectedLocations[storeKey] = { lat: parseFloat(item.y), lng: parseFloat(item.x), name: item.place_name };
        closeSuggestions();
      });
    });
  }

  const search = debounce((query) => {
    const trimmed = query ? query.trim() : '';
    if (trimmed.length < 2) {
      closeSuggestions();
      return;
    }

    // 검색을 두 방식으로 동시에 요청해서 합친다:
    // ① 기본(정확도순, 거리 상관없음) - "대전역"처럼 유일하고 정확한 이름을 놓치지 않기 위함
    // ② 거리순(내 위치/대전 기준) - "맥도날드"처럼 여러 지점이 있는 경우 가까운 곳을 잡기 위함
    // 거리순만 쓰면, 이름은 느슨하게 걸리지만 더 가까운 다른 장소들 때문에 정작 찾는 곳이
    // 후보 목록(상위 10개) 밖으로 밀려날 수 있어서, 정확도순 결과를 같이 봐서 보완한다.
    let accuracyData = null;
    let distanceData = null;

    function tryRender() {
      if (accuracyData === null || distanceData === null) return; // 둘 다 응답 와야 합침

      const seen = new Set();
      const nameMatched = [];
      const distanceRest = [];

      for (const item of accuracyData) {
        const key = `${item.x},${item.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (item.place_name.includes(trimmed)) nameMatched.push(item);
      }
      for (const item of distanceData) {
        const key = `${item.x},${item.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (item.place_name.includes(trimmed)) nameMatched.push(item);
        else distanceRest.push(item);
      }

      const merged = [...nameMatched, ...distanceRest];
      if (merged.length === 0) {
        closeSuggestions();
        return;
      }
      renderSuggestions(merged.slice(0, 6));
    }

    places.keywordSearch(trimmed, (data, status) => {
      accuracyData = status === kakao.maps.services.Status.OK ? data : [];
      tryRender();
    });

    places.keywordSearch(trimmed, (data, status) => {
      distanceData = status === kakao.maps.services.Status.OK ? data : [];
      tryRender();
    }, {
      size: 10,
      location: searchBiasLocation,
      sort: kakao.maps.services.SortBy.DISTANCE,
      radius: 20000,
    });
  }, 250);

  inputEl.addEventListener('input', () => {
    selectedLocations[storeKey] = null; // 직접 타이핑하면 이전 선택은 무효화
    search(inputEl.value);
  });

  // 입력창/드롭다운 바깥을 클릭하면 닫기
  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !listEl.contains(e.target)) {
      closeSuggestions();
    }
  });
}

setupAutocomplete(
  document.getElementById('originInput'),
  document.getElementById('originSuggestions'),
  'origin'
);
setupAutocomplete(
  document.getElementById('destInput'),
  document.getElementById('destSuggestions'),
  'destination'
);

// ---------- 이동수단 ----------
// 도보/자전거/대중교통 API는 아직 응답 파싱이 검증 안 돼서, UI에서는 자동차만 사용
// (백엔드 kakaoRoute.js의 관련 함수들은 남겨뒀으니, 나중에 검증되면 버튼만 다시 추가하면 됨)
const selectedMode = 'car';

// ---------- 경로 검색 (재탐색에서도 재사용하는 공통 함수) ----------
const searchBtn = document.getElementById('searchBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

let activeRouteContext = null; // { destination, mode } - 실시간 추적/자동 재탐색이 이걸 기준으로 계속 갱신
let currentOrigin = null; // 마지막으로 확인된 출발 위치 (실시간 추적 중엔 GPS로 계속 갱신됨)
let lastRoutePath = []; // 현재 지도에 그려진 추천 경로의 전체 좌표 (경로 이탈 판정에 사용)
let lastRouteData = null; // 최근 /api/route 응답 전체 (안전 경로 전환 버튼에서 대안 목록을 다시 쓰기 위함)
let isRefreshing = false; // 중복 호출 방지

// ---------- 위험 구간이 있으면 "더 안전한 경로로 변경" 배너/버튼 ----------
const RISKY_THRESHOLD = 0.35; // riskColor 기준 이 값부터 주황(주의)
const safeSwitchBanner = document.getElementById('safeSwitchBanner');

/**
 * 대안 경로 중 안전한 걸 찾음. 두 단계로 시도:
 * 1) 전 구간이 완전히 초록(주의 미만)인 대안 - 있으면 최우선
 * 2) 그런 게 없으면, 그래도 지금 추천 경로보다는 덜 위험한 대안 중 가장 나은 것
 *    (폭우 극한 모드처럼 출발지 자체가 위험구간 근처면, 완전 초록 대안이 아예 불가능할 수 있어서
 *     이 경우엔 "그나마 더 안전한" 것으로 대체함 - 초록이라고 거짓말은 안 함)
 */
function findSaferAlternative(recommended, alternatives) {
  if (!alternatives || alternatives.length === 0) return { route: null, fullyGreen: false };

  const fullyGreen = alternatives
    .filter((r) => !r.blocked && r.maxRisk < RISKY_THRESHOLD)
    .sort((a, b) => a.maxRisk - b.maxRisk);
  if (fullyGreen.length > 0) return { route: fullyGreen[0], fullyGreen: true };

  const lessRisky = alternatives
    .filter((r) => !r.blocked && r.maxRisk < recommended.maxRisk)
    .sort((a, b) => a.maxRisk - b.maxRisk);
  if (lessRisky.length > 0) return { route: lessRisky[0], fullyGreen: false };

  return { route: null, fullyGreen: false };
}

function updateSafeSwitchBanner(data) {
  const hasRisk = !data.recommended.blocked && data.recommended.maxRisk >= RISKY_THRESHOLD;
  const { route: safer, fullyGreen } = hasRisk
    ? findSaferAlternative(data.recommended, data.alternatives)
    : { route: null, fullyGreen: false };

  // 디버그용: 버튼이 왜 뜨는지/안 뜨는지 콘솔에서 바로 확인 가능하게
  console.log('[안전경로 버튼 판단]', {
    추천_최고위험도: data.recommended.maxRisk,
    대안_개수: data.alternatives.length,
    대안들: data.alternatives.map((a) => ({ maxRisk: a.maxRisk, blocked: a.blocked })),
    선택된_대안: safer ? { maxRisk: safer.maxRisk, fullyGreen } : null,
  });

  if (!hasRisk || !safer) {
    safeSwitchBanner.classList.remove('show');
    safeSwitchBanner.innerHTML = '';
    return;
  }

  const label = data.recommended.maxRisk >= 0.65 ? '위험' : '주의';
  const btnLabel = fullyGreen ? '안전한 길(초록색)로만 변경' : '그나마 더 안전한 경로로 변경';
  safeSwitchBanner.innerHTML = `⚠️ 이 경로는 <b>${label}</b> 구간을 지나요.<button id="switchSafeBtn" type="button">${btnLabel}</button>`;
  safeSwitchBanner.classList.add('show');
  document.getElementById('switchSafeBtn').addEventListener('click', () => switchToSaferRoute(safer));
}

/** 배너의 버튼을 눌렀을 때: 서버를 다시 안 부르고, 이미 받아둔 대안 경로로 화면만 바꿔 그림 */
function switchToSaferRoute(saferRoute) {
  if (!lastRouteData || !activeRouteContext) return;
  clearOverlays(routeOverlays);
  lastRoutePath = saferRoute.path;
  renderRoute(saferRoute, true, currentOrigin, activeRouteContext.destination);

  const otherAlternatives = [lastRouteData.recommended, ...lastRouteData.alternatives].filter((r) => r !== saferRoute);
  otherAlternatives.forEach((alt) => renderRoute(alt, false));
  renderResultCards(saferRoute, otherAlternatives);

  // 이번에 고른 경로를 새 "추천"으로 취급해서, 다시 위험 구간이 있으면 배너가 또 뜰 수 있게 함
  lastRouteData = { ...lastRouteData, recommended: saferRoute, alternatives: otherAlternatives };
  updateSafeSwitchBanner(lastRouteData);
}

async function fetchAndRenderRoute(origin, destination, { silent = false, fitBounds = false } = {}) {
  if (isRefreshing) return null;
  isRefreshing = true;
  if (!silent) {
    searchBtn.disabled = true;
    statusEl.textContent = '기상 데이터 및 안전 경로 계산 중...';
  }

  try {
    const params = new URLSearchParams({
      originLat: origin.lat,
      originLng: origin.lng,
      destLat: destination.lat,
      destLng: destination.lng,
      mode: selectedMode,
    });
    const res = await fetch(`/api/route?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '경로 조회 실패');

    clearOverlays(routeOverlays);
    lastRoutePath = data.recommended.path;
    renderRoute(data.recommended, true, origin, destination);
    data.alternatives.forEach((alt) => renderRoute(alt, false));
    renderResultCards(data.recommended, data.alternatives);
    lastRouteData = data;
    updateSafeSwitchBanner(data);

    const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const trackingSuffix = trackingActive ? ' · 실시간 추적 중' : '';
    statusEl.textContent = `현재 강수 위험도: ${(data.rainfallRisk * 100).toFixed(0)}% · 마지막 갱신 ${timeStr}${trackingSuffix}`;

    if (fitBounds) {
      const bounds = new kakao.maps.LatLngBounds();
      data.recommended.path.forEach((p) => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
      map.setBounds(bounds);
    }

    activeRouteContext = { destination, mode: selectedMode };
    return data;
  } catch (err) {
    console.error(err);
    if (!silent) statusEl.textContent = `오류: ${err.message}`;
    return null;
  } finally {
    isRefreshing = false;
    if (!silent) searchBtn.disabled = false;
  }
}

searchBtn.addEventListener('click', async () => {
  const originInput = document.getElementById('originInput');
  const destInput = document.getElementById('destInput');
  const originQuery = originInput.value.trim();
  const destQuery = destInput.value.trim();

  if (!originQuery || !destQuery) {
    statusEl.textContent = '출발지와 도착지를 모두 입력하세요.';
    return;
  }

  // 출발지/도착지는 반드시 검색 목록(드롭다운)에서 직접 선택해야만 진행됨.
  // (자동으로 후보를 추측해서 고르게 하면, 이름이 비슷한 다른 장소가 잡히는 경우가 있어
  //  아예 "목록에서 직접 고르기"를 강제해서 원천적으로 방지함)
  if (!selectedLocations.origin) {
    statusEl.textContent = '⚠️ 출발지를 아래 목록에서 정확히 선택해주세요.';
    originInput.focus();
    originInput.dispatchEvent(new Event('input'));
    return;
  }
  if (!selectedLocations.destination) {
    statusEl.textContent = '⚠️ 도착지를 아래 목록에서 정확히 선택해주세요.';
    destInput.focus();
    destInput.dispatchEvent(new Event('input'));
    return;
  }

  if (activeInfoOverlay) { activeInfoOverlay.setMap(null); activeInfoOverlay = null; }
  statusEl.textContent = '위치 확인 중...';
  resultsEl.innerHTML = '';

  try {
    const origin = selectedLocations.origin;
    const destination = selectedLocations.destination;
    console.log('[선택된 위치] 출발지:', origin, ' / 도착지:', destination);
    currentOrigin = origin;
    const result = await fetchAndRenderRoute(origin, destination, { silent: false, fitBounds: true });
    if (result && isMobile()) setSidebarCollapsed(true); // 모바일에서는 경로 찾으면 자동으로 접어서 지도를 크게 보여줌
  } catch (err) {
    console.error(err);
    statusEl.textContent = `오류: ${err.message}`;
  }
});

// ---------- 실시간 추적 & 자동 재탐색 ----------
// 일반 내비게이션보다 훨씬 자주(15초) 재탐색: 폭우 상황은 하천 수위·통제구간이 빠르게 바뀌기 때문
let trackingActive = false;
let liveWatchId = null;
let autoRefreshTimer = null;
let liveMarker = null;
const AUTO_REFRESH_MS = 15000; // 15초마다 자동 재탐색
const DEVIATION_THRESHOLD_M = 60; // 경로에서 이 거리(m) 이상 벗어나면 즉시 재탐색

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 내 위치가 현재 경로에서 얼마나 떨어져 있는지 (경로를 이루는 점들과의 최단 거리로 근사)
function minDistanceToPath(point, path) {
  if (!path || path.length === 0) return Infinity;
  let min = Infinity;
  for (const p of path) {
    const d = haversineMeters(point, p);
    if (d < min) min = d;
  }
  return min;
}

function updateLiveMarker(position) {
  const pos = new kakao.maps.LatLng(position.lat, position.lng);
  if (!liveMarker) {
    liveMarker = new kakao.maps.Circle({
      center: pos,
      radius: 15,
      strokeWeight: 2,
      strokeColor: '#1e88e5',
      strokeOpacity: 0.9,
      fillColor: '#1e88e5',
      fillOpacity: 0.8,
    });
    liveMarker.setMap(map);
  } else {
    liveMarker.setPosition(pos);
  }
}

async function handlePositionUpdate(position) {
  const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
  currentOrigin = coords;
  updateLiveMarker(coords);

  if (!activeRouteContext) return; // 아직 경로를 한 번도 안 찾았으면 추적만 하고 재탐색은 하지 않음

  const deviation = minDistanceToPath(coords, lastRoutePath);
  if (deviation > DEVIATION_THRESHOLD_M) {
    trackingStatusEl.textContent = `⚠️ 경로 이탈 감지(약 ${Math.round(deviation)}m) — 재탐색 중...`;
    await fetchAndRenderRoute(coords, activeRouteContext.destination, { silent: true });
    trackingStatusEl.textContent = `실시간 추적 중 · ${AUTO_REFRESH_MS / 1000}초마다 자동 재탐색`;
  }
}

const trackingBtn = document.getElementById('trackingBtn');
const trackingStatusEl = document.getElementById('trackingStatus');

function startTracking() {
  if (!activeRouteContext) {
    statusEl.textContent = '먼저 "안전 경로 찾기"로 경로를 검색한 뒤 실시간 추적을 켜주세요.';
    return;
  }
  if (!navigator.geolocation) {
    statusEl.textContent = '이 브라우저는 위치 추적(GPS)을 지원하지 않습니다.';
    return;
  }

  trackingActive = true;
  trackingBtn.textContent = '⏹ 실시간 추적 중지';
  trackingBtn.classList.add('active');
  trackingStatusEl.textContent = `실시간 추적 시작 · ${AUTO_REFRESH_MS / 1000}초마다 자동 재탐색 (출발지는 이제 내 실제 위치로 갱신됩니다)`;

  liveWatchId = navigator.geolocation.watchPosition(
    handlePositionUpdate,
    (err) => { trackingStatusEl.textContent = `위치 확인 실패: ${err.message}`; },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );

  autoRefreshTimer = setInterval(async () => {
    if (!activeRouteContext || !currentOrigin) return;
    trackingStatusEl.textContent = '자동 재탐색 중...';
    await fetchAndRenderRoute(currentOrigin, activeRouteContext.destination, { silent: true });
    trackingStatusEl.textContent = `실시간 추적 중 · ${AUTO_REFRESH_MS / 1000}초마다 자동 재탐색`;
  }, AUTO_REFRESH_MS);
}

function stopTracking() {
  trackingActive = false;
  trackingBtn.textContent = '🛰 실시간 추적 시작';
  trackingBtn.classList.remove('active');
  trackingStatusEl.textContent = '';

  if (liveWatchId !== null) {
    navigator.geolocation.clearWatch(liveWatchId);
    liveWatchId = null;
  }
  if (autoRefreshTimer !== null) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (liveMarker) {
    liveMarker.setMap(null);
    liveMarker = null;
  }
}

trackingBtn.addEventListener('click', () => {
  if (trackingActive) stopTracking();
  else startTracking();
});

// 경로를 통째로 한 색이 아니라, 구간(sampledPoints 인접 구간)마다 그 구간의 위험도 색으로 나눠 그린다.
function renderRoute(route, isRecommended, origin, destination) {
  const points = route.sampledPoints && route.sampledPoints.length > 1
    ? route.sampledPoints
    : route.path.map((p) => ({ ...p, risk: route.riskScore })); // 안전장치: 샘플이 없으면 평균 위험도로 단색 처리

  for (let i = 0; i < points.length - 1; i++) {
    const segRisk = (points[i].risk + points[i + 1].risk) / 2;
    const segment = new kakao.maps.Polyline({
      path: [
        new kakao.maps.LatLng(points[i].lat, points[i].lng),
        new kakao.maps.LatLng(points[i + 1].lat, points[i + 1].lng),
      ],
      strokeWeight: isRecommended ? 6 : 3,
      strokeColor: riskColor(segRisk),
      strokeOpacity: isRecommended ? 0.9 : 0.5,
      strokeStyle: isRecommended ? 'solid' : 'shortdash',
    });
    segment.setMap(map);
    routeOverlays.push(segment);
  }

  if (isRecommended && origin && destination) {
    const startMarker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(origin.lat, origin.lng),
      draggable: true,
    });
    const endMarker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(destination.lat, destination.lng),
      draggable: true,
    });
    startMarker.setMap(map);
    endMarker.setMap(map);
    routeOverlays.push(startMarker, endMarker);

    // 출발지 마커를 드래그해서 놓으면, 그 위치를 새 출발지로 삼아 경로를 다시 계산한다.
    kakao.maps.event.addListener(startMarker, 'dragend', () => {
      const pos = startMarker.getPosition();
      const newOrigin = { lat: pos.getLat(), lng: pos.getLng() };
      if (trackingActive) stopTracking(); // 실시간 추적 중이면 다음 GPS 갱신에 덮어써지니 꺼준다
      currentOrigin = newOrigin;
      selectedLocations.origin = newOrigin;
      document.getElementById('originInput').value = '(지도에서 직접 지정한 위치)';
      fetchAndRenderRoute(newOrigin, activeRouteContext.destination, { silent: false, fitBounds: false });
    });

    // 도착지 마커를 드래그해서 놓으면, 그 위치를 새 도착지로 삼아 경로를 다시 계산한다.
    kakao.maps.event.addListener(endMarker, 'dragend', () => {
      const pos = endMarker.getPosition();
      const newDestination = { lat: pos.getLat(), lng: pos.getLng() };
      activeRouteContext = { ...activeRouteContext, destination: newDestination };
      selectedLocations.destination = newDestination;
      document.getElementById('destInput').value = '(지도에서 직접 지정한 위치)';
      fetchAndRenderRoute(currentOrigin, newDestination, { silent: false, fitBounds: false });
    });
  }

  // 추천 경로에서 감지된 유턴 지점에 "↩ 유턴" 뱃지 표시 (선 하나로는 헷갈릴 수 있어서)
  if (isRecommended && route.uTurns && route.uTurns.length > 0) {
    route.uTurns.forEach((u) => {
      const content = document.createElement('div');
      content.textContent = '↩ 유턴';
      content.style.cssText = `
        background: #1d3557; color: white; font-size: 11px; font-weight: bold;
        padding: 3px 7px; border-radius: 10px; white-space: nowrap;
        box-shadow: 0 1px 4px rgba(0,0,0,0.35);
      `;
      const overlay = new kakao.maps.CustomOverlay({
        map,
        position: new kakao.maps.LatLng(u.lat, u.lng),
        content,
        yAnchor: 1.8,
      });
      routeOverlays.push(overlay);
    });
  }
}

function renderResultCards(recommended, alternatives) {
  const all = [{ ...recommended, label: '추천 (가장 안전)', recommended: true },
    ...alternatives.map((a, i) => ({ ...a, label: `대안 경로 ${i + 1}`, recommended: false }))];

  resultsEl.innerHTML = all.map((r) => `
    <div class="result-card ${r.recommended ? 'recommended' : ''}">
      <h3>${r.label} ${r.blocked ? '⚠️ 통제구간 포함' : ''}</h3>
      <div class="meta">
        거리 ${(r.distance / 1000).toFixed(1)}km · 예상 ${Math.round(r.duration / 60)}분
      </div>
      <div class="meta">위험도 ${(r.riskScore * 100).toFixed(0)}% (최고 ${(r.maxRisk * 100).toFixed(0)}%)</div>
      <div class="risk-bar">
        <div class="risk-bar-fill" style="width:${r.riskScore * 100}%; background:${riskColor(r.riskScore)}"></div>
      </div>
    </div>
  `).join('');
}