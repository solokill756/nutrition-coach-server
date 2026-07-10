import { BadRequestException, Body, Controller, DefaultValuePipe, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MealsService } from "./meals.service";
import { AddMealItemDto, CopyPreviousMealDto, CreateMealDto, UpdateMealDto, UpdateMealItemDto } from "./dto/meal.dto";
import { Request } from "express";

@Controller("api/Meal")
@UseGuards(JwtAuthGuard)
export class MealsController {
  constructor(private readonly mealsService: MealsService) {}

  @Get()
  async list(
    @Req() req: Request & { user: { userId: number } },
    @Query("search") search?: string,
    @Query("includeCommunity") includeCommunity?: string,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query("pageSize", new DefaultValuePipe(50), ParseIntPipe) pageSize?: number,
  ) {
    const includeCommunityMode = String(includeCommunity ?? "").toLowerCase() === "true";
    const { items, total } = await this.mealsService.list(req.user.userId, search, includeCommunityMode, page ?? 1, pageSize ?? 50);
    return { items, total };
  }

  @Post()
  async create(@Req() req: Request & { user: { userId: number } }, @Body() dto: CreateMealDto) {
    return this.mealsService.create(req.user.userId, dto);
  }

  @Get(":id")
  async getById(@Req() req: Request & { user: { userId: number } }, @Param("id", ParseIntPipe) id: number) {
    return this.mealsService.getById(req.user.userId, id);
  }

  @Put(":id")
  async update(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateMealDto,
  ) {
    return this.mealsService.update(req.user.userId, id, dto);
  }

  @Delete(":id")
  async remove(@Req() req: Request & { user: { userId: number } }, @Param("id", ParseIntPipe) id: number) {
    return this.mealsService.remove(req.user.userId, id);
  }

  @Post(":id/items")
  async addItem(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AddMealItemDto,
  ) {
    return this.mealsService.addItem(req.user.userId, id, dto);
  }

  @Put(":id/items/:mealFoodId")
  async updateItem(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
    @Param("mealFoodId", ParseIntPipe) mealFoodId: number,
    @Body() dto: UpdateMealItemDto,
  ) {
    return this.mealsService.updateItem(req.user.userId, id, mealFoodId, dto);
  }

  @Delete(":id/items/:mealFoodId")
  async removeItem(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
    @Param("mealFoodId", ParseIntPipe) mealFoodId: number,
  ) {
    return this.mealsService.removeItem(req.user.userId, id, mealFoodId);
  }

  @Post("copy-previous")
  async copyPrevious(@Req() req: Request & { user: { userId: number } }, @Body() dto: CopyPreviousMealDto) {
    return this.mealsService.copyPrevious(req.user.userId, dto);
  }

  @Post(":id/image")
  async uploadMealImage() {
    throw new BadRequestException({
      errorKey: "common.errors.badRequest",
      message: "Deprecated endpoint. Upload image to Firebase Storage from client, then send imageUrl via PUT /api/Meal/:id.",
    });
  }
}
