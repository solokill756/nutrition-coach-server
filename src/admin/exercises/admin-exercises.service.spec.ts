import { Repository } from "typeorm";
import { ExerciseEntity, ExerciseType } from "../../exercises/entities/exercise.entity";
import { AdminExerciseException } from "./admin-exercises.exception";
import { AdminExercisesService } from "./admin-exercises.service";

type MockRepository = Pick<Repository<ExerciseEntity>, "create" | "createQueryBuilder" | "findOne" | "save">;

const makeExercise = (overrides: Partial<ExerciseEntity> = {}): ExerciseEntity => ({
  id: 1,
  name: "Running",
  type: ExerciseType.cardio,
  met: "8.00",
  defaultCalPerMin: "9.80",
  notes: "Moderate running",
  delFlag: false,
  isVerified: true,
  createdAt: new Date("2026-05-24T00:00:00.000Z"),
  updatedAt: new Date("2026-05-24T01:00:00.000Z"),
  ...overrides,
});

const makeQueryBuilder = (rows: ExerciseEntity[] = [], count = rows.length, one: ExerciseEntity | null = null) => {
  const qb = {
    clone: jest.fn(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(count),
    getMany: jest.fn().mockResolvedValue(rows),
    getOne: jest.fn().mockResolvedValue(one),
  };
  qb.clone.mockReturnValue(qb);
  return qb;
};

const buildService = (repoOverrides: Partial<MockRepository> = {}) => {
  const repo: MockRepository = {
    create: jest.fn((entity: Partial<ExerciseEntity>) => entity as ExerciseEntity),
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async (entity: ExerciseEntity) => entity),
    ...repoOverrides,
  };
  return {
    repo,
    service: new AdminExercisesService(repo as Repository<ExerciseEntity>),
  };
};

describe("AdminExercisesService", () => {
  it("lists exercises with filters, sort, and pagination", async () => {
    const qb = makeQueryBuilder([makeExercise()], 1);
    const { repo, service } = buildService({
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    });

    const response = await service.list({
      page: 2,
      limit: 10,
      keyword: "run",
      type: ExerciseType.cardio,
      isVerified: false,
      sortBy: "met",
      sortOrder: "desc",
    });

    expect(response).toEqual({
      success: true,
      data: [
        {
          id: 1,
          name: "Running",
          type: ExerciseType.cardio,
          met: 8,
          defaultCalPerMin: 9.8,
          notes: "Moderate running",
          isVerified: true,
          createdAt: "2026-05-24T00:00:00.000Z",
          updatedAt: "2026-05-24T01:00:00.000Z",
        },
      ],
      pagination: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });
    expect(repo.createQueryBuilder).toHaveBeenCalledWith("exercise");
    expect(qb.where).toHaveBeenCalledWith("exercise.delFlag = :delFlag", { delFlag: false });
    expect(qb.andWhere).toHaveBeenCalledWith("exercise.name ILIKE :keyword", { keyword: "%run%" });
    expect(qb.andWhere).toHaveBeenCalledWith("exercise.type = :type", { type: ExerciseType.cardio });
    expect(qb.andWhere).toHaveBeenCalledWith("exercise.isVerified = :isVerified", { isVerified: false });
    expect(qb.orderBy).toHaveBeenCalledWith("exercise.met", "DESC");
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
  });

  it("returns detail and rejects missing exercises", async () => {
    const { repo, service } = buildService({
      findOne: jest.fn().mockResolvedValueOnce(makeExercise()).mockResolvedValueOnce(null),
    });

    await expect(service.detail(1)).resolves.toMatchObject({
      success: true,
      data: { id: 1, name: "Running", met: 8, defaultCalPerMin: 9.8 },
    });
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 1, delFlag: false } });
    await expect(service.detail(2)).rejects.toMatchObject({ code: "EXERCISE_NOT_FOUND" });
  });

  it("creates exercises with trimmed text and nullable numeric fields", async () => {
    const qb = makeQueryBuilder([], 0, null);
    const { repo, service } = buildService({
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn(async (entity: ExerciseEntity) => ({
        ...entity,
        id: 9,
        createdAt: makeExercise().createdAt,
        updatedAt: makeExercise().updatedAt,
      })),
    });

    await expect(service.create({
      name: " Running ",
      type: ExerciseType.cardio,
      met: null,
      defaultCalPerMin: undefined,
      notes: " Moderate running ",
    })).resolves.toEqual({
      success: true,
      message: "Exercise created successfully",
      data: { id: 9, name: "Running" },
    });
    expect(repo.create).toHaveBeenCalledWith({
      name: "Running",
      type: ExerciseType.cardio,
      met: null,
      defaultCalPerMin: null,
      notes: "Moderate running",
      delFlag: false,
      isVerified: true,
    });
  });

  it("rejects duplicate active exercise names on create and update", async () => {
    const duplicate = makeExercise({ id: 2, name: "Running" });
    const { service } = buildService({
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder([], 0, duplicate)),
    });

    await expect(service.create({ name: "Running", type: ExerciseType.cardio })).rejects.toBeInstanceOf(AdminExerciseException);

    const updateService = buildService({
      findOne: jest.fn().mockResolvedValue(makeExercise({ id: 1, name: "Jogging" })),
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder([], 0, duplicate)),
    }).service;

    await expect(updateService.update(1, { name: "Running" })).rejects.toMatchObject({
      code: "EXERCISE_NAME_ALREADY_EXISTS",
    });
  });

  it("updates provided fields and soft deletes only", async () => {
    const exercise = makeExercise();
    const { repo, service } = buildService({
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder([], 0, null)),
      findOne: jest.fn().mockResolvedValue(exercise),
      save: jest.fn(async (entity: ExerciseEntity) => entity),
    });

    await expect(service.update(1, {
      name: "Running fast",
      type: ExerciseType.cardio,
      met: 9,
      defaultCalPerMin: 10.5,
      notes: "",
      isVerified: false,
    })).resolves.toMatchObject({
      success: true,
      message: "Exercise updated successfully",
      data: { id: 1, name: "Running fast" },
    });
    expect(exercise.name).toBe("Running fast");
    expect(exercise.met).toBe("9");
    expect(exercise.defaultCalPerMin).toBe("10.5");
    expect(exercise.notes).toBeNull();
    expect(exercise.isVerified).toBe(false);
    expect(exercise.updatedAt).toBeInstanceOf(Date);

    await expect(service.softDelete(1)).resolves.toEqual({
      success: true,
      message: "Exercise deleted successfully",
    });
    expect(exercise.delFlag).toBe(true);
    expect(repo.save).toHaveBeenCalled();
  });

  it("toggles verification status", async () => {
    const exercise = makeExercise({ isVerified: false });
    const { service } = buildService({
      findOne: jest.fn().mockResolvedValue(exercise),
      save: jest.fn(async (entity: ExerciseEntity) => entity),
    });

    await expect(service.updateVerify(1, { isVerified: true })).resolves.toEqual({
      success: true,
      message: "Exercise verification status updated successfully",
      data: { id: 1, isVerified: true },
    });
    expect(exercise.isVerified).toBe(true);
  });
});
