import type { INestApplication } from "@nestjs/common";
import { ApiProperty, DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import type { ApiPropertyOptions } from "@nestjs/swagger";
import type { MetadataStorage as TransformerMetadataStorage } from "class-transformer/types/MetadataStorage";
import { getMetadataStorage } from "class-validator";
import { targetConstructorToSchema } from "class-validator-jsonschema";

// class-transformer ships no typings for this entry point; @Type() metadata lives here.
const { defaultMetadataStorage } = require("class-transformer/cjs/storage") as {
  defaultMetadataStorage: TransformerMetadataStorage;
};

export const SWAGGER_PATH = "docs";

const REF_PREFIX = "#/components/schemas/";
// DECORATORS.API_MODEL_PROPERTIES; @nestjs/swagger's exports map hides dist/constants.
const API_MODEL_PROPERTIES = "swagger/apiModelProperties";

/** SWAGGER_ENABLED wins when set; otherwise docs are on everywhere except production. */
export function isSwaggerEnabled(flag: string | undefined, nodeEnv: string | undefined): boolean {
  const value = flag?.trim().toLowerCase();
  if (value) return value === "true" || value === "1";
  return nodeEnv !== "production";
}

/** Every class class-validator knows about, i.e. every DTO the ValidationPipe checks. */
function validatedClasses(): Function[] {
  const storage = getMetadataStorage() as unknown as { validationMetadatas: Map<Function, unknown[]> };
  return [...storage.validationMetadatas.keys()].filter((target) => typeof target === "function");
}

function nestedDtoClass(target: Function, propertyName: string, dtoClasses: Set<Function>): Function | undefined {
  const typeMeta = defaultMetadataStorage.findTypeMetadata(target, propertyName);
  const nested = typeMeta?.typeFunction?.();
  return typeof nested === "function" && dtoClasses.has(nested) ? nested : undefined;
}

/**
 * The DTOs carry class-validator decorators but no @ApiProperty, so Swagger would
 * show empty bodies and no query params. Derive @ApiProperty from the validators
 * instead of annotating 60+ DTOs by hand. Properties that already have an
 * explicit @ApiProperty are left alone.
 */
export function applyValidatorApiProperties(): void {
  const classes = validatedClasses();
  const dtoClasses = new Set(classes);

  for (const target of classes) {
    const schema = targetConstructorToSchema(target, {
      classTransformerMetadataStorage: defaultMetadataStorage,
      refPointerPrefix: REF_PREFIX,
      // The default is a pattern demanding fractional seconds, which @IsDateString does not.
      additionalConverters: { isDateString: { type: "string", format: "date-time" } }
    });
    const required = new Set<string>(schema.required ?? []);

    for (const [propertyName, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (Reflect.hasOwnMetadata(API_MODEL_PROPERTIES,target.prototype, propertyName)) continue;

      const { $ref: _ref, items: _items, ...rest } = propertySchema as Record<string, any>;
      const nested = nestedDtoClass(target, propertyName, dtoClasses);
      const isArray = rest.type === "array";
      const options: ApiPropertyOptions = nested
        ? { type: () => nested, isArray }
        : isArray
          ? { ...rest, type: _items?.type ?? "string", isArray: true, ...(_items?.enum ? { enum: _items.enum } : {}) }
          : rest;

      ApiProperty({ ...options, required: required.has(propertyName) } as ApiPropertyOptions)(target.prototype, propertyName);
    }
  }
}

export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  applyValidatorApiProperties();

  const config = new DocumentBuilder()
    .setTitle("Nutrition Coach API")
    .setDescription("Đăng nhập qua POST /auth/login (hoặc /admin/auth/login), dán accessToken vào nút Authorize.")
    .setVersion("1.0")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "bearer")
    .addSecurityRequirements("bearer")
    .build();

  return SwaggerModule.createDocument(app, config);
}

/** Serves Swagger UI at /docs and the raw spec at /docs-json. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(SWAGGER_PATH, app, () => buildSwaggerDocument(app), {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: "alpha",
      docExpansion: "none",
      filter: true
    }
  });
}
