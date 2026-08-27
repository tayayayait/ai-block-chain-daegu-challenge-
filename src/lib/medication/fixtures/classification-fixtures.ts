import type { HeatMedicationClass } from "../classify";

export const appendixBRepresentativeFixtures: ReadonlyArray<{
  ingredient: string;
  heatClass: HeatMedicationClass;
  tier: "HIGH" | "MID";
}> = [
  { ingredient: "푸로세미드", heatClass: "이뇨제", tier: "HIGH" },
  { ingredient: "하이드로클로로티아지드", heatClass: "이뇨제", tier: "HIGH" },
  { ingredient: "스피로노락톤", heatClass: "이뇨제", tier: "HIGH" },
  { ingredient: "옥시부티닌", heatClass: "항콜린제", tier: "HIGH" },
  { ingredient: "스코폴라민", heatClass: "항콜린제", tier: "HIGH" },
  { ingredient: "글리코피롤레이트", heatClass: "항콜린제", tier: "HIGH" },
  { ingredient: "할로페리돌", heatClass: "항정신병제", tier: "HIGH" },
  { ingredient: "리스페리돈", heatClass: "항정신병제", tier: "HIGH" },
  { ingredient: "올란자핀", heatClass: "항정신병제", tier: "HIGH" },
  { ingredient: "아미트립틸린", heatClass: "항우울제", tier: "HIGH" },
  { ingredient: "플루옥세틴", heatClass: "항우울제", tier: "HIGH" },
  { ingredient: "파록세틴", heatClass: "항우울제", tier: "HIGH" },
  { ingredient: "클로르페니라민", heatClass: "1세대 항히스타민제", tier: "HIGH" },
  { ingredient: "디펜히드라민", heatClass: "1세대 항히스타민제", tier: "HIGH" },
  { ingredient: "하이드록시진", heatClass: "1세대 항히스타민제", tier: "HIGH" },
  { ingredient: "에날라프릴", heatClass: "혈압강하제", tier: "MID" },
  { ingredient: "로사르탄", heatClass: "혈압강하제", tier: "MID" },
  { ingredient: "아테놀올", heatClass: "혈압강하제", tier: "MID" },
  { ingredient: "암로디핀", heatClass: "칼슘채널길항제", tier: "MID" },
  { ingredient: "니페디핀", heatClass: "칼슘채널길항제", tier: "MID" },
  { ingredient: "딜티아젬", heatClass: "칼슘채널길항제", tier: "MID" },
  { ingredient: "니트로글리세린", heatClass: "질산염·혈관확장제", tier: "MID" },
  { ingredient: "이소소르비드", heatClass: "질산염·혈관확장제", tier: "MID" },
  { ingredient: "탄산리튬", heatClass: "리튬", tier: "MID" },
  { ingredient: "카바마제핀", heatClass: "항간질제", tier: "MID" },
  { ingredient: "발프로산", heatClass: "항간질제", tier: "MID" },
  { ingredient: "토피라메이트", heatClass: "항간질제", tier: "MID" },
  { ingredient: "도네페질", heatClass: "항치매제", tier: "MID" },
  { ingredient: "리바스티그민", heatClass: "항치매제", tier: "MID" },
  { ingredient: "메만틴", heatClass: "항치매제", tier: "MID" },
  { ingredient: "디아제팜", heatClass: "항불안제·근이완제", tier: "MID" },
  { ingredient: "로라제팜", heatClass: "항불안제·근이완제", tier: "MID" },
  { ingredient: "바클로펜", heatClass: "항불안제·근이완제", tier: "MID" },
  { ingredient: "슈도에페드린", heatClass: "교감신경흥분제", tier: "MID" },
  { ingredient: "살부타몰", heatClass: "교감신경흥분제", tier: "MID" },
] as const;

export const knownNonHeatRiskFixtures = [
  "아세트아미노펜",
  "메트포르민",
  "세티리진",
  "로라타딘",
  "펙소페나딘",
] as const;
