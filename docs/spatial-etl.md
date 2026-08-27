# PHASE 6 공간 데이터 ETL 운영 절차

- 최종 확인일: 2026-08-25 KST
- 구현 파일: `scripts/fetch-osm-spatial-data.ts`, `scripts/import-spatial-data.ts`, `scripts/vworld-building-source.ts`, `scripts/prepare-vworld-buildings.ts`, `scripts/import-vworld-buildings.ts`
- DB 함수: `public.import_phase6_spatial_release`, `public.begin_vworld_building_import`, `public.append_vworld_building_import`, `public.finalize_vworld_building_import`, `public.route_spatial_context_at_time`
- 대상 테이블: `spatial_data_releases`, `building_footprints`, `rest_spots`, `barrier_segments`

이 ETL은 건물 그림자와 보행 제약을 계산할 때 쓰는 **공개 공간 증거**를 수집·감사·적재한다. 저장소의 `data/spatial/osm/20260824-live`에는 Overpass API에서 직접 받은 실제 OpenStreetMap snapshot과 정규화 결과가 있다. `supabase/fixtures/local-demo.sql`의 Demo 공간 행은 `DEMO_FIXTURE_NOT_REAL_DATA`, `COMMUNITY_PARTIAL`, `UNKNOWN`으로 표시된 로컬 화면·테스트 전용 자료이며 운영 release로 취급하면 안 된다.

경로 기능의 보장 범위와 공급처 결정은 먼저 [`route-data-contract.md`](./route-data-contract.md)를 따른다. 이 도구를 통과했다는 사실은 공개자료의 구조와 출처가 검증되었다는 뜻이지, 대구 전역의 무계단·5% 이하 경사·휴식시설 운영 상태를 보장한다는 뜻이 아니다.

## 0. 현재 실제 OSM release

현재 서비스 범위는 앱의 공식 쉼터 950건과 같은 대구 8개 구·군(동구·수성구·중구·북구·서구·달서구·남구·달성군)이다. 2023년 편입된 군위군은 이 release에서 제외한다. 군위군 공식 쉼터와 경계 검증을 추가하기 전까지 임의로 대구 전체 coverage라고 표시하지 않는다.

| dataset   | OSM 기준시각(UTC)    | 원본 수 | 통과 수 | 제외 내역                    | manifest version                              |
| --------- | -------------------- | ------: | ------: | ---------------------------- | --------------------------------------------- |
| BUILDING  | 2026-08-24T14:55:21Z |   7,824 |   7,817 | 높이·층수 엄격 파싱 실패 7건 | `osm-building-20260824T145521Z-d9b50a89f03c`  |
| REST_SPOT | 2026-08-24T14:59:21Z |     238 |     230 | 미지원 shelter 유형 8건      | `osm-rest-spot-20260824T145921Z-d3f781b9f151` |
| BARRIER   | 2026-08-24T14:59:21Z |     269 |     268 | 8개 구·군 coverage 밖 1건    | `osm-barrier-20260824T145921Z-262474c8fcf9`   |

세 dataset 모두 앱 ETL dry-run에서 `ok=true`, `acceptedCount=featureCount`, issue 0을 통과했다. `provenance.json`에는 질의문, endpoint, 요청 시각, OSM snapshot 시각, raw/gzip SHA-256, byte 수, 정확한 8개 OSM relation ID가 들어 있다. raw JSON은 gzip으로 보존하며 각 checksum은 실제 압축 해제 결과와 대조한다.

이 release의 이용조건과 표시 문구는 `ODbL-1.0`, `© OpenStreetMap contributors, ODbL 1.0`이다. BUILDING은 높이 또는 `building:levels`가 명시된 일부 건물만 포함하므로 그늘 coverage가 완전하지 않다. REST_SPOT은 운영 상태를 보장하지 않고, BARRIER에 계단이 없다는 사실은 무계단 증거가 아니다.

현재 상태는 **실제 파일 수집·감사 완료 / 원격 Supabase 미적재**다. 원격 migration과 호환 배포가 완료되기 전에는 `--apply`를 실행하지 않는다.

