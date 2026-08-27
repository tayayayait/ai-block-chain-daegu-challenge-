# 보호자 알림 공급자 계약

- 문서 유형: 구현 계약(reference)
- 적용 범위: 보호자 위험 알림과 S-08 딥링크
- 최종 확인일: 2026-08-25 KST

## 1. 현재 릴리스 결정

현재 운영 릴리스의 알림 공급자는 **`disabled`로 고정**한다. SMS나 알림톡 사업자 API를 호출하지 않으며 notification Cron도 배포 일정에 등록하지 않는다. `DemoNotificationProvider`는 상태 전이와 개인정보 비노출을 검증하는 자동 테스트에서만 사용한다. 공급자 계약, 발신 프로필, 승인 템플릿과 운영 자격증명이 모두 준비되기 전에는 라이브 발송 기능을 활성화하지 않는다.

이 결정으로 완료할 수 있는 범위는 다음과 같다.

- L3/L4 전이에서 중복 없는 알림 outbox 생성
- 24시간 유효한 S-08 일회성 딥링크 생성과 소비
- worker의 성공·재시도·영구 실패 상태 전이 테스트
- 테스트 환경의 메시지 미리보기
- 운영 데이터와 분리된 demo 계약 테스트

실제 SMS/알림톡 도달, 공급자 접수·배송 확인과 보호자 응답은 현재 릴리스의 완료 범위가 아니다.

## 2. 공급자 인터페이스

Phase 7은 공급자 SDK 타입을 도메인에 노출하지 않고 다음 계약을 구현한다.

```ts
type SendGuardianAlertInput = {
  alertId: string;
  eventId: string;
  recipientRef: string;
  channel: "SMS" | "ALIMTALK";
  templateKey: "HEAT_L3" | "HEAT_L4";
  riskLevel: "L3" | "L4";
  deepLink: string;
  idempotencyKey: string;
};

type SendGuardianAlertResult =
  | { kind: "demo-recorded"; providerMessageId: string; recordedAt: string }
  | { kind: "accepted"; providerMessageId: string; acceptedAt: string }
  | { kind: "retryable-failure"; code: string; retryAfterSeconds?: number }
  | { kind: "permanent-failure"; code: string };

interface NotificationProvider {
  sendGuardianAlert(input: SendGuardianAlertInput): Promise<SendGuardianAlertResult>;
}
```

`recipientRef`는 연락처 원문이 아닌 내부 참조 ID다. 운영 어댑터만 권한이 제한된 연락처 저장소에서 발송 직전에 전화번호를 읽을 수 있다. 공급자 응답 본문과 SDK 오류를 그대로 상위 계층이나 로그로 전달하지 않는다.

## 3. 테스트 전용 DemoNotificationProvider 동작

`DemoNotificationProvider.sendGuardianAlert()`는 다음 순서로만 동작한다.

1. 필수 필드, L3/L4 등급, 허용된 템플릿 키와 딥링크 origin을 검사한다.
2. `idempotencyKey`의 unique constraint로 이미 기록된 요청인지 확인한다.
3. 외부 HTTP, SMS, 알림톡 API를 **호출하지 않는다**.
4. 메시지 본문과 딥링크 원문 대신 정규화 payload의 digest를 저장한다.
5. `provider=DEMO`, `status=DEMO_RECORDED`와 `demo_${sha256(idempotencyKey)}` 형식의 결정적 `providerMessageId`를 반환한다.
6. 같은 멱등 키를 다시 받으면 새 row를 만들지 않고 기존 `DEMO_RECORDED` 결과를 반환한다.

demo record에는 다음 값만 남긴다.

| 필드                           | 저장 규칙                                 |
| ------------------------------ | ----------------------------------------- |
| `alert_id`, `event_id`         | 내부 UUID                                 |
| `recipient_ref`                | 내부 참조 ID; 전화번호 원문 금지          |
| `provider`, `channel`          | `DEMO`, 요청 채널                         |
| `template_key`, `risk_level`   | 허용 목록 값                              |
| `status`                       | `DEMO_RECORDED`                           |
| `provider_message_id`          | `demo_${sha256(idempotencyKey)}`          |
| `payload_digest`               | 정규화 payload의 SHA-256 digest           |
| `attempt_count`, `recorded_at` | 정확한 시도 횟수와 서버 시각              |
| `deep_link_path`               | origin·token 없는 `/alert/{eventId}` 경로 |

