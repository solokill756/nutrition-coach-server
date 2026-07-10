import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../nutrition/entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";
import { NutritionCalculatorService } from "../nutrition/nutrition-calculator.service";
import { UserThresholdBuilderService } from "../nutrition/user-threshold-builder.service";
import { UserThresholdPersistenceService } from "../nutrition/user-threshold-persistence.service";
import { CompleteOnboardingDto } from "./dto/complete-onboarding.dto";
import { PreviewNutritionDto } from "./dto/preview-nutrition.dto";
import { UpdateBasicInfoDto } from "./dto/update-basic-info.dto";
import { UpdateGoalPreferencesDto } from "./dto/update-goal-preferences.dto";
import { UpdateHealthProfileDto } from "./dto/update-health-profile.dto";

@Injectable()
export class OnboardingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly nutritionCalculator: NutritionCalculatorService,
    private readonly thresholdBuilder: UserThresholdBuilderService,
    private readonly thresholdPersistence: UserThresholdPersistenceService,
    @InjectRepository(AppUserEntity)
    private readonly userRepo: Repository<AppUserEntity>,
    @InjectRepository(UserGoalEntity)
    private readonly goalRepo: Repository<UserGoalEntity>,
    @InjectRepository(UserHealthConditionEntity)
    private readonly healthRepo: Repository<UserHealthConditionEntity>,
    @InjectRepository(UserNutritionalThresholdEntity)
    private readonly thresholdRepo: Repository<UserNutritionalThresholdEntity>,
  ) {}

  previewNutrition(_userId: number, dto: PreviewNutritionDto) {
    const slug = this.nutritionCalculator.normalizeGoalType(dto.goalType);
    const plan = this.nutritionCalculator.computeNutritionPlan({
      gender: dto.gender.trim().toLowerCase(),
      age: Math.round(dto.age),
      heightCm: dto.heightCm,
      currentWeightKg: dto.currentWeightKg,
      activityLevel: dto.activityLevel.trim().toLowerCase(),
      goalType: slug,
    });
    return plan;
  }

  async getSnapshot(userId: number) {
    const user = await this.getUser(userId);
    const activeGoal = await this.goalRepo.findOne({
      where: { userId, isActive: true },
    });
    const activeHealth = await this.healthRepo.find({
      where: { userId, isActive: true },
    });
    const activeThresholds = await this.thresholdRepo.find({
      where: { userId, isActive: true },
    });
    const macros =
      activeGoal?.targetCalories != null
        ? this.nutritionCalculator.macroBreakdownFromThresholds(
            activeGoal.targetCalories,
            activeThresholds,
          )
        : null;

    const completedSteps = this.computeCompletedSteps(
      user,
      activeGoal,
      activeHealth.length > 0,
    );
    return {
      profileStatus: user.isProfileComplete ? "COMPLETE" : "INCOMPLETE",
      isProfileComplete: user.isProfileComplete,
      completedSteps,
      missingRequiredFields: this.getMissingFields(user, activeGoal),
      draftData: {
        displayName: user.displayName,
        gender: user.sex,
        age: user.age,
        heightCm: user.height,
        currentWeightKg: user.weight,
        goalWeightKg: user.goalWeight,
        activityLevel: user.fitnessLevel || null,
        goalType: activeGoal?.goalType || null,
        targetCalories: activeGoal?.targetCalories ?? null,
        carbsPercent: macros?.carbsPercent ?? null,
        proteinPercent: macros?.proteinPercent ?? null,
        fatPercent: macros?.fatPercent ?? null,
        conditionTypes: activeHealth.map((item) => item.conditionName),
        conditionSeverities: activeHealth.reduce<Record<string, string>>(
          (acc, item) => {
            if (item.severity?.trim()) {
              acc[item.conditionName] = item.severity.trim();
            }
            return acc;
          },
          {},
        ),
        barriers: user.allergies || [],
      },
    };
  }

  async updateBasicInfo(userId: number, dto: UpdateBasicInfoDto) {
    const user = await this.getUser(userId);
    user.sex = dto.gender.trim().toLowerCase();
    user.age = Math.round(dto.age);
    user.height = dto.heightCm;
    user.weight = dto.currentWeightKg;
    if (user.startWeight == null || user.startWeight <= 0) {
      user.startWeight = dto.currentWeightKg;
    }
    if (dto.displayName !== undefined && dto.displayName !== null) {
      const trimmed = dto.displayName.trim();
      if (trimmed.length > 0) {
        user.displayName = trimmed;
      }
    }
    if (
      dto.goalWeightKg !== undefined &&
      dto.goalWeightKg !== null &&
      Number.isFinite(dto.goalWeightKg)
    ) {
      user.goalWeight = dto.goalWeightKg;
    }
    user.updatedAt = new Date();
    await this.userRepo.save(user);
    return this.buildStepSaveResponse(userId);
  }

  async updateHealthProfile(userId: number, dto: UpdateHealthProfileDto) {
    await this.getUser(userId);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        UserHealthConditionEntity,
        { userId, isActive: true },
        { isActive: false, updatedAt: new Date() },
      );
      const normalizedConditions = dto.conditionTypes
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      if (normalizedConditions.length > 0) {
        const severities = dto.conditionSeverities ?? {};
        const newRows = normalizedConditions.map((conditionName) =>
          manager.getRepository(UserHealthConditionEntity).create({
            userId,
            conditionName,
            severity:
              typeof severities[conditionName] === "string" &&
              severities[conditionName].trim().length > 0
                ? severities[conditionName].trim()
                : undefined,
            isActive: true,
          }),
        );
        await manager.save(newRows);
      }
    });

    return this.buildStepSaveResponse(userId);
  }

  async updateGoalPreferences(userId: number, dto: UpdateGoalPreferencesDto) {
    const user = await this.getUser(userId);
    const slug = this.nutritionCalculator.normalizeGoalType(dto.goalType);
    user.fitnessLevel = dto.activityLevel.trim().toLowerCase();
    if (dto.barriers) {
      user.allergies = dto.barriers
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    }
    if (dto.mealFrequency?.trim()) {
      user.dietType = dto.mealFrequency.trim();
    }
    user.updatedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      await manager.save(user);
      await manager.update(
        UserGoalEntity,
        { userId, isActive: true },
        { isActive: false, updatedAt: new Date() },
      );
      await manager.update(
        UserNutritionalThresholdEntity,
        { userId, isActive: true },
        { isActive: false, updatedAt: new Date() },
      );
      await manager.save(
        manager.create(UserGoalEntity, {
          userId,
          goalType: slug,
          targetCalories: null,
          startDate: new Date(),
          endDate: null,
          isActive: true,
        }),
      );
    });

    return this.buildStepSaveResponse(userId);
  }

  async complete(userId: number, _dto: CompleteOnboardingDto) {
    const snapshot = await this.getSnapshot(userId);
    if (snapshot.isProfileComplete) {
      const thresholds = await this.thresholdRepo.find({
        where: { userId, isActive: true },
      });
      const plan = this.nutritionCalculator.computeNutritionPlan({
        gender: snapshot.draftData.gender,
        age: snapshot.draftData.age,
        heightCm: snapshot.draftData.heightCm,
        currentWeightKg: snapshot.draftData.currentWeightKg,
        activityLevel: snapshot.draftData.activityLevel,
        goalType: snapshot.draftData.goalType,
      });
      return {
        completed: true,
        isProfileComplete: true,
        bmr: plan.bmr,
        tdee: plan.tdee,
        goalSummary: {
          goalType: snapshot.draftData.goalType,
          thresholds: thresholds.map((item) => ({
            nutrient: item.nutrient,
            minAmount: item.minAmount,
            maxAmount: item.maxAmount,
            unit: item.unit,
          })),
        },
      };
    }

    if (snapshot.missingRequiredFields.length > 0) {
      throw new UnprocessableEntityException({
        errorKey: "onboarding.errors.missingRequiredFields",
        message: "Missing required onboarding fields",
        details: { missingRequiredFields: snapshot.missingRequiredFields },
      });
    }

    const plan = this.nutritionCalculator.computeNutritionPlan({
      gender: snapshot.draftData.gender,
      age: snapshot.draftData.age,
      heightCm: snapshot.draftData.heightCm,
      currentWeightKg: snapshot.draftData.currentWeightKg,
      activityLevel: snapshot.draftData.activityLevel,
      goalType: snapshot.draftData.goalType,
    });
    const { bmr, tdee, targetCalories: adjustedCalories } = plan;

    await this.dataSource.transaction(async (manager) => {
      const { thresholds: thresholdRows } = await this.thresholdBuilder.build({
        userId,
        targetCalories: adjustedCalories,
        macroCenter: {
          proteinG: plan.proteinG,
          carbsG: plan.carbsG,
          fatG: plan.fatG,
          proteinPercent: plan.proteinPercent,
          carbsPercent: plan.carbsPercent,
          fatPercent: plan.fatPercent,
        },
        conditionTypes: snapshot.draftData.conditionTypes || [],
        gender: snapshot.draftData.gender,
        allowAutoRebalance: true,
        bodyWeightKg: snapshot.draftData.currentWeightKg ?? undefined,
      });
      await this.thresholdPersistence.replaceUserThresholds(manager, userId, thresholdRows);

      await manager.update(
        UserGoalEntity,
        { userId, isActive: true },
        { targetCalories: adjustedCalories, updatedAt: new Date() },
      );

      await manager.update(
        AppUserEntity,
        { id: userId },
        { isProfileComplete: true, updatedAt: new Date() },
      );
    });

    return {
      completed: true,
      isProfileComplete: true,
      bmr,
      tdee,
      goalSummary: {
        goalType: snapshot.draftData.goalType,
        targetCalories: adjustedCalories,
      },
    };
  }

  private async buildStepSaveResponse(userId: number) {
    const snapshot = await this.getSnapshot(userId);
    return {
      saved: true,
      profileStatus: snapshot.profileStatus,
      completedSteps: snapshot.completedSteps,
      missingRequiredFields: snapshot.missingRequiredFields,
    };
  }

  private computeCompletedSteps(
    user: AppUserEntity,
    activeGoal: UserGoalEntity | null,
    hasHealthData: boolean,
  ): number[] {
    const completed: number[] = [];
    if (user.sex && user.age && user.height && user.weight) completed.push(1);
    if (hasHealthData) completed.push(2);
    if (activeGoal && user.fitnessLevel) completed.push(3);
    if (user.isProfileComplete) completed.push(4);
    return completed;
  }

  private getMissingFields(
    user: AppUserEntity,
    activeGoal: UserGoalEntity | null,
  ): string[] {
    const missing: string[] = [];
    if (!user.sex) missing.push("gender");
    if (!user.age) missing.push("age");
    if (!user.height) missing.push("heightCm");
    if (!user.weight) missing.push("currentWeightKg");
    if (!user.fitnessLevel) missing.push("activityLevel");
    if (!activeGoal?.goalType) missing.push("goalType");
    return missing;
  }

  private async loadActiveConditionTypes(userId: number): Promise<string[]> {
    const rows = await this.healthRepo.find({
      where: { userId, isActive: true },
    });
    return rows.map((row) => row.conditionName);
  }

  private async getUser(userId: number): Promise<AppUserEntity> {
    const user = await this.userRepo.findOne({
      where: { id: userId, delFlag: false },
    });
    if (!user) {
      throw new NotFoundException({
        errorKey: "onboarding.errors.userNotFound",
        message: "User not found",
      });
    }
    return user;
  }
}