## 0.1 VWorld 대구 GIS건물통합정보 release

VWorld `AL_D010_27_20260809` SHP/SHX/DBF/PRJ를 직접 감사했다. 원본 CRS는 PRJ의 `EPSG:5186`으로 확인했으며, 대구 9개 구·군(군위군 포함) 레코드만 처리한다.

| 항목                     |    건수 |
| ------------------------ | ------: |
| 원본 건물                | 382,697 |
| A16 직접 높이 사용       | 180,267 |
| A26 지상층수 × 3m 추정   |  72,926 |
| 높이·층수 모두 없어 제외 | 129,504 |
| 최종 적재 대상           | 253,193 |

- release version: `vworld-daegu-20260806`
- source ID: 중복을 피하기 위해 A0 도형식별자와 A1 GIS건물통합식별번호를 함께 사용
- 직접 높이 허용 범위: 1~200m
- 추정 version: `vworld-a26-3m-v1`
- 변환 결과: gzip NDJSON 21,549,440 bytes, 500건 기준 507개 배치
- 감사 결과: 타지역·잘못된 geometry·중복 source ID·삭제 레코드 모두 0

생성 번들은 `tmp/vworld-buildings-20260806`에 있으며 Git에서 제외한다. 기존 OSM `REST_SPOT`·`BARRIER` release는 유지하고 `BUILDING` release만 VWorld 버전으로 교체한다.

## 1. 입력 준비

한 release마다 다음 두 JSON 파일을 준비한다.

1. `manifest.json`: 출처·라이선스·좌표계·기준일·coverage·품질 기준
2. `features.geojson`: 한 종류의 정규화 전 GeoJSON `FeatureCollection`

건물, 휴식 지점, 장벽을 한 파일에 섞지 않는다. 각 파일은 `BUILDING`, `REST_SPOT`, `BARRIER` 중 하나의 별도 version으로 적재한다. 원본 SHP·DBF·CSV·API 응답을 GeoJSON으로 변환하는 전처리는 공급처별로 수행하되, 원본 파일과 변환 명령 및 checksum을 release 작업 기록에 함께 보관한다.

### 좌표계 규칙

- `sourceCrs`는 원본 `.prj`, WKT 또는 공급자 메타데이터에서 확인한 값을 반드시 명시한다. 좌표 숫자의 범위로 추정하지 않는다.
- 현재 허용 목록은 `EPSG:4326`, `EPSG:5186`, `EPSG:5187`이다.
- VWorld `EPSG:5186`은 중앙 자오선 127°의 Korea 2000 / Central Belt 2010 정의를 사용한다.
- `EPSG:5187` 입력 좌표는 GeoJSON x/y 순서인 `[easting, northing]`으로 읽는다. EPSG 축 이름을 이유로 자동 교환하지 않는다.
- 모든 출력 geometry는 `EPSG:4326`으로 변환된다.
- 다른 CRS가 확인되면 코드에 검증된 변환을 추가하고 회귀 fixture를 먼저 작성한다. CRS 이름을 4326으로 바꿔 우회하면 안 된다.
- `coverageGeometry` 자체는 `coverageCrs: "EPSG:4326"`인 유효한 Polygon 또는 MultiPolygon이어야 한다. 실제 공급 범위를 나타내는 경계이며 임의의 큰 사각형을 사용하지 않는다.

`EPSG:5187` 변환 매개변수는 EPSG의 KGD2002 / East Belt 2010 정의(원점 위도 38°, 중앙 자오선 129°, 축척 1, false easting 200000m, false northing 600000m, GRS80)를 고정 사용한다.

## 2. manifest 계약

알 수 없는 필드는 거부한다. 최소 예시는 다음과 같다. 아래 URL과 이름은 문서 설명용이며 실제 적재에 사용하면 안 된다.

