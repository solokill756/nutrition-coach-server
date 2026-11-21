import { BadRequestException, Injectable, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../nutrition/entities/user-health-condition.entity";
import { validateMealSplits } from "../nutrition/meal-splits";
import { NutritionCalculatorService } from "../nutrition/nutrition-calculator.service";
import { UserThresholdBuilderService } from "../nutrition/user-threshold-builder.service";
import { UserThresholdPersistenceService } from "../nutrition/user-threshold-persistence.service";
import { WeightEntity } from "../weight/entities/weight.entity";
import { UpdateUserHealthProfileDto } from "./dto/update-health-profile.dto";

function conditionKey(value: string): string {
  return value.trim().toLowerCase();
}

function distinctLabels(values: string[]): Map<string, string> {
  return new Map(values.map((value) => [conditionKey(value), value.trim()]));
}

@Injectable()
export class UserHealthProfileService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly calculator: NutritionCalculatorService,
    private readonly thresholdBuilder: UserThresholdBuilderService,
    private readonly thresholdPersistence: UserThresholdPersistenceService,
  ) {}

  async update(userId: number, dto: UpdateUserHealthProfileDto): Promise<void> {
    const mealSplits = dto.mealSplits == null ? dto.mealSplits : validateMealSplits(dto.mealSplits);
    if (dto.mealSplits != null && mealSplits === null) {
      throw new BadRequestException({
        errorKey: "users.errors.invalidMealSplits",
        message: "Meal split must contain four whole percentages totaling 100%.",
      });
    }

    await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(AppUserEntity, {
        where: { id: userId, delFlag: false },
        lock: { mode: "pessimistic_write" },
      });
      if (!user) throw new UnauthorizedException("User not found");
      if (!user.isProfileComplete) {
        throw new UnprocessableEntityException({
          errorKey: "auth.errors.profileIncomplete",
          message: "Complete onboarding before editing your health profile.",
        });
      }

      const changes: Partial<AppUserEntity> = {};
      if (dto.age !== undefined && dto.age !== user.age) changes.age = dto.age;
      if (dto.gender !== undefined && conditionKey(dto.gender) !== user.sex) changes.sex = conditionKey(dto.gender);
      if (dto.heightCm !== undefined && dto.heightCm !== user.height) changes.height = dto.heightCm;
      const measurementsChanged = Object.keys(changes).length > 0;
      if (dto.allergies !== undefined) changes.allergies = [...distinctLabels(dto.allergies).values()];
      if (mealSplits !== undefined) changes.mealSplits = mealSplits;

      if (measurementsChanged || dto.conditionTypes !== undefined) {
        const active = await manager.find(UserHealthConditionEntity, { where: { userId, isActive: true } });
        const before = new Set(active.map((row) => conditionKey(row.conditionName)));
        const after = dto.conditionTypes === undefined
          ? before
          : new Set(dto.conditionTypes.map(conditionKey));
        const conditionsChanged = before.size !== after.size || [...before].some((key) => !after.has(key));

        if (conditionsChanged) {
          const removals = active.filter((row) => !after.has(conditionKey(row.conditionName)));
          const now = new Date();
          for (const row of removals) {
            row.isActive = false;
            row.updatedAt = now;
          }
          const additions = [...after]
            .filter((key) => !before.has(key))
            .map((key) => manager.create(UserHealthConditionEntity, { userId, conditionName: key, isActive: true }));
          await manager.save(UserHealthConditionEntity, [...removals, ...additions]);
        }

        if (measurementsChanged || conditionsChanged) {
          await this.rebuildThresholds(manager, userId, user, changes, [...after], measurementsChanged);
        }
      }

      if (Object.keys(changes).length > 0) {
        await manager.update(AppUserEntity, userId, { ...changes, updatedAt: new Date() });
      }
    });
  }

  private async rebuildThresholds(
    manager: EntityManager,
    userId: number,
    user: AppUserEntity,
    changes: Partial<AppUserEntity>,
    conditionTypes: string[],
    measurementsChanged: boolean,
  ): Promise<void> {
    const goal = await manager.findOne(UserGoalEntity, {
      where: { userId, isActive: true },
      order: { startDate: "DESC", id: "DESC" },
    });
    const latestWeight = await manager.findOne(WeightEntity, {
      where: { userId, delFlag: false },
      order: { recordedOn: "DESC", recordedAt: "DESC" },
      select: { weightKg: true },
    });
    const weight = Number(latestWeight?.weightKg);
    const oldInput = {
      age: user.age,
      gender: user.sex,
      heightCm: user.height,
      currentWeightKg: weight > 0 ? weight : user.weight,
      activityLevel: user.fitnessLevel,
      goalType: goal?.goalType ?? "maintenance",
    };
    const oldPlan = this.calculator.computeNutritionPlan(oldInput);
    const plan = measurementsChanged ? this.calculator.computeNutritionPlan({
      ...oldInput,
      age: changes.age ?? oldInput.age,
      gender: changes.sex ?? oldInput.gender,
      heightCm: changes.height ?? oldInput.heightCm,
    }) : oldPlan;

    // Existing goal rows do not mark manual calories. A different stored target
    // is treated as a manual target and survives subsequent profile edits.
    const storedCalories = Number(goal?.targetCalories);
    const targetCalories = storedCalories > 0 && storedCalories !== oldPlan.targetCalories
      ? storedCalories : plan.targetCalories;
    const scale = (grams: number) => Math.round(grams * targetCalories / plan.targetCalories * 10) / 10;
    const { thresholds } = await this.thresholdBuilder.build({
      userId,
      targetCalories,
      macroCenter: {
        proteinG: scale(plan.proteinG),
        carbsG: scale(plan.carbsG),
        fatG: scale(plan.fatG),
        proteinPercent: plan.proteinPercent,
        carbsPercent: plan.carbsPercent,
        fatPercent: plan.fatPercent,
      },
      conditionTypes,
      gender: changes.sex ?? oldInput.gender,
      allowAutoRebalance: true,
      bodyWeightKg: oldInput.currentWeightKg ?? undefined,
    }, manager);
    await this.thresholdPersistence.replaceUserThresholds(manager, userId, thresholds, { preserveCustom: true });

    if (!goal) {
      await manager.save(UserGoalEntity, manager.create(UserGoalEntity, {
        userId, goalType: oldInput.goalType, targetCalories, startDate: new Date(), isActive: true,
      }));
    } else if (goal.targetCalories !== targetCalories) {
      await manager.update(UserGoalEntity, goal.id, { targetCalories, updatedAt: new Date() });
    }
  }
}
