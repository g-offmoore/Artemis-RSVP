import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  assignParticipantsToTables,
  checkEligibility,
  eligibilityRuleSchema,
  eventCreateSchema,
  eventUpdateSchema,
  guestUpdateSchema,
  rsvpCreateSchema,
  tableCreateSchema,
  type AssignmentResult,
  type EligibilityRuleInput,
  type SignupRole,
} from "@artemis/domain";
import { z } from "zod";
import { AlertService } from "../common/alert.service.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { MessageJobsService } from "./message-jobs.service.js";
import { DiscordRoleService } from "./discord-role.service.js";

const attendanceInputSchema = z.object({
  actorDiscordId: z.string().min(1),
  records: z.array(
    z.object({
      eventParticipantId: z.string().min(1),
      eventTableId: z.string().min(1).optional(),
      rsvpId: z.string().min(1).optional(),
      status: z.enum(["ATTENDED", "NO_SHOW", "WALK_IN", "EXCUSED", "UNKNOWN"]),
      notes: z.string().optional(),
    }),
  ),
});

const eligibilityCheckInputSchema = z.object({
  discordUserId: z.string().min(1),
  memberDiscordRoleIds: z.array(z.string().min(1)).default([]),
  signupRole: z.enum(["PLAYER", "TABLE_DM", "BACKUP_DM", "AMBASSADOR"]),
});

