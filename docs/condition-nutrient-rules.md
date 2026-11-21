# Condition nutrient defaults

The defaults are nutrition reference targets for deployments serving adults. The app applies a rule by condition key and has no age, disease-stage, medication or pregnancy criteria. Review applicability before seeding a deployment that serves other populations or uses different clinical guidance.

| Taxonomy key | Default | Basis and scope |
| --- | --- | --- |
| `diabetes` | Fiber ≥ 14 g per 1,000 kcal. Sodium cap 2,300 mg/day. | ADA recommendations 5.20 and 5.24. Sodium is subject to clinical appropriateness. ADA recommends minimizing added sugar and individualizing carbohydrate intake. The app tracks total sugars, so this seed adds no sugar or carbohydrate rule. [ADA Standards of Care 2026, section 5](https://diabetesjournals.org/care/article-pdf/49/Supplement_1/S89/848861/dc26s005.pdf) |
| `hypertension` | Sodium cap 1,500 mg/day. | The AHA identifies 1,500 mg/day as an optimal goal for most adults. [AHA sodium guidance](https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/sodium/how-much-sodium-should-i-eat-per-day) |
| `heart_disease` | Saturated fat cap 6% of daily energy. | The AHA recommends this target as part of a heart-healthy eating pattern. ACC/AHA guidance also uses it for chronic coronary disease. [AHA saturated fat guidance](https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/fats/saturated-fats) · [ACC/AHA chronic coronary disease guideline](https://professional.heart.org/-/media/PHD-Files-2/Science-News/2/2023/2023_chronic_coronary_disease_guideline_slide_set.pdf) |
| `high_cholesterol` | Saturated fat cap 6% of daily energy. | The AHA recommends limiting saturated fat to help lower LDL cholesterol. [AHA saturated fat guidance](https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/fats/saturated-fats) |
| `kidney_disease` | Individual targets. | KDIGO recommends adapting sodium, protein, potassium and phosphorus to CKD stage and clinical context. Its sodium recommendation has an exception for sodium-wasting nephropathy. The taxonomy key also covers kidney disease more broadly than CKD. [KDIGO 2024 CKD guideline, section 3.3](https://kdigo.org/wp-content/uploads/2017/02/KDIGO-2024-CKD-Guideline-Executive-Summary.pdf) |
| `thyroid` | Individual targets. | A low-iodine diet is used around radioactive iodine treatment in selected patients with thyroid cancer. The taxonomy key also covers other thyroid disorders. [American Thyroid Association](https://www.thyroid.org/low-iodine-diet/) |

The database stores inclusive bounds. For guidance phrased as “less than,” the app records the cited cutoff as its alert boundary. Onboarding converts the fiber density and saturated fat percentage to daily grams using the user's calorie target.

## Load the defaults

Run after the application's `ConditionNutrientRule` table exists. Update the running backend to a build that supports `g/1000kcal` before loading these defaults.

```bash
npm run build
npm run db:seed-condition-nutrient-rules
```

The seed uses the backend's PostgreSQL connection variables and the connection's default search path. It inserts missing condition and nutrient pairs in one transaction, preserving existing values and inactive rules. Running it again skips existing pairs. Seeded rules apply when onboarding builds a new user's thresholds. The seed leaves existing user thresholds untouched.

Use the admin API to manage deployment-specific rules. Preview with `POST /admin/condition-nutrient-rules/preview` before applying changes with `PATCH /admin/condition-nutrient-rules/{conditionKey}`, which can recalculate existing users' thresholds. Reserve global rules for guidance that applies across the condition key's population.

## Check diabetes onboarding

1. Use a new adult test account. Set `conditionTypes` to `["diabetes"]` via `PATCH /onboarding/health-profile`, then finish onboarding via `POST /onboarding/complete`.
2. Check the user's active `UserNutritionalThreshold` rows for `fiber` and `sodium`. Both should have `Origin = 'admin_rule'` and `SourceConditionKey = 'diabetes'`. For a 2,000 kcal target, the fiber minimum is 28 g/day.
3. Build a Dashboard AI suggestion. The current shared prompt exposes the applied values under `nutrientLimits` and sends the condition-specific limits to RAG as `conditionRelatedThresholds`.
