# 온중(溫證)

대구 폭염 취약 어르신의 개인별 위험도를 계산하고 복약·쉼터·돌봄 기록을 연결하는
AI·블록체인 시연 서비스입니다. Supabase/PostGIS에 운영 데이터를 저장하고 검증 가능한
이벤트는 Base Sepolia 테스트넷 EAS에 기록합니다.

> `supabase/fixtures/local-demo.sql`의 대상자와 공간 자료는 로컬 회귀 테스트 전용 가상
> 데이터이며 운영에는 올리지 않습니다. 공유 `supabase/seed.sql`은 빈 파일이고 자동 seed는
> 비활성화되어 있습니다. 실제 문자·알림톡 공급자가 연결되기 전까지 보호자 알림은
> `disabled`입니다.

## 주요 기능

- KMA 500m 관측과 단기예보 폴백 기반 HRI(0~~100, L0~~L4)
- 권한별 대시보드, 대상자 상세, L4 확인 처리
- Gemini 판독·사용자 확인·MFDS DUR 9종 검증을 거치는 복약 등록
- Naver 지도, TMAP 보행 후보, 그늘·접근성 불확실성을 포함한 쉼터 탐색
- 익명 운영상태 제보와 인증 대상자 체크인의 분리
- 1회용 보호자 링크와 Base Sepolia EAS 공개 검증
- lease와 idempotency key를 사용하는 위험·알림·EAS·보존 worker

## 빠른 시작

준비물은 Bun 1.3.14, Node.js 22 이상, Docker, 승인된 개발용 API 자격증명입니다.

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run env:generate-secrets
bun run supabase:start
bun run supabase:reset
bun run dev
```

`supabase:reset`은 인자를 받지 않는 안전 wrapper입니다. 실행 중인 Supabase DB가
`supabase/config.toml`의 포트와 일치하는 loopback 주소인지 확인한 뒤에만 정확히
`db reset --local --no-seed`를 실행하고 로컬 Demo fixture를 적용합니다.

Windows에서는 `.env.example`을 `.env`로 복사한 뒤 값을 입력합니다.
`env:generate-secrets`는 비어 있는 HMAC/Cron 값 3개만 서로 다른 로컬 secret으로 채우며
기존 값을 덮어쓰거나 값을 콘솔에 출력하지 않습니다. Supabase URL은
`/rest/v1`이 아닌 프로젝트 루트 URL이어야 합니다. secret을 소스·문서·로그에 쓰지 마세요.
Docker가 없으면 단위/계약 테스트와 빌드는 가능하지만 migration, pgTAP, DB 타입 생성은
검증할 수 없습니다.

## 환경 변수

전체 목록은 [`.env.example`](.env.example)을 사용합니다.

| 범주      | 변수                                                               | 범위                            |
| --------- | ------------------------------------------------------------------ | ------------------------------- |
| 브라우저  | `VITE_SUPABASE_*`, `VITE_NAVER_MAPS_NCP_KEY_ID`                    | 공개 식별자·publishable key만   |
| Supabase  | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`  | secret key는 서버 전용          |
| 데이터·AI | `DATA_GO_SERVICE_KEY`, `KMA_APIHUB_AUTH_KEY`, `GEMINI_API_KEY`     | 서버 전용                       |
| 지도·경로 | `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET`, `TMAP_APP_KEY` | REST secret/app key는 서버 전용 |
| EAS       | RPC URL, attester private key, schema UID 2개, expected issuer     | 서버 전용                       |
| 작업      | `SUBJECT_HASH_SECRET`, `REPORTER_HASH_SECRET`, `CRON_SECRET`       | 환경별 분리                     |

알림 설정은 `NOTIFICATION_PROVIDER=disabled`, `NOTIFICATION_LIVE_SEND_ENABLED=false`로
고정합니다. 테스트 전용 demo adapter는 운영 Cron에서 실행되지 않습니다.
HMAC secret은 32바이트 이상의 무작위 값으로 만들고 Preview/Production에서 분리합니다.

원격 Supabase의 최초 운영 조직과 ADMIN 계정은 네 `BOOTSTRAP_*` 값을 로컬 `.env`에 잠시
설정한 뒤 아래 명령으로 한 번만 생성합니다. 성공 즉시 bootstrap 비밀번호를 파일에서
지웁니다.

```bash
bun run admin:bootstrap
```

## 로컬 시연 계정