```json
{
  "schemaVersion": 1,
  "dataset": "BUILDING",
  "version": "2026-08-20-v1",
  "sourceName": "실제 제공기관과 자료명",
  "sourceUrl": "https://example.invalid/replace-with-real-metadata-page",
  "licenseCode": "원문에 표시된 실제 이용조건",
  "attribution": "화면과 배포물에 표시할 실제 출처 문구",
  "sourceCrs": "EPSG:5187",
  "targetCrs": "EPSG:4326",
  "coverageCrs": "EPSG:4326",
  "datasetUpdatedAt": "2026-08-20T00:00:00+09:00",
  "coverage": "DAEGU_ALL",
  "confidence": "VERIFIED_SOURCE",
  "unknownReason": null,
  "coverageGeometry": {
    "type": "MultiPolygon",
    "coordinates": []
  },
  "quality": {
    "maxDuplicateRate": 0,
    "maxDatasetAgeDays": 30
  },
  "rules": {
    "kind": "BUILDING",
    "allowFloorEstimate": true,
    "floorHeightM": 3,
    "heightEstimationVersion": "SOURCE-FLOOR-COUNT_X_3M_V1"
  }
}
```

`coverageGeometry.coordinates`에는 실제 검증된 경계를 넣어야 한다. 빈 배열인 위 예시는 실행 가능한 fixture가 아니다.

| 필드                         | 필수 규칙                                                                  |
| ---------------------------- | -------------------------------------------------------------------------- |
| `version`                    | 동일 dataset에서 불변인 release 식별자. 같은 version 재적재는 거부한다.    |
| `sourceName`, `sourceUrl`    | 사람이 원본을 확인할 수 있는 명칭과 HTTPS 메타데이터 URL                   |
| `licenseCode`, `attribution` | 원문 이용조건과 표시 문구. 둘 다 비워 둘 수 없다.                          |
| `sourceCrs`                  | 원본에서 확인한 EPSG 코드. 현재 4326, 5186 또는 5187만 허용                |
| `datasetUpdatedAt`           | 공급자 기준일. 수집시각·적재시각과 혼동하지 않는 offset 포함 ISO 8601 시각 |
| `coverage`                   | `DAEGU_ALL`, `PARK_ONLY`, `DISTRICT_ONLY`, `COMMUNITY_PARTIAL` 중 하나     |
| `confidence`                 | `VERIFIED_SOURCE`, `DERIVED`, `COMMUNITY`, `UNKNOWN` 중 하나               |
| `unknownReason`              | coverage가 `COMMUNITY_PARTIAL`이거나 confidence가 `UNKNOWN`이면 필수       |
| `quality.maxDuplicateRate`   | 0~0.1. 운영 기본값은 0을 권장                                              |
| `quality.maxDatasetAgeDays`  | 감사시각 기준 허용할 최대 자료 나이(1~3650일)                              |

## 3. GeoJSON feature 계약

모든 feature는 다음 공통 구조를 사용한다. `properties`의 알 수 없는 필드는 거부하므로, 공급자 원본 필드 전체를 그대로 복사하지 말고 필요한 값만 명시적으로 매핑한다.

```json
{
  "type": "Feature",
  "geometry": {},
  "properties": {
    "sourceFeatureId": "공급자 원본 ID",
    "observedAt": "2026-08-19T00:00:00+09:00",
    "unknownReason": null
  }
}
```

### BUILDING

- geometry: `Polygon` 또는 `MultiPolygon`; DB에는 MultiPolygon으로 통일
- 직접 높이: `heightM`(0 초과, 1000 이하)와 `heightSource`를 함께 입력
- 층수 추정: 직접 높이가 없을 때 `floorCount`를 입력한다. manifest의 `allowFloorEstimate`가 `true`일 때만 `floorCount × floorHeightM`을 사용한다.
- 층수 추정 결과는 `heightSource=DERIVED_FLOOR_COUNT`, `heightIsEstimated=true`, `heightEstimationVersion`과 함께 저장한다.
- 높이와 층수가 모두 없으면 건물은 적재하지 않고 실패한다. 임의 기본 높이를 넣지 않는다.

### REST_SPOT

- geometry: `Point`
- `restType`: `BENCH`, `PAVILION`, `SHADE_CANOPY`, `PARK_FACILITY` 중 하나
- 목록에 없는 시설을 가장 가까운 유형으로 임의 변환하지 않는다. 계약을 검토하고 명시적으로 확장한다.

