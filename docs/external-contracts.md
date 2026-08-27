# 외부 API 계약 잠금

- 확인 시각: 2026-08-23 KST
- 확인 방법: 공식 문서 재검토 + 대구 좌표를 사용한 읽기 전용 최소 실호출
- 비밀정보 정책: 키 원문, 응답 원문, 개인 식별 정보는 이 문서와 저장소에 기록하지 않는다.

## 1. 현재 결론

| 영역        | 사용할 공급자·기능        | 실호출 결과                                                  | 구현 결정                                                                                      |
| ----------- | ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| DB/Auth     | Supabase Auth·Data API    | anon, service role, Data API 모두 HTTP 200                   | SDK에는 프로젝트 루트 URL을 사용하고 RLS를 전제로 한다. 새 publishable/secret 키로 교체한다.   |
| 1차 기상    | KMA API허브 500m 체감온도 | 지점 다중요소, 전체 `ta_chi`, 위도·경도 격자 모두 HTTP 200   | `ta_chi`를 1차 체감온도로 사용한다.                                                            |
| 기상 폴백   | 공공데이터포털 단기예보   | `getVilageFcst`, 대구 `nx=89, ny=90`, `resultCode=00`, 798건 | TMP/REH를 폴백 입력으로 사용한다.                                                              |
| 기상특보    | KMA API허브 특보현황 신형 | `wrn_now_data_new.php` HTTP 200, 데이터 확인                 | `fe=e` 발효시각 기준으로 조회하고 대구·폭염 코드만 필터한다.                                   |
| 의약품 식별 | 식약처 낱알식별           | HTTP 200, `NORMAL SERVICE.`, 25,372건                        | OCR/Gemini 후보를 품목기준코드로 확정할 때 사용한다.                                           |
| 의약품 설명 | 식약처 e약은요            | 샘플 품목 1건 HTTP 200                                       | 효능·용법·주의사항 표시용이며 의료 조언으로 표현하지 않는다.                                   |
| 의약품 안전 | 식약처 DUR 품목정보 9종   | 9개 operation 모두 HTTP 200, `NORMAL SERVICE.`               | 품목·병용·노인·연령·용량·기간·효능중복·서방정분할·임부 데이터를 서버에서 결합한다.             |
| 약봉투 AI   | Gemini API                | `models/gemini-3.5-flash` 메타데이터 HTTP 200                | 모델 ID를 `gemini-3.5-flash`로 고정하고 Structured Output을 사용한다.                          |
| 지도 표시   | Naver Web Dynamic Map     | JS loader HTTP 200, 인증 실패 신호 없음                      | 브라우저에는 `ncpKeyId`만 노출하고 허용 도메인을 제한한다.                                     |
| 주소 검색   | Naver Geocoding           | 실제 대구 도로명주소 1건 HTTP 200                            | 현재 Maps 호스트를 서버에서 호출한다.                                                          |
| 역지오코딩  | Naver Reverse Geocoding   | 구 호스트 HTTP 401, 현재 호스트 HTTP 403                     | 현재 권한으로 사용 불가. 콘솔에서 Reverse Geocoding을 추가하기 전까지 필수 흐름에 넣지 않는다. |
| 보행 경로   | TMAP 보행자 경로안내      | HTTP 200, 21 features, 568m, 497초                           | Naver 지도 위에 TMAP GeoJSON 경로를 그린다. TMAP 호출은 서버 프록시로만 수행한다.              |

수치는 계약 확인용 1회 응답이며 서비스 데이터 총량과 시각에 따라 바뀐다. 성공 판정은 HTTP 상태만이 아니라 공급자 정상 코드와 기대 필드 존재 여부를 함께 확인했다.

## 2. 환경 변수와 공개 범위

