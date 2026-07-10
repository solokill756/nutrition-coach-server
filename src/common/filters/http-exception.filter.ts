import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Request, Response } from "express";

type ErrorBody = {
  statusCode: number;
  errorKey: string;
  message: string;
  timestamp: string;
  path: string;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception instanceof HttpException
      ? exception.getResponse()
      : undefined;

    let message = this.defaultMessageForStatus(status);
    let errorKey = this.defaultKeyForStatus(status);

    if (status >= 500) {
      this.logServerError(exception, request);
    } else if (typeof exceptionResponse === "string") {
      message = exceptionResponse;
    }

    if (status < 500 && exceptionResponse && typeof exceptionResponse === "object") {
      const payload = exceptionResponse as Record<string, unknown>;

      if (typeof payload.message === "string") {
        message = payload.message;
      }

      if (Array.isArray(payload.message)) {
        message = "Please check your input";
        errorKey = "validation.failed";
      }

      if (typeof payload.errorKey === "string" && payload.errorKey.trim().length > 0) {
        errorKey = payload.errorKey;
      }
    }

    const body: ErrorBody = {
      statusCode: status,
      errorKey,
      message,
      timestamp: new Date().toISOString(),
      path: request.url
    };

    response.status(status).json(body);
  }

  private logServerError(exception: unknown, request: Request): void {
    const message = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error(
      `HTTP ${request.method} ${request.url} failed: ${message}`,
      stack
    );
  }

  private defaultMessageForStatus(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) return "Bad Request";
    if (status === HttpStatus.UNAUTHORIZED) return "Unauthorized";
    if (status === HttpStatus.FORBIDDEN) return "Forbidden";
    if (status === HttpStatus.NOT_FOUND) return "Not Found";
    if (status === HttpStatus.CONFLICT) return "Conflict";
    if (status === HttpStatus.UNPROCESSABLE_ENTITY) return "Unprocessable Entity";
    if (status === HttpStatus.TOO_MANY_REQUESTS) return "Too Many Requests";
    if (status >= 500) return "Internal Server Error";
    return "Request failed";
  }

  private defaultKeyForStatus(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) return "common.errors.badRequest";
    if (status === HttpStatus.UNAUTHORIZED) return "common.errors.unauthorized";
    if (status === HttpStatus.FORBIDDEN) return "common.errors.forbidden";
    if (status === HttpStatus.NOT_FOUND) return "common.errors.notFound";
    if (status === HttpStatus.CONFLICT) return "common.errors.conflict";
    if (status === HttpStatus.UNPROCESSABLE_ENTITY) return "common.errors.unprocessableEntity";
    if (status === HttpStatus.TOO_MANY_REQUESTS) return "common.errors.tooManyRequests";
    if (status >= 500) return "common.errors.internalServerError";
    return "common.errors.requestFailed";
  }
}
