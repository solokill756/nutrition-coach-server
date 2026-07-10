import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { UserNotificationPayload, UserNotificationType } from "../user-notification.types";

@Entity({ name: "UserNotification" })
export class UserNotificationEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @Column({ type: "text", name: "Type" })
  type!: UserNotificationType;

  @Column({ type: "text", name: "Title" })
  title!: string;

  @Column({ type: "text", name: "Body" })
  body!: string;

  @Column({ type: "jsonb", name: "PayloadJson", nullable: true })
  payloadJson!: UserNotificationPayload | null;

  @Column({ type: "timestamp with time zone", name: "ReadAt", nullable: true })
  readAt!: Date | null;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;
}
