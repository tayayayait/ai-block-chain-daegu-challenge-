import { useState, type FormEvent } from "react";

import { Btn } from "@/components/onjung/Btn";
import { FormField } from "@/components/onjung/FormField";

import type {
  SubjectRegistrationInput,
  SubjectRegistrationResult,
} from "./subject-registration.schema";

export interface SubjectRegistrationFormProps {
  submit(input: SubjectRegistrationInput): Promise<SubjectRegistrationResult>;
}

type FormState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "pending" }>
  | Readonly<{ kind: "error"; message: string }>
  | Extract<SubjectRegistrationResult, { kind: "success" }>;

function requiredBoolean(form: FormData, name: string): boolean | null {
  const value = form.get(name);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function BooleanQuestion({
  name,
  legend,
  yesLabel,
  noLabel,
}: {
  name: string;
  legend: string;
  yesLabel: string;
  noLabel: string;
}) {
  return (
    <fieldset className="border-border rounded-md border p-3">
      <legend className="t-body-s px-1 font-semibold">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2">
        <label className="t-body-s flex min-h-[var(--tap-min)] items-center gap-2">
          <input type="radio" name={name} value="true" required />
          {yesLabel}
        </label>
        <label className="t-body-s flex min-h-[var(--tap-min)] items-center gap-2">
          <input type="radio" name={name} value="false" required />
          {noLabel}
        </label>
      </div>
    </fieldset>
  );
}

function formInput(form: FormData, registrationRequestId: string): SubjectRegistrationInput | null {
  const livesAlone = requiredBoolean(form, "livesAlone");
  const chronicDisease = requiredBoolean(form, "chronicDisease");
  const hasCooling = requiredBoolean(form, "hasCooling");
  const seniorMode = requiredBoolean(form, "seniorMode");
  const consent = form.get("consent") === "on";
  const birthYearText = String(form.get("birthYear") ?? "");
  if (
    livesAlone === null ||
    chronicDisease === null ||
    hasCooling === null ||
    seniorMode === null ||
    birthYearText.trim() === "" ||
    !consent
  ) {
    return null;
  }

  return {
    registrationRequestId,
    name: String(form.get("name") ?? ""),
    birthYear: Number(birthYearText),
    sex: String(form.get("sex") ?? "") as SubjectRegistrationInput["sex"],
    phone: String(form.get("phone") ?? ""),
    guardianPhone: String(form.get("guardianPhone") ?? ""),
    address: String(form.get("address") ?? ""),
    livesAlone,
    chronicDisease,
    hasCooling,
    seniorMode,
    consent: true,
  };
}

export function SubjectRegistrationForm({ submit }: SubjectRegistrationFormProps) {
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [registrationRequestId] = useState(() => globalThis.crypto.randomUUID());

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = formInput(new FormData(form), registrationRequestId);
    if (!form.checkValidity() || !input) {
      setState({ kind: "error", message: "필수 항목을 모두 입력해 주세요." });
      return;
    }

    setState({ kind: "pending" });
    try {
      const result = await submit(input);
      if (result.kind === "error") {
        setState({ kind: "error", message: result.userMessage });
        return;
      }
      form.reset();
      setState(result);
    } catch {
      setState({ kind: "error", message: "등록 요청이 지연되고 있습니다. 다시 시도해 주세요." });
    }
  };

  if (state.kind === "success") {
    return (
      <section className="border-border bg-raised rounded-xl border p-6" aria-live="polite">
        <p className="t-caption font-semibold" style={{ color: "var(--brand)" }}>
          등록 완료
        </p>
        <h2 className="t-h2 mt-2">대상자가 안전하게 저장되었습니다</h2>
        <p className="text-fg-2 t-body-s mt-3 break-words">확정 주소: {state.canonicalAddress}</p>
        <p className="t-body-s mt-2 font-semibold">
          {state.initialRisk === "READY" ? "최초 위험도 계산 완료" : "위험도 계산 지연"}
        </p>
        {state.initialRisk === "DELAYED" ? (
          <p className="text-fg-2 t-caption mt-1">
            대상자 등록은 완료되었습니다. 기상 데이터가 복구되면 다음 계산 주기에 갱신됩니다.
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Btn asChild>
            <a href={`/subjects/${encodeURIComponent(state.subjectId)}`}>등록된 대상자 보기</a>
          </Btn>
          <Btn asChild variant="secondary">
            <a href="/subjects/new">다른 대상자 등록</a>
          </Btn>
        </div>
      </section>
    );
  }

  return (
    <form
      aria-label="대상자 등록 양식"
      className="border-border bg-raised space-y-6 rounded-xl border p-5 sm:p-7"
      onSubmit={onSubmit}
      noValidate
    >
      <div>
        <h2 className="t-h2">기본 정보</h2>
        <p className="text-fg-2 t-caption mt-1">
          실제 동의를 받은 대상자의 정보만 입력하세요. 주소는 서버에서 Naver로 다시 확인합니다.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="이름" kind="name" name="name" required maxLength={80} />
        <FormField
          label="출생연도"
          kind="age"
          name="birthYear"
          required
          min={new Date().getFullYear() - 130}
          max={new Date().getFullYear()}
        />
        <label className="t-body-s block font-semibold">
          성별
          <select
            name="sex"
            required
            defaultValue=""
            className="border-border bg-raised text-foreground mt-1.5 min-h-[var(--btn-h)] w-full rounded-md border px-3"
          >
            <option value="" disabled>
              선택하세요
            </option>
            <option value="FEMALE">여성</option>
            <option value="MALE">남성</option>
            <option value="OTHER">기타</option>
            <option value="UNDISCLOSED">응답하지 않음</option>
          </select>
        </label>
        <FormField
          label="전화번호 (선택)"
          kind="phone"
          name="phone"
          placeholder="전화번호 입력"
          maxLength={24}
        />
        <FormField
          label="보호자 전화번호 (선택)"
          kind="phone"
          name="guardianPhone"
          placeholder="보호자 전화번호 입력"
          maxLength={24}
        />
        <div className="sm:col-span-2">
          <FormField
            label="주소"
            kind="address"
            name="address"
            required
            minLength={2}
            maxLength={120}
            placeholder="대구광역시 도로명과 건물번호"
            hint="대구광역시 주소만 등록할 수 있으며, 검색 결과가 여러 개면 더 상세히 입력해야 합니다."
          />
        </div>
      </div>

      <div>
        <h2 className="t-h2">생활 환경</h2>
        <p className="text-fg-2 t-caption mt-1">
          각 항목은 현재 사실에 맞게 예·아니요를 선택하세요.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <BooleanQuestion
            name="livesAlone"
            legend="독거 여부"
            yesLabel="독거 예"
            noLabel="독거 아니요"
          />
          <BooleanQuestion
            name="chronicDisease"
            legend="만성질환 정보"
            yesLabel="만성질환 예"
            noLabel="만성질환 아니요"
          />
          <BooleanQuestion
            name="hasCooling"
            legend="사용 가능한 냉방기기"
            yesLabel="냉방기기 예"
            noLabel="냉방기기 아니요"
          />
          <BooleanQuestion
            name="seniorMode"
            legend="큰 글씨 화면 사용"
            yesLabel="큰 글씨 예"
            noLabel="큰 글씨 아니요"
          />
        </div>
      </div>

      <label className="t-body-s border-border flex items-start gap-3 rounded-md border p-4">
        <input type="checkbox" name="consent" required className="mt-1 size-5 shrink-0" />
        <span>
          개인정보 수집·이용에 동의
          <span className="text-fg-2 t-caption mt-1 block">
            대상자 정보, 연락처, 주소와 생활 환경 정보를 폭염 안전관리 목적으로 저장하는 데
            동의합니다.
          </span>
        </span>
      </label>

      {state.kind === "error" ? (
        <p role="alert" className="t-body-s text-danger">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Btn type="submit" loading={state.kind === "pending"}>
          대상자 등록
        </Btn>
        <Btn asChild variant="ghost">
          <a href="/dashboard">취소</a>
        </Btn>
      </div>
    </form>
  );
}
