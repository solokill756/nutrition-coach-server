import { Column, Entity, PrimaryColumn } from "typeorm";
import { bigintTransformer } from "./transformers";

@Entity({ name: "UserSession" })
export class UserSessionEntity {
  @PrimaryColumn({ type: "text", name: "Id" })
  id!: string;

  @Column({ type: "bigint", name: "UserId", transformer: bigintTransformer })
  userId!: number;

  @Column({ type: "text", name: "RefreshTokenHash" })
  refreshTokenHash!: string;

  @Column({ type: "timestamp with time zone", name: "RefreshTokenExpires" })
  refreshTokenExpires!: Date;

  @Column({ type: "text", name: "DeviceInfo", nullable: true })
  deviceInfo!: string | null;

  @Column({ type: "inet", name: "IpAddress", nullable: true })
  ipAddress!: string | null;

  @Column({ type: "boolean", name: "IsRevoked", default: false })
  isRevoked!: boolean;

  @Column({ type: "timestamp with time zone", name: "CreatedAt" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "LastUsedAt" })
  lastUsedAt!: Date;
}
