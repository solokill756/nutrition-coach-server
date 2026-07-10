import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";
import { WeightService } from "../../weight/weight.service";

export type HydrationTargetProfile = {
  weightKg?: number | null;
  sex?: string | null;
  fitnessLevel?: string | null;
};

const ML_PER_KG = 35;
const MIN_TARGET_ML = 1500;
const MAX_TARGET_ML = 5000;
const ROUND_TO_ML = 50;

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1,
  beginner: 1.05,
  light: 1.05,
  moderate: 1.1,
  intermediate: 1.1,
  active: 1.15,
  advanced: 1.15,
  very_active: 1.2,
};

export function calculateDailyWaterTargetMl(profile: HydrationTargetProfile): number {
  const weight = Number(profile.weightKg);
  if (!Number.isFinite(weight) || weight <= 0) {
    return fallbackTargetMl(profile.sex);
  }

  const activityKey = (profile.fitnessLevel ?? "").trim().toLowerCase();
  const multiplier = ACTIVITY_MULTIPLIERS[activityKey] ?? 1;
  const rounded = Math.round((weight * ML_PER_KG * multiplier) / ROUND_TO_ML) * ROUND_TO_ML;
  return Math.min(MAX_TARGET_ML, Math.max(MIN_TARGET_ML, rounded));
}

function fallbackTargetMl(sex?: string | null): number {
  const normalized = (sex ?? "").trim().toLowerCase();
  if (["male", "m", "man", "nam"].includes(normalized)) {
    return 3000;
  }
  if (["female", "f", "woman", "nu", "nữ"].includes(normalized)) {
    return 2200;
  }
  return 2500;
}

@Injectable()
export class HydrationTargetService {
  constructor(
    @InjectRepository(AppUserEntity)
    private readonly userRepo: Repository<AppUserEntity>,
    private readonly weightService: WeightService,
  ) {}

  calculateForProfile(profile: HydrationTargetProfile): number {
    return calculateDailyWaterTargetMl(profile);
  }

  async getTargetMlForUser(userId: number): Promise<number> {
    const [user, latestWeightRows] = await Promise.all([
      this.userRepo.findOne({
        where: { id: userId, delFlag: false },
        select: ["id", "sex", "weight", "fitnessLevel"],
      }),
      this.weightService.historyDescending(userId, 1),
    ]);
    const latestWeightKg = latestWeightRows.length > 0 ? Number(latestWeightRows[0].weightKg) : null;
    return this.calculateForProfile({
      weightKg: Number.isFinite(latestWeightKg) && latestWeightKg != null
        ? latestWeightKg
        : user?.weight ?? null,
      sex: user?.sex ?? null,
      fitnessLevel: user?.fitnessLevel ?? null,
    });
  }
}
