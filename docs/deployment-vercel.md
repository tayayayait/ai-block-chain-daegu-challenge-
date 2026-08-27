# Vercel 배포 계약

확인일: 2026-08-23

이 프로젝트의 배포 대상은 **Vercel**이다. `vite.config.ts`는 Lovable 래퍼의
기본 Cloudflare fallback을 사용하지 않고 Nitro `vercel` preset을 명시한다.
실제 Preview 배포와 외부 연동 smoke test는 Phase 8의 출시 게이트에서 수행한다.

## 1. 고정된 빌드 계약

```ts
nitro: {
  preset: "vercel",
}
```

`@lovable.dev/vite-tanstack-config@2.15.0`의 타입과 구현을 확인했다. 래퍼는
`nitro` 객체를 Nitro Vite plugin으로 전달하며, **Lovable sandbox 밖의 로컬 및
Vercel CI 빌드**에서는 프로젝트가 지정한 `preset`이 기본
`cloudflare-module`보다 우선한다. Lovable 자체 sandbox preview는 플랫폼이
Cloudflare layout을 강제할 수 있으며 출시 artifact로 간주하지 않는다. 로컬
및 Vercel 빌드는 다음 Vercel Build Output API v3 구조를 생성해야 한다.

```text
.vercel/output/
├── config.json
├── nitro.json                         # preset: vercel
├── static/                            # 브라우저 정적 자산
└── functions/__server.func/
    ├── .vc-config.json
    └── index.mjs                      # TanStack Start SSR 진입점
```

검증 명령:

```bash
bun install --frozen-lockfile
bun run build
node scripts/verify-vercel-build.mjs
```

