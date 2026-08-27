import type { MedRiskTier } from "@/lib/domain-types";

export const HEAT_CLASS_TIER: Readonly<Record<string, MedRiskTier>> = {
  이뇨제: "HIGH",
  항콜린제: "HIGH",
  항정신병제: "HIGH",
  항우울제: "HIGH",
  "1세대 항히스타민제": "HIGH",
  혈압강하제: "MID",
  칼슘채널길항제: "MID",
  "질산염·혈관확장제": "MID",
  리튬: "MID",
  항간질제: "MID",
  항치매제: "MID",
  "항불안제·근이완제": "MID",
  교감신경흥분제: "MID",
};
