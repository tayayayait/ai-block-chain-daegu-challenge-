const LOCAL_FIXTURE_PATH = "supabase/fixtures/local-demo.sql";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function parseResetCliArguments(arguments_: readonly string[]): readonly string[] {
  if (arguments_.length > 0) {
    throw new Error("로컬 reset wrapper는 인자를 받지 않습니다.");
  }
  return [];
}

export function buildLocalResetArgs(): readonly string[] {
  return ["db", "reset", "--local", "--no-seed"];
}

export function parseLocalDatabasePort(config: string): number {
  const databaseSection = config.match(/(?:^|\n)\[db\]\s*\n([\s\S]*?)(?=\n\[|$)/u)?.[1];
  if (!databaseSection) {
    throw new Error("supabase/config.toml에 [db] 설정이 없습니다.");
  }

  const rawPort = databaseSection.match(/^port\s*=\s*(\d+)\s*$/mu)?.[1];
  const port = rawPort ? Number(rawPort) : Number.NaN;
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("로컬 Supabase DB port가 안전한 범위가 아닙니다.");
  }
  return port;
}

export function parseStatusDatabaseUrl(statusJson: string): string {
  let status: unknown;
  try {
    status = JSON.parse(statusJson);
  } catch {
    throw new Error("Supabase status JSON을 읽을 수 없습니다.");
  }

  if (!status || typeof status !== "object") {
    throw new Error("Supabase status에 DB URL이 없습니다.");
  }
  const values = status as Record<string, unknown>;
  const databaseUrl = values["DB_URL"] ?? values["db_url"];
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new Error("Supabase status에 DB URL이 없습니다.");
  }
  return databaseUrl;
}

export function assertLoopbackDatabaseUrl(databaseUrl: string, expectedPort: number): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Supabase DB URL 형식이 올바르지 않습니다.");
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("Supabase DB endpoint가 loopback 주소가 아닙니다.");
  }
  if (parsed.port !== String(expectedPort)) {
    throw new Error("Supabase DB port가 config.toml과 다릅니다.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Supabase DB URL protocol이 PostgreSQL이 아닙니다.");
  }
}

export function buildLocalFixtureQueryArgs(): readonly string[] {
  return ["db", "query", "--local", "--file", LOCAL_FIXTURE_PATH];
}
