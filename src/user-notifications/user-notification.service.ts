import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, LessThan, Repository } from "typeorm";
import { UserNotificationEntity } from "./entities/user-notification.entity";
import { CreateUserNotificationInput } from "./user-notification.types";

@Injectable()
export class UserNotificationService {
  constructor(
    @InjectRepository(UserNotificationEntity)
    private readonly notificationRepo: Repository<UserNotificationEntity>,
  ) {}

  async create(input: CreateUserNotificationInput): Promise<UserNotificationEntity> {
    const row = this.notificationRepo.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      payloadJson: input.payload ?? null,
      readAt: null,
    });
    return this.notificationRepo.save(row);
  }

  async listForUser(userId: number, limit = 50, beforeId?: number): Promise<UserNotificationEntity[]> {
    const take = Math.min(Math.max(limit, 1), 100);
    const where: Record<string, unknown> = { userId };
    if (beforeId != null) {
      where.id = LessThan(beforeId);
    }
    return this.notificationRepo.find({
      where,
      order: { id: "DESC" },
      take,
    });
  }

  async countUnread(userId: number): Promise<number> {
    return this.notificationRepo.count({
      where: { userId, readAt: IsNull() },
    });
  }

  async markRead(userId: number, notificationId: number): Promise<UserNotificationEntity> {
    const row = await this.notificationRepo.findOne({
      where: { id: notificationId, userId },
    });
    if (!row) {
      throw new NotFoundException("Notification not found");
    }
    if (row.readAt != null) {
      return row;
    }
    row.readAt = new Date();
    return this.notificationRepo.save(row);
  }
}
