import { BadRequestException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ExerciseEntity } from "../../exercises/entities/exercise.entity";
import { AdminExerciseException } from "./admin-exercises.exception";
import { AdminExerciseListQueryDto, AdminExerciseSortBy } from "./dto/admin-exercise-list-query.dto";
import {
  AdminExerciseDeleteResponseDto,
  AdminExerciseDetailResponseDto,
  AdminExerciseListResponseDto,
  AdminExerciseResponseDto,
  AdminExerciseVerifyResponseDto,
  AdminExerciseWriteResponseDto,
} from "./dto/admin-exercise-response.dto";
import { CreateAdminExerciseRequestDto } from "./dto/create-admin-exercise-request.dto";
import { UpdateExerciseVerifyRequestDto } from "./dto/update-exercise-verify-request.dto";
import { UpdateAdminExerciseRequestDto } from "./dto/update-admin-exercise-request.dto";

type ExerciseSortableColumn =
  | "exercise.name"
  | "exercise.type"
  | "exercise.met"
  | "exercise.defaultCalPerMin"
  | "exercise.createdAt";

const SORT_COLUMN_MAP: Record<AdminExerciseSortBy, ExerciseSortableColumn> = {
  name: "exercise.name",
  type: "exercise.type",
  met: "exercise.met",
  defaultCalPerMin: "exercise.defaultCalPerMin",
  createdAt: "exercise.createdAt",
};

@Injectable()
export class AdminExercisesService {
  constructor(
    @InjectRepository(ExerciseEntity)
    private readonly exerciseRepo: Repository<ExerciseEntity>,
  ) {}

  async list(query: AdminExerciseListQueryDto): Promise<AdminExerciseListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? "name";
    const sortOrder = (query.sortOrder ?? "asc").toUpperCase() as "ASC" | "DESC";
    const qb = this.exerciseRepo
      .createQueryBuilder("exercise")
      .where("exercise.delFlag = :delFlag", { delFlag: false });

    if (query.keyword?.trim()) {
      qb.andWhere("exercise.name ILIKE :keyword", { keyword: `%${query.keyword.trim()}%` });
    }

    if (query.type) {
      qb.andWhere("exercise.type = :type", { type: query.type });
    }

    if (query.isVerified !== undefined) {
      qb.andWhere("exercise.isVerified = :isVerified", { isVerified: query.isVerified });
    }

    const [total, rows] = await Promise.all([
      qb.clone().getCount(),
      qb
        .clone()
        .orderBy(SORT_COLUMN_MAP[sortBy], sortOrder)
        .skip((page - 1) * limit)
        .take(limit)
        .getMany(),
    ]);

    return {
      success: true,
      data: rows.map((exercise) => this.toItem(exercise)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async detail(id: number): Promise<AdminExerciseDetailResponseDto> {
    const exercise = await this.findActiveExerciseOrThrow(id);
    return {
      success: true,
      data: this.toItem(exercise),
    };
  }

  async create(dto: CreateAdminExerciseRequestDto): Promise<AdminExerciseWriteResponseDto> {
    const name = this.normalizeRequiredText(dto.name);
    await this.assertNameAvailable(name);

    const saved = await this.exerciseRepo.save(
      this.exerciseRepo.create({
        name,
        type: dto.type,
        met: this.toNullableNumericString(dto.met),
        defaultCalPerMin: this.toNullableNumericString(dto.defaultCalPerMin),
        notes: this.normalizeOptionalText(dto.notes),
        delFlag: false,
        isVerified: dto.isVerified ?? true,
      }),
    );

    return {
      success: true,
      message: "Exercise created successfully",
      data: {
        id: Number(saved.id),
        name: saved.name,
      },
    };
  }

  async update(id: number, dto: UpdateAdminExerciseRequestDto): Promise<AdminExerciseWriteResponseDto> {
    const exercise = await this.findActiveExerciseOrThrow(id);

    if (dto.name !== undefined) {
      const name = this.normalizeRequiredText(dto.name);
      if (name.toLowerCase() !== exercise.name.toLowerCase()) {
        await this.assertNameAvailable(name, id);
      }
      exercise.name = name;
    }

    if (dto.type !== undefined) exercise.type = dto.type;
    if (dto.met !== undefined) exercise.met = this.toNullableNumericString(dto.met);
    if (dto.defaultCalPerMin !== undefined) {
      exercise.defaultCalPerMin = this.toNullableNumericString(dto.defaultCalPerMin);
    }
    if (dto.notes !== undefined) exercise.notes = this.normalizeOptionalText(dto.notes);
    if (dto.isVerified !== undefined) exercise.isVerified = dto.isVerified;

    exercise.updatedAt = new Date();
    const saved = await this.exerciseRepo.save(exercise);

    return {
      success: true,
      message: "Exercise updated successfully",
      data: {
        id: Number(saved.id),
        name: saved.name,
      },
    };
  }

  async softDelete(id: number): Promise<AdminExerciseDeleteResponseDto> {
    const exercise = await this.findActiveExerciseOrThrow(id);
    exercise.delFlag = true;
    exercise.updatedAt = new Date();
    await this.exerciseRepo.save(exercise);

    return {
      success: true,
      message: "Exercise deleted successfully",
    };
  }

  async updateVerify(id: number, dto: UpdateExerciseVerifyRequestDto): Promise<AdminExerciseVerifyResponseDto> {
    const exercise = await this.findActiveExerciseOrThrow(id);
    exercise.isVerified = dto.isVerified;
    exercise.updatedAt = new Date();
    const saved = await this.exerciseRepo.save(exercise);

    return {
      success: true,
      message: "Exercise verification status updated successfully",
      data: {
        id: Number(saved.id),
        isVerified: saved.isVerified,
      },
    };
  }

  private async findActiveExerciseOrThrow(id: number): Promise<ExerciseEntity> {
    const exercise = await this.exerciseRepo.findOne({ where: { id, delFlag: false } });
    if (!exercise) {
      throw new AdminExerciseException("EXERCISE_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
    return exercise;
  }

  private async assertNameAvailable(name: string, excludeId?: number): Promise<void> {
    const qb = this.exerciseRepo
      .createQueryBuilder("exercise")
      .where("exercise.delFlag = :delFlag", { delFlag: false })
      .andWhere("lower(exercise.name) = :name", { name: name.toLowerCase() });

    if (excludeId !== undefined) {
      qb.andWhere("exercise.id != :id", { id: excludeId });
    }

    const existing = await qb.getOne();
    if (existing) {
      throw new AdminExerciseException("EXERCISE_NAME_ALREADY_EXISTS", HttpStatus.CONFLICT);
    }
  }

  private toItem(exercise: ExerciseEntity): AdminExerciseResponseDto {
    return {
      id: Number(exercise.id),
      name: exercise.name,
      type: exercise.type,
      met: exercise.met == null ? null : Number(exercise.met),
      defaultCalPerMin: exercise.defaultCalPerMin == null ? null : Number(exercise.defaultCalPerMin),
      notes: exercise.notes,
      isVerified: exercise.isVerified,
      createdAt: exercise.createdAt.toISOString(),
      updatedAt: exercise.updatedAt ? exercise.updatedAt.toISOString() : null,
    };
  }

  private normalizeRequiredText(value: string): string {
    const text = String(value || "").trim();
    if (!text) {
      throw new BadRequestException("Required text cannot be empty");
    }
    return text;
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    const text = String(value ?? "").trim();
    return text || null;
  }

  private toNullableNumericString(value: number | null | undefined): string | null {
    return value === null || value === undefined ? null : String(value);
  }
}
