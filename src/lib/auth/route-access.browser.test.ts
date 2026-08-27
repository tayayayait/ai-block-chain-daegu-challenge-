import { describe, expect, it, vi } from "vitest";

import { signInStaffWithPassword } from "./route-access.browser";

describe("browser staff sign in", () => {
  it("delegates email/password credentials to the publishable Supabase auth client", async () => {
    const signInWithPassword = vi.fn(async () => ({ error: null }));

    await expect(
      signInStaffWithPassword(
        { email: "care@example.com", password: "correct horse battery staple" },
        { auth: { signInWithPassword } },
      ),
    ).resolves.toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "care@example.com",
      password: "correct horse battery staple",
    });
  });

  it("returns one safe Korean error for provider failures and exceptions", async () => {
    for (const signInWithPassword of [
      vi.fn(async () => ({ error: new Error("SENSITIVE_PROVIDER_RESPONSE") })),
      vi.fn(async () => {
        throw new Error("NETWORK_BODY_WITH_SECRET");
      }),
    ]) {
      const result = await signInStaffWithPassword(
        { email: "care@example.com", password: "wrong-password" },
        { auth: { signInWithPassword } },
      );
      expect(result).toEqual({
        ok: false,
        userMessage: "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.",
      });
      expect(JSON.stringify(result)).not.toMatch(/SENSITIVE|PROVIDER|NETWORK_BODY|SECRET/);
    }
  });
});
