import type { HriInput, HriResult } from "./hri";

interface ReasonCandidate {
  text: string;
  contribution: number;
}

const advisoryLabel = (input: HriInput, applied: number) => {
  if (applied === 0) return "";
  if (input.heatAdvisory === "WARNING") return " + 폭염경보";
  if (input.heatAdvisory === "WATCH") return " + 폭염주의보";
  return "";
};

export function buildHriReasons(input: HriInput, result: HriResult): string[] {
  const candidates: ReasonCandidate[] = [];
  const { environment, medication, personal, mitigation } = result.contributions;
  const feltAndAdvisory = environment.base.applied + environment.advisory.applied;

  if (feltAndAdvisory > 0) {
    candidates.push({
      text: `체감 ${input.feelsLikeC.toFixed(1)}℃${advisoryLabel(input, environment.advisory.applied)} (+${feltAndAdvisory})`,
      contribution: feltAndAdvisory,
    });
  }

  if (environment.tropicalNight.applied > 0) {
    candidates.push({
      text: `열대야 ${input.tropicalNightStreak}일 연속 (+${environment.tropicalNight.applied})`,
      contribution: environment.tropicalNight.applied,
    });
  }

  const medicationApplied = medication.high.applied + medication.mid.applied;
  if (medicationApplied > 0) {
    const parts: string[] = [];
    if (medication.high.applied > 0) parts.push(`고위험 ${input.medHigh}계열`);
    if (medication.mid.applied > 0) parts.push(`중위험 ${input.medMid}계열`);
    candidates.push({
      text: `폭염 주의 의약품 ${parts.join(" · ")} 복용 (+${medicationApplied})`,
      contribution: medicationApplied,
    });
  }

  if (medication.missingRegistration) {
    candidates.push({
      text: "복약 정보 미등록 — 위험도가 과소평가될 수 있습니다",
      contribution: 0,
    });
  }

  if (personal.age.applied > 0) {
    candidates.push({
      text: `${input.age}세 고령 (+${personal.age.applied})`,
      contribution: personal.age.applied,
    });
  }
  if (personal.livesAlone.applied > 0) {
    candidates.push({
      text: `독거 (+${personal.livesAlone.applied})`,
      contribution: personal.livesAlone.applied,
    });
  }
  if (personal.chronicDisease.applied > 0) {
    candidates.push({
      text: `만성질환 보유 (+${personal.chronicDisease.applied})`,
      contribution: personal.chronicDisease.applied,
    });
  }
  if (personal.noCooling.applied > 0) {
    candidates.push({
      text: `냉방기 없음 또는 미가동 (+${personal.noCooling.applied})`,
      contribution: personal.noCooling.applied,
    });
  }
  if (mitigation.verifiedShelterCheckIn.applied > 0) {
    candidates.push({
      text: `24시간 내 검증된 쉼터 체크인 (−${mitigation.verifiedShelterCheckIn.applied})`,
      contribution: mitigation.verifiedShelterCheckIn.applied,
    });
  }

  const sorted = candidates.sort((left, right) => right.contribution - left.contribution);
  if (medication.missingRegistration) {
    const warning = sorted.find(({ contribution }) => contribution === 0);
    const positiveReasons = sorted.filter(({ contribution }) => contribution > 0).slice(0, 2);

    return [...positiveReasons, ...(warning ? [warning] : [])].map(({ text }) => text);
  }

  return sorted.slice(0, 3).map(({ text }) => text);
}