검증기는 Build Output API `version: 3`, SSR 함수, 그리고 파일시스템에서 찾지
못한 `/dashboard` 같은 deep link를 `__server` 함수로 보내는 catch-all route를
검사한다. 공식 근거는 [Vercel Build Output API](https://vercel.com/docs/build-output-api)와
[Build Output Configuration](https://vercel.com/docs/build-output-api/configuration)이다.

## 2. Vercel 프로젝트 설정

| 설정             | 값                              | 주의사항                                                 |
| ---------------- | ------------------------------- | -------------------------------------------------------- |
| Root Directory   | 저장소 루트                     | `package.json`, `vite.config.ts`가 있는 폴더             |
| Framework Preset | 자동 감지 또는 Other            | 빌드 결과는 Nitro preset이 결정한다                      |
| Install Command  | `bun install --frozen-lockfile` | `bun.lock`과 `packageManager`를 기준으로 재현한다        |
| Build Command    | `bun run build`                 | `.vercel/output`을 생성해야 한다                         |
| Output Directory | **재정의하지 않음**             | `.vercel/output`은 Vercel Build Output API의 예약 경로다 |
| Function runtime | Node.js 22                      | 빌드 후 `.vc-config.json`의 `nodejs22.x`를 확인한다      |

Preview와 Production은 같은 build command를 사용한다. 환경별 데이터가
섞이지 않도록 가능하면 별도 Supabase 프로젝트/데이터를 연결하며, Preview에
운영용 signer나 운영용 개인정보를 넣지 않는다.

## 3. 환경 변수 등록표

값은 이 문서나 저장소에 쓰지 않고 Vercel **Project Settings → Environment
Variables**에 등록한다. 사용자에게 노출돼도 되는 값만 `VITE_` 접두사를
사용한다. 아래의 `서버 전용` 값은 절대로 `VITE_`로 복제하지 않는다.

| 변수                             | 실행 위치        |  Preview   | Production | 비고                                          |
| -------------------------------- | ---------------- | :--------: | :--------: | --------------------------------------------- |
| `VITE_SUPABASE_URL`              | 브라우저         |    필수    |    필수    | 환경별 Supabase URL                           |
| `VITE_SUPABASE_PUBLISHABLE_KEY`  | 브라우저         |    필수    |    필수    | RLS 전제의 공개 키                            |
| `VITE_NAVER_MAPS_NCP_KEY_ID`     | 브라우저         |    필수    |    필수    | Maps JS 로더 식별자                           |
| `SUPABASE_URL`                   | 서버 전용        |    필수    |    필수    | `/rest/v1`이 아닌 프로젝트 root URL           |
| `SUPABASE_PUBLISHABLE_KEY`       | 서버 전용        |    필수    |    필수    | 서버의 사용자 권한 요청용                     |
| `SUPABASE_SECRET_KEY`            | 서버 전용 secret |    필수    |    필수    | 관리자 작업에만 사용                          |
| `DATA_GO_SERVICE_KEY`            | 서버 전용 secret |    필수    |    필수    | 단기예보·식약처 API                           |
| `KMA_APIHUB_AUTH_KEY`            | 서버 전용 secret |    필수    |    필수    | 500m 관측·특보 API                            |
| `GEMINI_API_KEY`                 | 서버 전용 secret |    필수    |    필수    | 이미지가 브라우저에서 직접 전송되지 않게 한다 |
| `GEMINI_MODEL`                   | 서버 전용        |    필수    |    필수    | 현재 계약은 `gemini-3.5-flash`                |
| `NAVER_MAPS_CLIENT_ID`           | 서버 전용        |    필수    |    필수    | REST 지오코딩 호출용                          |
| `NAVER_MAPS_CLIENT_SECRET`       | 서버 전용 secret |    필수    |    필수    | 브라우저 bundle 포함 금지                     |
| `TMAP_APP_KEY`                   | 서버 전용 secret |    필수    |    필수    | 보행 경로를 서버에서 proxy                    |
| `NOTIFICATION_PROVIDER`          | 서버 전용        | `disabled` | `disabled` | 실제 공급자 미연결 동안 worker 비활성         |
| `NOTIFICATION_LIVE_SEND_ENABLED` | 서버 전용        |  `false`   |  `false`   | 운영 전환 게이트 전에는 `true` 거부           |
| `BASE_SEPOLIA_RPC_URL`           | 서버 전용        |  Phase 7   |  Phase 7   | Base Sepolia만 사용                           |
| `EAS_ATTESTER_PRIVATE_KEY`       | 서버 전용 secret |  Phase 7   |  Phase 7   | Preview/Production signer 분리                |
| `EAS_CARE_SCHEMA_UID`            | 서버 전용        |  Phase 7   |  Phase 7   | 등록 완료 후 설정                             |
| `EAS_SHELTER_SCHEMA_UID`         | 서버 전용        |  Phase 7   |  Phase 7   | 등록 완료 후 설정                             |
| `EAS_EXPECTED_ISSUER`            | 서버 전용        |  Phase 7   |  Phase 7   | 검증 시 허용 issuer                           |
| `SUBJECT_HASH_SECRET`            | 서버 전용 secret |    필수    |    필수    | 체크인·EAS HMAC, 환경별로 다르게 생성         |
| `REPORTER_HASH_SECRET`           | 서버 전용 secret |    필수    |    필수    | 공개 제보 식별용, subject secret과 분리       |
| `CRON_SECRET`                    | 서버 전용 secret |  검증 시   |    필수    | 최소 16자 이상의 무작위 값                    |

`SUPABASE_SECRET_KEY`, 외부 API secret, signer, HMAC secret을 변경한 뒤에는 새
배포를 만들고 이전 키를 폐기한다. 브라우저 정적 bundle에도 값이 없는지 배포
전에 검사한다.

## 4. Naver Maps와 TMAP 배포 조건

- Naver Cloud Console의 Web 서비스 URL 허용 목록에 실제 Vercel Preview URL과
  Production 도메인을 각각 추가한다. 임의의 wildcard 지원을 가정하지 않는다.
- Naver REST Client Secret과 TMAP appKey는 서버 함수에서만 읽는다.
- Preview에서 브라우저 Network 탭을 확인해 위 두 secret이 요청 URL, header,
  HTML 또는 JS bundle에 나타나지 않는지 검사한다.
- TMAP 호출 실패 시 앱의 명세된 fallback/partial UI가 유지되는지 확인한다.

## 5. SSR·deep-link Preview 체크리스트

로컬에서는 `bun run build` 후 **`.vercel/output`에서** Nitro가 기록한 `srvx`
preview command를 실행한다. 현재 TanStack Start의 일반 `vite preview` middleware는
`dist/server/server.js`를 찾으므로 Vercel preset 산출물을 검증하는 명령으로
사용하지 않는다.

```bash
cd .vercel/output
bunx srvx serve --entry=./functions/__server.func/index.mjs --static=../../static --prod --host=127.0.0.1 --port=4173
```

Vercel Preview URL이 생성되면 아래 항목을 직접 확인한다.

- [ ] `/` 직접 접속이 200이며 HTML에 SSR 본문이 들어 있다.
- [ ] `/dashboard`를 주소창에 입력한 최초 요청이 200이다.
- [ ] `/dashboard` 새로고침 후에도 404나 정적 index fallback이 아니라 SSR된다.
- [ ] 이후 추가되는 `/medication/<subject-id>`, `/shelters`, `/alert/<event-id>`,
      `/verify/<uid>`도 직접 접속과 새로고침을 검사한다.
- [ ] 정적 `/assets/*`는 정상 로드되고, catch-all SSR 함수로 잘못 전달되지 않는다.
- [ ] 인증이 필요한 route는 SSR 최초 요청에서도 같은 권한 정책을 적용한다.
- [ ] 브라우저 bundle/source map에 서버 전용 환경 변수의 **값**이 없다.

현재 build artifact의 `config.json`은 `{ "src": "/(.*)", "dest":
"/__server" }` catch-all을 생성하므로 deep-link를 SSR 함수로 전달한다. 실제 URL
검증은 외부 Preview 배포 후 별도로 완료해야 한다.

## 6. Vercel Cron 계약

Phase 3에서 `/api/cron/risk` GET endpoint와 동시 실행 lock이 구현된 뒤 30분
주기를 등록한다.

```json
{
  "crons": [
    {
      "path": "/api/cron/risk",
      "schedule": "*/30 * * * *"
    },
    {
      "path": "/api/cron/attestations",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/retention",
      "schedule": "0 * * * *"
    }
  ]
}
```

- Vercel cron 식은 UTC 기준이다. 30분 간격은 시간대와 무관하게 동일하다.
- Cron은 Production deployment에서만 자동 실행되므로 Preview에서는
  `Authorization: Bearer <CRON_SECRET>`을 붙인 수동 요청으로 검사한다.
- endpoint는 `Authorization` header를 `Bearer ${CRON_SECRET}`과 비교한다.
  secret이 비어 있으면 설정 장애로 fail closed(503), 값이 다르면 401을 반환한다.
- 같은 30분 bucket은 idempotency key와 DB advisory/lease lock으로 중복 실행을
  막는다. 응답에는 전체/성공/실패 건수만 담고 개인정보나 키를 기록하지 않는다.
- 401, 중복 실행, 부분 실패, 전체 성공을 각각 로그와 테스트로 확인한다.

`/api/cron/notifications`는 실제 공급자 adapter, 승인 템플릿, 수신동의·철회 흐름과
서명된 delivery callback이 준비될 때까지 Vercel Cron에 등록하지 않는다. 현재
`NOTIFICATION_PROVIDER=disabled`, `NOTIFICATION_LIVE_SEND_ENABLED=false` 조합에서 endpoint는
`NOTIFICATION_NOT_CONFIGURED`를 반환하고 outbox를 점유하거나 demo row를 생성하지 않는다.
테스트 전용 Demo adapter의 성공을 실제 발송으로 간주하지 않는다.

Vercel은 `CRON_SECRET`을 설정하면 호출 시 Bearer authorization header로
전달한다. 등록·보안·Production-only 동작은 [Vercel Cron 관리](https://vercel.com/docs/cron-jobs/manage-cron-jobs)와
[Cron quickstart](https://vercel.com/docs/cron-jobs/quickstart)를 기준으로 한다.

Phase 7의 `/api/cron/attestations`도 1분마다 durable EAS job을 처리한다. Base Sepolia
설정이 하나라도 없거나 chain/schema/issuer preflight가 실패하면 fail closed하며, 응답에는
claimed·verified·retry·failed·lease-lost 집계만 포함한다. 실제 schema 등록은 배포 Cron이
아니라 승인된 운영자가 `bun run eas:schema-register`로 한 번 수행한다.

Phase 8의 `/api/cron/retention`은 매시간 bounded cleanup과 약품 이미지 purge를
처리한다. Storage 객체 삭제 성공을 확인한 뒤에만 동일 경로의 DB 메타데이터를
제거하며, 삭제 실패는 경로를 보존한 채 지수 백오프로 재시도한다. 응답과 로그에는
건수만 포함하고 이미지 경로·session ID·대상자 ID는 포함하지 않는다.

## 7. 배포 승인 게이트

- [x] Nitro `vercel` preset이 source config에 고정됐다.
- [x] 로컬 build가 Build Output API v3와 SSR catch-all을 생성한다.
- [x] 자동 verifier가 로컬 artifact를 통과한다.
- [ ] P0-13에서 Lovable 원격 이력을 보존한 정상 저장소 연결을 복구한다.
- [x] 위험·EAS·보존 worker의 보호된 Cron endpoint와 schedule을 구현했다.
- [x] 실제 공급자 미연결 알림 worker는 운영 schedule에서 제외했다.
- [x] 원격 migration wrapper가 대상 project ref와 호환 배포 확인을 강제하고 seed 인자를
      허용하지 않는다.
- [ ] Phase 8에서 실제 Vercel Preview를 배포하고 env, Naver 허용 도메인,
      TMAP 서버 호출, SSR/deep link, Cron 인증을 smoke test한다.
