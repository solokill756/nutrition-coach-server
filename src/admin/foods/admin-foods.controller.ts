import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseFilters, UseGuards } from "@nestjs/common";
import { AdminAuthExceptionFilter } from "../auth/admin-auth-exception.filter";
import { AdminJwtAuthGuard } from "../auth/guards/admin-jwt-auth.guard";
import { AdminRoleGuard } from "../auth/guards/admin-role.guard";
import { AdminFoodListQueryDto } from "./dto/admin-food-list-query.dto";
import { CreateAdminFoodRequestDto } from "./dto/create-admin-food-request.dto";
import { UpdateAdminFoodRequestDto } from "./dto/update-admin-food-request.dto";
import { UpdateFoodVerifyRequestDto } from "./dto/update-food-verify-request.dto";
import { AdminFoodsService } from "./admin-foods.service";

@Controller("admin/foods")
@UseFilters(AdminAuthExceptionFilter)
@UseGuards(AdminJwtAuthGuard, AdminRoleGuard)
export class AdminFoodsController {
  constructor(private readonly adminFoodsService: AdminFoodsService) {}

  @Get()
  async list(@Query() query: AdminFoodListQueryDto) {
    return this.adminFoodsService.list(query);
  }

  @Get(":id")
  async detail(@Param("id", ParseIntPipe) id: number) {
    return this.adminFoodsService.detail(id);
  }

  @Post()
  async create(@Body() body: CreateAdminFoodRequestDto) {
    return this.adminFoodsService.create(body);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateAdminFoodRequestDto,
  ) {
    return this.adminFoodsService.update(id, body);
  }

  @Delete(":id")
  async delete(@Param("id", ParseIntPipe) id: number) {
    return this.adminFoodsService.softDelete(id);
  }

  @Patch(":id/verify")
  async verify(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateFoodVerifyRequestDto,
  ) {
    return this.adminFoodsService.updateVerify(id, body);
  }
}
