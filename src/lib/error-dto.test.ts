import { describe, expect, it } from "vitest";

import { AppError, createPublicError, PublicErrorDtoSchema, toPublicErrorDto } from "./error-dto";

describe("public error DTO contract", () => {
  it.each([
    ["WEATHER_UNAVAILABLE", "기상 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", true],
    ["AI_UNAVAILABLE", "AI 판독이 일시적으로 어렵습니다. 직접 입력해 주세요.", false],
    ["NOT_FOUND", "요청한 정보를 찾을 수 없습니다. 주소를 확인해 주세요.", false],
    [
      "REVIEW_CHANGED",
      "다른 화면에서 검토 내용이 변경되었습니다. 최신 내용을 다시 불러와 확인해 주세요.",
      false,
    ],
    ["INTERNAL_ERROR", "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", true],
  ] as const)("%s는 고정된 안전 메시지와 재시도 여부를 가진다", (code, message, retryable) => {
    expect(createPublicError(code)).toEqual({ code, userMessage: message, retryable });
  });

  it("스키마는 공개 세 필드 외 stack, cause, URL, provider body를 거부한다", () => {
    const safe = createPublicError("WEATHER_UNAVAILABLE");

    expect(PublicErrorDtoSchema.safeParse(safe).success).toBe(true);
    for (const unsafeField of ["stack", "cause", "url", "providerBody", "details"] as const) {
      expect(
        PublicErrorDtoSchema.safeParse({ ...safe, [unsafeField]: "DO_NOT_EXPOSE" }).success,
      ).toBe(false);
    }
  });

  it("스키마는 코드와 다른 임의 메시지·재시도 값을 거부한다", () => {
    const safe = createPublicError("WEATHER_UNAVAILABLE");

    expect(
      PublicErrorDtoSchema.safeParse({ ...safe, userMessage: "provider raw response" }).success,
    ).toBe(false);
    expect(PublicErrorDtoSchema.safeParse({ ...safe, retryable: false }).success).toBe(false);
  });

  it("검증된 DTO만 그대로 통과시키고 위조된 공개 메시지는 안전한 기본값으로 바꾼다", () => {
    const safe = createPublicError("WEATHER_UNAVAILABLE");

    expect(toPublicErrorDto(safe)).toEqual(safe);
    expect(
      toPublicErrorDto({ ...safe, userMessage: "RAW_PROVIDER_MESSAGE", stack: "RAW_STACK" }),
    ).toEqual(createPublicError("INTERNAL_ERROR"));
  });

  it("알 수 없는 오류의 원문 message와 stack을 공개 DTO에 복사하지 않는다", () => {
    const upstream = new Error(
      "GET https://example.test/data?authKey=AUTH_SECRET providerBody=PRIVATE_BODY",
    );
    upstream.stack = "STACK_SECRET";

    const dto = toPublicErrorDto(upstream, "WEATHER_UNAVAILABLE");
    const serialized = JSON.stringify(dto);

    expect(dto).toEqual({
      code: "WEATHER_UNAVAILABLE",
      userMessage: "기상 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      retryable: true,
    });
    expect(serialized).not.toMatch(/AUTH_SECRET|PRIVATE_BODY|STACK_SECRET|example\.test/);
    expect(Object.keys(dto)).toEqual(["code", "userMessage", "retryable"]);
  });

  it("Response URL과 provider body를 읽거나 전달하지 않는다", () => {
    const response = new Response("PROVIDER_BODY_SECRET", { status: 503 });
    Object.defineProperty(response, "url", {
      configurable: true,
      value: "https://example.test/api?serviceKey=QUERY_SECRET",
    });

    const serialized = JSON.stringify(toPublicErrorDto(response));

    expect(serialized).not.toMatch(/PROVIDER_BODY_SECRET|QUERY_SECRET|example\.test|serviceKey/);
  });

  it("내부 AppError는 code만 공개하고 cause는 DTO에 포함하지 않는다", () => {
    const internal = new AppError("AI_UNAVAILABLE", {
      cause: new Error("GEMINI_PROVIDER_SECRET"),
    });

    const dto = toPublicErrorDto(internal);

    expect(dto).toEqual({
      code: "AI_UNAVAILABLE",
      userMessage: "AI 판독이 일시적으로 어렵습니다. 직접 입력해 주세요.",
      retryable: false,
    });
    expect(JSON.stringify(dto)).not.toContain("GEMINI_PROVIDER_SECRET");
  });

  it("런타임에서 주입된 알 수 없는 코드는 완전한 INTERNAL_ERROR DTO로 치환한다", () => {
    const unsafeCreate = createPublicError as (code: unknown) => unknown;
    const forgedAppError = new AppError("UNKNOWN_PROVIDER_CODE" as never);

    expect(unsafeCreate("UNKNOWN_PROVIDER_CODE")).toEqual({
      code: "INTERNAL_ERROR",
      userMessage: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      retryable: true,
    });
    expect(toPublicErrorDto(forgedAppError)).toEqual(createPublicError("INTERNAL_ERROR"));
    expect(toPublicErrorDto(new Error("private"), "UNKNOWN_FALLBACK" as never)).toEqual(
      createPublicError("INTERNAL_ERROR"),
    );
  });

  it("순환 객체를 포함한 어떤 unknown도 변환 중 다시 throw하지 않는다", () => {
    const cyclic: Record<string, unknown> = { providerBody: "CYCLIC_SECRET" };
    cyclic["self"] = cyclic;

    expect(() => toPublicErrorDto(cyclic)).not.toThrow();
    expect(toPublicErrorDto(cyclic).code).toBe("INTERNAL_ERROR");
  });

  it("속성 접근 자체가 실패하는 외부 객체도 안전한 기본 오류로 치환한다", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("HOSTILE_GETTER_SECRET");
        },
        ownKeys() {
          throw new Error("HOSTILE_KEYS_SECRET");
        },
      },
    );

    expect(() => toPublicErrorDto(hostile)).not.toThrow();
    expect(toPublicErrorDto(hostile)).toEqual(createPublicError("INTERNAL_ERROR"));
  });
});
