import { ArgumentsHost, BadRequestException, HttpStatus, InternalServerErrorException } from "@nestjs/common";
import { Request, Response } from "express";
import { HttpExceptionFilter } from "./http-exception.filter";

describe("HttpExceptionFilter", () => {
  let filter: HttpExceptionFilter;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    statusMock = jest.fn().mockReturnThis();
    jsonMock = jest.fn();
    jest.spyOn(filter["logger"], "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns user-facing errorKey and message from a safe 4xx payload", () => {
    filter.catch(
      new BadRequestException({
        errorKey: "auth.errors.invalidCredentials",
        message: "Invalid credentials"
      }),
      createHost()
    );

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: HttpStatus.BAD_REQUEST,
      errorKey: "auth.errors.invalidCredentials",
      message: "Invalid credentials",
      path: "/auth/login"
    }));
    expect(jsonMock.mock.calls[0][0]).not.toHaveProperty("details");
  });

  it("sanitizes validation arrays into a generic input message", () => {
    filter.catch(
      new BadRequestException({
        message: ["email must be an email", "password should not be empty"],
        error: "Bad Request",
        statusCode: HttpStatus.BAD_REQUEST
      }),
      createHost()
    );

    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: HttpStatus.BAD_REQUEST,
      errorKey: "validation.failed",
      message: "Please check your input"
    }));
    expect(jsonMock.mock.calls[0][0]).not.toHaveProperty("details");
  });

  it("does not expose details from 5xx HttpExceptions", () => {
    filter.catch(
      new InternalServerErrorException("database failed: relation users does not exist"),
      createHost()
    );

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorKey: "common.errors.internalServerError",
      message: "Internal Server Error"
    }));
    expect(JSON.stringify(jsonMock.mock.calls[0][0])).not.toContain("database failed");
  });

  it("turns unknown errors into a generic 500 response", () => {
    filter.catch(new Error("SQL/provider/raw error"), createHost());

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorKey: "common.errors.internalServerError",
      message: "Internal Server Error"
    }));
    expect(JSON.stringify(jsonMock.mock.calls[0][0])).not.toContain("SQL/provider/raw error");
  });

  function createHost(): ArgumentsHost {
    const response = {
      status: statusMock,
      json: jsonMock
    } as unknown as Response;
    const request = {
      method: "POST",
      url: "/auth/login"
    } as Request;

    return {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request
      })
    } as ArgumentsHost;
  }
});
