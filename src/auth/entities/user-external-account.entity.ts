import { Column, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";
import { bigintTransformer } from "./transformers";

@Entity({ name: "UserExternalAccount" })
@Unique("UQ_UserExternalAccount_Provider_Subject", ["provider", "providerSubject"])
export class UserExternalAccountEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId", transformer: bigintTransformer })
  userId!: number;

  @Column({ type: "text", name: "Provider" })
  provider!: string;

  @Column({ type: "text", name: "ProviderSubject" })
  providerSubject!: string;

  @Column({ type: "text", name: "Email", nullable: true })
  email!: string | null;

  @Column({ type: "boolean", name: "EmailVerified", default: false })
  emailVerified!: boolean;

  @Column({ type: "text", name: "DisplayName", nullable: true })
  displayName!: string | null;

  @Column({ type: "text", name: "AvatarUrl", nullable: true })
  avatarUrl!: string | null;

  @Column({ type: "timestamp with time zone", name: "CreatedAt" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt" })
  updatedAt!: Date;
}
