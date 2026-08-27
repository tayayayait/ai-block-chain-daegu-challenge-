import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("Supabase migration deploy CLI failure boundary", () => {
  it("fails before provider access with an actionable message and no stack when confirmation is absent", () => {
    const result = spawnSync("npm", ["run", "supabase:deploy", "--silent"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ONJUNG_COMPAT_DEPLOYMENT_DRAINED: "" },
      shell: process.platform === "win32",
      windowsHide: true,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "호환 앱 배포와 기존 인스턴스 종료를 확인한 뒤 운영 runbook의 확인값을 설정하세요.",
    );
    expect(result.stderr).not.toContain("deploy-policy.ts:");
    expect(result.stderr).not.toContain("process.env");
  });
});
