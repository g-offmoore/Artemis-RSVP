import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTokenGuard } from "../common/api-token.guard.js";
import { CampaignsService } from "./campaigns.service.js";

@Controller("api/v1/campaigns")
@UseGuards(ApiTokenGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@Query("guildId") guildId: string) {
    return this.campaigns.list(guildId);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.campaigns.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.campaigns.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.campaigns.update(id, body);
  }
}
