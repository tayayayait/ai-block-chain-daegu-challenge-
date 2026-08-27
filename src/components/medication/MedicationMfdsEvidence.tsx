import { ChevronDown, Database, ImageIcon } from "lucide-react";

import type { MedicationCandidate } from "@/lib/medication/scan/schema";

type MfdsEvidence = NonNullable<MedicationCandidate["mfds"]>;
type ProviderAvailability = MfdsEvidence["sourceStatus"][keyof MfdsEvidence["sourceStatus"]];
type DurEvidence = NonNullable<MfdsEvidence["dur"]>;
type DurWarningOperation = Exclude<keyof DurEvidence, "PRODUCT">;

const PROVIDER_STATUS = {
  AVAILABLE: {
    label: "조회됨",
    className: "border-brand/40 bg-brand/5 text-brand",
  },
  PARTIAL: {
    label: "일부 조회됨",
    className: "border-heat-2/40 bg-heat-2/5 text-heat-2",
  },
  UNAVAILABLE: {
    label: "조회할 수 없음",
    className: "border-border bg-background text-fg-2",
  },
} satisfies Record<ProviderAvailability, { label: string; className: string }>;

const DUR_WARNING_OPERATIONS = [
  "COMBINATION_CONTRAINDICATION",
  "ELDERLY_CAUTION",
  "AGE_CONTRAINDICATION",
  "CAPACITY_CAUTION",
  "DURATION_CAUTION",
  "EFFICACY_DUPLICATION",
  "EXTENDED_RELEASE_SPLIT_CAUTION",
  "PREGNANCY_CONTRAINDICATION",
] as const satisfies readonly DurWarningOperation[];

const DUR_OPERATION_LABELS = {
  COMBINATION_CONTRAINDICATION: "병용 금기",
  ELDERLY_CAUTION: "노인 주의",
  AGE_CONTRAINDICATION: "연령 금기",
  CAPACITY_CAUTION: "용량 주의",
  DURATION_CAUTION: "투여기간 주의",
  EFFICACY_DUPLICATION: "효능군 중복",
  EXTENDED_RELEASE_SPLIT_CAUTION: "서방정 분할 주의",
  PREGNANCY_CONTRAINDICATION: "임부 금기",
} satisfies Record<DurWarningOperation, string>;

const MATCH_METHOD_LABELS = {
  PRODUCT_NAME_EXACT: "제품명 일치",
  PRODUCT_NAME_NORMALIZED: "정규화 제품명 일치",
  ITEM_SEQ: "품목기준코드 일치",
  PHYSICAL: "낱알 외형 일치",
} satisfies Record<NonNullable<MfdsEvidence["matchMethod"]>, string>;

function httpImageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function SourceStatus({ label, status }: { label: string; status: ProviderAvailability }) {
  const presentation = PROVIDER_STATUS[status];
  return (
    <li
      className={`flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 ${presentation.className}`}
      aria-label={`${label}: ${presentation.label}`}
    >
      <span className="t-caption truncate font-bold text-current">{label}</span>
      <span className="t-caption shrink-0 text-current">{presentation.label}</span>
    </li>
  );
}

