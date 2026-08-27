export type StaffCredentials = Readonly<{
  email: string;
  password: string;
}>;

export type StaffSignInResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; userMessage: string }>;

export type PasswordAuthClient = Readonly<{
  auth: Readonly<{
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ error: unknown }>;
  }>;
}>;

const SAFE_LOGIN_ERROR = "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.";

export async function signInStaffWithPassword(
  credentials: StaffCredentials,
  client: PasswordAuthClient,
): Promise<StaffSignInResult> {
  try {
    const { error } = await client.auth.signInWithPassword({
      email: credentials.email.trim(),
      password: credentials.password,
    });
    return error ? { ok: false, userMessage: SAFE_LOGIN_ERROR } : { ok: true };
  } catch {
    return { ok: false, userMessage: SAFE_LOGIN_ERROR };
  }
}
