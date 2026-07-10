import { HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";
import { AdminUserException } from "./admin-users.exception";
import { AdminUserListQueryDto, AdminUserSortBy } from "./dto/admin-user-list-query.dto";
import {
  AdminUserDetailResponseDto,
  AdminUserListResponseDto,
  AdminUserResponseDto,
  AdminUserStatusResponseDto,
} from "./dto/admin-user-response.dto";
import { UpdateUserStatusRequestDto } from "./dto/update-user-status-request.dto";

type UserSortableColumn = "user.createdAt" | "user.displayName" | "user.email" | "user.lastLoginAt";

const SORT_COLUMN_MAP: Record<AdminUserSortBy, UserSortableColumn> = {
  createdAt: "user.createdAt",
  displayName: "user.displayName",
  email: "user.email",
  lastLoginAt: "user.lastLoginAt",
};

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(AppUserEntity)
    private readonly userRepo: Repository<AppUserEntity>,
  ) {}

  async list(query: AdminUserListQueryDto): Promise<AdminUserListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? "createdAt";
    const sortOrder = (query.sortOrder ?? "desc").toUpperCase() as "ASC" | "DESC";
    const qb = this.userRepo
      .createQueryBuilder("user")
      .where("user.delFlag = :delFlag", { delFlag: false });

    if (query.keyword?.trim()) {
      qb.andWhere("(user.email ILIKE :keyword OR user.displayName ILIKE :keyword)", {
        keyword: `%${query.keyword.trim()}%`,
      });
    }

    if (query.role?.trim()) {
      qb.andWhere("lower(user.role) = :role", { role: query.role.trim().toLowerCase() });
    }

    if (query.status === "active") {
      qb.andWhere("user.status = :status", { status: 1 });
    }

    if (query.status === "blocked") {
      qb.andWhere("user.status = :status", { status: 0 });
    }

    const [total, rows] = await Promise.all([
      qb.clone().getCount(),
      qb
        .clone()
        .orderBy(SORT_COLUMN_MAP[sortBy], sortOrder, "NULLS LAST")
        .addOrderBy("user.id", "DESC")
        .skip((page - 1) * limit)
        .take(limit)
        .getMany(),
    ]);

    return {
      success: true,
      data: rows.map((user) => this.toResponse(user)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async detail(id: number): Promise<AdminUserDetailResponseDto> {
    const user = await this.findActiveUserOrThrow(id);
    return {
      success: true,
      data: this.toResponse(user),
    };
  }

  async updateStatus(
    id: number,
    adminUserId: number,
    dto: UpdateUserStatusRequestDto,
  ): Promise<AdminUserStatusResponseDto> {
    if (id === adminUserId && !dto.isActive) {
      throw new AdminUserException("CANNOT_BLOCK_SELF", HttpStatus.BAD_REQUEST);
    }

    const user = await this.findActiveUserOrThrow(id);
    user.status = dto.isActive ? 1 : 0;
    user.updatedAt = new Date();
    const saved = await this.userRepo.save(user);

    return {
      success: true,
      message: dto.isActive ? "User unblocked successfully" : "User blocked successfully",
      data: {
        id: Number(saved.id),
        status: saved.status,
        isActive: saved.status === 1,
      },
    };
  }

  private async findActiveUserOrThrow(id: number): Promise<AppUserEntity> {
    const user = await this.userRepo.findOne({ where: { id, delFlag: false } });
    if (!user) {
      throw new AdminUserException("USER_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
    return user;
  }

  private toResponse(user: AppUserEntity): AdminUserResponseDto {
    return {
      id: Number(user.id),
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      statusLabel: this.statusLabel(user.status),
      isActive: user.status === 1,
      isProfileComplete: user.isProfileComplete,
      age: user.age,
      sex: user.sex,
      weight: user.weight,
      goalWeight: user.goalWeight,
      height: user.height,
      dietType: user.dietType,
      allergies: user.allergies ?? [],
      fitnessLevel: user.fitnessLevel,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private statusLabel(status: number): "active" | "blocked" | "other" {
    if (status === 1) return "active";
    if (status === 0) return "blocked";
    return "other";
  }
}
