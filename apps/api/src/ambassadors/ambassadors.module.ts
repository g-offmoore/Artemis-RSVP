import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AmbassadorsController } from "./ambassadors.controller.js";
import { AmbassadorsService } from "./ambassadors.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [AmbassadorsController],
  providers: [AmbassadorsService],
})
export class AmbassadorsModule {}
