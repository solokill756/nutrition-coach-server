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

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);
  console.log(`Nutrition coach server running on http://localhost:${port}`);
}

bootstrap().catch((error) => {
  console.error("Server bootstrap failed:", error);
  process.exit(1);
});