전화번호, 보호자 이름, 대상자 이름·주소, 원문 메시지, 원본 딥링크, access token, 공급자 키는 record와 로그에 저장하지 않는다. demo 성공에는 `sent_at`, `accepted_at`, `delivered_at`을 채우지 않는다.

## 4. Outbox 상태와 worker 규칙

`guardian_alerts.status`는 다음 상태를 사용한다.

| 상태               | 의미                                      | 다음 상태                                                     |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------- |
| `QUEUED`           | 전송 조건을 통과한 대기 건                | `PROCESSING`, `SUPPRESSED`                                    |
| `PROCESSING`       | worker가 lease로 점유                     | `DEMO_RECORDED`, `ACCEPTED`, `RETRY_WAIT`, `FAILED_PERMANENT` |
| `DEMO_RECORDED`    | 데모 결과 기록 완료, 실제 발송 없음       | 종료                                                          |
| `ACCEPTED`         | 운영 공급자가 요청을 접수                 | `DELIVERED`, `FAILED_PERMANENT`                               |
| `DELIVERED`        | 서명 검증된 delivery callback 수신        | 종료                                                          |
| `RETRY_WAIT`       | 일시 오류로 재시도 예정                   | `PROCESSING`, `FAILED_PERMANENT`                              |
| `FAILED_PERMANENT` | 재시도 불가 또는 최대 횟수 초과           | 종료                                                          |
| `SUPPRESSED`       | 수신동의 철회·채널 차단으로 호출하지 않음 | 종료                                                          |

worker는 한 번에 한 건만 claim하고 최대 4분의 bounded lease를 사용한다. claim 시 DB가 예측 불가능한 `claim_token`과 당시의 `consent_revision`을 함께 반환한다. 모든 후속 작업은 둘 다 일치해야 한다.

- queue는 동의 시각·동의문 버전·수집 경로·증빙 ID와 활성 채널이 모두 있을 때만 생성한다.
- 딥링크 grant RPC는 `PROCESSING` 상태, claim token, 동일 lease, 아직 만료되지 않은 lease 및 같은 동의 revision을 다시 확인한다. 조건이 달라지면 token을 만들지 않는다.
- grant를 만든 뒤에도 공급자 호출 직전에 동의·수신처·채널·claim 소유권을 한 번 더 확인한다.
- finalize RPC도 claim token과 아직 만료되지 않은 lease를 compare-and-set으로 확인한다. 이전 worker는 새 worker의 grant나 상태를 바꿀 수 없다.
- 새 grant를 만들면 아직 교환되지 않은 같은 alert/event의 기존 grant를 원자적으로 revoke한다.

`subjectId:episodeId:riskLevel:triggerKind` 멱등 키에는 unique constraint가 있다. `triggerKind`는 `ENTER`, `ESCALATE`, `PERSIST_2H` 중 하나이며 회복 후 재진입은 새 `episodeId`를 사용한다. timeout, 429와 5xx만 지수 backoff와 jitter를 적용해 재시도한다. 잘못된 수신처, 동의 없음, 승인되지 않은 템플릿, 인증 실패는 영구 실패로 분류한다. lease 만료 후 재처리되어도 공급자 멱등 키와 DB constraint가 이중 발송을 막아야 한다.

`DEMO_RECORDED`를 `ACCEPTED`, `DELIVERED` 또는 `SENT`로 변환하지 않는다. demo 이벤트에는 운영용 `ALERT_SENT`를 기록하지 않으며, 감사 기록이 필요하면 `ALERT_DEMO_RECORDED`로 분리한다.

## 5. 딥링크와 미리보기

알림 생성 시 256-bit cryptographically secure random token을 만든다. 전달용 URL 형식은 `https://{allowed-origin}/alert/{eventId}?token={opaque-token}`이다.