### BARRIER

- geometry: `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon` 중 하나
- 계단: `barrierType=STAIRS`; `slopePercent`와 `slopeSource`는 넣지 않는다.
- DEM 급경사: `barrierType=STEEP_SLOPE`, `slopePercent > 5`, 비어 있지 않은 `slopeSource`가 모두 필요하다.
- 경사율이 정확히 5%이거나 그보다 낮은 DEM segment는 장벽 자료로 적재하지 않는다.
- OSM에 계단 태그가 없다는 사실은 무계단 증거가 아니다.

## 4. 품질 게이트

dry-run과 DB RPC가 다음 조건을 검사한다.

1. manifest와 FeatureCollection의 strict schema
2. 명시된 CRS가 변환 허용 목록에 있는지
3. polygon ring 닫힘과 geometry 유효성·비어 있지 않음
4. coverage geometry와 모든 feature가 대구 방어 범위 및 선언된 coverage 안에 포함되는지
5. `sourceFeatureId` 고유성
6. source ID를 제외한 정규화 feature의 중복률
7. 공급자 기준일의 미래 여부와 최대 나이
8. 건물 높이의 양수 범위 및 추정 provenance
9. 휴식 시설 허용 유형
10. 계단과 DEM 5% 초과 장벽의 분리
11. source, license, attribution, coverage, confidence, unknown reason 완전성

대구 방어 범위(경도 128.33~~128.78, 위도 35.58~~36.02)는 명백한 타지역 적재를 막는 2차 안전장치다. 실제 행정경계 또는 공급 범위인 `coverageGeometry`를 대체하지 않는다.

감사 결과에는 feature 원문이나 geometry를 복사하지 않고 dataset/version, 개수, 중복률, 오류 코드·경로만 남긴다. API 키, Supabase secret key, 전체 HTTP 요청은 출력하지 않는다.

## 5. 실행 순서

### 5.0 실제 OSM snapshot 수집

새 디렉터리만 허용하며 기존 release를 덮어쓰지 않는다. Overpass에는 POST, 명시적 User-Agent, 응답 byte 상한, timeout, 제한된 재시도와 endpoint 순환을 적용한다. `remark`가 포함된 부분 응답과 열린·모호한 행정경계는 실패 처리한다.

```powershell
npm run spatial:osm:fetch -- --output data/spatial/osm/YYYYMMDD-live
```

수집 순서는 경계 → 건물 → 휴식 지점 → 계단이며 각 응답 도착 뒤 그 snapshot 시각을 기준으로 즉시 dry-run한다. 하나라도 실패하면 최종 디렉터리로 원자 rename하지 않는다.

### 5.1 dry-run

```powershell
bun scripts/import-spatial-data.ts `
  --manifest C:\spatial\building-manifest.json `
  --geojson C:\spatial\building-features.geojson `
  --dry-run `
  --audit-out C:\spatial\audit\building-2026-08-20.json `
  --audited-at 2026-08-24T00:00:00+09:00
```

`--audited-at`을 고정하면 CI와 로컬에서 기준일 판정이 재현된다. 생략하면 실행 시각을 사용한다. `ok: false`이면 DB 호출은 일어나지 않는다.

### 5.1.1 VWorld 변환·배치 드라이런

```powershell
npm run spatial:vworld -- `
  --source-dir C:\data\AL_D010_27_20260809 `
  --base-name AL_D010_27_20260809 `
  --write `
  --output-dir tmp\vworld-buildings-20260806

npm run spatial:vworld:import -- `
  --bundle-dir tmp\vworld-buildings-20260806 `
  --dry-run
