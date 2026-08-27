import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Link2,
  RotateCcw,
  ShieldCheck,
  Unlink,
} from "lucide-react";
import { useState } from "react";

import type {
  CareEventVerificationDetails,
  PublicAttestationVerification,
  ShelterStatusVerificationDetails,
} from "@/lib/attestation/verification.server";

function formatKst(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "시각 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function shortValue(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function CopyValue({
  label,
  value,
  onCopied,
}: {
  label: string;
  value: string;
  onCopied: (message: string) => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <code className="num truncate text-sm" title={value}>
        {shortValue(value)}
      </code>
      <button
        type="button"
        className="border-border text-fg-2 hover:bg-overlay inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-bold"
        aria-label={`${label} 전체값 복사`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            onCopied(`${label} 복사 완료`);
          } catch {
            onCopied(`${label}을 복사하지 못했습니다`);
          }
        }}
      >
        <Copy aria-hidden="true" className="size-3.5" />
        복사
      </button>
    </span>
  );
}

function NetworkNotice() {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
      <span className="border-attest/40 bg-attest-bg text-attest rounded-full border px-3 py-1 text-xs font-bold">
        Base Sepolia 테스트넷
      </span>
      <span className="text-fg-3 text-xs">Chain ID 84532</span>
    </div>
  );
}

function PrivacyNotice() {
  return (
    <aside className="border-attest/30 bg-raised mt-6 rounded-xl border p-4" role="note">
      <div className="flex items-start gap-3">
        <ShieldCheck aria-hidden="true" className="text-attest mt-0.5 size-5 shrink-0" />
        <div className="t-caption text-fg-2 space-y-2">
          <p className="font-bold text-foreground">개인정보는 체인에 기록되지 않습니다.</p>
          <p>대상자는 서버 비밀 HMAC으로 가명 처리되며, 원본 식별자는 공개되지 않습니다.</p>
          <p>개인정보가 없는 허용 목록 데이터와 정규 JSON 해시만 앵커링됩니다.</p>
        </div>
      </div>
    </aside>
  );
}

function WhyBlockchain() {
  return (
    <p className="t-caption text-fg-2 mt-5 text-center">
      이 기록은 Base Sepolia 테스트넷에 발급되며, 발급·폐기 이력을 공개 검증할 수 있습니다. 운영
      결제나 실물 자산 거래가 아닙니다.
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border grid gap-1 border-b py-3 last:border-b-0 sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-4">
      <dt className="t-label text-fg-2">{label}</dt>
      <dd className="t-body-s min-w-0 font-semibold">{children}</dd>
    </div>
  );
}

function CareFields({
  details,
  onCopied,
}: {
  details: CareEventVerificationDetails;
  onCopied: (message: string) => void;
}) {
  return (
    <>
      <Field label="유형">{details.eventType}</Field>
      <Field label="위험 등급">{details.riskLevel}</Field>
      <Field label="HRI">
        <span className="num">{details.hriScore}</span>
      </Field>
      <Field label="발생 시각">{formatKst(details.occurredAt)} KST</Field>
      <Field label="대상자 해시">
        <CopyValue label="대상자 해시" value={details.subjectHash} onCopied={onCopied} />
        <span className="text-fg-3 ml-2 text-xs font-normal">원본 미기록</span>
      </Field>
      <Field label="페이로드 해시">
        <CopyValue label="페이로드 해시" value={details.payloadHash} onCopied={onCopied} />
      </Field>
    </>
  );
}

function ShelterFields({
  details,
  onCopied,
}: {
  details: ShelterStatusVerificationDetails;
  onCopied: (message: string) => void;
}) {
  return (
    <>
      <Field label="유형">쉼터 운영상태 제보</Field>
      <Field label="쉼터 코드">
        <code className="num text-sm">{details.shelterId}</code>
      </Field>
      <Field label="운영 상태">{details.isOpen ? "운영 중" : "운영 종료"}</Field>
      <Field label="혼잡도">{details.crowdLevel}</Field>
      <Field label="관찰 시각">{formatKst(details.observedAt)} KST</Field>
      <Field label="제보자 해시">
        <CopyValue label="제보자 해시" value={details.reporterHash} onCopied={onCopied} />
        <span className="text-fg-3 ml-2 text-xs font-normal">익명 세션 원본 미기록</span>
      </Field>
    </>
  );
}

