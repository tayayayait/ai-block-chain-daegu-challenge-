# 온중 운영 Runbook

대상: Preview/Production 운영 개발자와 관리자  
기준일: 2026-08-24

이 문서는 Cron, 외부 API, EAS, 키 교체, 데이터 갱신 장애를 복구하는 절차입니다. 실제
문자·알림톡 공급자가 아직 연결되지 않았으므로 알림 worker는 운영에서 비활성화하며,
`DEMO_RECORDED`는 테스트 전용으로만 사용합니다.

## 정상 상태

| 영역        | 정상 신호                                                         | 주기     |
| ----------- | ----------------------------------------------------------------- | -------- |
| 위험 계산   | `/api/cron/risk` 200, `COMPLETED` 또는 설명 가능한 `PARTIAL`      | 30분     |
| 보호자 알림 | 실제 공급자 미연결 동안 cron 미등록·`NOTIFICATION_NOT_CONFIGURED` | 비활성   |
| EAS         | `/api/cron/attestations` 200, verified/retry/failed 집계만 반환   | 1분      |
| 데이터 보존 | `/api/cron/retention` 200, DB 정리·이미지 삭제 집계만 반환        | 1시간    |
| 공개 화면   | `/`, `/shelters`, `/verify/<uid>` SSR 200                         | 배포마다 |
| 인증 화면   | 대상자·담당자 권한이 route와 server function 모두에서 적용        | 배포마다 |

응답과 로그에 대상자 ID, 전화번호, 토큰, API key, RPC URL, private key를 남기지 않습니다.

## 최초 배포

1. 대화·로그에 노출된 모든 key를 폐기하고 Preview와 Production의 Supabase, EAS signer,
   HMAC secret을 분리합니다.
2. migration을 비운영 Supabase에서 먼저 적용하고 pgTAP·schema check·types check를
   실행합니다. 운영 프로젝트에는 `supabase/fixtures/local-demo.sql`을 적용하지 않습니다.
   공유 `supabase/seed.sql`은 운영-safe no-op이고 자동 seed는 비활성화되어 있습니다.
3. `bun run build`와 `node scripts/verify-vercel-build.mjs`를 실행합니다.
4. `bun run test:live-apis`로 KMA·Supabase·Gemini·MFDS·Naver·TMAP 실계정 smoke를
   통과시킵니다. 키 값은 로그에 출력하지 않습니다.
5. [`.env.example`](../.env.example)의 변수명을 Vercel에 등록하고 Naver Cloud Console에
   실제 배포 도메인을 허용합니다. `PUBLIC_APP_ORIGIN`은 scheme·host만 있는 실제 HTTPS
   도메인으로 고정합니다. request Host header나 redirect URL을 이 값 대신 사용하지 않습니다.
6. `bun run supabase:deploy:check`로 적용 예정 migration만 확인합니다. 이 명령은 연결된
   프로젝트 ref를 고정 검증하고 seed를 포함하는 인자를 받지 않습니다.
7. weather uniqueness 구·신 계약을 모두 읽는 호환 앱을 먼저 배포하고 구 인스턴스가 모두
   종료된 것을 확인합니다. 그 전에는 운영 DB migration을 적용하지 않습니다.
8. Supabase 프로젝트 Owner/Admin 권한 CLI에서 아래 확인값을 현재 PowerShell 세션에만
   넣고 migration을 적용합니다. wrapper는 `db push --linked`만 실행하며 `--include-seed`를
   전달할 수 없습니다.

   ```powershell
   $env:ONJUNG_COMPAT_DEPLOYMENT_DRAINED="zbkuibnalzjwryeckegm:compat-deployed-and-drained"
   bun run supabase:deploy
   Remove-Item Env:ONJUNG_COMPAT_DEPLOYMENT_DRAINED
   ```

   REST
   `service_role` key나 Supabase Personal Access Token을 앱 환경 변수로 대신 사용하지
   않습니다.

9. 첫 운영자 정보 네 항목을 로컬 `.env`에 잠시 넣고 `bun run admin:bootstrap`을 한 번
   실행합니다. 성공 후 `BOOTSTRAP_ADMIN_PASSWORD`는 즉시 로컬 파일에서도 제거합니다.