- DB에는 token hash, alert ID, 24시간 만료와 최초 교환 시각만 저장한다.
- grant는 현재 worker의 claim token·lease와 유효한 동의 revision이 확인될 때만 저장한다.
- 새 grant는 교환되지 않은 이전 grant를 revoke하므로, 같은 alert/event에는 사용 가능한 최신 link 하나만 남는다.
- token 원문과 완전한 URL은 로그, 분석 도구, 오류 리포트와 outbox에 저장하지 않는다.
- 최초 유효 요청은 token을 원자적으로 소비하고 HttpOnly·Secure·SameSite cookie 세션으로 교환한다.
- 만료·재사용·event 불일치는 개인정보 없이 동일한 실패 화면으로 처리한다.
- demo 미리보기 URL은 권한 있는 운영자에게 생성 직후 한 번만 표시한다. 새 미리보기가 필요하면 기존 token을 폐기하고 다시 발급한다.

딥링크 origin은 서버의 `PUBLIC_APP_ORIGIN`만 사용한다. HTTPS origin(개발 시 loopback HTTP만 예외)이어야 하며, request `Host` header나 사용자 입력으로 origin을 만들지 않는다.

화면에는 다음 문구를 고정한다.

- 전역 배지: `DEMO · 실제 알림은 발송되지 않습니다`
- 액션 버튼: `데모 알림 생성`
- 완료 메시지: `데모 알림 기록이 생성되었습니다. 실제 문자·알림톡은 발송되지 않았습니다.`
- outbox 상태: `데모 기록 완료`

demo 화면과 기록은 운영 빌드의 내비게이션이나 Cron에서 접근시키지 않는다. 테스트 화면에서도
`발송 완료`, `보호자에게 전달됨`, `알림톡 전송 성공`을 표시하지 않는다.

## 6. 메시지 최소화 규칙

운영 템플릿은 공급자 승인 전에 코드 상수로 확정하지 않는다. 승인 요청 초안은 다음 정보만 사용한다.

```text
[온중] 보호 대상자의 폭염 위험 단계가 {riskLevel}입니다.
현재 상태와 가까운 쉼터를 확인해 주세요: {deepLink}
응급 증상이 있으면 119에 연락하세요.
```

메시지에는 이름, 상세 주소, 전화번호, 복약명, 진단명, HRI 계산 원문과 위치 좌표를 넣지 않는다. 링크 목적지에서도 마스킹 이름, 위험 등급, 최대 3개 이유와 행동 안내만 보여 준다. 단축 URL 사업자가 URL을 수집하는 방식은 사용하지 않는다.

## 7. 수신동의와 STOP 처리

알림을 queue에 넣을 때와 worker가 발송하기 직전에 모두 유효한 수신동의를 확인한다. 동의 record에는 `guardian_id`, 채널, 목적, 동의문 버전, 수집 경로, 동의·철회 시각과 증빙 ID를 저장한다. 동의가 변경되면 revision을 증가시키고, 기존 claim은 `CONSENT_CHANGED`로 suppression한다. 전화번호 원문을 감사 로그에 복제하지 않는다.

현재는 실제 보호자 동의 수집·철회 UI 및 provider STOP webhook이 아직 없으며, 그래서 실제 provider는 계속 `disabled`다. 이 절의 STOP 절차는 라이브 공급자 도입 시 별도 구현·E2E 검증이 필요한 운영 계약이다.

운영 공급자는 SMS 수신거부 keyword 또는 알림톡 차단 callback을 받을 수 있어야 한다. STOP 처리는 다음과 같이 원자적으로 수행한다.

1. webhook 서명과 replay window를 검증한다.
2. 공급자 recipient ID를 내부 guardian ID로 매핑한다.
3. 해당 채널 동의를 철회하고 suppression을 즉시 활성화한다.
4. 아직 공급자에 전달되지 않은 `QUEUED`·`RETRY_WAIT` 건을 `SUPPRESSED`로 바꾼다.
5. 처리 결과에는 내부 event ID와 reason code만 기록한다.

