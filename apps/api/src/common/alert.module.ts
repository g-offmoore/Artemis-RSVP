import { Module } from "@nestjs/common";
import { AlertService } from "./alert.service.js";

@Module({
  providers: [AlertService],
  exports: [AlertService]
})
export class AlertModule {}
