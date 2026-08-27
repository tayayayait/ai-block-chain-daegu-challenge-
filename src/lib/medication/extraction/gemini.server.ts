import "@tanstack/react-start/server-only";

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { getServerEnv } from "@/lib/env.server";
import { MEDICATION_EXTRACTION_JSON_SCHEMA } from "./schema-json.server";
import {
  MedicationExtractionSchema,
  type MedicationExtraction,
  type MedicationImageQuality,
} from "./schema";
import { decideMedicationScanState } from "./scan-state";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_CALLS_PER_IMAGE = 2;
const MANUAL_FALLBACK_MESSAGE = "AI 판독이 일시적으로 어렵습니다. 직접 입력해 주세요.";
const SAFE_RAW_TEXT_LIMIT = 2_000;

const ImageInputSchema = z
  .object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    data: z.string().trim().min(1),
  })
  .strict();

const ExtractionInputSchema = z
  .object({
    image: ImageInputSchema,
    previousAttemptCount: z.number().int().min(0).max(3),
  })
  .strict();

export type GeminiMedicationErrorCode =
  | "GEMINI_TIMEOUT"
  | "GEMINI_QUOTA_EXCEEDED"
  | "GEMINI_RETRYABLE_UPSTREAM"
  | "GEMINI_SAFETY_BLOCKED"
  | "GEMINI_SCHEMA_INVALID"
  | "GEMINI_UNAVAILABLE";

export type GeminiGenerateRequest = Readonly<{
  model: string;
  contents: Array<
    | Readonly<{ inlineData: Readonly<{ mimeType: string; data: string }> }>
    | Readonly<{ text: string }>
  >;
  config: Readonly<{
    responseMimeType: "application/json";
    responseJsonSchema: unknown;
    temperature: number;
    httpOptions: Readonly<{
      timeout: number;
      retryOptions: Readonly<{ attempts: 1 }>;
    }>;
    abortSignal: AbortSignal;
  }>;
}>;

export type GeminiGenerateResponse = Readonly<{
  text?: string | undefined;
  promptFeedback?: Readonly<{ blockReason?: string | undefined }> | undefined;
  candidates?: ReadonlyArray<Readonly<{ finishReason?: string | undefined }>> | undefined;
}>;

export type GeminiMedicationLogEntry = Readonly<{
  modelId: string;
  code: GeminiMedicationErrorCode;
}>;

type Generate = (request: GeminiGenerateRequest) => Promise<GeminiGenerateResponse>;
type Logger = (entry: GeminiMedicationLogEntry) => void;
type ExtractionBudget = { calls: number; deadlineAt: number };

type SuccessfulExtractionResult = Readonly<{
  status: "NEEDS_CONFIRMATION";
  attemptCount: number;
  modelId: string;
  canPersist: false;
  imageQuality: "GOOD";
  extraction: MedicationExtraction;
  userMessage: null;
}>;

type BadImageResult = Readonly<{
  status: "NEEDS_RETAKE" | "MANUAL_REQUIRED";
  attemptCount: number;
  modelId: string;
  canPersist: false;
  imageQuality: Exclude<MedicationImageQuality, "GOOD">;
  userMessage: string;
  errorCode?: "QUALITY_RETRY_LIMIT";
}>;

type ReviewRequiredResult = Readonly<{
  status: "REVIEW_REQUIRED";
  attemptCount: number;
  modelId: string;
  canPersist: false;
  errorCode: "GEMINI_SCHEMA_INVALID";
  safeRawText: string;
  userMessage: "AI 판독 결과를 확인하고 수정한 뒤 확정해 주세요.";
}>;

type ManualRequiredResult = Readonly<{
  status: "MANUAL_REQUIRED";
  attemptCount: number;
  modelId: string;
  canPersist: false;
  errorCode: GeminiMedicationErrorCode | "SCAN_ATTEMPT_LIMIT_REACHED";
  userMessage: typeof MANUAL_FALLBACK_MESSAGE;
}>;

export type GeminiMedicationExtractionResult =
  SuccessfulExtractionResult | BadImageResult | ReviewRequiredResult | ManualRequiredResult;

