import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import type { MealSplitsPercent } from "../../nutrition/meal-splits";

@Entity({ name: "AppUser" })
export class AppUserEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "text", name: "Email", nullable: true })
  email!: string | null;

  @Column({ type: "text", name: "PasswordHash", nullable: true })
  passwordHash!: string | null;

  @Column({ type: "text", name: "DisplayName" })
  displayName!: string;

  @Column({ type: "text", name: "AvatarUrl", nullable: true })
  avatarUrl!: string | null;

  @Column({ type: "smallint", name: "Status", default: 1 })
  status!: number;

  @Column({ type: "text", name: "Role", default: "user" })
  role!: string;

  @Column({ type: "boolean", name: "IsProfileComplete", default: false })
  isProfileComplete!: boolean;

  @Column({ type: "smallint", name: "Age", nullable: true })
  age!: number | null;

  @Column({ type: "text", name: "Sex", nullable: true })
  sex!: string | null;

  @Column({ type: "float", name: "Weight", nullable: true })
  weight!: number | null;

  /** Onboarding baseline; kept for progress START even when {@link weight} tracks latest log. */
  @Column({ type: "float", name: "StartWeight", nullable: true })
  startWeight!: number | null;

  @Column({ type: "float", name: "GoalWeight", nullable: true })
  goalWeight!: number | null;

  @Column({ type: "float", name: "Height", nullable: true })
  height!: number | null;

  @Column({ type: "text", name: "DietType", nullable: true })
  dietType!: string | null;

  @Column({ type: "text", name: "Allergies", array: true, nullable: true })
  allergies!: string[] | null;

  /** Custom % of the day's calories per meal; null = DEFAULT_MEAL_SPLITS. */
  @Column({ type: "jsonb", name: "MealSplits", nullable: true })
  mealSplits!: MealSplitsPercent | null;

  @Column({ type: "text", name: "FitnessLevel", default: "beginner" })
  fitnessLevel!: string;

  @Column({ type: "smallint", name: "LoginAttemptCount", nullable: true, default: 0 })
  loginAttemptCount!: number;

  @Column({ type: "timestamp with time zone", name: "LockoutUntil", nullable: true })
  lockoutUntil!: Date | null;

  @Column({ type: "timestamp with time zone", name: "LastLoginAt", nullable: true })
  lastLoginAt!: Date | null;

  @Column({ type: "timestamp with time zone", name: "PasswordChangedAt", nullable: true })
  passwordChangedAt!: Date | null;

  @Column({ type: "text", name: "PasswordResetToken", nullable: true })
  passwordResetToken!: string | null;

  @Column({ type: "timestamp with time zone", name: "PasswordResetExpires", nullable: true })
  passwordResetExpires!: Date | null;

  @Column({ type: "boolean", name: "DelFlag", default: false })
  delFlag!: boolean;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;
}