| 변수                            | 실행 위치 | 공개 가능 | 용도                                      |
| ------------------------------- | --------- | --------: | ----------------------------------------- |
| `VITE_SUPABASE_URL`             | 브라우저  |        예 | Supabase 프로젝트 루트 URL                |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 브라우저  |        예 | RLS가 적용된 사용자 클라이언트            |
| `VITE_NAVER_MAPS_NCP_KEY_ID`    | 브라우저  |        예 | Naver Maps JS loader의 `ncpKeyId`         |
| `SUPABASE_URL`                  | 서버      |        예 | 서버용 Supabase 프로젝트 루트 URL         |
| `SUPABASE_PUBLISHABLE_KEY`      | 서버      |        예 | 사용자 세션용 서버 클라이언트             |
| `SUPABASE_SECRET_KEY`           | 서버      |    아니요 | 관리자 작업. 브라우저·로그·오류 응답 금지 |
| `DATA_GO_SERVICE_KEY`           | 서버      |    아니요 | 단기예보와 식약처 API 공용 포털 키        |
| `KMA_APIHUB_AUTH_KEY`           | 서버      |    아니요 | API허브 500m·특보 키                      |
| `GEMINI_API_KEY`                | 서버      |    아니요 | 약봉투 이미지 판독                        |
| `NAVER_MAPS_CLIENT_ID`          | 서버      |    아니요 | Naver Maps REST 헤더 ID                   |
| `NAVER_MAPS_CLIENT_SECRET`      | 서버      |    아니요 | Naver Maps REST 헤더 secret               |
| `TMAP_APP_KEY`                  | 서버      |    아니요 | TMAP `appKey` 헤더                        |

SDK에 전달할 Supabase URL은 `https://<project-ref>.supabase.co` 형식이다. 사용자가 제공한 `/rest/v1/` URL은 REST 호출 베이스일 뿐 SDK 프로젝트 URL로 저장하지 않는다.

이번 대화에 입력된 모든 키는 노출된 값으로 간주한다. 구현 전 재발급하고 로컬 `.env` 또는 배포 환경 변수에만 저장한다. 특히 Supabase의 legacy `anon`/`service_role` JWT는 2026년 말 폐기 예정이므로 `sb_publishable_...`/`sb_secret_...`로 교체한다. TMAP의 `Any IP allowed`도 운영 서버 IP 또는 허용 환경으로 제한한다.

## 3. 기상 계약

### 3.1 KMA API허브 500m

- 지점 다중요소: `GET https://apihub.kma.go.kr/api/typ01/url/sfc_nc_var.php`
- 전체영역 단일요소: `GET https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-sfc_obs_nc_api`
- 격자 위·경도: `GET https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-sfc_obs_latlon_api`
- 필수 요소: `ta_chi`, `ta`, `hm`
- 시각: KST `yyyyMMddHHmm`; 운영 조회는 생산 지연을 고려해 확정된 최신 5분 슬롯을 고른다.
- 파싱: 응답은 JSON이 아닌 텍스트/격자 형식이다. 주석·결측치·격자 크기를 어댑터에서 검증하고 도메인에는 정규화 값만 넘긴다.

전체영역은 호출당 응답이 크다. 대상자 좌표가 소수이면 지점 다중요소를 우선하고, 전체영역은 여러 고유 지점을 한 번에 처리하는 배치에서만 벤치마크 후 선택한다.

### 3.2 단기예보 폴백

- endpoint: `GET https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst`
- 대구 대표 격자: `nx=89`, `ny=90`
- 필요한 category: `TMP`, `REH`
- base time: 02/05/08/11/14/17/20/23시 발표 슬롯 중 제공 지연을 지난 최신 슬롯
- 정상 조건: HTTP 200, `response.header.resultCode === "00"`, `body.items.item` 존재
- 체감온도 폴백: 기상청이 2022-06-02부터 사용하는 여름철 산식과 Stull 습구온도 추정식을 그대로 사용한다. 단순히 습구온도 `Tw`를 체감온도로 사용하지 않는다.

```text
Tw = Ta·atan(0.151977·sqrt(RH+8.313659)) + atan(Ta+RH)
     - atan(RH-1.676331) + 0.00391838·RH^(3/2)·atan(0.023101·RH) - 4.686035
체감온도 = -0.2442 + 0.55399·Tw + 0.45535·Ta - 0.0022·Tw² + 0.00278·Tw·Ta + 3.0
```

