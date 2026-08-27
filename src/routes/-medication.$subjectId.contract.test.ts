import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/routes/medication.$subjectId.tsx"), "utf8");

describe("Phase 4 medication scan route contract", () => {
  it("guards subject access and exposes capture, review, and complete URL steps", () => {
    expect(source).toContain('createFileRoute("/medication/$subjectId")');
    expect(source).toContain("requireMedicationSubjectRouteAccess");
    expect(source).toContain("MedicationScanSearchSchema");
    expect(source).toContain('step: "capture"');
    expect(source).toContain('step: "review"');
    expect(source).toContain('step: "complete"');
  });

  it("sends processed images as multipart and uses RHF with the shared Zod schema", () => {
    expect(source).toContain("preprocessMedicationImage");
    expect(source).toContain("new FormData()");
    expect(source).toContain("useForm<MedicationReviewFormValues>");
    expect(source).toContain("zodResolver(MedicationReviewFormSchema)");
    expect(source).toContain("useFieldArray");
    expect(source).toContain('encType="multipart/form-data"');
  });

  it("shows confidence/source, replacement policy, risk delta, and medical disclaimer", () => {
    expect(source).toContain("신뢰도");
    expect(source).toContain("출처");
    expect(source).toContain("기존 목록에 추가");
    expect(source).toContain("기존 목록 교체");
    expect(source).toContain("변경 전");
    expect(source).toContain("변경 후");
    expect(source).toContain("의료적 진단이나 처방 확정이 아닙니다");
  });
});
