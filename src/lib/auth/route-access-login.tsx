import { useState, type FormEvent } from "react";

import { Btn } from "@/components/onjung/Btn";

import type { StaffCredentials, StaffSignInResult } from "./route-access.browser";

type StaffLoginFormProps = Readonly<{
  nextPath: string;
  authenticate: (credentials: StaffCredentials) => Promise<StaffSignInResult>;
  onSuccess: (nextPath: string) => void;
}>;

const SAFE_LOGIN_ERROR = "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.";

export function StaffLoginForm({ nextPath, authenticate, onSuccess }: StaffLoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await authenticate({ email, password });
      if (result.ok) {
        onSuccess(nextPath);
        return;
      }
      setPassword("");
      setError(result.userMessage);
    } catch {
      setPassword("");
      setError(SAFE_LOGIN_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 space-y-5" aria-describedby="login-help">
      <p id="login-help" className="text-fg-2 t-body-s">
        등록된 지자체·돌봄 담당자 계정으로 로그인해 주세요.
      </p>

      <div>
        <label htmlFor="staff-email" className="t-body-s mb-1.5 block font-semibold">
          이메일
        </label>
        <input
          id="staff-email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          disabled={submitting}
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          className="bg-raised text-foreground border-border t-body-s w-full rounded-md border px-3"
          style={{ minHeight: "var(--btn-h)" }}
        />
      </div>

      <div>
        <label htmlFor="staff-password" className="t-body-s mb-1.5 block font-semibold">
          비밀번호
        </label>
        <input
          id="staff-password"
          type="password"
          autoComplete="current-password"
          required
          disabled={submitting}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          className="bg-raised text-foreground border-border t-body-s w-full rounded-md border px-3"
          style={{ minHeight: "var(--btn-h)" }}
        />
      </div>

      {submitting && (
        <p className="text-fg-2 t-caption" role="status" aria-live="polite">
          로그인 확인 중…
        </p>
      )}
      {error && (
        <p className="t-body-s" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      )}

      <Btn type="submit" size="xl" full loading={submitting}>
        담당자 로그인
      </Btn>
    </form>
  );
}