- 열대야: KST 기준 전일 18:01~당일 09:00의 최저기온이 25℃ 이상인 완전한 관측 구간만 1일로 센다. 관측 공백은 0일이 아니라 `partial`이다.
- 동일 관측시각을 다시 수집한 경우 `collected_at`이 가장 최신인 revision만 열대야 계산에 사용한다.
- 3시간 이내 값은 최근 캐시로, 3~24시간 값은 `LAST_VALID`·`partial`로만 사용한다. 24시간을 넘으면 새 HRI 계산을 중단하고 마지막 위험도 스냅샷을 유지한다.

500m 격자와 단기예보 5km 격자는 서로 다른 좌표 체계·해상도다. 첨부된 `격자_위경도(2607).xlsx`는 단기예보용이며 API허브 500m 인덱스로 사용하지 않는다.

### 3.3 특보

- endpoint: `GET https://apihub.kma.go.kr/api/typ01/url/wrn_now_data_new.php`
- 고정 인자: `fe=e`, `disp=0`, `help=0`
- 앱 필터: 폭염 `WRN=H`, 대구 특보구역, 유효한 발효/종료 시각
- 저장 키: 발표시각·발효시각·특보구역코드·특보종류·수준·명령 조합

## 4. 의약품 계약

공통 정상 응답은 `{ header, body }` 최상위 구조이며 기상청의 `{ response: { header, body } }` 구조와 다르다. 공통 어댑터에서 두 구조를 혼동하지 않는다.

| 기능           | endpoint                                                                |
| -------------- | ----------------------------------------------------------------------- |
| 낱알식별       | `/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03`      |
| e약은요        | `/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList`                    |
| DUR 품목       | `/1471000/DURPrdlstInfoService03/getDurPrdlstInfoList03`                |
| 병용금기       | `/1471000/DURPrdlstInfoService03/getUsjntTabooInfoList03`               |
| 노인주의       | `/1471000/DURPrdlstInfoService03/getOdsnAtentInfoList03`                |
| 특정연령대금기 | `/1471000/DURPrdlstInfoService03/getSpcifyAgrdeTabooInfoList03`         |
| 용량주의       | `/1471000/DURPrdlstInfoService03/getCpctyAtentInfoList03`               |
| 투여기간주의   | `/1471000/DURPrdlstInfoService03/getMdctnPdAtentInfoList03`             |
| 효능군중복     | `/1471000/DURPrdlstInfoService03/getEfcyDplctInfoList03`                |
| 서방정분할주의 | `/1471000/DURPrdlstInfoService03/getSeobangjeongPartitnAtentInfoList03` |
| 임부금기       | `/1471000/DURPrdlstInfoService03/getPwnmTabooInfoList03`                |

호스트는 `https://apis.data.go.kr`이며 `serviceKey`는 URL 인코딩을 정확히 한 번만 적용한다. 모든 결과는 `itemSeq` 등 공식 식별자로 결합하고 제품명 문자열만으로 병합하지 않는다.

한 이미지 분석은 낱알식별 최대 5회, e약은요+DUR 9종 상세 결합 최대 3개 품목, 전체 12초로 제한한다. 모호한 낱알 후보는 식별 결과만 표시하고 사용자가 고르기 전에 모든 후보의 상세 API를 선조회하지 않는다. 단일 확정 후보는 e약은요와 DUR 9종을 모두 조회하며, 공급자별 `AVAILABLE`·`PARTIAL`·`UNAVAILABLE` 상태를 UI에 표시한다.

## 5. Gemini 계약

- model: `gemini-3.5-flash`
- 메타데이터 확인: `GET https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash`
- 입력: 이미지 + 추출 지시문
- 출력: JSON Schema 기반 Structured Output
- 서버 검증: 모델 응답을 그대로 신뢰하지 않고 Zod로 품목명 후보, 제조사 후보, 복용 텍스트, confidence, image quality를 파싱한다.
- 호출 예산: 최초 추출과 스키마 재프롬프트를 합쳐 이미지당 최대 2회, 하나의 전체 deadline을 공유한다.
- 스키마 호환: 현재 모델이 거부하는 복합 스키마의 `maxItems`·문자열 길이 힌트는 Gemini 요청에서만 제거하고, 서버 Zod 경계에서는 최대 30개와 문자열 길이를 그대로 강제한다.
- 스키마 재시도 후에도 실패하면 정제된 약품 텍스트만 편집 가능한 수동 입력 초기값으로 반환하고 원문은 저장하지 않는다.
- 금지: Gemini 결과만으로 약을 확정하거나 복용 변경을 권고하지 않는다.

