import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Camera, CheckCircle2, ImagePlus, Loader2, PenLine, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";

import { MedicationMfdsEvidence } from "@/components/medication/MedicationMfdsEvidence";
import { createPublicError } from "@/lib/error-dto";
import {
  protectedLocationPath,
  requireMedicationSubjectRouteAccess,
} from "@/lib/auth/route-access";
import { HEAT_MEDICATION_CLASSES } from "@/lib/medication/classify";
import { HEAT_CLASS_TIER } from "@/lib/medication/heat-classes";
import {
  cameraPromptAllowed,
  preprocessMedicationImage,
  rememberCameraDenial,
} from "@/lib/medication/image-input";
import {
  MedicationManualInputSchema,
  MedicationReviewFormSchema,
  MedicationScanSearchSchema,
  medicationReviewDefaultValues,
  type MedicationManualInput,
  type MedicationReviewFormValues,
} from "@/lib/medication/scan/schema";
import type {
  MedicationCandidateEnrichmentResult,
  MedicationConfirmationReceipt,
  MedicationImageScanResult,
} from "@/lib/medication/scan/service";

const ReviewRequestSchema = z
  .object({ subjectId: z.string().uuid(), sessionId: z.string().uuid() })
  .strict();
const ReceiptRequestSchema = z
  .object({ subjectId: z.string().uuid(), requestId: z.string().uuid() })
  .strict();

const getMedicationReview = createServerFn({ method: "GET" })
  .validator((input: unknown) => ReviewRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const { loadMedicationReviewForRequest } = await import("@/lib/medication/scan/request.server");
    return loadMedicationReviewForRequest(data);
  });

const getMedicationReceipt = createServerFn({ method: "GET" })
  .validator((input: unknown) => ReceiptRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const { loadMedicationReceiptForRequest } =
      await import("@/lib/medication/scan/request.server");
    return loadMedicationReceiptForRequest(data);
  });

export const Route = createFileRoute("/medication/$subjectId")({
  validateSearch: (search) => MedicationScanSearchSchema.parse(search),
  beforeLoad: async ({ location, params }) => {
    await requireMedicationSubjectRouteAccess({
      subjectId: params.subjectId,
      nextPath: protectedLocationPath(location),
    });
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    if (deps.step === "review" && deps.scan) {
      const result = await getMedicationReview({
        data: { subjectId: params.subjectId, sessionId: deps.scan },
      });
      if (result.kind === "redirect") throw redirect({ href: result.href });
      return { step: "review" as const, result, requestId: crypto.randomUUID() };
    }
    if (deps.step === "complete" && deps.receipt) {
      const result = await getMedicationReceipt({
        data: { subjectId: params.subjectId, requestId: deps.receipt },
      });
      if (result.kind === "redirect") throw redirect({ href: result.href });
      return { step: "complete" as const, result };
    }
    return { step: "capture" as const };
  },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleMedicationPostRequest } = await import("./-medication-post.server");
        return handleMedicationPostRequest(request);
      },
    },
  },
  head: () => ({
    meta: [
      { title: "복약 스캔 — 온중 溫證" },
      {
        name: "description",
        content: "약 사진 또는 직접 입력을 검토한 후 폭염 위험도에 반영합니다.",
      },
    ],
  }),
  component: MedicationScanRoute,
});

type PostBody<T> =
  Readonly<{ ok: true; data: T }> | Readonly<{ ok: false; code: string; href?: string }>;

