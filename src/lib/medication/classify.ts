import type { MedRiskTier } from "@/lib/domain-types";

export const HEAT_MEDICATION_CLASSES = [
  "이뇨제",
  "항콜린제",
  "항정신병제",
  "항우울제",
  "1세대 항히스타민제",
  "혈압강하제",
  "칼슘채널길항제",
  "질산염·혈관확장제",
  "리튬",
  "항간질제",
  "항치매제",
  "항불안제·근이완제",
  "교감신경흥분제",
] as const;

export type HeatMedicationClass = (typeof HEAT_MEDICATION_CLASSES)[number];

interface IngredientClassDefinition {
  heatClass: HeatMedicationClass;
  tier: Exclude<MedRiskTier, "NONE">;
  ingredients: ReadonlyArray<{ canonical: string; aliases: readonly string[] }>;
}

const CLASS_DEFINITIONS: readonly IngredientClassDefinition[] = [
  {
    heatClass: "이뇨제",
    tier: "HIGH",
    ingredients: [
      { canonical: "푸로세미드", aliases: ["푸로세미드", "푸르세미드", "furosemide"] },
      {
        canonical: "하이드로클로로티아지드",
        aliases: ["하이드로클로로티아지드", "hydrochlorothiazide", "hctz"],
      },
      { canonical: "스피로노락톤", aliases: ["스피로노락톤", "spironolactone"] },
    ],
  },
  {
    heatClass: "항콜린제",
    tier: "HIGH",
    ingredients: [
      { canonical: "옥시부티닌", aliases: ["옥시부티닌", "oxybutynin"] },
      { canonical: "스코폴라민", aliases: ["스코폴라민", "scopolamine", "hyoscine"] },
      {
        canonical: "글리코피롤레이트",
        aliases: ["글리코피롤레이트", "글리코피로늄", "glycopyrrolate", "glycopyrronium"],
      },
    ],
  },
  {
    heatClass: "항정신병제",
    tier: "HIGH",
    ingredients: [
      { canonical: "할로페리돌", aliases: ["할로페리돌", "haloperidol"] },
      { canonical: "리스페리돈", aliases: ["리스페리돈", "risperidone"] },
      { canonical: "올란자핀", aliases: ["올란자핀", "olanzapine"] },
    ],
  },
  {
    heatClass: "항우울제",
    tier: "HIGH",
    ingredients: [
      { canonical: "아미트립틸린", aliases: ["아미트립틸린", "amitriptyline"] },
      { canonical: "플루옥세틴", aliases: ["플루옥세틴", "fluoxetine"] },
      { canonical: "파록세틴", aliases: ["파록세틴", "paroxetine"] },
    ],
  },
  {
    heatClass: "1세대 항히스타민제",
    tier: "HIGH",
    ingredients: [
      {
        canonical: "클로르페니라민",
        aliases: ["클로르페니라민", "chlorpheniramine", "chlorphenamine"],
      },
      { canonical: "디펜히드라민", aliases: ["디펜히드라민", "diphenhydramine"] },
      { canonical: "하이드록시진", aliases: ["하이드록시진", "hydroxyzine"] },
    ],
  },
  {
    heatClass: "혈압강하제",
    tier: "MID",
    ingredients: [
      { canonical: "에날라프릴", aliases: ["에날라프릴", "enalapril"] },
      { canonical: "로사르탄", aliases: ["로사르탄", "losartan"] },
      { canonical: "아테놀올", aliases: ["아테놀올", "atenolol"] },
    ],
  },
  {
    heatClass: "칼슘채널길항제",
    tier: "MID",
    ingredients: [
      { canonical: "암로디핀", aliases: ["암로디핀", "amlodipine"] },
      { canonical: "니페디핀", aliases: ["니페디핀", "nifedipine"] },
      { canonical: "딜티아젬", aliases: ["딜티아젬", "diltiazem"] },
    ],
  },
  {
    heatClass: "질산염·혈관확장제",
    tier: "MID",
    ingredients: [
      {
        canonical: "니트로글리세린",
        aliases: ["니트로글리세린", "nitroglycerin", "glyceryltrinitrate"],
      },
      {
        canonical: "이소소르비드",
        aliases: ["이소소르비드", "isosorbide", "isosorbidemononitrate", "isosorbidedinitrate"],
      },
    ],
  },
  {
    heatClass: "리튬",
    tier: "MID",
    ingredients: [{ canonical: "탄산리튬", aliases: ["탄산리튬", "lithiumcarbonate"] }],
  },
  {
    heatClass: "항간질제",
    tier: "MID",
    ingredients: [
      { canonical: "카바마제핀", aliases: ["카바마제핀", "carbamazepine"] },
      { canonical: "발프로산", aliases: ["발프로산", "발프로에이트", "valproicacid", "valproate"] },
      { canonical: "토피라메이트", aliases: ["토피라메이트", "topiramate"] },
    ],
  },
  {
    heatClass: "항치매제",
    tier: "MID",
    ingredients: [
      { canonical: "도네페질", aliases: ["도네페질", "donepezil"] },
      { canonical: "리바스티그민", aliases: ["리바스티그민", "rivastigmine"] },
      { canonical: "메만틴", aliases: ["메만틴", "memantine"] },
    ],
  },
  {
    heatClass: "항불안제·근이완제",
    tier: "MID",
    ingredients: [
      { canonical: "디아제팜", aliases: ["디아제팜", "diazepam"] },
      { canonical: "로라제팜", aliases: ["로라제팜", "lorazepam"] },
      { canonical: "바클로펜", aliases: ["바클로펜", "baclofen"] },
    ],
  },
  {
    heatClass: "교감신경흥분제",
    tier: "MID",
    ingredients: [
      { canonical: "슈도에페드린", aliases: ["슈도에페드린", "pseudoephedrine"] },
      { canonical: "살부타몰", aliases: ["살부타몰", "알부테롤", "salbutamol", "albuterol"] },
    ],
  },
] as const;