class SafeGeminiError extends Error {
  constructor(
    readonly code: GeminiMedicationErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "SafeGeminiError";
  }
}

const INITIAL_PROMPT = [
  "약봉투 또는 알약 사진을 판독하세요.",
  "제품명, 모양, 색상, 각인, 복용 문구와 각 항목의 confidence를 추출하세요.",
  "사진 품질은 GOOD, BLURRY, PARTIAL, UNREADABLE 중 하나로 분류하세요.",
  "환자명, 연락처, 주소 등 개인정보는 결과에 포함하지 마세요.",
  "제공된 JSON 스키마 외의 필드는 절대 반환하지 마세요.",
].join(" ");

const SCHEMA_REPROMPT = [
  "이전 응답이 지정된 스키마를 충족하지 않았습니다.",
  "이미지를 다시 판독하여 제공된 JSON 스키마와 정확히 일치하는 JSON만 반환하세요.",
  "개인정보와 스키마 외 필드는 반환하지 마세요.",
].join(" ");

function defaultLogger(entry: GeminiMedicationLogEntry): void {
  // Intentionally log only the configured model ID and a controlled code.
  console.warn("[gemini-medication]", entry);
}

function safeLog(logger: Logger, entry: GeminiMedicationLogEntry): void {
  try {
    logger(Object.freeze(entry));
  } catch {
    // Observability must never break the manual fallback path.
  }
}

function readProviderStatus(error: unknown): number | undefined {
  try {
    if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" && Number.isInteger(status) ? status : undefined;
  } catch {
    return undefined;
  }
}

function isAbortError(error: unknown): boolean {
  try {
    return (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError"
    );
  } catch {
    return false;
  }
}

function classifyProviderError(error: unknown): SafeGeminiError {
  if (error instanceof SafeGeminiError) return error;
  if (isAbortError(error)) return new SafeGeminiError("GEMINI_TIMEOUT", true);

  const status = readProviderStatus(error);
  if (status === 429) return new SafeGeminiError("GEMINI_QUOTA_EXCEEDED", true);
  if (status === 408 || (status !== undefined && status >= 500)) {
    return new SafeGeminiError("GEMINI_RETRYABLE_UPSTREAM", true);
  }

  return new SafeGeminiError("GEMINI_UNAVAILABLE", false);
}

function responseWasSafetyBlocked(response: GeminiGenerateResponse): boolean {
  try {
    if (response.promptFeedback?.blockReason) return true;

    const blockedFinishReasons = new Set([
      "SAFETY",
      "BLOCKLIST",
      "PROHIBITED_CONTENT",
      "SPII",
      "RECITATION",
    ]);
    return Boolean(
      response.candidates?.some(
        (candidate) =>
          typeof candidate.finishReason === "string" &&
          blockedFinishReasons.has(candidate.finishReason),
      ),
    );
  } catch {
    return false;
  }
}

function safeResponseText(response: GeminiGenerateResponse): string {
  try {
    if (responseWasSafetyBlocked(response)) {
      throw new SafeGeminiError("GEMINI_SAFETY_BLOCKED", false);
    }
    return typeof response.text === "string" ? response.text : "";
  } catch (error) {
    if (error instanceof SafeGeminiError) throw error;
    throw new SafeGeminiError("GEMINI_UNAVAILABLE", false);
  }
}

