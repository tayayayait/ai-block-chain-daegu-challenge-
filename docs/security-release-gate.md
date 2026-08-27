# 보안 릴리스 게이트

이 문서는 Preview 및 운영 배포 직전에 반드시 통과해야 하는 보안·보존
검증 절차다. 실패 항목이 하나라도 있으면 배포를 중단한다.

## 1. 비밀정보 회전 및 저장

- 대화, 이슈, 로그 또는 화면 공유에 노출된 키는 모두 폐기하고 재발급한다.
- Supabase `service_role`, 외부 API secret, 서명 private key는 서버 전용 배포
  Secret Store에만 저장한다. `VITE_` 접두사를 붙이지 않는다.
- 클라이언트에는 공개 사용이 허용된 Supabase anon key만 노출한다. RLS를
  우회하는 키는 브라우저 번들에 포함하지 않는다.
- 실제 `.env` 파일은 저장소에 추가하지 않는다. `.env.example`에는 빈 값 또는
  `<set-in-deployment-secret-store>` 같은 자리표시자만 둔다.
- 이전에 공유된 모든 키를 회전한 뒤, 외부 서비스 콘솔에서 구 키가 비활성인지
  확인한다.

## 2. 자동 비밀정보 스캔

```bash
bun run security:scan
```

스캐너는 소스와 현재 Vercel 출시 산출물(`.vercel/output`)을 검사한다. `.map`과
`.log`도 검사하며, 25 MiB를 넘는 대상 파일은 조용히 건너뛰지 않고 실패한다. 발견 시 값은 출력하지 않고
`상대경로:줄 [패턴종류]`만 출력한다. 로컬 `.env`는 읽지 않으며,
`.env.example`·`.env.sample`·`.env.template`은 실제 값이 들어갔는지 검사한다.

`bun run build` 뒤 `node scripts/verify-vercel-build.mjs`를 실행해
`.vercel/output/static`의 모든 브라우저 자산에 서버 환경 변수명, 서버 전용 SDK,
Node crypto shim, Supabase secret key 및 개인정보 패턴이 없는지도 별도로 확인한다.

테스트 fixture가 의도적으로 가짜 키 형식을 써야 할 때만 테스트 파일의 바로
윗줄에 다음 표식을 쓸 수 있다.

```ts
// secret-scan: allow-next-line -- test-fixture
```

운영 소스에서는 이 표식이 무시된다. 스캔 실패를 무시하거나 패턴을 약화해서
배포하지 않는다.

## 3. 데이터 보존 작업

`public.run_retention_cleanup(p_now, p_batch_limit)`은 `service_role`만 실행할 수
있다. 동시 작업 간 충돌을 피하기 위해 `FOR UPDATE SKIP LOCKED`를 사용하며,
호출 한 번에 테이블별 1~500건만 처리한다.

| 데이터                        | 정책                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| 알림 일회용 토큰·접근 세션    | `expires_at` 경과 후 삭제                                                                |
| 경로 캐시                     | `expires_at` 경과 후 삭제                                                                |
| 약품 API 캐시                 | `expires_at` 경과 후 삭제                                                                |
| 약품 이미지와 스캔 메타데이터 | `purge_after` 경과 후 Storage 객체 삭제가 확인된 경우에만 경로·모델·후보 메타데이터 제거 |
| 알림 terminal 작업            | 최종 상태가 된 뒤 90일 보존                                                              |
| EAS attestation terminal 작업 | `VERIFIED`와 `FAILED` 모두 중복 발급 방지 receipt로 계속 보존                            |
| 처리 완료 위험도 재계산 큐    | `processed_at` 뒤 30일 보존                                                              |

운영 스케줄러는 작은 배치로 반복 호출하고 반환된 건수만 구조화 로그에 남긴다.
토큰, 이미지 경로, 환자 식별자 또는 payload는 로그에 남기지 않는다.

이 SQL 함수는 Supabase의 `storage.objects`를 직접 수정하지 않는다. 시간별
`/api/cron/retention` worker가 비공개 `medication-images` 버킷을 서버 전용 Storage
API로 먼저 삭제한 뒤, 동일 cleanup job의 lease token이 유지된 경우에만 DB
메타데이터를 지운다. 업로드 전에 `PREPARED` cleanup intent를 먼저 기록하므로
업로드 뒤 session 저장이 실패해도 고아 객체가 정리 대상에서 빠지지 않는다. Storage
삭제 실패는 지수 백오프로 `RETRY_WAIT`에 남기고, DB 경로는 보존한다.

## 4. 배포 전 실행 순서

1. 새 키를 Secret Store에 등록하고 구 키를 폐기한다.
2. `bun run security:scan`을 실행한다.
3. `bun run typecheck`, 관련 Vitest, lint, production build를 실행한다.
   build 뒤 `node scripts/verify-vercel-build.mjs`와 `bun run security:scan`을 다시
   실행해 생성 산출물까지 검사한다.
4. 로컬 Supabase가 가능하면 `bun run supabase:reset` 및
   `bun run supabase:test`로 권한·배치 제한 pgTAP을 실행한다.
5. Preview에서 비인가 API 호출, 일회용 링크 재사용, 만료 세션, RLS 우회를
   확인한다.
6. `/api/cron/retention`의 Storage 삭제·재시도·lease-lost·finalize-failed 집계와
   최근 성공 실행을 확인한다.

Docker/Postgres를 사용할 수 없는 환경에서는 정적 계약 테스트까지만 검증된
것이다. 이 경우 실제 마이그레이션과 pgTAP을 실행하기 전에는 운영 배포 승인을
내리지 않는다.