const KNOWN_NONE: ReadonlyArray<{ canonical: string; aliases: readonly string[] }> = [
  { canonical: "아세트아미노펜", aliases: ["아세트아미노펜", "acetaminophen", "paracetamol"] },
  { canonical: "메트포르민", aliases: ["메트포르민", "metformin"] },
  { canonical: "세티리진", aliases: ["세티리진", "cetirizine"] },
  { canonical: "로라타딘", aliases: ["로라타딘", "loratadine"] },
  { canonical: "펙소페나딘", aliases: ["펙소페나딘", "fexofenadine"] },
] as const;

export function normalizeIngredientName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function compactIngredient(value: string): string {
  return normalizeIngredientName(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function containsAlias(ingredient: string, aliases: readonly string[]): boolean {
  const compact = compactIngredient(ingredient);
  return aliases.some((alias) => compact.includes(compactIngredient(alias)));
}

export interface HeatMedicationMatch {
  heatClass: HeatMedicationClass;
  tier: Exclude<MedRiskTier, "NONE">;
  canonicalIngredient: string;
  normalizedIngredient: string;
  sourceIngredients: string[];
}

export interface MedicationClassification {
  tier: MedRiskTier;
  matches: HeatMedicationMatch[];
  knownNoneIngredients: string[];
  basis: "INGREDIENT_ALIAS" | "NO_INGREDIENT_MATCH";
}

export function classifyMedication(input: {
  ingredientNames: readonly string[];
  productName?: string;
}): MedicationClassification {
  const matchesByClass = new Map<HeatMedicationClass, HeatMedicationMatch>();
  const knownNoneIngredients: string[] = [];

  for (const rawIngredient of input.ingredientNames) {
    const ingredient = rawIngredient.trim();
    if (!ingredient) continue;

    let matched = false;
    for (const definition of CLASS_DEFINITIONS) {
      for (const candidate of definition.ingredients) {
        if (!containsAlias(ingredient, candidate.aliases)) continue;
        matched = true;
        const existing = matchesByClass.get(definition.heatClass);
        if (existing) {
          if (!existing.sourceIngredients.includes(ingredient)) {
            existing.sourceIngredients.push(ingredient);
          }
        } else {
          matchesByClass.set(definition.heatClass, {
            heatClass: definition.heatClass,
            tier: definition.tier,
            canonicalIngredient: candidate.canonical,
            normalizedIngredient: normalizeIngredientName(ingredient),
            sourceIngredients: [ingredient],
          });
        }
        break;
      }
      if (matched) break;
    }

    if (!matched && KNOWN_NONE.some((candidate) => containsAlias(ingredient, candidate.aliases))) {
      knownNoneIngredients.push(ingredient);
    }
  }

  const matches = [...matchesByClass.values()];
  const tier: MedRiskTier = matches.some((match) => match.tier === "HIGH")
    ? "HIGH"
    : matches.length > 0
      ? "MID"
      : "NONE";

  return {
    tier,
    matches,
    knownNoneIngredients,
    basis: matches.length > 0 ? "INGREDIENT_ALIAS" : "NO_INGREDIENT_MATCH",
  };
}