10. 등록된 Cron에 정상/오류 Bearer header를 보내 200/401을 확인합니다. 실제 공급자가
    연결되기 전에는 notification Cron을 등록하지 않습니다.
11. S-08 token이 첫 교환 후 URL에서 제거되고 재사용이 거부되는지 확인합니다.
12. S-07이 chain 84532, 허용 schema UID, expected issuer만 검증하는지 확인합니다.

## Cron 점검

secret을 shell history에 직접 입력하지 말고 운영 secret manager가 주입한 값을 사용합니다.

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/risk
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/attestations
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/retention
```

### 401

Vercel 환경 범위, 새 deployment 반영 여부, `Bearer ` 접두사를 확인합니다. 값은 출력하지
말고 설정 존재 여부나 안전한 fingerprint만 비교합니다.

### 503 또는 NOT_CONFIGURED

필수 변수의 이름과 존재 여부만 확인합니다. EAS는 RPC, signer, schema UID 두 개,
expected issuer, subject HMAC secret이 모두 필요합니다. 수정 후 새 deployment를 만듭니다.

### lease lost 증가

겹친 worker의 정상 방어일 수 있습니다. claim token 또는 lease가 달라진 worker는 grant·finalize를
할 수 없도록 막혀 있습니다. 계속 증가하면 중복 schedule, 함수 timeout, DB 지연을 확인합니다.
lease나 claim token을 수동으로 변경·삭제하지 말고 만료 후 worker가 회수하게 둡니다.

### 이미지 삭제 재시도 증가

`imageRetryScheduled`가 계속 증가하면 Storage 상태와 `medication-images` 버킷 권한을
확인합니다. `imageFinalizeFailed`가 증가하면 Storage 삭제 후 DB finalize RPC가 실패한
것이므로 해당 session의 기존 경로를 로그에 남기지 말고 운영 DB에서 상태만 확인합니다.
경로를 수동으로 `NULL` 처리하지 말고 lease 만료와 다음 worker 재시도를 기다립니다.
업로드는 Storage 호출 전에 `PREPARED` cleanup intent를 생성합니다. session attach에
실패한 객체도 이 intent가 만료되면 worker가 제거하므로 intent 행을 임의로 삭제하지
않습니다.

## 외부 API 장애

| 공급자           | 사용자 폴백                                  | 운영 조치                            |
| ---------------- | -------------------------------------------- | ------------------------------------ |
| KMA              | 최신 유효 관측/단기예보와 stale·partial 표시 | 승인 endpoint, KST 시각, quota 확인  |
| 공공데이터포털   | 마지막 정상값 또는 안전 오류                 | service key 승인·encoding 확인       |
| Gemini           | 직접 입력으로 전환                           | 모델명이 `gemini-3.5-flash`인지 확인 |
| MFDS             | 확정하지 않고 확인 필요 유지                 | 낱알·e약은요·DUR endpoint별 점검     |
| Naver            | 지도 대신 동일 정보 목록                     | 허용 도메인과 REST key 확인          |
| TMAP             | 쉼터 목록 유지, 경로 오류·재시도 표시        | 보행 endpoint와 quota 확인           |
| Base Sepolia RPC | 오프체인 저장 유지, EAS 대기                 | 승인된 대체 RPC로 교체               |

retry 간격을 임의로 줄이지 않습니다. quota는 각 공급자 콘솔의 실제 값이 기준입니다.

## EAS 운영

### 스키마 최초 등록

1. Base Sepolia ETH가 있는 전용 signer를 준비합니다.
2. RPC, signer, expected issuer를 secret store에 등록합니다.
3. `bun run eas:schema-register`를 한 번 실행합니다.
4. CareEvent/ShelterStatus UID와 transaction hash를 변경 기록에 보관합니다.
5. UID를 환경 변수에 넣고 새 deployment를 만듭니다.
6. 재실행 결과가 `ALREADY_REGISTERED`인지 확인합니다.

명령은 chain 84532와 고정 SchemaRegistry만 허용하고 private key/RPC URL을 출력하지
않습니다. UID·issuer·등록 내용이 다르면 덮어쓰지 않고 중단합니다.

### 잔액 또는 RPC 장애

오프체인 이벤트는 그대로 유지합니다. signer 주소만 확인하고 private key는 조회하지
않습니다. 잔액을 보충하거나 승인 RPC로 교체한 뒤 다음 Cron의 backlog 처리를 확인합니다.
확인이 불분명한 transaction은 중복 발급 위험 때문에 자동 재전송하지 않습니다.

## 키 교체

1. 공급자 콘솔에서 새 key를 생성합니다.
2. Preview에 먼저 등록하고 정상·실패 폴백을 점검합니다.
3. Production secret을 교체하고 새 deployment를 만듭니다.
4. 이전 key를 폐기합니다.
5. 값이 아닌 교체 시각·담당자·영향 범위만 기록합니다.

Supabase secret key는 브라우저에 넣지 않습니다. CLI migration에는 REST secret 대신 CLI용
자격증명을 사용합니다. HMAC secret 회전은 이전 hash 연결성과 멱등성을 끊으므로 버전
migration과 재처리 계획을 먼저 승인받습니다. EAS signer를 바꿀 때는 expected issuer와
과거 issuer 검증 정책을 함께 변경합니다.

## 데이터 갱신

### 로컬 Demo fixture와 운영 쉼터

1. 원본 출처·기준일·라이선스를 기록합니다.
2. 로컬 회귀 자료를 바꿀 때만 `scripts/generate-supabase-seed.ts`의 fixture를 수정합니다.
3. `bun scripts/generate-supabase-seed.ts --write` 후 `--check`를 실행합니다.
4. `bun run supabase:reset`에서 쉼터 950곳, 8개 구·군, iM뱅크 100곳을 확인합니다.

`supabase/fixtures/local-demo.sql`의 가상 대상자와 계정은 로컬 회귀 테스트 전용이며 공유
seed 설정에 등록되지 않습니다. 운영에는 Demo fixture를 적용하지 않고, 감사된 950개 쉼터만
`bun run shelters:import`로 올립니다. 운영 대상자는 담당자 화면에서 동의 후 실제 정보로
등록합니다. `supabase db reset --linked`와 임의 `--db-url` reset은 원격 사용자 객체를
삭제할 수 있으므로 금지합니다.

### 공간 데이터

manifest에 URL, 라이선스, CRS, coverage, confidence, 기준일을 기록합니다. `--dry-run`에서
대구 경계, geometry, 양수 높이, 중복률을 확인한 뒤 audit 결과를 승인하고 `--apply`합니다.
부분 coverage를 `COMPLETE`로 표시하지 않습니다.

## 보존·롤백·에스컬레이션

- 정리 함수는 service role로만 실행하고 먼저 삭제 예정 건수와 복구 지점을 확인합니다.
- 만료 token/session·route/약품 API cache, 정책 기간이 지난 terminal job과 완료된 위험도
  큐만 제한된 batch로 정리합니다.
- EAS `VERIFIED`와 `FAILED` job은 동일 대상의 중복 attestation을 막는 영구
  receipt이므로 보존 작업에서 삭제하지 않습니다. 특히 `CONFIRMATION_UNCERTAIN`을
  지우고 재생성하면 이미 제출됐을 수 있는 기록이 중복될 수 있습니다.
- 약품 이미지는 Storage API 삭제 성공 후에만 동일 경로 조건으로 metadata를 정리하며,
  실패하면 경로를 유지한 채 재시도합니다.
- 앱 회귀는 직전 정상 Vercel deployment로 되돌리되 DB migration은 자동 롤백하지 않습니다.
- DB 오류는 새 보정 migration으로 해결하며 공유된 migration을 고치지 않습니다.
- secret/개인정보 노출은 key를 즉시 폐기하고 로그·bundle·source map 범위를 조사합니다.
- 잘못된 EAS 기록은 DB 원본을 삭제하지 말고 revocation과 정정 이벤트를 남깁니다.
- 건강 응급 상황은 제품보다 119와 현장 절차를 우선합니다.

운영 데이터 삭제, DB 복구, signer 교체, 라이브 알림 활성화는 별도 승인 후 수행합니다.
