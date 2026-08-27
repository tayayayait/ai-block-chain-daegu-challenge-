import { describe, expect, it, vi } from "vitest";

import {
  createGeminiMedicationExtractor,
  sanitizeModelRawText,
  type GeminiGenerateRequest,
  type GeminiGenerateResponse,
} from "./gemini.server";

const MODEL_ID = "gemini-3.5-flash";
const IMAGE_DATA = "PRIVATE_IMAGE_BASE64";

const goodResponse = JSON.stringify({
  imageQuality: "GOOD",
  items: [
    {
      rawText: "리튬카보네이트정 1일 2회",
      productName: "리튬카보네이트정",
      shape: "원형",
      color: "흰색",
      imprint: "LC",
      dosageText: "1일 2회",
      confidence: 0.92,
    },
  ],
});

function extractorWith(
  generate: (request: GeminiGenerateRequest) => Promise<GeminiGenerateResponse>,
  options: {
    timeoutMs?: number;
    logger?: (entry: Readonly<{ modelId: string; code: string }>) => void;
  } = {},
) {
  return createGeminiMedicationExtractor({
    apiKey: "PRIVATE_API_KEY",
    model: MODEL_ID,
    generate,
    timeoutMs: options.timeoutMs,
    logger: options.logger ?? (() => undefined),
  });
}

