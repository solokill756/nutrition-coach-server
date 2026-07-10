import { Controller, Get, Param, ParseIntPipe, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { UserNotificationListQueryDto } from "./dto/user-notification-list-query.dto";
import { UserNotificationEntity } from "./entities/user-notification.entity";
import { UserNotificationService } from "./user-notification.service";

function toItemDto(row: UserNotificationEntity) {
  return {
    id: Number(row.id),
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payloadJson,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Controller("api/notifications")
@UseGuards(JwtAuthGuard)
export class UserNotificationsController {
  constructor(private readonly notifications: UserNotificationService) {}

  @Get("unread-count")
  async unreadCount(@Req() req: Request & { user: { userId: number } }) {
    const count = await this.notifications.countUnread(req.user.userId);
    return { success: true, data: { count } };
  }

  @Get()
  async list(
    @Req() req: Request & { user: { userId: number } },
    @Query() query: UserNotificationListQueryDto,
  ) {
    const limit = query.limit ?? 50;
    const items = await this.notifications.listForUser(req.user.userId, limit, query.beforeId);
    return {
      success: true,
      data: {
        items: items.map(toItemDto),
        hasMore: items.length === limit,
      },
    };
  }

  @Patch(":id/read")
  async markRead(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
  ) {
    const row = await this.notifications.markRead(req.user.userId, id);
    return {
      success: true,
      data: {
        id: Number(row.id),
        readAt: row.readAt ? row.readAt.toISOString() : null,
      },
    };
  }
}