```

기존 출력 파일은 덮어쓰지 않는다. 다시 만들려면 새 출력 디렉터리를 사용한다.

### 5.2 적용 전 확인

- 감사 JSON의 `ok=true`, `acceptedCount=featureCount` 확인
- 원본 checksum과 manifest version 연결 확인
- 라이선스 및 attribution 문구 재확인
- `DAEGU_ALL`이면 실제 전체 행정경계와 원본 coverage 일치 확인
- 층수 추정 version과 `floorHeightM`에 대한 근거 기록 확인
- Demo source 이름·`example.invalid` URL이 아닌지 확인

### 5.3 원자 적용

`SUPABASE_URL`에는 `/rest/v1`이 없는 프로젝트 root URL을, `SUPABASE_SECRET_KEY`에는 서버 전용 secret/service-role key를 실행 환경에서만 주입한다. 키를 명령행, manifest, audit 파일 또는 Git에 넣지 않는다.

```powershell
bun scripts/import-spatial-data.ts `
  --manifest C:\spatial\building-manifest.json `
  --geojson C:\spatial\building-features.geojson `
  --apply `
  --audit-out C:\spatial\audit\building-2026-08-20.json `
  --audited-at 2026-08-24T00:00:00+09:00
```

적용 RPC의 순서는 다음과 같다.

1. 새 release를 `active=false`로 생성
2. DB에서 manifest·audit·feature 개수·source ID·geometry·coverage·dataset별 제약을 재검사
3. 새 release의 모든 feature를 적재
4. 적재 행 수를 다시 확인
5. 같은 dataset의 기존 active release를 비활성화
6. 새 release를 활성화하고 결과 요약만 반환

이 과정은 하나의 PostgreSQL 함수 호출/트랜잭션이다. 어느 검사든 실패하면 새 release와 feature가 모두 롤백되고 기존 active release는 유지된다. `anon`과 `authenticated`에는 함수 실행권한과 공간 테이블 권한이 없으며 `service_role`만 호출할 수 있다.

VWorld 건물은 25만 건이므로 한 RPC에 넣지 않는다. 새 release를 비활성 상태로 연 뒤 최대 500건씩 멱등 적재하며, 감사 JSON의 직접 높이·추정 높이·전체 건수가 모두 일치할 때만 마지막 RPC가 활성화한다. 중단되면 같은 명령으로 재개할 수 있고 이미 들어간 source ID는 중복 삽입하지 않는다.

```powershell
npm run spatial:vworld:import -- `
  --bundle-dir tmp\vworld-buildings-20260806 `
  --apply
```

이 명령보다 먼저 `20260825065350_vworld_building_import.sql` migration이 적용되어 있어야 한다. `SUPABASE_URL`과 `SUPABASE_SECRET_KEY`는 실행 환경에서만 제공한다.

현재 실제 release를 적용할 때는 `building`, `rest-spot`, `barrier` 순서로 각각 해당 manifest·GeoJSON·audit 파일을 지정한다. 세 release가 모두 성공하고 dataset별 active release가 정확히 하나인지 확인하기 전에는 공간 분석을 운영에서 활성화하지 않는다.

## 6. 검증 명령

```powershell
bun x vitest run src/lib/spatial/osm-spatial-source.test.ts
bun x vitest run src/lib/spatial/import-spatial-data.test.ts
bun x vitest run src/lib/spatial/vworld-building-source.test.ts
bun x vitest run src/lib/spatial/import-vworld-buildings.test.ts
bun x vitest run src/lib/spatial/phase6-spatial-import-migration.test.ts
bun x eslint scripts/fetch-osm-spatial-data.ts scripts/import-spatial-data.ts src/lib/spatial/osm-spatial-source.test.ts src/lib/spatial/import-spatial-data.test.ts src/lib/spatial/phase6-spatial-import-migration.test.ts
```

DB 컨테이너를 사용할 수 있는 환경에서는 전체 migration reset과 pgTAP도 추가로 실행한다.

```powershell
bun run supabase:reset
bun run supabase:test
```

운영 반영 후에는 `spatial_data_releases`에서 dataset별 active release가 정확히 하나인지, `quality_audit`, `coverage_geom`, `source_updated_at`, `attribution`이 채워졌는지 확인한다. 라우팅 결과는 active release의 version 조합을 cache key에 포함하므로 release 변경 후 이전 공간 version의 결과를 재사용하면 안 된다.
