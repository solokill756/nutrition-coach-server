import "reflect-metadata";
import { Body, Controller, Get, INestApplication, Module, Post, Query } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { OpenAPIObject } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";
import { buildSwaggerDocument, isSwaggerEnabled } from "./swagger";

class SwaggerSpecItemDto {
  @IsInt()
  @Min(1)
  foodId!: number;
}

class SwaggerSpecCreateDto {
  @IsString()
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsIn(["breakfast", "lunch"])
  mealType?: string;

  @IsOptional()
  @IsDateString()
  loggedAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SwaggerSpecItemDto)
  items!: SwaggerSpecItemDto[];
}

class SwaggerSpecListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsString()
  search!: string;
}

@Controller("swagger-spec/meals")
class SwaggerSpecController {
  @Post()
  create(@Body() body: SwaggerSpecCreateDto) {
    return body;
  }

  @Get()
  list(@Query() query: SwaggerSpecListQueryDto) {
    return query;
  }
}

@Controller("admin/swagger-spec")
class SwaggerSpecAdminController {
  @Get(":id")
  get() {
    return {};
  }
}

@Module({ controllers: [SwaggerSpecController, SwaggerSpecAdminController] })
class SwaggerSpecModule { }

describe("isSwaggerEnabled", () => {
  it("is on by default outside production", () => {
    expect(isSwaggerEnabled(undefined, undefined)).toBe(true);
    expect(isSwaggerEnabled("", "development")).toBe(true);
  });

  it("is off by default in production", () => {
    expect(isSwaggerEnabled(undefined, "production")).toBe(false);
  });

  it("follows an explicit SWAGGER_ENABLED", () => {
    expect(isSwaggerEnabled("true", "production")).toBe(true);
    expect(isSwaggerEnabled("false", "development")).toBe(false);
  });
});

describe("buildSwaggerDocument", () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    app = await NestFactory.create(SwaggerSpecModule, { logger: false });
    document = buildSwaggerDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("describes a body DTO from its class-validator decorators", () => {
    const schema = document.components?.schemas?.SwaggerSpecCreateDto as any;

    expect(schema.required).toEqual(expect.arrayContaining(["name", "items"]));
    expect(schema.required).not.toContain("mealType");
    expect(schema.properties.name).toMatchObject({ type: "string", maxLength: 50 });
    expect(schema.properties.mealType).toMatchObject({ enum: ["breakfast", "lunch"] });
    expect(schema.properties.loggedAt).toEqual({ type: "string", format: "date-time" });
    expect(schema.properties.items).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/SwaggerSpecItemDto" }
    });

    const item = document.components?.schemas?.SwaggerSpecItemDto as any;
    expect(item.properties.foodId).toMatchObject({ type: "integer", minimum: 1 });
    expect(item.required).toEqual(["foodId"]);
  });

  it("flattens a query DTO into query parameters", () => {
    const params = (document.paths["/swagger-spec/meals"].get?.parameters ?? []) as any[];

    expect(params).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "page", in: "query", required: false }),
      expect.objectContaining({ name: "search", in: "query", required: true })
    ]));
  });

  it("groups operations by controller", () => {
    expect(document.paths["/swagger-spec/meals"].post?.tags).toEqual(["SwaggerSpec"]);
    expect(document.paths["/admin/swagger-spec/{id}"].get?.tags).toEqual(["SwaggerSpecAdmin"]);
  });

  it("can be built twice without duplicating properties", () => {
    const again = buildSwaggerDocument(app);
    const params = (again.paths["/swagger-spec/meals"].get?.parameters ?? []) as any[];

    expect(params.filter((param) => param.name === "page")).toHaveLength(1);
    expect(again.components?.schemas?.SwaggerSpecCreateDto).toEqual(document.components?.schemas?.SwaggerSpecCreateDto);
  });

  it("offers bearer auth for every operation", () => {
    expect(document.components?.securitySchemes?.bearer).toMatchObject({ type: "http", scheme: "bearer" });
    expect(document.security).toEqual([{ bearer: [] }]);
  });
});
