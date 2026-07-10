import { ConflictException, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ExerciseEntity } from "./entities/exercise.entity";
import { GetExercisesQueryDto } from "./dto/get-exercises-query.dto";
import { CreateExerciseDto } from "./dto/create-exercise.dto";
import { UpdateExerciseDto } from "./dto/update-exercise.dto";

@Injectable()
export class ExercisesService {
  constructor(
    @InjectRepository(ExerciseEntity)
    private readonly exerciseRepo: Repository<ExerciseEntity>,
  ) {}

  async list(userId: number, dto: GetExercisesQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const qb = this.exerciseRepo
      .createQueryBuilder("e")
      .where("e.delFlag = :df", { df: false });

    if (dto.mineOnly) {
      qb.andWhere("e.userId = :userId", { userId });
    } else {
      qb.andWhere("e.isVerified = :verified", { verified: true });
    }

    qb.orderBy("e.name", "ASC");

    if (dto.q?.trim()) {
      qb.andWhere("e.name ILIKE :q", { q: `%${dto.q.trim()}%` });
    }
    if (dto.type) {
      qb.andWhere("e.type = :t", { t: dto.type });
    }

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      items: items.map((e) => this.toItem(e, userId)),
      page,
      limit,
      total,
    };
  }

  async getById(userId: number, id: number) {
    const e = await this.exerciseRepo.findOne({ where: { id, delFlag: false } });
    if (!e || !this.isReadableByUser(e, userId)) {
      throw new NotFoundException("Exercise not found");
    }
    return this.toItem(e, userId);
  }

  async create(userId: number, dto: CreateExerciseDto) {
    const name = dto.name.trim();
    await this.assertNameAvailable(name);

    const row = this.exerciseRepo.create({
      name,
      type: dto.type,
      met: dto.met == null ? null : String(dto.met),
      defaultCalPerMin: dto.defaultCalPerMin == null ? null : String(dto.defaultCalPerMin),
      notes: dto.notes?.trim() || null,
      delFlag: false,
      isVerified: false,
      userId,
    });
    const saved = await this.exerciseRepo.save(row);
    return this.toItem(saved, userId);
  }

  async update(userId: number, id: number, dto: UpdateExerciseDto) {
    const e = await this.assertUserOwnedExercise(userId, id);

    const hasAny =
      dto.name != null ||
      dto.type != null ||
      dto.met !== undefined ||
      dto.defaultCalPerMin !== undefined ||
      dto.notes !== undefined;
    if (!hasAny) {
      throw new BadRequestException("No fields to update");
    }
    if (dto.name != null) {
      const name = dto.name.trim();
      if (name !== e.name) {
        await this.assertNameAvailable(name, id);
      }
      e.name = name;
    }
    if (dto.type != null) {
      e.type = dto.type;
    }
    if (dto.met !== undefined) {
      e.met = String(dto.met);
    }
    if (dto.defaultCalPerMin !== undefined) {
      e.defaultCalPerMin = String(dto.defaultCalPerMin);
    }
    if (dto.notes !== undefined) {
      e.notes = dto.notes?.trim() || null;
    }
    e.updatedAt = new Date();
    const saved = await this.exerciseRepo.save(e);
    return this.toItem(saved, userId);
  }

  async softDelete(userId: number, id: number) {
    const e = await this.assertUserOwnedExercise(userId, id);
    e.delFlag = true;
    e.updatedAt = new Date();
    await this.exerciseRepo.save(e);
    return { success: true };
  }

  private isReadableByUser(e: ExerciseEntity, userId: number): boolean {
    return e.isVerified || (e.userId != null && Number(e.userId) === userId);
  }

  private async assertUserOwnedExercise(userId: number, id: number): Promise<ExerciseEntity> {
    const e = await this.exerciseRepo.findOne({ where: { id, delFlag: false } });
    if (!e || e.userId == null || Number(e.userId) !== userId) {
      throw new NotFoundException("Exercise not found");
    }
    return e;
  }

  private async assertNameAvailable(name: string, excludeId?: number) {
    const qb = this.exerciseRepo
      .createQueryBuilder("e")
      .where("e.delFlag = :df", { df: false })
      .andWhere("e.name = :n", { n: name });
    if (excludeId != null) {
      qb.andWhere("e.id != :id", { id: excludeId });
    }
    const found = await qb.getOne();
    if (found) {
      throw new ConflictException("An exercise with this name already exists");
    }
  }

  private toItem(e: ExerciseEntity, viewerUserId: number) {
    const ownerId = e.userId == null ? null : Number(e.userId);
    return {
      id: Number(e.id),
      name: e.name,
      type: e.type,
      met: e.met == null ? null : Number(e.met),
      defaultCalPerMin: e.defaultCalPerMin == null ? null : Number(e.defaultCalPerMin),
      notes: e.notes,
      isVerified: e.isVerified,
      isOwned: ownerId != null && ownerId === viewerUserId,
    };
  }
}
