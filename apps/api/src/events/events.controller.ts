import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { DiscordEventPostService } from "./discord-event-post.service.js";
import { EventsService } from "./events.service.js";

@Controller("api/v1/events")
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly discordPosts: DiscordEventPostService,
  ) {}

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

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const event = await this.events.update(id, body);
    if (event.messageId) {
      const actorDiscordId =
        body !== null &&
        typeof body === "object" &&
        "actorDiscordId" in body &&
        typeof (body as { actorDiscordId: unknown }).actorDiscordId === "string"
          ? (body as { actorDiscordId: string }).actorDiscordId
          : "system";
      try {
        await this.discordPosts.publishEventPost(id, actorDiscordId);
      } catch {
        // Discord sync is non-fatal; failure is recorded in the audit log
      }
    }
    return event;
  }

  @Delete(":id")
  async cancel(
    @Param("id") id: string,
    @Body() body: { actorDiscordId?: string },
  ) {
    const actorDiscordId = body.actorDiscordId ?? "system";
    const event = await this.events.cancel(id, actorDiscordId);
    if (event.messageId) {
      try {
        await this.discordPosts.publishEventPost(id, actorDiscordId);
      } catch {
        // Discord sync is non-fatal; failure is recorded in the audit log
      }
    }
    return event;
  }

  @Post(":id/rsvps")
  rsvp(@Param("id") id: string, @Body() body: unknown) {
    return this.events.rsvp(id, body);
  }

  @Patch(":id/rsvps/:discordUserId/guests")
  updateGuests(
    @Param("id") id: string,
    @Param("discordUserId") discordUserId: string,
    @Body() body: unknown,
  ) {
    return this.events.updateGuests(id, discordUserId, body);
  }

  @Delete(":id/rsvps/:discordUserId")
  cancelRsvp(
    @Param("id") id: string,
    @Param("discordUserId") discordUserId: string,
  ) {
    return this.events.cancelRsvp(id, discordUserId);
  }

  @Post(":id/tables")
  createTable(@Param("id") id: string, @Body() body: unknown) {
    return this.events.createTable(id, body);
  }

  @Post(":id/assignments/run")
  runAssignments(
    @Param("id") id: string,
    @Body() body: { actorDiscordId?: string } = {},
  ) {
    return this.events.runAssignments(id, body.actorDiscordId ?? "system");
  }

  @Post(":id/publish")
  publishEvent(
    @Param("id") id: string,
    @Body() body: { actorDiscordId?: string } = {},
  ) {
    return this.discordPosts.publishEventPost(
      id,
      body.actorDiscordId ?? "system",
    );
  }

  @Post(":id/discord-post")
  publishDiscordPost(
    @Param("id") id: string,
    @Body() body: { actorDiscordId?: string } = {},
  ) {
    return this.discordPosts.publishEventPost(
      id,
      body.actorDiscordId ?? "system",
    );
  }

  @Post(":id/attendance")
  confirmAttendance(@Param("id") id: string, @Body() body: unknown) {
    return this.events.confirmAttendance(id, body);
  }
}