async function postMedication<T>(form: FormData): Promise<PostBody<T>> {
  try {
    const response = await fetch(window.location.pathname, {
      method: "POST",
      body: form,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "ok" in payload &&
      typeof (payload as { ok?: unknown }).ok === "boolean"
    ) {
      return payload as PostBody<T>;
    }
  } catch {
    // The UI receives one controlled fallback below; raw network errors stay local.
  }
  return { ok: false, code: "NETWORK_UNAVAILABLE" };
}

function StepIndicator({ active }: { active: "capture" | "review" | "complete" }) {
  const steps = [
    ["capture", "1", "입력"],
    ["review", "2", "검토"],
    ["complete", "3", "완료"],
  ] as const;
  return (
    <ol className="mb-8 grid grid-cols-3 gap-2" aria-label="복약 등록 단계">
      {steps.map(([step, number, label]) => (
        <li
          key={step}
          className={`rounded-lg border px-3 py-3 text-center ${active === step ? "border-brand bg-brand/10" : "border-border bg-raised"}`}
          aria-current={active === step ? "step" : undefined}
        >
          <span className="t-label block">{number}단계</span>
          <span className="t-body-s text-fg-2">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function Disclaimer() {
  return (
    <div className="border-warning/40 bg-warning/5 mt-8 rounded-lg border p-4" role="note">
      <div className="flex gap-3">
        <ShieldAlert className="text-warning mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <p className="t-body-s text-fg-2">
          {
            "이 결과는 폭염 돌봄 위험도 산정을 돕기 위한 참고 정보이며, 의료적 진단이나 처방 확정이 아닙니다. 약 변경·중단은 의사나 약사와 상의하세요."
          }
        </p>
      </div>
    </div>
  );
}

function MedicationScanRoute() {
  const search = Route.useSearch();
  const loader = Route.useLoaderData();
  const { subjectId } = Route.useParams();

  return (
    <main className="shade bg-background text-foreground min-h-dvh px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <a href={`/subjects/${subjectId}`} className="t-body-s text-fg-2 underline">
          대상자 상세로 돌아가기
        </a>
        <header className="mt-5 mb-7">
          <p className="t-label text-brand">MEDICATION REVIEW</p>
          <h1 className="t-h1 mt-2">복약 정보 등록</h1>
          <p className="t-body text-fg-2 mt-3">
            사진 판독 결과와 공공데이터 후보를 반드시 확인한 뒤 위험도에 반영합니다.
          </p>
        </header>

        <StepIndicator active={search.step} />
        {loader.step === "capture" ? (
          <CaptureStep subjectId={subjectId} retrySessionId={search.scan} />
        ) : null}
        {loader.step === "review" ? (
          loader.result.kind === "success" ? (
            <ReviewStep
              subjectId={subjectId}
              requestId={loader.requestId}
              review={loader.result.data}
            />
          ) : (
            <PublicError message={loader.result.error.userMessage} />
          )
        ) : null}
        {loader.step === "complete" ? (
          loader.result.kind === "success" ? (
            <CompleteStep receipt={loader.result.data} />
          ) : (
            <PublicError message={loader.result.error.userMessage} />
          )
        ) : null}
        <Disclaimer />
      </div>
    </main>
  );
}

function PublicError({ message }: { message: string }) {
  return (
    <div className="border-danger/30 bg-danger/5 rounded-lg border p-5" role="alert">
      <h2 className="t-h3">요청을 처리하지 못했습니다</h2>
      <p className="t-body-s text-fg-2 mt-2">{message}</p>
    </div>
  );
}

function CaptureStep({
  subjectId,
  retrySessionId,
}: {
  subjectId: string;
  retrySessionId: string | undefined;
}) {
  const navigate = Route.useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSeed, setManualSeed] = useState({ productName: "", revision: 0 });

  async function submitImage(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const processed = await preprocessMedicationImage(file);
      const form = new FormData();
      form.set("operation", "capture");
      form.set("subjectId", subjectId);
      if (retrySessionId) form.set("scanSessionId", retrySessionId);
      form.set("image", new File([processed.blob], "medication.jpg", { type: processed.mimeType }));
      const result = await postMedication<MedicationImageScanResult>(form);
      if (!result.ok) {
        if (result.href) window.location.assign(result.href);
        else setMessage("사진을 처리하지 못했습니다. 직접 입력하거나 다시 시도해 주세요.");
        return;
      }
      if (result.data.kind === "review") {
        await navigate({ search: { step: "review", scan: result.data.sessionId } });
      } else if (result.data.kind === "retake") {
        setMessage(result.data.userMessage);
        await navigate({
          search: { step: "capture", scan: result.data.sessionId },
          replace: true,
        });
      } else {
        setMessage(result.data.userMessage);
        const productName = result.data.safeRawText ?? "";
        setManualSeed((current) => ({
          productName,
          revision: current.revision + 1,
        }));
        setManualOpen(true);
      }
    } catch {
      setMessage("지원되는 선명한 사진인지 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function openCamera(input: HTMLInputElement | null) {
    if (!input) return;
    if (!cameraPromptAllowed(window.localStorage)) {
      setMessage("카메라 권한을 다시 묻지 않습니다. 앨범 또는 직접 입력을 이용해 주세요.");
      return;
    }
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        rememberCameraDenial(window.localStorage);
        setMessage("카메라 권한이 없어 앨범 또는 직접 입력을 이용할 수 있습니다.");
        return;
      }
    }
    input.dataset["permissionChecked"] = "true";
    input.click();
  }

  return (
    <section className="border-border bg-raised rounded-xl border p-5 sm:p-7">
      <h2 className="t-h2">약 사진 또는 직접 입력</h2>
      <p className="t-body-s text-fg-2 mt-2">
        약봉투 전체나 알약의 각인·색상이 선명하게 보이게 해주세요.
      </p>
      <form
        encType="multipart/form-data"
        className="mt-6 grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="border-border hover:border-brand flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border p-4 text-center">
          <Camera className="mb-2 size-6" aria-hidden="true" />
          <span className="t-label">카메라 촬영</span>
          <input
            className="sr-only"
            type="file"
            name="camera"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={busy}
            ref={(node) => {
              if (node) node.dataset["cameraInput"] = "true";
            }}
            onClick={(event) => {
              if (event.currentTarget.dataset["permissionChecked"]) {
                delete event.currentTarget.dataset["permissionChecked"];
                return;
              }
              event.preventDefault();
              void openCamera(event.currentTarget);
            }}
            onChange={(event) => void submitImage(event.target.files?.[0])}
          />
        </label>
        <label className="border-border hover:border-brand flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border p-4 text-center">
          <ImagePlus className="mb-2 size-6" aria-hidden="true" />
          <span className="t-label">앨범에서 선택</span>
          <input
            className="sr-only"
            type="file"
            name="album"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => void submitImage(event.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          className="border-border hover:border-brand flex min-h-28 flex-col items-center justify-center rounded-lg border p-4 text-center"
          onClick={() => setManualOpen((open) => !open)}
          disabled={busy}
        >
          <PenLine className="mb-2 size-6" aria-hidden="true" />
          <span className="t-label">직접 입력</span>
        </button>
      </form>
      {busy ? (
        <p className="t-body-s text-fg-2 mt-4 flex items-center gap-2" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> 사진을 안전하게 처리하고
          있습니다.
        </p>
      ) : null}
      {message ? (
        <p className="t-body-s text-danger mt-4" role="alert">
          {message}
        </p>
      ) : null}
      {manualOpen ? (
        <ManualForm
          key={manualSeed.revision}
          subjectId={subjectId}
          initialProductName={manualSeed.productName}
        />
      ) : null}
    </section>
  );
}

function ManualForm({
  subjectId,
  initialProductName,
}: {
  subjectId: string;
  initialProductName: string;
}) {
  const navigate = Route.useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<MedicationManualInput>({
    resolver: zodResolver(MedicationManualInputSchema),
    defaultValues: { subjectId, productName: initialProductName, itemSeq: "", ingredientName: "" },
    mode: "onBlur",
    shouldFocusError: true,
  });

  return (
    <form
      className="border-border mt-6 space-y-4 border-t pt-6"
      onSubmit={form.handleSubmit(async (values) => {
        setServerError(null);
        const body = new FormData();
        body.set("operation", "manual");
        body.set("subjectId", values.subjectId);
        body.set("productName", values.productName);
        body.set("itemSeq", values.itemSeq);
        body.set("ingredientName", values.ingredientName);
        const result = await postMedication<{ sessionId: string }>(body);
        if (!result.ok) {
          if (result.href) window.location.assign(result.href);
          else setServerError("직접 입력 내용을 저장하지 못했습니다. 다시 시도해 주세요.");
          return;
        }
        await navigate({ search: { step: "review", scan: result.data.sessionId } });
      })}
      noValidate
    >
      <h3 className="t-h3">직접 입력</h3>
      <Field label="제품명" id="manual-product" error={form.formState.errors.productName?.message}>
        <input
          id="manual-product"
          className="field w-full"
          {...form.register("productName")}
          aria-invalid={Boolean(form.formState.errors.productName)}
          aria-describedby={form.formState.errors.productName ? "manual-product-error" : undefined}
        />
      </Field>
      <Field
        label="품목기준코드 (선택)"
        id="manual-seq"
        error={form.formState.errors.itemSeq?.message}
      >
        <input
          id="manual-seq"
          inputMode="numeric"
          className="field w-full"
          {...form.register("itemSeq")}
          aria-invalid={Boolean(form.formState.errors.itemSeq)}
          aria-describedby={form.formState.errors.itemSeq ? "manual-seq-error" : undefined}
        />
      </Field>
      <Field
        label="성분명 (알면 입력)"
        id="manual-ingredient"
        error={form.formState.errors.ingredientName?.message}
      >
        <input
          id="manual-ingredient"
          className="field w-full"
          {...form.register("ingredientName")}
          aria-invalid={Boolean(form.formState.errors.ingredientName)}
          aria-describedby={
            form.formState.errors.ingredientName ? "manual-ingredient-error" : undefined
          }
        />
      </Field>
      {serverError ? (
        <p className="t-body-s text-danger" role="alert">
          {serverError}
        </p>
      ) : null}
      <button
        className="btn-primary min-h-[var(--tap-min)] px-5"
        type="submit"
        disabled={form.formState.isSubmitting}
      >
        검토 단계로 이동
      </button>
    </form>
  );
}

function Field({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="t-label mb-2 block" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="t-body-s text-danger mt-1" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReviewStep({
  subjectId,
  requestId,
  review,
}: {
  subjectId: string;
  requestId: string;
  review: {
    sessionId: string;
    status: string;
    candidates: readonly import("@/lib/medication/scan/schema").MedicationCandidate[];
  };
}) {
  const navigate = Route.useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [evidenceCandidates, setEvidenceCandidates] = useState([...review.candidates]);
  const [enrichingCandidateId, setEnrichingCandidateId] = useState<string | null>(null);
  const [evidenceMessages, setEvidenceMessages] = useState<Record<string, string>>({});
  const [reviewChanged, setReviewChanged] = useState(false);
  const form = useForm<MedicationReviewFormValues>({
    resolver: zodResolver(MedicationReviewFormSchema),
    defaultValues: medicationReviewDefaultValues({
      requestId,
      subjectId,
      scanSessionId: review.sessionId,
      candidates: review.candidates,
    }),
    mode: "onBlur",
    shouldFocusError: true,
  });
  const { fields } = useFieldArray({ control: form.control, name: "medications" });

  async function enrichCandidate(index: number, candidateId: string) {
    const current = form.getValues(`medications.${index}`);
    setServerError(null);
    setEnrichingCandidateId(candidateId);
    const body = new FormData();
    body.set("operation", "enrich");
    body.set("subjectId", subjectId);
    body.set("scanSessionId", review.sessionId);
    body.set("candidateId", candidateId);
    body.set("productName", current.productName);
    body.set("itemSeq", current.itemSeq);
    body.set("ingredientName", current.ingredientName);
    const result = await postMedication<MedicationCandidateEnrichmentResult>(body);
    setEnrichingCandidateId(null);
    if (!result.ok) {
      if (result.href) window.location.assign(result.href);
      else if (result.code === "REVIEW_CHANGED") {
        setReviewChanged(true);
        setEvidenceMessages((messages) => ({
          ...messages,
          [candidateId]: createPublicError("REVIEW_CHANGED").userMessage,
        }));
      } else
        setEvidenceMessages((messages) => ({
          ...messages,
          [candidateId]:
            "식약처 자료를 불러오지 못했습니다. 입력값을 수정하거나 다시 시도해 주세요.",
        }));
      return;
    }

    const candidate = result.data.candidate;
    setEvidenceCandidates((candidates) =>
      candidates.map((item) => (item.candidateId === candidateId ? candidate : item)),
    );
    form.setValue(`medications.${index}.productName`, candidate.productName, {
      shouldValidate: true,
    });
    form.setValue(`medications.${index}.itemSeq`, candidate.itemSeq ?? "", {
      shouldValidate: true,
    });
    form.setValue(`medications.${index}.manufacturerName`, candidate.manufacturerName ?? "");
    form.setValue(`medications.${index}.ingredientName`, candidate.ingredientName ?? "", {
      shouldValidate: true,
    });
    form.setValue(`medications.${index}.heatClass`, candidate.heatClass ?? "", {
      shouldValidate: true,
    });
    form.setValue(`medications.${index}.riskTier`, candidate.riskTier, {
      shouldValidate: true,
    });
    form.setValue(`medications.${index}.source`, candidate.source);
    form.setValue(`medications.${index}.evidenceSource`, candidate.evidenceSource);
    const message =
      result.data.outcome === "ENRICHED"
        ? "식약처 자료를 조회해 검토 항목에 반영했습니다."
        : result.data.outcome === "SELECTION_REQUIRED"
          ? "같은 이름의 품목이 여러 개입니다. 품목기준코드를 입력해 한 품목을 지정해 주세요."
          : result.data.outcome === "MATCH_NOT_FOUND"
            ? "일치하는 식약처 품목을 찾지 못했습니다. 제품명과 품목기준코드를 확인해 주세요."
            : "식약처 일부 자료가 지연되고 있습니다. 현재 입력은 유지되며 나중에 다시 확인할 수 있습니다.";
    setEvidenceMessages((messages) => ({ ...messages, [candidateId]: message }));
  }

  if (fields.length === 0) {
    return (
      <div className="border-border bg-raised rounded-xl border p-6">
        <h2 className="t-h2">후보를 찾지 못했습니다</h2>
        <p className="t-body-s text-fg-2 mt-2">
          사진 판독 또는 공공데이터 조회가 어려워 직접 입력이 필요합니다.
        </p>
        <a
          className="btn-primary mt-5 inline-flex min-h-[var(--tap-min)] items-center px-5"
          href={`/medication/${subjectId}?step=capture`}
        >
          직접 입력하기
        </a>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        setServerError(null);
        const body = new FormData();
        body.set("operation", "confirm");
        body.set("payload", JSON.stringify(values));
        const result = await postMedication<MedicationConfirmationReceipt>(body);
        if (!result.ok) {
          if (result.href) window.location.assign(result.href);
          else
            setServerError("확정 내용을 저장하지 못했습니다. 입력을 확인하고 다시 시도해 주세요.");
          return;
        }
        await navigate({ search: { step: "complete", receipt: result.data.requestId } });
      })}
    >
      <section className="border-border bg-raised rounded-xl border p-5 sm:p-7">
        <h2 className="t-h2">AI·공공데이터 후보 검토</h2>
        <p className="t-body-s text-fg-2 mt-2">
          선택 여부와 제품명·성분·폭염 위험 약물군을 직접 확인해 주세요.
        </p>
        <div className="mt-6 space-y-4">
          {fields.map((field, index) => {
            const error = form.formState.errors.medications?.[index];
            const sourceCandidate = evidenceCandidates.find(
              (candidate) => candidate.candidateId === field.candidateId,
            );
            const confidence =
              field.confidence === null ? "직접 입력" : `${Math.round(field.confidence * 100)}%`;
            const source =
              field.evidenceSource === "GEMINI_MFDS"
                ? "Gemini + 식약처"
                : field.evidenceSource === "GEMINI_ONLY"
                  ? "Gemini 판독"
                  : "직접 입력";
            return (
              <article key={field.id} className="border-border rounded-lg border p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <label className="t-label flex min-h-[var(--tap-min)] items-center gap-2">
                    <input type="checkbox" {...form.register(`medications.${index}.selected`)} />{" "}
                    등록 대상
                  </label>
                  <div className="t-body-s text-fg-2 flex gap-3">
                    <span>신뢰도 {confidence}</span>
                    <span>출처 {source}</span>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="제품명"
                    id={`med-${index}-name`}
                    error={error?.productName?.message}
                  >
                    <input
                      id={`med-${index}-name`}
                      className="field w-full"
                      {...form.register(`medications.${index}.productName`)}
                      aria-invalid={Boolean(error?.productName)}
                      aria-describedby={error?.productName ? `med-${index}-name-error` : undefined}
                    />
                  </Field>
                  <Field
                    label="품목기준코드 (선택)"
                    id={`med-${index}-seq`}
                    error={error?.itemSeq?.message}
                  >
                    <input
                      id={`med-${index}-seq`}
                      inputMode="numeric"
                      className="field w-full"
                      {...form.register(`medications.${index}.itemSeq`)}
                      aria-invalid={Boolean(error?.itemSeq)}
                      aria-describedby={error?.itemSeq ? `med-${index}-seq-error` : undefined}
                    />
                  </Field>
                  <Field
                    label="성분명"
                    id={`med-${index}-ingredient`}
                    error={error?.ingredientName?.message}
                  >
                    <input
                      id={`med-${index}-ingredient`}
                      className="field w-full"
                      {...form.register(`medications.${index}.ingredientName`)}
                      aria-invalid={Boolean(error?.ingredientName)}
                    />
                  </Field>
                  <Field
                    label="폭염 위험 약물군"
                    id={`med-${index}-class`}
                    error={error?.heatClass?.message}
                  >
                    <select
                      id={`med-${index}-class`}
                      className="field w-full"
                      {...form.register(`medications.${index}.heatClass`, {
                        onChange: (event) => {
                          const value = event.target.value as keyof typeof HEAT_CLASS_TIER | "";
                          const tier = value === "" ? "NONE" : HEAT_CLASS_TIER[value];
                          if (tier)
                            form.setValue(`medications.${index}.riskTier`, tier, {
                              shouldValidate: true,
                            });
                        },
                      })}
                      aria-invalid={Boolean(error?.heatClass)}
                    >
                      <option value="">해당 없음</option>
                      {HEAT_MEDICATION_CLASSES.map((heatClass) => (
                        <option key={heatClass} value={heatClass}>
                          {heatClass}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div>
                    <span className="t-label mb-2 block">위험 등급</span>
                    <output className="field flex min-h-[var(--tap-min)] items-center">
                      {form.watch(`medications.${index}.riskTier`)}
                    </output>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="btn-secondary min-h-[var(--tap-min)] px-4"
                    disabled={enrichingCandidateId !== null || reviewChanged}
                    onClick={() => void enrichCandidate(index, field.candidateId)}
                  >
                    {enrichingCandidateId === field.candidateId
                      ? "식약처 자료 조회 중…"
                      : "식약처 실제 자료 확인"}
                  </button>
                  {evidenceMessages[field.candidateId] ? (
                    <p className="t-body-s text-fg-2" role="status">
                      {evidenceMessages[field.candidateId]}
                    </p>
                  ) : null}
                </div>
                <MedicationMfdsEvidence candidate={sourceCandidate} />
              </article>
            );
          })}
        </div>
        {typeof form.formState.errors.medications?.message === "string" ? (
          <p className="t-body-s text-danger mt-3" role="alert">
            {form.formState.errors.medications.message}
          </p>
        ) : null}
      </section>

      {reviewChanged ? (
        <section className="border-warning/50 bg-warning/5 rounded-xl border p-5" role="alert">
          <p className="t-body-s text-fg-2">
            최신 저장 내용을 확인하기 전에는 이 검토를 확정할 수 없습니다.
          </p>
          <button
            type="button"
            className="btn-secondary mt-3 min-h-[var(--tap-min)] px-4"
            onClick={() => window.location.reload()}
          >
            최신 검토 내용 다시 불러오기
          </button>
        </section>
      ) : null}

      <section className="border-border bg-raised rounded-xl border p-5 sm:p-7">
        <fieldset>
          <legend className="t-h3">기존 복약 목록 처리</legend>
          <label className="t-body mt-4 flex min-h-[var(--tap-min)] items-center gap-3">
            <input type="radio" value="ADD" {...form.register("policy")} /> 기존 목록에 추가
          </label>
          <label className="t-body flex min-h-[var(--tap-min)] items-center gap-3">
            <input type="radio" value="REPLACE" {...form.register("policy")} /> 기존 목록 교체
          </label>
        </fieldset>
        <label className="t-body mt-5 flex items-start gap-3">
          <input
            className="mt-1"
            type="checkbox"
            {...form.register("confirmed")}
            aria-invalid={Boolean(form.formState.errors.confirmed)}
          />{" "}
          <span>후보와 약물군을 직접 확인했으며 선택한 내용으로 위험도를 다시 계산합니다.</span>
        </label>
        {form.formState.errors.confirmed ? (
          <p className="t-body-s text-danger mt-2" role="alert">
            {form.formState.errors.confirmed.message}
          </p>
        ) : null}
        {serverError ? (
          <p className="t-body-s text-danger mt-3" role="alert">
            {serverError}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn-primary mt-6 min-h-[var(--tap-min)] px-6"
          disabled={form.formState.isSubmitting || reviewChanged}
        >
          {form.formState.isSubmitting ? "반영 중…" : "확정하고 위험도 재계산"}
        </button>
      </section>
    </form>
  );
}

function CompleteStep({ receipt }: { receipt: MedicationConfirmationReceipt }) {
  return (
    <section className="border-border bg-raised rounded-xl border p-6 sm:p-8">
      <CheckCircle2 className="text-success size-10" aria-hidden="true" />
      <h2 className="t-h2 mt-4">복약 정보가 반영되었습니다</h2>
      <p className="t-body-s text-fg-2 mt-2">
        {receipt.medicationIds.length}개 약물을 저장하고 같은 트랜잭션에서 위험도를 다시
        계산했습니다.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="border-border rounded-lg border p-4">
          <span className="t-label text-fg-2">변경 전</span>
          <p className="t-h2 mt-2">
            {receipt.before
              ? `${receipt.before.level} · ${receipt.before.hri}점`
              : "이전 계산 없음"}
          </p>
        </div>
        <div className="border-brand bg-brand/5 rounded-lg border p-4">
          <span className="t-label text-brand">변경 후</span>
          <p className="t-h2 mt-2">
            {receipt.after.level} · {receipt.after.hri}점
          </p>
        </div>
      </div>
      {receipt.transitionCreated ? (
        <p className="t-body-s text-warning mt-4" role="status">
          위험 단계 진입 또는 상승 이벤트를 중복 없이 1회 기록했습니다.
        </p>
      ) : null}
      <a
        href="/dashboard"
        className="btn-primary mt-6 inline-flex min-h-[var(--tap-min)] items-center px-6"
      >
        대시보드로 이동
      </a>
    </section>
  );
}