`bun run supabase:reset`이 로컬 Demo fixture로 만드는 `.invalid` 도메인의 전용 계정입니다.

| 역할        | 이메일                            | 비밀번호                 |
| ----------- | --------------------------------- | ------------------------ |
| 관리자      | `demo-admin@onjung.invalid`       | `onjung-local-demo-only` |
| 돌봄 담당자 | `demo-care-worker@onjung.invalid` | `onjung-local-demo-only` |

로컬 Demo fixture에는 가상 대상자 5명, 쉼터 950곳, iM뱅크 쉼터 100곳과 부분 coverage
공간 자료가 포함됩니다. 이 계정과 자료를 운영에 사용하지 마세요.

## 검증

```bash
bun run lint
bun run typecheck
bun run test
bun run security:scan
bun run test:e2e
bun run test:live-apis
bun run supabase:reset
bun run supabase:test
bun run supabase:schema-check
bun run supabase:types-check
bun run build
node scripts/verify-vercel-build.mjs
bun run security:scan
```

`test:live-apis`는 `.env`의 실제 자격증명으로 KMA·Supabase 쉼터 집계·Gemini·MFDS
낱알/e약/DUR·Naver 주소 검색·TMAP 보행 경로를 호출합니다. 외부 quota를 사용하므로 배포 전
명시적으로 실행하며, 키 값은 출력하지 않습니다.

공간 데이터는 manifest와 GeoJSON을 준비하고 `--dry-run` 품질검사를 먼저 실행합니다.

```bash
bun scripts/import-spatial-data.ts --manifest ./data/manifest.json --geojson ./data/source.geojson --dry-run
```

Base Sepolia signer와 RPC를 준비한 운영자는 두 EAS schema를 한 번만 등록합니다.

```bash
bun run eas:schema-register
```

출력에는 schema UID, issuer, transaction hash만 포함되고 private key/RPC URL은 없습니다.

## 외부 API 결정

- KMA 500m은 특정 지점 다중요소 `sfc_nc_var.php`의 `ta_chi,ta,hm`을 사용합니다.
- 현재 특보는 `wrn_now_data_new.php`를 사용합니다.
- MFDS는 낱알식별, e약은요, DUR 9개 endpoint를 서버에서 조합합니다.
- 지도와 주소 검색은 Kakao가 아니라 Naver Maps를 사용합니다.
- TMAP 보행 경로는 서버에서 호출하고 공식 지원이 확인된 option만 사용합니다.

자세한 요청·응답·폴백은 [외부 연동 계약](docs/external-contracts.md)을 참조하세요.

## 배포 및 보안 경계

Vercel 환경 변수와 Naver 허용 도메인을 등록한 뒤 build artifact, SSR deep link,
`/api/cron/risk`, `/api/cron/attestations`, `/api/cron/retention`, S-08 토큰 교환, S-07 EAS
조회를 Preview에서 점검합니다. 실제 발송 공급자를 구현하기 전에는 notification Cron을
등록하지 않습니다.
실제 Preview 배포는 배포 권한이 필요합니다.

원격 DB는 `supabase db push`를 직접 호출하지 않고 프로젝트 고정·seed 배제 게이트를 거칩니다.
호환 앱 배포 전에는 dry-run만 허용하며, 실제 적용 명령과 확인값은
[운영 runbook](docs/runbook.md)의 순서를 따릅니다.

- 공개 제보는 체크인으로 승격하지 않고 HRI C−6을 만들지 않습니다.
- 체크인은 `PENDING/C=0`으로 저장되고 EAS `VERIFIED` 후 다음 계산에서 C=6입니다.
- 경로는 “안전 경로”나 무계단을 보장하지 않으며 coverage 공백을 표시합니다.
- 대화나 과거 로그에 노출된 key는 사용 전 폐기하고 새 key로 교체해야 합니다.

## 문서

- [제품 상세서](상세서.md) · [구현 계획](구현계획.md)
- [Supabase 로컬 검증](docs/supabase-local.md)
- [공간 데이터 계약](docs/route-data-contract.md) · [공간 ETL](docs/spatial-etl.md)
- [알림 공급자 계약](docs/notification-provider.md)
- [Vercel 배포 계약](docs/deployment-vercel.md) · [운영 runbook](docs/runbook.md)

이 프로젝트는 대회 출품용 프로토타입입니다. 별도 라이선스 파일이 없으므로 재배포 권한을
임의로 가정하지 마세요.