describe("Gemini medication extraction adapter", () => {
  it("sends an inline image with the strict JSON Schema and keeps AI output non-persistable", async () => {
    const generate = vi.fn(
      async (_request: GeminiGenerateRequest): Promise<GeminiGenerateResponse> => ({
        text: goodResponse,
      }),
    );
    const extractor = extractorWith(generate);

    const result = await extractor.extract({
      image: { mimeType: "image/jpeg", data: IMAGE_DATA },
      previousAttemptCount: 0,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    const request = generate.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      model: MODEL_ID,
      contents: expect.arrayContaining([
        { inlineData: { mimeType: "image/jpeg", data: IMAGE_DATA } },
        { text: expect.stringContaining("약봉투") },
      ]),
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: expect.objectContaining({
          type: "object",
          additionalProperties: false,
        }),
        httpOptions: {
          timeout: expect.any(Number),
          retryOptions: { attempts: 1 },
        },
        abortSignal: expect.any(AbortSignal),
      },
    });
    expect(request?.config.httpOptions.timeout).toBeGreaterThan(0);
    expect(request?.config.httpOptions.timeout).toBeLessThanOrEqual(15_000);
    expect(result).toMatchObject({
      status: "NEEDS_CONFIRMATION",
      attemptCount: 1,
      modelId: MODEL_ID,
      canPersist: false,
      imageQuality: "GOOD",
      extraction: { items: [{ productName: "리튬카보네이트정" }] },
    });
  });

  it("sends the nested medication array using only the Gemini 3.5 structured-output schema subset", async () => {
    const generate = vi.fn(
      async (_request: GeminiGenerateRequest): Promise<GeminiGenerateResponse> => ({
        text: goodResponse,
      }),
    );

    await extractorWith(generate).extract({
      image: { mimeType: "image/jpeg", data: IMAGE_DATA },
      previousAttemptCount: 0,
    });

    expect(generate.mock.calls[0]?.[0].config.responseJsonSchema).toEqual({
      type: "object",
      properties: {
        imageQuality: {
          type: "string",
          enum: ["GOOD", "BLURRY", "PARTIAL", "UNREADABLE"],
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              rawText: { type: "string" },
              productName: { type: "string" },
              shape: {
                type: "string",
                enum: ["원형", "타원형", "장방형", "삼각형", "기타", "불명"],
              },
              color: { type: "string" },
              imprint: { type: "string" },
              dosageText: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["rawText", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["imageQuality", "items"],
      additionalProperties: false,
    });
  });

  it("retries one transient provider failure and never logs the provider error or image", async () => {
    const providerError = Object.assign(
      new Error("https://provider.test?key=PRIVATE_API_KEY PRIVATE_IMAGE_BASE64"),
      { status: 503 },
    );
    const generate = vi
      .fn<(request: GeminiGenerateRequest) => Promise<GeminiGenerateResponse>>()
      .mockRejectedValueOnce(providerError)
      .mockResolvedValueOnce({ text: goodResponse });
    const entries: Array<Readonly<{ modelId: string; code: string }>> = [];

    const result = await extractorWith(generate, {
      logger: (entry) => entries.push(entry),
    }).extract({
      image: { mimeType: "image/jpeg", data: IMAGE_DATA },
      previousAttemptCount: 0,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("NEEDS_CONFIRMATION");
    expect(entries).toEqual([{ modelId: MODEL_ID, code: "GEMINI_RETRYABLE_UPSTREAM" }]);
    expect(JSON.stringify(entries)).not.toMatch(
      /PRIVATE_API_KEY|PRIVATE_IMAGE_BASE64|provider\.test/,
    );
  });

  it("times out at the global boundary without extending the deadline for a retry", async () => {
    const generate = vi.fn(
      async (request: GeminiGenerateRequest): Promise<GeminiGenerateResponse> =>
        new Promise((_resolve, reject) => {
          request.config.abortSignal.addEventListener(
            "abort",
            () => reject(new DOMException("PRIVATE_TIMEOUT_BODY", "AbortError")),
            { once: true },
          );
        }),
    );
    const entries: Array<Readonly<{ modelId: string; code: string }>> = [];

    const result = await extractorWith(generate, {
      timeoutMs: 5,
      logger: (entry) => entries.push(entry),
    }).extract({
      image: { mimeType: "image/png", data: IMAGE_DATA },
      previousAttemptCount: 0,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "MANUAL_REQUIRED",
      attemptCount: 1,
      modelId: MODEL_ID,
      canPersist: false,
      errorCode: "GEMINI_TIMEOUT",
      userMessage: "AI 판독이 일시적으로 어렵습니다. 직접 입력해 주세요.",
    });
    expect(entries.at(-1)).toEqual({ modelId: MODEL_ID, code: "GEMINI_TIMEOUT" });
    expect(JSON.stringify(entries)).not.toContain("PRIVATE_TIMEOUT_BODY");
  });

  it("handles quota exhaustion with a safe manual fallback after one retry", async () => {
    const generate = vi.fn(async () => {
      throw Object.assign(new Error("PRIVATE_QUOTA_BODY"), { status: 429 });
    });

    const result = await extractorWith(generate).extract({
      image: { mimeType: "image/webp", data: IMAGE_DATA },
      previousAttemptCount: 1,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "MANUAL_REQUIRED",
      attemptCount: 2,
      errorCode: "GEMINI_QUOTA_EXCEEDED",
      canPersist: false,
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_QUOTA_BODY");
  });

  it("does not send a fourth image after the server session reaches three attempts", async () => {
    const generate = vi.fn(
      async (_request: GeminiGenerateRequest): Promise<GeminiGenerateResponse> => ({
        text: goodResponse,
      }),
    );

    const result = await extractorWith(generate).extract({
      image: { mimeType: "image/jpeg", data: IMAGE_DATA },
      previousAttemptCount: 3,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "MANUAL_REQUIRED",
      attemptCount: 3,
      modelId: MODEL_ID,
      canPersist: false,
      errorCode: "SCAN_ATTEMPT_LIMIT_REACHED",
      userMessage: "AI 판독이 일시적으로 어렵습니다. 직접 입력해 주세요.",
    });
  });

  it("reprompts once when the first response does not match the schema", async () => {
    const generate = vi
      .fn<(request: GeminiGenerateRequest) => Promise<GeminiGenerateResponse>>()
      .mockResolvedValueOnce({ text: '{"imageQuality":"GOOD","items":"invalid"}' })
      .mockResolvedValueOnce({ text: goodResponse });

    const result = await extractorWith(generate).extract({
      image: { mimeType: "image/jpeg", data: IMAGE_DATA },
      previousAttemptCount: 0,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0].contents).toEqual(
      expect.arrayContaining([{ text: expect.stringContaining("스키마") }]),
    );
    expect(result.status).toBe("NEEDS_CONFIRMATION");
  });

  it("shares one two-call budget across a transient retry and schema recovery", async () => {
    const providerError = Object.assign(new Error("PRIVATE_TRANSIENT_BODY"), { status: 503 });
    const unsafeRaw =
      "제품 후보: 검토정 apiKey=TOP_SECRET https://provider.test/private " + "A".repeat(120);
    const generate = vi
      .fn<(request: GeminiGenerateRequest) => Promise<GeminiGenerateResponse>>()
      .mockRejectedValueOnce(providerError)
      .mockResolvedValueOnce({ text: unsafeRaw });

    const result = await extractorWith(generate).extract({
      image: { mimeType: "image/jpeg", data: IMAGE_DATA },
      previousAttemptCount: 0,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "REVIEW_REQUIRED",
      errorCode: "GEMINI_SCHEMA_INVALID",
      safeRawText: expect.stringContaining("제품 후보: 검토정"),
    });
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_TRANSIENT_BODY|TOP_SECRET|provider\.test|A{80}/,
    );
  });

  it("shares one timeout deadline across extraction and schema reprompt", async () => {
    vi.useFakeTimers();
    try {
      const generate = vi
        .fn<(request: GeminiGenerateRequest) => Promise<GeminiGenerateResponse>>()
        .mockImplementationOnce(
          async () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ text: "not-json" }), 30);
            }),
        )
        .mockResolvedValueOnce({ text: goodResponse });

      const pending = extractorWith(generate, { timeoutMs: 50 }).extract({
        image: { mimeType: "image/jpeg", data: IMAGE_DATA },
        previousAttemptCount: 0,
      });
      await vi.advanceTimersByTimeAsync(30);
      const result = await pending;

      expect(result.status).toBe("NEEDS_CONFIRMATION");
      expect(generate).toHaveBeenCalledTimes(2);
      expect(generate.mock.calls[0]?.[0].config.httpOptions.timeout).toBe(50);
      expect(generate.mock.calls[1]?.[0].config.httpOptions.timeout).toBeLessThanOrEqual(20);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns only sanitized text for review after the one schema reprompt also fails", async () => {
    const unsafeRaw =
      "제품 후보: 테스트정\napiKey=TOP_SECRET\nhttps://provider.test/private?token=SECRET\n" +
      "A".repeat(120);
    const generate = vi
      .fn<(request: GeminiGenerateRequest) => Promise<GeminiGenerateResponse>>()
      .mockResolvedValueOnce({ text: "not-json" })
      .mockResolvedValueOnce({ text: unsafeRaw });

    const result = await extractorWith(generate).extract({
      image: { mimeType: "image/jpeg", data: IMAGE_DATA },
      previousAttemptCount: 0,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "REVIEW_REQUIRED",
      attemptCount: 1,
      modelId: MODEL_ID,
      canPersist: false,
      errorCode: "GEMINI_SCHEMA_INVALID",
      safeRawText: expect.stringContaining("제품 후보: 테스트정"),
    });
    expect(JSON.stringify(result)).not.toMatch(/TOP_SECRET|provider\.test|token=|A{80}/);
  });

  it("records only a safe code and switches to manual input when Gemini blocks the response", async () => {
    const entries: Array<Readonly<{ modelId: string; code: string }>> = [];
    const result = await extractorWith(
      async () => ({ promptFeedback: { blockReason: "SAFETY" } }),
      { logger: (entry) => entries.push(entry) },
    ).extract({
      image: { mimeType: "image/jpeg", data: IMAGE_DATA },
      previousAttemptCount: 0,
    });

    expect(result).toMatchObject({
      status: "MANUAL_REQUIRED",
      errorCode: "GEMINI_SAFETY_BLOCKED",
      canPersist: false,
    });
    expect(entries).toEqual([{ modelId: MODEL_ID, code: "GEMINI_SAFETY_BLOCKED" }]);
  });
});

describe("sanitizeModelRawText", () => {
  it("removes URLs, credential assignments, long encoded blobs, and control characters", () => {
    const sanitized = sanitizeModelRawText(
      "약 이름\u0000 apiKey=PRIVATE https://provider.test/path " + "Z".repeat(120),
    );

    expect(sanitized).toContain("약 이름");
    expect(sanitized).not.toMatch(/PRIVATE|provider\.test|Z{80}/);
    expect(sanitized).not.toContain("\u0000");
    expect(sanitized.length).toBeLessThanOrEqual(2_000);
  });

  it("redacts patient identifiers while retaining medication text for manual review", () => {
    const sanitized = sanitizeModelRawText(
      '제품 후보: 검토정, "patientName":"홍길동", 환자명: 김환자\n' +
        "연락처: 010-1234-5678, 이메일 test.person@example.com, 주민번호 900101-1234567",
    );

    expect(sanitized).toContain("제품 후보: 검토정");
    expect(sanitized).not.toMatch(
      /홍길동|김환자|010-1234-5678|test\.person@example\.com|900101-1234567/,
    );
  });
});
