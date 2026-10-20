import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpStatus,
  Param,
  PayloadTooLargeException,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { AdminAuthExceptionFilter } from "../auth/admin-auth-exception.filter";
import { AdminJwtAuthGuard, AdminJwtUser } from "../auth/guards/admin-jwt-auth.guard";
import { AdminRoleGuard } from "../auth/guards/admin-role.guard";
import { AdminRagException } from "./admin-rag-documents.exception";
import { AdminRagDocumentsService, UploadedPdf } from "./admin-rag-documents.service";
import { CreateRagUrlRequestDto } from "./dto/create-rag-url-request.dto";
import { RagChunkListQueryDto } from "./dto/rag-chunk-list-query.dto";
import { RagDocumentListQueryDto } from "./dto/rag-document-list-query.dto";
import { UpdateRagChunkRequestDto } from "./dto/update-rag-chunk-request.dto";
import { UpdateRagDocumentRequestDto } from "./dto/update-rag-document-request.dto";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** defParamCharset utf8: browsers send multipart filenames as raw UTF-8; multer defaults to latin1 (mojibake). */
export const RAG_UPLOAD_OPTIONS = { limits: { fileSize: MAX_UPLOAD_BYTES }, defParamCharset: "utf8" };

type AdminRequest = { user: AdminJwtUser };

/** Multer's LIMIT_FILE_SIZE surfaces as PayloadTooLargeException; render it in the admin error envelope. */
@Catch(PayloadTooLargeException)
export class RagUploadTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const tooLarge = new AdminRagException("RAG_FILE_TOO_LARGE", HttpStatus.PAYLOAD_TOO_LARGE);
    host.switchToHttp().getResponse<Response>().status(tooLarge.getStatus()).json(tooLarge.getResponse());
  }
}

@Controller("admin/rag")
@UseFilters(AdminAuthExceptionFilter)
@UseGuards(AdminJwtAuthGuard, AdminRoleGuard)
export class AdminRagDocumentsController {
  constructor(private readonly service: AdminRagDocumentsService) {}

  @Post("documents/url")
  async addUrl(@Req() req: AdminRequest, @Body() body: CreateRagUrlRequestDto) {
    return this.service.addUrl(body.url, req.user.userId);
  }

  @Post("documents/upload")
  @UseFilters(RagUploadTooLargeFilter)
  @UseInterceptors(FileInterceptor("file", RAG_UPLOAD_OPTIONS))
  async upload(@Req() req: AdminRequest, @UploadedFile() file: UploadedPdf | undefined) {
    return this.service.uploadPdf(file, req.user.userId);
  }

  @Get("documents")
  async list(@Query() query: RagDocumentListQueryDto) {
    return this.service.listDocuments(query);
  }

  @Get("documents/:id")
  async detail(@Param("id") id: string) {
    return this.service.getDocument(id);
  }

  @Patch("documents/:id")
  async rename(@Param("id") id: string, @Body() body: UpdateRagDocumentRequestDto) {
    return this.service.renameDocument(id, body.title);
  }

  @Post("documents/:id/reingest")
  async reingest(@Param("id") id: string) {
    return this.service.reingest(id);
  }

  @Delete("documents/:id")
  async remove(@Param("id") id: string) {
    return this.service.deleteDocument(id);
  }

  @Get("documents/:id/chunks")
  async chunks(@Param("id") id: string, @Query() query: RagChunkListQueryDto) {
    return this.service.listChunks(id, query);
  }

  @Patch("chunks/:id")
  async updateChunk(@Param("id") id: string, @Body() body: UpdateRagChunkRequestDto) {
    return this.service.updateChunk(id, body);
  }

  @Post("chunks/:id/retag")
  async retag(@Param("id") id: string) {
    return this.service.retag(id);
  }

  @Post("chunks/:id/resolve-review")
  async resolveReview(@Param("id") id: string) {
    return this.service.resolveReview(id);
  }

  @Get("chunks/:id/image")
  async image(@Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, contentType } = await this.service.getChunkImage(id);
    res.setHeader("Content-Type", contentType);
    return new StreamableFile(buffer);
  }

  @Get("taxonomy")
  taxonomy() {
    return this.service.getTaxonomy();
  }
}
