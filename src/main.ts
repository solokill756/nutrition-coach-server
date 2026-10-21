import "reflect-metadata";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { join } from "path";
import { AppModule } from "./app.module";
import { buildCorsOptions } from "./common/http/cors-options";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { isSwaggerEnabled, setupSwagger, SWAGGER_PATH } from "./common/swagger/swagger";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(cookieParser());
  app.enableCors(buildCorsOptions(app.get(ConfigService).get<string>("CORS_ORIGINS")));
  app.useStaticAssets(join(process.cwd(), "var", "uploads", "weight"), { prefix: "/files/weight/" });
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: () => new BadRequestException({
        errorKey: "validation.failed",
        message: "Please check your input"
      })
    })
  );

  const swaggerEnabled = isSwaggerEnabled(process.env.SWAGGER_ENABLED, process.env.NODE_ENV);
  if (swaggerEnabled) setupSwagger(app);

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);
  console.log(`Nutrition coach server running on http://localhost:${port}`);
  if (swaggerEnabled) console.log(`Swagger UI: http://localhost:${port}/${SWAGGER_PATH}`);
}

bootstrap().catch((error) => {
  console.error("Server bootstrap failed:", error);
  process.exit(1);
});
