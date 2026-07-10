import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppUserEntity } from './auth/entities/app-user.entity';
import { UserGoalEntity } from './nutrition/entities/user-goal.entity';
import { UserHealthConditionEntity } from './nutrition/entities/user-health-condition.entity';
import { UserNutritionalThresholdEntity } from './nutrition/entities/user-nutritional-threshold.entity';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

async function seed() {
  console.log("[SEED] 🌱 Seeding Core User Profile Data...");

  const dataSource = new DataSource({
    type: "postgres",
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    username: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "postgres",
    database: process.env.POSTGRES_DB || "calories_counter",
    entities: [
      AppUserEntity,
      UserGoalEntity,
      UserHealthConditionEntity,
      UserNutritionalThresholdEntity
    ],
    synchronize: true,
  });

  try {
    await dataSource.initialize();
    console.log("[SEED] ✅ Database connection initialized");

    const userRepo = dataSource.getRepository(AppUserEntity);
    const goalRepo = dataSource.getRepository(UserGoalEntity);
    const conditionRepo = dataSource.getRepository(UserHealthConditionEntity);
    const thresholdRepo = dataSource.getRepository(UserNutritionalThresholdEntity);

    // 1. Create Test User
    let testUser = await userRepo.findOne({ where: { email: 'testuser@example.com' } });
    if (!testUser) {
      const passwordHash = await bcrypt.hash('password123', 10);
      testUser = userRepo.create({
        email: 'testuser@example.com',
        passwordHash: passwordHash,
        displayName: 'Test User Coach',
        age: 30,
        sex: 'male',
        weight: 85,
        height: 175,
        dietType: 'low-carb',
        fitnessLevel: 'beginner',
        isProfileComplete: true
      });
      testUser = await userRepo.save(testUser);
      console.log("[SEED] ✅ User created: testuser@example.com / password123");
    }

    const userId = Number(testUser.id);

    // 2. Clean up & Create Goals
    await goalRepo.delete({ userId: userId });
    await goalRepo.save([
      { userId: userId, goalType: 'Weight Loss', targetCalories: 1800, startDate: new Date(), isActive: true }
    ]);
    console.log("[SEED] ✅ Goal created: Weight Loss (1800 kcal)");

    // 3. Clean up & Create Health Conditions
    await conditionRepo.delete({ userId: userId });
    await conditionRepo.save([
      { userId: userId, conditionName: 'Diabetes', isActive: true },
      { userId: userId, conditionName: 'Hypertension', isActive: true }
    ]);
    console.log("[SEED] ✅ Health conditions created: Diabetes, Hypertension");

    // 4. Clean up & Create Nutritional Thresholds
    await thresholdRepo.delete({ userId: userId });
    await thresholdRepo.save([
      { userId: userId, nutrient: 'Sodium', maxAmount: 1500, minAmount: 500, unit: 'mg', isActive: true },
      { userId: userId, nutrient: 'Carbs', maxAmount: 150, minAmount: 50, unit: 'g', isActive: true }
    ]);
    console.log("[SEED] ✅ Thresholds created: Sodium < 1500mg, Carbs < 150g");

    console.log("[SEED] 🏁 Core Seeding complete! User ID:", userId);
  } catch (error) {
    console.error("[SEED] ❌ Seeding failed:", error);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

seed();
