import {
  RAG_DOMAINS,
  RAG_TAXONOMY,
  RagTagGroup,
  allergyLabelToKey,
  emptyTags,
  isRagDomain,
  sanitizeTags,
} from "./rag-taxonomy";

describe("rag-taxonomy", () => {
  it("has the exact keys from the onboarding lists", () => {
    expect(RAG_TAXONOMY.conditions.map((t) => t.key)).toEqual([
      "hypertension",
      "diabetes",
      "heart_disease",
      "kidney_disease",
      "thyroid",
      "high_cholesterol",
    ]);
    expect(RAG_TAXONOMY.goals.map((t) => t.key)).toEqual([
      "weight_loss",
      "maintenance",
      "weight_gain",
      "muscle_gain",
      "modify_diet",
      "plan_meals",
      "manage_stress",
      "stay_active",
    ]);
    expect(RAG_TAXONOMY.allergens.map((t) => t.key)).toEqual([
      "peanuts",
      "tree_nuts",
      "milk_lactose",
      "eggs",
      "fish",
      "shellfish",
      "soy",
      "wheat_gluten",
      "sesame",
    ]);
    expect(RAG_TAXONOMY.nutrients.map((t) => t.key)).toEqual(
      expect.arrayContaining(["sodium", "sugar", "fiber", "saturated_fat", "cholesterol", "potassium", "protein", "carbs", "calories"]),
    );
    expect(RAG_DOMAINS.map((d) => d.key)).toEqual(["guidelines", "conditions", "safety"]);
  });

  it("every item has labelEn, labelVi and an English description", () => {
    const items = [...RAG_DOMAINS, ...Object.values(RAG_TAXONOMY).flat()];
    for (const item of items) {
      expect(item.key).toBeTruthy();
      expect(item.labelEn.trim()).not.toBe("");
      expect(item.labelVi.trim()).not.toBe("");
      expect(item.description.trim()).not.toBe("");
    }
    for (const group of Object.keys(RAG_TAXONOMY) as RagTagGroup[]) {
      const keys = RAG_TAXONOMY[group].map((t) => t.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("emptyTags returns four empty groups", () => {
    expect(emptyTags()).toEqual({ conditions: [], allergens: [], goals: [], nutrients: [] });
  });

  it("sanitizeTags drops unknown values and duplicates", () => {
    expect(sanitizeTags({ conditions: ["diabetes", "tiểu đường", "diabetes"], allergens: ["shellfish"], goals: "x" })).toEqual({
      tags: { conditions: ["diabetes"], allergens: ["shellfish"], goals: [], nutrients: [] },
      invalid: ["conditions:tiểu đường"],
    });
  });

  it("sanitizeTags keeps taxonomy order and tolerates non-objects", () => {
    expect(sanitizeTags({ conditions: ["thyroid", "hypertension"] }).tags.conditions).toEqual(["hypertension", "thyroid"]);
    expect(sanitizeTags(null)).toEqual({ tags: emptyTags(), invalid: [] });
    expect(sanitizeTags("x")).toEqual({ tags: emptyTags(), invalid: [] });
  });

  it("isRagDomain checks the domain keys", () => {
    expect(isRagDomain("safety")).toBe(true);
    expect(isRagDomain("other")).toBe(false);
    expect(isRagDomain(1)).toBe(false);
  });

  it("maps onboarding allergy labels to keys", () => {
    expect(allergyLabelToKey("Wheat or gluten")).toBe("wheat_gluten");
    expect(allergyLabelToKey("milk or lactose")).toBe("milk_lactose");
    expect(allergyLabelToKey("Durian")).toBeNull();
  });
});
