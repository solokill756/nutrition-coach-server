import { Global, Module } from "@nestjs/common";
import { DashboardEventBus } from "./dashboard-event-bus";

@Global()
@Module({
  providers: [DashboardEventBus],
  exports: [DashboardEventBus],
})
export class DashboardEventsModule {}
