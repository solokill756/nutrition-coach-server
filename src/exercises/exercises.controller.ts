import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ExercisesService } from "./exercises.service";
import { GetExercisesQueryDto } from "./dto/get-exercises-query.dto";
import { CreateExerciseDto } from "./dto/create-exercise.dto";
import { UpdateExerciseDto } from "./dto/update-exercise.dto";

@Controller("api/exercises")
@UseGuards(JwtAuthGuard)
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  async list(
    @Req() req: Request & { user: { userId: number } },
    @Query() query: GetExercisesQueryDto,
  ) {
    return this.exercisesService.list(req.user.userId, query);
  }

  @Post()
  async create(
    @Req() req: Request & { user: { userId: number } },
    @Body() body: CreateExerciseDto,
  ) {
    return this.exercisesService.create(req.user.userId, body);
  }

  @Get(":id")
  async getById(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.exercisesService.getById(req.user.userId, id);
  }

  @Patch(":id")
  async update(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateExerciseDto,
  ) {
    return this.exercisesService.update(req.user.userId, id, body);
  }

  @Delete(":id")
  async remove(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.exercisesService.softDelete(req.user.userId, id);
  }
}
