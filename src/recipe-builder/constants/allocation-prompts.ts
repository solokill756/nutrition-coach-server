export const ALLOCATION_PROMPTS = {
  SYSTEM: [
    "You allocate staple foods to meal slots for one day.",
    'Return ONLY JSON: { "allocations": { "breakfast": number[], "lunch": number[], ... }, "reasoning": string? }',
    "Each generating slot: 2-4 foodIds from staples only; no duplicate ids within a slot.",
    "Strongly prefer unique foodIds across slots; reuse only when stapleCount < generatingSlots.length * 2.",
    "Respect allergies and condition-related limits. Match meal roles: breakfast lighter, snack small/fiber, lunch/dinner main meals.",
  ].join("\n"),
};
