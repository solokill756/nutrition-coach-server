import { GUARDS_METADATA, MODULE_METADATA } from "@nestjs/common/constants";
import { AdminModule } from "../admin/admin.module";
import { AdminJwtAuthGuard } from "../admin/auth/guards/admin-jwt-auth.guard";
import { AdminRoleGuard } from "../admin/auth/guards/admin-role.guard";
import { RagEvaluateController } from "./rag-evaluate.controller";
import { RetrievalModule } from "./retrieval.module";

describe("RAG evaluation authorization", () => {
  it("registers the endpoint once, with authentication and active-admin guards in order", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RagEvaluateController)).toEqual([
      AdminJwtAuthGuard, AdminRoleGuard,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AdminModule)).toContain(RagEvaluateController);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, RetrievalModule) ?? []).not.toContain(RagEvaluateController);
  });
});