철회 후에는 재동의 화면에서 본인 확인과 명시적 동의를 다시 받기 전까지 자동 복구하지 않는다. webhook 원문, 전화번호, 메시지 내용은 로그에 남기지 않으며 필요 시 암호화된 격리 저장소에 최소 기간만 보관한다.

## 8. 서버 전용 설정

다음 변수는 모두 서버 secret store에서만 읽으며 `VITE_` 접두사를 사용하지 않는다.

```text
NOTIFICATION_PROVIDER=disabled
NOTIFICATION_LIVE_SEND_ENABLED=false
NOTIFICATION_PROVIDER_API_KEY=
NOTIFICATION_WEBHOOK_SECRET=
NOTIFICATION_SENDER_PROFILE_ID=
NOTIFICATION_TEMPLATE_ID_HEAT_L3=
NOTIFICATION_TEMPLATE_ID_HEAT_L4=
NOTIFICATION_DAILY_LIMIT=
PUBLIC_APP_ORIGIN=https://your-production-domain.example
```

현재 운영 허용 조합은 `provider=disabled`, `live=false`뿐이다. 이 상태의 endpoint는
`NOTIFICATION_NOT_CONFIGURED`를 반환하며 outbox를 점유하거나 demo row를 만들지 않는다. API
key 하나가 설정되었다는 이유로 라이브 모드로 전환하지 않는다. `provider=disabled`와
`live=true`, 운영 provider와 빈 필수 설정, 미승인 템플릿 ID 조합은 서버 시작 시 실패해야 한다.

## 9. 운영 전환 게이트

라이브 발송은 아래 항목을 모두 증명한 별도 변경에서만 활성화한다.

- 국내 SMS 또는 알림톡 공급자와 계약·결제 주체 확정
- SMS 발신번호 검증 또는 카카오 비즈니스 채널·발신 프로필 승인
- `HEAT_L3`, `HEAT_L4` 템플릿 승인 및 승인본 hash 보관
- API key, webhook secret, profile·template ID를 서버 secret store에 등록
- 일·분당 quota, 비용 상한과 사용량 경보 설정
- 운영 출발 IP 또는 허용 domain 설정과 key rotation 절차 확인
- 수신동의 수집·조회·철회 UI와 STOP callback E2E 통과
- webhook 서명, replay 방지, provider message ID 중복 처리 검증
- 사전 등록한 테스트 수신처에서 `ACCEPTED`와 `DELIVERED` 구분 검증
- 로그·오류·분석 이벤트의 전화번호, token, 메시지 원문 누출 검사 통과
- 장애 시 재시도·영구 실패·수동 재처리 runbook과 담당자 지정

운영 전환 PR은 선택한 공급자명, 공식 API 문서 URL, 리전, SLA, quota, 과금 기준, callback 검증법과 지원 채널을 이 문서에 추가해야 한다. 그 전까지 제품의 알림 기능은 비활성 상태이며 실제 보호자 알림 완료를 주장할 수 없다.

## 10. 계약 테스트 완료 조건

- 외부 네트워크를 실패시키는 테스트에서도 demo record가 정확히 1건 생성된다.
- 동일 멱등 키를 동시에 두 번 처리해도 record는 1건이다.
- demo 결과에 `sent_at`, `accepted_at`, `delivered_at`이 없다.
- outbox·로그·오류 이벤트에 전화번호, token 원문, 완전한 딥링크와 메시지 본문이 없다.
- 만료, 재사용과 다른 event의 token은 모두 거부된다.
- lease를 잃은 worker는 grant를 만들거나 finalize할 수 없고, 새 claim의 grant를 revoke할 수 없다.
- 동의 revision 변경은 공급자 호출 전에 `SUPPRESSED` 처리되고, 기존 미교환 link도 소비할 수 없다.
- 동의가 없거나 철회된 guardian은 공급자 호출 전에 `SUPPRESSED`가 된다.
- 운영 Cron 목록과 운영 내비게이션에 demo 진입점이 없다.
- disabled endpoint 호출은 row를 만들지 않고 `NOTIFICATION_NOT_CONFIGURED`를 반환한다.
- 라이브 설정 gate 하나라도 빠지면 서버가 시작되지 않거나 live feature flag가 비활성 상태를 유지한다.
