# 대전 안전 길 안내 시스템 (해커톤 데모)

폭우·장마 시 기상청 예보와 하천 위험도를 기반으로, **카카오모빌리티**가 계산한 여러 경로 후보 중 가장 안전한 경로를 추천하고 카카오맵 위에 시각화합니다.

## 구조

```
flood-route-app/
├── server.js                 # Express 서버 (API 라우트)
├── services/
│   ├── weatherService.js     # 기상청 단기예보 API 연동 + 강수 위험도 계산
│   ├── kakaoRoute.js         # 카카오모빌리티 자동차 길찾기 API 연동
│   └── riskEngine.js         # 하천/침수이력/통제구간 기반 위험도 산출 + 경로 랭킹
├── public/
│   ├── index.html            # 카카오맵 JS SDK 로드, 검색 UI
│   └── app.js                # 지도 표시, 지오코딩, 경로 시각화
└── .env.example
```

## 지도/경로 API 선택 이유

- **카카오맵 JS SDK**: 지도 표시, 마커, 위험구간 원(circle) 표시, 검색창 지오코딩(`kakao.maps.services.Geocoder`/`Places`)까지 브라우저에서 CORS 문제 없이 처리.
- **카카오모빌리티 자동차 길찾기 API**: 실제 도로망 기반 경로 계산. 구글 Directions API는 한국 내 지도 데이터 반출 규제로 자동차 길찾기를 지원하지 않아 사용하지 않았습니다.
- 두 API 모두 **카카오 개발자센터(developers.kakao.com)** 계정 하나로 발급받습니다: JavaScript 키(지도용) / REST API 키(경로용).

## 실행 방법

```bash
cd flood-route-app
npm install
cp .env.example .env      # .env를 열어 실제 키 값 입력
```

`public/index.html`에서 `KAKAO_JS_KEY_HERE`를 발급받은 **JavaScript 키**로 교체하세요.
`.env`에는 `DATA_GO_KR_SERVICE_KEY`(공공데이터포털, 기상청 API 인증키)와 `KAKAO_REST_API_KEY`(카카오 REST 키)를 입력하세요.

카카오 개발자센터 > 내 애플리케이션 > 플랫폼 설정 > Web 에 `http://localhost:3000` 도메인을 등록해야 로컬에서 지도가 정상 표시됩니다.

```bash
npm start
# http://localhost:3000 접속
```

## 실제 서비스로 발전시키려면 (TODO)

현재 `services/riskEngine.js`의 하천 관측점(`RIVER_MONITOR_POINTS`)과 침수 이력(`HISTORICAL_FLOOD_POINTS`)은 **데모용 예시 좌표/값**입니다. 실제 데이터로 교체가 필요합니다:

1. **하천 수위** — 금강홍수통제소 수위 API(`https://www.data.go.kr/data/3038808/fileData.do`)를 주기적으로 호출해 `RIVER_MONITOR_POINTS[i].level`을 실시간 값(0~1로 정규화)으로 갱신하는 스케줄러 추가.
2. **도로 통제** — 국토교통부 재난상황정보 API(`https://www.data.go.kr/data/15160258/openapi.do`)를 호출해 `riskEngine.setRoadControlZones(...)`로 실시간 통제구간 주입.
3. **침수흔적도** — 행안부 침수흔적도 API(`https://www.data.go.kr/data/15150694/openapi.do`)로 `HISTORICAL_FLOOD_POINTS`를 실좌표로 교체.
4. **지형/저지대** — DEM 데이터를 활용해 `riskAtPoint`에 고도 기반 가중치 추가하면 정확도가 더 올라갑니다.
5. 각 외부 API는 응답이 느릴 수 있으니, 서버에 5~10분 캐시(예: `node-cache`)를 두면 해커톤 데모에서 체감 속도가 훨씬 좋아집니다.

## 위험도 계산 로직 요약 (`riskEngine.js`)

지점 위험도 = (하천 수위 근접도 가중) + (과거 침수 이력 근접도 가중) + (강수 위험도 × 하천 근접 보정)

경로 위험도 = 경로를 60개 지점으로 샘플링해 평균/최댓값 계산. 통제구간을 지나는 경로는 항상 후순위로 배치.
