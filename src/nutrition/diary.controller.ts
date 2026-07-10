import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { UpdateDiaryNoteDto } from "./dto/update-diary-note.dto";
import { UpdateDiaryStatusDto } from "./dto/update-diary-status.dto";
import { DiaryService } from "./diary.service";
import { getRequestTzOffsetMinutes } from "../common/date/request-tz-offset";

@Controller("api/Diary")
@UseGuards(JwtAuthGuard)
export class DiaryController {
  constructor(private readonly diaryService: DiaryService) {}

  @Get("range")
  async range(
    @Req() req: Request & { user: { userId: number } },
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    const f = from?.trim() || new Date().toISOString().slice(0, 10);
    const t = to?.trim() || f;
    return this.diaryService.getRange(req.user.userId, f, t, getRequestTzOffsetMinutes(req));
  }

  @Post("status")
  async status(
    @Req() req: Request & { user: { userId: number } },
    @Body() body: UpdateDiaryStatusDto,
  ) {
    await this.diaryService.setCompleted(req.user.userId, body.date, body.isCompleted);
    return { ok: true };
  }

  @Put("note")
  async note(
    @Req() req: Request & { user: { userId: number } },
    @Body() body: UpdateDiaryNoteDto,
  ) {
    await this.diaryService.setNote(req.user.userId, body.date, body.note ?? null);
    return { ok: true };
  }

  @Get(":date")
  async byDate(
    @Req() req: Request & { user: { userId: number } },
    @Param("date") dateKey: string,
  ) {
    return this.diaryService.getDay(req.user.userId, dateKey, getRequestTzOffsetMinutes(req));
  }
}
