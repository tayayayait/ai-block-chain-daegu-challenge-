# 보행 제약·그늘 경로 데이터 계약

- 확인일: 2026-08-25 KST
- 목적: F-04가 증명할 수 있는 범위와 증명할 수 없는 범위를 구현 전에 고정한다.
- 결론: 공개자료만으로 대구 전역의 무계단, 5% 이하 경사, 300m 이내 휴식을 보장할 수 없다. F-04는 **시연용 그늘·접근성 우선 경로 후보**로 구현한다.

## 1. 공급처 결정

| 데이터             | 공급처                                                                                                                                                                          | 원본 좌표계                                                   | 이용 조건                                                                                                                             | 갱신·확인 기준                                                                   | 구현 판정과 한계                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 건물 보조자료      | [OpenStreetMap](https://www.openstreetmap.org/copyright), [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API)                                                      | WGS84                                                         | ODbL 1.0, `© OpenStreetMap contributors` 표시                                                                                         | 2026-08-24 실제 snapshot 보관                                                    | 높이 또는 정수 `building:levels`가 있는 닫힌 way 7,817건. VWorld release 전환 뒤 건물 계산의 주 자료로 함께 활성화하지 않는다.                   |
| 건물 실제 1차 자료 | [국토부 일별 GIS건물통합정보](https://www.data.go.kr/data/15052097/fileData.do), [VWorld 다운로드](https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=18)             | 실제 PRJ에서 `EPSG:5186` 확인                                 | 무료, 이용 제한 없음으로 표시됨. `국토교통부·VWorld` 출처를 표시한다.                                                                 | 원본 기준일 2026-08-06, 2026-08-25 변환·감사                                     | 382,697건 중 A16 직접 높이 180,267건과 A26 층수 추정 72,926건을 사용한다. 높이·층수 결측 129,504건은 제외하므로 그림자 완전성은 보장하지 않는다. |
| 계단 공식자료      | 공공데이터포털·대구 D-데이터허브 조사                                                                                                                                           | 미확정                                                        | 미확정                                                                                                                                | 2026-08-23 검색 기준                                                             | 대구 전역 계단 선형·점 공식자료를 확정하지 못했다. 기관 별도 제공 없이는 계단 부재를 증명하지 않는다.                                            |
| 계단 보조자료      | [OSM `highway=steps`](https://wiki.openstreetmap.org/wiki/Tag%3Ahighway%3Dsteps), [Overpass API](https://overpass-api.de/api/interpreter)                                       | WGS84                                                         | [ODbL 1.0, OpenStreetMap 기여자 표시](https://www.openstreetmap.org/copyright)                                                        | 본 DB는 분 단위 갱신. 추출 시각과 Overpass snapshot 시각을 함께 저장한다.        | 기록된 계단은 위험 증거로 사용할 수 있지만, 태그가 없다는 사실을 무계단 증거로 사용하지 않는다.                                                  |
| 경사·표고          | [국토지리정보원 공개 DEM](https://www.data.go.kr/data/15059920/fileData.do), [국토정보플랫폼](http://map.ngii.go.kr/ms/map/NlipMap.do?tabGb=total)                              | IMG 메타데이터의 수평·수직 기준 확인 전 미확정                | 무료, 이용 제한 없음으로 표시됨.                                                                                                      | 수시 자동 갱신, 페이지 수정 2025-06-17                                           | 지형면 기반 위험 추정에는 사용 가능하나 보도·램프 실제 주행면의 5% 이하를 보증하지 않는다.                                                       |
| 경사 보조자료      | [공간정보산업진흥원 필지별 경사도 1m급](https://www.bigdata-realestate.kr/rebpp/usr/prd/prdInfoDetail.do?req_productId=22)                                                      | SHP `.prj` 확인 전 미확정                                     | `PUBLIC`; 공급자가 권리를 보유한 공공저작물의 자유이용 조건을 원문과 함께 보관한다.                                                   | 연 단위, 상품 등록 2025-10-16                                                    | 필지 단위 평균·최저·최고 값이므로 경로 segment 경사 판정에는 사용하지 않는다.                                                                    |
| 벤치·정자          | [대구 공원시설물 API](https://www.data.go.kr/data/15109600/openapi.do), `getDgFacilityList`, `getDgFacilityItem`                                                                | WGS84로 제공                                                  | 무료, 이용 제한 없음으로 표시됨.                                                                                                      | 실시간 표기, 페이지 수정 2025-05-14                                              | 공원 내 휴식 후보로 사용한다. 도시 전역을 포괄하지 않고 현재 사용 가능 상태나 그늘을 보증하지 않는다.                                            |
| 벤치·정자 보조자료 | [OpenStreetMap](https://www.openstreetmap.org/copyright)의 bench 및 명시적으로 허용한 shelter node                                                                              | WGS84                                                         | ODbL 1.0, `© OpenStreetMap contributors` 표시                                                                                         | 2026-08-24 실제 snapshot 보관                                                    | 230건을 수집했다. 운영 상태·그늘·도시 전역 완전성을 보장하지 않는다.                                                                             |
| 공원시설 백업      | [대구 공원시설물 CSV](https://www.data.go.kr/data/15109656/fileData.do)                                                                                                         | 위도·경도 제공, 상세 datum은 원본 확인 필요                   | 무료 공개자료                                                                                                                         | 1회성, 페이지 수정 2025-06-26                                                    | API 장애 시 snapshot으로만 사용하고 데이터 기준일을 노출한다.                                                                                    |
| 그늘막             | [동구 스마트 그늘막 API](https://www.data.go.kr/data/15110598/openapi.do), [수성구 그늘막 CSV](https://www.data.go.kr/data/15116975/fileData.do)                                | 주소 기반, 확인한 명세에는 위·경도 없음                       | 무료, 이용 제한 없음으로 표시됨.                                                                                                      | 동구 실시간 표기·수정 2025-08-28, 수성구 연간                                    | 일부 구만 제공된다. 주소 지오코딩 결과와 오차를 저장하며 대구 전역 휴식 증거로 사용하지 않는다.                                                  |
| 무더위쉼터         | [대구광역시 D-데이터허브 `무더위쉼터`](https://data.daegu.go.kr/open/data/dataView.do?dataSetId=DMI_0000084579&dataSetDetailId=DDI_0000084589&provdMethod=MAP)의 로컬 SHP 950건 | `Korea_2000_East_Belt_2010` WKT, EPSG:5187 대응. DBF는 EUC-KR | 일반공개 공공데이터. D-데이터허브 정책에 따라 영리 목적을 포함해 자유 이용하며 화면·문서에 `대구광역시 D-데이터허브` 출처를 표시한다. | 등록·최종 수정 2020-04-13, 갱신주기 미정. 최신 개방·운영 상태로 간주하지 않는다. | 공식 위치 원본으로 목적지 쉼터에 사용한다. 현재 개방 여부나 경로 중간의 300m 휴식 지점 증거로 사용하지 않는다.                                   |

API endpoint 원문은 환경 변수 없이 서버 어댑터에 정의한다. 대구 공원시설물 API의 base operation은 `https://apis.data.go.kr/6270000/dgInParkfacility/getDgFacilityList`와 `getDgFacilityItem`, 동구 그늘막 operation은 `https://apis.data.go.kr/3420000/smartShadeOperationService/getSmartShadeOperation`이다. 인증키와 실제 요청 URL은 문서·로그에 남기지 않는다.

## 1.1 현재 실제 공간자료 상태

- 실제 snapshot: `data/spatial/osm/20260824-live`
- VWorld 건물 bundle: `tmp/vworld-buildings-20260806` (`vworld-daegu-20260806`, 253,193건)
- 서비스 경계: 동구·수성구·중구·북구·서구·달서구·남구·달성군 OSM relation의 합집합
- 제외 범위: 군위군. 앱의 현재 공식 쉼터 950건 원본 범위와 일치시키기 위한 명시적 제한이다.
- 계단: `highway=steps` 268건을 위험 증거로 수집했다.
- 출처 감사: raw/gzip checksum, 질의문 checksum, endpoint, 수집시각, OSM 기준시각, 제외 사유를 `provenance.json`과 dataset별 audit에 저장했다.
- DB 상태: 파일 수집과 앱 dry-run은 완료했지만 원격 Supabase active release에는 아직 반영하지 않았다.
- 대구 공원시설물 API: 현재 제공받은 공공데이터포털 키로는 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`가 반환되어 운영 자료로 사용하지 않는다. 권한 승인 전까지 OSM 휴식 지점을 제한된 보조자료로만 사용한다.

OSM 공간자료가 실제 화면 분석에 사용되는 경우 화면 또는 인접한 출처 영역에 `© OpenStreetMap contributors, ODbL 1.0`을 표시해야 한다. 다른 공급자 자료와 결합해 파생 DB를 배포하기 전에는 ODbL 적용 범위를 다시 검토한다.

## 2. TMAP 계약과 보장 경계

[TMAP 공식 보행자 경로안내](https://tmap-skopenapi.readme.io/reference/%EB%B3%B4%ED%96%89%EC%9E%90-%EA%B2%BD%EB%A1%9C%EC%95%88%EB%82%B4)의 `searchOption=30`은 `최단거리+계단제외` 요청이다. 구현에서는 이 값을 후보 생성의 기본값으로 사용한다. 다만 응답에는 무계단을 증명하는 필드가 없고, 공급자 데이터의 계단 완전성·경사율·휴식시설 간격은 보장하지 않는다.

따라서 다음 규칙을 적용한다.

1. TMAP 후보와 교차하는 **확인된** OSM 계단 또는 고경사 DEM segment가 있으면 후보에서 제외할 수 있다.
2. 교차가 없다는 사실은 장애물이 없다는 증거가 아니므로 `VERIFIED_SAFE`로 승격하지 않는다.
3. 공원시설 API에 없는 구간을 `휴식시설 없음` 또는 `300m 조건 충족`으로 단정하지 않는다.
4. 모든 결과에 데이터 기준일, coverage, confidence, unknown reason을 함께 반환한다.
5. 공급자 장애나 데이터 공백은 최단 경로로 조용히 대체하지 않고 `partial` 상태로 표시한다.

## 3. 적재·정규화 계약

`buildings`, `barrier_segments`, `rest_spots`에는 공통 provenance 필드를 둔다.

| 필드                                               | 규칙                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `source_name`, `source_url`                        | 사람이 검증 가능한 공급자명과 문서 URL                                 |
| `source_feature_id`                                | 공급자 원본 ID. 없으면 geometry·유형 기반 안정 hash                    |
| `source_crs`, `target_crs`                         | 원본 `.prj`/메타데이터에서 읽은 값과 `EPSG:4326` 또는 DB SRID          |
| `observed_at`, `dataset_updated_at`, `ingested_at` | 시설 관측, 공급자 기준일, 적재 시각을 혼동하지 않는다.                 |
| `coverage`                                         | `DAEGU_ALL`, `PARK_ONLY`, `DISTRICT_ONLY`, `COMMUNITY_PARTIAL` 중 하나 |
| `confidence`                                       | `VERIFIED_SOURCE`, `DERIVED`, `COMMUNITY`, `UNKNOWN` 중 하나           |
| `unknown_reason`                                   | 미확인 좌표계, 결측 높이, 미지원 구·군 등 공백 사유                    |
| `license_code`, `attribution`                      | 원문 이용 조건과 화면·배포 시 필요한 표시 문구                         |

ETL은 원본 CRS를 확인하지 못하면 실패해야 하며, 좌표 범위만 보고 CRS를 추정하지 않는다. OSM 파생 DB를 다른 데이터와 배포할 때에는 ODbL 적용 범위를 별도로 검토한다.

## 4. 제품 문구와 완료 기준

- 배지: `시연용 접근성 우선 후보`
- 기본 안내: `TMAP 계단 제외 옵션과 공개 공간자료를 반영한 후보입니다. 미등록 계단·급경사·휴식시설 운영 여부는 보장하지 않으므로 이동 전 현장을 확인하세요.`
- 짧은 지도 안내: `접근성 우선 후보 · 계단과 경사는 현장에서 확인해 주세요`
- 금지 표현: `안전 경로`, `무계단 보장`, `경사 5% 이하`, `300m마다 휴식 가능`

Phase 6 완료는 후보 생성·그늘 계산·확인된 위험 증거의 필터링·불확실성 표시까지다. 대구 전역의 현장 검증 자료가 확보되기 전에는 절대 안전 조건 충족을 완료 기준으로 사용하지 않는다.