function EasyDrugDetails({ evidence }: { evidence: NonNullable<MfdsEvidence["easyDrug"]> }) {
  const entries = [
    ["효능·효과", evidence.efficacy],
    ["용법·용량", evidence.usage],
    ["경고", evidence.warning],
    ["주의사항", evidence.caution],
    ["상호작용", evidence.interaction],
    ["이상반응", evidence.sideEffects],
    ["보관 방법", evidence.storage],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));

  if (entries.length === 0) return null;

  return (
    <details className="group border-border border-t">
      <summary className="hover:text-brand focus-visible:outline-brand flex min-h-[var(--tap-min)] cursor-pointer list-none items-center justify-between gap-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2">
        <span className="t-label">e약은요 상세 정보</span>
        <span className="flex items-center gap-2">
          <span className="t-caption text-fg-2">{entries.length}개 항목</span>
          <ChevronDown
            className="size-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </span>
      </summary>
      <dl className="grid gap-4 pb-4 sm:grid-cols-2">
        {entries.map(([label, value]) => (
          <div key={label} className="border-border bg-raised rounded-md border p-3">
            <dt className="t-caption font-bold text-fg-2">{label}</dt>
            <dd className="t-body-s mt-1 whitespace-pre-line break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function DurWarningDetails({
  candidateId,
  evidence,
}: {
  candidateId: string;
  evidence: DurEvidence;
}) {
  const warnings = DUR_WARNING_OPERATIONS.flatMap((operation) => {
    const result = evidence[operation];
    return result.items.length > 0 ? [{ operation, result }] : [];
  });

  if (warnings.length === 0) return null;

  return (
    <details className="group border-border border-t">
      <summary className="hover:text-brand focus-visible:outline-brand flex min-h-[var(--tap-min)] cursor-pointer list-none items-center justify-between gap-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2">
        <span className="t-label">DUR 주의 정보</span>
        <span className="flex items-center gap-2">
          <span className="t-caption text-fg-2">{warnings.length}개 유형</span>
          <ChevronDown
            className="size-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </span>
      </summary>
      <div className="space-y-3 pb-4">
        {warnings.map(({ operation, result }) => {
          const headingId = `mfds-${candidateId}-${operation.toLowerCase()}`;
          const count = result.totalCount ?? result.items.length;
          return (
            <section
              key={operation}
              className="border-border bg-raised rounded-md border p-3"
              aria-labelledby={headingId}
            >
              <h4 id={headingId} className="t-caption font-bold">
                {DUR_OPERATION_LABELS[operation]} · {count}건
              </h4>
              <ul className="mt-2 space-y-3">
                {result.items.map((item, index) => (
                  <li
                    key={`${item.itemSeq}-${item.relatedItemSeq ?? "self"}-${index}`}
                    className="border-border/70 border-t pt-2 first:border-t-0 first:pt-0"
                  >
                    {item.cautionText ? (
                      <p className="t-body-s whitespace-pre-line break-words">{item.cautionText}</p>
                    ) : null}
                    <dl className="t-caption text-fg-2 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {item.relatedItemName || item.relatedIngredientName ? (
                        <div className="flex gap-1">
                          <dt className="font-bold">관련 품목</dt>
                          <dd>{item.relatedItemName ?? item.relatedIngredientName}</dd>
                        </div>
                      ) : null}
                      {item.threshold ? (
                        <div className="flex gap-1">
                          <dt className="font-bold">기준</dt>
                          <dd>{item.threshold}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}

export function MedicationMfdsEvidence({
  candidate,
}: {
  candidate: MedicationCandidate | undefined;
}) {
  const mfds = candidate?.mfds;
  if (!candidate || !mfds) return null;

  const imageUrl = httpImageUrl(mfds.productImageUrl ?? mfds.easyDrug?.productImageUrl ?? null);

  return (
    <section
      className="border-border bg-background/60 mt-4 overflow-hidden rounded-lg border"
      aria-label={`${candidate.productName} 식약처 확인 자료`}
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="text-brand size-4 shrink-0" aria-hidden="true" />
            <h3 className="t-label">식약처 확인 자료</h3>
          </div>
          <p className="t-caption text-fg-2 mt-1">
            낱알식별·e약은요·DUR 공개자료의 조회 결과입니다.
          </p>
          {mfds.matchMethod ? (
            <p className="t-caption text-fg-2 mt-2">
              연결 기준 <span className="font-bold">{MATCH_METHOD_LABELS[mfds.matchMethod]}</span>
            </p>
          ) : null}
          <ul className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="식약처 자료별 조회 상태">
            <SourceStatus label="낱알식별" status={mfds.sourceStatus.pillIdentification} />
            <SourceStatus label="e약은요" status={mfds.sourceStatus.easyDrug} />
            <SourceStatus label="DUR" status={mfds.sourceStatus.dur} />
          </ul>
        </div>
        {imageUrl ? (
          <figure className="border-border bg-raised flex min-h-28 items-center justify-center overflow-hidden rounded-md border">
            <img
              className="h-28 w-full object-contain p-2"
              src={imageUrl}
              alt={`${candidate.productName} 제품 이미지`}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </figure>
        ) : (
          <div
            className="border-border text-fg-2 hidden min-h-28 items-center justify-center rounded-md border border-dashed sm:flex"
            aria-hidden="true"
          >
            <ImageIcon className="size-5" />
          </div>
        )}
      </div>
      <div className="px-4">
        {mfds.easyDrug ? <EasyDrugDetails evidence={mfds.easyDrug} /> : null}
        {mfds.dur ? (
          <DurWarningDetails candidateId={candidate.candidateId} evidence={mfds.dur} />
        ) : null}
      </div>
    </section>
  );
}