const lockAssignmentsInputSchema = z.object({
  actorDiscordId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

const backupDmPullInputSchema = z.object({
  actorDiscordId: z.string().min(1),
  participantId: z.string().min(1),
  action: z.enum(["pull", "release", "decline"]),
  reason: z.string().trim().max(500).optional(),
});

// ─── Shared type for preloaded event data used in assignment ────────────────

type EventForAssignment = Awaited<ReturnType<EventsService["loadEventForAssignment"]>>;

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertService,
    private readonly messageJobs: MessageJobsService,
    private readonly discordRole: DiscordRoleService,
  ) {}

  async list(guildId: string) {
    if (!guildId) throw new BadRequestException("guildId is required");

    const events = await this.prisma.client.event.findMany({
      where: {
        guildId,
        status: { notIn: ["CANCELLED", "ARCHIVED"] },
        endAt: { gte: new Date() },
      },
      orderBy: { startAt: "asc" },
      take: 50,
      include: {
        participants: { where: { assignmentEligible: true } },
        tables: { where: { status: { notIn: ["CANCELLED", "COMPLETED"] } } },
      },
    });

    return events.map(({ participants, tables, ...event }) => ({
      ...event,
      tables,
      _count: { participants: participants.length, tables: tables.length },
    }));
  }

  async get(id: string) {
    const event = await this.prisma.client.event.findUnique({
      where: { id },
      include: {
        eventType: true,
        tables: { include: { ambassadorProfile: true, assignments: true } },
        rsvps: { include: { participants: true } },
        participants: true,
        assignments: true,
        attendanceRecords: true,
        feedbackRequests: true,
        roles: true,
        messageJobs: { orderBy: { scheduledFor: "asc" } },
        eligibilityRules: true,
        seatingGroups: { include: { members: true } },
        auditLogs: { orderBy: { createdAt: "desc" }, take: 25 },
      },
    });

    if (!event) throw new NotFoundException("Event not found");
    return event;
  }

  async create(raw: unknown) {
    const input = eventCreateSchema.parse(raw);
    if (input.endAt <= input.startAt)
      throw new BadRequestException("endAt must be after startAt");
    if (input.startAt.getTime() < Date.now() - 60 * 60 * 1000) {
      throw new BadRequestException(
        "startAt must be in the future. Include the full event date and time.",
      );
    }
    if (input.signupClosesAt && input.signupClosesAt > input.startAt) {
      throw new BadRequestException("signupClosesAt must be before startAt");
    }
    if (
      input.signupOpensAt &&
      input.signupClosesAt &&
      input.signupOpensAt >= input.signupClosesAt
    ) {
      throw new BadRequestException(
        "signupOpensAt must be before signupClosesAt",
      );
    }

    const eventType = await this.ensureEventType(
      input.eventTypeKey,
      input.gameSystem,
    );
    const roleCleanupAt = new Date(
      input.endAt.getTime() + 14 * 24 * 60 * 60 * 1000,
    );

    const event = await this.prisma.client.event.create({
      data: {
        guildId: input.guildId,
        channelId: input.channelId,
        title: input.title,
        description: input.description,
        imageUrl: input.imageUrl,
        eventTypeId: eventType.id,
        gameSystem: input.gameSystem,
        startAt: input.startAt,
        endAt: input.endAt,
        signupOpensAt: input.signupOpensAt,
        signupClosesAt: input.signupClosesAt,
        roleCleanupAt,
        createdByDiscordId: input.createdByDiscordId,
        ...(input.seriesId ? { seriesId: input.seriesId } : {}),
        auditLogs: {
          create: {
            guildId: input.guildId,
            actorDiscordId: input.createdByDiscordId,
            action: "event.created",
            afterValue: input,
          },
        },
      },
      include: { eventType: true },
    });

    // Schedule pre/post event message jobs after creation.
    await this.messageJobs.scheduleEventMessages({
      id: event.id,
      channelId: event.channelId,
      startAt: event.startAt,
      endAt: event.endAt,
      createdByDiscordId: event.createdByDiscordId,
    });

    // §12.6: Create the temporary Discord player role at event creation, not publish.
    // ensureEventRole records a pending/failed state if Discord is unavailable and
    // sends a private DM to the organizer — never silently drops the failure.
    void this.discordRole.ensureEventRole({
      id: event.id,
      guildId: event.guildId,
      title: event.title,
      endAt: event.endAt,
      createdByDiscordId: event.createdByDiscordId,
    }).then((result) => {
      if (!result.ok) {
        // Role failure already logged and organizer notified inside ensureEventRole.
        this.logger.warn({ eventId: event.id, error: result.error }, "Event role creation failed at event.create");
      }
    });

    // §12.6: Create the private event thread (fire-and-forget; failures logged and organizer notified).
    void this.discordRole.ensureEventThread({
      id: event.id,
      guildId: event.guildId,
      channelId: event.channelId,
      title: event.title,
      createdByDiscordId: event.createdByDiscordId,
    }).then((result) => {
      if (!result.ok) {
        this.logger.warn({ eventId: event.id, error: result.error }, "Event thread creation failed at event.create");
      }
    });

    return event;
  }

  async update(id: string, raw: unknown) {
    const input = eventUpdateSchema.parse(raw);
    const existing = await this.prisma.client.event.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException("Event not found");

    const startAt = input.startAt ?? existing.startAt;
    const endAt = input.endAt ?? existing.endAt;
    if (endAt <= startAt)
      throw new BadRequestException("endAt must be after startAt");

    const updates: {
      title?: string;
      description?: string | null;
      imageUrl?: string | null;
      gameSystem?: string;
      startAt?: Date;
      endAt?: Date;
    } = {};
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined)
      updates.description = input.description;
    if (input.imageUrl !== undefined) updates.imageUrl = input.imageUrl;
    if (input.gameSystem !== undefined) updates.gameSystem = input.gameSystem;
    if (input.startAt !== undefined) updates.startAt = input.startAt;
    if (input.endAt !== undefined) updates.endAt = input.endAt;

    const event = await this.prisma.client.event.update({
      where: { id },
      data: {
        ...updates,
        auditLogs: {
          create: {
            guildId: existing.guildId,
            actorDiscordId: input.actorDiscordId,
            action: "event.updated",
            afterValue: updates,
          },
        },
      },
    });

    // Reschedule pending message jobs if time changed.
    if (input.startAt !== undefined || input.endAt !== undefined) {
      await this.messageJobs.rescheduleEventMessages({
        id: event.id,
        channelId: event.channelId,
        startAt: event.startAt,
        endAt: event.endAt,
        createdByDiscordId: existing.createdByDiscordId,
      });
    }

    // applyToFuture: propagate non-time updates to all future occurrences in the same series.
    if (input.applyToFuture && existing.seriesId) {
      const futureUpdates: { title?: string; description?: string | null; imageUrl?: string | null; gameSystem?: string } = {};
      if (input.title !== undefined) futureUpdates.title = input.title;
      if (input.description !== undefined) futureUpdates.description = input.description;
      if (input.imageUrl !== undefined) futureUpdates.imageUrl = input.imageUrl;
      if (input.gameSystem !== undefined) futureUpdates.gameSystem = input.gameSystem;

      if (Object.keys(futureUpdates).length > 0) {
        await this.prisma.client.event.updateMany({
          where: {
            seriesId: existing.seriesId,
            id: { not: id },
            startAt: { gte: existing.startAt },
            status: { not: "CANCELLED" },
          },
          data: futureUpdates,
        });
      }
    }

    return event;
  }

  async cancel(id: string, actorDiscordId: string) {
    const existing = await this.prisma.client.event.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException("Event not found");

    const event = await this.prisma.client.event.update({
      where: { id },
      data: {
        status: "CANCELLED",
        auditLogs: {
          create: {
            guildId: existing.guildId,
            actorDiscordId,
            action: "event.cancelled",
            reasonCode: "event_cancelled",
            beforeValue: { status: existing.status },
            afterValue: { status: "CANCELLED" },
          },
        },
      },
    });

    // Cancel all pending message jobs for the cancelled event.
    await this.messageJobs.cancelEventMessages(id);

    return event;
  }

  // ─── Eligibility ──────────────────────────────────────────────────────────

  async checkSignupEligibility(eventId: string, raw: unknown) {
    const input = eligibilityCheckInputSchema.parse(raw);
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      include: {
        eligibilityRules: {
          where: { signupRole: input.signupRole as SignupRole },
        },
      },
    });
    if (!event) throw new NotFoundException("Event not found");

    const rule = event.eligibilityRules[0] ?? null;
    return checkEligibility(rule, input.memberDiscordRoleIds);
  }

  async listEligibilityRules(eventId: string) {
    const event = await this.prisma.client.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    return this.prisma.client.eventEligibilityRule.findMany({
      where: { eventId },
      orderBy: { signupRole: "asc" },
    });
  }

  async upsertEligibilityRule(eventId: string, raw: unknown) {
    const input = eligibilityRuleSchema.parse({ ...((raw as object) ?? {}), eventId }) as EligibilityRuleInput;
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    const rule = await this.prisma.client.eventEligibilityRule.upsert({
      where: { eventId_signupRole: { eventId, signupRole: input.signupRole } },
      create: {
        eventId,
        signupRole: input.signupRole,
        allowedDiscordRoleIds: input.allowedDiscordRoleIds,
        requiredDiscordRoleIds: input.requiredDiscordRoleIds,
        deniedDiscordRoleIds: input.deniedDiscordRoleIds,
        requiresApproval: input.requiresApproval,
      },
      update: {
        allowedDiscordRoleIds: input.allowedDiscordRoleIds,
        requiredDiscordRoleIds: input.requiredDiscordRoleIds,
        deniedDiscordRoleIds: input.deniedDiscordRoleIds,
        requiresApproval: input.requiresApproval,
      },
    });

    await this.prisma.client.auditLog.create({
      data: {
        guildId: event.guildId,
        eventId,
        actorDiscordId: "system",
        action: "eligibility_rule.upserted",
        afterValue: input,
      },
    });

    return rule;
  }

  // ─── RSVP ─────────────────────────────────────────────────────────────────

  async rsvp(eventId: string, raw: unknown) {
    const input = rsvpCreateSchema.parse(raw);
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      include: {
        eventType: true,
        eligibilityRules: {
          where: { signupRole: input.signupRole },
        },
      },
    });
    if (!event) throw new NotFoundException("Event not found");

    // Server-side eligibility enforcement.
    const memberRoleIds =
      Array.isArray((raw as Record<string, unknown>)?.memberDiscordRoleIds)
        ? ((raw as Record<string, unknown>).memberDiscordRoleIds as string[])
        : [];
    const rule = event.eligibilityRules[0] ?? null;
    const eligibility = checkEligibility(rule, memberRoleIds);
    if (!eligibility.eligible) {
      throw new ForbiddenException(eligibility.reason);
    }

    const selectedCategory = usesDndCategories(event.gameSystem)
      ? input.selectedCategory
      : ("MIXED" as const);

    const result = await this.prisma.client.$transaction(async (tx) => {
      // Enforce RSVP role exclusivity (rules.md §4.1, §5.3, §7.2):
      // Active DM/GM and Player/BackupDM registrations are mutually exclusive.
      const existingRsvp = await tx.rSVP.findUnique({
        where: {
          eventId_primaryDiscordUserId: {
            eventId,
            primaryDiscordUserId: input.discordUserId,
          },
        },
      });
      if (existingRsvp && existingRsvp.status !== "CANCELLED") {
        const incomingIsPlayer = input.signupRole === "PLAYER" || input.signupRole === "BACKUP_DM";
        const existingIsDm = existingRsvp.signupRole === "TABLE_DM";
        const incomingIsDm = input.signupRole === "TABLE_DM";
        const existingIsPlayer = existingRsvp.signupRole === "PLAYER" || existingRsvp.signupRole === "BACKUP_DM";

        if (incomingIsPlayer && existingIsDm) {
          throw new ForbiddenException(
            "You are already registered as a DM for this event. A DM cannot also sign up as a player.",
          );
        }
        if (incomingIsDm && existingIsPlayer) {
          throw new ForbiddenException(
            "You are already registered as a player for this event. Use the change-role flow to switch to DM.",
          );
        }
      }

      const profile = await tx.playerProfile.upsert({
        where: {
          guildId_discordUserId: {
            guildId: event.guildId,
            discordUserId: input.discordUserId,
          },
        },
        create: {
          guildId: event.guildId,
          discordUserId: input.discordUserId,
          displayName: input.displayName,
          defaultCategory: selectedCategory,
        },
        update: {
          displayName: input.displayName,
          roleDetectedCategory: selectedCategory,
        },
      });

      const rsvp = await tx.rSVP.upsert({
        where: {
          eventId_primaryDiscordUserId: {
            eventId,
            primaryDiscordUserId: input.discordUserId,
          },
        },
        create: {
          eventId,
          primaryDiscordUserId: input.discordUserId,
          playerProfileId: profile.id,
          selectedCategory,
          signupRole: input.signupRole,
          partyKey: input.discordUserId,
          source: input.source,
        },
        update: {
          selectedCategory,
          signupRole: input.signupRole,
          status: "GOING",
        },
      });

      const backupDmStatus =
        input.signupRole === "BACKUP_DM"
          ? ("BACKUP_AVAILABLE_AS_PLAYER" as const)
          : undefined;

      const primary = await tx.eventParticipant.upsert({
        where: { id: `${eventId}:${input.discordUserId}:primary` },
        create: {
          id: `${eventId}:${input.discordUserId}:primary`,
          eventId,
          rsvpId: rsvp.id,
          playerProfileId: profile.id,
          participantType: "PRIMARY",
          signupRole: input.signupRole,
          backupDmStatus,
          discordUserId: input.discordUserId,
          displayName: input.displayName,
          playerCategory: selectedCategory,
          partyKey: input.discordUserId,
          createdByDiscordId: input.discordUserId,
        },
        update: {
          displayName: input.displayName,
          playerCategory: selectedCategory,
          signupRole: input.signupRole,
          backupDmStatus,
          confirmationStatus: "UNKNOWN",
        },
      });

      await tx.auditLog.create({
        data: {
          guildId: event.guildId,
          eventId,
          actorDiscordId: input.discordUserId,
          action: "rsvp.upserted",
          afterValue: {
            rsvpId: rsvp.id,
            participantId: primary.id,
            selectedCategory,
            signupRole: input.signupRole,
          },
        },
      });

      return tx.rSVP.findUnique({
        where: { id: rsvp.id },
        include: { participants: true },
      });
    });

    // §12.6: Fire-and-forget Discord role assignment and thread membership — RSVP always succeeds.
    void (async () => {
      const [eventRole, eventWithThread] = await Promise.all([
        this.prisma.client.eventRole.findUnique({
          where: { eventId_roleType: { eventId, roleType: "PLAYER" } },
        }),
        this.prisma.client.event.findUnique({
          where: { id: eventId },
          select: { discordThreadId: true },
        }),
      ]);
      if (eventRole && eventRole.discordRoleId && !eventRole.deletedAt) {
        await this.discordRole.assignRoleToMember(event.guildId, input.discordUserId, eventRole.discordRoleId);
      }
      if (eventWithThread?.discordThreadId) {
        await this.discordRole.addMemberToThread(eventWithThread.discordThreadId, input.discordUserId);
      }
    })().catch((err) => this.logger.warn({ err }, "Could not assign event role/thread on RSVP"));

    return result;
  }

  async updateGuests(eventId: string, discordUserId: string, raw: unknown) {
    const input = guestUpdateSchema.parse({
      ...(typeof raw === "object" && raw ? raw : {}),
      discordUserId,
    });
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      include: { eventType: true },
    });
    if (!event) throw new NotFoundException("Event not found");
    if (input.guests.length > event.eventType.maxGuestsPerRsvp) {
      throw new BadRequestException(
        `This event allows at most ${event.eventType.maxGuestsPerRsvp} guests`,
      );
    }

    const rsvp = await this.prisma.client.rSVP.findUnique({
      where: {
        eventId_primaryDiscordUserId: {
          eventId,
          primaryDiscordUserId: discordUserId,
        },
      },
      include: { participants: true },
    });
    if (!rsvp) throw new NotFoundException("RSVP not found");

    return this.prisma.client.$transaction(async (tx) => {
      await tx.eventParticipant.deleteMany({
        where: { eventId, rsvpId: rsvp.id, participantType: "GUEST" },
      });

      for (const guest of input.guests) {
        const guestProfile = guest.discordUserId
          ? await tx.playerProfile.upsert({
              where: {
                guildId_discordUserId: {
                  guildId: event.guildId,
                  discordUserId: guest.discordUserId,
                },
              },
              create: {
                guildId: event.guildId,
                discordUserId: guest.discordUserId,
                displayName: guest.displayName,
              },
              update: { displayName: guest.displayName },
            })
          : null;

        await tx.eventParticipant.create({
          data: {
            eventId,
            rsvpId: rsvp.id,
            playerProfileId: guestProfile?.id,
            participantType: "GUEST",
            discordUserId: guest.discordUserId,
            enteredName: guest.discordUserId ? undefined : guest.displayName,
            displayName: guest.displayName,
            playerCategory: rsvp.selectedCategory,
            partyKey: rsvp.partyKey,
            partyOwnerParticipantId: `${eventId}:${discordUserId}:primary`,
            feedbackEligible: Boolean(guest.discordUserId),
            messageEligible: Boolean(guest.discordUserId),
            roleEligible: Boolean(guest.discordUserId),
            createdByDiscordId: discordUserId,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          guildId: event.guildId,
          eventId,
          actorDiscordId: discordUserId,
          action: "rsvp.guests.updated",
          afterValue: { guestCount: input.guests.length },
        },
      });

      return tx.rSVP.findUnique({
        where: { id: rsvp.id },
        include: { participants: true },
      });
    });
  }

  async cancelRsvp(eventId: string, discordUserId: string) {
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    const rsvp = await this.prisma.client.rSVP.update({
      where: {
        eventId_primaryDiscordUserId: {
          eventId,
          primaryDiscordUserId: discordUserId,
        },
      },
      data: {
        status: "CANCELLED",
        participants: {
          updateMany: {
            where: {},
            data: { assignmentEligible: false, attendanceEligible: false },
          },
        },
        event: {
          update: {
            auditLogs: {
              create: {
                guildId: event.guildId,
                actorDiscordId: discordUserId,
                action: "rsvp.cancelled",
                afterValue: { discordUserId },
              },
            },
          },
        },
      },
    });

    // §12.6: Fire-and-forget Discord role removal — cancel always succeeds regardless.
    void (async () => {
      const eventRole = await this.prisma.client.eventRole.findUnique({
        where: { eventId_roleType: { eventId, roleType: "PLAYER" } },
      });
      if (eventRole && eventRole.discordRoleId && !eventRole.deletedAt) {
        await this.discordRole.removeRoleFromMember(event.guildId, discordUserId, eventRole.discordRoleId);
      }
    })().catch((err) => this.logger.warn({ err }, "Could not remove event role on RSVP cancel"));

    return rsvp;
  }

  // ─── Tables ───────────────────────────────────────────────────────────────

  async createTable(eventId: string, raw: unknown) {
    const input = tableCreateSchema.parse(raw);
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      include: {
        eventType: true,
        eligibilityRules: {
          where: { signupRole: "TABLE_DM" },
        },
      },
    });
    if (!event) throw new NotFoundException("Event not found");

    const memberRoleIds =
      Array.isArray((raw as Record<string, unknown>)?.memberDiscordRoleIds)
        ? ((raw as Record<string, unknown>).memberDiscordRoleIds as string[])
        : [];
    const rule = event.eligibilityRules[0] ?? null;
    const eligibility = checkEligibility(rule, memberRoleIds);
    if (!eligibility.eligible) {
      throw new ForbiddenException(eligibility.reason);
    }

    // Enforce DM/Player exclusivity (rules.md §4.1, §5.3, §7.2):
    // A user who already has an active player RSVP cannot register as TABLE_DM.
    const existingPlayerRsvp = await this.prisma.client.rSVP.findUnique({
      where: {
        eventId_primaryDiscordUserId: {
          eventId,
          primaryDiscordUserId: input.ambassadorDiscordId,
        },
      },
    });
    if (existingPlayerRsvp && existingPlayerRsvp.status !== "CANCELLED") {
      // BACKUP_DM may register a table — they are eligible to convert to active DM.
      // Only a pure PLAYER RSVP (no DM intent) conflicts with TABLE_DM registration.
      if (existingPlayerRsvp.signupRole === "PLAYER") {
        throw new ForbiddenException(
          "You are already registered as a player for this event. A player cannot also register as a DM.",
        );
      }
    }

    const tableType = usesDndCategories(event.gameSystem)
      ? input.tableType
      : ("MIXED" as const);
    const effectiveInput = { ...input, tableType };

    const ambassador = await this.prisma.client.ambassadorProfile.upsert({
      where: {
        guildId_discordUserId: {
          guildId: event.guildId,
          discordUserId: input.ambassadorDiscordId,
        },
      },
      create: {
        guildId: event.guildId,
        discordUserId: input.ambassadorDiscordId,
        displayName: input.ambassadorDisplayName ?? input.ambassadorDiscordId,
        defaultTableType: tableType,
        defaultSoftCap: input.softCap,
        defaultHardCap: input.hardCap,
      },
      update: {
        active: true,
        displayName: input.ambassadorDisplayName ?? undefined,
      },
    });

    return this.prisma.client.$transaction(async (tx) => {
      const data = {
        title: input.title ?? `${ambassador.displayName}'s Table`,
        tableType,
        softCap: input.softCap,
        hardCap: input.hardCap,
        description: input.description,
      };
      const existing = await tx.eventTable.findFirst({
        where: {
          eventId,
          ambassadorProfileId: ambassador.id,
          status: { not: "CANCELLED" },
        },
      });
      const table = existing
        ? await tx.eventTable.update({ where: { id: existing.id }, data })
        : await tx.eventTable.create({
            data: { eventId, ambassadorProfileId: ambassador.id, ...data },
          });

      await tx.auditLog.create({
        data: {
          guildId: event.guildId,
          eventId,
          actorDiscordId: input.ambassadorDiscordId,
          action: existing ? "table.updated" : "table.created",
          afterValue: effectiveInput,
        },
      });

      return table;
    });
  }

  // ─── Assignment ───────────────────────────────────────────────────────────

  // Load all data needed to run the assignment engine for an event.
  private async loadEventForAssignment(eventId: string) {
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      include: {
        tables: { include: { assignments: true } },
        participants: { include: { assignments: true } },
        seatingGroups: { include: { members: true } },
      },
    });
    if (!event) throw new NotFoundException("Event not found");

    const preferences = await this.prisma.client.eventSignupPreference.findMany(
      { where: { eventId } },
    );

    return { ...event, preferences };
  }

  // Translate loaded event data into AssignmentParticipant / AssignmentTable
  // shapes and run the engine.  Does NOT write to the database.
  private computeAssignments(
    event: EventForAssignment,
  ): AssignmentResult {
    const { participants, tables, preferences, seatingGroups } = event;

    // Build discordUserId → participantId map for preference resolution.
    const participantByUser = new Map<string, string>(
      participants
        .filter((p) => p.discordUserId)
        .map((p) => [p.discordUserId!, p.id]),
    );

    // Build per-participant avoid/prefer maps from EventSignupPreference rows.
    // Avoid DM: targetUserId stores the table ID (callers must use table ID).
    const avoidParticipantMap = new Map<string, string[]>();
    const avoidTableMap = new Map<string, string[]>();
    const preferTableMap = new Map<string, string[]>();

    for (const pref of preferences) {
      const sourcePid = participantByUser.get(pref.userId);
      if (!sourcePid) continue;

      if (pref.preferenceType === "AVOID_PLAYER" && pref.targetUserId) {
        const targetPid = participantByUser.get(pref.targetUserId);
        if (targetPid) {
          const arr = avoidParticipantMap.get(sourcePid) ?? [];
          arr.push(targetPid);
          avoidParticipantMap.set(sourcePid, arr);
        }
      }
      if (pref.preferenceType === "AVOID_DM" && pref.targetUserId) {
        const matchedTable = tables.find((t) => t.id === pref.targetUserId);
        if (matchedTable) {
          const arr = avoidTableMap.get(sourcePid) ?? [];
          arr.push(matchedTable.id);
          avoidTableMap.set(sourcePid, arr);
        }
      }
      if (pref.preferenceType === "PREFER_DM" && pref.targetUserId) {
        const matchedTable = tables.find((t) => t.id === pref.targetUserId);
        if (matchedTable) {
          const arr = preferTableMap.get(sourcePid) ?? [];
          arr.push(matchedTable.id);
          preferTableMap.set(sourcePid, arr);
        }
      }
    }

    // Build a partyKey override for DO_NOT_SPLIT seating groups.
    // Accepted members of a DO_NOT_SPLIT group all share the groupId as
    // their partyKey, making the assignment engine seat them together or
    // waitlist them together.
    const seatingGroupPartyKey = new Map<string, string>();
    for (const group of seatingGroups) {
      if (group.splitPolicy !== "DO_NOT_SPLIT") continue;
      const acceptedUserIds = new Set(
        group.members
          .filter((m) => m.status === "ACCEPTED")
          .map((m) => m.userId),
      );
      for (const [userId, participantId] of participantByUser) {
        if (acceptedUserIds.has(userId)) {
          seatingGroupPartyKey.set(participantId, group.id);
        }
      }
    }

    const engineParticipants = participants
      .filter((p) => p.assignmentEligible)
      // Backup DMs who have been pulled to DM role are excluded from player seating.
      .filter((p) => p.backupDmStatus !== "BACKUP_PULLED_TO_DM")
      .map((p) => ({
        id: p.id,
        displayName: p.displayName,
        // Seating group overrides take precedence over default partyKey.
        partyKey: seatingGroupPartyKey.get(p.id) ?? p.partyKey,
        category: p.playerCategory,
        lockedTableId:
          p.assignments.find(
            (a) => a.locked && a.status === "ASSIGNED",
          )?.eventTableId ?? null,
        avoidParticipantIds: avoidParticipantMap.get(p.id),
        avoidTableIds: avoidTableMap.get(p.id),
        preferredTableIds: preferTableMap.get(p.id),
      }));

    const engineTables = tables.map((t) => ({
      id: t.id,
      title: t.title,
      tableType: t.tableType,
      softCap: t.softCap,
      hardCap: t.hardCap,
      locked: t.locked || t.status === "LOCKED",
      hasDm: Boolean(t.ambassadorProfileId),
      existingParticipantIds: t.assignments
        .filter((a) => a.locked && a.status === "ASSIGNED")
        .map((a) => a.eventParticipantId),
    }));

    return assignParticipantsToTables(engineParticipants, engineTables);
  }

  // Write assignment results to the database inside a transaction.
  // statusMap converts engine "ASSIGNED"/"WAITLISTED" to the DB enum value.
  private async persistAssignments(
    tx: Parameters<Parameters<PrismaService["client"]["$transaction"]>[0]>[0],
    eventId: string,
    actorDiscordId: string,
    guildId: string,
    result: AssignmentResult,
    assignedStatus: "PROJECTED_SEATED" | "CONFIRMED_SEATED",
    waitlistedStatus: "PROJECTED_WAITLISTED" | "CONFIRMED_WAITLISTED",
    auditAction: string,
    extraAuditData: Record<string, unknown> = {},
  ) {
    // Remove existing non-locked projected/pending assignments.
    await tx.assignment.updateMany({
      where: {
        eventId,
        locked: false,
        status: {
          in: [
            "ASSIGNED",
            "WAITLISTED",
            "UNASSIGNED",
            "PROJECTED_SEATED",
            "PROJECTED_WAITLISTED",
          ],
        },
      },
      data: {
        status: "REMOVED",
        reason: "Removed by assignment recalculation",
      },
    });

    for (const decision of result.decisions) {
      await tx.assignment.create({
        data: {
          eventId,
          eventParticipantId: decision.participantId,
          eventTableId: decision.tableId,
          status:
            decision.status === "ASSIGNED" ? assignedStatus : waitlistedStatus,
          reasonCode: decision.reasonCode,
          reason: decision.reason,
          assignedBy: actorDiscordId,
          // Confirmed assignments are locked so they survive future recalculation.
          locked: assignedStatus === "CONFIRMED_SEATED",
        },
      });
    }

    await tx.auditLog.create({
      data: {
        guildId,
        eventId,
        actorDiscordId,
        action: auditAction,
        reasonCode: auditAction,
        afterValue: {
          decidedCount: result.decisions.length,
          warningCount: result.warnings.length,
          assignedStatus,
          waitlistedStatus,
          ...extraAuditData,
        },
      },
    });
  }

  async runAssignments(eventId: string, actorDiscordId: string) {
    const eventData = await this.loadEventForAssignment(eventId);
    const isLocked = Boolean(eventData.assignmentLockedAt);

    const assignedStatus = isLocked
      ? ("CONFIRMED_SEATED" as const)
      : ("PROJECTED_SEATED" as const);
    const waitlistedStatus = isLocked
      ? ("CONFIRMED_WAITLISTED" as const)
      : ("PROJECTED_WAITLISTED" as const);

    try {
      const result = this.computeAssignments(eventData);

      await this.prisma.client.$transaction(async (tx) => {
        await this.persistAssignments(
          tx, eventId, actorDiscordId, eventData.guildId,
          result, assignedStatus, waitlistedStatus,
          "assignment.recalculated",
          { isLocked },
        );
      });

      return result;
    } catch (error) {
      this.metrics.assignmentFailures.inc();
      await this.alerts.sendOpsAlert("Assignment run failed", {
        eventId,
        actorDiscordId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // Lock assignments: recompute from current RSVPs/tables/groups/preferences,
  // then atomically write as CONFIRMED and set assignmentLockedAt.
  // This prevents confirming stale projected state.
  async lockAssignments(eventId: string, raw: unknown) {
    const input = lockAssignmentsInputSchema.parse(raw);

    const eventData = await this.loadEventForAssignment(eventId);
    if (eventData.assignmentLockedAt) {
      throw new BadRequestException(
        "Assignments are already locked for this event",
      );
    }

    try {
      // Fresh compute — any RSVP changes since last runAssignments are included.
      const result = this.computeAssignments(eventData);
      const lockedAt = new Date();

      await this.prisma.client.$transaction(async (tx) => {
        await this.persistAssignments(
          tx, eventId, input.actorDiscordId, eventData.guildId,
          result,
          "CONFIRMED_SEATED",
          "CONFIRMED_WAITLISTED",
          "assignment.locked",
          { lockedAt: lockedAt.toISOString(), reason: input.reason ?? "Manual lock" },
        );

        // Set the lock timestamp.
        await tx.event.update({
          where: { id: eventId },
          data: { assignmentLockedAt: lockedAt },
        });
      });

      // Post table roster to event thread after lock (fire-and-forget).
      void this.postRosterToThread(eventId, result).catch((err) =>
        this.logger.warn({ err, eventId }, "Failed to post roster to event thread"),
      );

      return { ok: true, lockedAt, decisions: result.decisions.length, warnings: result.warnings };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.metrics.assignmentFailures.inc();
      await this.alerts.sendOpsAlert("Assignment lock failed", {
        eventId,
        actorDiscordId: input.actorDiscordId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ─── Thread roster post ───────────────────────────────────────────────────

  private async postRosterToThread(eventId: string, result: AssignmentResult): Promise<void> {
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      select: {
        title: true,
        discordThreadId: true,
        tables: { select: { id: true, title: true, ambassadorProfile: { select: { displayName: true } } } },
        participants: { select: { id: true, displayName: true } },
      },
    });
    if (!event?.discordThreadId) return;

    const participantById = new Map(event.participants.map((p) => [p.id, p]));
    const tableById = new Map(event.tables.map((t) => [t.id, t]));

    const seatedByTable = new Map<string, string[]>();
    const waitlisted: string[] = [];

    for (const decision of result.decisions) {
      const name = participantById.get(decision.participantId)?.displayName ?? decision.participantId;
      if (decision.status === "ASSIGNED" && decision.tableId) {
        const list = seatedByTable.get(decision.tableId) ?? [];
        list.push(name);
        seatedByTable.set(decision.tableId, list);
      } else {
        waitlisted.push(name);
      }
    }

    const lines: string[] = [`**Table Assignments — ${event.title}**\n`];
    for (const [tableId, names] of seatedByTable) {
      const table = tableById.get(tableId);
      const dmLine = table?.ambassadorProfile?.displayName
        ? ` (DM: ${table.ambassadorProfile.displayName})`
        : "";
      lines.push(`**${table?.title ?? tableId}**${dmLine}`);
      lines.push(names.map((n) => `— ${n}`).join("\n"));
      lines.push("");
    }
    if (waitlisted.length > 0) {
      lines.push(`**Waitlisted:** ${waitlisted.join(", ")}`);
    }

    await this.discordRole.postToThread(event.discordThreadId, lines.join("\n"));
  }

  // ─── Backup DM lifecycle ──────────────────────────────────────────────────

  // List backup DM candidates for an event, sorted by burnout-aware priority.
  // Priority: least recently DM'd, lowest recent DM count, earliest RSVP.
  async listBackupDmCandidates(eventId: string) {
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    const backupRsvps = await this.prisma.client.rSVP.findMany({
      where: { eventId, signupRole: "BACKUP_DM", status: "GOING" },
      include: {
        playerProfile: {
          include: {
            // Attach ambassador profile for burnout stats
          },
        },
        participants: {
          where: {
            backupDmStatus: {
              in: [
                "BACKUP_AVAILABLE_AS_PLAYER",
                "BACKUP_ON_STANDBY",
              ],
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Load ambassador profiles for burnout stats
    const ambassadorProfiles = await this.prisma.client.ambassadorProfile.findMany({
      where: {
        guildId: event.guildId,
        discordUserId: { in: backupRsvps.map((r) => r.primaryDiscordUserId) },
      },
    });
    const ambassadorByUser = new Map(
      ambassadorProfiles.map((a) => [a.discordUserId, a]),
    );

    const candidates = backupRsvps.map((rsvp) => {
      const ambassador = ambassadorByUser.get(rsvp.primaryDiscordUserId);
      return {
        rsvpId: rsvp.id,
        discordUserId: rsvp.primaryDiscordUserId,
        participantId: rsvp.participants[0]?.id ?? null,
        backupDmStatus: rsvp.participants[0]?.backupDmStatus ?? null,
        rsvpCreatedAt: rsvp.createdAt,
        lastDmDate: ambassador?.lastDmDate ?? null,
        dmCountLast30Days: ambassador?.dmCountLast30Days ?? 0,
        backupPullCountLast90Days: ambassador?.backupPullCountLast90Days ?? 0,
      };
    });

    // Burnout-aware priority sort:
    // 1. Available (not on standby) first
    // 2. Least recently DM'd (null = never, highest priority)
    // 3. Lowest dmCountLast30Days
    // 4. Lowest backupPullCountLast90Days
    // 5. Earlier RSVP timestamp
    candidates.sort((a, b) => {
      // Null lastDmDate = never DM'd → highest priority (smallest epoch)
      const aDate = a.lastDmDate?.getTime() ?? 0;
      const bDate = b.lastDmDate?.getTime() ?? 0;
      if (aDate !== bDate) return aDate - bDate;
      if (a.dmCountLast30Days !== b.dmCountLast30Days)
        return a.dmCountLast30Days - b.dmCountLast30Days;
      if (a.backupPullCountLast90Days !== b.backupPullCountLast90Days)
        return a.backupPullCountLast90Days - b.backupPullCountLast90Days;
      return a.rsvpCreatedAt.getTime() - b.rsvpCreatedAt.getTime();
    });

    return candidates;
  }

  async handleBackupDmAction(eventId: string, raw: unknown) {
    const input = backupDmPullInputSchema.parse(raw);
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    const participant = await this.prisma.client.eventParticipant.findUnique({
      where: { id: input.participantId },
      include: {
        assignments: {
          where: {
            status: { in: ["PROJECTED_SEATED", "CONFIRMED_SEATED", "ASSIGNED"] },
            locked: false,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!participant || participant.eventId !== eventId) {
      throw new NotFoundException("Participant not found");
    }
    if (participant.signupRole !== "BACKUP_DM") {
      throw new BadRequestException("Participant is not a backup DM");
    }

    return this.prisma.client.$transaction(async (tx) => {
      let newStatus: string;
      let auditAction: string;

      if (input.action === "pull") {
        newStatus = "BACKUP_PULLED_TO_DM";
        auditAction = "backup_dm.pulled";

        // Remove the backup DM's player seat assignment (hard block).
        const playerAssignment = participant.assignments[0];
        if (playerAssignment) {
          await tx.assignment.update({
            where: { id: playerAssignment.id },
            data: {
              status: "REMOVED",
              reason: "Player seat released — backup DM pulled to DM role",
            },
          });
          await tx.auditLog.create({
            data: {
              guildId: event.guildId,
              eventId,
              actorDiscordId: input.actorDiscordId,
              action: "backup_dm.player_seat_released",
              reasonCode: "backup_dm_pulled",
              afterValue: {
                participantId: input.participantId,
                releasedAssignmentId: playerAssignment.id,
              },
            },
          });
        }

        // Update DM burnout stats on their ambassador profile.
        await tx.ambassadorProfile.updateMany({
          where: {
            guildId: event.guildId,
            discordUserId: participant.discordUserId ?? undefined,
          },
          data: {
            lastDmDate: new Date(),
            dmCountLast30Days: { increment: 1 },
            backupPullCountLast90Days: { increment: 1 },
          },
        });
      } else if (input.action === "release") {
        newStatus = "BACKUP_RELEASED_AS_PLAYER";
        auditAction = "backup_dm.released";
      } else {
        // decline: backup DM keeps their player seat
        newStatus = "BACKUP_DECLINED_PULL";
        auditAction = "backup_dm.declined";
      }

      await tx.eventParticipant.update({
        where: { id: input.participantId },
        data: {
          backupDmStatus: newStatus as Parameters<typeof tx.eventParticipant.update>[0]["data"]["backupDmStatus"],
        },
      });

      await tx.auditLog.create({
        data: {
          guildId: event.guildId,
          eventId,
          actorDiscordId: input.actorDiscordId,
          action: auditAction,
          reasonCode: input.action,
          afterValue: {
            participantId: input.participantId,
            backupDmStatus: newStatus,
            reason: input.reason,
          },
        },
      });

      return {
        ok: true,
        participantId: input.participantId,
        backupDmStatus: newStatus,
      };
    });
  }

  // ─── Seating groups ───────────────────────────────────────────────────────

  async createSeatingGroup(
    eventId: string,
    requestedByUserId: string,
    splitPolicy: "DO_NOT_SPLIT" | "SPLIT_IF_NEEDED" | "ORGANIZER_DECIDES" = "ORGANIZER_DECIDES",
  ) {
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    // Each user may only have one seating group per event.
    const existing = await this.prisma.client.eventSeatingGroup.findFirst({
      where: {
        eventId,
        members: { some: { userId: requestedByUserId, status: "ACCEPTED" } },
      },
    });
    if (existing) {
      throw new BadRequestException(
        "You are already in a seating group for this event",
      );
    }

    return this.prisma.client.eventSeatingGroup.create({
      data: {
        eventId,
        requestedByUserId,
        splitPolicy,
        members: {
          create: { userId: requestedByUserId, status: "ACCEPTED" },
        },
      },
      include: { members: true },
    });
  }

  async joinSeatingGroup(groupId: string, userId: string) {
    const group = await this.prisma.client.eventSeatingGroup.findUnique({
      where: { id: groupId },
      include: { members: true },
    });
    if (!group) throw new NotFoundException("Seating group not found");
    if (group.members.length >= group.maxSize) {
      throw new BadRequestException("Seating group is full");
    }

    return this.prisma.client.eventSeatingGroupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId, status: "ACCEPTED" },
      update: { status: "ACCEPTED" },
    });
  }

  async leaveSeatingGroup(groupId: string, userId: string) {
    return this.prisma.client.eventSeatingGroupMember.updateMany({
      where: { groupId, userId },
      data: { status: "DECLINED" },
    });
  }

  async updateSeatingGroupPolicy(
    groupId: string,
    requestedByUserId: string,
    splitPolicy: "DO_NOT_SPLIT" | "SPLIT_IF_NEEDED" | "ORGANIZER_DECIDES",
  ) {
    const group = await this.prisma.client.eventSeatingGroup.findUnique({
      where: { id: groupId },
    });
    if (!group) throw new NotFoundException("Seating group not found");
    if (group.requestedByUserId !== requestedByUserId) {
      throw new ForbiddenException(
        "Only the group creator can update the split policy",
      );
    }

    return this.prisma.client.eventSeatingGroup.update({
      where: { id: groupId },
      data: { splitPolicy },
      include: { members: true },
    });
  }

  async getMySeatingGroup(eventId: string, userId: string) {
    return this.prisma.client.eventSeatingGroup.findFirst({
      where: {
        eventId,
        members: { some: { userId, status: "ACCEPTED" } },
      },
      include: { members: true },
    });
  }

  async listSeatingGroups(eventId: string) {
    return this.prisma.client.eventSeatingGroup.findMany({
      where: { eventId },
      include: { members: true },
      orderBy: { createdAt: "asc" },
    });
  }

  // ─── Signup preferences ───────────────────────────────────────────────────

  async upsertPreference(
    eventId: string,
    userId: string,
    raw: unknown,
  ) {
    const input = z.object({
      preferenceType: z.enum(["PREFER_DM", "AVOID_DM", "PREFER_PLAYER", "AVOID_PLAYER", "NOTE"]),
      targetUserId: z.string().min(1).optional(),
      note: z.string().trim().max(1000).optional(),
      strength: z.enum(["SOFT", "HARD"]).default("SOFT"),
    }).parse(raw);

    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    // Find existing preference of this type for the same target.
    const existing = await this.prisma.client.eventSignupPreference.findFirst({
      where: {
        eventId,
        userId,
        preferenceType: input.preferenceType,
        targetUserId: input.targetUserId ?? null,
      },
    });

    if (existing) {
      return this.prisma.client.eventSignupPreference.update({
        where: { id: existing.id },
        data: { note: input.note, strength: input.strength },
      });
    }

    return this.prisma.client.eventSignupPreference.create({
      data: {
        eventId,
        userId,
        preferenceType: input.preferenceType,
        targetUserId: input.targetUserId,
        note: input.note,
        strength: input.strength,
      },
    });
  }

  async deletePreference(prefId: string, userId: string) {
    const pref = await this.prisma.client.eventSignupPreference.findUnique({
      where: { id: prefId },
    });
    if (!pref) throw new NotFoundException("Preference not found");
    if (pref.userId !== userId) {
      throw new ForbiddenException("Cannot delete another user's preference");
    }
    return this.prisma.client.eventSignupPreference.delete({
      where: { id: prefId },
    });
  }

  // Returns own preferences only — no privacy leakage.
  async listMyPreferences(eventId: string, userId: string) {
    return this.prisma.client.eventSignupPreference.findMany({
      where: { eventId, userId },
      orderBy: { createdAt: "asc" },
    });
  }

  // Admin-only: all preferences with private avoid data visible to organizers.
  async listAllPreferences(eventId: string) {
    return this.prisma.client.eventSignupPreference.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
    });
  }

  // ─── Attendance ───────────────────────────────────────────────────────────

  async confirmAttendance(eventId: string, raw: unknown) {
    const input = attendanceInputSchema.parse(raw);
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    return this.prisma.client.$transaction(async (tx) => {
      for (const record of input.records) {
        await tx.attendanceRecord.upsert({
          where: {
            eventId_eventParticipantId: {
              eventId,
              eventParticipantId: record.eventParticipantId,
            },
          },
          create: {
            eventId,
            eventParticipantId: record.eventParticipantId,
            eventTableId: record.eventTableId,
            rsvpId: record.rsvpId,
            status: record.status,
            notes: record.notes,
            confirmedByDiscordId: input.actorDiscordId,
          },
          update: {
            eventTableId: record.eventTableId,
            status: record.status,
            notes: record.notes,
            confirmedByDiscordId: input.actorDiscordId,
            confirmedAt: new Date(),
          },
        });

        await tx.eventParticipant.update({
          where: { id: record.eventParticipantId },
          data: { confirmationStatus: record.status },
        });
      }

      await tx.auditLog.create({
        data: {
          guildId: event.guildId,
          eventId,
          actorDiscordId: input.actorDiscordId,
          action: "attendance.confirmed",
          afterValue: { count: input.records.length },
        },
      });

      return { ok: true, count: input.records.length };
    });
  }

  // ─── Metrics ──────────────────────────────────────────────────────────────

  async refreshDbConnectionMetric() {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ count: bigint | number }>
    >`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
    `;
    const count = Number(rows[0]?.count ?? 0);
    const limit = Number.parseInt(
      process.env.DATABASE_PLAN_MAX_CONNECTIONS ?? "25",
      10,
    );
    const threshold = Number.parseFloat(
      process.env.DATABASE_CONNECTION_ALERT_THRESHOLD ?? "0.7",
    );

    this.metrics.dbConnections.set(count);
    this.metrics.dbConnectionLimit.set(limit);

    if (count >= limit * threshold) {
      await this.alerts.sendOpsAlert(
        "Database connection usage exceeded threshold",
        { count, limit, threshold },
      );
    }
  }

  private async ensureEventType(key: string, gameSystem: string) {
    return this.prisma.client.eventType.upsert({
      where: { key },
      create: {
        key,
        name: key === "dnd_session_night" ? "D&D Session Night" : key,
        defaultGameSystem: gameSystem,
      },
      update: {},
    });
  }
}

function usesDndCategories(gameSystem: string) {
  const value = gameSystem.trim().toLowerCase();
  return value === "d&d" || value === "dnd" || value.includes("dungeons");
}