## 6. 지도와 보행 경로 계약

### 6.1 Naver Maps

- JS loader: `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=...`
- Geocoding 실사용 호스트: `https://maps.apigw.ntruss.com/map-geocode/v2/geocode`
- REST 헤더: `x-ncp-apigw-api-key-id`, `x-ncp-apigw-api-key`
- Reverse Geocoding: 현재 403이므로 Naver Cloud Maps 애플리케이션에서 해당 API를 추가 신청한 뒤 재검증한다.
- 브라우저 키에는 운영/preview/localhost 허용 도메인을 명시하고 `window.navermap_authFailure` 처리기를 둔다.

### 6.2 TMAP 보행자 경로

- endpoint: `POST https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1`
- 인증: 서버의 `appKey` 헤더
- 좌표: WGS84 경도 `X`, 위도 `Y`
- 요청 필수값: `startX`, `startY`, `endX`, `endY`, `startName`, `endName`, `reqCoordType`, `resCoordType`
- 응답: GeoJSON `features`; 첫 Point의 properties에서 전체 거리·시간, LineString에서 폴리라인을 추출한다.
- 계약 확인 호출에서는 `searchOption=30`이 정상 수락됐다.

TMAP 응답만으로 계단 없음·경사 5% 이하를 증명하지 않는다. 별도 `barrier_segments`·DEM·휴식 지점 데이터가 확보되기 전 UI 문구는 `접근성 우선 후보 · 계단과 경사는 현장에서 확인해 주세요`로 제한한다.

## 7. 캐시·오류·쿼터 원칙

- 기상 TTL 25분, 의약품 TTL 30일, 주소검색 TTL 30일, 경로 TTL은 출발 격자·도착지·옵션 단위 10분을 기본값으로 한다.
- 공급자 HTTP 200이어도 내부 result code와 필수 필드가 없으면 실패다.
- timeout, 429, 5xx, 파싱 실패를 구분하고 마지막 정상값이 있으면 `stale` 시각과 함께 반환한다.
- 키·전체 요청 URL·원본 약봉투·개인 좌표를 로그에 남기지 않는다.
- Naver/TMAP 콘솔에서 사용량 알림과 상한을 설정한다. 실제 과금 한도는 계정 콘솔 값이므로 코드 상수로 추정하지 않는다.

## 8. 공식 자료

- [Supabase changelog](https://supabase.com/changelog)
- [Supabase 새 API 키 마이그레이션](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Supabase API 키 이해](https://supabase.com/docs/guides/getting-started/api-keys)
- [Gemini 3.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash)
- [Gemini Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)
- [기상청 단기예보 조회서비스](https://www.data.go.kr/data/15084084/openapi.do)
- [기상자료개방포털 여름철 체감온도 산출식](https://data.kma.go.kr/climate/windChill/selectWindChillChart.do)
- [기상청 열대야 정의](https://www.weather.go.kr/w/special-report/overall.do)
- [기상청 API허브](https://apihub.kma.go.kr/)
- [식약처 의약품 낱알식별](https://www.data.go.kr/data/15057639/openapi.do)
- [식약처 e약은요](https://www.data.go.kr/data/15075057/openapi.do)
- [식약처 DUR 품목정보](https://www.data.go.kr/data/15059486/openapi.do)
- [Naver Maps 개요](https://guide.ncloud-docs.com/docs/maps-overview)
- [Naver Geocoding](https://api.ncloud-docs.com/docs/ai-naver-mapsgeocoding-geocode)
- [Naver Reverse Geocoding](https://api.ncloud-docs.com/docs/ai-naver-mapsreversegeocoding-gc)
- [Naver Maps JS API v3 시작](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)
- [TMAP API 가이드](https://tmapapi.tmapmobility.com/main.html)
