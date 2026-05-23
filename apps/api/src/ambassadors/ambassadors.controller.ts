import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AmbassadorsService } from "./ambassadors.service.js";

@Controller("api/v1/ambassadors")
export class AmbassadorsController {
  constructor(private readonly ambassadors: AmbassadorsService) {}

  @Get()
  list(@Query("guildId") guildId: string) {
    return this.ambassadors.list(guildId);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.ambassadors.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.ambassadors.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.ambassadors.update(id, body);
  }

  @Delete(":id")
  deregister(@Param("id") id: string) {
    return this.ambassadors.deregister(id);
  }
}
