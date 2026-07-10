import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseFilters, UseGuards } from "@nestjs/common";
import { AdminAuthExceptionFilter } from "../auth/admin-auth-exception.filter";
import { AdminJwtAuthGuard } from "../auth/guards/admin-jwt-auth.guard";
import { AdminRoleGuard } from "../auth/guards/admin-role.guard";
import { AdminExercisesService } from "./admin-exercises.service";
import { AdminExerciseListQueryDto } from "./dto/admin-exercise-list-query.dto";
import { CreateAdminExerciseRequestDto } from "./dto/create-admin-exercise-request.dto";
import { UpdateExerciseVerifyRequestDto } from "./dto/update-exercise-verify-request.dto";
import { UpdateAdminExerciseRequestDto } from "./dto/update-admin-exercise-request.dto";

@Controller("admin/exercises")
@UseFilters(AdminAuthExceptionFilter)
@UseGuards(AdminJwtAuthGuard, AdminRoleGuard)
export class AdminExercisesController {
  constructor(private readonly adminExercisesService: AdminExercisesService) {}

  @Get()
  async list(@Query() query: AdminExerciseListQueryDto) {
    return this.adminExercisesService.list(query);
  }

  @Get(":id")
  async detail(@Param("id", ParseIntPipe) id: number) {
    return this.adminExercisesService.detail(id);
  }

  @Post()
  async create(@Body() body: CreateAdminExerciseRequestDto) {
    return this.adminExercisesService.create(body);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateAdminExerciseRequestDto,
  ) {
    return this.adminExercisesService.update(id, body);
  }

  @Patch(":id/verify")
  async updateVerify(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateExerciseVerifyRequestDto,
  ) {
    return this.adminExercisesService.updateVerify(id, body);
  }

  @Delete(":id")
  async delete(@Param("id", ParseIntPipe) id: number) {
    return this.adminExercisesService.softDelete(id);
  }
}
