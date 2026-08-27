import { describe, expect, it } from "vitest";
import { classifyMedication, normalizeIngredientName } from "./classify";
import {
  appendixBRepresentativeFixtures,
  knownNonHeatRiskFixtures,
} from "./fixtures/classification-fixtures";

describe("heat-risk medication classification", () => {
  it.each(appendixBRepresentativeFixtures)(
    "maps appendix B ingredient $ingredient to $heatClass/$tier",
    ({ ingredient, heatClass, tier }) => {
      const result = classifyMedication({ ingredientNames: [ingredient] });

      expect(result.tier).toBe(tier);
      expect(result.matches).toEqual([
        expect.objectContaining({
          heatClass,
          normalizedIngredient: normalizeIngredientName(ingredient),
        }),
      ]);
    },
  );

  it.each(knownNonHeatRiskFixtures)("keeps non-mapped ingredient %s at NONE", (ingredient) => {
    expect(classifyMedication({ ingredientNames: [ingredient] })).toMatchObject({
      tier: "NONE",
      matches: [],
    });
  });

  it("distinguishes first-generation and second-generation antihistamines", () => {
    expect(classifyMedication({ ingredientNames: ["클로르페니라민말레산염"] }).tier).toBe("HIGH");
    expect(classifyMedication({ ingredientNames: ["세티리진염산염"] })).toMatchObject({
      tier: "NONE",
      knownNoneIngredients: ["세티리진염산염"],
    });
  });

  it("normalizes English synonyms and salt/dose descriptions", () => {
    const result = classifyMedication({
      ingredientNames: ["Furosemide 40 mg", "Losartan Potassium 50mg"],
    });

    expect(result.tier).toBe("HIGH");
    expect(result.matches.map((match) => match.heatClass)).toEqual(["이뇨제", "혈압강하제"]);
  });

  it("does not confirm a class from a product-name homonym", () => {
    expect(classifyMedication({ productName: "리튬 플러스정", ingredientNames: [] })).toMatchObject(
      { tier: "NONE", matches: [], basis: "NO_INGREDIENT_MATCH" },
    );
  });

  it("deduplicates repeated ingredients within the same heat class", () => {
    const result = classifyMedication({ ingredientNames: ["푸로세미드", "스피로노락톤"] });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.heatClass).toBe("이뇨제");
  });
});
