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
import { DiscordRoleService } from "./discord-role.service.js";
import { EventsService } from "./events.service.js";
import { MessageJobsService } from "./message-jobs.service.js";

@Controller("api/v1/events")
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly discordPosts: DiscordEventPostService,
    private readonly messageJobs: MessageJobsService,
    private readonly discordRole: DiscordRoleService,
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

  // Lock final assignments. Converts projected → confirmed statuses.
  @Post(":id/assignments/lock")
  lockAssignments(@Param("id") id: string, @Body() body: unknown) {
    return this.events.lockAssignments(id, body);
  }

  // Handle backup DM lifecycle: pull, release, or decline.
  @Post(":id/backup-dm/action")
  backupDmAction(@Param("id") id: string, @Body() body: unknown) {
    return this.events.handleBackupDmAction(id, body);
  }

  // Server-side eligibility check before showing signup options.
  @Post(":id/eligibility/check")
  checkEligibility(@Param("id") id: string, @Body() body: unknown) {
    return this.events.checkSignupEligibility(id, body);
  }

  // Upsert a role eligibility rule for an event.
  @Post(":id/eligibility/rules")
  upsertEligibilityRule(@Param("id") id: string, @Body() body: unknown) {
    return this.events.upsertEligibilityRule(id, body);
  }

  // List message jobs for an event (admin-visible scheduled message state).
  @Get(":id/message-jobs")
  listMessageJobs(@Param("id") id: string) {
    return this.messageJobs.listForEvent(id);
  }

  // ─── Event role ───────────────────────────────────────────────────────────

  // Retry Discord role creation after a failure (manual remediation, §12.6).
  @Post(":id/roles/retry")
  retryEventRole(@Param("id") id: string) {
    return this.discordRole.retryEventRole(id);
  }

  // ─── Backup DM candidates ─────────────────────────────────────────────────

  @Get(":id/backup-dm/candidates")
  listBackupDmCandidates(@Param("id") id: string) {
    return this.events.listBackupDmCandidates(id);
  }

  // ─── Seating groups ───────────────────────────────────────────────────────

  // Create a seating group; creator is auto-added as ACCEPTED member.
  @Post(":id/seating-groups")
  createSeatingGroup(
    @Param("id") id: string,
    @Body() body: { userId: string; splitPolicy?: "DO_NOT_SPLIT" | "SPLIT_IF_NEEDED" | "ORGANIZER_DECIDES" },
  ) {
    return this.events.createSeatingGroup(id, body.userId, body.splitPolicy);
  }

  // Join a seating group by group ID.
  @Post(":id/seating-groups/:groupId/join")
  joinSeatingGroup(
    @Param("id") _id: string,
    @Param("groupId") groupId: string,
    @Body() body: { userId: string },
  ) {
    return this.events.joinSeatingGroup(groupId, body.userId);
  }

  // Leave a seating group (marks member DECLINED).
  @Post(":id/seating-groups/:groupId/leave")
  leaveSeatingGroup(
    @Param("id") _id: string,
    @Param("groupId") groupId: string,
    @Body() body: { userId: string },
  ) {
    return this.events.leaveSeatingGroup(groupId, body.userId);
  }

  // Update the split policy on a seating group (creator only).
  @Patch(":id/seating-groups/:groupId/policy")
  updateSeatingGroupPolicy(
    @Param("id") _id: string,
    @Param("groupId") groupId: string,
    @Body() body: { userId: string; splitPolicy: "DO_NOT_SPLIT" | "SPLIT_IF_NEEDED" | "ORGANIZER_DECIDES" },
  ) {
    return this.events.updateSeatingGroupPolicy(groupId, body.userId, body.splitPolicy);
  }

  // Get the caller's seating group for an event (null if not in one).
  @Get(":id/seating-groups/mine")
  getMySeatingGroup(
    @Param("id") id: string,
    @Query("userId") userId: string,
  ) {
    return this.events.getMySeatingGroup(id, userId);
  }

  // Admin: list all seating groups for an event.
  @Get(":id/seating-groups")
  listSeatingGroups(@Param("id") id: string) {
    return this.events.listSeatingGroups(id);
  }

  // ─── Signup preferences ───────────────────────────────────────────────────

  // Upsert a signup preference (avoid player, avoid DM, prefer DM, etc.).
  @Post(":id/preferences")
  upsertPreference(
    @Param("id") id: string,
    @Body() body: unknown & { userId?: string },
  ) {
    const userId =
      body !== null && typeof body === "object" && "userId" in body
        ? String((body as { userId: unknown }).userId)
        : "";
    return this.events.upsertPreference(id, userId, body);
  }

  // Delete a preference by ID (only the owning user may delete).
  @Delete(":id/preferences/:prefId")
  deletePreference(
    @Param("id") _id: string,
    @Param("prefId") prefId: string,
    @Body() body: { userId: string },
  ) {
    return this.events.deletePreference(prefId, body.userId);
  }

  // Return the caller's own preferences — no other users' data is exposed.
  @Get(":id/preferences/mine")
  listMyPreferences(
    @Param("id") id: string,
    @Query("userId") userId: string,
  ) {
    return this.events.listMyPreferences(id, userId);
  }

  // Admin: list all preferences for an event (includes sensitive avoid data).
  @Get(":id/preferences")
  listAllPreferences(@Param("id") id: string) {
    return this.events.listAllPreferences(id);
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
