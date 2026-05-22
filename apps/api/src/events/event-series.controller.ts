import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { EventSeriesService } from "./event-series.service.js";

@Controller("api/v1/series")
export class EventSeriesController {
  constructor(private readonly series: EventSeriesService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.series.create(body);
  }

  @Get()
  list(@Query("guildId") guildId: string) {
    return this.series.list(guildId);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.series.get(id);
  }

  @Post(":id/generate")
  generate(@Param("id") id: string, @Body() body: unknown) {
    return this.series.generate(id, body);
  }
}
