import { z } from "zod";

export const AppErrorCodeSchema = z.enum([
  "WEATHER_UNAVAILABLE",
  "NETWORK_UNAVAILABLE",
  "SERVER_TEMPORARY",
  "AI_UNAVAILABLE",
  "REVIEW_CHANGED",
  "NOT_FOUND",
  "INVALID_REQUEST",
  "INTERNAL_ERROR",
]);

export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>;

const ERROR_CATALOG = {
  WEATHER_UNAVAILABLE: {
    userMessage: "기상 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    retryable: true,
  },
  NETWORK_UNAVAILABLE: {
    userMessage: "네트워크에 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
    retryable: true,
  },
  SERVER_TEMPORARY: {
    userMessage: "서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.",
    retryable: true,
  },
  AI_UNAVAILABLE: {
    userMessage: "AI 판독이 일시적으로 어렵습니다. 직접 입력해 주세요.",
    retryable: false,
  },
  REVIEW_CHANGED: {
    userMessage: "다른 화면에서 검토 내용이 변경되었습니다. 최신 내용을 다시 불러와 확인해 주세요.",
    retryable: false,
  },
  NOT_FOUND: {
    userMessage: "요청한 정보를 찾을 수 없습니다. 주소를 확인해 주세요.",
    retryable: false,
  },
  INVALID_REQUEST: {
    userMessage: "입력 내용을 확인하고 다시 시도해 주세요.",
    retryable: false,
  },
  INTERNAL_ERROR: {
    userMessage: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    retryable: true,
  },
} as const satisfies Record<
  AppErrorCode,
  { readonly userMessage: string; readonly retryable: boolean }
>;

export type PublicErrorDto = {
  [Code in AppErrorCode]: Readonly<{
    code: Code;
    userMessage: (typeof ERROR_CATALOG)[Code]["userMessage"];
    retryable: (typeof ERROR_CATALOG)[Code]["retryable"];
  }>;
}[AppErrorCode];

export const PublicErrorDtoSchema = z
  .object({
    code: AppErrorCodeSchema,
    userMessage: z.string(),
    retryable: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = ERROR_CATALOG[value.code];
    if (value.userMessage !== expected.userMessage) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userMessage"],
        message: "userMessage must match the public error catalog",
      });
    }
    if (value.retryable !== expected.retryable) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retryable"],
        message: "retryable must match the public error catalog",
      });
    }
  });

export class AppError<Code extends AppErrorCode = AppErrorCode> extends Error {
  readonly code: Code;

  constructor(code: Code, options?: ErrorOptions) {
    super(code, options);
    this.name = "AppError";
    this.code = code;
  }
}

export function createPublicError<Code extends AppErrorCode>(
  code: Code,
): Extract<PublicErrorDto, { code: Code }>;
export function createPublicError(code: unknown): PublicErrorDto {
  const parsedCode = AppErrorCodeSchema.safeParse(code);
  const safeCode: AppErrorCode = parsedCode.success ? parsedCode.data : "INTERNAL_ERROR";

  return Object.freeze({ code: safeCode, ...ERROR_CATALOG[safeCode] }) as PublicErrorDto;
}

export function toPublicErrorDto(
  error: unknown,
  fallbackCode: AppErrorCode = "INTERNAL_ERROR",
): PublicErrorDto {
  try {
    const parsed = PublicErrorDtoSchema.safeParse(error);
    if (parsed.success) {
      return Object.freeze(parsed.data) as PublicErrorDto;
    }

    if (error instanceof AppError) {
      return createPublicError(error.code);
    }
  } catch {
    // External objects can expose throwing getters or Proxy traps. Their
    // diagnostics stay internal; the client receives only the safe fallback.
  }

  return createPublicError(fallbackCode);
}