function ProvenanceFields({
  result,
  onCopied,
}: {
  result: Extract<PublicAttestationVerification, { status: "VERIFIED" | "REVOKED" }>;
  onCopied: (message: string) => void;
}) {
  return (
    <>
      <Field label="증명 UID">
        <CopyValue label="증명 UID" value={result.uid} onCopied={onCopied} />
      </Field>
      <Field label="발급자">
        <CopyValue label="발급자" value={result.issuer} onCopied={onCopied} />
      </Field>
      <Field label="스키마">
        <span className="mr-2">{result.schema.label}</span>
        <CopyValue label="스키마 UID" value={result.schema.uid} onCopied={onCopied} />
      </Field>
    </>
  );
}

function StateMessage({ result }: { result: PublicAttestationVerification }) {
  const state =
    result.status === "NOT_OURS"
      ? {
          icon: <Unlink aria-hidden="true" className="text-danger size-9" />,
          title: "검증할 수 없는 증명",
          message: "온중이 발급한 증명이 아닙니다.",
        }
      : result.status === "TEMPORARY_UNAVAILABLE"
        ? {
            icon: <RotateCcw aria-hidden="true" className="text-warning size-9" />,
            title: "조회 일시 중단",
            message: "지금 증명을 조회할 수 없습니다. 잠시 후 다시 시도해 주세요.",
          }
        : {
            icon: <AlertTriangle aria-hidden="true" className="text-danger size-9" />,
            title: "증명을 찾을 수 없음",
            message: "이 증명을 찾을 수 없습니다. 주소를 확인해 주세요.",
          };

  return (
    <main className="py-8">
      <section className="border-border bg-raised rounded-xl border p-6 text-center" role="alert">
        <div className="flex justify-center">{state.icon}</div>
        <h1 className="t-h2 mt-4">{state.title}</h1>
        <NetworkNotice />
        <p className="t-body-s text-fg-2 mt-5">{state.message}</p>
        <a href="/" className="btn-primary mt-6 inline-flex min-h-12 items-center px-5">
          홈으로 이동
        </a>
      </section>
      <WhyBlockchain />
    </main>
  );
}

export function VerificationView({ result }: { result: PublicAttestationVerification }) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  if (
    result.status === "NOT_FOUND" ||
    result.status === "NOT_OURS" ||
    result.status === "TEMPORARY_UNAVAILABLE"
  ) {
    return <StateMessage result={result} />;
  }

  const revoked = result.status === "REVOKED";
  return (
    <main className="pb-12">
      <header className="pt-6 text-center">
        <div
          className={`mx-auto flex size-14 items-center justify-center rounded-full ${
            revoked ? "bg-danger/10 text-danger" : "bg-attest-bg text-attest"
          }`}
        >
          {revoked ? (
            <Unlink aria-hidden="true" className="size-7" />
          ) : (
            <Check aria-hidden="true" className="size-8" strokeWidth={3} />
          )}
        </div>
        <h1 className="t-d1 mt-4">{revoked ? "폐기된 증명" : "검증 완료"}</h1>
        <NetworkNotice />
        <p className="t-body-s text-fg-2 mt-5">
          {revoked
            ? `이 증명은 ${formatKst(result.revokedAt)} KST에 폐기되었습니다.`
            : `이 기록은 ${formatKst(result.issuedAt)} KST에 생성된 후 수정되지 않았습니다.`}
        </p>
      </header>

      <section className="border-border bg-raised mt-7 rounded-xl border p-4 sm:p-6">
        <h2 className="t-h3">공개 검증 정보</h2>
        <dl className="mt-3">
          {!revoked && result.details.kind === "CARE_EVENT" ? (
            <CareFields details={result.details} onCopied={setCopyStatus} />
          ) : null}
          {!revoked && result.details.kind === "SHELTER_STATUS" ? (
            <ShelterFields details={result.details} onCopied={setCopyStatus} />
          ) : null}
          <ProvenanceFields result={result} onCopied={setCopyStatus} />
          <Field label="발급 시각">{formatKst(result.issuedAt)} KST</Field>
          {revoked ? <Field label="폐기 시각">{formatKst(result.revokedAt)} KST</Field> : null}
        </dl>
      </section>

      {copyStatus ? (
        <p
          className="t-caption text-attest mt-3 text-center font-bold"
          role="status"
          aria-live="polite"
        >
          {copyStatus}
        </p>
      ) : null}

      <a
        href={result.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-secondary mt-6 flex min-h-12 w-full items-center justify-center gap-2 px-5"
      >
        <Link2 aria-hidden="true" className="size-5" />
        Base Sepolia 익스플로러에서 보기
        <ExternalLink aria-hidden="true" className="size-4" />
      </a>

      <PrivacyNotice />
      <WhyBlockchain />
    </main>
  );
}
