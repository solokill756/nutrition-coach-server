import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseFilters, UseGuards } from "@nestjs/common";
import { AdminAuthExceptionFilter } from "../auth/admin-auth-exception.filter";
import { AdminJwtAuthGuard } from "../auth/guards/admin-jwt-auth.guard";
import { AdminRoleGuard } from "../auth/guards/admin-role.guard";
import { AdminRecipesService } from "./admin-recipes.service";
import { AdminRecipeListQueryDto } from "./dto/admin-recipe-list-query.dto";
import { CreateAdminRecipeRequestDto, UpdateAdminRecipeRequestDto, UpdateRecipeVerifyRequestDto } from "./dto/write-admin-recipe-request.dto";

@Controller("admin/recipes")
@UseFilters(AdminAuthExceptionFilter)
@UseGuards(AdminJwtAuthGuard, AdminRoleGuard)
export class AdminRecipesController {
  constructor(private readonly adminRecipesService: AdminRecipesService) {}

  @Get()
  async list(@Query() query: AdminRecipeListQueryDto) {
    return this.adminRecipesService.list(query);
  }

  @Get(":id")
  async detail(@Param("id", ParseIntPipe) id: number) {
    return this.adminRecipesService.detail(id);
  }

  @Post()
  async create(@Body() body: CreateAdminRecipeRequestDto) {
    return this.adminRecipesService.create(body);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateAdminRecipeRequestDto,
  ) {
    return this.adminRecipesService.update(id, body);
  }

  @Delete(":id")
  async delete(@Param("id", ParseIntPipe) id: number) {
    return this.adminRecipesService.softDelete(id);
  }

  @Patch(":id/verify")
  async verify(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateRecipeVerifyRequestDto,
  ) {
    return this.adminRecipesService.updateVerify(id, body);
  }
}
