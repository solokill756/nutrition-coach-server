import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserNotificationEntity } from "./entities/user-notification.entity";
import { UserNotificationService } from "./user-notification.service";
import { UserNotificationsController } from "./user-notifications.controller";

@Module({
  imports: [TypeOrmModule.forFeature([UserNotificationEntity])],
  controllers: [UserNotificationsController],
  providers: [UserNotificationService],
  exports: [UserNotificationService],
})
export class UserNotificationsModule {}
