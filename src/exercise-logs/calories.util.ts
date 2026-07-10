/**
 * Calories burned = MET × WeightKg × (minutes / 60), or DefaultCalPerMin × minutes.
 * Rounded to 2 decimal places. Throws if insufficient data.
 */
export function calculateCaloriesBurned(params: {
  met: number | null | undefined;
  defaultCalPerMin: number | null | undefined;
  weightKg: number | null | undefined;
  minutesPerformed: number;
}): number {
  const { met, defaultCalPerMin, weightKg, minutesPerformed } = params;
  const m = Number(minutesPerformed);
  if (!Number.isFinite(m) || m <= 0) {
    throw new Error("Invalid minutesPerformed");
  }

  const metN = met == null ? NaN : Number(met);
  const w = weightKg == null ? NaN : Number(weightKg);
  if (Number.isFinite(metN) && metN > 0 && Number.isFinite(w) && w > 0) {
    const hours = m / 60;
    return round2(metN * w * hours);
  }

  const dcpm = defaultCalPerMin == null ? NaN : Number(defaultCalPerMin);
  if (Number.isFinite(dcpm) && dcpm > 0) {
    return round2(dcpm * m);
  }

  throw new Error(
    "Cannot calculate calories burned: need (MET and weight) or DefaultCalPerMin on exercise, and user weight for MET path.",
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
