import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { EventsService } from "./events.service.js";

@Controller("api/v1/events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@Query("guildId") guildId: string) {
    return this.events.list(guildId);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.events.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.events.create(body);
  }

  @Delete(":id")
  cancel(@Param("id") id: string, @Body() body: { actorDiscordId?: string }) {
    return this.events.cancel(id, body.actorDiscordId ?? "system");
  }

  @Post(":id/rsvps")
  rsvp(@Param("id") id: string, @Body() body: unknown) {
    return this.events.rsvp(id, body);
  }

  @Patch(":id/rsvps/:discordUserId/guests")
  updateGuests(@Param("id") id: string, @Param("discordUserId") discordUserId: string, @Body() body: unknown) {
    return this.events.updateGuests(id, discordUserId, body);
  }

  @Delete(":id/rsvps/:discordUserId")
  cancelRsvp(@Param("id") id: string, @Param("discordUserId") discordUserId: string) {
    return this.events.cancelRsvp(id, discordUserId);
  }

  @Post(":id/tables")
  createTable(@Param("id") id: string, @Body() body: unknown) {
    return this.events.createTable(id, body);
  }

  @Post(":id/assignments/run")
  runAssignments(@Param("id") id: string, @Body() body: { actorDiscordId?: string } = {}) {
    return this.events.runAssignments(id, body.actorDiscordId ?? "system");
  }

  @Post(":id/attendance")
  confirmAttendance(@Param("id") id: string, @Body() body: unknown) {
    return this.events.confirmAttendance(id, body);
  }
}
