import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";

type AdminErrorEnvelope = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

@Catch(HttpException)
export class AdminAuthExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    response.status(status).json(this.toEnvelope(exceptionResponse, status, request.path));
  }

  private toEnvelope(
    exceptionResponse: string | object,
    status: number,
    path: string,
  ): AdminErrorEnvelope {
    if (typeof exceptionResponse === "object" && exceptionResponse !== null) {
      const payload = exceptionResponse as {
        success?: unknown;
        error?: { code?: unknown; message?: unknown };
        message?: unknown;
      };

      if (
        payload.success === false &&
        payload.error &&
        typeof payload.error.code === "string" &&
        typeof payload.error.message === "string"
      ) {
        return {
          success: false,
          error: {
            code: payload.error.code,
            message: payload.error.message,
          },
        };
      }

      if (Array.isArray(payload.message)) {
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Please check your input",
          },
        };
      }
    }

    return {
      success: false,
      error: {
        code: this.defaultCode(status),
        message: this.defaultMessage(status, path),
      },
    };
  }

  private defaultCode(status: number): string {
    if (status === HttpStatus.UNAUTHORIZED) return "UNAUTHORIZED";
    if (status === HttpStatus.FORBIDDEN) return "ADMIN_ONLY";
    if (status === HttpStatus.BAD_REQUEST) return "VALIDATION_ERROR";
    return "UNKNOWN_ERROR";
  }

  private defaultMessage(status: number, path: string): string {
    if (status === HttpStatus.UNAUTHORIZED) return "Unauthorized";
    if (status === HttpStatus.FORBIDDEN) return "Admin permission required";
    if (status === HttpStatus.BAD_REQUEST) return "Please check your input";
    return `Request failed for ${path}`;
  }
}
