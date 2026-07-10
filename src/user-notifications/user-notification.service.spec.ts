import { NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { UserNotificationEntity } from "./entities/user-notification.entity";
import { UserNotificationService } from "./user-notification.service";

const repo = () => ({
  create: jest.fn((x) => x),
  save: jest.fn(async (x) => ({ id: 1, readAt: null, createdAt: new Date(), ...x })),
  count: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
}) as unknown as jest.Mocked<Repository<UserNotificationEntity>>;

describe("UserNotificationService", () => {
  it("creates a notification row", async () => {
    const notificationRepo = repo();
    const service = new UserNotificationService(notificationRepo);

    await service.create({
      userId: 7,
      type: "threshold_adjusted",
      title: "Nutrition target updated",
      body: "Adjusted",
      payload: { deepLink: "nutrition" },
    });

    expect(notificationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, type: "threshold_adjusted" }),
    );
    expect(notificationRepo.save).toHaveBeenCalled();
  });

  it("lists notifications for a user newest first", async () => {
    const notificationRepo = repo();
    notificationRepo.find.mockResolvedValue([{ id: 2 } as UserNotificationEntity]);
    const service = new UserNotificationService(notificationRepo);

    const rows = await service.listForUser(7, 50);

    expect(rows).toHaveLength(1);
    expect(notificationRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7 },
        order: { id: "DESC" },
        take: 50,
      }),
    );
  });

  it("counts unread notifications", async () => {
    const notificationRepo = repo();
    notificationRepo.count.mockResolvedValue(3);
    const service = new UserNotificationService(notificationRepo);

    await expect(service.countUnread(7)).resolves.toBe(3);
    expect(notificationRepo.count).toHaveBeenCalledWith({
      where: { userId: 7, readAt: expect.anything() },
    });
  });

  it("marks a notification as read", async () => {
    const notificationRepo = repo();
    const row = {
      id: 5,
      userId: 7,
      readAt: null,
    } as UserNotificationEntity;
    notificationRepo.findOne.mockResolvedValue(row);
    notificationRepo.save.mockImplementation(async (x) => x as UserNotificationEntity);
    const service = new UserNotificationService(notificationRepo);

    const out = await service.markRead(7, 5);

    expect(out.readAt).toBeInstanceOf(Date);
  });

  it("markRead is idempotent when already read", async () => {
    const readAt = new Date("2026-06-01T00:00:00Z");
    const notificationRepo = repo();
    notificationRepo.findOne.mockResolvedValue({
      id: 5,
      userId: 7,
      readAt,
    } as UserNotificationEntity);
    const service = new UserNotificationService(notificationRepo);

    const out = await service.markRead(7, 5);

    expect(out.readAt).toBe(readAt);
    expect(notificationRepo.save).not.toHaveBeenCalled();
  });

  it("markRead throws 404 for another user's notification", async () => {
    const notificationRepo = repo();
    notificationRepo.findOne.mockResolvedValue(null);
    const service = new UserNotificationService(notificationRepo);

    await expect(service.markRead(7, 99)).rejects.toBeInstanceOf(NotFoundException);
  });
});
