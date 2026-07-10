import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ExercisesService } from "./exercises.service";

describe("ExercisesService", () => {
  const viewerUserId = 7;

  function setup() {
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      getCount: jest.fn().mockResolvedValue(1),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 1,
          name: "Run",
          type: "cardio",
          met: "8",
          defaultCalPerMin: "10",
          notes: null,
          isVerified: true,
          userId: null,
        },
      ]),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const repo: any = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: x.id ?? 10, ...x })),
    };
    const service = new ExercisesService(repo);
    return { service, repo, qb };
  }

  it("list filters global verified catalog by default", async () => {
    const { service, qb } = setup();
    const out = await service.list(viewerUserId, { page: 2, limit: 5, q: " run ", type: "cardio" } as any);
    expect(qb.andWhere).toHaveBeenCalledWith("e.isVerified = :verified", { verified: true });
    expect(out.total).toBe(1);
    expect(out.page).toBe(2);
    expect(out.items[0]).toMatchObject({ id: 1, met: 8, isOwned: false });
  });

  it("list filters mine only when requested", async () => {
    const { service, qb } = setup();
    await service.list(viewerUserId, { mineOnly: true, q: "walk" } as any);
    expect(qb.andWhere).toHaveBeenCalledWith("e.userId = :userId", { userId: viewerUserId });
  });

  it("getById throws when missing or not readable", async () => {
    const { service, repo } = setup();
    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.getById(viewerUserId, 99)).rejects.toBeInstanceOf(NotFoundException);

    repo.findOne.mockResolvedValueOnce({
      id: 2,
      name: "Custom",
      type: "cardio",
      met: "5",
      defaultCalPerMin: null,
      notes: null,
      delFlag: false,
      isVerified: false,
      userId: 99,
    });
    await expect(service.getById(viewerUserId, 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getById returns owned unverified exercise", async () => {
    const { service, repo } = setup();
    repo.findOne.mockResolvedValueOnce({
      id: 2,
      name: "Custom",
      type: "cardio",
      met: "5",
      defaultCalPerMin: null,
      notes: null,
      delFlag: false,
      isVerified: false,
      userId: viewerUserId,
    });
    const out = await service.getById(viewerUserId, 2);
    expect(out).toMatchObject({ id: 2, isOwned: true, isVerified: false });
  });

  it("create throws conflict when name exists", async () => {
    const { service, qb } = setup();
    qb.getOne.mockResolvedValueOnce({ id: 2 });
    await expect(service.create(viewerUserId, { name: "Run", type: "cardio" } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("create assigns userId and unverified flag", async () => {
    const { service, repo } = setup();
    const out = await service.create(viewerUserId, { name: "My walk", type: "cardio" } as any);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: viewerUserId, isVerified: false }),
    );
    expect(out.isOwned).toBe(true);
  });

  it("update validates empty dto", async () => {
    const { service, repo } = setup();
    repo.findOne.mockResolvedValueOnce({
      id: 1,
      name: "Run",
      type: "cardio",
      met: "8",
      defaultCalPerMin: "10",
      notes: null,
      delFlag: false,
      userId: viewerUserId,
    });
    await expect(service.update(viewerUserId, 1, {} as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("update and softDelete reject catalog exercises", async () => {
    const { service, repo } = setup();
    repo.findOne.mockResolvedValue({
      id: 1,
      name: "Run",
      type: "cardio",
      met: "8",
      defaultCalPerMin: "10",
      notes: null,
      delFlag: false,
      userId: null,
      isVerified: true,
    });

    await expect(service.update(viewerUserId, 1, { notes: "fast" } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.softDelete(viewerUserId, 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update and softDelete success for owned exercise", async () => {
    const { service, repo } = setup();
    const owned = {
      id: 1,
      name: "Run",
      type: "cardio",
      met: "8",
      defaultCalPerMin: "10",
      notes: null,
      delFlag: false,
      userId: viewerUserId,
      isVerified: false,
    };
    repo.findOne.mockResolvedValueOnce(owned).mockResolvedValueOnce(owned);

    const updated = await service.update(viewerUserId, 1, { notes: "  fast  ", met: 9 } as any);
    expect(updated.notes).toBe("fast");

    const del = await service.softDelete(viewerUserId, 1);
    expect(del).toEqual({ success: true });
  });
});
