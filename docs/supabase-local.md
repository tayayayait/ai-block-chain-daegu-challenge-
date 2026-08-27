# Supabase 로컬 개발·검증

이 프로젝트는 Supabase CLI `2.115.0`, PostgreSQL 17 설정, 순서가 고정된 SQL migration을 사용한다. 비밀키나 실제 데이터는 이 문서와 저장소에 넣지 않는다.

## 준비물

- Node.js 22 이상
- Bun 1.3.14
- Docker Desktop 또는 Docker Engine
- `bun install`로 설치되는 프로젝트 로컬 Supabase CLI

현재 Windows 작업 환경에는 Docker/PostgreSQL 실행기가 없어 migration 런타임 검증과 타입 생성을 실행할 수 없다. 정적 계약 테스트는 실행되지만, 아래 명령은 Docker가 준비된 환경 또는 CI에서 반드시 통과해야 한다.

## 재현 절차

```bash
bun install --frozen-lockfile
bun run supabase:start
bun run supabase:reset
bun run supabase:test
bun run supabase:schema-check
bun run supabase:types
bun run supabase:types-check
```

공유 `supabase/config.toml`은 `[db.seed].enabled = false`이고 관례 경로인
`supabase/seed.sql`도 설명만 있는 빈 파일이다. `bun run supabase:reset`은 추가 인자를 받지
않으며 다음 순서를 고정한다.

1. `supabase status --output json`의 DB URL이 loopback 주소이고 `[db].port`와 일치하는지
   확인한다.
2. 정확히 `supabase db reset --local --no-seed`를 실행한다.
3. 정확히 `supabase db query --local --file supabase/fixtures/local-demo.sql`을 실행한다.

따라서 정상 완료 후에만 쉼터 950건, 시설 유형 466/245/129/110, iM뱅크 100건, 8개
구·군, 가상 대상자 5명이 재현된다. Demo SQL은 공유 seed 설정에 등록되지 않는다.

`supabase db reset --linked` 또는 임의 `--db-url` reset은 원격의 사용자 생성 객체를
삭제할 수 있는 명령이다. 이 프로젝트의 로컬 검증에서 직접 실행하거나
`bun run supabase:reset` 뒤에 인자로 전달하지 않는다. 원격에는 migration 전용
`bun run supabase:deploy`만 사용하며 Demo fixture는 절대 적용하지 않는다.

## migration 규칙

- 새 파일은 `supabase migration new <name>`으로만 만든다.
- extension 버전은 migration에 고정하지 않는다.
- 모든 `public` 테이블은 RLS와 명시적 GRANT를 가진다.
- `anon`은 쉼터 공개 열 외의 base table에 접근하지 않는다.
- 서버 배치·외부 API 캐시·토큰·작업 큐는 `service_role` 전용이다.
- 타입은 migration/함수/view가 바뀔 때마다 다시 생성한다.

## 원격 프로젝트 연결

원격 DDL 적용에는 대화에 제공된 REST 키가 아니라 Supabase CLI용 Personal Access Token과 데이터베이스 암호 또는 승인된 CI 연결이 필요하다. `service_role` 키를 migration 도구나 브라우저에 사용하지 않는다.

## 로컬 Demo fixture 갱신

`data/daegu_shelters.geojson` 또는 가상 시나리오를 바꾼 경우에만 아래 생성기를 사용한다.

```bash
bun scripts/generate-supabase-seed.ts --write
bun scripts/generate-supabase-seed.ts --check
```

생성 대상은 `supabase/fixtures/local-demo.sql`뿐이다. `supabase/seed.sql`을 Demo 데이터로
교체하거나 `config.toml`의 `sql_paths`에 fixture를 추가하면 안 된다.