export function sanitizeModelRawText(rawText: string): string {
  const withoutControls = [...rawText]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      const isDisallowedControl =
        (codePoint >= 0 && codePoint <= 8) ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127;
      return isDisallowedControl ? " " : character;
    })
    .join("");
  const withoutLabeledPatientData = withoutControls.replace(
    /(?:"?(?:patientName|patient_name|patientPhone|patient_phone|patientAddress|patient_address)"?|환자명|성명|연락처|전화번호|환자주소)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^,\r\n}]+)/gi,
    "[개인정보 제거]",
  );
  const withoutPersonalIdentifiers = withoutLabeledPatientData
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[이메일 제거]")
    .replace(
      /(?<!\d)(?:\+?82[-.\s]?)?(?:0(?:2|[3-6]\d|1[016789]))[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g,
      "[전화번호 제거]",
    )
    .replace(/(?<!\d)\d{6}[- ]?[1-4]\d{6}(?!\d)/g, "[주민번호 제거]");
  const withoutDataUrls = withoutPersonalIdentifiers.replace(
    /data:image\/[^;\s]+;base64,[^\s]+/gi,
    "[이미지 제거]",
  );
  const withoutUrls = withoutDataUrls.replace(/https?:\/\/\S+/gi, "[URL 제거]");
  const withoutCredentials = withoutUrls.replace(
    /\b(?:api[_-]?key|auth[_-]?key|service[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi,
    "[인증정보 제거]",
  );
  const withoutEncodedBlobs = withoutCredentials.replace(
    /\b[A-Za-z0-9+/_=-]{80,}\b/g,
    "[긴 데이터 제거]",
  );
  const compact = withoutEncodedBlobs
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [...compact].slice(0, SAFE_RAW_TEXT_LIMIT).join("") || "판독 원문을 확인할 수 없습니다.";
}

function parseExtraction(rawText: string): MedicationExtraction | null {
  try {
    const parsedJson: unknown = JSON.parse(rawText);
    const parsed = MedicationExtractionSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function attemptCountAfterCurrentCapture(previousAttemptCount: number): number {
  return Math.min(previousAttemptCount + 1, 3);
}

export function createGeminiMedicationExtractor(options: {
  apiKey: string;
  model: string;
  generate?: Generate | undefined;
  timeoutMs?: number | undefined;
  logger?: Logger | undefined;
}): {
  extract(input: {
    image: { mimeType: "image/jpeg" | "image/png" | "image/webp"; data: string };
    previousAttemptCount: number;
  }): Promise<GeminiMedicationExtractionResult>;
} {
  const apiKey = z.string().trim().min(1).parse(options.apiKey);
  const model = z.string().trim().min(1).max(200).parse(options.model);
  const timeoutMs = z
    .number()
    .int()
    .min(1)
    .max(30_000)
    .parse(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const logger = options.logger ?? defaultLogger;
  const client = options.generate ? null : new GoogleGenAI({ apiKey });
  const generate: Generate =
    options.generate ??
    (async (request) => {
      if (!client) throw new SafeGeminiError("GEMINI_UNAVAILABLE", false);
      return client.models.generateContent(request);
    });

  async function invoke(
    prompt: string,
    image: z.infer<typeof ImageInputSchema>,
    budget: ExtractionBudget,
  ): Promise<string> {
    if (budget.calls >= MAX_PROVIDER_CALLS_PER_IMAGE) {
      throw new SafeGeminiError("GEMINI_UNAVAILABLE", false);
    }
    const remainingTimeoutMs = Math.min(timeoutMs, budget.deadlineAt - Date.now());
    if (remainingTimeoutMs <= 0) {
      throw new SafeGeminiError("GEMINI_TIMEOUT", true);
    }
    budget.calls += 1;
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const request: GeminiGenerateRequest = {
      model,
      contents: [{ inlineData: image }, { text: prompt }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: MEDICATION_EXTRACTION_JSON_SCHEMA,
        temperature: 0,
        // The SDK defaults to five attempts. Disable its internal retries so
        // this adapter's global two-call budget is the sole retry policy.
        httpOptions: { timeout: remainingTimeoutMs, retryOptions: { attempts: 1 } },
        abortSignal: controller.signal,
      },
    };

    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new SafeGeminiError("GEMINI_TIMEOUT", true));
        }, remainingTimeoutMs);
      });
      const response = await Promise.race([generate(request), timeout]);
      return safeResponseText(response);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  async function invokeWithRetry(
    prompt: string,
    image: z.infer<typeof ImageInputSchema>,
    budget: ExtractionBudget,
  ): Promise<string> {
    while (budget.calls < MAX_PROVIDER_CALLS_PER_IMAGE) {
      try {
        return await invoke(prompt, image, budget);
      } catch (error) {
        const safeError = classifyProviderError(error);
        safeLog(logger, { modelId: model, code: safeError.code });
        if (
          !safeError.retryable ||
          budget.calls >= MAX_PROVIDER_CALLS_PER_IMAGE ||
          Date.now() >= budget.deadlineAt
        ) {
          throw safeError;
        }
      }
    }
    throw new SafeGeminiError("GEMINI_UNAVAILABLE", false);
  }

  return Object.freeze({
    async extract(input): Promise<GeminiMedicationExtractionResult> {
      const parsedInput = ExtractionInputSchema.parse(input);
      const attemptCount = attemptCountAfterCurrentCapture(parsedInput.previousAttemptCount);
      const budget: ExtractionBudget = {
        calls: 0,
        deadlineAt: Date.now() + timeoutMs,
      };

      if (parsedInput.previousAttemptCount >= 3) {
        return Object.freeze({
          status: "MANUAL_REQUIRED",
          attemptCount,
          modelId: model,
          canPersist: false,
          errorCode: "SCAN_ATTEMPT_LIMIT_REACHED",
          userMessage: MANUAL_FALLBACK_MESSAGE,
        });
      }

      let firstRawText: string;
      try {
        firstRawText = await invokeWithRetry(INITIAL_PROMPT, parsedInput.image, budget);
      } catch (error) {
        const safeError = classifyProviderError(error);
        return Object.freeze({
          status: "MANUAL_REQUIRED",
          attemptCount,
          modelId: model,
          canPersist: false,
          errorCode: safeError.code,
          userMessage: MANUAL_FALLBACK_MESSAGE,
        });
      }

      let extraction = parseExtraction(firstRawText);
      let finalRawText = firstRawText;
      if (extraction === null && budget.calls < MAX_PROVIDER_CALLS_PER_IMAGE) {
        try {
          finalRawText = await invokeWithRetry(SCHEMA_REPROMPT, parsedInput.image, budget);
        } catch (error) {
          const safeError = classifyProviderError(error);
          return Object.freeze({
            status: "MANUAL_REQUIRED",
            attemptCount,
            modelId: model,
            canPersist: false,
            errorCode: safeError.code,
            userMessage: MANUAL_FALLBACK_MESSAGE,
          });
        }
        extraction = parseExtraction(finalRawText);
      }

      if (extraction === null) {
        safeLog(logger, { modelId: model, code: "GEMINI_SCHEMA_INVALID" });
        return Object.freeze({
          status: "REVIEW_REQUIRED",
          attemptCount,
          modelId: model,
          canPersist: false,
          errorCode: "GEMINI_SCHEMA_INVALID",
          safeRawText: sanitizeModelRawText(finalRawText),
          userMessage: "AI 판독 결과를 확인하고 수정한 뒤 확정해 주세요.",
        });
      }

      const decision = decideMedicationScanState({
        previousAttemptCount: parsedInput.previousAttemptCount,
        imageQuality: extraction.imageQuality,
      });

      if (decision.imageQuality === "GOOD") {
        return Object.freeze({
          status: "NEEDS_CONFIRMATION",
          attemptCount: decision.attemptCount,
          modelId: model,
          canPersist: false,
          imageQuality: decision.imageQuality,
          extraction,
          userMessage: null,
        });
      }

      if (decision.status === "MANUAL_REQUIRED") {
        return Object.freeze({
          status: decision.status,
          attemptCount: decision.attemptCount,
          modelId: model,
          canPersist: false,
          imageQuality: decision.imageQuality,
          userMessage: decision.userMessage,
          errorCode: "QUALITY_RETRY_LIMIT",
        });
      }

      return Object.freeze({
        status: decision.status,
        attemptCount: decision.attemptCount,
        modelId: model,
        canPersist: false,
        imageQuality: decision.imageQuality,
        userMessage: decision.userMessage,
      });
    },
  });
}

export function createDefaultGeminiMedicationExtractor(): ReturnType<
  typeof createGeminiMedicationExtractor
> {
  const environment = getServerEnv();
  return createGeminiMedicationExtractor({
    apiKey: environment.GEMINI_API_KEY,
    model: environment.GEMINI_MODEL,
  });
}
